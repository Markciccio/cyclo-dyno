import type { ChallengeId, VehicleProfile } from "../types";
import type { VehiclePhysics } from "./speed";
import { getTrack, hasTrack } from "./tracks";

export interface VehicleSpec extends VehiclePhysics {
  label: string;
  /** Accelerazione laterale sostenibile in curva, in g. */
  lateralG: number;
  description: string;
}

/**
 * Coefficienti su asfalto reale, non su rullo.
 *
 * CdA: valori di letteratura per mezzi non da record. Il velomobile a 0,048 m²
 * è un mezzo da strada, non un Milan SL da pista.
 * Crr: 0,005 è realistico per buone gomme su asfalto; il trike paga la terza
 * ruota e i cerchi piccoli.
 * lateralG: quanto si osa in curva. Il velomobile non piega e ha tre ruote,
 * quindi sta sotto a tutti: 0,38 g è tarato sui rilievi reali a Monza
 * (prima variante 38 km/h al limite, Roggia e Ascari sopra i 50 in pieno).
 */
export const vehicles: Record<VehicleProfile, VehicleSpec> = {
  road: {
    label: "BICI DA CORSA",
    cda: 0.32,
    crr: 0.005,
    weightKg: 9,
    lateralG: 0.55,
    description: "Posizione sulle leve",
  },
  trike: {
    label: "TRIKE",
    cda: 0.38,
    crr: 0.007,
    weightKg: 15,
    lateralG: 0.42,
    description: "Tadpole non carenato",
  },
  recumbent: {
    label: "RECLINATA",
    cda: 0.22,
    crr: 0.005,
    weightKg: 12,
    lateralG: 0.55,
    description: "Lowracer non carenata",
  },
  velomobile: {
    label: "VELOMOBILE",
    cda: 0.048,
    crr: 0.005,
    weightKg: 24,
    lateralG: 0.38,
    description: "Carenatura integrale",
  },
};

/** Massa fissa aggiunta a atleta e mezzo: borraccia, luci, ciclocomputer. */
export const ACCESSORY_KG = 2;

export const totalMassKg = (riderKg: number, vehicle: VehicleProfile) =>
  riderKg + vehicles[vehicle].weightKg + ACCESSORY_KG;

export interface ChallengeSpec {
  label: string;
  /** Assente sul dyno, che è una prova a tempo senza percorso. */
  distanceKm?: number;
  elevationGain?: number;
  /** Un anello si ripete a giri, un punto-a-punto finisce all'arrivo. */
  lap: boolean;
  /**
   * Fondoscala del misuratore di potenza. Sulle prove lunghe si sta sotto i
   * 500 W anche nei rilanci: con la scala dello sprint l'ago non si muove e
   * non si legge nulla. Quello che sfora resta indicato come extra.
   */
  powerRangeWatts: number;
  description: string;
}

function fromTrack(id: ChallengeId, label: string, note: string, powerRangeWatts = 750): ChallengeSpec {
  const track = getTrack(id as Parameters<typeof getTrack>[0]);
  const km = track.lengthMeters / 1000;
  const climb = Math.round(track.totalClimb);
  return {
    label,
    distanceKm: km,
    elevationGain: climb > 150 ? climb : undefined,
    lap: track.closed,
    powerRangeWatts,
    description: note,
  };
}

export const challenges: Record<ChallengeId, ChallengeSpec> = {
  dyno: { label: "DYNO SPRINT", lap: false, powerRangeWatts: 600, description: "Prova a tempo" },
  monza: fromTrack("monza", "MONZA LAP", "1 giro · 5,794 km · 11 curve"),
  velodrome: fromTrack("velodrome", "VELODROMO", "1 giro · 400 m", 500),
  mottarone: fromTrack("mottarone", "MOTTARONE", "Armeno → vetta · 11,7 km · 7,7%", 500),
};

/** Settori del giro di Monza, dalle distanze reali delle way OSM. */
export const monzaSectors: { name: string; fromMeters: number }[] = [
  { name: "RETTIFILO TRIBUNE", fromMeters: 0 },
  { name: "VARIANTE DEL RETTIFILO", fromMeters: 922 },
  { name: "CURVA GRANDE", fromMeters: 1292 },
  { name: "VARIANTE DELLA ROGGIA", fromMeters: 2140 },
  { name: "LESMO 1", fromMeters: 2498 },
  { name: "LESMO 2", fromMeters: 2863 },
  { name: "CURVA DEL SERRAGLIO", fromMeters: 3247 },
  { name: "VARIANTE ASCARI", fromMeters: 3941 },
  { name: "RETTILINEO CENTRALE", fromMeters: 4177 },
  { name: "CURVA PARABOLICA", fromMeters: 5119 },
];

export function sectorName(challenge: ChallengeId, meters: number) {
  if (challenge !== "monza") return "";
  let current = monzaSectors[0].name;
  for (const sector of monzaSectors) if (meters >= sector.fromMeters) current = sector.name;
  return current;
}

export const challengeTrack = (challenge: ChallengeId) =>
  hasTrack(challenge) ? getTrack(challenge) : undefined;

/**
 * Mezzo di confronto proposto: si vuole vedere l'altro mondo, non lo stesso.
 * Chi guida carenato si misura con la bici da corsa e viceversa.
 */
export function defaultRival(vehicle: VehicleProfile): VehicleProfile {
  if (vehicle === "velomobile") return "road";
  if (vehicle === "road") return "velomobile";
  if (vehicle === "trike") return "recumbent";
  return "velomobile";
}

/** Giro completo con prima chicane: record di riferimento dell'utente. */
export const monzaGhost = {
  name: "MARCO RUGA",
  vehicle: "velomobile" as VehicleProfile,
  timeSeconds: 355,
  displayTime: "5:55",
  averageKmh: 58.5,
  averageWatts: 234,
};
