import type { DynoSession, GhostChoice, VehicleProfile } from "../types"
import { vehicles } from "./challenges"
import { monzaGhost } from "./challenges"

export const isVehicleGhost = (choice: GhostChoice): choice is VehicleProfile =>
  choice !== "none" && choice !== "best"

/**
 * Distanza percorsa dal ghost del record a un dato istante, in metri.
 * Rigioca i campioni registrati, così il ghost rallenta dove ha rallentato
 * davvero invece di tenere una media costante.
 */
export function recordMetersAt(session: DynoSession, elapsedSeconds: number) {
  const samples = session.samples
  if (!samples.length) return 0
  const target = elapsedSeconds * 1000
  if (target <= samples[0].elapsedMs) return 0
  const last = samples[samples.length - 1]
  if (target >= last.elapsedMs) return (last.distanceKm ?? 0) * 1000
  // Ricerca binaria: su una salita di 40 minuti i campioni sono migliaia.
  let low = 0
  let high = samples.length - 1
  while (high - low > 1) {
    const mid = (low + high) >> 1
    if (samples[mid].elapsedMs <= target) low = mid
    else high = mid
  }
  const a = samples[low]
  const b = samples[high]
  const span = b.elapsedMs - a.elapsedMs
  const f = span > 0 ? (target - a.elapsedMs) / span : 0
  return ((a.distanceKm ?? 0) + ((b.distanceKm ?? 0) - (a.distanceKm ?? 0)) * f) * 1000
}

/** Il record da battere su un tracciato: la prova completata più veloce. */
export function bestOnTrack(sessions: DynoSession[], challenge: string) {
  return sessions
    .filter((x) => (x.challenge ?? "dyno") === challenge && x.completed && x.samples.length > 1)
    .sort((a, b) => (a.elapsedSeconds ?? Infinity) - (b.elapsedSeconds ?? Infinity))[0]
}

export interface GhostState {
  meters: number
  label: string
  vehicle: VehicleProfile
}

/** Etichetta del ghost per il pannello, senza duplicare le stringhe nei componenti. */
export function ghostLabel(choice: GhostChoice, best?: DynoSession) {
  if (choice === "none") return ""
  if (choice === "best") return best ? `RECORD · ${best.participantName}` : `RECORD · ${monzaGhost.name}`
  return `STESSI WATT · ${vehicles[choice].label}`
}
