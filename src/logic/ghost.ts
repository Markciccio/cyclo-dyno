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

/**
 * Secondo in cui il record era arrivato a una certa distanza: è l'inverso di
 * recordMetersAt e serve al distacco. Confrontare le distanze non basta, il
 * dato che conta in pista sono i secondi.
 */
export function recordSecondsAt(session: DynoSession, meters: number) {
  const samples = session.samples
  if (samples.length < 2) return 0
  const target = meters / 1000
  if (target <= (samples[0].distanceKm ?? 0)) return samples[0].elapsedMs / 1000
  const last = samples[samples.length - 1]
  if (target >= (last.distanceKm ?? 0)) return last.elapsedMs / 1000
  let low = 0
  let high = samples.length - 1
  while (high - low > 1) {
    const mid = (low + high) >> 1
    if ((samples[mid].distanceKm ?? 0) <= target) low = mid
    else high = mid
  }
  const a = samples[low]
  const b = samples[high]
  const span = (b.distanceKm ?? 0) - (a.distanceKm ?? 0)
  const f = span > 0 ? (target - (a.distanceKm ?? 0)) / span : 0
  return (a.elapsedMs + (b.elapsedMs - a.elapsedMs) * f) / 1000
}

/** Il record da battere su un tracciato: la prova completata più veloce. */
export function bestOnTrack(sessions: DynoSession[], challenge: string) {
  // Su un anello il riferimento è il giro più veloce, non la sessione più corta.
  const score = (x: DynoSession) => x.bestLapSeconds ?? x.elapsedSeconds ?? Infinity
  return sessions
    .filter((x) => (x.challenge ?? "dyno") === challenge && x.completed && x.samples.length > 1)
    .sort((a, b) => score(a) - score(b))[0]
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
