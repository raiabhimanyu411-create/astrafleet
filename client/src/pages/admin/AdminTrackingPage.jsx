import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { updateTrackingVehicle } from "../../api/adminApi";
import { getRealtimeSocket } from "../../api/realtime";
import { StatCard } from "../../components/StatCard";
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
  const [selectedTruckId, setSelectedTruckId] = useState(null);
  const [actionError, setActionError] = useState("");
  const hasFilters = Boolean(search || status || gpsFilter || riskFilter);

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
      if (!query) return true;
      return (
        truck.truck.toLowerCase().includes(query) ||
        truck.driver.toLowerCase().includes(query) ||
        truck.location.toLowerCase().includes(query) ||
        truck.fleetCode?.toLowerCase().includes(query)
      );
    });
  }, [data, gpsFilter, riskFilter, search, status]);

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

  function clearFilters() {
    setSearch("");
    setStatus("");
    setGpsFilter("");
    setRiskFilter("");
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
        mark_ping_now: true
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
      highlights={data?.highlights || []}
    >
      <div className="finance-command-bar">
        <button className="header-action-button" type="button" onClick={() => refetch(false)}>Refresh</button>
        <button className="header-action-button" type="button" onClick={exportTracking}>Export CSV</button>
      </div>

      <StateNotice loading={loading} error={error} />

      {actionError && (
        <div className="state-card error" style={{ marginBottom: 16 }}>
          <span className="state-dot error" />
          <div><strong>Action error</strong><p>{actionError}</p></div>
        </div>
      )}

      <section className="stats-grid">
        {(data?.stats || []).map((item) => (
          <StatCard item={item} key={item.label} />
        ))}
      </section>

      <section className="stats-grid inline finance-position-grid">
        {(data?.gpsHealth || []).map((item) => (
          <StatCard item={item} key={item.label} />
        ))}
      </section>

      <section className="content-card tracking-map-card">
        <div className="section-head">
          <div>
            <span className="card-label">Live GPS Map</span>
            <h2>{selectedTruck ? `${selectedTruck.truck} · ${selectedTruck.driver}` : "Waiting for driver GPS"}</h2>
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
                <span>{selectedTruck.speed} · {selectedTruck.note} · {selectedTruck.accuracyLabel}</span>
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
            <div className="tracking-marker-list">
              {mapTrucks.map(truck => (
                <button
                  className={truck.id === selectedTruck.id ? "active" : ""}
                  key={truck.id}
                  onClick={() => setSelectedTruckId(truck.id)}
                  type="button"
                >
                  <strong>{truck.truck}</strong>
                  <span>{truck.driver}</span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <p className="driver-empty">No live GPS markers available yet. Once a driver allows location permission from the driver panel, their position will appear here.</p>
        )}
      </section>

      <section className="content-card tracking-command-card">
        <input
          className="af-input"
          placeholder="Search Vehicle, Driver, Location, Or Fleet Code..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select className="af-select" value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">All Statuses</option>
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

      <section className="content-grid">
        <article className="content-card">
          <div className="section-head">
            <div>
              <span className="card-label">Live Trucks</span>
              <h2>Current Road Visibility</h2>
            </div>
            <StatusPill tone="success">GPS active</StatusPill>
          </div>

          <div className="data-rows compact finance-list">
            {trucks.map((item) => (
              <div
                className="data-row finance-row tracking-row"
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
                    <p>{item.driver} · {item.location}</p>
                  </div>
                  <div>
                    <span>{item.speed}</span>
                    <p>{item.tripCode ? `${item.tripCode} · ${item.driverJobStatus} · ETA ${item.eta}` : item.note}</p>
                  </div>
                  <div>
                    <span>{item.hasGps ? item.accuracyLabel : "No GPS marker"}</span>
                    <p>{item.stale ? item.note : "Fresh tracking"}{item.etaRisk ? " · ETA risk" : ""}{item.overspeed ? " · Speed risk" : ""}</p>
                  </div>
                </button>
                <div className="finance-row-actions">
                  <StatusPill tone={item.tone}>{item.status}</StatusPill>
                  {item.rawStatus !== "in_transit" && (
                    <button className="header-action-button" type="button" onClick={() => quickStatus(item, "in_transit")}>In Transit</button>
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
            <StatusPill tone="warning">Watch closely</StatusPill>
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
              <p className="finance-empty">No tracking exceptions right now. Stale pings, ETA risk, and failed deliveries will appear here.</p>
            )}
          </div>
        </article>
      </section>
    </AdminWorkspaceLayout>
  );
}
