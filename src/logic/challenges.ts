import type { ChallengeId, VehicleProfile } from "../types";
export const vehicles: Record<
  VehicleProfile,
  { label: string; referenceKmh: number; weightKg: number; aeroCoefficient: number; description: string }
> = {
  road: {
    label: "BICI DA CORSA",
    referenceKmh: 36,
    weightKg: 9, aeroCoefficient: .021, description: "36 km/h @ 250 W · 9 kg",
  },
  trike: { label: "TRIKE", referenceKmh: 36, weightKg: 15, aeroCoefficient: .021, description: "36 km/h @ 250 W · 15 kg" },
  recumbent: {
    label: "RECLINATA",
    referenceKmh: 42,
    weightKg: 12, aeroCoefficient: .008, description: "42 km/h @ 250 W · 12 kg",
  },
  velomobile: {
    label: "VELOMOBILE",
    referenceKmh: 59,
    weightKg: 24, aeroCoefficient: .0015, description: "59 km/h @ 250 W · 24 kg",
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
  mottarone: { label: "MOTTARONE", distanceKm: 12.1, description: "Armeno → vetta · 920 m D+ · 7,6%" },
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
