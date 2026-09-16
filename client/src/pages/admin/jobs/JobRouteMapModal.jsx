import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { getJobRouteMap } from "../../../api/jobApi";
import "./JobRouteMapModal.css";

const colors = ["#2563eb", "#7c3aed", "#ea580c", "#0891b2", "#db2777"];
export default function JobRouteMapModal({ job, onClose }) {
  const container = useRef(null), dialog = useRef(null), mapRef = useRef(null), layers = useRef([]);
  const [data, setData] = useState(null), [error, setError] = useState(""), [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState(null), [tileError, setTileError] = useState(false);

  useEffect(() => {
    const previous = document.activeElement, overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.focus();
    function keydown(event) {
      if (event.key === "Escape") onClose();
      if (event.key === "Tab") {
        const targets = [...dialog.current.querySelectorAll('button, a[href], [tabindex="0"]')].filter(el => !el.disabled && el.getClientRects().length);
        const first = targets[0], last = targets.at(-1);
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }
    document.addEventListener("keydown", keydown);
    return () => { document.body.style.overflow = overflow; document.removeEventListener("keydown", keydown); previous?.focus(); };
  }, [onClose]);

  useEffect(() => {
    const abort = new AbortController(); setData(null); setError(""); setSelected(null);
    getJobRouteMap(job.id, abort.signal).then(res => setData(res.data)).catch(err => {
      if (!abort.signal.aborted) setError(err.response?.data?.message || "Route could not be loaded. Please retry.");
    });
    return () => abort.abort();
  }, [job.id, retry]);

  useEffect(() => {
    const map = L.map(container.current).setView([54, -2], 6); mapRef.current = map;
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors'
    }).on("tileerror", () => setTileError(true)).addTo(map);
    const observer = new ResizeObserver(() => map.invalidateSize()); observer.observe(container.current);
    return () => { observer.disconnect(); map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current; if (!map || !data) return;
    layers.current.forEach(layer => layer.remove()); layers.current = [];
    data.legs.forEach((leg, i) => {
      if (!leg.coordinates.length) return;
      const line = L.polyline(leg.coordinates.map(([lng, lat]) => [lat, lng]), { color: colors[i % colors.length], weight: selected === i ? 7 : 4, opacity: selected == null || selected === i ? 0.9 : 0.25, dashArray: leg.source === "straight-line" ? "8 10" : undefined }).addTo(map);
      line.on("click", () => setSelected(i)); layers.current.push(line);
    });
    const positions = [];
    data.points.forEach(point => {
      if (!point.resolved) return;
      const position = [point.latitude, point.longitude]; positions.push(position);
      const marker = L.marker(position, { icon: L.divIcon({ className: "job-route-pin", html: `<span style="background:${point.index === 0 ? "#059669" : colors[(point.index - 1) % colors.length]}">${point.index === 0 ? "C" : point.index}</span>`, iconSize: [34, 40], iconAnchor: [17, 40] }), title: `${point.label}: ${point.address}` }).addTo(map);
      const popup = document.createElement("div"); popup.textContent = `${point.label} — ${point.address}`; marker.bindPopup(popup);
      marker.on("click", () => setSelected(point.index === 0 ? 0 : point.index - 1)); layers.current.push(marker);
    });
    const chosen = selected == null ? null : data.legs[selected];
    const bounds = chosen?.coordinates.length ? chosen.coordinates.map(([lng, lat]) => [lat, lng]) : positions;
    if (bounds.length) map.fitBounds(bounds, { padding: [45, 45], maxZoom: 13 });
  }, [data, selected]);

  const unresolved = data?.points.filter(point => !point.resolved) || [];
  return createPortal(<div className="job-route-backdrop" onClick={onClose}>
    <section ref={dialog} tabIndex={-1} className="job-route-dialog" role="dialog" aria-modal="true" aria-labelledby="job-route-title" onClick={event => event.stopPropagation()}>
      <header><div><span>TRANSPORT ORDER SUMMARY</span><h2 id="job-route-title">Route map · {job.code}</h2></div><button type="button" className="header-action-button" onClick={onClose} aria-label="Close route map">✕ Close</button></header>
      <div className="job-route-body"><aside>
        <h3>Collection → delivery sequence</h3>
        <p>Choose a leg to highlight it on the map.</p>
        {!data && !error && <p role="status">Locating stops and loading route…</p>}
        {error && <div role="alert"><p>{error}</p><button type="button" className="header-action-button" onClick={() => setRetry(value => value + 1)}>Retry</button></div>}
        {data && <><button type="button" className="header-action-button" onClick={() => setSelected(null)}>Show full route</button>
          {data.legs.map((leg, i) => <button type="button" key={i} className={`job-route-leg ${selected === i ? "selected" : ""}`} style={{ "--leg-color": colors[i % colors.length] }} onClick={() => setSelected(i)} aria-pressed={selected === i}>
            <strong>Leg {i + 1} · {data.points[leg.from].label} → {data.points[leg.to].label}</strong>
            <span><b>From</b> {data.points[leg.from].address || "Address missing"}</span><span><b>To</b> {data.points[leg.to].address || "Address missing"}</span>
            <small>{leg.source === "road" ? `${leg.distanceMiles} mi · ~${leg.durationMins} min driving` : leg.source === "straight-line" ? "Dashed connection · road route unavailable" : "Location unavailable for this leg"}</small>
          </button>)}
          {unresolved.length > 0 && <p className="job-route-warning">Not located: {unresolved.map(point => point.label).join(", ")}. Check their UK postcodes, then retry. <button type="button" onClick={() => setRetry(value => value + 1)}>Retry</button></p>}
          <p className="job-route-footnote">Pins show postcode locations. Driving estimates exclude loading time and are not HGV-specific.</p>
        </>}
      </aside><div className="job-route-map-wrap"><div ref={container} className="job-route-map" aria-label="Job collection and delivery map" />{tileError && <div className="job-route-tile-warning">Map tiles could not load. Route details remain available.</div>}</div></div>
    </section>
  </div>, document.body);
}
