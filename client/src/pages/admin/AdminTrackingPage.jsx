import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { updateTrackingVehicle } from "../../api/adminApi";
import { getRealtimeSocket } from "../../api/realtime";
import { StateNotice } from "../../components/StateNotice";
import { usePanelData } from "../../hooks/usePanelData";
import { AdminWorkspaceLayout } from "./AdminWorkspaceLayout";
import { MOVEMENT_META, TrackingMap } from "./tracking/TrackingMap";
import "./AdminTrackingPage.css";

const REFRESH_MS = 30000;

const VEHICLE_STATUS = [
  { value: "available", label: "Available" },
  { value: "planned", label: "Planned" },
  { value: "in_transit", label: "In transit" },
  { value: "maintenance", label: "Maintenance" },
  { value: "stopped", label: "Stopped" }
];

// Summary cards double as filters; keys match the backend operationalSummary keys.
const SUMMARY_ORDER = ["all", "moving", "stopped", "assigned", "available", "offroad", "offline", "unauthorised"];
const SUMMARY_LABEL = {
  all: "All trucks",
  moving: "Moving",
  stopped: "Stopped on duty",
  assigned: "Assigned",
  available: "Available",
  offroad: "Off road",
  offline: "Tracking offline",
  unauthorised: "Moving without job"
};

const ukClock = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Europe/London" });

function googleMapsUrl(truck) {
  return `https://www.google.com/maps/search/?api=1&query=${truck.latitude},${truck.longitude}`;
}

function pingText(minutes) {
  if (minutes == null) return "Never";
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} h ago`;
  return `${Math.floor(minutes / 1440)} days ago`;
}

function exportCsv(name, rows) {
  const csv = rows
    .map(row => row.map(value => `"${String(value ?? "").replaceAll('"', '""')}"`).join(","))
    .join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

// Backend sends "Stopped On Duty"; show sentence case, keep the original as the colour key.
function stateLabel(state = "") {
  return state.charAt(0) + state.slice(1).toLowerCase();
}

function MovementBadge({ state }) {
  const meta = MOVEMENT_META[state] || MOVEMENT_META.Parked;
  return <span className={`tk-badge ${meta.tone}`}><i style={{ background: meta.color }} />{stateLabel(state)}</span>;
}

