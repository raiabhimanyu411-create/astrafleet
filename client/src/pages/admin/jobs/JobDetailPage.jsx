import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { cancelJob, getJobById, updateJobStatus } from "../../../api/jobApi";
import { StateNotice } from "../../../components/StateNotice";
import { StatusPill } from "../../../components/StatusPill";
import { AdminWorkspaceLayout } from "../AdminWorkspaceLayout";

function DetailField({ label, value }) {
  return (
    <div style={{ padding: "11px 14px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8 }}>
      <span style={{ display: "block", fontSize: "0.7rem", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>{label}</span>
      <strong style={{ fontSize: "0.88rem", fontWeight: 600, color: "#0f172a" }}>{value || "—"}</strong>
    </div>
  );
}

function SectionCard({ label, title, badge, badgeTone, children }) {
  return (
    <div className="content-card" style={{ marginBottom: 14 }}>
      <div className="section-head">
        <div>
          <span className="card-label">{label}</span>
          <h2 style={{ margin: "4px 0 0", fontSize: "1rem" }}>{title}</h2>
        </div>
        {badge && <StatusPill tone={badgeTone || "neutral"}>{badge}</StatusPill>}
      </div>
      {children}
    </div>
  );
}

const STATUS_FLOW = [
  { from: "planned",   action: "Start loading",   next: "loading",   tone: "warning" },
  { from: "loading",   action: "Dispatch job",    next: "active",    tone: "success" },
  { from: "active",    action: "Mark delivered",  next: "completed", tone: "success" }
];

const LOAD_ICONS = { general: "📦", hazardous: "⚠️", refrigerated: "❄️", oversized: "🔩", fragile: "🫙" };
const STOP_TYPE_ICON = { pickup: "↑", delivery: "↓", waypoint: "●" };

export function JobDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");
  const [updating, setUpdating] = useState(false);
  const [blockReason, setBlockReason] = useState("");
  const [showBlockInput, setShowBlockInput] = useState(false);

  function load() {
    setLoading(true);
    getJobById(id)
      .then(r => setData(r.data))
      .catch(() => setError("Could not load job details."))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [id]);

  async function handleStatusChange(nextStatus) {
    setUpdating(true);
    try {
      await updateJobStatus(id, { status: nextStatus });
      load();
    } catch {
      alert("Could not update status. Please try again.");
    } finally {
      setUpdating(false);
    }
  }

  async function handleBlock() {
    setUpdating(true);
    try {
      await updateJobStatus(id, { status: "blocked", reason: blockReason || "Blocked by admin" });
      setShowBlockInput(false);
      setBlockReason("");
      load();
    } catch {
      alert("Could not block job.");
    } finally {
      setUpdating(false);
    }
  }

  async function handleCancel() {
    if (!window.confirm("Cancel this job? The vehicle will be released.")) return;
    try {
      await cancelJob(id, { reason: "Cancelled by admin" });
      load();
    } catch {
      alert("Could not cancel job.");
    }
  }

  const nextStep = data ? STATUS_FLOW.find(s => s.from === data.status) : null;
  const canBlock = data && !["completed", "blocked"].includes(data.status);

  return (
    <AdminWorkspaceLayout
      badge="Job management"
      title={data ? `Job ${data.code}` : "Job details"}
      description="Full job profile with route, load, driver, vehicle, and stop information."
      highlights={[]}
    >
      <div style={{ maxWidth: 960 }}>
        {/* Back + actions */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, gap: 12, flexWrap: "wrap" }}>
          <button className="af-back-btn" type="button" onClick={() => navigate("/admin/jobs")}>
            ← Back to jobs
          </button>
          {data && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="header-action-button" type="button" onClick={() => navigate(`/admin/jobs/${id}/edit`)}>
                Edit job
              </button>
              {canBlock && !showBlockInput && (
                <button className="header-action-button danger" type="button" onClick={() => setShowBlockInput(true)}>
                  Block job
                </button>
              )}
              {data.status === "planned" && (
                <button className="header-action-button danger" type="button" onClick={handleCancel}>
                  Cancel job
                </button>
              )}
            </div>
          )}
        </div>

        <StateNotice loading={loading} error={error} />

        {data && (
          <>
            {/* Status bar */}
            <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: "18px 22px", marginBottom: 14, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap", boxShadow: "0 1px 3px rgba(15,23,42,0.05)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
                <div>
                  <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 4 }}>Job status</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <StatusPill tone={data.statusTone}>{data.status}</StatusPill>
                    <StatusPill tone={data.priorityTone}>{data.priority} priority</StatusPill>
                    <StatusPill tone="neutral">POD: {data.podStatus}</StatusPill>
                  </div>
                </div>

                {/* Progress steps */}
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  {["planned", "loading", "active", "completed"].map((s, i, arr) => {
                    const statuses = ["planned", "loading", "active", "completed"];
                    const currentIdx = statuses.indexOf(data.status);
                    const stepIdx = statuses.indexOf(s);
                    const done = stepIdx < currentIdx;
                    const current = stepIdx === currentIdx;
                    return (
                      <div key={s} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <div style={{
                          width: 28, height: 28, borderRadius: "50%",
                          background: done ? "#16a34a" : current ? "#2563eb" : "#e2e8f0",
                          color: done || current ? "#fff" : "#94a3b8",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: "0.7rem", fontWeight: 700
                        }}>
                          {done ? "✓" : stepIdx + 1}
                        </div>
                        <span style={{ fontSize: "0.72rem", color: current ? "#2563eb" : done ? "#16a34a" : "#94a3b8", fontWeight: current || done ? 700 : 400, textTransform: "capitalize" }}>
                          {s}
                        </span>
                        {i < arr.length - 1 && <div style={{ width: 20, height: 2, background: done ? "#16a34a" : "#e2e8f0", borderRadius: 2, marginLeft: 2 }} />}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Action button */}
              <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
                {nextStep && (
                  <button
                    className="af-submit-btn"
                    type="button"
                    disabled={updating}
                    style={{ background: nextStep.tone === "success" ? "#15803d" : "#d97706" }}
                    onClick={() => handleStatusChange(nextStep.next)}
                  >
                    {updating ? "Updating..." : nextStep.action + " →"}
                  </button>
                )}
                {data.status === "blocked" && (
                  <button className="header-action-button" type="button" onClick={() => handleStatusChange("planned")}>
                    Reset to planned
                  </button>
                )}
              </div>
            </div>

            {/* Block reason input */}
            {showBlockInput && (
              <div style={{ background: "#fff8f8", border: "1px solid rgba(220,38,38,0.2)", borderRadius: 12, padding: "16px 20px", marginBottom: 14 }}>
                <p style={{ margin: "0 0 10px", fontSize: "0.86rem", fontWeight: 600, color: "#b91c1c" }}>Block reason</p>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    className="af-input"
                    style={{ margin: 0, flex: 1 }}
                    type="text"
                    placeholder="e.g. Vehicle breakdown, driver unavailable..."
                    value={blockReason}
                    onChange={e => setBlockReason(e.target.value)}
                  />
                  <button className="header-action-button danger" type="button" onClick={handleBlock} disabled={updating}>
                    {updating ? "..." : "Block"}
                  </button>
                  <button className="header-action-button" type="button" onClick={() => setShowBlockInput(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Cancellation / block reason notice */}
            {(data.cancellationReason || data.delayReason || data.failedDeliveryReason) && (
              <div style={{ background: "#fff8f8", border: "1px solid rgba(220,38,38,0.2)", borderRadius: 12, padding: "14px 18px", marginBottom: 14 }}>
                <strong style={{ fontSize: "0.84rem", color: "#b91c1c" }}>
                  {data.failedDeliveryReason ? "Failed delivery reason" : data.cancellationReason ? "Cancellation reason" : "Delay reason"}:
                </strong>
                <span style={{ fontSize: "0.84rem", color: "#334155", marginLeft: 8 }}>
                  {data.failedDeliveryReason || data.cancellationReason || data.delayReason}
                </span>
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 14 }}>
              {/* Customer */}
              <SectionCard label="Customer" title={data.customer.name}>
                <div className="detail-grid">
                  <DetailField label="Contact"  value={data.customer.contact} />
                  <DetailField label="Phone"    value={data.customer.phone} />
                  <DetailField label="Email"    value={data.customer.email} />
                </div>
              </SectionCard>

              {/* Load */}
              <SectionCard label="Load details" title={`${LOAD_ICONS[data.load.type] || "📦"} ${data.load.type} load`}>
                <div className="detail-grid">
                  <DetailField label="Weight"      value={data.load.weightKg} />
                  <DetailField label="Freight"     value={data.load.freight} />
                  <div className="detail-wide"><DetailField label="Description" value={data.load.description} /></div>
                  {data.specialInstructions && (
                    <div className="detail-wide"><DetailField label="Special instructions" value={data.specialInstructions} /></div>
                  )}
                </div>
              </SectionCard>

              {/* Route & Schedule */}
              <SectionCard label="Route & schedule" title={data.route.from && data.route.to ? `${data.route.from} → ${data.route.to}` : "Custom route"}>
                <div className="detail-grid">
                  <DetailField label="Pickup address"  value={data.route.pickupAddress || data.route.from} />
                  <DetailField label="Drop address"    value={data.route.dropAddress || data.route.to} />
                  <DetailField label="Planned departure" value={data.schedule.plannedDeparture} />
                  <DetailField label="ETA"             value={data.schedule.eta} />
                  <DetailField label="Actual departure" value={data.schedule.actualDeparture} />
                  <DetailField label="Actual arrival"  value={data.schedule.actualArrival} />
                  {data.schedule.dockWindow !== "—" && (
                    <DetailField label="Dock window" value={data.schedule.dockWindow} />
                  )}
                  {data.route.distanceKm && (
                    <DetailField label="Distance" value={`${data.route.distanceKm} km`} />
                  )}
                </div>
              </SectionCard>

              {/* Driver & Vehicle */}
              <SectionCard label="Dispatch" title="Driver, truck & trolley">
                {data.driver ? (
                  <div className="detail-grid" style={{ marginBottom: data.vehicle ? 12 : 0 }}>
                    <DetailField label="Driver name"   value={data.driver.name} />
                    <DetailField label="Employee code" value={data.driver.employeeCode} />
                    <DetailField label="Phone"         value={data.driver.phone} />
                    <DetailField label="Licence"       value={data.driver.license} />
                    <DetailField label="Compliance"    value={data.driver.compliance} />
                  </div>
                ) : (
                  <p style={{ color: "#94a3b8", fontSize: "0.86rem", marginBottom: data.vehicle ? 12 : 0 }}>No driver assigned yet.</p>
                )}
                {data.vehicle && (
                  <>
                    <div style={{ height: 1, background: "#e2e8f0", margin: "12px 0" }} />
                    <div className="detail-grid">
                      <DetailField label="Registration" value={data.vehicle.registration} />
                      <DetailField label="Model"        value={data.vehicle.model} />
                      <DetailField label="Type"         value={data.vehicle.type} />
                      <DetailField label="Fleet code"   value={data.vehicle.fleetCode} />
                      <DetailField label="Capacity"     value={data.vehicle.capacity} />
                    </div>
                  </>
                )}
                {data.trailer && (
                  <>
                    <div style={{ height: 1, background: "#e2e8f0", margin: "12px 0" }} />
                    <div className="detail-grid">
                      <DetailField label="Trolley registration" value={data.trailer.registration} />
                      <DetailField label="Trolley code" value={data.trailer.code} />
                      <DetailField label="Trolley type" value={data.trailer.type} />
                      <DetailField label="Trolley capacity" value={data.trailer.capacity} />
                    </div>
                  </>
                )}
                {!data.driver && !data.vehicle && !data.trailer && (
                  <div style={{ display: "flex", justifyContent: "center" }}>
                    <button className="header-action-button" type="button" onClick={() => navigate(`/admin/jobs/${id}/edit`)}>
                      Assign driver, truck & trolley →
                    </button>
                  </div>
                )}
              </SectionCard>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 14 }}>
              <SectionCard
                label="Driver execution"
                title="Browser updates from driver"
                badge={data.driverExecution?.statusLabel}
                badgeTone={data.driverExecution?.statusTone}
              >
                <div className="detail-grid">
                  <DetailField label="Driver status" value={data.driverExecution?.statusLabel} />
                  <DetailField label="POD status" value={data.proofOfDelivery?.status} />
                  <div className="detail-wide">
                    <DetailField label="Delivery notes" value={data.driverExecution?.deliveryNotes} />
                  </div>
                  {data.driverExecution?.failedDeliveryReason !== "—" && (
                    <div className="detail-wide">
                      <DetailField label="Failed delivery reason" value={data.driverExecution.failedDeliveryReason} />
                    </div>
                  )}
                </div>
              </SectionCard>

              <SectionCard label="Proof of Delivery" title="Driver submitted POD" badge={`POD: ${data.proofOfDelivery?.status || "pending"}`} badgeTone={data.proofOfDelivery?.status === "verified" ? "success" : data.proofOfDelivery?.status === "uploaded" ? "warning" : "neutral"}>
                <div className="pod-preview-grid">
                  <div>
                    <span className="card-label">Signature</span>
                    {data.proofOfDelivery?.signatureData ? (
                      <img alt="Driver signature proof" src={data.proofOfDelivery.signatureData} />
                    ) : (
                      <p>No signature uploaded.</p>
                    )}
                  </div>
                  <div>
                    <span className="card-label">Delivery photo</span>
                    {data.proofOfDelivery?.photoData ? (
                      <img alt="Delivery proof" src={data.proofOfDelivery.photoData} />
                    ) : (
                      <p>No delivery photo uploaded.</p>
                    )}
                  </div>
                </div>
              </SectionCard>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 14 }}>
              <SectionCard label="Driver expenses" title="Fuel and trip costs" badge={`${data.driverExpenses?.length || 0} entries`} badgeTone="neutral">
                <div className="data-rows">
                  {(data.driverExpenses || []).map(expense => (
                    <div className="data-row" key={expense.id}>
                      <div>
                        <strong>{expense.type}</strong>
                        <p>{expense.driver} · {expense.at}</p>
                      </div>
                      <div>
                        <span>{expense.amount}</span>
                        <p>{expense.notes}</p>
                      </div>
                      <StatusPill tone="warning">Review</StatusPill>
                    </div>
                  ))}
                  {(!data.driverExpenses || data.driverExpenses.length === 0) && (
                    <p style={{ color: "#94a3b8", fontSize: "0.86rem", margin: 0 }}>No expenses submitted for this job.</p>
                  )}
                </div>
              </SectionCard>

              <SectionCard label="Vehicle defects" title="Driver defect reports" badge={`${data.vehicleDefects?.length || 0} reports`} badgeTone={(data.vehicleDefects || []).some(d => d.tone === "danger") ? "danger" : "neutral"}>
                <div className="alert-stack">
                  {(data.vehicleDefects || []).map(defect => (
                    <div className="alert-card" key={defect.id}>
                      <div className={`alert-bar ${defect.tone}`} />
                      <div>
                        <strong>{defect.type} · {defect.severity}</strong>
                        <p>{defect.description} · {defect.reportedBy} · {defect.at}</p>
                      </div>
                    </div>
                  ))}
                  {(!data.vehicleDefects || data.vehicleDefects.length === 0) && (
                    <p style={{ color: "#94a3b8", fontSize: "0.86rem", margin: 0 }}>No driver defect reports for this vehicle.</p>
                  )}
                </div>
              </SectionCard>
            </div>

            {/* Stops timeline */}
            {data.stops.length > 0 && (
              <div className="content-card" style={{ marginTop: 14 }}>
                <div className="section-head">
                  <div>
                    <span className="card-label">Multi-stop delivery</span>
                    <h2 style={{ margin: "4px 0 0", fontSize: "1rem" }}>Stop timeline ({data.stops.length} stops)</h2>
                  </div>
                  <StatusPill tone="neutral">{data.stops.length} stops</StatusPill>
                </div>

                <div className="timeline-list">
                  {data.stops.map(stop => (
                    <div className="timeline-item" key={stop.id}>
                      <div>
                        <div className={`timeline-node ${stop.tone}`} style={{ display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.65rem", fontWeight: 800, color: "#fff" }}>
                          {STOP_TYPE_ICON[stop.type] || "●"}
                        </div>
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6, flexWrap: "wrap" }}>
                          <strong>Stop {stop.order} — {stop.type.charAt(0).toUpperCase() + stop.type.slice(1)}</strong>
                          <StatusPill tone={stop.tone}>{stop.status}</StatusPill>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 8 }}>
                          <div>
                            <span style={{ fontSize: "0.72rem", color: "#64748b", fontWeight: 700, textTransform: "uppercase" }}>Address</span>
                            <p style={{ margin: "2px 0 0", fontSize: "0.84rem", color: "#334155" }}>{stop.address}</p>
                          </div>
                          <div>
                            <span style={{ fontSize: "0.72rem", color: "#64748b", fontWeight: 700, textTransform: "uppercase" }}>Contact</span>
                            <p style={{ margin: "2px 0 0", fontSize: "0.84rem", color: "#334155" }}>{stop.contactName} {stop.contactPhone !== "—" ? `· ${stop.contactPhone}` : ""}</p>
                          </div>
                          <div>
                            <span style={{ fontSize: "0.72rem", color: "#64748b", fontWeight: 700, textTransform: "uppercase" }}>Planned arrival</span>
                            <p style={{ margin: "2px 0 0", fontSize: "0.84rem", color: "#334155" }}>{stop.plannedArrival}</p>
                          </div>
                          {stop.notes !== "—" && (
                            <div>
                              <span style={{ fontSize: "0.72rem", color: "#64748b", fontWeight: 700, textTransform: "uppercase" }}>Notes</span>
                              <p style={{ margin: "2px 0 0", fontSize: "0.84rem", color: "#334155" }}>{stop.notes}</p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </AdminWorkspaceLayout>
  );
}
