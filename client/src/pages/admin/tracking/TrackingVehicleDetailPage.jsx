import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getTrackingVehicleById, updateTrackingVehicle } from "../../../api/adminApi";
import { StatusPill } from "../../../components/StatusPill";
import { AdminWorkspaceLayout } from "../AdminWorkspaceLayout";

function DetailBlock({ label, value }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value || "—"}</strong>
    </div>
  );
}

function buildVehicleMapUrl(vehicle) {
  if (vehicle?.latitude == null || vehicle?.longitude == null) return "";
  const lat = Number(vehicle.latitude);
  const lon = Number(vehicle.longitude);
  const delta = 0.018;
  const bbox = [lon - delta, lat - delta, lon + delta, lat + delta].join(",");
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lon}`;
}

function openVehicleMapUrl(vehicle) {
  if (vehicle?.latitude == null || vehicle?.longitude == null) return "#";
  return `https://www.google.com/maps/search/?api=1&query=${vehicle.latitude},${vehicle.longitude}`;
}

export function TrackingVehicleDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [vehicle, setVehicle] = useState(null);
  const [fields, setFields] = useState({ current_location: "", speed_kph: 0, status: "available" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState("");

  function load() {
    setLoading(true);
    getTrackingVehicleById(id)
      .then(r => {
        setVehicle(r.data);
        setFields(r.data.form);
      })
      .catch(() => setError("Tracking details could not be loaded."))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, [id]);

  function set(key, value) {
    setFields(prev => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitError("");
    setSaving(true);
    try {
      await updateTrackingVehicle(id, {
        current_location: fields.current_location,
        speed_kph: Number(fields.speed_kph),
        status: fields.status,
        mark_ping_now: true
      });
      load();
    } catch (err) {
      setSubmitError(err?.response?.data?.message || "Tracking update could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function quickStatus(status) {
    setSubmitError("");
    try {
      await updateTrackingVehicle(id, {
        ...fields,
        speed_kph: Number(fields.speed_kph),
        status,
        mark_ping_now: true
      });
      load();
    } catch (err) {
      setSubmitError(err?.response?.data?.message || "Status could not be updated.");
    }
  }

  return (
    <AdminWorkspaceLayout
      badge="GPS / live tracking"
      title={vehicle?.registrationNumber || "Vehicle tracking"}
      description={vehicle ? `${vehicle.currentLocation || "Location unknown"} · ${vehicle.statusLabel}` : "Update location, speed, status, and GPS ping data."}
      highlights={[]}
    >
      <div style={{ maxWidth: 920 }}>
        <div className="af-back-row">
          <button className="af-back-btn" type="button" onClick={() => navigate("/admin/tracking")}>
            ← Back to tracking
          </button>
        </div>

        {loading && (
          <div className="state-card">
            <span className="state-dot loading" />
            <div><strong>Loading...</strong><p>Loading vehicle tracking</p></div>
          </div>
        )}

        {error && (
          <div className="state-card error">
            <span className="state-dot error" />
            <div><strong>Load error</strong><p>{error}</p></div>
          </div>
        )}

        {vehicle && (
          <>
            <div className="content-card" style={{ marginBottom: 16 }}>
              <div className="section-head">
                <div>
                  <span className="card-label">Tracking status</span>
                  <h2 style={{ margin: "4px 0 0", fontSize: "1.35rem" }}>{vehicle.registrationNumber}</h2>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                  <StatusPill tone={vehicle.tone}>{vehicle.statusLabel}</StatusPill>
                  <StatusPill tone={vehicle.stale ? "warning" : "success"}>
                    {vehicle.stale ? "Stale ping" : "Fresh ping"}
                  </StatusPill>
                </div>
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                {["available", "planned", "in_transit", "maintenance", "stopped"].map(status => (
                  vehicle.status !== status && (
                    <button key={status} className="header-action-button" style={{ height: 30, padding: "0 10px", fontSize: "0.78rem" }} type="button" onClick={() => quickStatus(status)}>
                      Set {status.replace("_", " ")}
                    </button>
                  )
                ))}
              </div>
            </div>

            <div className="content-grid" style={{ marginBottom: 16 }}>
              <article className="content-card">
                <div className="section-head">
                  <div>
                    <span className="card-label">Vehicle</span>
                    <h2>Live position</h2>
                  </div>
                </div>
                <div className="detail-grid">
                  <DetailBlock label="Fleet code" value={vehicle.fleetCode} />
                  <DetailBlock label="Model" value={vehicle.modelName} />
                  <DetailBlock label="Type" value={vehicle.truckType} />
                  <DetailBlock label="Speed" value={`${vehicle.speedKph || 0} km/h`} />
                  <div className="detail-wide"><DetailBlock label="Current location" value={vehicle.currentLocation || "Location unknown"} /></div>
                  <div className="detail-wide"><DetailBlock label="Last ping" value={vehicle.lastPingMinutes != null ? `${vehicle.lastPingMinutes} min ago · ${vehicle.lastPingAt}` : "No ping data"} /></div>
                </div>
              </article>

              <article className="content-card">
                <div className="section-head">
                  <div>
                    <span className="card-label">Assignment</span>
                    <h2>Trip and driver</h2>
                  </div>
                </div>
                <div className="detail-grid">
                  <DetailBlock label="Driver" value={vehicle.driver?.name} />
                  <DetailBlock label="Phone" value={vehicle.driver?.phone} />
                  <DetailBlock label="Trip" value={vehicle.trip?.code} />
                  <DetailBlock label="Trip status" value={vehicle.trip?.status} />
                  <div className="detail-wide"><DetailBlock label="Lane" value={vehicle.trip?.lane} /></div>
                  <DetailBlock label="Departure" value={vehicle.trip?.departure} />
                  <DetailBlock label="ETA" value={vehicle.trip?.eta} />
                </div>
              </article>
            </div>

            <div className="content-card tracking-map-card" style={{ marginBottom: 16 }}>
              <div className="section-head">
                <div>
                  <span className="card-label">Driver GPS map</span>
                  <h2>{vehicle.driver?.name ? `${vehicle.driver.name} live position` : "Vehicle live position"}</h2>
                </div>
                <StatusPill tone={vehicle.stale ? "warning" : vehicle.latitude != null ? "success" : "neutral"}>
                  {vehicle.latitude != null ? (vehicle.stale ? "Stale ping" : "Live marker") : "No GPS marker"}
                </StatusPill>
              </div>

              {vehicle.latitude != null && vehicle.longitude != null ? (
                <>
                  <div className="tracking-map-shell">
                    <iframe
                      title={`Map for ${vehicle.registrationNumber}`}
                      src={buildVehicleMapUrl(vehicle)}
                      loading="lazy"
                    />
                    <div className="tracking-map-overlay">
                      <strong>{vehicle.registrationNumber}</strong>
                      <span>{vehicle.currentLocation || "Location unknown"}</span>
                      <span>{vehicle.speedKph || 0} km/h · {vehicle.lastPingMinutes != null ? `${vehicle.lastPingMinutes} min ago` : "No ping age"}</span>
                    </div>
                  </div>
                  <div className="tracking-map-actions">
                    <a className="af-submit-btn driver-nav-link" href={openVehicleMapUrl(vehicle)} rel="noreferrer" target="_blank">
                      Open in Google Maps
                    </a>
                  </div>
                </>
              ) : (
                <p className="driver-empty">No GPS ping received from the driver yet. Once location access is granted in the driver panel, the exact marker will appear here.</p>
              )}
            </div>

            <div className="content-card">
              <div className="section-head">
                <div>
                  <span className="card-label">Manual GPS update</span>
                  <h2>Update ping</h2>
                </div>
                <StatusPill tone="neutral">Sets ping to now</StatusPill>
              </div>

              <form className="af-form" onSubmit={handleSubmit}>
                <div className="af-grid-3">
                  <div className="af-field">
                    <label className="af-label">Current location</label>
                    <input className="af-input" value={fields.current_location || ""} onChange={e => set("current_location", e.target.value)} placeholder="e.g. M6 Northbound, Stoke-on-Trent" />
                  </div>
                  <div className="af-field">
                    <label className="af-label">Speed (km/h)</label>
                    <input className="af-input" type="number" min="0" step="0.1" value={fields.speed_kph} onChange={e => set("speed_kph", e.target.value)} />
                  </div>
                  <div className="af-field">
                    <label className="af-label">Vehicle status</label>
                    <select className="af-select" value={fields.status} onChange={e => set("status", e.target.value)}>
                      <option value="available">Available</option>
                      <option value="planned">Planned</option>
                      <option value="in_transit">In transit</option>
                      <option value="maintenance">Maintenance</option>
                      <option value="stopped">Stopped</option>
                    </select>
                  </div>
                </div>

                {submitError && (
                  <div className="state-card error">
                    <span className="state-dot error" />
                    <div><strong>Update error</strong><p>{submitError}</p></div>
                  </div>
                )}

                <div className="af-actions">
                  <button className="af-submit-btn" type="submit" disabled={saving}>
                    {saving ? "Saving..." : "Save GPS ping →"}
                  </button>
                  {vehicle.trip?.id && (
                    <button className="header-action-button" type="button" onClick={() => navigate(`/admin/trips/${vehicle.trip.id}`)}>
                      Open trip
                    </button>
                  )}
                </div>
              </form>
            </div>
          </>
        )}
      </div>
    </AdminWorkspaceLayout>
  );
}
