import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
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

export function AdminTrackingPage() {
  const { data, error, loading, refetch } = usePanelData("/api/admin/tracking");
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [staleOnly, setStaleOnly] = useState(false);
  const [selectedTruckId, setSelectedTruckId] = useState(null);

  const trucks = useMemo(() => {
    return (data?.trucks || []).filter(truck => {
      const query = search.toLowerCase();
      if (status && truck.rawStatus !== status) return false;
      if (staleOnly && !truck.stale) return false;
      if (!query) return true;
      return (
        truck.truck.toLowerCase().includes(query) ||
        truck.driver.toLowerCase().includes(query) ||
        truck.location.toLowerCase().includes(query) ||
        truck.fleetCode?.toLowerCase().includes(query)
      );
    });
  }, [data, search, staleOnly, status]);

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
      <StateNotice loading={loading} error={error} />

      <section className="stats-grid">
        {(data?.stats || []).map((item) => (
          <StatCard item={item} key={item.label} />
        ))}
      </section>

      <section className="content-card tracking-map-card">
        <div className="section-head">
          <div>
            <span className="card-label">Live GPS map</span>
            <h2>{selectedTruck ? `${selectedTruck.truck} · ${selectedTruck.driver}` : "Waiting for driver GPS"}</h2>
          </div>
          <StatusPill tone={selectedTruck?.stale ? "warning" : selectedTruck ? "success" : "neutral"}>
            {selectedTruck ? (selectedTruck.stale ? "Stale ping" : "Live marker") : "No GPS yet"}
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
                <span>{selectedTruck.speed} · {selectedTruck.note}</span>
              </div>
            </div>
            <div className="tracking-map-actions">
              <a className="af-submit-btn driver-nav-link" href={openMapUrl(selectedTruck)} rel="noreferrer" target="_blank">
                Open in Google Maps
              </a>
              <button className="header-action-button" type="button" onClick={() => navigate(`/admin/tracking/vehicles/${selectedTruck.id}`)}>
                Open vehicle detail
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

      <section className="content-grid">
        <article className="content-card">
          <div className="section-head">
            <div>
              <span className="card-label">Live trucks</span>
              <h2>Current road visibility</h2>
            </div>
            <StatusPill tone="success">GPS active</StatusPill>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
            <input
              className="af-input"
              style={{ margin: 0, flex: "1 1 220px" }}
              placeholder="Search vehicle, driver, location..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <select className="af-select" style={{ margin: 0, width: 160 }} value={status} onChange={e => setStatus(e.target.value)}>
              <option value="">All statuses</option>
              <option value="available">Available</option>
              <option value="planned">Planned</option>
              <option value="in_transit">In transit</option>
              <option value="maintenance">Maintenance</option>
              <option value="stopped">Stopped</option>
            </select>
            <label style={{ display: "flex", alignItems: "center", gap: 8, color: "#334155", fontWeight: 700, fontSize: "0.83rem" }}>
              <input type="checkbox" checked={staleOnly} onChange={e => setStaleOnly(e.target.checked)} />
              Stale pings
            </label>
          </div>

          <div className="data-rows">
            {trucks.map((item) => (
              <div
                className="data-row"
                key={item.truck}
                style={{ cursor: "pointer" }}
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
                <StatusPill tone={item.tone}>{item.status}</StatusPill>
              </div>
            ))}
            {!loading && trucks.length === 0 && (
              <p style={{ color: "#94a3b8", fontSize: "0.86rem", margin: 0 }}>No vehicles match your filters.</p>
            )}
          </div>
        </article>

        <article className="content-card">
          <div className="section-head">
            <div>
              <span className="card-label">Tracking exceptions</span>
              <h2>Stale pings and ETA risks</h2>
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
          </div>
        </article>
      </section>
    </AdminWorkspaceLayout>
  );
}
