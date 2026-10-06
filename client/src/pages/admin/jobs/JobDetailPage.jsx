import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { addJobStop, cancelJob, deleteJob, deleteJobStop, getJobById, updateJobStatus } from "../../../api/jobApi";
import { subscribeJobUpdates } from "../../../api/realtime";
import { DeleteReasonModal } from "../../../components/DeleteReasonModal";
import { JobDeleteModal } from "./JobDeleteModal";
import { StateNotice } from "../../../components/StateNotice";
import { StatusPill } from "../../../components/StatusPill";
import { AdminWorkspaceLayout } from "../AdminWorkspaceLayout";
import { DelayTag, PointWarnings, PunctualityPill } from "./punctuality";

function DetailField({ label, value }) {
  return (
    <div style={{ padding: "11px 14px", background: "#FAFAFA", border: "1px solid #E9EBED", borderRadius: 8 }}>
      <span style={{ display: "block", fontSize: "0.7rem", fontWeight: 700, color: "#5F6B7A", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>{label}</span>
      <strong style={{ fontSize: "0.88rem", fontWeight: 600, color: "#0F141A" }}>{value || "—"}</strong>
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

const progressCell = { padding: "9px 10px", borderBottom: "1px solid #E9EBED", fontSize: "0.84rem", color: "#414D5C", verticalAlign: "top", whiteSpace: "nowrap" };
const progressHead = { ...progressCell, fontSize: "0.7rem", fontWeight: 800, color: "#5F6B7A", textTransform: "uppercase", textAlign: "left", background: "#FAFAFA" };

function TimeWithSource({ value, source }) {
  if (!value || value === "—") return <span style={{ color: "#8C8C94" }}>—</span>;
  const gps = source === "GPS";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <strong style={{ color: "#0F141A" }}>{value}</strong>
      <span
        title={gps ? "Recorded automatically by the driver app geofence" : "Recorded when the driver tapped the status in the app"}
        style={{ fontSize: "0.62rem", fontWeight: 800, padding: "2px 6px", borderRadius: 6, background: gps ? "#dcfce7" : "#e0f2fe", color: gps ? "#15803d" : "#0369a1" }}
      >
        {gps ? "GPS" : "DRIVER"}
      </span>
    </span>
  );
}

// Planned vs actual arrival/departure at every point, filled live from the driver app (taps and geofences).
function RouteProgressCard({ points, events }) {
  const [showLog, setShowLog] = useState(false);
  if (!points?.length) return null;
  const done = points.filter(p => p.status === "completed").length;
  return (
    <div className="content-card" style={{ marginTop: 14 }}>
      <div className="section-head">
        <div>
          <span className="card-label">Driver App · Live</span>
          <h2 style={{ margin: "4px 0 0", fontSize: "1rem" }}>Route Progress — Arrival &amp; Departure</h2>
        </div>
        <StatusPill tone={done === points.length ? "success" : "neutral"}>{done}/{points.length} completed</StatusPill>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={progressHead}>#</th>
              <th style={progressHead}>Point</th>
              <th style={progressHead}>Status</th>
              <th style={progressHead}>Planned Arrival</th>
              <th style={progressHead}>Actual Arrival</th>
              <th style={progressHead}>Planned Departure</th>
              <th style={progressHead}>Actual Departure</th>
            </tr>
          </thead>
          <tbody>
            {points.map((point, index) => (
              <tr key={point.key}>
                <td style={progressCell}><strong>{point.kind === "pickup" ? "C" : point.kind === "return" ? "R" : point.kind === "waypoint" ? "W" : point.label.replace("Drop ", "")}</strong></td>
                <td style={{ ...progressCell, whiteSpace: "normal", minWidth: 200 }}>
                  <strong style={{ color: "#0F141A" }}>{point.label}</strong>
                  <div style={{ color: "#5F6B7A", fontSize: "0.78rem", marginTop: 2 }}>{point.address}</div>
                  <PointWarnings point={point} />
                </td>
                <td style={progressCell}><StatusPill tone={point.tone}>{point.statusLabel}</StatusPill></td>
                <td style={progressCell}>{point.plannedArrival}</td>
                <td style={progressCell}><TimeWithSource value={point.actualArrival} source={point.arrivalSource} /><DelayTag mins={point.arrivalDelayMins} overdue={point.overdue?.type === "arrival" ? point.overdue : null} /></td>
                <td style={progressCell}>{point.plannedDeparture}</td>
                <td style={progressCell}><TimeWithSource value={point.actualDeparture} source={point.departureSource} /><DelayTag mins={point.departureDelayMins} overdue={point.overdue?.type === "departure" ? point.overdue : null} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ color: "#5F6B7A", fontSize: "0.78rem", margin: "10px 0 0" }}>
        All times UK (GMT/BST). <strong>GPS</strong> = recorded automatically when the vehicle entered or left the stop area; <strong>DRIVER</strong> = recorded when the driver confirmed in the app.
      </p>
      {events?.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <button className="header-action-button" type="button" onClick={() => setShowLog(v => !v)}>
            {showLog ? "Hide GPS log" : `Show GPS log (${events.length})`}
          </button>
          {showLog && (
            <div style={{ overflowX: "auto", marginTop: 8 }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={progressHead}>Time (UK)</th>
                    <th style={progressHead}>Point</th>
                    <th style={progressHead}>Event</th>
                    <th style={progressHead}>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((event, index) => (
                    <tr key={index}>
                      <td style={progressCell}>{event.at}</td>
                      <td style={progressCell}>{event.point}</td>
                      <td style={progressCell}>{event.event}</td>
                      <td style={{ ...progressCell, whiteSpace: "normal", color: event.applied ? "#15803d" : "#5F6B7A" }}>
                        {event.applied ? `Recorded · ${event.note}` : `Ignored · ${event.note}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function JobDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");
  const [updating, setUpdating] = useState(false);
  const [blockReason, setBlockReason] = useState("");
  const [showBlockInput, setShowBlockInput] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showAddStop, setShowAddStop] = useState(false);
  const [newStop, setNewStop] = useState({ address: "", stop_type: "delivery", contact_name: "", contact_phone: "", planned_arrival: "", notes: "" });
  const [stopSaving, setStopSaving] = useState(false);
  const [stopRemoving, setStopRemoving] = useState(null);
  const [proofPreview, setProofPreview] = useState(null);

  const loadingRef = useRef(0);

  function load() {
    const version = ++loadingRef.current;
    getJobById(id)
      .then(r => { if (version === loadingRef.current) { setData(r.data); setError(''); } })
      .catch(() => { if (version === loadingRef.current) setError("Could not load job details."); })
      .finally(() => { if (version === loadingRef.current) setLoading(false); });
  }

  useEffect(() => { load(); }, [id]);

  // Realtime: re-fetch when driver updates this job's status or POD is submitted
  useEffect(() => {
    function handleJobUpdate(payload) {
      if (payload?.jobId && Number(payload.jobId) !== Number(id)) return;
      load();
    }
    return subscribeJobUpdates(handleJobUpdate);
  }, [id]);

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

  async function handleCancel(payload) {
    setUpdating(true);
    try {
      await cancelJob(id, payload);
      setShowCancelModal(false);
      load();
    } catch {
      alert("Could not cancel job.");
    } finally {
      setUpdating(false);
    }
  }

  async function handleDelete(payload) {
    setUpdating(true);
    try {
      await deleteJob(id, payload);
      setShowDeleteModal(false);
      navigate("/admin/jobs");
    } catch (err) {
      setShowDeleteModal(false);
      alert(err?.response?.data?.message || "Could not delete job.");
    } finally {
      setUpdating(false);
    }
  }

  async function handleAddStop(e) {
    e.preventDefault();
    if (!newStop.address.trim()) return;
    setStopSaving(true);
    try {
      await addJobStop(id, newStop);
      setNewStop({ address: "", stop_type: "delivery", contact_name: "", contact_phone: "", planned_arrival: "", notes: "" });
      setShowAddStop(false);
      load();
    } catch {
      alert("Could not add stop. Please try again.");
    } finally {
      setStopSaving(false);
    }
  }

  async function handleRemoveStop(stopId) {
    setStopRemoving(stopId);
    try {
      await deleteJobStop(id, stopId);
      load();
    } catch {
      alert("Could not remove stop. Please try again.");
    } finally {
      setStopRemoving(null);
    }
  }

  const nextStep = data ? STATUS_FLOW.find(s => s.from === data.status) : null;
  const canBlock = data && !["completed", "blocked"].includes(data.status);

  return (
    <AdminWorkspaceLayout
      badge="Job Management"
      title={data ? `Job ${data.code}` : "Job Details"}
      description="Full job profile with route, load, driver, vehicle, and stop information."
      highlights={[]}
    >
      <div style={{ maxWidth: 960 }}>
        {/* Back + actions */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, gap: 12, flexWrap: "wrap" }}>
          <button className="af-back-btn" type="button" onClick={() => navigate("/admin/jobs")}>
            ← Back To Jobs
          </button>
          {data && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="header-action-button" type="button" onClick={() => navigate(`/admin/jobs/${id}/edit`)}>
                Edit Job
              </button>
              {canBlock && !showBlockInput && (
                <button className="header-action-button danger" type="button" onClick={() => setShowBlockInput(true)}>
                  Block Job
                </button>
              )}
              {data.status === "planned" && (
                <button className="header-action-button danger" type="button" onClick={() => setShowCancelModal(true)}>
                  Cancel Job
                </button>
              )}
              {!["loading", "active"].includes(data.status) && (
                <button className="header-action-button danger" type="button" onClick={() => setShowDeleteModal(true)}>
                  Delete Job
                </button>
              )}
            </div>
          )}
        </div>

        <StateNotice loading={loading} error={error} />

        {data && (
          <>
            {/* Status bar */}
            <div style={{ background: "#fff", border: "1px solid #E9EBED", borderRadius: 14, padding: "18px 22px", marginBottom: 14, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap", boxShadow: "0 1px 3px rgba(15,23,42,0.05)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
                <div>
                  <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "#5F6B7A", textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 4 }}>Job Status</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <StatusPill tone={data.statusTone}>{data.status}</StatusPill>
                    <StatusPill tone={data.priorityTone}>{data.priority} priority</StatusPill>
                    <StatusPill tone="neutral">POD: {data.podStatus}</StatusPill>
                    <PunctualityPill summary={data.punctuality} />
                    {data.driverExecution?.statusLabel && data.driverExecution.statusLabel !== "—" && (
                      <StatusPill tone={data.driverExecution?.statusTone || "neutral"}>
                        Driver: {data.driverExecution.statusLabel}
                      </StatusPill>
                    )}
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
                          background: done ? "#037F0C" : current ? "#0972D3" : "#E9EBED",
                          color: done || current ? "#fff" : "#8C8C94",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: "0.7rem", fontWeight: 700
                        }}>
                          {done ? "✓" : stepIdx + 1}
                        </div>
                        <span style={{ fontSize: "0.72rem", color: current ? "#0972D3" : done ? "#037F0C" : "#8C8C94", fontWeight: current || done ? 700 : 400, textTransform: "capitalize" }}>
                          {s}
                        </span>
                        {i < arr.length - 1 && <div style={{ width: 20, height: 2, background: done ? "#037F0C" : "#E9EBED", borderRadius: 2, marginLeft: 2 }} />}
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
                    style={{ background: nextStep.tone === "success" ? "#026A0A" : "#E8A300" }}
                    onClick={() => handleStatusChange(nextStep.next)}
                  >
                    {updating ? "Updating..." : nextStep.action + " →"}
                  </button>
                )}
                {data.status === "blocked" && (
                  <button className="header-action-button" type="button" onClick={() => handleStatusChange("planned")}>
                    Reset To Planned
                  </button>
                )}
              </div>
            </div>

            {/* Block reason input */}
            {showBlockInput && (
              <div style={{ background: "#fff8f8", border: "1px solid rgba(217, 21, 21,0.2)", borderRadius: 12, padding: "16px 20px", marginBottom: 14 }}>
                <p style={{ margin: "0 0 10px", fontSize: "0.86rem", fontWeight: 600, color: "#AD0A0A" }}>Block Reason</p>
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
              <div style={{ background: "#fff8f8", border: "1px solid rgba(217, 21, 21,0.2)", borderRadius: 12, padding: "14px 18px", marginBottom: 14 }}>
                <strong style={{ fontSize: "0.84rem", color: "#AD0A0A" }}>
                  {data.failedDeliveryReason ? "Failed Delivery Reason" : data.cancellationReason ? "Cancellation Reason" : "Delay Reason"}:
                </strong>
                <span style={{ fontSize: "0.84rem", color: "#414D5C", marginLeft: 8 }}>
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
              <SectionCard label="Load Details" title={`${LOAD_ICONS[data.load.type] || "📦"} ${data.load.type} load`}>
                <div className="detail-grid">
                  <DetailField label="Reference" value={data.load.reference} />
                  <DetailField label="Load ID" value={data.load.loadId} />
                  <DetailField label="Weight"      value={data.load.weightKg} />
                  <DetailField label="Volume"      value={data.load.volumeCbm} />
                  <DetailField label="Vehicle Requirement" value={data.load.vehicleRequirement} />
                  <DetailField label="Freight"     value={data.load.freight} />
                  <div className="detail-wide"><DetailField label="Description" value={data.load.description} /></div>
                  {data.specialInstructions && (
                    <div className="detail-wide"><DetailField label="Special Instructions" value={data.specialInstructions} /></div>
                  )}
                </div>
              </SectionCard>

              {/* Route & Schedule */}
              <SectionCard label="Route & Schedule" title={data.route.from && data.route.to ? `${data.route.from} → ${data.route.to}` : "Custom Route"}>
                <div className="detail-grid">
                  <DetailField label="Pickup Address"  value={data.route.pickupAddress || data.route.from} />
                  <DetailField label="Drop Address"    value={data.route.dropAddress || data.route.to} />
                  <DetailField label="Collection Arrival (UK)" value={data.schedule.collectionArrival} />
                  <DetailField label="Actual Collection Arrival (UK)" value={data.schedule.actualCollectionArrival} />
                  <DetailField label="Collection Departure (UK)" value={data.schedule.collectionDeparture} />
                  <DetailField label="Planned Delivery Arrival (UK)" value={data.schedule.plannedDeliveryArrival} />
                  <DetailField label="Planned Delivery Departure (UK)" value={data.schedule.plannedDeliveryDeparture} />
                  <DetailField label="Delivery Deadline" value={data.schedule.deliveryDeadline} />
                  <DetailField label="Current ETA (UK)" value={data.schedule.eta} />
                  <DetailField label="Actual Collection Departure (UK)" value={data.schedule.actualDeparture} />
                  <DetailField label="Actual Delivery Arrival (UK)" value={data.schedule.actualArrival} />
                  {data.schedule.dockWindow !== "—" && (
                    <DetailField label="Dock Window" value={data.schedule.dockWindow} />
                  )}
                  {data.route.distanceKm && (
                    <DetailField label="Distance" value={`${Math.round(data.route.distanceKm * 0.621371)} mi`} />
                  )}
                </div>
              </SectionCard>

              {/* Driver & Vehicle */}
              <SectionCard label="Dispatch" title="Driver, Truck & Trailer">
                {data.driver ? (
                  <div className="detail-grid" style={{ marginBottom: data.vehicle ? 12 : 0 }}>
                    <DetailField label="Driver Name"   value={data.driver.name} />
                    <DetailField label="Employee Code" value={data.driver.employeeCode} />
                    <DetailField label="Phone"         value={data.driver.phone} />
                    <DetailField label="Licence"       value={data.driver.license} />
                    <DetailField label="Compliance"    value={data.driver.compliance} />
                  </div>
                ) : (
                  <p style={{ color: "#8C8C94", fontSize: "0.86rem", marginBottom: data.vehicle ? 12 : 0 }}>No driver assigned yet.</p>
                )}
                {data.vehicle && (
                  <>
                    <div style={{ height: 1, background: "#E9EBED", margin: "12px 0" }} />
                    <div className="detail-grid">
                      <DetailField label="Registration" value={data.vehicle.registration} />
                      <DetailField label="Model"        value={data.vehicle.model} />
                      <DetailField label="Type"         value={data.vehicle.type} />
                      <DetailField label="Fleet Code"   value={data.vehicle.fleetCode} />
                      <DetailField label="Capacity"     value={data.vehicle.capacity} />
                    </div>
                  </>
                )}
                {data.trailer && (
                  <>
                    <div style={{ height: 1, background: "#E9EBED", margin: "12px 0" }} />
                    <div className="detail-grid">
                      <DetailField label="Trailer Registration" value={data.trailer.registration} />
                      <DetailField label="Trailer Code" value={data.trailer.code} />
                      <DetailField label="Trailer Type" value={data.trailer.type} />
                      <DetailField label="Trailer Capacity" value={data.trailer.capacity} />
                    </div>
                  </>
                )}
                {!data.driver && !data.vehicle && !data.trailer && (
                  <div style={{ display: "flex", justifyContent: "center" }}>
                    <button className="header-action-button" type="button" onClick={() => navigate(`/admin/jobs/${id}/edit`)}>
                      Assign Driver, Truck & Trailer →
                    </button>
                  </div>
                )}
              </SectionCard>

              <SectionCard label="Dispatcher Notes" title="Internal Execution Notes">
                <DetailField label="Notes" value={data.dispatcherNotes} />
              </SectionCard>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 14 }}>
              <SectionCard
                label="Driver Execution"
                title="Browser Updates From Driver"
                badge={data.driverExecution?.statusLabel}
                badgeTone={data.driverExecution?.statusTone}
              >
                <div className="detail-grid">
                  <DetailField label="Driver Status" value={data.driverExecution?.statusLabel} />
                  <DetailField label="POD Status" value={data.proofOfDelivery?.status} />
                  <div className="detail-wide">
                    <DetailField label="Delivery Notes" value={data.driverExecution?.deliveryNotes} />
                  </div>
                  {data.driverExecution?.failedDeliveryReason !== "—" && (
                    <div className="detail-wide">
                      <DetailField label="Failed Delivery Reason" value={data.driverExecution.failedDeliveryReason} />
                    </div>
                  )}
                </div>
              </SectionCard>

              <SectionCard label="Proof Of Delivery" title="Driver Submitted POD" badge={`POD: ${data.proofOfDelivery?.status || "pending"}`} badgeTone={data.proofOfDelivery?.status === "verified" ? "success" : data.proofOfDelivery?.status === "uploaded" ? "warning" : "neutral"}>
                <div className="pod-preview-grid">
                  <div>
                    <span className="card-label">Signature</span>
                    {data.proofOfDelivery?.signatureData ? (
                      <button
                        className="pod-proof-thumb"
                        type="button"
                        onClick={() => setProofPreview({ title: "Driver Signature", src: data.proofOfDelivery.signatureData })}
                      >
                        <img alt="Driver signature proof" src={data.proofOfDelivery.signatureData} />
                      </button>
                    ) : (
                      <p>No signature uploaded.</p>
                    )}
                  </div>
                  <div>
                    <span className="card-label">Delivery Photo</span>
                    {data.proofOfDelivery?.photoData ? (
                      <button
                        className="pod-proof-thumb"
                        type="button"
                        onClick={() => setProofPreview({ title: "Delivery Photo", src: data.proofOfDelivery.photoData })}
                      >
                        <img alt="Delivery proof" src={data.proofOfDelivery.photoData} />
                      </button>
                    ) : (
                      <p>No delivery photo uploaded.</p>
                    )}
                  </div>
                </div>
              </SectionCard>
            </div>

            {proofPreview && (
              <div className="pod-lightbox" role="dialog" aria-modal="true" aria-label={proofPreview.title} onClick={() => setProofPreview(null)}>
                <div className="pod-lightbox-panel" onClick={e => e.stopPropagation()}>
                  <div className="pod-lightbox-head">
                    <strong>{proofPreview.title}</strong>
                    <div>
                      <a className="header-action-button" href={proofPreview.src} target="_blank" rel="noreferrer">Open</a>
                      <button className="header-action-button danger" type="button" onClick={() => setProofPreview(null)}>Close</button>
                    </div>
                  </div>
                  <img alt={proofPreview.title} src={proofPreview.src} />
                </div>
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 14 }}>
              <SectionCard label="Driver Expenses" title="Fuel And Trip Costs" badge={`${data.driverExpenses?.length || 0} entries`} badgeTone="neutral">
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
                    <p style={{ color: "#8C8C94", fontSize: "0.86rem", margin: 0 }}>No expenses submitted for this job.</p>
                  )}
                </div>
              </SectionCard>

              <SectionCard label="Vehicle Defects" title="Driver Defect Reports" badge={`${data.vehicleDefects?.length || 0} reports`} badgeTone={(data.vehicleDefects || []).some(d => d.tone === "danger") ? "danger" : "neutral"}>
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
                    <p style={{ color: "#8C8C94", fontSize: "0.86rem", margin: 0 }}>No driver defect reports for this vehicle.</p>
                  )}
                </div>
              </SectionCard>
            </div>

            <RouteProgressCard points={data.routeProgress} events={data.geofenceEvents} />

            {/* Stops timeline */}
            <div className="content-card" style={{ marginTop: 14 }}>
              <div className="section-head">
                <div>
                  <span className="card-label">Multi-Stop Route</span>
                  <h2 style={{ margin: "4px 0 0", fontSize: "1rem" }}>
                    Stop Timeline
                    {data.stops.length > 0 && ` (${data.stops.length} stops)`}
                  </h2>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {data.stops.length > 0 && <StatusPill tone="neutral">{data.stops.length} stops</StatusPill>}
                  {!["completed", "blocked", "cancelled"].includes(data.status) && (
                    <button className="header-action-button" type="button" onClick={() => setShowAddStop(v => !v)}>
                      {showAddStop ? "Cancel" : "+ Add Stop"}
                    </button>
                  )}
                </div>
              </div>

              {/* Inline add-stop form */}
              {showAddStop && (
                <form onSubmit={handleAddStop} style={{ background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 10, padding: "14px 16px", marginBottom: 14 }}>
                  <p style={{ margin: "0 0 10px", fontSize: "0.84rem", fontWeight: 700, color: "#0369a1" }}>New Stop Details</p>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 10 }}>
                    <div>
                      <label style={{ fontSize: "0.72rem", fontWeight: 700, color: "#5F6B7A", textTransform: "uppercase", display: "block", marginBottom: 4 }}>Stop Type</label>
                      <select className="af-select" value={newStop.stop_type} onChange={e => setNewStop(p => ({ ...p, stop_type: e.target.value }))}>
                        <option value="delivery">Delivery</option>
                        <option value="pickup">Pickup</option>
                        <option value="waypoint">Waypoint</option>
                      </select>
                    </div>
                    <div>
                      <label style={{ fontSize: "0.72rem", fontWeight: 700, color: "#5F6B7A", textTransform: "uppercase", display: "block", marginBottom: 4 }}>Planned Arrival</label>
                      <input className="af-input" style={{ margin: 0 }} type="datetime-local" value={newStop.planned_arrival} onChange={e => setNewStop(p => ({ ...p, planned_arrival: e.target.value }))} />
                    </div>
                    <div style={{ gridColumn: "1 / -1" }}>
                      <label style={{ fontSize: "0.72rem", fontWeight: 700, color: "#5F6B7A", textTransform: "uppercase", display: "block", marginBottom: 4 }}>Address <span style={{ color: "#D91515" }}>*</span></label>
                      <textarea className="af-input" style={{ margin: 0, minHeight: 60, resize: "vertical" }} placeholder="Full address for this stop" required value={newStop.address} onChange={e => setNewStop(p => ({ ...p, address: e.target.value }))} />
                    </div>
                    <div>
                      <label style={{ fontSize: "0.72rem", fontWeight: 700, color: "#5F6B7A", textTransform: "uppercase", display: "block", marginBottom: 4 }}>Contact Name</label>
                      <input className="af-input" style={{ margin: 0 }} type="text" placeholder="e.g. John Smith" value={newStop.contact_name} onChange={e => setNewStop(p => ({ ...p, contact_name: e.target.value }))} />
                    </div>
                    <div>
                      <label style={{ fontSize: "0.72rem", fontWeight: 700, color: "#5F6B7A", textTransform: "uppercase", display: "block", marginBottom: 4 }}>Contact Phone</label>
                      <input className="af-input" style={{ margin: 0 }} type="tel" placeholder="e.g. 07700 900123" value={newStop.contact_phone} onChange={e => setNewStop(p => ({ ...p, contact_phone: e.target.value }))} />
                    </div>
                    <div style={{ gridColumn: "1 / -1" }}>
                      <label style={{ fontSize: "0.72rem", fontWeight: 700, color: "#5F6B7A", textTransform: "uppercase", display: "block", marginBottom: 4 }}>Notes</label>
                      <input className="af-input" style={{ margin: 0 }} type="text" placeholder="Any special instructions for this stop" value={newStop.notes} onChange={e => setNewStop(p => ({ ...p, notes: e.target.value }))} />
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
                    <button type="button" className="header-action-button" onClick={() => setShowAddStop(false)}>Cancel</button>
                    <button type="submit" className="af-submit-btn" disabled={stopSaving} style={{ background: "#0972D3" }}>
                      {stopSaving ? "Saving..." : "Add Stop →"}
                    </button>
                  </div>
                  {data.driver && (
                    <p style={{ margin: "8px 0 0", fontSize: "0.78rem", color: "#0369a1" }}>
                      Driver {data.driver.name} will be notified automatically when this stop is saved.
                    </p>
                  )}
                </form>
              )}

              {data.stops.length === 0 && !showAddStop && (
                <p style={{ color: "#8C8C94", fontSize: "0.86rem", margin: 0 }}>No intermediate stops on this job. Click "+ Add stop" to add waypoints, extra pickups, or delivery stops.</p>
              )}

              {data.stops.length > 0 && (
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
                          {stop.status === "pending" && !["completed", "blocked", "cancelled"].includes(data.status) && (
                            <button
                              className="header-action-button danger"
                              type="button"
                              style={{ padding: "3px 8px", fontSize: "0.72rem" }}
                              disabled={stopRemoving === stop.id}
                              onClick={() => handleRemoveStop(stop.id)}
                            >
                              {stopRemoving === stop.id ? "..." : "Remove"}
                            </button>
                          )}
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 8 }}>
                          <div>
                            <span style={{ fontSize: "0.72rem", color: "#5F6B7A", fontWeight: 700, textTransform: "uppercase" }}>Address</span>
                            <p style={{ margin: "2px 0 0", fontSize: "0.84rem", color: "#414D5C" }}>{stop.address}</p>
                          </div>
                          <div>
                            <span style={{ fontSize: "0.72rem", color: "#5F6B7A", fontWeight: 700, textTransform: "uppercase" }}>Contact</span>
                            <p style={{ margin: "2px 0 0", fontSize: "0.84rem", color: "#414D5C" }}>{stop.contactName} {stop.contactPhone !== "—" ? `· ${stop.contactPhone}` : ""}</p>
                          </div>
                          <div>
                            <span style={{ fontSize: "0.72rem", color: "#5F6B7A", fontWeight: 700, textTransform: "uppercase" }}>Planned Arrival</span>
                            <p style={{ margin: "2px 0 0", fontSize: "0.84rem", color: "#414D5C" }}>{stop.plannedArrival}</p>
                          </div>
                          <div>
                            <span style={{ fontSize: "0.72rem", color: "#5F6B7A", fontWeight: 700, textTransform: "uppercase" }}>Planned Departure</span>
                            <p style={{ margin: "2px 0 0", fontSize: "0.84rem", color: "#414D5C" }}>{stop.plannedDeparture}</p>
                          </div>
                          <div>
                            <span style={{ fontSize: "0.72rem", color: "#5F6B7A", fontWeight: 700, textTransform: "uppercase" }}>Actual Arrival</span>
                            <p style={{ margin: "2px 0 0", fontSize: "0.84rem", color: "#414D5C" }}>{stop.actualArrival}</p>
                          </div>
                          <div>
                            <span style={{ fontSize: "0.72rem", color: "#5F6B7A", fontWeight: 700, textTransform: "uppercase" }}>Actual Departure</span>
                            <p style={{ margin: "2px 0 0", fontSize: "0.84rem", color: "#414D5C" }}>{stop.actualDeparture}</p>
                          </div>
                          {stop.notes !== "—" && (
                            <div>
                              <span style={{ fontSize: "0.72rem", color: "#5F6B7A", fontWeight: 700, textTransform: "uppercase" }}>Notes</span>
                              <p style={{ margin: "2px 0 0", fontSize: "0.84rem", color: "#414D5C" }}>{stop.notes}</p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
      <DeleteReasonModal
        open={showCancelModal}
        title="Cancel Job"
        recordLabel={data ? data.code : ""}
        body="The job will be blocked, its vehicle and trailer will be released, and this reason will be visible to admin."
        confirmLabel="Cancel Job"
        loading={updating}
        onCancel={() => setShowCancelModal(false)}
        onConfirm={handleCancel}
      />
      <JobDeleteModal
        job={showDeleteModal && data ? { id, code: data.code, customer: data.customer?.name } : null}
        loading={updating}
        onCancel={() => setShowDeleteModal(false)}
        onConfirm={handleDelete}
      />
    </AdminWorkspaceLayout>
  );
}
