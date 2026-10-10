import { useEffect, useMemo, useRef, useState } from "react";
import { DelayTag, PointWarnings, PunctualityPill, delayTone, punctualityPoint } from "./punctuality";
import { useNavigate } from "react-router-dom";
import { getDriverChats } from "../../../api/adminApi";
import { getRealtimeSocket, joinAdminChatRoom, leaveAdminChatRoom, subscribeJobUpdates } from "../../../api/realtime";
import { addJobNote, cancelJob, deleteJob, getJobNotes, getJobs, replaceJobVehicle, updateJobAssignment, updateJobStatus } from "../../../api/jobApi";
import { DeleteReasonModal } from "../../../components/DeleteReasonModal";
import { JobDeleteModal } from "./JobDeleteModal";
import { StateNotice } from "../../../components/StateNotice";
import { StatusPill } from "../../../components/StatusPill";
import { DriverChatWidget } from "../DriverChatWidget";
import { AdminWorkspaceLayout } from "../AdminWorkspaceLayout";
import { getAuthSession } from "../../../utils/authSession";
import { formatUkWall, ukMinutes, ukNow } from "../../../utils/ukJobTime";
import JobRouteMapModal from "./JobRouteMapModal";
import "./JobsListPage.css";
import { ImportJobsModal } from "./ImportJobsModal";
import { JobStopsEditor } from "./JobStopsEditor";

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "planned", label: "Planned" },
  { value: "loading", label: "Loading" },
  { value: "active", label: "Active" },
  { value: "completed", label: "Completed" },
  { value: "blocked", label: "Blocked" },
  { value: "failed", label: "Failed" },
  { value: "cancelled", label: "Cancelled" }
];

const PRIORITY_OPTIONS = [
  { value: "", label: "All priorities" },
  { value: "standard", label: "Standard" },
  { value: "priority", label: "Priority" },
  { value: "critical", label: "Critical" }
];

const SORT_OPTIONS = [
  { value: "date_asc", label: "Start date ↑" },
  { value: "date_desc", label: "Start date ↓" },
  { value: "freight_desc", label: "Freight (High–Low)" },
  { value: "freight_asc", label: "Freight (Low–High)" },
  { value: "driver", label: "Driver A–Z" },
  { value: "customer", label: "Customer A–Z" },
  { value: "status", label: "Status" }
];

const DRIVER_STATUS_LABEL = {
  offered: "Offered", accepted: "Accepted", arrived_pickup: "At pickup",
  loaded: "Loaded", in_transit: "In transit", arrived_drop: "At drop",
  delivered: "Delivered", failed_delivery: "Failed", declined: "Declined"
};

const DRIVER_STATUS_TONE = {
  offered: "warning", accepted: "neutral", arrived_pickup: "warning",
  loaded: "warning", in_transit: "success", arrived_drop: "warning",
  delivered: "success", failed_delivery: "danger", declined: "danger"
};

const STOP_STATUS_TONE = {
  pending: "warning",
  arrived: "warning",
  completed: "success",
  skipped: "neutral"
};

const JOB_TABS = [
  { key: "upcoming", label: "Upcoming" },
  { key: "intransit", label: "In transit" },
  { key: "completed", label: "Completed" },
  { key: "history", label: "All jobs" }
];

const TAB_STATUSES = {
  upcoming: ["planned", "loading"],
  intransit: ["active"],
  completed: ["completed"],
  history: ["planned", "loading", "active", "completed", "blocked", "failed", "cancelled"]
};

const STATUS_TONE = {
  planned: "neutral", loading: "warning", active: "success",
  completed: "neutral", blocked: "danger", failed: "danger", cancelled: "neutral"
};

const PRIORITY_TONE = { standard: "neutral", priority: "warning", critical: "danger" };

function getWeekRange(offset = 0) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date()).filter(part => part.type !== "literal").map(part => [part.type, part.value]));
  const today = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)));
  const day = today.getUTCDay();
  const monday = new Date(today);
  monday.setUTCDate(today.getUTCDate() - (day === 0 ? 6 : day - 1) + offset * 7);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return { start: monday.toISOString().slice(0, 10), end: sunday.toISOString().slice(0, 10) };
}

function fmtWeekLabel(start, end) {
  const opts = { day: "numeric", month: "short" };
  const format = value => new Date(`${value}T12:00:00Z`).toLocaleDateString("en-GB", { ...opts, timeZone: "UTC" });
  return `${format(start)} – ${format(end)}`;
}

function toDateInputValue(rawStr) {
  if (!rawStr) return "";
  const match = String(rawStr).match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] || "";
}

