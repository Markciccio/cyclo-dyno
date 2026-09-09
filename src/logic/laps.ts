import type { Lap, SessionSample } from "../types"

/**
 * Statistiche di un giro chiuso. La media di potenza è pesata sul tempo fra i
 * campioni: il BLE non arriva a cadenza regolare e una media aritmetica
 * darebbe più peso ai tratti in cui i pacchetti sono arrivati più fitti.
 */
export function summariseLap({
  samples,
  fromMs,
  toMs,
  fromKm,
  toKm,
  index,
}: {
  samples: SessionSample[]
  fromMs: number
  toMs: number
  fromKm: number
  toKm: number
  index: number
}): Lap {
  const inside = samples.filter((s) => s.elapsedMs >= fromMs && s.elapsedMs <= toMs)
  const seconds = Math.max(0.1, (toMs - fromMs) / 1000)
  const distanceKm = Math.max(0, toKm - fromKm)

  let weighted = 0
  let span = 0
  for (let i = 0; i < inside.length - 1; i++) {
    const dt = inside[i + 1].elapsedMs - inside[i].elapsedMs
    weighted += inside[i].powerWatts * dt
    span += dt
  }

  return {
    index,
    seconds,
    startMs: fromMs,
    endMs: toMs,
    startKm: fromKm,
    distanceKm,
    averageKmh: distanceKm / (seconds / 3600),
    maxKmh: Math.max(0, ...inside.map((s) => s.virtualSpeedKmh)),
    averageWatts: span > 0 ? weighted / span : (inside[0]?.powerWatts ?? 0),
    maxWatts: Math.max(0, ...inside.map((s) => s.powerWatts)),
  }
}

/** Posizione del giro fra quelli della sessione: 1 è il record di giornata. */
export function lapRank(seconds: number, laps: Lap[]) {
  return laps.filter((lap) => lap.seconds < seconds).length + 1
}

/** Il giro più veloce della sessione. */
export const bestLap = (laps: Lap[]) =>
  laps.reduce<Lap | undefined>((best, lap) => (!best || lap.seconds < best.seconds ? lap : best), undefined)

/** Etichetta della posizione, per l'annuncio a fine giro. */
export function rankLabel(rank: number, total: number) {
  if (total > 1 && rank === 1) return "RECORD DI GIORNATA"
  if (rank === 1) return "PRIMO GIRO"
  return `${rank}º GIRO PIÙ VELOCE`
}

/**
 * Secondo, dentro il giro, in cui il giro di riferimento era a una certa
 * distanza dal traguardo. Su un anello il confronto sensato è giro contro
 * giro: paragonare le distanze totali direbbe solo chi ha girato più a lungo.
 */
export function lapSecondsAt(samples: SessionSample[], lap: Lap, metersIntoLap: number) {
  const inside = samples.filter((s) => s.elapsedMs >= lap.startMs && s.elapsedMs <= lap.endMs)
  if (inside.length < 2) return 0
  const target = lap.startKm + metersIntoLap / 1000
  if (target <= (inside[0].distanceKm ?? 0)) return 0
  const last = inside[inside.length - 1]
  if (target >= (last.distanceKm ?? 0)) return lap.seconds
  let low = 0
  let high = inside.length - 1
  while (high - low > 1) {
    const mid = (low + high) >> 1
    if ((inside[mid].distanceKm ?? 0) <= target) low = mid
    else high = mid
  }
  const a = inside[low]
  const b = inside[high]
  const span = (b.distanceKm ?? 0) - (a.distanceKm ?? 0)
  const f = span > 0 ? (target - (a.distanceKm ?? 0)) / span : 0
  return (a.elapsedMs + (b.elapsedMs - a.elapsedMs) * f - lap.startMs) / 1000
}
