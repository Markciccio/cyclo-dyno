import type {VehicleProfile} from '../types'

/** Sagoma di profilo, per i pulsanti di scelta del mezzo. */
export function VehicleIcon({vehicle}:{vehicle:VehicleProfile}){
  if(vehicle==='road')return <svg className="vehicle-icon" viewBox="0 0 64 40" aria-hidden="true"><circle cx="13" cy="29" r="8"/><circle cx="51" cy="29" r="8"/><path d="M13 29 25 10l10 19H13m12-19h11l7 19M25 10l-6-4m17 4 5-5"/></svg>
  if(vehicle==='trike')return <svg className="vehicle-icon" viewBox="0 0 64 40" aria-hidden="true"><circle cx="10" cy="29" r="7"/><circle cx="35" cy="29" r="7"/><circle cx="55" cy="29" r="7"/><path d="M10 29 25 14h16l14 15M25 14l-4-6m4 6 10 15"/></svg>
  if(vehicle==='recumbent')return <svg className="vehicle-icon" viewBox="0 0 64 40" aria-hidden="true"><circle cx="12" cy="29" r="8"/><circle cx="52" cy="29" r="8"/><path d="M12 29 24 22h18l10 7M24 22l-6-13h12l8 13M42 22l5-10"/></svg>
  return <svg className="vehicle-icon velomobile-icon" viewBox="0 0 64 40" aria-hidden="true"><path d="M5 27c4-14 17-20 34-18 10 1 17 8 20 18H5Z"/><circle cx="17" cy="28" r="6"/><circle cx="49" cy="28" r="6"/><path d="M23 16c8-5 18-3 24 5H20"/></svg>
}

/** Battistrada: trattini obliqui lungo una ruota, come sulle gomme vere. */
const tread = (x: number, y: number, w: number, h: number, steps: number) =>
  Array.from({ length: steps }, (_, i) => {
    const ty = y + (h * (i + 0.5)) / steps
    return `M${x + 0.3} ${ty - 0.35}L${x + w - 0.3} ${ty + 0.35}`
  }).join('')

/**
 * Sagoma vista dall'alto per il marker sulla mappa, col muso verso l'alto:
 * ruotando il marker della rotta il mezzo punta dove sta andando davvero.
 * Torna markup grezzo perché Leaflet vuole una stringa HTML nel divIcon.
 *
 * Disegnate sulla struttura reale — ruote col battistrada, manubrio con leve
 * e manopole, pedali sfalsati sulla rotazione della pedivella — così a colpo
 * d'occhio si riconosce il mezzo e non un simbolo generico.
 */
export function vehicleTopDownSvg(vehicle: VehicleProfile) {
  return `<svg class="topdown-vehicle tdv-${vehicle}" viewBox="0 0 44 64" aria-hidden="true">${shapes[vehicle]}</svg>`
}

