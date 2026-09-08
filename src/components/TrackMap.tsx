import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { ChallengeId, VehicleProfile } from "../types";
import { monzaGhost, sectorName, vehicles } from "../logic/challenges";
import { getTrack, hasTrack, sampleTrack } from "../logic/tracks";
import { VehicleIcon, vehicleTopDownSvg } from "./VehicleIcon";
import { TrackOutline } from "./TrackOutline";

const labels: Record<string, string> = {
  monza: "AUTODROMO DI MONZA",
  velodrome: "GATTICO · ANELLO 400 M",
  mottarone: "MOTTARONE · SALITA DA ARMENO",
};
/** Zoom di inseguimento: stretto sull'anello corto, largo sulla salita. */
const followZoom: Record<string, number> = { monza: 17, velodrome: 18, mottarone: 16 };

export function TrackMap({
  challenge,
  meters,
  elapsedSeconds,
  vehicle,
  onVehicleChange,
  rival,
  rivalMeters,
  onRivalChange,
  running,
}: {
  challenge: ChallengeId;
  /** Distanza percorsa in metri: è ciò che posiziona il mezzo sul tracciato. */
  meters: number;
  elapsedSeconds: number;
  vehicle: VehicleProfile;
  onVehicleChange: (vehicle: VehicleProfile) => void;
  /** Mezzo di confronto mosso dagli stessi watt del pilota. */
  rival: VehicleProfile;
  rivalMeters: number;
  onRivalChange: (vehicle: VehicleProfile) => void;
  running: boolean;
}) {
  const holder = useRef<HTMLDivElement>(null),
    map = useRef<L.Map>(),
    marker = useRef<L.Marker>(),
    rivalMarker = useRef<L.Marker>(),
    ghost = useRef<L.Marker>();
  const track = hasTrack(challenge) ? getTrack(challenge) : undefined;
  const isMonza = challenge === "monza";
  const here = track ? sampleTrack(track, meters) : undefined;

  const ghostMeters = isMonza && track ? (elapsedSeconds / monzaGhost.timeSeconds) * track.lengthMeters : 0;
  const delta = isMonza && track ? elapsedSeconds - (meters / track.lengthMeters) * monzaGhost.timeSeconds : 0;
  const deltaLabel = delta <= 0 ? `${Math.abs(delta).toFixed(1)} s DAVANTI` : `${delta.toFixed(1)} s DIETRO`;

  useEffect(() => {
    if (!holder.current || !track) return;
    const line = track.points.map((p) => [p.lat, p.lon] as L.LatLngExpression);
    const instance = L.map(holder.current, {
      zoomControl: false,
      attributionControl: true,
      dragging: true,
      scrollWheelZoom: false,
    });
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
      attribution: "Tiles © Esri · percorso © OpenStreetMap",
      maxZoom: 19,
    }).addTo(instance);
    // Doppio tratto: alone scuro sotto, linea accesa sopra, così si stacca dal satellite.
    L.polyline(line, { color: "#001018", weight: 9, opacity: 0.55, lineJoin: "round" }).addTo(instance);
    L.polyline(line, { color: "#5ef2c0", weight: 3, opacity: 0.95, lineJoin: "round" }).addTo(instance);
    L.circleMarker([track.points[0].lat, track.points[0].lon], {
      radius: 5,
      color: "#fff",
      weight: 2,
      fillColor: "#ff2d55",
      fillOpacity: 1,
    })
      .addTo(instance)
      .bindTooltip(track.closed ? "TRAGUARDO" : "PARTENZA", { permanent: false });
    L.control.zoom({ position: "bottomleft" }).addTo(instance);
    instance.fitBounds(L.latLngBounds(line), { padding: [24, 24] });
    map.current = instance;
    return () => {
      instance.remove();
      map.current = undefined;
      marker.current = undefined;
      rivalMarker.current = undefined;
      ghost.current = undefined;
    };
  }, [track]);

  // Il marker si ricrea solo quando cambia il mezzo: durante la prova si sposta e basta.
  useEffect(() => {
    if (!map.current || !track) return;
    marker.current?.remove();
    marker.current = L.marker([track.points[0].lat, track.points[0].lon], {
      zIndexOffset: 500,
      icon: L.divIcon({ className: "vehicle-marker", html: vehicleTopDownSvg(vehicle), iconSize: [40, 44], iconAnchor: [20, 22] }),
    }).addTo(map.current);
  }, [vehicle, track]);

  useEffect(() => {
    if (!map.current || !track) return;
    rivalMarker.current?.remove();
    rivalMarker.current = L.marker([track.points[0].lat, track.points[0].lon], {
      zIndexOffset: 400,
      icon: L.divIcon({ className: "rival-marker", html: vehicleTopDownSvg(rival), iconSize: [40, 44], iconAnchor: [20, 22] }),
    }).addTo(map.current);
  }, [rival, track]);

  useEffect(() => {
    if (!rivalMarker.current || !track) return;
    const point = sampleTrack(track, rivalMeters);
    rivalMarker.current.setLatLng([point.lat, point.lon]);
    const svg = rivalMarker.current.getElement()?.firstElementChild as HTMLElement | undefined;
    if (svg) svg.style.transform = `rotate(${point.bearing}deg)`;
  }, [rivalMeters, track]);

  useEffect(() => {
    if (!map.current || !track || !isMonza) return;
    ghost.current?.remove();
    ghost.current = L.marker([track.points[0].lat, track.points[0].lon], {
      zIndexOffset: 300,
      icon: L.divIcon({ className: "ghost-marker", html: vehicleTopDownSvg(monzaGhost.vehicle), iconSize: [40, 44], iconAnchor: [20, 22] }),
    }).addTo(map.current);
    return () => {
      ghost.current?.remove();
      ghost.current = undefined;
    };
  }, [track, isMonza]);

  // Aggiornamento della posizione a ogni campione: sposta e ruota, non ridisegna.
  useEffect(() => {
    if (!marker.current || !track || !here) return;
    marker.current.setLatLng([here.lat, here.lon]);
    const svg = marker.current.getElement()?.firstElementChild as HTMLElement | undefined;
    if (svg) svg.style.transform = `rotate(${here.bearing}deg)`;
    if (running) map.current?.setView([here.lat, here.lon], map.current.getZoom(), { animate: false });
  }, [here?.lat, here?.lon, here?.bearing, running, track]);

  useEffect(() => {
    if (!ghost.current || !track) return;
    const point = sampleTrack(track, ghostMeters);
    ghost.current.setLatLng([point.lat, point.lon]);
    const svg = ghost.current.getElement()?.firstElementChild as HTMLElement | undefined;
    if (svg) svg.style.transform = `rotate(${point.bearing}deg)`;
  }, [ghostMeters, track]);

  // All'avvio si stringe sul mezzo, alla fine si torna a inquadrare tutto il percorso.
  useEffect(() => {
    if (!map.current || !track) return;
    if (running && here) map.current.setView([here.lat, here.lon], followZoom[track.id] ?? 17, { animate: true });
    else map.current.fitBounds(L.latLngBounds(track.points.map((p) => [p.lat, p.lon] as L.LatLngExpression)), { padding: [24, 24] });
    // Solo il passaggio fermo/in corsa deve reinquadrare, non ogni spostamento.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, track]);

  if (!track) return null;
  const progress = track.closed ? (meters % track.lengthMeters) / track.lengthMeters : meters / track.lengthMeters;
  const sector = sectorName(challenge, meters % track.lengthMeters);
  const gap = meters - rivalMeters;

  return (
    <section className="satellite-track">
      <div className="satellite-title">
        <span>LIVE GPS</span>
        <b>{labels[track.id]}</b>
        <em>{(progress * 100).toFixed(1)}%</em>
      </div>
      <div className="satellite-stage">
        <div ref={holder} className="satellite-map" />
        <TrackOutline
          track={track}
          meters={meters}
          title={track.id === "mottarone" ? "MOTTARONE" : track.id === "monza" ? "MONZA" : "GATTICO"}
          subtitle={track.id === "mottarone" ? "SALITA DA ARMENO" : track.closed ? "ANELLO" : ""}
        />
        <div className="compass" aria-hidden="true">
          <span>N</span>
        </div>
        {sector && <div className="sector-flag">{sector}</div>}
        <div className={`rival-panel ${gap >= 0 ? "ahead" : "behind"}`}>
          <span>◑ STESSI WATT · {vehicles[rival].label}</span>
          <strong>
            {gap >= 0 ? "+" : "−"}
            {Math.abs(gap) >= 1000 ? `${(Math.abs(gap) / 1000).toFixed(2)} km` : `${Math.abs(gap).toFixed(0)} m`}
          </strong>
          <small>{gap >= 0 ? "sei davanti" : "sei dietro"}</small>
        </div>
        {isMonza && (
          <div className={`ghost-panel ${delta <= 0 ? "ahead" : "behind"}`}>
            <span>◌ GHOST · {monzaGhost.vehicle.toUpperCase()}</span>
            <b>
              {monzaGhost.name} · {monzaGhost.displayTime}
            </b>
            <small>
              {monzaGhost.averageKmh} km/h · {monzaGhost.averageWatts} W
            </small>
            <strong>{deltaLabel}</strong>
          </div>
        )}
      </div>
      <aside className="vehicle-switch">
        {(Object.keys(vehicles) as VehicleProfile[]).map((id) => (
          <button onClick={() => onVehicleChange(id)} className={vehicle === id ? "active" : ""} key={id}>
            <VehicleIcon vehicle={id} />
            <span>{vehicles[id].label}</span>
            <small>
              CdA <b>{vehicles[id].cda.toFixed(3).replace(".", ",")}</b>
            </small>
            <small>
              Crr <b>{vehicles[id].crr.toFixed(4).replace(".", ",")}</b>
            </small>
          </button>
        ))}
      </aside>
      <aside className="rival-switch">
        <label>SFIDANTE</label>
        {(Object.keys(vehicles) as VehicleProfile[])
          .filter((id) => id !== vehicle)
          .map((id) => (
            <button key={id} className={rival === id ? "active" : ""} onClick={() => onRivalChange(id)}>
              {vehicles[id].label}
            </button>
          ))}
      </aside>
      <p className="satellite-note">Satellite © Esri · tracciato © OpenStreetMap · mezzo simulato: {vehicles[vehicle].label}</p>
    </section>
  );
}
