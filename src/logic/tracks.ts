import type { ChallengeId } from '../types'
import { rawTracks } from './trackData'

export interface TrackPoint {
  /** Distanza dalla partenza, in metri. */
  s: number
  lat: number
  lon: number
  /** Metri est/nord rispetto al primo vertice: serve a curvatura e rotta. */
  x: number
  y: number
  elevation: number
  /** Pendenza locale (frazione, non percentuale). */
  grade: number
  /** Raggio di curvatura in metri, 2000 sui rettilinei. */
  radius: number
  /** Rotta in gradi, 0 = nord, oraria: è l'angolo con cui ruotare l'icona. */
  bearing: number
  /** Dislivello positivo accumulato fino a qui, in metri. */
  climb: number
}

export interface Track {
  id: TrackId
  closed: boolean
  lengthMeters: number
  points: TrackPoint[]
  totalClimb: number
  minElevation: number
  maxElevation: number
}

export type TrackId = keyof typeof rawTracks
export const hasTrack = (challenge: ChallengeId): challenge is TrackId => challenge in rawTracks

const EARTH = 6371000
const rad = (deg: number) => (deg * Math.PI) / 180

/**
 * Finestra su cui misurare la curvatura. Non è la larghezza della carreggiata:
 * approssima la traiettoria che un ciclista tiene davvero, che taglia le chicane
 * invece di seguire la mezzeria OSM. Tarata sulle velocità reali rilevate a Monza
 * (prima variante 38 km/h, Roggia e Ascari sopra i 50).
 */
const CURVATURE_WINDOW_METERS = 50

/**
 * Base di misura della pendenza. SRTM ha una decina di metri di errore verticale:
 * derivare su 20 m produce oscillazioni fra il 4% e il 16% che non esistono sulla
 * strada e che farebbero sobbalzare sia la simulazione sia il colore del profilo.
 */
const GRADE_WINDOW_METERS = 100

/**
 * Profilo volutamente regolarizzato per Monza. I dati altimetrici raster fanno
 * apparire molte gobbe di 1–3 m che sull'asfalto non si percepiscono; qui il
 * giro sale in modo continuo fino a Lesmo 1 (~30 m), resta quasi piatto alle
 * Lesmo e poi segue i lunghi tratti di discesa/raccordo fino alla Parabolica.
 */
const MONZA_PROFILE: readonly (readonly [number, number])[] = [
  [0, 190],
  [2498, 220], // Prima di Lesmo: +30 m dal traguardo / rettilineo
  [2863, 220], // tra le due Lesmo è sostanzialmente pianura
  [3300, 205], // discesa dopo Lesmo 2
  [3600, 211], // breve risalita verso il sottopasso
  [3941, 210], // ingresso Ascari, quasi regolare
  [5119, 195], // lunga discesa Ascari → Parabolica
  [5794.1, 190], // fine Parabolica / traguardo: chiude senza scalino
];
function monzaElevation(meters: number) {
  for (let i = 1; i < MONZA_PROFILE.length; i++) {
    const [endMeters, endElevation] = MONZA_PROFILE[i];
    if (meters <= endMeters) {
      const [startMeters, startElevation] = MONZA_PROFILE[i - 1];
      const fraction = (meters - startMeters) / (endMeters - startMeters);
      return startElevation + (endElevation - startElevation) * fraction;
    }
  }
  return MONZA_PROFILE.at(-1)![1];
}

function buildTrack(id: TrackId): Track {
  const raw = rawTracks[id]
  const [lat0, lon0] = raw.points[0]
  const scale = Math.cos(rad(lat0))
  const n = raw.points.length
  const xs = raw.points.map(([lat, lon]) => [rad(lon - lon0) * scale * EARTH, rad(lat - lat0) * EARTH] as const)

  const cumulative: number[] = [0]
  for (let i = 1; i < n; i++) {
    cumulative.push(cumulative[i - 1] + Math.hypot(xs[i][0] - xs[i - 1][0], xs[i][1] - xs[i - 1][1]))
  }
  const step = raw.lengthMeters / (raw.closed ? n : n - 1)
  const elevation = id === "monza"
    ? raw.elevation.map((_, i) => monzaElevation(i * step))
    : raw.elevation
  // Su un anello gli indici ruotano, su un punto-a-punto si fermano ai capi.
  const wrap = (i: number) => (raw.closed ? ((i % n) + n) % n : Math.min(n - 1, Math.max(0, i)))
  /**
   * Posizione a una distanza qualsiasi, interpolata fra i vertici. La curvatura
   * va misurata a metri fissi: agganciarla agli indici la farebbe dipendere dal
   * passo di campionamento, e la finestra tarata in pista non varrebbe più.
   */
  const pointAt = (meters: number): readonly [number, number] => {
    const limit = raw.lengthMeters
    const s = raw.closed ? ((meters % limit) + limit) % limit : Math.max(0, Math.min(limit, meters))
    const exact = s / step
    const i = wrap(Math.floor(exact))
    const j = wrap(i + 1)
    const f = exact - Math.floor(exact)
    return [xs[i][0] + (xs[j][0] - xs[i][0]) * f, xs[i][1] + (xs[j][1] - xs[i][1]) * f] as const
  }

  /** Quota interpolata a una distanza qualsiasi, come pointAt ma sull'altimetria. */
  const elevationAt = (meters: number) => {
    const exact = Math.max(0, Math.min(raw.lengthMeters, meters)) / step
    const i = wrap(Math.floor(exact))
    const j = wrap(i + 1)
    return elevation[i] + (elevation[j] - elevation[i]) * (exact - Math.floor(exact))
  }

  const points: TrackPoint[] = []
  let climb = 0
  for (let i = 0; i < n; i++) {
    const prev = wrap(i - 1)
    const next = wrap(i + 1)
    if (i > 0) climb += Math.max(0, elevation[i] - elevation[i - 1])

    const back = Math.max(0, i * step - GRADE_WINDOW_METERS / 2)
    const ahead = Math.min(raw.lengthMeters, i * step + GRADE_WINDOW_METERS / 2)
    const grade = ahead - back > 1 ? (elevationAt(ahead) - elevationAt(back)) / (ahead - back) : 0

    const a = pointAt(i * step - CURVATURE_WINDOW_METERS)
    const b = xs[i]
    const c = pointAt(i * step + CURVATURE_WINDOW_METERS)
    const area = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2
    const sides = Math.hypot(b[0] - a[0], b[1] - a[1]) * Math.hypot(c[0] - b[0], c[1] - b[1]) * Math.hypot(a[0] - c[0], a[1] - c[1])
    const radius = area < 1e-6 ? 2000 : Math.min(2000, sides / (4 * area))

    const dx = xs[next][0] - xs[prev][0]
    const dy = xs[next][1] - xs[prev][1]
    points.push({
      s: raw.closed ? (i * raw.lengthMeters) / n : cumulative[i],
      lat: raw.points[i][0],
      lon: raw.points[i][1],
      x: xs[i][0],
      y: xs[i][1],
      elevation: elevation[i],
      grade,
      radius,
      bearing: ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360,
      climb,
    })
  }
  return {
    id,
    closed: raw.closed,
    lengthMeters: raw.lengthMeters,
    points,
    totalClimb: climb,
    minElevation: Math.min(...elevation),
    maxElevation: Math.max(...elevation),
  }
}

