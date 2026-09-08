import type { ChallengeId, VehicleProfile } from "../types";
export const vehicles: Record<
  VehicleProfile,
  { label: string; referenceKmh: number; description: string }
> = {
  road: {
    label: "BICI DA CORSA",
    referenceKmh: 36,
    description: "36 km/h @ 250 W",
  },
  trike: { label: "TRIKE", referenceKmh: 36, description: "36 km/h @ 250 W" },
  recumbent: {
    label: "RECLINATA",
    referenceKmh: 42,
    description: "42 km/h @ 250 W",
  },
  velomobile: {
    label: "VELOMOBILE",
    referenceKmh: 59,
    description: "59 km/h @ 250 W",
  },
};
export const challenges: Record<
  ChallengeId,
  { label: string; distanceKm?: number; description: string }
> = {
  dyno: { label: "DYNO SPRINT", description: "Prova a tempo" },
  monza: {
    label: "MONZA LAP",
    distanceKm: 5.793,
    description: "1 giro · 5,793 km",
  },
  velodrome: {
    label: "VELODROMO",
    distanceKm: 0.4,
    description: "1 giro · 400 m",
  },
};

/** Giro completo con prima chicane: record di riferimento dell'utente. */
export const monzaGhost = {
  name: "MARCO RUGA",
  vehicle: "velomobile" as VehicleProfile,
  timeSeconds: 355,
  displayTime: "5:55",
  averageKmh: 58.5,
  averageWatts: 234,
};
