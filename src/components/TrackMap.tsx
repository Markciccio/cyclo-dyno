import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { ChallengeId, GhostChoice, VehicleProfile } from "../types";
import { sectorName, vehicles } from "../logic/challenges";
import { GhostMenu } from "./GhostMenu";
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
  vehicle,
  onVehicleChange,
  ghost,
  ghostMeters,
  ghostVehicle,
  ghostName,
  bestLabel,
  onGhostChange,
  running,
}: {
  challenge: ChallengeId;
  /** Distanza percorsa in metri: è ciò che posiziona il mezzo sul tracciato. */
  meters: number;
  vehicle: VehicleProfile;
  onVehicleChange: (vehicle: VehicleProfile) => void;
  /** Chi corre accanto: nessuno finché non lo si sceglie dal menù. */
  ghost: GhostChoice;
  /** Distanza del ghost in metri, assente se non ce n'è uno. */
  ghostMeters?: number;
  ghostVehicle: VehicleProfile;
  ghostName: string;
  bestLabel?: string;
  onGhostChange: (choice: GhostChoice) => void;
  running: boolean;
}) {
  const holder = useRef<HTMLDivElement>(null),
    map = useRef<L.Map>(),
    marker = useRef<L.Marker>(),
    ghostMarker = useRef<L.Marker>();
  const track = hasTrack(challenge) ? getTrack(challenge) : undefined;
  const here = track ? sampleTrack(track, meters) : undefined;

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
    L.control.zoom({ position: "topleft" }).addTo(instance);
    instance.fitBounds(L.latLngBounds(line), { padding: [24, 24] });
    map.current = instance;
    return () => {
      instance.remove();
      map.current = undefined;
      marker.current = undefined;
      ghostMarker.current = undefined;
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
    if (!map.current || !track || ghost === "none") return;
    ghostMarker.current?.remove();
    ghostMarker.current = L.marker([track.points[0].lat, track.points[0].lon], {
      zIndexOffset: 400,
      icon: L.divIcon({ className: `ghost-marker ${ghost === "best" ? "record" : "rival"}`, html: vehicleTopDownSvg(ghostVehicle), iconSize: [40, 44], iconAnchor: [20, 22] }),
    }).addTo(map.current);
    return () => {
      ghostMarker.current?.remove();
      ghostMarker.current = undefined;
    };
  }, [ghost, ghostVehicle, track]);

  // Aggiornamento della posizione a ogni campione: sposta e ruota, non ridisegna.
  useEffect(() => {
    if (!marker.current || !track || !here) return;
    marker.current.setLatLng([here.lat, here.lon]);
    const svg = marker.current.getElement()?.firstElementChild as HTMLElement | undefined;
    if (svg) svg.style.transform = `rotate(${here.bearing}deg)`;
    if (running) map.current?.setView([here.lat, here.lon], map.current.getZoom(), { animate: false });
  }, [here?.lat, here?.lon, here?.bearing, running, track]);

  useEffect(() => {
    if (!ghostMarker.current || !track || ghostMeters === undefined) return;
    const point = sampleTrack(track, ghostMeters);
    ghostMarker.current.setLatLng([point.lat, point.lon]);
    const svg = ghostMarker.current.getElement()?.firstElementChild as HTMLElement | undefined;
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
  const gap = ghostMeters === undefined ? undefined : meters - ghostMeters;

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
        {gap !== undefined && (
          <div className={`rival-panel ${gap >= 0 ? "ahead" : "behind"}`}>
            <span>{ghostName}</span>
            <strong>
              {gap >= 0 ? "+" : "−"}
              {Math.abs(gap) >= 1000 ? `${(Math.abs(gap) / 1000).toFixed(2)} km` : `${Math.abs(gap).toFixed(0)} m`}
            </strong>
            <small>{gap >= 0 ? "sei davanti" : "sei dietro"}</small>
          </div>
        )}
        <GhostMenu choice={ghost} onChange={onGhostChange} bestLabel={bestLabel} vehicle={vehicle} />
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
      <p className="satellite-note">Satellite © Esri · tracciato © OpenStreetMap · mezzo simulato: {vehicles[vehicle].label}</p>
    </section>
  );
}