const roadBike = `
  <!-- ruote per prime: telaio e sella devono stare sopra, come nella vista dall'alto vera -->
  <rect class="tdv-wheel" x="20.5" y="3" width="3" height="16.5" rx="1.5"/>
  <path class="tdv-tread" d="${tread(20.5, 3, 3, 16.5, 9)}"/>
  <rect class="tdv-wheel" x="20.5" y="44" width="3" height="17" rx="1.5"/>
  <path class="tdv-tread" d="${tread(20.5, 44, 3, 17, 9)}"/>
  <circle class="tdv-hub" cx="22" cy="57.8" r="1.4"/>
  <circle class="tdv-ring" cx="24.1" cy="57.8" r="1.9"/>
  <path class="tdv-fork" d="M20.4 51.4 21.5 56.6M25.6 51.4 24.5 56.6"/>
  <!-- forcella anteriore -->
  <path class="tdv-fork" d="M20.5 18 21.4 21.4M23.5 18 22.6 21.4"/>
  <!-- manubrio: piega continua con manopole in asse e leve rivolte avanti -->
  <path class="tdv-bar" d="M7 25.8C11.4 23.6 16.6 22.5 22 22.5s10.6 1.1 15 3.3"/>
  <rect class="tdv-grip" x="4.9" y="24.5" width="6.4" height="2.9" rx="1.45" transform="rotate(-26 8.1 25.9)"/>
  <rect class="tdv-grip" x="32.7" y="24.5" width="6.4" height="2.9" rx="1.45" transform="rotate(26 35.9 25.9)"/>
  <rect class="tdv-lever" x="11" y="18.4" width="2.3" height="6" rx="1.15" transform="rotate(-16 12.2 21.4)"/>
  <rect class="tdv-lever" x="30.7" y="18.4" width="2.3" height="6" rx="1.15" transform="rotate(16 31.8 21.4)"/>
  <!-- attacco e tubo orizzontale -->
  <rect class="tdv-stem" x="20.9" y="20.8" width="2.2" height="4.8" rx=".9"/>
  <path class="tdv-body" d="M21 25h2l1.1 17.6h-4.2Z"/>
  <!-- pedivelle e pedali, sfalsati come in rotazione -->
  <path class="tdv-crank" d="M21.2 42.6 15 39.7M22.8 42.6l6.2 2.9"/>
  <rect class="tdv-pedal" x="10.2" y="37.2" width="5.6" height="3.5" rx=".9" transform="rotate(-14 13 39)"/>
  <rect class="tdv-pedal" x="28.2" y="43.6" width="5.6" height="3.5" rx=".9" transform="rotate(-14 31 45.4)"/>
  <circle class="tdv-ring" cx="22" cy="42.6" r="2.8"/>
  <circle class="tdv-hub" cx="22" cy="42.6" r=".9"/>
  <path class="tdv-chain" d="M24.2 44 24.2 56.6"/>
  <!-- sella stretta: la ruota posteriore resta ben visibile sotto -->
  <path class="tdv-saddle" d="M22 44.2c1.4 0 2.5 1.9 2.9 4.3.5 2.8-.4 5.2-2.9 5.2s-3.4-2.4-2.9-5.2c.4-2.4 1.5-4.3 2.9-4.3Z"/>
  <path class="tdv-seatline" d="M22 45.2v7.4"/>
`

const velomobile = `
  <!-- guscio a goccia: muso appuntito, sezione massima avanti, coda affusolata -->
  <path class="tdv-shell" d="M22 1.2c3.4 0 6.6 4.2 8.4 10.4 1.7 5.8 2.4 12.4 2.4 18.6 0 7.6-.9 15.4-2.9 21.4-1.7 5.2-4.6 8.6-7.9 8.6s-6.2-3.4-7.9-8.6c-2-6-2.9-13.8-2.9-21.4 0-6.2.7-12.8 2.4-18.6C15.4 5.4 18.6 1.2 22 1.2Z"/>
  <!-- carenature ruote anteriori, al punto piu' largo -->
  <path class="tdv-fairing" d="M11.4 21.6c-2.6.5-3.9 3-3.9 7s1.3 6.5 3.9 7Z"/>
  <path class="tdv-fairing" d="M32.6 21.6c2.6.5 3.9 3 3.9 7s-1.3 6.5-3.9 7Z"/>
  <!-- carenature ruota posteriore -->
  <path class="tdv-fairing" d="M13.6 44.4c-1.9.5-2.8 2.2-2.8 4.6s.9 4.1 2.8 4.6Z"/>
  <path class="tdv-fairing" d="M30.4 44.4c1.9.5 2.8 2.2 2.8 4.6s-.9 4.1-2.8 4.6Z"/>
  <!-- capottina scura, spostata in avanti -->
  <path class="tdv-canopy" d="M22 12.4c4.2 0 7.2 5.4 7.2 13.4S26.2 39.4 22 39.4s-7.2-5.6-7.2-13.6S17.8 12.4 22 12.4Z"/>
  <!-- pilota intravisto sotto il plexiglass -->
  <path class="tdv-cockpit" d="M18.8 27.6h6.4v8.2c0 1.2-1 2-3.2 2s-3.2-.8-3.2-2Z"/>
  <path class="tdv-cockpit" d="M17.6 19.8h8.8v1.5h-8.8Z"/>
  <rect class="tdv-cockpit" x="21.2" y="20.6" width="1.6" height="4.4" rx=".6"/>
  <!-- riflesso sul guscio e sul plexiglass -->
  <path class="tdv-gloss" d="M18.4 4.8c-1.9 3.4-3.1 9-3.4 15.2-.3 6.6 0 13.4.9 18.8-2.1-5.6-2.9-12.6-2.6-19.4.3-6.4 2-11.8 5.1-14.6Z"/>
  <path class="tdv-glint" d="M17.6 17.6c.4-2.6 1.4-4.6 2.6-5.6-2 2.4-2.9 6.4-2.9 11 0 3.4.4 6.4 1.1 8.6-1-2.8-1.4-6.2-1.4-9.6 0-1.6.2-3.1.6-4.4Z"/>
  <!-- luci di muso e coda -->
  <rect class="tdv-lamp" x="21.2" y="3.6" width="1.6" height="4.2" rx=".8"/>
  <rect class="tdv-tail" x="21.2" y="54.4" width="1.6" height="4" rx=".8"/>
`

