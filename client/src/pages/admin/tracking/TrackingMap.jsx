import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Movement state → marker colour. Status colours from the shared palette; never colour alone —
// every marker carries a tooltip with the state written out.
export const MOVEMENT_META = {
  "Moving": { color: "#0ca30c", tone: "success" },
  "Stopped On Duty": { color: "#fab219", tone: "warning" },
  "Moving Without Duty": { color: "#d03b3b", tone: "danger" },
  "Assigned": { color: "#2a78d6", tone: "info" },
  "Parked": { color: "#616161", tone: "neutral" },
  "Off Road": { color: "#d03b3b", tone: "danger" },
  "Tracking Offline": { color: "#9E9E9E", tone: "neutral" }
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

export function TrackingMap({ trucks, selectedId, onSelect }) {
  const elRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const fittedRef = useRef("");
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  const points = useMemo(() => trucks.filter(t => t.latitude != null && t.longitude != null), [trucks]);
  const key = points.map(p => `${p.id}:${p.latitude}:${p.longitude}:${p.movementState}`).join("|");

  useEffect(() => {
    if (!elRef.current || mapRef.current) return undefined;
    const map = L.map(elRef.current, { scrollWheelZoom: true }).setView([54, -2], 6);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>'
    }).addTo(map);
    mapRef.current = map;
    layerRef.current = L.layerGroup().addTo(map);
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    points.forEach(p => {
      const meta = MOVEMENT_META[p.movementState] || MOVEMENT_META.Parked;
      const selected = p.id === selectedId;
      const marker = L.circleMarker([p.latitude, p.longitude], {
        radius: selected ? 11 : 8,
        color: selected ? "#0F6CBD" : "#ffffff",
        weight: selected ? 3 : 2,
        fillColor: meta.color,
        fillOpacity: 1
      })
        .bindTooltip(
          `<strong>${escapeHtml(p.truck)}</strong><br/>${escapeHtml(p.movementState.charAt(0) + p.movementState.slice(1).toLowerCase())} · ${escapeHtml(p.driver)}<br/><small>${escapeHtml(p.note)}</small>`,
          { direction: "top", offset: [0, -8] }
        )
        .on("click", () => onSelectRef.current?.(p.id))
        .addTo(layer);
      if (selected) marker.bringToFront();
    });
    // Fit once per set of trucks so live refreshes do not keep yanking the view while someone pans.
    const fitKey = points.map(p => p.id).join(",");
    if (fitKey !== fittedRef.current) {
      fittedRef.current = fitKey;
      if (points.length === 1) map.setView([points[0].latitude, points[0].longitude], 13);
      if (points.length > 1) map.fitBounds(L.latLngBounds(points.map(p => [p.latitude, p.longitude])), { padding: [48, 48], maxZoom: 14 });
    }
    window.setTimeout(() => map.invalidateSize(), 0);
  }, [key, points, selectedId]);

  // Pan to a truck chosen from the list.
  useEffect(() => {
    const map = mapRef.current;
    const target = points.find(p => p.id === selectedId);
    if (map && target) map.panTo([target.latitude, target.longitude], { animate: true });
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="tk-map-wrap">
      <div className="tk-map" ref={elRef} aria-label="Live fleet map" />
      {points.length === 0 && (
        <p className="tk-map-empty">No truck has sent a GPS position yet. Positions appear once a driver allows location in the driver app.</p>
      )}
    </div>
  );
}
