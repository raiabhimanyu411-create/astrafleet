import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { updateTrackingVehicle } from "../../api/adminApi";
import { getRealtimeSocket } from "../../api/realtime";
import { StateNotice } from "../../components/StateNotice";
import { StatusPill } from "../../components/StatusPill";
import { usePanelData } from "../../hooks/usePanelData";
import { AdminWorkspaceLayout } from "./AdminWorkspaceLayout";

function buildMapUrl(truck) {
  if (truck?.latitude == null || truck?.longitude == null) return "";
  const lat = Number(truck.latitude);
  const lon = Number(truck.longitude);
  const delta = 0.018;
  const bbox = [lon - delta, lat - delta, lon + delta, lat + delta].join(",");
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lon}`;
}

function openMapUrl(truck) {
  if (truck?.latitude == null || truck?.longitude == null) return "#";
  return `https://www.google.com/maps/search/?api=1&query=${truck.latitude},${truck.longitude}`;
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

export function AdminTrackingPage() {
  const { data, error, loading, refetch } = usePanelData("/api/admin/tracking");
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [gpsFilter, setGpsFilter] = useState("");
  const [riskFilter, setRiskFilter] = useState("");
  const [operationalFilter, setOperationalFilter] = useState("all");
  const [selectedTruckId, setSelectedTruckId] = useState(null);
  const [actionError, setActionError] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdatedAt, setLastUpdatedAt] = useState(new Date());
  const hasFilters = Boolean(search || status || gpsFilter || riskFilter || operationalFilter !== "all");

  const trucks = useMemo(() => {
    return (data?.trucks || []).filter(truck => {
      const query = search.toLowerCase();
      if (status && truck.rawStatus !== status) return false;
      if (gpsFilter === "fresh" && (truck.stale || !truck.hasGps)) return false;
      if (gpsFilter === "stale" && !truck.stale) return false;
      if (gpsFilter === "missing" && truck.hasGps) return false;
      if (riskFilter === "eta" && !truck.etaRisk) return false;
      if (riskFilter === "speed" && !truck.overspeed) return false;
      if (riskFilter === "driver" && truck.driver !== "Unassigned") return false;
      if (operationalFilter === "duty" && !truck.onDuty) return false;
      if (operationalFilter === "moving" && truck.movementState !== "Moving") return false;
      if (operationalFilter === "unauthorised" && truck.movementState !== "Moving Without Duty") return false;
      if (operationalFilter === "stopped" && truck.movementState !== "Stopped On Duty") return false;
      if (operationalFilter === "assigned" && truck.movementState !== "Assigned") return false;
      if (operationalFilter === "available" && (truck.rawStatus !== "available" || truck.tripId)) return false;
      if (operationalFilter === "offroad" && !["maintenance", "stopped"].includes(truck.rawStatus)) return false;
      if (operationalFilter === "offline" && truck.movementState !== "Tracking Offline") return false;
      if (!query) return true;
      return (
        truck.truck.toLowerCase().includes(query) ||
        truck.driver.toLowerCase().includes(query) ||
        truck.location.toLowerCase().includes(query) ||
        truck.fleetCode?.toLowerCase().includes(query) ||
        truck.model?.toLowerCase().includes(query) ||
        truck.trailerCode?.toLowerCase().includes(query) ||
        truck.trailerReg?.toLowerCase().includes(query)
      );
    });
  }, [data, gpsFilter, operationalFilter, riskFilter, search, status]);

  const mapTrucks = useMemo(() => trucks.filter(truck => truck.latitude != null && truck.longitude != null), [trucks]);
  const selectedTruck = mapTrucks.find(truck => truck.id === selectedTruckId) || mapTrucks[0] || null;

  useEffect(() => {
    if (!selectedTruckId && mapTrucks[0]) {
      setSelectedTruckId(mapTrucks[0].id);
    }
  }, [mapTrucks, selectedTruckId]);

  useEffect(() => {
    const socket = getRealtimeSocket();

    function handleLocationUpdate() {
      refetch(false);
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
    if (data) setLastUpdatedAt(new Date());
  }, [data]);

  useEffect(() => {
    if (!autoRefresh) return undefined;
    const timer = window.setInterval(() => refetch(false), 30000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, refetch]);

  const gpsFreshCount = useMemo(
    () => (data?.trucks || []).filter(truck => truck.hasGps && !truck.stale).length,
    [data]
  );
  const gpsCoverage = data?.trucks?.length
    ? Math.round((gpsFreshCount / data.trucks.length) * 100)
    : 0;

  function clearFilters() {
    setSearch("");
    setStatus("");
    setGpsFilter("");
    setRiskFilter("");
    setOperationalFilter("all");
  }

  async function quickStatus(truck, nextStatus) {
    setActionError("");
    try {
      await updateTrackingVehicle(truck.id, {
        current_location: truck.location === "Location unknown" ? "" : truck.location,
        speed_kph: truck.speedValue || 0,
        status: nextStatus,
        gps_latitude: truck.latitude ?? "",
        gps_longitude: truck.longitude ?? "",
        gps_accuracy_m: truck.accuracy ?? "",
        mark_ping_now: false
      });
      refetch(false);
    } catch (err) {
      setActionError(err?.response?.data?.message || "Vehicle status could not be updated.");
    }
  }

  function exportTracking() {
    exportCsv("live-tracking-register.csv", [
      ["Vehicle", "Fleet code", "Driver", "Status", "Location", "Latitude", "Longitude", "Speed", "Last ping minutes", "Trip", "ETA", "Risk"],
      ...trucks.map(truck => [
        truck.truck,
        truck.fleetCode,
        truck.driver,
        truck.status,
        truck.location,
        truck.latitude,
        truck.longitude,
        truck.speedValue,
        truck.lastPingMinutes,
        truck.tripCode,
        truck.etaRaw,
        [truck.stale ? "Stale ping" : "", truck.etaRisk ? "ETA risk" : "", truck.overspeed ? "Speed risk" : ""].filter(Boolean).join("; ")
      ])
    ]);
  }

  return (
    <AdminWorkspaceLayout
      badge={data?.header?.badge || "GPS / live tracking"}
      title={data?.header?.title || "Truck positions, ETA and last ping"}
      description={
        data?.header?.description ||
        "Give admins visibility into every active truck's location, speed, ETA, and last ping."
      }
      highlights={[]}
      className="tracking-page-shell"
    >
      <div className="finance-command-bar">
        <span className="tracking-live-indicator">
          <span className={autoRefresh ? "pulse" : ""} />
          {autoRefresh ? "Live · Refreshes Every 30 Seconds" : "Auto Refresh Paused"}
        </span>
        <span className="tracking-last-updated">
          Last Updated {lastUpdatedAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
        </span>
        <button className="header-action-button" type="button" onClick={() => setAutoRefresh(value => !value)}>
          {autoRefresh ? "Pause Live Updates" : "Resume Live Updates"}
        </button>
        <button className="header-action-button" type="button" onClick={() => refetch(false)}>Refresh Now</button>
        <button className="header-action-button" type="button" onClick={exportTracking}>Export CSV</button>
      </div>

      <StateNotice loading={loading} error={error} />

      {actionError && (
        <div className="state-card error" style={{ marginBottom: 16 }}>
          <span className="state-dot error" />
          <div><strong>Action error</strong><p>{actionError}</p></div>
        </div>
      )}

      <section className="tracking-operations-strip" aria-label="Fleet Operational Summary">
        {(data?.operationalSummary || []).map(item => (
          <button
            className={`tracking-operation-item ${item.tone}${operationalFilter === item.key ? " active" : ""}`}
            key={item.key}
            onClick={() => setOperationalFilter(item.key)}
            type="button"
          >
            <span>{item.label}</span>
            <strong>{item.value}</strong>
            <small>{item.detail}</small>
          </button>
        ))}
      </section>

      <section className="tracking-health-bar" aria-label="GPS Network Health">
        <div>
          <span className="card-label">GPS Network Health</span>
          <strong>{gpsCoverage}% Fresh Coverage</strong>
        </div>
        <div className="tracking-health-meter" aria-label={`${gpsCoverage}% Fresh GPS Coverage`}>
          <span style={{ width: `${gpsCoverage}%` }} />
        </div>
        {(data?.gpsHealth || []).map(item => (
          <button
            key={item.label}
            type="button"
            onClick={() => {
              const label = item.label.toLowerCase();
              if (label === "gps online") setGpsFilter("fresh");
              if (label === "stale pings") setGpsFilter("stale");
              if (label === "no gps marker") setGpsFilter("missing");
              if (label === "eta / speed risk") setRiskFilter("eta");
            }}
          >
            <strong>{item.value}</strong>
            <span>{item.label}</span>
          </button>
        ))}
      </section>

      <section className="tracking-command-card">
        <input
          className="af-input"
          placeholder="Search Reg No., Fleet Code, Make/Model, Trailer, Driver, Or Location..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select className="af-select" value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">All Vehicle Statuses</option>
          <option value="available">Available</option>
          <option value="planned">Planned</option>
          <option value="in_transit">In Transit</option>
          <option value="maintenance">Maintenance</option>
          <option value="stopped">Stopped</option>
        </select>
        <select className="af-select" value={gpsFilter} onChange={e => setGpsFilter(e.target.value)}>
          <option value="">All GPS States</option>
          <option value="fresh">Fresh GPS</option>
          <option value="stale">Stale Pings</option>
          <option value="missing">No GPS Marker</option>
        </select>
        <select className="af-select" value={riskFilter} onChange={e => setRiskFilter(e.target.value)}>
          <option value="">All Risk States</option>
          <option value="eta">ETA Risk</option>
          <option value="speed">Speed Risk</option>
          <option value="driver">Unassigned Driver</option>
        </select>
        <button className="header-action-button" disabled={!hasFilters} type="button" onClick={clearFilters}>Clear Filters</button>
      </section>

      <section className="tracking-control-layout">
        <article className="content-card tracking-map-card">
        <div className="section-head">
          <div>
            <span className="card-label">Fleet Locator</span>
            <h2>{selectedTruck ? `${selectedTruck.truck} · ${selectedTruck.movementState}` : "Waiting For Driver GPS"}</h2>
          </div>
          <StatusPill tone={selectedTruck?.stale ? "warning" : selectedTruck ? "success" : "neutral"}>
            {selectedTruck ? (selectedTruck.stale ? "Stale Ping" : "Live Marker") : "No GPS Yet"}
          </StatusPill>
        </div>

        {selectedTruck ? (
          <>
            <div className="tracking-map-shell">
              <iframe
                title={`Live map for ${selectedTruck.truck}`}
                src={buildMapUrl(selectedTruck)}
                loading="lazy"
              />
              <div className="tracking-map-overlay">
                <strong>{selectedTruck.truck}</strong>
                <span>{selectedTruck.location}</span>
                <span>{selectedTruck.driver} · {selectedTruck.speed} · {selectedTruck.note}</span>
                <span>{selectedTruck.tripCode || "No Active Duty"} · {selectedTruck.accuracyLabel}</span>
              </div>
            </div>
            <div className="tracking-map-actions">
              <a className="af-submit-btn driver-nav-link" href={openMapUrl(selectedTruck)} rel="noreferrer" target="_blank">
                Open In Google Maps
              </a>
              <button className="header-action-button" type="button" onClick={() => navigate(`/admin/tracking/vehicles/${selectedTruck.id}`)}>
                Open Vehicle Detail
              </button>
            </div>
            <div className="tracking-selected-inspector">
              <div><span>Movement</span><strong>{selectedTruck.movementState}</strong></div>
              <div><span>Driver</span><strong>{selectedTruck.driver}</strong></div>
              <div><span>Duty</span><strong>{selectedTruck.tripCode || "No Active Duty"}</strong></div>
              <div><span>Speed</span><strong>{selectedTruck.speed}</strong></div>
              <div><span>ETA</span><strong>{selectedTruck.tripCode ? selectedTruck.eta : "Not Applicable"}</strong></div>
              <div><span>GPS</span><strong>{selectedTruck.stale ? selectedTruck.note : `Fresh · ${selectedTruck.accuracyLabel}`}</strong></div>
            </div>
          </>
        ) : (
          <p className="driver-empty">No live GPS markers available yet. Once a driver allows location permission from the driver panel, their position will appear here.</p>
        )}
        </article>

        <aside className="content-card tracking-fleet-sidebar">
          <div className="section-head">
            <div>
              <span className="card-label">All Visible Trucks</span>
              <h2>Fleet Position Index</h2>
            </div>
            <StatusPill tone="neutral">{trucks.length} Trucks</StatusPill>
          </div>
          <div className="tracking-fleet-index">
            {trucks.map(truck => (
              <button
                className={`${truck.id === selectedTruck?.id ? "active" : ""} ${truck.movementState.toLowerCase().replaceAll(" ", "-")}`}
                key={truck.id}
                onClick={() => truck.hasGps ? setSelectedTruckId(truck.id) : navigate(`/admin/tracking/vehicles/${truck.id}`)}
                type="button"
              >
                <span className={`tracking-state-dot ${truck.stale || !truck.hasGps ? "offline" : truck.speedValue >= 5 ? "moving" : "stationary"}`} />
                <span>
                  <strong>{truck.truck}</strong>
                  <small>{truck.driver} · {truck.location}</small>
                </span>
                <span>
                  <strong>{truck.movementState}</strong>
                  <small>{truck.hasGps ? truck.note : "No GPS Marker"}</small>
                </span>
              </button>
            ))}
          </div>
        </aside>
      </section>

      <section className="tracking-lower-layout">
        <article className="content-card">
          <div className="section-head">
            <div>
              <span className="card-label">Fleet Operations</span>
              <h2>Every Truck, Duty, And Movement State</h2>
            </div>
            <StatusPill tone="success">{trucks.length} Visible</StatusPill>
          </div>

          <div className="data-rows compact finance-list">
            {trucks.map((item) => (
              <div
                className={[
                  "data-row finance-row tracking-row",
                  item.stale ? "tracking-row--stale" : item.etaRisk ? "tracking-row--risk" : item.overspeed ? "tracking-row--overspeed" : ""
                ].filter(Boolean).join(" ")}
                key={item.truck}
              >
                <button
                  className="finance-row-main tracking-row-main"
                  type="button"
                  onClick={() => {
                    if (item.latitude != null && item.longitude != null) setSelectedTruckId(item.id);
                    navigate(`/admin/tracking/vehicles/${item.id}`);
                  }}
                >
                  <div>
                    <strong>{item.truck}</strong>
                    <p>{item.fleetCode || "No Fleet Code"} · {item.model || "Model Unknown"} · {item.driver}</p>
                  </div>
                  <div>
                    <span>{item.movementState} · {item.speed}</span>
                    <p>{item.location} · {item.note}</p>
                  </div>
                  <div>
                    <span>{item.tripCode ? `${item.tripCode} · ETA ${item.eta}` : "No Active Duty"}</span>
                    {(item.stale || item.etaRisk || item.overspeed) ? (
                      <div className="tracking-risk-pills">
                        {item.stale && <span className="tracking-risk-pill stale">{item.note}</span>}
                        {item.etaRisk && <span className="tracking-risk-pill risk">ETA risk</span>}
                        {item.overspeed && <span className="tracking-risk-pill speed">Overspeed</span>}
                      </div>
                    ) : (
                      <p>{item.hasGps ? `${item.accuracyLabel} · Fresh Tracking` : "No GPS Marker"}</p>
                    )}
                  </div>
                </button>
                <div className="finance-row-actions">
                  <StatusPill tone={item.tone}>{item.status}</StatusPill>
                  {item.rawStatus !== "in_transit" && (
                    <button className="header-action-button" type="button" onClick={() => quickStatus(item, "in_transit")}>In Transit</button>
                  )}
                  {item.rawStatus !== "available" && (
                    <button className="header-action-button" type="button" onClick={() => quickStatus(item, "available")}>Available</button>
                  )}
                  {item.rawStatus !== "stopped" && (
                    <button className="header-action-button" type="button" onClick={() => quickStatus(item, "stopped")}>Stop</button>
                  )}
                  {item.rawStatus !== "maintenance" && (
                    <button className="header-action-button" type="button" onClick={() => quickStatus(item, "maintenance")}>Maintenance</button>
                  )}
                </div>
              </div>
            ))}
            {!loading && trucks.length === 0 && (
              <p className="finance-empty">{hasFilters ? "No vehicles match your filters." : "No vehicles are registered for tracking yet."}</p>
            )}
          </div>
        </article>

        <article className="content-card">
          <div className="section-head">
            <div>
              <span className="card-label">Tracking Exceptions</span>
              <h2>Stale Pings And ETA Risks</h2>
            </div>
            <StatusPill tone="warning">Watch Closely</StatusPill>
          </div>

          <div className="alert-stack">
            {(data?.exceptions || []).map((item) => (
              <div
                className="alert-card"
                key={item.title}
                style={item.vehicleId ? { cursor: "pointer" } : undefined}
                onClick={() => item.vehicleId && navigate(`/admin/tracking/vehicles/${item.vehicleId}`)}
              >
                <div className={`alert-bar ${item.tone}`} />
                <div>
                  <strong>{item.title}</strong>
                  <p>{item.description}</p>
                </div>
              </div>
            ))}
            {!loading && (data?.exceptions || []).length === 0 && (
              <p className="finance-empty">No Tracking Exceptions Right Now. Stale Pings, ETA Risk, And Failed Deliveries Will Appear Here.</p>
            )}
          </div>
        </article>
      </section>
    </AdminWorkspaceLayout>
  );
}