const trike = `
  <!-- due ruote anteriori: e' la traccia larga a rendere riconoscibile il tadpole -->
  <rect class="tdv-wheel" x="3.4" y="11" width="4.2" height="14" rx="2.1"/>
  <path class="tdv-tread" d="${tread(3.4, 11, 4.2, 14, 7)}"/>
  <rect class="tdv-wheel" x="36.4" y="11" width="4.2" height="14" rx="2.1"/>
  <path class="tdv-tread" d="${tread(36.4, 11, 4.2, 14, 7)}"/>
  <rect class="tdv-wheel" x="20.4" y="44" width="3.2" height="18" rx="1.6"/>
  <path class="tdv-tread" d="${tread(20.4, 44, 3.2, 18, 9)}"/>
  <circle class="tdv-hub" cx="22" cy="57" r="1.5"/>
  <circle class="tdv-ring" cx="24.2" cy="57" r="2"/>
  <!-- assale anteriore e puntoni -->
  <path class="tdv-body" d="M5 16.6h34v2.2H5Z"/>
  <path class="tdv-fork" d="M8.4 18.6 18 24.4M35.6 18.6 26 24.4"/>
  <!-- boom con corona e pedali davanti all'assale -->
  <path class="tdv-body" d="M20.9 5.4h2.2v11.4h-2.2Z"/>
  <path class="tdv-crank" d="M21.2 8 15.4 5.2M22.8 8l5.8 2.8"/>
  <rect class="tdv-pedal" x="10.4" y="2.6" width="5.8" height="3.8" rx=".9"/>
  <rect class="tdv-pedal" x="27.8" y="8.4" width="5.8" height="3.8" rx=".9"/>
  <circle class="tdv-ring" cx="22" cy="8" r="3"/>
  <circle class="tdv-hub" cx="22" cy="8" r=".9"/>
  <path class="tdv-chain" d="M23 10.8 23.4 44"/>
  <!-- manubri sotto sedile -->
  <path class="tdv-bar" d="M14.6 25.6c-.9 2-1.3 4.2-1.3 6.6M29.4 25.6c.9 2 1.3 4.2 1.3 6.6"/>
  <rect class="tdv-grip" x="12.2" y="30.4" width="2.4" height="5.4" rx="1.2"/>
  <rect class="tdv-grip" x="29.4" y="30.4" width="2.4" height="5.4" rx="1.2"/>
  <!-- sedile reclinato: seduta stretta con schienale e poggiatesta -->
  <path class="tdv-seat" d="M22 22.6c3.4 0 5.2 1.6 5.2 4.4v15.6c0 3-1.9 4.6-5.2 4.6s-5.2-1.6-5.2-4.6V27c0-2.8 1.8-4.4 5.2-4.4Z"/>
  <path class="tdv-seatback" d="M18.4 29.4h7.2v12.4c0 1.6-1.2 2.5-3.6 2.5s-3.6-.9-3.6-2.5Z"/>
  <path class="tdv-mesh" d="M18.8 32.2h6.4M18.8 35h6.4M18.8 37.8h6.4M18.8 40.6h6.4"/>
  <path class="tdv-seatback" d="M22 22.8c2 0 3.2 1 3.2 2.6s-1.2 2.4-3.2 2.4-3.2-.9-3.2-2.4 1.2-2.6 3.2-2.6Z"/>
`