function fmtDateInputLabel(value) {
  if (!value) return "";
  const [year, month, day] = value.split("-").map(Number);
  const d = new Date(year, month - 1, day);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function abbrevAddr(addr) {
  if (!addr || addr === "—") return "—";
  return addr.split(",")[0].trim();
}

function extractUkPostcode(addr) {
  if (!addr || addr === "—") return "—";
  const text = String(addr).toUpperCase().replace(/\s+/g, " ");
  const match = text.match(/\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/);
  return match ? match[1].replace(/\s+/g, "") : abbrevAddr(addr);
}

function driverTone(driver, assigned) {
  if (!assigned) return "neutral";
  if (!driver) return "warning";
  if (driver.compliance_status === "blocked") return "danger";
  if (driver.shift_status === "ready") return "success";
  return "warning";
}

function vehicleTone(vehicle, assigned) {
  if (!assigned) return "neutral";
  if (!vehicle) return "warning";
  if (["maintenance", "stopped"].includes(vehicle.status)) return "danger";
  if (vehicle.status === "available") return "success";
  return "warning";
}

function trolleyTone(trolley, assigned) {
  if (!assigned) return "neutral";
  if (!trolley) return "warning";
  if (trolley.status === "maintenance") return "danger";
  if (trolley.status === "available") return "success";
  return "warning";
}

function isPodPending(job) {
  return job.status === "completed" &&
    !["uploaded", "verified"].includes(String(job.podStatus || "").toLowerCase());
}

function fmtMins(mins) {
  if (!mins) return "—";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function fmtTimeFull(rawStr) {
  return formatUkWall(rawStr);
}

function fmtRouteStamp(rawStr, fallback = "") {
  if (rawStr) return formatUkWall(rawStr);
  return fallback && fallback !== "—" ? fallback : "TBD";
}

function fmtGBP(n) {
  return `£${Number(n).toFixed(2)}`;
}

function sortJobs(jobs, sortBy) {
  const arr = [...jobs];
  switch (sortBy) {
    case "date_asc":   return arr.sort((a, b) => (a.departureRaw || "").localeCompare(b.departureRaw || ""));
    case "date_desc":  return arr.sort((a, b) => (b.departureRaw || "").localeCompare(a.departureRaw || ""));
    case "freight_desc": return arr.sort((a, b) => Number(b.freightValue || 0) - Number(a.freightValue || 0));
    case "freight_asc":  return arr.sort((a, b) => Number(a.freightValue || 0) - Number(b.freightValue || 0));
    case "driver":     return arr.sort((a, b) => (a.driver || "").localeCompare(b.driver || ""));
    case "customer":   return arr.sort((a, b) => (a.customer || "").localeCompare(b.customer || ""));
    case "status":     return arr.sort((a, b) => (a.status || "").localeCompare(b.status || ""));
    default:           return arr;
  }
}

function exportCsv(name, rows) {
  const csv = rows.map(row => row.map(v => `"${String(v ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

function JobDetailsModal({ job, onClose }) {
  const [tab, setTab] = useState(job._openTab || "notes");
  const [notes, setNotes] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [authorName, setAuthorName] = useState(() => getAuthSession()?.name || "");
  const [saving, setSaving] = useState(false);
  const [noteError, setNoteError] = useState("");

  useEffect(() => {
    getJobNotes(job.id).then(res => setNotes(res.data.notes || [])).catch(() => {});
  }, [job.id]);

  async function submitNote(e) {
    e.preventDefault();
    if (!noteText.trim()) return;
    setSaving(true);
    setNoteError("");
    try {
      await addJobNote(job.id, { note_text: noteText.trim(), author_name: authorName.trim() || "Admin" });
      const res = await getJobNotes(job.id);
      setNotes(res.data.notes || []);
      setNoteText("");
      setShowForm(false);
    } catch (err) {
      setNoteError(err?.response?.data?.message || "Could not add note.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="relay-modal-overlay" onClick={onClose}>
      <div className="rjd-modal" onClick={e => e.stopPropagation()}>
        <div className="rjd-modal-head">
          <span className="rjd-modal-title">Job {job.code} details</span>
          <button className="rjd-modal-close" type="button" onClick={onClose}>✕</button>
        </div>

        <div className="rjd-tabs">
          <button className={tab === "payout" ? "active" : ""} type="button" onClick={() => setTab("payout")}>Cost & contribution</button>
          <button className={tab === "notes" ? "active" : ""} type="button" onClick={() => setTab("notes")}>Notes</button>
          <button className={tab === "shipment" ? "active" : ""} type="button" onClick={() => setTab("shipment")}>Shipment Details</button>
        </div>

        <div className="rjd-modal-body">
          {tab === "payout" && (
            <div className="rjd-payout-section">
              {job.economics ? (
                <>
                  <table className="rjd-payout-table">
                    <thead>
                      <tr><th>Cost Item</th><th>Amount</th></tr>
                    </thead>
                    <tbody>
                      <tr><td>Fuel Cost ({job.economics.fuelSource === "receipts" ? "receipts" : "estimate"})</td><td>£{Number(job.economics.fuelCost || 0).toFixed(2)}</td></tr>
                      <tr><td>Driver Cost</td><td>£{Number(job.economics.driverCost || 0).toFixed(2)}</td></tr>
                      <tr><td>Fleet Cost</td><td>£{Number(job.economics.fleetCost || 0).toFixed(2)}</td></tr>
                      {Number(job.economics.recordedExpenses || 0) > 0 && <tr><td>Other Driver Expenses</td><td>£{Number(job.economics.recordedExpenses).toFixed(2)}</td></tr>}
                      <tr className="rjd-payout-subtotal"><td><strong>Total Cost</strong></td><td><strong>£{Number(job.economics.totalCost || 0).toFixed(2)}</strong></td></tr>
                      <tr><td>Suggested Price</td><td>£{Number(job.economics.suggestedPrice || 0).toFixed(2)}</td></tr>
                      <tr><td>Freight Charged</td><td>{job.freight || "—"}</td></tr>
                    </tbody>
                  </table>
                  <div className={`rjd-payout-pl ${job.isProfitable === true ? "profit" : job.isProfitable === false ? "loss" : ""}`}>
                    <span>{job.isProfitable == null ? "Contribution unavailable" : `${job.economics.basis === "actual" ? "Actual" : "Estimated"} Contribution ${job.isProfitable ? "Profit" : "Loss"}`}</span>
                    <strong>
                      {job.profitLossValue !== null && job.profitLossValue !== undefined
                        ? `${job.profitLossValue >= 0 ? "+" : "-"}£${Math.abs(job.profitLossValue).toFixed(2)}`
                        : "—"}
                    </strong>
                  </div>
                </>
              ) : (
                <table className="rjd-payout-table">
                  <thead>
                    <tr><th>ID</th><th>Freight Charged</th><th>Total</th></tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>{job.code}</td>
                      <td>{job.freight || "—"}</td>
                      <td>{job.freight || "—"}</td>
                    </tr>
                    <tr className="rjd-payout-total">
                      <td></td>
                      <td><strong>Estimated payout</strong></td>
                      <td><strong>{job.freight || "—"}</strong></td>
                    </tr>
                  </tbody>
                </table>
              )}
            </div>
          )}

          {tab === "notes" && (
            <div className="rjd-notes-tab">
              {!showForm && (
                <button className="rjd-add-note-btn" type="button" onClick={() => setShowForm(true)}>
                  + Add a note
                </button>
              )}
              {showForm && (
                <form className="rjd-note-form" onSubmit={submitNote}>
                  <div className="rjd-note-form-field">
                    <label className="rjd-note-form-label">Load</label>
                    <div className="rjd-note-load-display">{job.code}</div>
                  </div>
                  <input
                    className="rjd-note-author-input"
                    placeholder="Your name"
                    value={authorName}
                    onChange={e => setAuthorName(e.target.value)}
                    required
                  />
                  <textarea
                    className="rjd-note-textarea"
                    placeholder="Type your note here"
                    value={noteText}
                    onChange={e => setNoteText(e.target.value)}
                    rows={3}
                    required
                  />
                  {noteError && <p className="relay-note-error">{noteError}</p>}
                  <div className="rjd-note-form-actions">
                    <button type="button" className="rjd-cancel-btn" onClick={() => { setShowForm(false); setNoteText(""); setNoteError(""); }}>Cancel</button>
                    <button type="submit" className="rjd-submit-btn" disabled={saving || !noteText.trim()}>
                      {saving ? "Saving..." : "Submit"}
                    </button>
                  </div>
                </form>
              )}
              <div className="rjd-notes-list">
                {notes.length === 0 && <p className="rjd-notes-empty">There are no notes for this job</p>}
                {notes.map(note => (
                  <div className="relay-note-item" key={note.id}>
                    <div className="relay-note-header">
                      <strong>{note.author_name}</strong>
                      <span>{note.createdAtLabel || "Time not recorded"}</span>
                    </div>
                    <p>{note.note_text}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === "shipment" && (
            <table className="rjd-shipment-table">
              <thead>
                <tr><th>ID</th><th>Reference #&apos;s</th><th>Special services</th></tr>
              </thead>
              <tbody>
                <tr>
                  <td>{job.code}</td>
                  <td>
                    {job.routeCode && job.routeCode !== "—" && <div><strong>Route Code</strong> {job.routeCode}</div>}
                    <div><strong>Job ID</strong> {job.code}</div>
                    {job.lane && job.lane !== "—" && <div><strong>Lane</strong> {job.lane}</div>}
                  </td>
                  <td>{job.loadType || "—"}</td>
                </tr>
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function JobNotesSection({ jobId }) {
  const [notes, setNotes] = useState([]);
  const [noteText, setNoteText] = useState("");
  const [authorName, setAuthorName] = useState(() => getAuthSession()?.name || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    getJobNotes(jobId).then(res => setNotes(res.data.notes || [])).catch(() => {});
  }, [jobId]);

  async function submit(e) {
    e.preventDefault();
    if (!noteText.trim()) return;
    setSaving(true);
    setError("");
    try {
      await addJobNote(jobId, { note_text: noteText.trim(), author_name: authorName.trim() || "Admin" });
      const res = await getJobNotes(jobId);
      setNotes(res.data.notes || []);
      setNoteText("");
    } catch (err) {
      setError(err?.response?.data?.message || "Could not add note.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="relay-notes-section">
      <div className="relay-notes-label">Job Notes</div>
      <div className="relay-notes-list">
        {notes.length === 0 && <p className="relay-notes-empty">No notes yet — add one below.</p>}
        {notes.map(note => (
          <div className="relay-note-item" key={note.id}>
            <div className="relay-note-header">
              <strong>{note.author_name}</strong>
              <span>{note.createdAtLabel || "Time not recorded"}</span>
            </div>
            <p>{note.note_text}</p>
          </div>
        ))}
      </div>
      <form className="relay-note-form" onSubmit={submit}>
        <input
          className="relay-note-author"
          placeholder="Your name"
          value={authorName}
          onChange={e => setAuthorName(e.target.value)}
          required
        />
        <textarea
          className="relay-note-input"
          placeholder="Add a note — e.g. issue found, delay reason, update from driver..."
          value={noteText}
          onChange={e => setNoteText(e.target.value)}
          rows={2}
          required
        />
        {error && <p className="relay-note-error">{error}</p>}
        <button className="header-action-button" disabled={saving || !noteText.trim()} type="submit">
          {saving ? "Saving..." : "Add Note"}
        </button>
      </form>
    </div>
  );
}

export function JobsListPage() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("upcoming");
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedDate, setSelectedDate] = useState("");
  const [showUnassignedOnly, setShowUnassignedOnly] = useState(false);
  const [statusFilter, setStatusFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [sortBy, setSortBy] = useState("date_asc");
  const [attentionFilter, setAttentionFilter] = useState("");
  const [expandedIds, setExpandedIds] = useState(new Set());
  const [expandedInstructions, setExpandedInstructions] = useState(new Set());
  const [expandedStopInstr, setExpandedStopInstr] = useState(new Set());
  const [busyId, setBusyId] = useState(null);
  const [blockTarget, setBlockTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [delayTarget, setDelayTarget] = useState(null);
  const [delayReason, setDelayReason] = useState("");
  const [replaceTarget, setReplaceTarget] = useState(null);
  const [replaceVehicleId, setReplaceVehicleId] = useState("");
  const [replaceReason, setReplaceReason] = useState("");
  const [replaceErr, setReplaceErr] = useState("");
  const [notesModalJob, setNotesModalJob] = useState(null);
  const [routeMapJob, setRouteMapJob] = useState(null);
  const [chatModalJob, setChatModalJob] = useState(null);
  const [chatDrivers, setChatDrivers] = useState([]);
  const [showImport, setShowImport] = useState(false);

  const loadVersion = useRef(0);
  function load() {
    const version = ++loadVersion.current;
    return getJobs()
      .then(r => { if (version === loadVersion.current) { setData(r.data); setError(""); } })
      .catch(() => { if (version === loadVersion.current) setError("Could not load jobs. Please refresh."); })
      .finally(() => { if (version === loadVersion.current) setLoading(false); });
  }

  useEffect(() => { load(); }, []);

  function loadChatDrivers() {
    return getDriverChats()
      .then(res => setChatDrivers(res.data.drivers || []))
      .catch(() => {});
  }

  useEffect(() => { loadChatDrivers(); }, []);

  useEffect(() => {
    const socket = getRealtimeSocket();
    const handleJobUpdate = () => load();
    const handleDriverMessage = () => loadChatDrivers();
    socket.connect();
    const unsubscribe = subscribeJobUpdates(handleJobUpdate);
    joinAdminChatRoom();
    socket.on("driver-chat:message", handleDriverMessage);
    return () => {
      unsubscribe();
      socket.off("driver-chat:message", handleDriverMessage);
      leaveAdminChatRoom();
    };
  }, []);

  const weekRange = useMemo(() => getWeekRange(weekOffset), [weekOffset]);

  function toggleExpanded(id) {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleInstructions(id) {
    setExpandedInstructions(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleStopInstr(key) {
    setExpandedStopInstr(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function toggleAttention(key) {
    setAttentionFilter(prev => prev === key ? "" : key);
  }

  function clearAllFilters() {
    setSearch(""); setStatusFilter(""); setPriorityFilter("");
    setAttentionFilter(""); setShowUnassignedOnly(false); setSelectedDate("");
  }

  const hasActiveFilters = Boolean(search || statusFilter || priorityFilter || attentionFilter || showUnassignedOnly || selectedDate);

  function jobMatchesDateRange(job, tabId) {
    const jobDate = toDateInputValue(job.departureRaw || job.loadingDoneTime || job.etaRaw);
    if (selectedDate) return jobDate === selectedDate;
    if (jobDate && tabId !== "completed" && tabId !== "history") {
      return jobDate >= weekRange.start && jobDate <= weekRange.end;
    }
    return true;
  }

  const baseFilteredJobs = useMemo(() => {
    const statusSet = new Set(TAB_STATUSES[tab] || []);
    const query = search.trim().toLowerCase();
    return (data?.jobs || []).filter(job => {
      if (!statusSet.has(job.status)) return false;
      if (statusFilter && job.status !== statusFilter) return false;
      if (priorityFilter && job.priority !== priorityFilter) return false;
      if (showUnassignedOnly && job.driverAssigned && job.vehicleAssigned) return false;

      if (!jobMatchesDateRange(job, tab)) return false;

      if (!query) return true;
      return [job.code, job.customer, job.driver, job.vehicle, job.trailer,
              job.pickupAddress, job.dropAddress, job.lane, job.routeCode, job.loadType,
              job.reference, job.loadId]
        .some(v => String(v || "").toLowerCase().includes(query));
    });
  }, [data, tab, weekRange, selectedDate, search, showUnassignedOnly, statusFilter, priorityFilter]);

  const filteredJobs = useMemo(() => {
    return baseFilteredJobs.filter(job => {
      if (attentionFilter === "eta_risk" && !job.etaRisk) return false;
      if (attentionFilter === "unassigned" && (job.driverAssigned && job.vehicleAssigned)) return false;
      if (attentionFilter === "pod_pending" && !isPodPending(job)) return false;
      if (attentionFilter === "blocked" && job.status !== "blocked") return false;
      if (attentionFilter === "critical" && job.priority !== "critical") return false;
      return true;
    });
  }, [baseFilteredJobs, attentionFilter]);

  const jobs = useMemo(() => sortJobs(filteredJobs, sortBy), [filteredJobs, sortBy]);

  const tabCounts = useMemo(() => {
    const all = data?.jobs || [];
    return {
      upcoming: all.filter(j => TAB_STATUSES.upcoming.includes(j.status) && jobMatchesDateRange(j, "upcoming")).length,
      intransit: all.filter(j => TAB_STATUSES.intransit.includes(j.status) && jobMatchesDateRange(j, "intransit")).length,
      completed: all.filter(j => TAB_STATUSES.completed.includes(j.status) && jobMatchesDateRange(j, "completed")).length,
      history: all.filter(j => TAB_STATUSES.history.includes(j.status) && jobMatchesDateRange(j, "history")).length
    };
  }, [data, weekRange, selectedDate]);

  const attentionCounts = useMemo(() => ({
    eta_risk:    baseFilteredJobs.filter(j => j.etaRisk).length,
    unassigned:  baseFilteredJobs.filter(j => !j.driverAssigned || !j.vehicleAssigned).length,
    pod_pending: baseFilteredJobs.filter(isPodPending).length,
    blocked:     baseFilteredJobs.filter(j => j.status === "blocked").length,
    critical:    baseFilteredJobs.filter(j => j.priority === "critical").length
  }), [baseFilteredJobs]);

  async function updatePlannerField(job, payload, busyKey, fallbackMessage = "Job could not be updated.") {
    const collectionPassed = job.departureRaw && job.departureRaw < ukNow();
    if (payload.driver_id && ["planned", "loading"].includes(job.status) && collectionPassed &&
      !window.confirm(`Collection for ${job.code} was planned for ${fmtTimeFull(job.departureRaw)}, which has already passed. Assign anyway?`)) return;
    setError("");
    setBusyId(`${busyKey}-${job.id}`);
    try {
      await updateJobAssignment(job.id, payload);
      await load();
    } catch (err) {
      setError(err?.response?.data?.message || fallbackMessage);
    } finally {
      setBusyId(null);
    }
  }

  async function setStatus(job, status) {
    setError("");
    setBusyId(job.id);
    try {
      await updateJobStatus(job.id, { status, reason: status === "blocked" ? "Blocked from dispatch board" : undefined });
      await load();
    } catch (err) {
      setError(err?.response?.data?.message || "Job status could not be updated.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleCancel(payload) {
    if (!blockTarget) return;
    setError("");
    setBusyId(blockTarget.id);
    try {
      await cancelJob(blockTarget.id, payload);
      setBlockTarget(null);
      await load();
    } catch (err) {
      setError(err?.response?.data?.message || "Job could not be blocked.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(payload) {
    if (!deleteTarget) return;
    setError("");
    setBusyId(deleteTarget.id);
    try {
      await deleteJob(deleteTarget.id, payload);
      setDeleteTarget(null);
      await load();
    } catch (err) {
      setError(err?.response?.data?.message || "Job could not be deleted.");
      setDeleteTarget(null);
    } finally {
      setBusyId(null);
    }
  }

  async function submitDelay() {
    if (!delayTarget || !delayReason.trim()) return;
    setError("");
    setBusyId(delayTarget.id);
    try {
      await updateJobStatus(delayTarget.id, { status: delayTarget.status, reason: delayReason.trim(), delay_reason: delayReason.trim() });
      setDelayTarget(null);
      setDelayReason("");
      await load();
    } catch (err) {
      setError(err?.response?.data?.message || "Delay could not be reported.");
    } finally {
      setBusyId(null);
    }
  }

  async function submitReplaceVehicle() {
    if (!replaceTarget || !replaceVehicleId || !replaceReason.trim()) return;
    setReplaceErr("");
    setBusyId(replaceTarget.id);
    try {
      await replaceJobVehicle(replaceTarget.id, { vehicle_id: Number(replaceVehicleId), reason: replaceReason.trim() });
      setReplaceTarget(null);
      setReplaceVehicleId("");
      setReplaceReason("");
      await load();
    } catch (err) {
      setReplaceErr(err?.response?.data?.message || "Vehicle could not be replaced.");
    } finally {
      setBusyId(null);
    }
  }

  function exportJobs() {
    exportCsv("jobs-dispatch.csv", [
      ["Job code", "Customer", "Lane", "Load", "Priority", "Driver", "Vehicle", "Trailer",
       "Departure", "ETA", "Distance (mi)", "Status", "Freight GBP", "POD Status"],
      ...jobs.map(job => [job.code, job.customer, job.lane, job.loadType, job.priority,
        job.driver, job.vehicle, job.trailer, job.departureRaw, job.etaRaw,
        job.distanceMiles || "", job.status, job.freightValue, job.podStatus])
    ]);
  }

  const weekLabel = fmtWeekLabel(weekRange.start, weekRange.end);

  const ATTENTION_CHIPS = [
    { key: "eta_risk",    label: "ETA risk",     tone: "danger"  },
    { key: "unassigned",  label: "Unassigned",   tone: "warning" },
    { key: "pod_pending", label: "POD pending",  tone: "warning" },
    { key: "blocked",     label: "Blocked",      tone: "danger"  },
    { key: "critical",    label: "Critical",     tone: "danger"  }
  ];

  return (
    <AdminWorkspaceLayout
      badge="Jobs control"
      title="Jobs"
      highlights={[]}
      hideHeaderIntro
      className="jobs-page-shell"
    >
      <div className="relay-page">

        <section className="jobs-workspace-card">
        {/* ── Command bar: view tabs + page actions ── */}
        <div className="jb-command-bar">
          <div className="jb-tabs" role="tablist" aria-label="Job views">
            {JOB_TABS.map(item => (
              <button
                key={item.key}
                className={tab === item.key ? "active" : ""}
                type="button"
                role="tab"
                aria-selected={tab === item.key}
                onClick={() => { setTab(item.key); setAttentionFilter(""); }}
              >
                {item.label}
                <span className={`jb-tab-count${item.key === "intransit" && tabCounts.intransit ? " live" : ""}`}>{tabCounts[item.key]}</span>
              </button>
            ))}
          </div>
          <div className="jb-actions">
            <button className="jb-btn subtle" type="button" onClick={load}>
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M16 10a6 6 0 1 1-1.8-4.3M16 3.5V6h-2.5" /></svg>
              Refresh
            </button>
            <button className="jb-btn subtle" type="button" onClick={exportJobs}>
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3v9m0 0-3.5-3.5M10 12l3.5-3.5M4 14.5V16h12v-1.5" /></svg>
              Export
            </button>
            <button className="jb-btn subtle" type="button" onClick={() => setShowImport(true)}>
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 13V4m0 0L6.5 7.5M10 4l3.5 3.5M4 14.5V16h12v-1.5" /></svg>
              Upload CSV
            </button>
            <button className="jb-btn primary" type="button" onClick={() => navigate("/admin/jobs/new")}>
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12" /></svg>
              New job
            </button>
          </div>
        </div>

        {/* ── Filters ── */}
        <div className="jb-filters">
          <label className="jb-search">
            <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="9" cy="9" r="5.5" /><path d="m13 13 3.5 3.5" /></svg>
            <input
              placeholder="Search job, reference, load ID, place or driver"
              type="search"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </label>

          <div className="jb-week" aria-label="Week">
            <button type="button" aria-label="Previous week" onClick={() => { setSelectedDate(""); setWeekOffset(o => o - 1); }}>‹</button>
            <span>{selectedDate ? fmtDateInputLabel(selectedDate) : weekLabel}</span>
            <button type="button" aria-label="Next week" onClick={() => { setSelectedDate(""); setWeekOffset(o => o + 1); }}>›</button>
          </div>

          <input
            className="jb-input"
            aria-label="Filter jobs by exact date"
            type="date"
            value={selectedDate}
            onChange={e => setSelectedDate(e.target.value)}
          />

          <select className="jb-input" aria-label="Status" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            {STATUS_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
          </select>

          <select className="jb-input" aria-label="Priority" value={priorityFilter} onChange={e => setPriorityFilter(e.target.value)}>
            {PRIORITY_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
          </select>

          <select className="jb-input" aria-label="Sort by" value={sortBy} onChange={e => setSortBy(e.target.value)}>
            {SORT_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>Sort: {opt.label}</option>)}
          </select>

          <label className="jb-switch">
            <input type="checkbox" role="switch" checked={showUnassignedOnly} onChange={() => setShowUnassignedOnly(v => !v)} />
            <span className="jb-switch-track" aria-hidden="true"><span /></span>
            Unassigned only
          </label>
        </div>

        {/* ── Attention filters + result count ── */}
        <div className="jb-attention">
          <span className="jb-attention-label">Needs attention</span>
          {ATTENTION_CHIPS.map(chip => {
            const count = attentionCounts[chip.key];
            return (
              <button
                key={chip.key}
                className={`jb-chip ${chip.tone}${attentionFilter === chip.key ? " active" : ""}${count === 0 ? " empty" : ""}`}
                type="button"
                aria-pressed={attentionFilter === chip.key}
                onClick={() => toggleAttention(chip.key)}
              >
                {chip.label}
                <strong>{count}</strong>
              </button>
            );
          })}
          {hasActiveFilters && (
            <button className="jb-link-btn" type="button" onClick={clearAllFilters}>Clear filters</button>
          )}
          <span className="jb-results">{loading ? "Loading…" : `${jobs.length} ${jobs.length === 1 ? "job" : "jobs"}`}</span>
        </div>

        <StateNotice loading={loading} error={error} />

        {/* ── Job list ── */}
        <div className="relay-job-list">
          {jobs.length > 0 && (
            <div className="jb-list-head" aria-hidden="true">
              <span />
              <span>Job</span>
              <span>Route</span>
              <span>Distance</span>
              <span>Truck · trailer</span>
              <span>Driver</span>
              <span>Status</span>
              <span className="jb-right">Freight</span>
              <span />
            </div>
          )}
          {!loading && jobs.length === 0 && (
            <div className="relay-empty">
              <p>
                {hasActiveFilters
                  ? "No jobs match your current filters."
                  : tab === "upcoming" ? "No upcoming jobs."
                  : tab === "intransit" ? "No jobs currently in transit."
                  : tab === "completed" ? "No completed jobs."
                  : "No jobs found."}
              </p>
              {hasActiveFilters && (
                <button className="header-action-button" type="button" onClick={clearAllFilters}>Clear Filters</button>
              )}
              {tab === "upcoming" && !hasActiveFilters && (
                <button className="af-submit-btn" type="button" onClick={() => navigate("/admin/jobs/new")}>
                  Create First Job
                </button>
              )}
            </div>
          )}

          {jobs.map(job => {
            const isExpanded = expandedIds.has(job.id);
            const isShowingInstructions = expandedInstructions.has(job.id);
            const isBlocked = job.status === "blocked";
            const isCompleted = job.status === "completed";
            const isActive = job.status === "active";
            const isLoading = job.status === "loading";

            const assignedDriver = (data?.drivers || []).find(d => Number(d.id) === Number(job.driverId));
            const assignedVehicle = (data?.vehicles || []).find(v => Number(v.id) === Number(job.vehicleId));
            const assignedTrolley = (data?.trailers || []).find(t => Number(t.id) === Number(job.trailerId));
            const driverToneVal = driverTone(assignedDriver, job.driverAssigned);
            const vehicleToneVal = vehicleTone(assignedVehicle, job.vehicleAssigned);
            const trolleyToneVal = trolleyTone(assignedTrolley, job.trailerAssigned);

            const routeStops = Array.isArray(job.stops) ? job.stops : [];
            // Collection = "C", drops numbered 1..n, return to yard = "R". Each time says whether it is actual or planned.
            const stamp = (actualRaw, plannedRaw) => actualRaw
              ? { text: fmtRouteStamp(actualRaw), kind: "Actual" }
              : { text: fmtRouteStamp(plannedRaw), kind: "Plan" };
            const routeTimelinePoints = (job.punctuality?.points || []).map(point => {
              const stop = routeStops.find(s => String(s.id) === point.key);
              const address = point.key === "pickup" ? job.pickupAddress : point.key === "drop-1" ? job.dropAddress : stop?.address;
              return {
                key: point.key,
                index: point.kind === "pickup" ? "C" : point.kind === "return" ? "R" : point.kind === "waypoint" ? "W" : point.label.replace("Drop ", ""),
                name: extractUkPostcode(address),
                title: `${point.label} · ${address || ""}`,
                arrival: stamp(point.actualArrival, point.plannedArrival),
                departure: stamp(point.actualDeparture, point.plannedDeparture),
                point
              };
            });
            const routeFirst = routeTimelinePoints[0] || null;
            const routeEnd = routeTimelinePoints.filter(point => point.point.kind !== "return");
            const routeLast = routeEnd.length > 1 ? routeEnd[routeEnd.length - 1] : routeTimelinePoints[1] || null;
            const extraStops = Math.max(0, routeEnd.length - 2);
            const hasGap = ["planned", "loading", "active"].includes(job.status) && (!job.driverAssigned || !job.vehicleAssigned);
            const podPending = isPodPending(job);
            const chatDriver = chatDrivers.find(driver => Number(driver.id) === Number(job.driverId));
            const chatUnreadCount = Number(chatDriver?.unreadCount || 0);

            const driverStatusLabel = job.driverJobStatus && job.driverJobStatus !== "—"
              ? DRIVER_STATUS_LABEL[job.driverJobStatus] || job.driverJobStatus
              : null;
            const driverStatusToneVal = DRIVER_STATUS_TONE[job.driverJobStatus] || "neutral";

            const pickupPoint = punctualityPoint(job, "pickup");
            const drop1Point = punctualityPoint(job, "drop-1");
            const graceMins = job.punctuality?.graceMins;
            const toneClass = mins => (delayTone(mins, graceMins) ? `relay-time-${delayTone(mins, graceMins)}` : "");
            const depTimeTone = toneClass(pickupPoint?.departureDelayMins);
            const arrTimeTone = toneClass(drop1Point?.arrivalDelayMins);
            const dropCount = Math.max(1, (job.punctuality?.points || []).filter(point => point.kind === "drop").length);
            const dispatchLocked = ["completed", "cancelled", "failed"].includes(job.status);

            return (
              <div
                key={job.id}
                className={[
                  "relay-job-card",
                  isBlocked ? "cancelled" : "",
                  job.priority === "critical" ? "critical" : "",
                  job.etaRisk ? "eta-risk" : "",
                  podPending ? "pod-pending" : ""
                ].filter(Boolean).join(" ")}
              >
                {/* ── Collapsed row ── */}
                <div
                  className="relay-job-header jb-row"
                  role="button"
                  tabIndex={0}
                  aria-expanded={isExpanded}
                  onClick={() => toggleExpanded(job.id)}
                  onKeyDown={e => e.key === "Enter" && toggleExpanded(job.id)}
                >
                  <span className={`relay-chevron${isExpanded ? " open" : ""}`} aria-hidden="true">›</span>

                  <div className="jb-cell jb-job">
                    <button
                      className="jb-code"
                      type="button"
                      onClick={e => { e.stopPropagation(); navigate(`/admin/jobs/${job.id}`); }}
                    >
                      {job.code}
                    </button>
                    <small>{job.customer || "No customer"}</small>
                    {(job.reference || job.loadId) && (
                      <small className="jb-refs">
                        {job.reference && <>Ref {job.reference}</>}
                        {job.reference && job.loadId && " · "}
                        {job.loadId && <>Load {job.loadId}</>}
                      </small>
                    )}
                  </div>

                  <div className="jb-cell jb-route">
                    {routeFirst ? (
                      <>
                        <span className="jb-route-line" title={routeTimelinePoints.map(point => point.title).join("\n")}>
                          <span className={routeFirst.point.state === "late" || routeFirst.point.state === "overdue" ? "late" : ""}>{routeFirst.name}</span>
                          <span className="jb-route-arrow" aria-hidden="true">→</span>
                          <span className={routeLast?.point.state === "late" || routeLast?.point.state === "overdue" ? "late" : ""}>{routeLast?.name || "—"}</span>
                          {extraStops > 0 && <span className="jb-route-more">+{extraStops} {extraStops === 1 ? "stop" : "stops"}</span>}
                        </span>
                        <small>
                          Collect {routeFirst.arrival.text}
                          {routeFirst.arrival.kind === "Actual" && <em> · actual</em>}
                        </small>
                      </>
                    ) : <span className="jb-muted">Route not set</span>}
                  </div>

                  <div className="jb-cell jb-num">
                    <span>{job.distanceKm ? `${Math.round(job.distanceKm * 0.621371)} mi` : "—"}</span>
                    <small>{job.totalJobDurationMins ? fmtMins(job.totalJobDurationMins) : job.etaHours ? `${job.etaHours}h route` : ""}</small>
                  </div>

                  <div className="jb-cell">
                    <span>{job.vehicleAssigned ? job.vehicle : <em className="jb-missing">No truck</em>}</span>
                    <small>{job.trailerAssigned ? job.trailerCode : "No trailer"}</small>
                  </div>

                  <div className="jb-cell">
                    <span>{job.driverAssigned ? job.driver : <em className="jb-missing">Unassigned</em>}</span>
                    {driverStatusLabel && <small className={`jb-tone ${driverStatusToneVal}`}>{driverStatusLabel}</small>}
                  </div>

                  <div className="jb-cell jb-status">
                    <span className={`jb-badge ${STATUS_TONE[job.status] || "neutral"}`}>{job.status}</span>
                    <span className="jb-flags">
                      {job.priority !== "standard" && <span className={`jb-flag ${PRIORITY_TONE[job.priority] || "neutral"}`}>{job.priority}</span>}
                      {hasGap && <span className="jb-flag warning">Assignment gap</span>}
                      {podPending && <span className="jb-flag warning">POD pending</span>}
                      {job.hasDriverEtaUpdate && <span className="jb-flag info">Driver ETA {job.etaTime}</span>}
                    </span>
                    <PunctualityPill summary={job.punctuality?.summary} />
                  </div>

                  <div className="jb-cell jb-money">
                    <span>{job.freight}</span>
                    {job.profitLoss && (
                      <small className={job.isProfitable ? "profit" : "loss"}>
                        {job.isProfitable ? "+" : "−"}{job.profitLoss.replace(/^[-−]/, "")} {job.economics?.basis === "actual" ? "" : "est."}
                      </small>
                    )}
                    {!job.profitLoss && job.economics && <small className="jb-muted">P&amp;L unavailable</small>}
                  </div>

                  <div className="jb-row-actions">
                    <button
                      className="jb-icon-btn"
                      type="button"
                      title={job.driverAssigned ? `Chat with ${job.driver}` : "Assign a driver to chat"}
                      aria-label={job.driverAssigned ? `Chat with ${job.driver}` : "Assign a driver to chat"}
                      disabled={!job.driverAssigned}
                      onClick={e => { e.stopPropagation(); setChatModalJob(job); }}
                    >
                      <svg viewBox="0 0 20 20" aria-hidden="true">
                        <path d="M16.5 3h-13a1 1 0 0 0-1 1v9.5a1 1 0 0 0 1 1h2V17l3.5-2.5h7.5a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1z" />
                        <path d="M6.5 7.5h7M6.5 10.5h4.5" />
                      </svg>
                      {chatUnreadCount > 0 && <span className="jb-unread">{chatUnreadCount > 9 ? "9+" : chatUnreadCount}</span>}
                    </button>
                    <button
                      className="jb-icon-btn"
                      type="button"
                      title="Notes and details"
                      aria-label="Notes and details"
                      onClick={e => { e.stopPropagation(); setNotesModalJob(job); }}
                    >
                      <svg viewBox="0 0 20 20" aria-hidden="true">
                        <path d="M5.5 3h9a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
                        <path d="M7.5 7h5M7.5 10h5M7.5 13h3" />
                      </svg>
                    </button>
                  </div>
                </div>

                {/* ── Expanded body ── */}
                {isExpanded && (
                  <div className="relay-job-body">

                    {/* Blocked banner */}
                    {isBlocked && (
                      <div className="relay-status-banner danger">
                        <span>🚫 Blocked · {job.cancellationReason || "No reason recorded"}</span>
                        <button
                          className="header-action-button"
                          type="button"
                          disabled={busyId === job.id}
                          onClick={() => setStatus(job, "planned")}
                        >
                          Reset To Planned
                        </button>
                      </div>
                    )}

                    {/* ETA risk banner */}
                    {job.etaRisk && !isBlocked && (
                      <div className="relay-status-banner warning">
                        <span>⚠️ {job.punctuality?.summary?.worstPoint
                          ? `Overdue at ${job.punctuality.summary.worstPoint.label} · planned time passed and nothing recorded yet`
                          : "Planned time has passed and job is still open"}</span>
                        <button
                          className="header-action-button"
                          type="button"
                          onClick={() => setDelayTarget(job)}
                        >
                          Report Delay
                        </button>
                      </div>
                    )}

                    {job.hasDriverEtaUpdate && (
                      <div className="relay-status-banner info">
                        <span>Driver ETA updated · Expected arrival {job.etaTime}</span>
                        <button
                          className="header-action-button"
                          type="button"
                          onClick={() => navigate(`/admin/jobs/${job.id}`)}
                        >
                          Open Job
                        </button>
                      </div>
                    )}

                    {/* Delay reason banner */}
                    {job.delayReason && !isBlocked && (
                      <div className="relay-status-banner warning">
                        <span>⏱ Delay reported · {job.delayReason}</span>
                      </div>
                    )}

                    {/* POD pending banner */}
                    {podPending && (
                      <div className="relay-status-banner warning">
                        <span>📋 POD pending · Proof of delivery has not been uploaded or verified</span>
                        <button className="header-action-button" type="button" onClick={() => navigate(`/admin/jobs/${job.id}`)}>
                          View Job
                        </button>
                      </div>
                    )}

                    <div className="relay-driver-progress">
                      <div className="relay-driver-progress-head">
                        <span className="card-label">Driver Timeline</span>
                        {driverStatusLabel && (
                          <StatusPill tone={driverStatusToneVal}>{driverStatusLabel}</StatusPill>
                        )}
                      </div>
                      <div className="relay-driver-progress-track">
                        {(job.driverStatusTimeline || []).map((event, index) => (
                          <div className={`relay-driver-progress-item ${event.tone || "neutral"}`} key={event.id || `${job.id}-driver-status-${index}`}>
                            <span className="relay-driver-progress-dot" />
                            <div>
                              <strong>{event.label}</strong>
                              <p>{event.at}</p>
                              {event.reason && <small>{event.reason}</small>}
                            </div>
                          </div>
                        ))}
                        {(!job.driverStatusTimeline || job.driverStatusTimeline.length === 0) && (
                          <p className="driver-empty">Driver status timeline will appear as the driver updates this job.</p>
                        )}
                      </div>
                    </div>

                    <JobStopsEditor
                      job={job}
                      drivers={data?.drivers || []}
                      vehicles={data?.vehicles || []}
                      trailers={data?.trailers || []}
                      onSaved={load}
                    />

                    {/* Legacy detail markup retained for operational reference data. */}
                    <div className="relay-stop-table relay-stop-table-legacy" aria-hidden="true">
                      <div className="relay-stop-table-head">
                        <span>Stop</span>
                        <span>Equipment</span>
                        <span>Arrival</span>
                        <span>Departure</span>
                      </div>

                      {/* Pickup — Collection */}
                      <div className="relay-stop-block">
                        <div className="relay-stop-row">
                          <div className="relay-stop-location">
                            <span className="relay-stop-bubble" style={{ background: "#5F6B7A", fontSize: "0.6rem" }}>C</span>
                            <div>
                              <strong>{abbrevAddr(job.pickupAddress)}</strong>
                              <small>{job.pickupAddress !== "—" ? job.pickupAddress : "Address not set"}</small>
                              {job.dockWindow !== "—" && <small className="relay-dock-label">Dock: {job.dockWindow}</small>}
                            </div>
                          </div>
                          <div className="relay-stop-equipment">
                            <span>Tractor ID <strong>{job.vehicleAssigned ? job.vehicle : "—"}</strong></span>
                            <span className="relay-drop-trailer">
                              <span className={`relay-dot${job.trailerAssigned ? " filled" : ""}`} />
                              {job.trailerAssigned ? job.trailer : "No trailer"}
                            </span>
                            {job.loadWeightKg && <span>| {job.loadWeightKg} kg</span>}
                            <span>Trailer Id <strong>{job.trailerAssigned ? job.trailer : "—"}</strong></span>
                            {(isActive || isLoading || isCompleted) && (
                              <span className={`relay-live-badge${isCompleted ? " success" : ""}`}>
                                {isActive ? "Live" : isLoading ? "Live · loading" : "departed"}
                              </span>
                            )}
                          </div>
                          <div className="relay-stop-time">
                            <strong className={toneClass(pickupPoint?.arrivalDelayMins)}>{job.collectionArrivedAt !== "—" ? job.collectionArrivedAt : job.departure !== "—" ? job.departure : "TBD"}</strong>
                            {job.collectionArrivedAt !== "—" && job.departure !== "—" && <small className="relay-sch-time">Sch. {job.departure}</small>}
                            {job.collectionArrivedAt === "—" && job.departure !== "—" && <small className="relay-sch-time">Scheduled</small>}
                            <DelayTag mins={pickupPoint?.arrivalDelayMins} overdue={pickupPoint?.overdue?.type === "arrival" ? pickupPoint.overdue : null} graceMins={graceMins} />
                          </div>
                          <div className="relay-stop-time">
                            <strong className={depTimeTone}>
                              {job.actualDeparture && job.actualDeparture !== "—"
                                ? job.actualDeparture
                                : job.loadingDoneTime ? fmtTimeFull(job.loadingDoneTime) : "TBD"}
                            </strong>
                            {job.loadingDoneTime && (
                              <small className="relay-sch-time">Sch. {fmtTimeFull(job.loadingDoneTime)}</small>
                            )}
                            <DelayTag mins={pickupPoint?.departureDelayMins} overdue={pickupPoint?.overdue?.type === "departure" ? pickupPoint.overdue : null} graceMins={graceMins} />
                            {(isActive || isLoading) && (
                              <button className="relay-report-delay-btn" type="button"
                                onClick={e => { e.stopPropagation(); setDelayTarget(job); }}>
                                Report delay
                              </button>
                            )}
                          </div>
                        </div>
                        {/* Pickup instructions */}
                        <div className="relay-stop-instr-wrap">
                          <button className="relay-stop-instr-toggle" type="button"
                            onClick={() => toggleStopInstr(`${job.id}-pickup`)}>
                            {expandedStopInstr.has(`${job.id}-pickup`) ? "▲" : "▼"} Pick-up instructions
                          </button>
                          {expandedStopInstr.has(`${job.id}-pickup`) && (
                            <div className="relay-stop-instr-body">
                              <div className="relay-stop-instr-head-row">
                                <span>CONTACT</span>
                                <span>REFERENCE #&apos;s</span>
                                <span>INSTRUCTIONS</span>
                              </div>
                              <div className="relay-stop-instr-row">
                                <div>
                                  {job.customerContact !== "—" ? job.customerContact : "—"}
                                  {job.customerPhone && <div className="relay-footer-sub">{job.customerPhone}</div>}
                                </div>
                                <div>
                                  <div><strong>Job #</strong> {job.code}</div>
                                  {job.reference && <div><strong>Ref</strong> {job.reference}</div>}
                                  {job.loadId && <div><strong>Load ID</strong> {job.loadId}</div>}
                                  {job.routeCode && job.routeCode !== "—" && <div><strong>Route</strong> {job.routeCode}</div>}
                                  {job.lane && job.lane !== "—" && <div><strong>Lane</strong> {job.lane}</div>}
                                </div>
                                <div>{job.specialInstructions !== "—" ? job.specialInstructions : "—"}</div>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Final Drop — Stop 1 */}
                      <div className="relay-stop-block">
                        <div className="relay-stop-row">
                          <div className="relay-stop-location">
                            <span className="relay-stop-bubble">1</span>
                            <div>
                              <strong>{abbrevAddr(job.dropAddress)}</strong>
                              <small>{job.dropAddress !== "—" ? job.dropAddress : "Address not set"}</small>
                              {job.deadline !== "—" && <small className="relay-dock-label">Deadline: {job.deadline}</small>}
                            </div>
                          </div>
                          <div className="relay-stop-equipment">
                            <span>Tractor ID <strong>{job.vehicleAssigned ? job.vehicle : "—"}</strong></span>
                            <span className="relay-drop-trailer">
                              <span className={`relay-dot${job.trailerAssigned ? " filled" : ""}`} />
                              {job.trailerAssigned ? job.trailer : "No trailer"}
                            </span>
                            {job.loadWeightKg && <span>| {job.loadWeightKg} kg</span>}
                            <span>Trailer Id <strong>{job.trailerAssigned ? job.trailer : "—"}</strong></span>
                            {isCompleted && <span className="relay-live-badge success">Delivered</span>}
                            <span className="relay-pod-status">POD: <strong>{job.podStatus}</strong></span>
                            {driverStatusLabel && (
                              <span className={`relay-driver-stop-status ${driverStatusToneVal}`}>{driverStatusLabel}</span>
                            )}
                            <span className={`relay-driver-stop-status ${STOP_STATUS_TONE[job.primaryDropStatus] || "neutral"}`}>
                              Drop 1: {job.primaryDropStatusLabel || job.primaryDropStatus || "Pending"}
                            </span>
                          </div>
                          <div className="relay-stop-time">
                            <strong className={arrTimeTone}>
                              {job.primaryDropArrivedAt && job.primaryDropArrivedAt !== "—"
                                ? job.primaryDropArrivedAt
                                : job.calculatedArrival ? fmtTimeFull(job.calculatedArrival) : "TBD"}
                            </strong>
                            {job.calculatedArrival && (
                              <small className="relay-sch-time">{job.primaryDropArrivedAt && job.primaryDropArrivedAt !== "—" ? `Sch. ${fmtTimeFull(job.calculatedArrival)}` : "Scheduled"}</small>
                            )}
                            <DelayTag mins={drop1Point?.arrivalDelayMins} overdue={drop1Point?.overdue?.type === "arrival" ? drop1Point.overdue : null} graceMins={graceMins} />
                            <PointWarnings point={drop1Point} />
                            {isActive && (
                              <button className="relay-report-delay-btn" type="button"
                                onClick={e => { e.stopPropagation(); setDelayTarget(job); }}>
                                Report delay
                              </button>
                            )}
                          </div>
                          <div className="relay-stop-time">
                            {job.primaryDropDepartedAt && job.primaryDropDepartedAt !== "—"
                              ? <strong className={toneClass(drop1Point?.departureDelayMins)}>{job.primaryDropDepartedAt}</strong>
                              : job.calculatedUnloadEnd
                              ? <strong>{fmtTimeFull(job.calculatedUnloadEnd)}</strong>
                              : <span className="relay-time-dash">—</span>}
                            {job.calculatedUnloadEnd && (
                              <small className="relay-sch-time">{job.primaryDropDepartedAt && job.primaryDropDepartedAt !== "—" ? `Sch. ${fmtTimeFull(job.calculatedUnloadEnd)}` : "Scheduled"}</small>
                            )}
                            <DelayTag mins={drop1Point?.departureDelayMins} overdue={drop1Point?.overdue?.type === "departure" ? drop1Point.overdue : null} graceMins={graceMins} />
                          </div>
                        </div>
                        {/* Drop instructions */}
                        <div className="relay-stop-instr-wrap">
                          <button className="relay-stop-instr-toggle" type="button"
                            onClick={() => toggleStopInstr(`${job.id}-drop`)}>
                            {expandedStopInstr.has(`${job.id}-drop`) ? "▲" : "▼"} Pick-up/drop-off instructions
                          </button>
                          {expandedStopInstr.has(`${job.id}-drop`) && (
                            <div className="relay-stop-instr-body">
                              <div className="relay-stop-instr-head-row">
                                <span>CONTACT</span>
                                <span>REFERENCE #&apos;s</span>
                                <span>INSTRUCTIONS</span>
                              </div>
                              <div className="relay-stop-instr-row">
                                <div>
                                  {job.customerContact !== "—" ? job.customerContact : "—"}
                                  {job.customerPhone && <div className="relay-footer-sub">{job.customerPhone}</div>}
                                </div>
                                <div>
                                  <div><strong>Job #</strong> {job.code}</div>
                                  {job.reference && <div><strong>Ref</strong> {job.reference}</div>}
                                  {job.loadId && <div><strong>Load ID</strong> {job.loadId}</div>}
                                  {job.routeCode && job.routeCode !== "—" && <div><strong>Route</strong> {job.routeCode}</div>}
                                  {job.lane && job.lane !== "—" && <div><strong>Lane</strong> {job.lane}</div>}
                                </div>
                                <div>{job.dispatcherNotes !== "—" ? job.dispatcherNotes : job.specialInstructions !== "—" ? job.specialInstructions : "—"}</div>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Intermediate stops */}
                      {routeStops.map((stop, index) => {
                        const stopTone = STOP_STATUS_TONE[stop.status] || "neutral";
                        const stopPoint = punctualityPoint(job, stop.id);
                        return (
                        <div className="relay-stop-block" key={stop.id || `${job.id}-stop-${index}`}>
                          <div className="relay-stop-row">
                            <div className="relay-stop-location">
                              <span className={`relay-stop-bubble${stop.isReturnPoint ? " return" : ""}`}>{stop.isReturnPoint ? "R" : stopPoint?.kind === "waypoint" ? "W" : (stopPoint?.label || "").replace("Drop ", "") || index + 2}</span>
                              <div>
                                <strong>{abbrevAddr(stop.address)}</strong>
                                <small>{stop.address !== "—" ? stop.address : "Address not set"}</small>
                                <small className="relay-dock-label">
                                  {stop.label || (stop.isReturnPoint ? "Return point" : "Stop")}
                                </small>
                                <span className={`relay-driver-stop-status ${stopTone}`}>{stop.statusLabel || stop.status || "Pending"}</span>
                              </div>
                            </div>
                            <div className="relay-stop-equipment">
                              <span>Stop type <strong>{stop.isReturnPoint ? "return" : stop.type || "—"}</strong></span>
                              <span>Contact <strong>{stop.contactName !== "—" ? stop.contactName : "—"}</strong></span>
                              {stop.contactPhone !== "—" && <span>Phone <strong>{stop.contactPhone}</strong></span>}
                              {stop.notes !== "—" && <span>Notes <strong>{stop.notes}</strong></span>}
                            </div>
                            <div className="relay-stop-time">
                              <strong className={toneClass(stopPoint?.arrivalDelayMins)}>{stop.actualArrival !== "—" ? stop.actualArrival : stop.plannedArrival !== "—" ? stop.plannedArrival : "TBD"}</strong>
                              {stop.plannedArrival !== "—" && (
                                <small className="relay-sch-time">{stop.actualArrival !== "—" ? `Sch. ${stop.plannedArrival}` : "Scheduled"}</small>
                              )}
                              <DelayTag mins={stopPoint?.arrivalDelayMins} overdue={stopPoint?.overdue?.type === "arrival" ? stopPoint.overdue : null} graceMins={graceMins} />
                              <PointWarnings point={stopPoint} />
                            </div>
                            <div className="relay-stop-time">
                              {stop.status === "skipped"
                                ? <strong>Skipped</strong>
                                : <strong className={toneClass(stopPoint?.departureDelayMins)}>{stop.actualDeparture !== "—" ? stop.actualDeparture : stop.plannedDeparture !== "—" ? stop.plannedDeparture : "—"}</strong>}
                              {stop.plannedDeparture !== "—" && (
                                <small className="relay-sch-time">{stop.actualDeparture !== "—" ? `Sch. ${stop.plannedDeparture}` : "Scheduled"}</small>
                              )}
                              <DelayTag mins={stopPoint?.departureDelayMins} overdue={stopPoint?.overdue?.type === "departure" ? stopPoint.overdue : null} graceMins={graceMins} />
                            </div>
                          </div>
                          <div className="relay-stop-instr-wrap">
                            <button className="relay-stop-instr-toggle" type="button"
                              onClick={() => toggleStopInstr(`${job.id}-stop-${stop.id}`)}>
                              {expandedStopInstr.has(`${job.id}-stop-${stop.id}`) ? "▲" : "▼"} Stop instructions
                            </button>
                            {expandedStopInstr.has(`${job.id}-stop-${stop.id}`) && (
                              <div className="relay-stop-instr-body">
                                <div className="relay-stop-instr-head-row">
                                  <span>CONTACT</span>
                                  <span>REFERENCE #&apos;s</span>
                                  <span>INSTRUCTIONS</span>
                                </div>
                                <div className="relay-stop-instr-row">
                                  <div>
                                    {stop.contactName !== "—" ? stop.contactName : "—"}
                                    {stop.contactPhone !== "—" && <div className="relay-footer-sub">{stop.contactPhone}</div>}
                                  </div>
                                  <div><div><strong>Job #</strong> {job.code}</div></div>
                                  <div>{stop.notes !== "—" ? stop.notes : "—"}</div>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                      })}
                    </div>

                    {/* ── Time Calculation ── */}
                    {(job.loadingDoneTime || job.calculatedArrival) && (
                      <div className="relay-time-calc-strip">
                        <div className="relay-time-calc-item">
                          <span className="relay-time-calc-label">Loading Done</span>
                          <strong>{fmtTimeFull(job.loadingDoneTime)}</strong>
                        </div>
                        <div className="relay-time-calc-arrow">→</div>
                        <div className="relay-time-calc-item">
                          <span className="relay-time-calc-label">Travel</span>
                          <strong>{fmtMins(ukMinutes(job.loadingDoneTime, job.calculatedArrival))}</strong>
                          <small>Collection → Drop 1</small>
                        </div>
                        <div className="relay-time-calc-arrow">→</div>
                        <div className="relay-time-calc-item">
                          <span className="relay-time-calc-label">Arrive At Drop</span>
                          <strong>{fmtTimeFull(job.calculatedArrival)}</strong>
                        </div>
                        <div className="relay-time-calc-arrow">→</div>
                        <div className="relay-time-calc-item">
                          <span className="relay-time-calc-label">Unloading ({fmtMins(job.unloadingDurationMins)})</span>
                          <strong>{fmtTimeFull(job.calculatedUnloadEnd)}</strong>
                        </div>
                        <div className="relay-time-calc-total">
                          <span className="relay-time-calc-label">Total Job</span>
                          <strong>{fmtMins(job.totalJobDurationMins)}</strong>
                        </div>
                        {job.economics?.distanceMiles && (
                          <div className="relay-time-calc-item relay-time-calc-per-drop">
                            <span className="relay-time-calc-label">Route · Per Drop</span>
                            <strong>{job.economics.distanceMiles.toFixed(1)} mi</strong>
                            <small>{(job.economics.distanceMiles / dropCount).toFixed(1)} mi × {dropCount} drop{dropCount > 1 ? "s" : ""}</small>
                          </div>
                        )}
                      </div>
                    )}

                    {/* ── Job Economics ── */}
                    {job.economics && (
                      <div className="relay-economics-strip">
                        <div className="relay-economics-col">
                          <span className="relay-economics-label">Fuel Cost</span>
                          <strong>{fmtGBP(job.economics.fuelCost)}</strong>
                          <small>{job.economics.fuelSource === "receipts" ? "Driver fuel receipts" : `${fmtGBP(job.economics.fuelCostPerMile)}/mi estimate`}</small>
                        </div>
                        <div className="relay-economics-col">
                          <span className="relay-economics-label">Driver Cost</span>
                          <strong>{fmtGBP(job.economics.driverCost)}</strong>
                          <small>{fmtMins(job.economics.totalMins)} {job.economics.durationSource === "actual" ? "actual" : "planned"} time</small>
                        </div>
                        <div className="relay-economics-col">
                          <span className="relay-economics-label">Fleet Cost</span>
                          <strong>{fmtGBP(job.economics.fleetCost)}</strong>
                          <small>{job.economics.fleetCharged ? `${fmtGBP(job.economics.fleetCostPerHour)}/hr` : "No truck assigned"}</small>
                        </div>
                        {Number(job.economics.recordedExpenses || 0) > 0 && (
                          <div className="relay-economics-col">
                            <span className="relay-economics-label">Recorded Expenses</span>
                            <strong>{fmtGBP(job.economics.recordedExpenses)}</strong>
                            <small>Parking, meals, repairs</small>
                          </div>
                        )}
                        <div className="relay-economics-col">
                          <span className="relay-economics-label">Total Cost</span>
                          <strong>{fmtGBP(job.economics.totalCost)}</strong>
                        </div>
                        <div className="relay-economics-col">
                          <span className="relay-economics-label">Suggested Price</span>
                          <strong>{fmtGBP(job.economics.suggestedPrice)}</strong>
                        </div>
                        <div className="relay-economics-col">
                          <span className="relay-economics-label">Freight Charged</span>
                          <strong>{job.freight}</strong>
                        </div>
                        <div className={`relay-economics-col profit-col ${job.isProfitable === true ? "profit" : job.isProfitable === false ? "loss" : ""}`}>
                          <span className="relay-economics-label">{`${job.economics.basis === "actual" ? "Actual" : "Est."} ${job.isProfitable ? "Contribution Profit" : job.isProfitable === false ? "Contribution Loss" : ""}`.trim() || "Contribution unavailable"}</span>
                          <strong>
                            {job.profitLossValue !== null
                              ? `${job.profitLossValue >= 0 ? "+" : "-"}${fmtGBP(Math.abs(job.profitLossValue))}`
                              : "—"}
                          </strong>
                          {job.profitLossValue !== null && (
                            <small>{job.isProfitable ? "In profit" : "At a loss"}</small>
                          )}
                        </div>
                      </div>
                    )}

                    {/* ── Quick dispatch controls ── */}
                    <div className="relay-dispatch-controls">
                      <div className="relay-dispatch-label">Quick Dispatch{dispatchLocked && <small> · locked, job is {job.status}</small>}</div>
                      <div className="relay-dispatch-selects">
                        <div className="relay-dispatch-field">
                          <label>Driver</label>
                          <select
                            className={`jobs-planner-select ${driverToneVal}`}
                            disabled={dispatchLocked || busyId === `driver-${job.id}`}
                            value={job.driverId || ""}
                            onChange={e => updatePlannerField(job, { driver_id: e.target.value ? Number(e.target.value) : null }, "driver", "Driver could not be assigned.")}
                          >
                            <option value="">Assign Driver</option>
                            {(data?.drivers || []).map(driver => {
                              const busyElsewhere = driver.busy_trip_id && Number(driver.busy_trip_id) !== Number(job.id);
                              return (
                                <option key={driver.id} value={driver.id} disabled={busyElsewhere}>
                                  {driver.full_name} · {busyElsewhere ? `busy on ${driver.busy_trip_code}` : driver.shift_status}
                                </option>
                              );
                            })}
                          </select>
                        </div>
                        <div className="relay-dispatch-field">
                          <label>Truck</label>
                          <select
                            className={`jobs-planner-select ${vehicleToneVal}`}
                            disabled={dispatchLocked || busyId === `vehicle-${job.id}`}
                            value={job.vehicleId || ""}
                            onChange={e => updatePlannerField(job, { vehicle_id: e.target.value ? Number(e.target.value) : null }, "vehicle", "Truck could not be assigned.")}
                          >
                            <option value="">Assign Truck</option>
                            {(data?.vehicles || []).map(vehicle => {
                              const busyElsewhere = vehicle.busy_trip_id && Number(vehicle.busy_trip_id) !== Number(job.id);
                              return (
                                <option key={vehicle.id} value={vehicle.id} disabled={busyElsewhere}>
                                  {vehicle.registration_number} · {vehicle.truck_type || vehicle.model_name || "Truck"} · {busyElsewhere ? `busy on ${vehicle.busy_trip_code}` : vehicle.status}
                                </option>
                              );
                            })}
                          </select>
                        </div>
                        <div className="relay-dispatch-field">
                          <label>Trailer</label>
                          <select
                            className={`jobs-planner-select ${trolleyToneVal}`}
                            disabled={dispatchLocked || busyId === `trailer-${job.id}`}
                            value={job.trailerId || ""}
                            onChange={e => updatePlannerField(job, { trailer_id: e.target.value ? Number(e.target.value) : null }, "trailer", "Trailer could not be assigned.")}
                          >
                            <option value="">Assign Trailer</option>
                            {(data?.trailers || []).map(trailer => {
                              const busyElsewhere = trailer.busy_trip_id && Number(trailer.busy_trip_id) !== Number(job.id);
                              return (
                                <option key={trailer.id} value={trailer.id} disabled={busyElsewhere}>
                                  {trailer.trailer_code || trailer.registration_number} · {trailer.trailer_type || "Trailer"} · {busyElsewhere ? `busy on ${trailer.busy_trip_code}` : trailer.status}
                                </option>
                              );
                            })}
                          </select>
                        </div>
                        <div className="relay-dispatch-field">
                          <label>Status</label>
                          <select
                            className="jobs-planner-select compact"
                            disabled={job.status === "completed" || busyId === job.id}
                            value={job.status}
                            onChange={e => setStatus(job, e.target.value)}
                          >
                            {STATUS_OPTIONS.filter(opt => opt.value).map(opt => (
                              <option key={opt.value} value={opt.value}>{opt.value}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </div>

                    {/* ── Relay-style bottom bar ── */}
                    <div className="relay-bottom-bar">
                      <div className="relay-bottom-left">
                        {/* £ payout icon */}
                        <button className="relay-bottom-icon-btn" type="button" title="Estimated payout"
                          onClick={() => setNotesModalJob({ ...job, _openTab: "payout" })}>
                          <svg viewBox="0 0 20 20" fill="none" width="18" height="18">
                            <circle cx="10" cy="10" r="8.5" stroke="currentColor" strokeWidth="1.5"/>
                            <text x="10" y="14.5" textAnchor="middle" fontSize="10" fontWeight="700" fill="currentColor">£</text>
                          </svg>
                        </button>
                        {/* 📍 details icon */}
                        <button className="relay-bottom-icon-btn" type="button" title="View route map" aria-label="View route map"
                          onClick={() => setRouteMapJob(job)}>
                          <svg viewBox="0 0 20 20" fill="none" width="18" height="18">
                            <path d="M10 2a5.5 5.5 0 0 1 5.5 5.5c0 3.5-5.5 10-5.5 10S4.5 11 4.5 7.5A5.5 5.5 0 0 1 10 2z" stroke="currentColor" strokeWidth="1.5"/>
                            <circle cx="10" cy="7.5" r="1.8" stroke="currentColor" strokeWidth="1.5"/>
                          </svg>
                        </button>
                        {/* 💬 notes icon */}
                        <button className="relay-bottom-icon-btn" type="button" title="Job notes"
                          onClick={() => setNotesModalJob(job)}>
                          <svg viewBox="0 0 20 20" fill="none" width="18" height="18">
                            <path d="M17 2H3a1 1 0 00-1 1v11a1 1 0 001 1h2v3l4-3h8a1 1 0 001-1V3a1 1 0 00-1-1z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
                            <path d="M6 7h8M6 10h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                          </svg>
                        </button>
                        {/* 🔧 breakdown / replace vehicle icon */}
                        {job.vehicleAssigned && ["planned", "loading", "active"].includes(job.status) && (
                          <button className="relay-bottom-icon-btn" type="button" title="Report breakdown & replace vehicle"
                            onClick={() => { setReplaceTarget(job); setReplaceVehicleId(""); setReplaceReason(""); setReplaceErr(""); }}>
                            <svg viewBox="0 0 20 20" fill="none" width="18" height="18">
                              <path d="M14.7 3.3a3.5 3.5 0 0 0-4.6 4.2L4 13.6a1.5 1.5 0 0 0 2.1 2.1l6.1-6.1a3.5 3.5 0 0 0 4.2-4.6l-2.2 2.2-1.6-.5-.5-1.6 2.2-2.2z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
                            </svg>
                          </button>
                        )}
                        <button className="relay-bottom-link" type="button"
                          onClick={() => navigate(`/admin/jobs/${job.id}`)}>
                          View all shipment details
                        </button>
                      </div>
                      <div className="relay-bottom-right">
                        <button className="relay-bottom-edit-btn" type="button"
                          onClick={() => navigate(`/admin/jobs/${job.id}/edit`)}>
                          Edit Job
                        </button>
                        {(isActive || isLoading) && (
                          <button className="relay-bottom-delay-btn" type="button"
                            onClick={() => setDelayTarget(job)}>
                            Report delay
                          </button>
                        )}
                        {!isBlocked && !isCompleted && (
                          <button className="relay-bottom-block-btn" type="button"
                            disabled={busyId === job.id}
                            onClick={() => setBlockTarget(job)}>
                            {busyId === job.id ? "Saving…" : "Block"}
                          </button>
                        )}
                        {!isActive && !isLoading && (
                          <button className="relay-bottom-block-btn" type="button"
                            disabled={busyId === job.id}
                            onClick={() => setDeleteTarget(job)}>
                            Delete
                          </button>
                        )}
                      </div>
                    </div>

                  </div>
                )}
              </div>
            );
          })}
        </div>
        </section>
        {showImport && <ImportJobsModal existingJobs={data?.jobs || []} onClose={() => setShowImport(false)} onComplete={load} />}
      </div>

      {/* Block modal */}
      <DeleteReasonModal
        open={Boolean(blockTarget)}
        title="Block Job"
        recordLabel={blockTarget ? `${blockTarget.code} · ${blockTarget.customer}` : ""}
        body="The job will be blocked, its vehicle and trailer will be released, and this reason will be logged."
        confirmLabel="Block Job"
        loading={Boolean(busyId)}
        onCancel={() => setBlockTarget(null)}
        onConfirm={handleCancel}
      />

      <JobDeleteModal
        job={deleteTarget}
        loading={Boolean(busyId)}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
      />

      {/* Job details modal (Notes / Payout / Shipment) */}
      {routeMapJob && <JobRouteMapModal job={routeMapJob} onClose={() => setRouteMapJob(null)} />}
      {notesModalJob && (
        <JobDetailsModal job={notesModalJob} onClose={() => setNotesModalJob(null)} />
      )}

      {/* Driver chat modal */}
      {chatModalJob && (
        <div className="relay-modal-overlay" onClick={() => setChatModalJob(null)}>
          <div className="relay-modal relay-chat-modal" onClick={e => e.stopPropagation()}>
            <div className="relay-modal-header">
              <strong>Driver Chat</strong>
              <span>{chatModalJob.code} · {chatModalJob.driver}</span>
            </div>
            <DriverChatWidget
              compact
              hideDriverList
              initialDriverId={chatModalJob.driverId}
              title={`Chat With ${chatModalJob.driver}`}
            />
          </div>
        </div>
      )}

      {/* Report delay modal */}
      {delayTarget && (
        <div className="relay-modal-overlay" onClick={() => setDelayTarget(null)}>
          <div className="relay-modal" onClick={e => e.stopPropagation()}>
            <div className="relay-modal-header">
              <strong>Report Delay</strong>
              <span>{delayTarget.code} · {delayTarget.customer}</span>
            </div>
            <div className="relay-modal-body">
              <label className="relay-modal-label">Delay Reason</label>
              <textarea
                className="af-input"
                rows={3}
                placeholder="e.g. Traffic on M6, vehicle breakdown, customer not ready..."
                value={delayReason}
                onChange={e => setDelayReason(e.target.value)}
                style={{ resize: "vertical" }}
              />
            </div>
            <div className="relay-modal-footer">
              <button className="header-action-button" type="button" onClick={() => { setDelayTarget(null); setDelayReason(""); }}>
                Cancel
              </button>
              <button
                className="af-submit-btn"
                type="button"
                disabled={!delayReason.trim() || Boolean(busyId)}
                onClick={submitDelay}
              >
                {busyId ? "Saving…" : "Submit Delay Report"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Replace vehicle (breakdown) modal */}
      {replaceTarget && (
        <div className="relay-modal-overlay" onClick={() => setReplaceTarget(null)}>
          <div className="relay-modal" onClick={e => e.stopPropagation()}>
            <div className="relay-modal-header">
              <strong>Report Breakdown & Replace Vehicle</strong>
              <span>{replaceTarget.code} · {replaceTarget.customer}</span>
            </div>
            <div className="relay-modal-body">
              <label className="relay-modal-label">Current Truck</label>
              <p style={{ margin: "0 0 12px", fontWeight: 700 }}>{replaceTarget.vehicle}</p>

              <label className="relay-modal-label">New Truck</label>
              <select
                className="af-select"
                value={replaceVehicleId}
                onChange={e => setReplaceVehicleId(e.target.value)}
              >
                <option value="">Select an available truck</option>
                {(data?.vehicles || [])
                  .filter(v => v.status === "available" && !v.busy_trip_id && Number(v.id) !== Number(replaceTarget.vehicleId))
                  .map(v => (
                    <option key={v.id} value={v.id}>
                      {v.registration_number} · {v.truck_type || v.model_name || "Truck"}
                    </option>
                  ))}
              </select>

              <label className="relay-modal-label" style={{ marginTop: 12 }}>Reason for Replacing</label>
              <textarea
                className="af-input"
                rows={3}
                placeholder="e.g. Brake failure on M6, truck towed to garage..."
                value={replaceReason}
                onChange={e => setReplaceReason(e.target.value)}
                style={{ resize: "vertical" }}
              />
              {replaceErr && <p className="lp-error">{replaceErr}</p>}
            </div>
            <div className="relay-modal-footer">
              <button className="header-action-button" type="button" onClick={() => setReplaceTarget(null)}>
                Cancel
              </button>
              <button
                className="af-submit-btn"
                type="button"
                disabled={!replaceVehicleId || !replaceReason.trim() || Boolean(busyId)}
                onClick={submitReplaceVehicle}
              >
                {busyId ? "Saving…" : "Replace Vehicle"}
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminWorkspaceLayout>
  );
}
