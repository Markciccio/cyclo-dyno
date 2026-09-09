import { useMemo } from "react"
import type { Track } from "../logic/tracks"
import { normaliseDistance, sampleTrack } from "../logic/tracks"

/** Quanta finestra tenere alle spalle: si guarda soprattutto la rampa che arriva. */
const LOOK_BACK = 0.3

/**
 * Profilo altimetrico con la posizione corrente, colorato per pendenza
 * come i profili delle salite: verde in falsopiano, rosso oltre il 10%.
 *
 * Con `windowMeters` mostra solo il tratto attorno al punto in cui ci si trova:
 * su una salita di 12 km il profilo intero è una rampa uniforme in cui non si
 * distingue lo strappo che arriva fra duecento metri.
 */
export function ElevationProfile({ track, meters, windowMeters }: { track: Track; meters: number; windowMeters?: number }) {
  const position = normaliseDistance(track, meters)
  const span = Math.min(windowMeters ?? track.lengthMeters, track.lengthMeters)
  // La finestra si ferma ai capi del percorso invece di mostrare il vuoto.
  const from = Math.max(0, Math.min(track.lengthMeters - span, position - span * LOOK_BACK))
  const to = from + span

  const bands = useMemo(() => {
    const inside = track.points.filter((p) => p.s >= from && p.s <= to)
    const points = inside.length > 1 ? inside : track.points
    const low = Math.min(...points.map((p) => p.elevation))
    // Un tratto quasi piatto non deve diventare una montagna russa a schermo.
    const relief = Math.max(Math.max(...points.map((p) => p.elevation)) - low, 12)
    const toY = (elevation: number) => 100 - ((elevation - low) / relief) * 78 - 8
    const toX = (s: number) => ((s - from) / (to - from)) * 100
    // Con un vertice ogni 5 m le bande diventerebbero un codice a barre: si aggregano.
    const group = Math.max(1, Math.ceil((points.length - 1) / 120))
    const out = []
    for (let i = 0; i < points.length - 1; i += group) {
      const point = points[i]
      const next = points[Math.min(points.length - 1, i + group)]
      out.push({
        d: `M${toX(point.s)} 100L${toX(point.s)} ${toY(point.elevation)}L${toX(next.s)} ${toY(next.elevation)}L${toX(next.s)} 100Z`,
        // Pendenza già filtrata sui 100 m: riderivarla qui rifarebbe le strisce.
        tone: gradeTone((point.grade + next.grade) / 2),
      })
    }
    return out
  }, [track, from, to])

  const here = sampleTrack(track, position)
  const cursor = ((position - from) / (to - from)) * 100
  const climbing = track.totalClimb > 150
  const remaining = Math.max(0, track.totalClimb - here.climb)

  return (
    <div className="elevation-profile">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {bands.map((band, index) => (
          <path key={index} d={band.d} className={`elev-band elev-${band.tone}`} />
        ))}
        <line x1={cursor} y1="0" x2={cursor} y2="100" className="elev-cursor" />
      </svg>
      <span>
        Quota {Math.round(here.elevation)} m
        {windowMeters ? ` · ${(span / 1000).toFixed(1)} km` : ""}
      </span>
      {climbing && (
        <b>
          {Math.round(here.climb)} m D+ · restano {Math.round(remaining)} m
        </b>
      )}
    </div>
  )
}

function gradeTone(grade: number) {
  const percent = grade * 100
  if (percent < 1) return "flat"
  if (percent < 5) return "easy"
  if (percent < 8) return "mid"
  if (percent < 11) return "hard"
  return "wall"
}