const recumbent = `
  <!-- ruota anteriore piccola davanti, posteriore grande dietro -->
  <rect class="tdv-wheel" x="20.7" y="12" width="2.6" height="12.5" rx="1.3"/>
  <path class="tdv-tread" d="${tread(20.7, 12, 2.6, 12.5, 7)}"/>
  <rect class="tdv-wheel" x="20.4" y="43" width="3.2" height="19" rx="1.6"/>
  <path class="tdv-tread" d="${tread(20.4, 43, 3.2, 19, 10)}"/>
  <circle class="tdv-hub" cx="22" cy="57.5" r="1.5"/>
  <circle class="tdv-ring" cx="24.2" cy="57.5" r="2"/>
  <!-- boom lungo con corona e pedali sporgenti davanti alla ruota -->
  <path class="tdv-body" d="M21 3.6h2v9.6h-2Z"/>
  <path class="tdv-crank" d="M21.2 6.2 15.8 3.6M22.8 6.2l5.4 2.6"/>
  <rect class="tdv-pedal" x="11" y="1.2" width="5.6" height="3.6" rx=".9"/>
  <rect class="tdv-pedal" x="27.4" y="6.8" width="5.6" height="3.6" rx=".9"/>
  <circle class="tdv-ring" cx="22" cy="6.2" r="2.8"/>
  <circle class="tdv-hub" cx="22" cy="6.2" r=".9"/>
  <path class="tdv-chain" d="M23 8.8 23.4 43"/>
  <!-- forcella e manubrio stretto -->
  <path class="tdv-fork" d="M20 22.4 21.4 25.4M24 22.4 22.6 25.4"/>
  <path class="tdv-bar" d="M15.6 27.4c2.1-1 4.3-1.5 6.4-1.5s4.3.5 6.4 1.5"/>
  <rect class="tdv-grip" x="12.4" y="26.5" width="5.4" height="2.6" rx="1.3" transform="rotate(-22 15.1 27.8)"/>
  <rect class="tdv-grip" x="26.2" y="26.5" width="5.4" height="2.6" rx="1.3" transform="rotate(22 28.9 27.8)"/>
  <!-- telaio verso il sedile -->
  <path class="tdv-body" d="M21.1 25.4h1.8l.6 6.4h-3Z"/>
  <!-- sedile basso e lungo, tipico della lowracer -->
  <path class="tdv-seat" d="M22 29c3 0 4.6 1.5 4.6 4v15.4c0 2.8-1.7 4.3-4.6 4.3s-4.6-1.5-4.6-4.3V33c0-2.5 1.6-4 4.6-4Z"/>
  <path class="tdv-seatback" d="M18.8 35h6.4v12.6c0 1.5-1.1 2.3-3.2 2.3s-3.2-.8-3.2-2.3Z"/>
  <path class="tdv-mesh" d="M19.2 37.6h5.6M19.2 40.2h5.6M19.2 42.8h5.6M19.2 45.4h5.6"/>
`

const shapes: Record<VehicleProfile, string> = { road: roadBike, trike, recumbent, velomobile }
