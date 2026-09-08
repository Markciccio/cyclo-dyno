import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { ChallengeId, VehicleProfile } from "../types";
import { monzaGhost, vehicles } from "../logic/challenges";
const places = {
  monza: {
    center: [45.6208, 9.2856] as L.LatLngExpression,
    zoom: 16,
    label: "AUTODROMO DI MONZA",
  },
  velodrome: {
    center: [45.712194, 8.513028] as L.LatLngExpression,
    zoom: 18,
    label: "GATTICO RUGBY · VELODROMO",
  },
};
export function TrackMap({
  challenge,
  progress,
  elapsedSeconds,
}: {
  challenge: ChallengeId;
  progress: number;
  elapsedSeconds: number;
}) {
  const holder = useRef<HTMLDivElement>(null),
    map = useRef<L.Map>(),
    marker = useRef<L.Marker>(),
    [vehicle, setVehicle] = useState<VehicleProfile>("road"),
    place = places[challenge as "monza" | "velodrome"];
  const isMonza = challenge === "monza";
  const ghostTarget = Math.min(monzaGhost.timeSeconds, progress * monzaGhost.timeSeconds);
  const delta = elapsedSeconds - ghostTarget;
  const deltaLabel = delta <= 0 ? `${Math.abs(delta).toFixed(1)} s DAVANTI` : `${delta.toFixed(1)} s DIETRO`;
  useEffect(() => {
    if (!holder.current || !place) return;
    const instance = L.map(holder.current, {
      zoomControl: false,
      attributionControl: true,
      dragging: true,
      scrollWheelZoom: false,
    }).setView(place.center, place.zoom);
    L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      { attribution: "Tiles © Esri" },
    ).addTo(instance);
    L.control.zoom({ position: "bottomleft" }).addTo(instance);
    map.current = instance;
    return () => {
      instance.remove();
    };
  }, [challenge, place]);
  useEffect(() => {
    if (!map.current || !place) return;
    marker.current?.remove();
    const icon = L.divIcon({
      className: "vehicle-marker",
      html: `<div class="vehicle-shape ${vehicle}">${vehicle === "velomobile" ? "◖" : "●"}</div>`,
      iconSize: [50, 50],
      iconAnchor: [25, 25],
    });
    marker.current = L.marker(place.center, { icon }).addTo(map.current);
  }, [vehicle, challenge, place]);
  if (challenge === "dyno" || !place) return null;
  return (
    <section className="satellite-track">
      <div className="satellite-title">
        <span>LIVE DRONE</span>
        <b>{place.label}</b>
        <em>{(progress * 100).toFixed(1)}% LAP</em>
      </div>
      <div ref={holder} className="satellite-map" />
      {isMonza && (
        <div className={`ghost-panel ${delta <= 0 ? "ahead" : "behind"}`}>
          <span>◌ GHOST · {monzaGhost.vehicle.toUpperCase()}</span>
          <b>{monzaGhost.name} · {monzaGhost.displayTime}</b>
          <small>{monzaGhost.averageKmh} km/h · {monzaGhost.averageWatts} W</small>
          <strong>{deltaLabel}</strong>
          <small>PR segmento senza prima chicane: 5:52</small>
        </div>
      )}
      <aside className="vehicle-switch">
        {(Object.keys(vehicles) as VehicleProfile[]).map((id) => (
          <button
            onClick={() => setVehicle(id)}
            className={vehicle === id ? "active" : ""}
            key={id}
          >
            <strong>
              {id === "velomobile" ? "◖" : id === "trike" ? "△" : "●"}
            </strong>
            <span>{vehicles[id].label}</span>
            <small>{vehicles[id].referenceKmh} km/h @250W</small>
          </button>
        ))}
      </aside>
      <p className="satellite-note">
        Satellite © Esri · veicolo simulato: {vehicles[vehicle].label}
      </p>
    </section>
  );
}