const cache = new Map<TrackId, Track>()
export function getTrack(id: TrackId): Track {
  let track = cache.get(id)
  if (!track) {
    track = buildTrack(id)
    cache.set(id, track)
  }
  return track
}

/** Riporta la distanza dentro il tracciato: sugli anelli gira, altrimenti si ferma all'arrivo. */
export function normaliseDistance(track: Track, meters: number) {
  if (!track.closed) return Math.max(0, Math.min(track.lengthMeters, meters))
  const wrapped = meters % track.lengthMeters
  return wrapped < 0 ? wrapped + track.lengthMeters : wrapped
}

/** Interpola posizione, pendenza, quota e rotta a una data distanza. */
export function sampleTrack(track: Track, meters: number): TrackPoint {
  const s = normaliseDistance(track, meters)
  const { points } = track
  const step = track.lengthMeters / (track.closed ? points.length : points.length - 1)
  const i = Math.min(points.length - 1, Math.max(0, Math.floor(s / step)))
  const j = track.closed ? (i + 1) % points.length : Math.min(points.length - 1, i + 1)
  const a = points[i]
  const b = points[j]
  const f = Math.max(0, Math.min(1, (s - a.s) / step))
  // Le rotte vanno interpolate sul cerchio, altrimenti a cavallo di 0°/360° l'icona fa un giro completo.
  const turn = (((b.bearing - a.bearing + 540) % 360) - 180) * f
  return {
    s,
    lat: a.lat + (b.lat - a.lat) * f,
    lon: a.lon + (b.lon - a.lon) * f,
    x: a.x + (b.x - a.x) * f,
    y: a.y + (b.y - a.y) * f,
    elevation: a.elevation + (b.elevation - a.elevation) * f,
    grade: a.grade + (b.grade - a.grade) * f,
    radius: Math.min(a.radius, b.radius),
    bearing: (a.bearing + turn + 360) % 360,
    climb: a.climb + (b.climb - a.climb) * f,
  }
}

const G = 9.80665

/**
 * Velocità massima ammessa in ogni punto, in m/s: il limite di aderenza in curva
 * propagato all'indietro con la frenata, così si rallenta *prima* di entrare
 * in curva invece di accorgersene all'apice.
 */
function speedLimitProfile(track: Track, lateralG: number, brakeMss: number) {
  const { points } = track
  const n = points.length
  const step = track.lengthMeters / (track.closed ? n : n - 1)
  const limits = points.map((p) => Math.min(33, Math.sqrt(lateralG * G * p.radius)))
  // Due passate bastano su un anello perché il vincolo si propaghi oltre il traguardo.
  for (let pass = 0; pass < (track.closed ? 2 : 1); pass++) {
    for (let i = n - 1; i >= 0; i--) {
      const next = track.closed ? (i + 1) % n : Math.min(n - 1, i + 1)
      if (next === i) continue
      limits[i] = Math.min(limits[i], Math.sqrt(limits[next] * limits[next] + 2 * brakeMss * step))
    }
  }
  return limits
}

const limitCache = new Map<string, number[]>()
/** Velocità massima in curva (km/h) alla distanza indicata. */
export function cornerLimitKmh(track: Track, meters: number, lateralG: number, brakeMss = 3) {
  const key = `${track.id}:${lateralG}:${brakeMss}`
  let limits = limitCache.get(key)
  if (!limits) {
    limits = speedLimitProfile(track, lateralG, brakeMss)
    limitCache.set(key, limits)
  }
  const s = normaliseDistance(track, meters)
  const step = track.lengthMeters / (track.closed ? limits.length : limits.length - 1)
  const i = Math.min(limits.length - 1, Math.max(0, Math.round(s / step)))
  return limits[i] * 3.6
}

/** Dislivello positivo accumulato fino alla distanza indicata, in metri. */
export function climbedMeters(track: Track, meters: number) {
  return sampleTrack(track, meters).climb
}
