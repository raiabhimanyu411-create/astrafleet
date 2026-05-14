import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { deleteAdminTrip, getAdminTripById, updateAdminTripStatus } from "../../api/adminApi";
import { StatusPill } from "../../components/StatusPill";
import { AdminWorkspaceLayout } from "./AdminWorkspaceLayout";

function DetailBlock({ label, value }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value || "—"}</strong>
    </div>
  );
}

export function AdminTripDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [trip, setTrip] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");

  function loadTrip() {
    setLoading(true);
    getAdminTripById(id)
      .then(r => setTrip(r.data))
      .catch(() => setError("Trip details could not be loaded."))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadTrip();
  }, [id]);

  async function handleStatus(status) {
    setActionError("");
    try {
      await updateAdminTripStatus(id, { status });
      loadTrip();
    } catch (err) {
      setActionError(err?.response?.data?.message || "Trip status could not be updated.");
    }
  }

  async function handleDelete() {
    if (!window.confirm("Delete this trip? The assigned vehicle will be released.")) return;
    setActionError("");
    try {
      await deleteAdminTrip(id);
      navigate("/admin/trips");
    } catch (err) {
      setActionError(err?.response?.data?.message || "Trip could not be deleted.");
    }
  }

  return (
    <AdminWorkspaceLayout
      badge="Trip detail"
      title={trip ? `Trip ${trip.tripCode}` : "Trip detail"}
      description={
        trip
          ? `${trip.route?.from || "—"} → ${trip.route?.to || "—"} · ${trip.driver?.name || "Unassigned"}`
          : "Complete trip breakdown: driver, route, vehicle, schedule, and freight."
      }
      highlights={[]}
    >
      <div style={{ maxWidth: 900 }}>
        <div className="af-back-row">
          <button className="af-back-btn" type="button" onClick={() => navigate("/admin/trips")}>
            ← Back to trips dashboard
          </button>
        </div>

        {loading && (
          <div className="state-card">
            <span className="state-dot loading" />
            <div><strong>Loading...</strong><p>Loading trip details</p></div>
          </div>
        )}

        {error && (
          <div className="state-card error">
            <span className="state-dot error" />
            <div><strong>Load error</strong><p>{error}</p></div>
          </div>
        )}

        {trip && (
          <>
            {/* Status banner */}
            <div className="content-card trip-spotlight" style={{ marginBottom: 16 }}>
              <div className="section-head" style={{ marginBottom: 12 }}>
                <div>
                  <span className="card-label">Trip code</span>
                  <h2 style={{ fontSize: "1.4rem", margin: "4px 0 0" }}>{trip.tripCode}</h2>
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
                  <StatusPill tone={trip.tone}>{trip.status}</StatusPill>
                  {trip.priority && trip.priority !== "standard" && (
                    <StatusPill tone={trip.priority === "critical" ? "danger" : "warning"}>
                      {trip.priority}
                    </StatusPill>
                  )}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                {["planned", "loading", "active", "blocked", "completed"].map(status => (
                  trip.status !== status && (
                    <button
                      key={status}
                      className="header-action-button"
                      style={{ height: 30, padding: "0 10px", fontSize: "0.78rem" }}
                      type="button"
                      onClick={() => handleStatus(status)}
                    >
                      Set {status}
                    </button>
                  )
                ))}
              </div>
              {actionError && (
                <div className="state-card error" style={{ marginTop: 12 }}>
                  <span className="state-dot error" />
                  <div><strong>Action error</strong><p>{actionError}</p></div>
                </div>
              )}
              {trip.clientName && (
                <p style={{ margin: 0, fontSize: "0.85rem", color: "#475569" }}>
                  Client: <strong>{trip.clientName}</strong>
                </p>
              )}
            </div>

            {/* Route + Schedule */}
            <div className="content-grid" style={{ marginBottom: 16 }}>
              <div className="content-card">
                <div className="section-head">
                  <div>
                    <span className="card-label">Route</span>
                    <h2>Lane details</h2>
                  </div>
                </div>
                <div className="detail-grid">
                  <DetailBlock label="From" value={trip.route?.from} />
                  <DetailBlock label="To" value={trip.route?.to} />
                  <DetailBlock label="Route code" value={trip.route?.code} />
                  <DetailBlock label="Distance" value={trip.route?.distanceKm ? `${trip.route.distanceKm} km` : null} />
                  <DetailBlock label="Est. travel time" value={trip.route?.etaHours ? `${trip.route.etaHours} hours` : null} />
                  <DetailBlock label="Toll estimate" value={trip.route?.tollEstimate} />
                </div>
              </div>

              <div className="content-card">
                <div className="section-head">
                  <div>
                    <span className="card-label">Schedule</span>
                    <h2>Timing and dock</h2>
                  </div>
                </div>
                <div className="detail-grid">
                  <DetailBlock label="Planned departure" value={trip.schedule?.departure} />
                  <DetailBlock label="ETA at destination" value={trip.schedule?.eta} />
                  <div className="detail-wide">
                    <DetailBlock label="Dock window" value={trip.schedule?.dockWindow} />
                  </div>
                </div>
              </div>
            </div>

            {/* Driver + Vehicle */}
            <div className="content-grid" style={{ marginBottom: 16 }}>
              <div className="content-card">
                <div className="section-head">
                  <div>
                    <span className="card-label">Driver</span>
                    <h2>Assigned driver</h2>
                  </div>
                  {trip.driver?.compliance && (
                    <StatusPill tone={
                      trip.driver.compliance === "clear" ? "success"
                      : trip.driver.compliance === "review" ? "warning"
                      : "danger"
                    }>
                      {trip.driver.compliance}
                    </StatusPill>
                  )}
                </div>
                <div className="detail-grid">
                  <div className="detail-wide">
                    <DetailBlock label="Full name" value={trip.driver?.name} />
                  </div>
                  <DetailBlock label="Employee code" value={trip.driver?.employeeCode} />
                  <DetailBlock label="Phone" value={trip.driver?.phone} />
                  <div className="detail-wide">
                    <DetailBlock label="License number" value={trip.driver?.license} />
                  </div>
                </div>
              </div>

              <div className="content-card">
                <div className="section-head">
                  <div>
                    <span className="card-label">Vehicle</span>
                    <h2>Assigned truck and trolley</h2>
                  </div>
                </div>
                <div className="detail-grid">
                  <div className="detail-wide">
                    <DetailBlock label="Registration" value={trip.vehicle?.registration} />
                  </div>
                  <DetailBlock label="Model" value={trip.vehicle?.model} />
                  <DetailBlock label="Type" value={trip.vehicle?.type} />
                  <DetailBlock label="Fleet code" value={trip.vehicle?.fleetCode} />
                  <div className="detail-wide">
                    <DetailBlock label="Trailer / Trolley" value={trip.trailer?.registration} />
                  </div>
                  <DetailBlock label="Trolley code" value={trip.trailer?.code} />
                  <DetailBlock label="Trolley type" value={trip.trailer?.type} />
                  <DetailBlock label="Trolley capacity" value={trip.trailer?.capacityTonnes ? `${trip.trailer.capacityTonnes} tonnes` : null} />
                </div>
              </div>
            </div>

            {/* Freight */}
            <div className="content-card" style={{ marginBottom: 16 }}>
              <div className="section-head">
                <div>
                  <span className="card-label">Freight & payout</span>
                  <h2>Financial details</h2>
                </div>
                <StatusPill tone={trip.freight?.podStatus === "verified" ? "success" : trip.freight?.podStatus === "uploaded" ? "warning" : "neutral"}>
                  POD: {trip.freight?.podStatus || "pending"}
                </StatusPill>
              </div>
              <div className="detail-grid">
                <div className="detail-wide">
                  <DetailBlock label="Freight amount (payout)" value={trip.freight?.amount} />
                </div>
              </div>
            </div>

            <div className="af-actions">
              <button
                className="header-action-button"
                type="button"
                onClick={() => navigate(`/admin/trips/${id}/edit`)}
              >
                Edit trip
              </button>
              <button
                className="af-submit-btn"
                type="button"
                onClick={() => navigate("/admin/trips/assign")}
              >
                + Assign new trip
              </button>
              <button
                className="header-action-button danger"
                type="button"
                onClick={handleDelete}
              >
                Delete trip
              </button>
            </div>
          </>
        )}
      </div>
    </AdminWorkspaceLayout>
  );
}
