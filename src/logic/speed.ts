const G = 9.80665
/** Densità dell'aria a 15 °C sul livello del mare. */
const RHO = 1.225
/** Rendimento della trasmissione: i watt ai pedali non arrivano tutti a terra. */
const DRIVETRAIN = 0.97

export interface VehiclePhysics {
  /** Area frontale per coefficiente di forma, in m². Domina oltre i 25 km/h. */
  cda: number
  /** Coefficiente di rotolamento su asfalto reale. Domina in salita. */
  crr: number
  /** Massa del mezzo in kg, senza atleta. */
  weightKg: number
}

/** Formula statica mantenuta per confronti e test storici. */
export function calculateVirtualSpeed(powerWatts: number, referenceWatts = 250, referenceKmh = 36) {
  return powerWatts <= 0 ? 0 : referenceKmh * Math.cbrt(powerWatts / referenceWatts)
}

/**
 * Forza resistente totale in newton.
 * Gravità e rotolamento usano seno e coseno della pendenza vera: alle pendenze
 * del Mottarone l'approssimazione dei piccoli angoli inizia a sbagliare.
 */
export function resistanceNewtons(speedMs: number, totalKg: number, grade: number, { cda, crr }: VehiclePhysics) {
  const slope = Math.atan(grade)
  const gravity = totalKg * G * Math.sin(slope)
  const rolling = totalKg * G * crr * Math.cos(slope)
  const aero = 0.5 * RHO * cda * speedMs * speedMs
  return gravity + rolling + aero
}

/** Watt ai pedali necessari per tenere una velocità costante. */
export function powerForSpeed(speedKmh: number, totalKg: number, grade: number, physics: VehiclePhysics) {
  const v = speedKmh / 3.6
  return (resistanceNewtons(v, totalKg, grade, physics) * v) / DRIVETRAIN
}

/** Velocità di regime per una potenza data: inversione numerica di powerForSpeed. */
export function steadyStateKmh(powerWatts: number, totalKg: number, grade: number, physics: VehiclePhysics) {
  if (powerWatts <= 0) return 0
  let low = 0
  let high = 45
  for (let i = 0; i < 42; i++) {
    const v = (low + high) / 2
    if (powerForSpeed(v * 3.6, totalKg, grade, physics) > powerWatts) high = v
    else low = v
  }
  return low * 3.6
}

/** Nome storico di steadyStateKmh: l'inversione della formula di Ambrosini. */
export const ambrosiniTargetKmh = steadyStateKmh

/** Sotto questa velocità la potenza non si traduce più in spinta: evita la divisione per zero da fermo. */
const MIN_TRACTION_MS = 1.5
/** Accelerazione massima che le gambe riescono comunque a scaricare a terra. */
const MAX_ACCEL_MSS = 4
/** Frenata tipica di un ciclista che arriva in curva senza esagerare. */
const BRAKE_MSS = 3

export interface AdvanceInput {
  powerWatts: number
  previousKmh: number
  dtSeconds: number
  grade?: number
  totalKg: number
  physics: VehiclePhysics
  /** Tetto imposto dalla curva in cui ci si trova, km/h. Assente sui percorsi liberi. */
  speedLimitKmh?: number
}

/**
 * Un passo di integrazione newtoniana: a = (spinta − resistenze) / massa.
 * Sostituisce il vecchio inseguimento a costante di tempo fissa, che faceva
 * accelerare un velomobile da 96 kg come una bici da 81 kg.
 */
export function advanceVirtualSpeed({ powerWatts, previousKmh, dtSeconds, grade = 0, totalKg, physics, speedLimitKmh }: AdvanceInput) {
  const dt = Math.max(0.02, Math.min(1, dtSeconds))
  const v = Math.max(0, previousKmh) / 3.6

  const thrust = powerWatts > 1 ? (powerWatts * DRIVETRAIN) / Math.max(v, MIN_TRACTION_MS) : 0
  const acceleration = Math.min(MAX_ACCEL_MSS, (thrust - resistanceNewtons(v, totalKg, grade, physics)) / totalKg)
  let next = Math.max(0, v + acceleration * dt)

  if (speedLimitKmh !== undefined) {
    const limit = speedLimitKmh / 3.6
    // Si frena verso il limite, non ci si teletrasporta: il rallentamento resta plausibile.
    if (next > limit) next = Math.max(limit, next - BRAKE_MSS * dt)
  }
  return next * 3.6
}
