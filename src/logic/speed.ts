import type {ChallengeId} from '../types'

const g=9.80665,rolling=.01
const mottaroneGrades=[.046,.11,.11,.086,.09,.10,.078,.084,.074,.074,.048,.058,.05,.052,.034,.074,.082,.092,.078,.072,.082,.068,.116,.068]

/** Formula statica mantenuta per confronti e test. */
export function calculateVirtualSpeed(powerWatts:number,referenceWatts=250,referenceKmh=36){return powerWatts<=0?0:referenceKmh*Math.cbrt(powerWatts/referenceWatts)}

/** Pendenze medie dei settori; Mottarone ricavato dal profilo Armeno → vetta. */
export function trackGrade(challenge:ChallengeId,distanceKm:number){
  if(challenge==='mottarone')return mottaroneGrades[Math.min(mottaroneGrades.length-1,Math.floor(distanceKm/.5))]
  if(challenge!=='monza')return 0
  if(distanceKm<2.2)return .0136
  if(distanceKm<3)return 0
  if(distanceKm<4)return -.015
  if(distanceKm<4.7)return .008
  return -.01
}

/**
 * Inversione numerica della formula di Ambrosini:
 * P = g × [massa × (pendenza + attrito) + K aero × v²] × v.
 * K viene corretto per ciascun veicolo; in salita il peso totale è quindi decisivo.
 */
export function ambrosiniTargetKmh(powerWatts:number,totalKg:number,grade:number,aeroCoefficient:number){
  const wheelPower=Math.max(0,powerWatts)*.97
  let low=0,high=45
  for(let i=0;i<42;i++){const v=(low+high)/2;const required=g*(totalKg*(grade+rolling)+aeroCoefficient*v*v)*v;if(required>wheelPower)high=v;else low=v}
  return low*3.6
}

export function advanceVirtualSpeed({powerWatts,previousKmh,dtSeconds,grade=0,totalKg,aeroCoefficient}:{powerWatts:number;previousKmh:number;dtSeconds:number;grade?:number;totalKg:number;aeroCoefficient:number}){
  const dt=Math.max(.02,Math.min(1,dtSeconds)),v=Math.max(0,previousKmh)/3.6
  if(powerWatts>1){
    const target=ambrosiniTargetKmh(powerWatts,totalKg,grade,aeroCoefficient)/3.6
    return Math.max(0,v+Math.max(-1.3,Math.min(2.6,(target-v)/2.5))*dt)*3.6
  }
  // Ruota libera: gravità, rotolamento e aria agiscono anche a potenza zero.
  const coastAcceleration=-g*(grade+rolling+(aeroCoefficient*v*v)/totalKg)
  return Math.max(0,v+coastAcceleration*dt)*3.6
}
