import type {ChallengeId,VehicleProfile} from '../types'

const aero:Record<VehicleProfile,number>={road:.00072,trike:.00084,recumbent:.00056,velomobile:.00043}

/** Calcolo statico conservato per confronti e test; la simulazione usa advanceVirtualSpeed. */
export function calculateVirtualSpeed(powerWatts:number,referenceWatts=250,referenceKmh=36){return powerWatts<=0?0:referenceKmh*Math.cbrt(powerWatts/referenceWatts)}
/** Pendenza media semplificata del giro di Monza, coerente con i settori indicati. */
export function trackGrade(challenge:ChallengeId,distanceKm:number){
  if(challenge!=='monza')return 0
  if(distanceKm<2.2)return .0136 // Parabolica/rettilineo → prima Lesmo: +30 m circa
  if(distanceKm<3)return 0 // tra le Lesmo
  if(distanceKm<4)return -.015 // seconda Lesmo → sottopasso: -15 m circa
  if(distanceKm<4.7)return .008 // risalita intermedia
  return -.01 // Ascari → Parabolica: -10 m circa in 1 km
}

/**
 * Modello inerziale leggero: potenza tende verso la velocità del mezzo;
 * senza pedalare la bici continua per inerzia e perde velocità per aria,
 * rotolamento e pendenza.
 */
export function advanceVirtualSpeed({powerWatts,previousKmh,dtSeconds,referenceWatts=250,referenceKmh=36,vehicle,grade=0}:{powerWatts:number;previousKmh:number;dtSeconds:number;referenceWatts?:number;referenceKmh?:number;vehicle:VehicleProfile;grade?:number}){
  const dt=Math.max(.02,Math.min(1,dtSeconds)),v=Math.max(0,previousKmh)/3.6
  const target=(referenceKmh*Math.cbrt(Math.max(0,powerWatts)/referenceWatts))/3.6
  const pedal=powerWatts>1?Math.max(-.9,Math.min(2.5,(target-v)/2.6)):0
  const drag=aero[vehicle]*v*v
  const rolling=.012
  const slope=-9.81*grade
  const next=Math.max(0,v+(pedal-drag-rolling+slope)*dt)
  return next*3.6
}
