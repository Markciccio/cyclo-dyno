import type {VehicleProfile} from '../types'

/** Sagoma di profilo, per i pulsanti di scelta del mezzo. */
export function VehicleIcon({vehicle}:{vehicle:VehicleProfile}){
  if(vehicle==='road')return <svg className="vehicle-icon" viewBox="0 0 64 40" aria-hidden="true"><circle cx="13" cy="29" r="8"/><circle cx="51" cy="29" r="8"/><path d="M13 29 25 10l10 19H13m12-19h11l7 19M25 10l-6-4m17 4 5-5"/></svg>
  if(vehicle==='trike')return <svg className="vehicle-icon" viewBox="0 0 64 40" aria-hidden="true"><circle cx="10" cy="29" r="7"/><circle cx="35" cy="29" r="7"/><circle cx="55" cy="29" r="7"/><path d="M10 29 25 14h16l14 15M25 14l-4-6m4 6 10 15"/></svg>
  if(vehicle==='recumbent')return <svg className="vehicle-icon" viewBox="0 0 64 40" aria-hidden="true"><circle cx="12" cy="29" r="8"/><circle cx="52" cy="29" r="8"/><path d="M12 29 24 22h18l10 7M24 22l-6-13h12l8 13M42 22l5-10"/></svg>
  return <svg className="vehicle-icon velomobile-icon" viewBox="0 0 64 40" aria-hidden="true"><path d="M5 27c4-14 17-20 34-18 10 1 17 8 20 18H5Z"/><circle cx="17" cy="28" r="6"/><circle cx="49" cy="28" r="6"/><path d="M23 16c8-5 18-3 24 5H20"/></svg>
}

/**
 * Sagoma vista dall'alto per il marker sulla mappa, col muso verso l'alto:
 * ruotando il marker della rotta il mezzo punta dove sta andando davvero.
 * Torna markup grezzo perché Leaflet vuole una stringa HTML nel divIcon.
 */
export function vehicleTopDownSvg(vehicle:VehicleProfile){
  const body={
    // Bici e reclinata: sagoma stretta, due ruote in linea.
    road:'<path class="tdv-body" d="M16 3c2.6 0 4 3.4 4 9s-1 15-4 21c-3-6-4-15.4-4-21s1.4-9 4-9Z"/><rect class="tdv-wheel" x="14.6" y="1" width="2.8" height="9" rx="1.4"/><rect class="tdv-wheel" x="14.6" y="24" width="2.8" height="9" rx="1.4"/>',
    recumbent:'<path class="tdv-body" d="M16 2c3 0 4.6 4 4.6 11S19 31 16 34c-3-3-4.6-14-4.6-21S13 2 16 2Z"/><rect class="tdv-wheel" x="14.7" y="1" width="2.6" height="8" rx="1.3"/><rect class="tdv-wheel" x="14.7" y="26" width="2.6" height="9" rx="1.3"/>',
    // Trike: due ruote anteriori larghe, una posteriore.
    trike:'<path class="tdv-body" d="M16 3c2.4 0 3.8 3 3.8 9.5S18.6 31 16 34c-2.6-3-3.8-15-3.8-21.5S13.6 3 16 3Z"/><rect class="tdv-wheel" x="6" y="7" width="2.8" height="8" rx="1.4"/><rect class="tdv-wheel" x="23.2" y="7" width="2.8" height="8" rx="1.4"/><path class="tdv-axle" d="M8 11h16"/><rect class="tdv-wheel" x="14.7" y="26" width="2.6" height="9" rx="1.3"/>',
    // Velomobile: guscio chiuso a goccia, muso stretto e coda affusolata.
    velomobile:'<path class="tdv-shell" d="M16 1.5c4.2 0 7.4 5 8.1 12.2.6 6.4-.4 13.6-2.6 18.2-1.2 2.5-3.2 3.6-5.5 3.6s-4.3-1.1-5.5-3.6C8.3 27.3 7.3 20.1 7.9 13.7 8.6 6.5 11.8 1.5 16 1.5Z"/><path class="tdv-canopy" d="M16 7.5c2.4 0 4 2.4 4 5.6s-1.6 5.4-4 5.4-4-2.2-4-5.4 1.6-5.6 4-5.6Z"/>',
  }[vehicle]
  return `<svg class="topdown-vehicle tdv-${vehicle}" viewBox="0 0 32 36" aria-hidden="true">${body}</svg>`
}
