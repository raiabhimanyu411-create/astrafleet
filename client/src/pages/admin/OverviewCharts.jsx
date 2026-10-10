import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Validated categorical slots (dataviz palette, light surface #fff): slot 1 blue, slot 2 orange.
export const SERIES = ["#2a78d6", "#eb6834"];

function niceMax(value) {
  if (value <= 0) return 4;
  const exp = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find(m => m * exp * 4 >= value) * exp;
  return step * 4;
}

const gbpCompact = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", notation: "compact", maximumFractionDigits: 1 });
const gbpFull = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 });

export function formatGbp(value, compact = false) {
  return (compact ? gbpCompact : gbpFull).format(Number(value || 0));
}

// Column chart: one baseline, one axis, bars <=24px with a 4px rounded data end, 2px surface gap
// between stacked segments, hover tooltip per month. `series` = [{ key, label, color }].
export function ColumnChart({ data, series, formatValue = v => String(v), formatAxis = formatValue, height = 220, ariaLabel }) {
  const wrapRef = useRef(null);
  const [width, setWidth] = useState(560);
  const [hover, setHover] = useState(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(260, entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const totals = data.map(d => series.reduce((sum, s) => sum + Number(d[s.key] || 0), 0));
  const max = niceMax(Math.max(...totals, 0));
  const pad = { top: 12, right: 8, bottom: 26, left: 44 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const band = plotW / data.length;
  const barW = Math.min(24, band * 0.56);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => f * max);
  const y = v => pad.top + plotH - (v / max) * plotH;
  const empty = totals.every(t => t === 0);

  function topRoundedRect(x, yTop, w, h, r) {
    const rr = Math.min(r, h, w / 2);
    return `M${x},${yTop + h} V${yTop + rr} Q${x},${yTop} ${x + rr},${yTop} H${x + w - rr} Q${x + w},${yTop} ${x + w},${yTop + rr} V${yTop + h} Z`;
  }

  return (
    <div className="ovc-chart" ref={wrapRef}>
      <svg width={width} height={height} role="img" aria-label={ariaLabel}>
        {ticks.map(t => (
          <g key={t}>
            <line x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} className={t === 0 ? "ovc-baseline" : "ovc-grid"} />
            <text x={pad.left - 8} y={y(t) + 4} className="ovc-tick" textAnchor="end">{formatAxis(t)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = pad.left + band * i + band / 2;
          let stackTop = pad.top + plotH;
          const segments = series.map((s, si) => {
            const value = Number(d[s.key] || 0);
            if (!value) return null;
            const h = (value / max) * plotH;
            const isTop = series.slice(si + 1).every(next => !Number(d[next.key] || 0));
            const yTop = stackTop - h;
            // 2px surface gap above every segment that has another segment stacked on it.
            const drawH = isTop ? h : Math.max(0, h - 2);
            const drawTop = isTop ? yTop : yTop + 2;
            stackTop = yTop;
            return isTop
              ? <path key={s.key} d={topRoundedRect(cx - barW / 2, drawTop, barW, drawH, 4)} fill={s.color} />
              : <rect key={s.key} x={cx - barW / 2} y={drawTop} width={barW} height={drawH} fill={s.color} />;
          });
          return (
            <g key={d.month || d.label}>
              <rect
                className={`ovc-hit${hover === i ? " active" : ""}`}
                x={pad.left + band * i}
                y={pad.top}
                width={band}
                height={plotH}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              />
              {segments}
              {(band >= 34 || i % 2 === data.length % 2) && (
                <text x={cx} y={height - 8} className="ovc-tick" textAnchor="middle">{d.label}</text>
              )}
            </g>
          );
        })}
      </svg>
      {empty && <p className="ovc-empty">No activity in the last 12 months yet.</p>}
      {hover !== null && (
        <div
          className="ovc-tooltip"
          style={{ left: Math.min(width - 150, Math.max(0, pad.left + band * hover + band / 2 - 75)), top: Math.max(0, y(totals[hover]) - 64) }}
          role="status"
        >
          <strong>{data[hover].label} {data[hover].year}</strong>
          {series.map(s => (
            <span key={s.key}><i style={{ background: s.color }} />{s.label}<b>{formatValue(data[hover][s.key] || 0)}</b></span>
          ))}
        </div>
      )}
    </div>
  );
}

// Part-to-whole meter: one stacked bar with 2px gaps, every part labelled with icon-free text + count.
export function StatusMeter({ parts, total }) {
  const sum = total || parts.reduce((s, p) => s + p.value, 0);
  return (
    <div className="ovc-meter">
      <div className="ovc-meter-bar" role="img" aria-label={parts.map(p => `${p.label} ${p.value}`).join(", ")}>
        {sum === 0 && <span className="ovc-meter-empty" />}
        {parts.filter(p => p.value > 0).map(p => (
          <span key={p.label} style={{ flexGrow: p.value, background: p.color }} title={`${p.label}: ${p.value}`} />
        ))}
      </div>
      <ul className="ovc-meter-legend">
        {parts.map(p => (
          <li key={p.label}><i style={{ background: p.color }} />{p.label}<b>{p.value}</b></li>
        ))}
      </ul>
    </div>
  );
}

const MAP_STATUS = {
  in_transit: { color: "#2a78d6", label: "On the road" },
  planned: { color: "#2a78d6", label: "Planned" },
  available: { color: "#0ca30c", label: "Available" },
  maintenance: { color: "#d03b3b", label: "Off road" },
  stopped: { color: "#d03b3b", label: "Off road" }
};

export function FleetMap({ points }) {
  const elRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const key = useMemo(() => points.map(p => `${p.id}:${p.lat}:${p.lng}:${p.status}`).join("|"), [points]);

  useEffect(() => {
    if (!elRef.current || mapRef.current) return undefined;
    const map = L.map(elRef.current, { zoomControl: true, attributionControl: true, scrollWheelZoom: false }).setView([54, -2], 5);
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
      const meta = MAP_STATUS[p.status] || { color: "#616161", label: p.status };
      L.circleMarker([p.lat, p.lng], { radius: 8, color: "#ffffff", weight: 2, fillColor: meta.color, fillOpacity: 1 })
        .bindTooltip(`<strong>${p.truck}</strong><br/>${meta.label} · ${p.driver}${p.speed != null ? ` · ${p.speed} kph` : ""}${p.lastPing ? `<br/><small>Last ping ${p.lastPing}</small>` : ""}`, { direction: "top", offset: [0, -6] })
        .addTo(layer);
    });
    if (points.length === 1) map.setView([points[0].lat, points[0].lng], 12);
    if (points.length > 1) map.fitBounds(L.latLngBounds(points.map(p => [p.lat, p.lng])), { padding: [36, 36], maxZoom: 13 });
    window.setTimeout(() => map.invalidateSize(), 0);
  }, [key, points]);

  return (
    <div className="ovc-map-wrap">
      <div className="ovc-map" ref={elRef} aria-label="Live fleet map" />
      {points.length === 0 && <p className="ovc-map-empty">No vehicle has sent a GPS position yet.</p>}
    </div>
  );
}

export { MAP_STATUS };