export function AdminTrackingPage() {
  // Polling is owned here (not by the hook) so "Pause" really pauses: hook poll off, our timer + socket gated.
  const { data, error, loading, refetch } = usePanelData("/api/admin/tracking", 0);
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [summaryFilter, setSummaryFilter] = useState("all");
  const [riskFilter, setRiskFilter] = useState("");
  const [selectedTruckId, setSelectedTruckId] = useState(null);
  const [actionError, setActionError] = useState("");
  const [savingId, setSavingId] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);
  const autoRefreshRef = useRef(autoRefresh);
  autoRefreshRef.current = autoRefresh;
  const mapRef = useRef(null);

  const allTrucks = useMemo(() => data?.trucks || [], [data]);
  const summary = useMemo(() => {
    const byKey = new Map((data?.operationalSummary || []).map(item => [item.key, item]));
    return SUMMARY_ORDER
      .map(key => ({ key, label: SUMMARY_LABEL[key], value: Number(byKey.get(key)?.value || 0), tone: byKey.get(key)?.tone || "neutral" }))
      .filter(item => item.key !== "unauthorised" || item.value > 0);
  }, [data]);

  const trucks = useMemo(() => {
    const query = search.trim().toLowerCase();
    return allTrucks.filter(truck => {
      if (summaryFilter === "moving" && truck.movementState !== "Moving") return false;
      if (summaryFilter === "unauthorised" && truck.movementState !== "Moving Without Duty") return false;
      if (summaryFilter === "stopped" && truck.movementState !== "Stopped On Duty") return false;
      if (summaryFilter === "assigned" && truck.movementState !== "Assigned") return false;
      if (summaryFilter === "available" && (truck.rawStatus !== "available" || truck.tripId)) return false;
      if (summaryFilter === "offroad" && !["maintenance", "stopped"].includes(truck.rawStatus)) return false;
      if (summaryFilter === "offline" && truck.movementState !== "Tracking Offline") return false;
      if (riskFilter === "eta" && !truck.etaRisk) return false;
      if (riskFilter === "speed" && !truck.overspeed) return false;
      if (riskFilter === "nogps" && truck.hasGps) return false;
      if (riskFilter === "driver" && truck.driver !== "Unassigned") return false;
      if (!query) return true;
      return [truck.truck, truck.driver, truck.location, truck.fleetCode, truck.model, truck.trailerCode, truck.trailerReg, truck.tripCode]
        .some(value => String(value || "").toLowerCase().includes(query));
    });
  }, [allTrucks, riskFilter, search, summaryFilter]);

  const selectedTruck = allTrucks.find(truck => truck.id === selectedTruckId) || null;
  const hasFilters = Boolean(search || riskFilter || summaryFilter !== "all");
  const freshCount = allTrucks.filter(truck => truck.hasGps && !truck.stale).length;
  const exceptions = data?.exceptions || [];

  useEffect(() => {
    if (data) setLastUpdatedAt(new Date());
  }, [data]);

  // Pick the first truck with a position once data arrives.
  useEffect(() => {
    if (selectedTruckId == null) {
      const first = allTrucks.find(truck => truck.hasGps);
      if (first) setSelectedTruckId(first.id);
    }
  }, [allTrucks, selectedTruckId]);

  useEffect(() => {
    const socket = getRealtimeSocket();
    function handleLocationUpdate() {
      if (autoRefreshRef.current) refetch(false);
    }
    socket.connect();
    socket.emit("admin-tracking:join");
    socket.on("driver-location:updated", handleLocationUpdate);
    return () => {
      socket.off("driver-location:updated", handleLocationUpdate);
      socket.emit("admin-tracking:leave");
    };
  }, [refetch]);

  useEffect(() => {
    if (!autoRefresh) return undefined;
    const timer = window.setInterval(() => refetch(false), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [autoRefresh, refetch]);

  function clearFilters() {
    setSearch("");
    setSummaryFilter("all");
    setRiskFilter("");
  }

  function selectOnMap(id) {
    setSelectedTruckId(id);
    mapRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  // Sends only the status: location and GPS stay whatever the driver's device last reported.
  async function changeStatus(truck, nextStatus) {
    if (nextStatus === truck.rawStatus) return;
    setActionError("");
    setSavingId(truck.id);
    try {
      await updateTrackingVehicle(truck.id, { status: nextStatus });
      refetch(false);
    } catch (err) {
      setActionError(err?.response?.data?.message || "Vehicle status could not be updated.");
    } finally {
      setSavingId(null);
    }
  }

  function exportTracking() {
    exportCsv("live-tracking-register.csv", [
      ["Vehicle", "Fleet code", "Driver", "Status", "Movement", "Location", "Latitude", "Longitude", "Speed km/h", "Last ping minutes", "Job", "ETA", "Risk"],
      ...trucks.map(truck => [
        truck.truck, truck.fleetCode, truck.driver, truck.status, truck.movementState, truck.location,
        truck.latitude, truck.longitude, truck.speedValue, truck.lastPingMinutes, truck.tripCode, truck.etaRaw,
        [truck.stale ? "Stale ping" : "", truck.etaRisk ? "ETA risk" : "", truck.overspeed ? "Speed risk" : ""].filter(Boolean).join("; ")
      ])
    ]);
  }

  return (
    <AdminWorkspaceLayout
      badge="GPS / live tracking"
      title="Live tracking"
      highlights={[]}
      hideHeaderIntro
      className="tracking-page-shell"
    >
      <div className="tk-command-bar">
        <div className="tk-live">
          <span className={`tk-live-dot${autoRefresh ? " on" : ""}`} aria-hidden="true" />
          <div>
            <strong>{autoRefresh ? "Live" : "Paused"}</strong>
            <small>
              {lastUpdatedAt ? `Updated ${ukClock.format(lastUpdatedAt)}` : "Loading…"}
              {autoRefresh ? " · refreshes every 30 s" : " · live updates paused"}
            </small>
          </div>
        </div>
        <div className="tk-gps-health" title="Trucks that reported a position in the last 15 minutes">
          <span>GPS fresh</span>
          <strong>{freshCount} of {allTrucks.length}</strong>
          <span className="tk-meter"><span style={{ width: `${allTrucks.length ? (freshCount / allTrucks.length) * 100 : 0}%` }} /></span>
        </div>
        <div className="tk-actions">
          <button className="tk-btn subtle" type="button" onClick={() => setAutoRefresh(value => !value)}>
            {autoRefresh ? "Pause" : "Resume"}
          </button>
          <button className="tk-btn subtle" type="button" onClick={() => refetch(false)}>Refresh</button>
          <button className="tk-btn subtle" type="button" onClick={exportTracking}>Export</button>
        </div>
      </div>

      <StateNotice loading={loading && !data} error={error} />
      {actionError && <p className="tk-note danger" role="alert">{actionError}</p>}

      <div className="tk-summary" aria-label="Fleet movement">
        {summary.map(item => (
          <button
            key={item.key}
            className={`tk-summary-card ${item.key}${summaryFilter === item.key ? " active" : ""}${item.key === "unauthorised" ? " alarm" : ""}`}
            type="button"
            aria-pressed={summaryFilter === item.key}
            onClick={() => setSummaryFilter(item.key)}
          >
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </button>
        ))}
      </div>

      <section className="tk-main" ref={mapRef}>
        <div className="tk-card tk-map-card">
          <TrackingMap trucks={trucks} selectedId={selectedTruckId} onSelect={setSelectedTruckId} />
          <div className="tk-legend" aria-label="Map legend">
            {["Moving", "Stopped On Duty", "Assigned", "Parked", "Off Road", "Tracking Offline"].map(state => (
              <span key={state}><i style={{ background: MOVEMENT_META[state].color }} />{stateLabel(state)}</span>
            ))}
          </div>
        </div>

        <aside className="tk-card tk-side">
          {selectedTruck ? (
            <div className="tk-selected">
              <div className="tk-selected-head">
                <span className="tk-plate large">{selectedTruck.truck}</span>
                <MovementBadge state={selectedTruck.movementState} />
              </div>
              <p className="tk-selected-model">{[selectedTruck.model, selectedTruck.fleetCode].filter(Boolean).join(" · ")}</p>
              <dl className="tk-facts">
                <div><dt>Driver</dt><dd>{selectedTruck.driver}</dd></div>
                <div><dt>Speed</dt><dd className={selectedTruck.overspeed ? "danger" : ""}>{selectedTruck.speed}</dd></div>
                <div><dt>Last ping</dt><dd className={selectedTruck.stale ? "warning" : ""}>{pingText(selectedTruck.lastPingMinutes)}</dd></div>
                <div><dt>Accuracy</dt><dd>{selectedTruck.hasGps ? selectedTruck.accuracyLabel : "—"}</dd></div>
                <div className="wide"><dt>Location</dt><dd>{selectedTruck.location}</dd></div>
                <div className="wide">
                  <dt>Job</dt>
                  <dd>
                    {selectedTruck.tripCode
                      ? <>{selectedTruck.tripCode} · ETA {selectedTruck.eta}{selectedTruck.etaRisk && <span className="tk-flag danger">ETA passed</span>}</>
                      : "No job"}
                  </dd>
                </div>
              </dl>
              <label className="tk-field">
                <span>Vehicle status</span>
                <select
                  className="tk-input"
                  value={selectedTruck.rawStatus}
                  disabled={savingId === selectedTruck.id}
                  onChange={e => changeStatus(selectedTruck, e.target.value)}
                >
                  {VEHICLE_STATUS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
              </label>
              <div className="tk-selected-actions">
                <button className="tk-btn primary" type="button" onClick={() => navigate(`/admin/tracking/vehicles/${selectedTruck.id}`)}>Vehicle detail</button>
                {selectedTruck.hasGps && (
                  <a className="tk-btn" href={googleMapsUrl(selectedTruck)} rel="noreferrer" target="_blank">Google Maps</a>
                )}
              </div>
            </div>
          ) : (
            <p className="tk-empty">Select a truck on the map or in the list.</p>
          )}

          <div className="tk-side-list-head">
            <h2>Trucks</h2>
            <span>{trucks.length}</span>
          </div>
          <ul className="tk-side-list">
            {trucks.map(truck => {
              const meta = MOVEMENT_META[truck.movementState] || MOVEMENT_META.Parked;
              return (
                <li key={truck.id}>
                  <button
                    className={truck.id === selectedTruckId ? "active" : ""}
                    type="button"
                    onClick={() => setSelectedTruckId(truck.id)}
                  >
                    <i style={{ background: meta.color }} aria-hidden="true" />
                    <span className="tk-side-main">
                      <strong>{truck.truck}</strong>
                      <small>{truck.driver}</small>
                    </span>
                    <span className="tk-side-meta">
                      <span>{stateLabel(truck.movementState)}</span>
                      <small>{truck.hasGps ? pingText(truck.lastPingMinutes) : "No GPS"}</small>
                    </span>
                  </button>
                </li>
              );
            })}
            {!loading && trucks.length === 0 && <li className="tk-empty">No trucks match these filters.</li>}
          </ul>
        </aside>
      </section>

      <section className="tk-lower">
        <div className="tk-card">
          <div className="tk-toolbar">
            <label className="tk-search">
              <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="9" cy="9" r="5.5" /><path d="m13 13 3.5 3.5" /></svg>
              <input type="search" placeholder="Search registration, driver, location, job or trailer" value={search} onChange={e => setSearch(e.target.value)} />
            </label>
            <select className="tk-input tk-select" aria-label="Risk" value={riskFilter} onChange={e => setRiskFilter(e.target.value)}>
              <option value="">All trucks</option>
              <option value="eta">ETA passed</option>
              <option value="speed">Over 90 km/h</option>
              <option value="nogps">No GPS</option>
              <option value="driver">No driver</option>
            </select>
            <button className="tk-btn subtle" type="button" disabled={!hasFilters} onClick={clearFilters}>Clear filters</button>
          </div>
          <div className="tk-table-shell">
            <table className="tk-table">
              <thead>
                <tr>
                  <th>Vehicle</th>
                  <th>Driver</th>
                  <th>Movement</th>
                  <th className="num">Speed</th>
                  <th>Last ping</th>
                  <th>Job</th>
                  <th>Status</th>
                  <th aria-label="Open" />
                </tr>
              </thead>
              <tbody>
                {trucks.map(truck => (
                  <tr
                    key={truck.id}
                    className={truck.id === selectedTruckId ? "selected" : ""}
                    tabIndex={0}
                    onClick={() => selectOnMap(truck.id)}
                    onKeyDown={e => { if (e.key === "Enter") selectOnMap(truck.id); }}
                  >
                    <td>
                      <div className="tk-asset">
                        <span className="tk-plate">{truck.truck}</span>
                        <small>{truck.model || truck.fleetCode}</small>
                      </div>
                    </td>
                    <td className={truck.driver === "Unassigned" ? "tk-muted" : ""}>{truck.driver}</td>
                    <td><MovementBadge state={truck.movementState} /></td>
                    <td className={`num${truck.overspeed ? " danger" : ""}`}>{truck.speed}</td>
                    <td>
                      <span className={truck.stale ? "tk-warn" : ""}>{truck.hasGps ? pingText(truck.lastPingMinutes) : "No GPS"}</span>
                      <small className="tk-cell-sub" title={truck.location}>{truck.location}</small>
                    </td>
                    <td>
                      {truck.tripCode ? (
                        <>
                          <span className="tk-job">{truck.tripCode}</span>
                          <small className={`tk-cell-sub${truck.etaRisk ? " danger" : ""}`}>ETA {truck.eta}{truck.etaRisk ? " · passed" : ""}</small>
                        </>
                      ) : <span className="tk-muted">No job</span>}
                    </td>
                    <td className="tk-status-cell">{truck.status}</td>
                    <td className="tk-open-cell">
                      <button
                        className="tk-icon-btn"
                        type="button"
                        aria-label={`Open ${truck.truck} detail`}
                        onClick={e => { e.stopPropagation(); navigate(`/admin/tracking/vehicles/${truck.id}`); }}
                      >›</button>
                    </td>
                  </tr>
                ))}
                {!loading && trucks.length === 0 && (
                  <tr className="tk-empty-row">
                    <td colSpan="8">
                      {hasFilters ? "No trucks match these filters." : "No vehicles are registered for tracking yet."}
                      {hasFilters && <button className="tk-link-btn" type="button" onClick={clearFilters}>Clear filters</button>}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="tk-card tk-exceptions">
          <div className="tk-card-head">
            <h2>Needs attention</h2>
            <span className="tk-count">{exceptions.length}</span>
          </div>
          {exceptions.length ? (
            <ul>
              {exceptions.map((item, index) => (
                <li key={`${item.vehicleId || "alert"}-${item.title}-${index}`} className={item.tone}>
                  <button
                    type="button"
                    disabled={!item.vehicleId}
                    onClick={() => item.vehicleId && selectOnMap(item.vehicleId)}
                  >
                    <strong>{item.title}</strong>
                    <small>{item.description}</small>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            !loading && <p className="tk-empty">No stale pings, ETA risks or failed deliveries right now.</p>
          )}
        </div>
      </section>
    </AdminWorkspaceLayout>
  );
}
