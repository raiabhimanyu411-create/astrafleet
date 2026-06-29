import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getRealtimeSocket } from "../../../api/realtime";
import { addJobNote, cancelJob, getJobNotes, getJobs, updateJobAssignment, updateJobStatus } from "../../../api/jobApi";
import { DeleteReasonModal } from "../../../components/DeleteReasonModal";
import { StateNotice } from "../../../components/StateNotice";
import { StatusPill } from "../../../components/StatusPill";
import { AdminWorkspaceLayout } from "../AdminWorkspaceLayout";
import { getAuthSession } from "../../../utils/authSession";

const STATUS_OPTIONS = [
  { value: "", label: "All Statuses" },
  { value: "planned", label: "Planned" },
  { value: "loading", label: "Loading" },
  { value: "active", label: "Active" },
  { value: "completed", label: "Completed" },
  { value: "blocked", label: "Blocked" },
  { value: "failed", label: "Failed" },
  { value: "cancelled", label: "Cancelled" }
];

const PRIORITY_OPTIONS = [
  { value: "", label: "All Priorities" },
  { value: "standard", label: "Standard" },
  { value: "priority", label: "Priority" },
  { value: "critical", label: "Critical" }
];

const SORT_OPTIONS = [
  { value: "date_asc", label: "Start Date ↑" },
  { value: "date_desc", label: "Start Date ↓" },
  { value: "freight_desc", label: "Freight (High–Low)" },
  { value: "freight_asc", label: "Freight (Low–High)" },
  { value: "driver", label: "Driver A–Z" },
  { value: "customer", label: "Customer A–Z" },
  { value: "status", label: "Status" }
];

const LOAD_ICONS = {
  general: "📦", hazardous: "⚠️", refrigerated: "❄️",
  oversized: "🔩", fragile: "🫙", palletised: "🧱", bulk: "🏗️"
};

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

const TAB_STATUSES = {
  upcoming: ["planned", "loading"],
  intransit: ["active"],
  history: ["planned", "loading", "active", "completed", "blocked", "failed", "cancelled"]
};

const STATUS_TONE = {
  planned: "neutral", loading: "warning", active: "success",
  completed: "neutral", blocked: "danger", failed: "danger", cancelled: "neutral"
};

const PRIORITY_TONE = { standard: "neutral", priority: "warning", critical: "danger" };

function getWeekRange(offset = 0) {
  const now = new Date();
  const day = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1) + offset * 7);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  return { start: monday, end: sunday };
}

function fmtWeekLabel(start, end) {
  const opts = { day: "numeric", month: "short" };
  return `${start.toLocaleDateString("en-GB", opts)} – ${end.toLocaleDateString("en-GB", opts)}`;
}

function abbrevAddr(addr) {
  if (!addr || addr === "—") return "—";
  return addr.split(",")[0].trim();
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
  if (!rawStr) return "—";
  const d = new Date(rawStr);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function fmtGBP(n) {
  return `£${Number(n).toFixed(2)}`;
}

function timeLateClass(actualRaw, scheduledRaw) {
  if (!actualRaw || !scheduledRaw) return "";
  const actual = new Date(actualRaw);
  const scheduled = new Date(scheduledRaw);
  if (isNaN(actual) || isNaN(scheduled)) return "";
  const diffMins = (actual - scheduled) / 60000;
  if (diffMins > 15) return "relay-time-late";
  if (diffMins < -5) return "relay-time-early";
  return "relay-time-ontime";
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
          <button className={tab === "payout" ? "active" : ""} type="button" onClick={() => setTab("payout")}>Estimated Payout</button>
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
                      <tr><td>Fuel Cost</td><td>£{Number(job.economics.fuelCost || 0).toFixed(2)}</td></tr>
                      <tr><td>Driver Cost</td><td>£{Number(job.economics.driverCost || 0).toFixed(2)}</td></tr>
                      <tr><td>Fleet Cost</td><td>£{Number(job.economics.fleetCost || 0).toFixed(2)}</td></tr>
                      <tr className="rjd-payout-subtotal"><td><strong>Total Cost</strong></td><td><strong>£{Number(job.economics.totalCost || 0).toFixed(2)}</strong></td></tr>
                      <tr><td>Suggested Price</td><td>£{Number(job.economics.suggestedPrice || 0).toFixed(2)}</td></tr>
                      <tr><td>Freight Charged</td><td>{job.freight || "—"}</td></tr>
                    </tbody>
                  </table>
                  <div className={`rjd-payout-pl ${job.isProfitable === true ? "profit" : job.isProfitable === false ? "loss" : ""}`}>
                    <span>{job.isProfitable === true ? "Profit" : job.isProfitable === false ? "Loss" : "P&L"}</span>
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
                      <span>{new Date(note.created_at).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
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
              <span>{new Date(note.created_at).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
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
  const [delayTarget, setDelayTarget] = useState(null);
  const [delayReason, setDelayReason] = useState("");
  const [notesModalJob, setNotesModalJob] = useState(null);

  function load() {
    setLoading(true);
    return getJobs()
      .then(r => { setData(r.data); setError(""); })
      .catch(() => setError("Could not load jobs. Please refresh."))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  useEffect(() => {
    const socket = getRealtimeSocket();
    const handleJobUpdate = () => load();
    socket.connect();
    socket.emit("admin-jobs:join");
    socket.on("job:updated", handleJobUpdate);
    return () => {
      socket.off("job:updated", handleJobUpdate);
      socket.emit("admin-jobs:leave");
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
    setAttentionFilter(""); setShowUnassignedOnly(false);
  }

  const hasActiveFilters = Boolean(search || statusFilter || priorityFilter || attentionFilter || showUnassignedOnly);

  const filteredJobs = useMemo(() => {
    const statusSet = new Set(TAB_STATUSES[tab] || []);
    const query = search.trim().toLowerCase();
    return (data?.jobs || []).filter(job => {
      if (!statusSet.has(job.status)) return false;
      if (statusFilter && job.status !== statusFilter) return false;
      if (priorityFilter && job.priority !== priorityFilter) return false;
      if (showUnassignedOnly && job.driverAssigned && job.vehicleAssigned) return false;

      // History tab shows all jobs — no date restriction applied

      if (attentionFilter === "eta_risk" && !job.etaRisk) return false;
      if (attentionFilter === "unassigned" && (job.driverAssigned && job.vehicleAssigned)) return false;
      if (attentionFilter === "pod_pending" && !isPodPending(job)) return false;
      if (attentionFilter === "blocked" && job.status !== "blocked") return false;
      if (attentionFilter === "critical" && job.priority !== "critical") return false;

      if (!query) return true;
      return [job.code, job.customer, job.driver, job.vehicle, job.trailer,
              job.pickupAddress, job.dropAddress, job.lane, job.routeCode, job.loadType]
        .some(v => String(v || "").toLowerCase().includes(query));
    });
  }, [data, tab, weekRange, search, showUnassignedOnly, statusFilter, priorityFilter, attentionFilter]);

  const jobs = useMemo(() => sortJobs(filteredJobs, sortBy), [filteredJobs, sortBy]);

  const tabCounts = useMemo(() => {
    const all = data?.jobs || [];
    return {
      upcoming: all.filter(j => TAB_STATUSES.upcoming.includes(j.status)).length,
      intransit: all.filter(j => TAB_STATUSES.intransit.includes(j.status)).length,
      history: all.filter(j => TAB_STATUSES.history.includes(j.status)).length
    };
  }, [data]);

  const attentionCounts = useMemo(() => {
    const base = (data?.jobs || []).filter(j => (TAB_STATUSES[tab] || []).includes(j.status));
    return {
      eta_risk:    base.filter(j => j.etaRisk).length,
      unassigned:  base.filter(j => !j.driverAssigned || !j.vehicleAssigned).length,
      pod_pending: base.filter(isPodPending).length,
      blocked:     base.filter(j => j.status === "blocked").length,
      critical:    base.filter(j => j.priority === "critical").length
    };
  }, [data, tab]);

  async function updatePlannerField(job, payload, busyKey, fallbackMessage = "Job could not be updated.") {
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
    { key: "eta_risk",    label: "ETA Risk",     tone: "danger"  },
    { key: "unassigned",  label: "Unassigned",   tone: "warning" },
    { key: "pod_pending", label: "POD Pending",  tone: "warning" },
    { key: "blocked",     label: "Blocked",      tone: "danger"  },
    { key: "critical",    label: "Critical",     tone: "danger"  }
  ];

  return (
    <AdminWorkspaceLayout badge="Dispatch" title="Jobs" description="" highlights={[]}>
      <div className="relay-page">

        {/* ── Top tab bar ── */}
        <div className="relay-tabs">
          <button className={tab === "upcoming" ? "active" : ""} type="button" onClick={() => { setTab("upcoming"); setAttentionFilter(""); }}>
            Upcoming
            {tabCounts.upcoming > 0 && <span className="relay-tab-count">{tabCounts.upcoming}</span>}
          </button>
          <button className={tab === "intransit" ? "active" : ""} type="button" onClick={() => { setTab("intransit"); setAttentionFilter(""); }}>
            In Transit
            {tabCounts.intransit > 0 && <span className="relay-tab-count relay-tab-count--live">{tabCounts.intransit}</span>}
          </button>
          <button className={tab === "history" ? "active" : ""} type="button" onClick={() => { setTab("history"); setAttentionFilter(""); }}>
            All Jobs
            {tabCounts.history > 0 && <span className="relay-tab-count">{tabCounts.history}</span>}
          </button>
          <div className="relay-tabs-spacer" />
          <button className="relay-new-btn" type="button" onClick={() => navigate("/admin/jobs/new")}>
            + New Job
          </button>
        </div>

        {/* ── Filter bar ── */}
        <div className="relay-filter-bar">
          <div className="relay-search-wrap">
            <svg className="relay-search-icon" viewBox="0 0 20 20" fill="none">
              <circle cx="9" cy="9" r="6" stroke="#64748b" strokeWidth="1.5" />
              <path d="M15 15l-3-3" stroke="#64748b" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <input
              className="relay-search-input"
              placeholder="Search by IDs, location, drivers"
              type="search"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          {tab !== "history" && (
            <div className="relay-date-nav">
              <button className="relay-date-arrow" type="button" onClick={() => setWeekOffset(o => o - 1)}>‹</button>
              <span className="relay-date-label">{weekLabel}</span>
              <button className="relay-date-arrow" type="button" onClick={() => setWeekOffset(o => o + 1)}>›</button>
            </div>
          )}

          <select className="relay-filter-select" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            {STATUS_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
          </select>

          <select className="relay-filter-select" value={priorityFilter} onChange={e => setPriorityFilter(e.target.value)}>
            {PRIORITY_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
          </select>

          <div className="relay-toggle-wrap">
            <span className="relay-toggle-label">Show Unassigned Only</span>
            <button
              className={`relay-toggle ${showUnassignedOnly ? "on" : ""}`}
              type="button"
              role="switch"
              aria-checked={showUnassignedOnly}
              onClick={() => setShowUnassignedOnly(v => !v)}
            >
              <span className="relay-toggle-thumb" />
            </button>
          </div>
        </div>

        {/* ── Attention chips (Disruptions filter) ── */}
        <div className="relay-attention-strip">
          {ATTENTION_CHIPS.map(chip => {
            const count = attentionCounts[chip.key];
            return (
              <button
                key={chip.key}
                className={`relay-attention-chip ${chip.tone}${attentionFilter === chip.key ? " active" : ""}${count === 0 ? " empty" : ""}`}
                type="button"
                onClick={() => toggleAttention(chip.key)}
              >
                {chip.label}
                <strong>{count}</strong>
              </button>
            );
          })}
          {hasActiveFilters && (
            <button className="relay-attention-chip clear" type="button" onClick={clearAllFilters}>
              Clear Filters
            </button>
          )}
        </div>

        {/* ── Results bar ── */}
        <div className="relay-results-bar">
          <span className="relay-results-count">
            {loading ? "Loading…" : `1–${jobs.length} of ${jobs.length} results`}
            {hasActiveFilters && <span className="relay-filter-active-dot" />}
          </span>
          <div className="relay-results-actions">
            <button className="header-action-button" type="button" onClick={load}>Refresh</button>
            <button className="header-action-button" type="button" onClick={exportJobs}>Export</button>
            <div className="relay-sort-wrap">
              <span className="relay-sort-label">Sort By:</span>
              <select className="relay-sort-select" value={sortBy} onChange={e => setSortBy(e.target.value)}>
                {SORT_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
              </select>
            </div>
          </div>
        </div>

        <StateNotice loading={loading} error={error} />

        {/* ── Job list ── */}
        <div className="relay-job-list">
          {!loading && jobs.length === 0 && (
            <div className="relay-empty">
              <p>
                {hasActiveFilters
                  ? "No jobs match your current filters."
                  : tab === "upcoming" ? "No upcoming jobs."
                  : tab === "intransit" ? "No jobs currently in transit."
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

            const pickupShort = abbrevAddr(job.pickupAddress);
            const dropShort = abbrevAddr(job.dropAddress);
            const routeStops = Array.isArray(job.stops) ? job.stops : [];
            const stopCount = routeStops.length;
            const totalStops = stopCount + 2;
            const hasGap = !job.driverAssigned || !job.vehicleAssigned;
            const podPending = isPodPending(job);
            const loadIcon = LOAD_ICONS[job.loadType] || "📦";

            const driverStatusLabel = job.driverJobStatus && job.driverJobStatus !== "—"
              ? DRIVER_STATUS_LABEL[job.driverJobStatus] || job.driverJobStatus
              : null;
            const driverStatusToneVal = DRIVER_STATUS_TONE[job.driverJobStatus] || "neutral";

            const depTimeTone = job.actualDepartureRaw
              ? timeLateClass(job.actualDepartureRaw, job.departureRaw)
              : "";
            const arrTimeTone = job.actualArrivalRaw
              ? timeLateClass(job.actualArrivalRaw, job.etaRaw)
              : "";

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
                {/* ── Collapsed header row ── */}
                <div
                  className="relay-job-header"
                  role="button"
                  tabIndex={0}
                  onClick={() => toggleExpanded(job.id)}
                  onKeyDown={e => e.key === "Enter" && toggleExpanded(job.id)}
                >
                  <span className={`relay-chevron${isExpanded ? " open" : ""}`}>›</span>

                  <button
                    className="relay-job-code"
                    type="button"
                    onClick={e => { e.stopPropagation(); navigate(`/admin/jobs/${job.id}`); }}
                  >
                    {job.code}
                  </button>

                  {(job.reference || job.loadId) && (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: 4 }}>
                      {job.reference && (
                        <span style={{ fontSize: "0.72rem", fontWeight: 600, color: "#2563eb", background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 20, padding: "2px 8px", whiteSpace: "nowrap" }}>
                          Ref: {job.reference}
                        </span>
                      )}
                      {job.loadId && (
                        <span style={{ fontSize: "0.72rem", fontWeight: 600, color: "#059669", background: "#ecfdf5", border: "1px solid #a7f3d0", borderRadius: 20, padding: "2px 8px", whiteSpace: "nowrap" }}>
                          Load: {job.loadId}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Route visualization */}
                  <div className="relay-route-vis">
                    <div className="relay-stop-node">
                      <span className="relay-stop-bubble">1</span>
                      <span className="relay-stop-name" title={job.pickupAddress}>{pickupShort}</span>
                    </div>
                    <div className="relay-route-arrow">
                      <span className="relay-route-line" />
                      {stopCount > 0 && <span className="relay-route-mid">+{stopCount} stops</span>}
                      <span className="relay-route-arrowhead">→</span>
                    </div>
                    <div className="relay-stop-node">
                      <span className="relay-stop-bubble">{totalStops}</span>
                      <span className="relay-stop-name" title={job.dropAddress}>{dropShort}</span>
                    </div>
                  </div>

                  {/* Distance / ETA */}
                  <div className="relay-job-stats">
                    {job.distanceKm && <span>{Math.round(job.distanceKm * 0.621371)} mi</span>}
                    {job.etaHours && <span>{job.etaHours}h route</span>}
                  </div>

                  {/* Load icon + vehicle type */}
                  <div className="relay-job-vehicle-cell">
                    <span>
                      <span className="relay-load-icon">{loadIcon}</span>
                      {job.vehicleType !== "—" ? job.vehicleType : job.vehicleAssigned ? job.vehicle : <em className="relay-unassigned">No truck</em>}
                    </span>
                    {job.trailerType !== "—" && <small>{job.trailerType}</small>}
                  </div>

                  {/* Freight + Profit/Loss */}
                  <div className="relay-job-freight">
                    <span>{job.freight}</span>
                    {job.profitLoss && (
                      <span className={`relay-profit-badge ${job.isProfitable ? "profit" : "loss"}`}>
                        {job.isProfitable ? "▲" : "▼"} {job.profitLoss}
                      </span>
                    )}
                    {!job.profitLoss && job.economics && (
                      <span className="relay-profit-badge pending">calc pending</span>
                    )}
                  </div>

                  {/* Driver + driver status */}
                  <div className="relay-job-driver-cell">
                    <span>{job.driverAssigned ? job.driver : <em className="relay-unassigned">Unassigned</em>}</span>
                    {driverStatusLabel && (
                      <small className={`relay-driver-status-badge ${driverStatusToneVal}`}>{driverStatusLabel}</small>
                    )}
                  </div>

                  {/* Status pills */}
                  <div className="relay-job-status-cell">
                    <StatusPill tone={STATUS_TONE[job.status] || "neutral"}>{job.status}</StatusPill>
                    {job.priority !== "standard" && (
                      <StatusPill tone={PRIORITY_TONE[job.priority] || "neutral"}>{job.priority}</StatusPill>
                    )}
                    {hasGap && <StatusPill tone="warning">Gap</StatusPill>}
                    {job.etaRisk && <StatusPill tone="danger">ETA risk</StatusPill>}
                    {podPending && <StatusPill tone="warning">POD</StatusPill>}
                  </div>

                  {/* Notes icon button */}
                  <button
                    className="relay-notes-icon-btn"
                    type="button"
                    title="View job notes & details"
                    onClick={e => { e.stopPropagation(); setNotesModalJob(job); }}
                  >
                    <svg viewBox="0 0 20 20" fill="none" width="16" height="16">
                      <path d="M17 2H3a1 1 0 00-1 1v11a1 1 0 001 1h2v3l4-3h8a1 1 0 001-1V3a1 1 0 00-1-1z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
                      <path d="M6 7h8M6 10h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                    </svg>
                  </button>
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
                        <span>⚠️ ETA risk · Scheduled ETA has passed and job is still open</span>
                        <button
                          className="header-action-button"
                          type="button"
                          onClick={() => setDelayTarget(job)}
                        >
                          Report Delay
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

                    {/* ── Stop table ── */}
                    <div className="relay-stop-table">
                      <div className="relay-stop-table-head">
                        <span>Stop</span>
                        <span>Equipment</span>
                        <span>Arrival</span>
                        <span>Departure</span>
                      </div>

                      {/* Stop 1 — Pickup */}
                      <div className="relay-stop-block">
                        <div className="relay-stop-row">
                          <div className="relay-stop-location">
                            <span className="relay-stop-bubble">1</span>
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
                            <span className="relay-time-dash">—</span>
                          </div>
                          <div className="relay-stop-time">
                            <strong className={depTimeTone}>
                              {job.actualDeparture && job.actualDeparture !== "—"
                                ? job.actualDeparture
                                : job.departure !== "—" ? job.departure : "TBD"}
                            </strong>
                            {job.departure !== "—" && job.actualDeparture && job.actualDeparture !== "—" && (
                              <small className="relay-sch-time">Sch. {job.departure}</small>
                            )}
                            {!job.actualDeparture && job.departure !== "—" && (
                              <small className="relay-sch-time">Sch. {job.departure}</small>
                            )}
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

                      {/* Intermediate stops */}
                      {routeStops.map((stop, index) => (
                        <div className="relay-stop-block" key={stop.id || `${job.id}-stop-${index}`}>
                          <div className="relay-stop-row">
                            <div className="relay-stop-location">
                              <span className="relay-stop-bubble">{index + 2}</span>
                              <div>
                                <strong>{abbrevAddr(stop.address)}</strong>
                                <small>{stop.address !== "—" ? stop.address : "Address not set"}</small>
                                <small className="relay-dock-label">
                                  {(stop.type || "stop").replace(/^./, c => c.toUpperCase())} stop{stop.status ? ` · ${stop.status}` : ""}
                                </small>
                              </div>
                            </div>
                            <div className="relay-stop-equipment">
                              <span>Stop type <strong>{stop.type || "—"}</strong></span>
                              <span>Contact <strong>{stop.contactName !== "—" ? stop.contactName : "—"}</strong></span>
                              {stop.contactPhone !== "—" && <span>Phone <strong>{stop.contactPhone}</strong></span>}
                            </div>
                            <div className="relay-stop-time">
                              <strong>{stop.actualArrival !== "—" ? stop.actualArrival : stop.plannedArrival !== "—" ? stop.plannedArrival : "TBD"}</strong>
                              {stop.actualArrival !== "—" && stop.plannedArrival !== "—" && (
                                <small className="relay-sch-time">Sch. {stop.plannedArrival}</small>
                              )}
                              {stop.actualArrival === "—" && stop.plannedArrival !== "—" && (
                                <small className="relay-sch-time">Sch. {stop.plannedArrival}</small>
                              )}
                            </div>
                            <div className="relay-stop-time">
                              <strong>{stop.plannedDeparture !== "—" ? stop.plannedDeparture : "—"}</strong>
                              {stop.plannedDeparture !== "—" && (
                                <small className="relay-sch-time">Sch. {stop.plannedDeparture}</small>
                              )}
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
                      ))}

                      {/* Final Drop */}
                      <div className="relay-stop-block">
                        <div className="relay-stop-row">
                          <div className="relay-stop-location">
                            <span className="relay-stop-bubble">{totalStops}</span>
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
                          </div>
                          <div className="relay-stop-time">
                            <strong className={arrTimeTone}>
                              {job.actualArrival && job.actualArrival !== "—"
                                ? job.actualArrival
                                : job.eta !== "—" ? job.eta : "TBD"}
                            </strong>
                            {job.eta !== "—" && job.actualArrival && job.actualArrival !== "—" && (
                              <small className="relay-sch-time">Sch. {job.eta}</small>
                            )}
                            {!job.actualArrival && job.eta !== "—" && (
                              <small className="relay-sch-time">Sch. {job.eta}</small>
                            )}
                            {isActive && (
                              <button className="relay-report-delay-btn" type="button"
                                onClick={e => { e.stopPropagation(); setDelayTarget(job); }}>
                                Report delay
                              </button>
                            )}
                          </div>
                          <div className="relay-stop-time">
                            <span className="relay-time-dash">—</span>
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
                          <strong>
                            {job.economics?.distanceMiles
                              ? fmtMins(Math.round((job.economics.distanceMiles / (job.settings?.avgSpeedMph || 40)) * 60))
                              : "—"}
                          </strong>
                          <small>{job.economics?.distanceMiles?.toFixed(1)} mi</small>
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
                      </div>
                    )}

                    {/* ── Job Economics ── */}
                    {job.economics && (
                      <div className="relay-economics-strip">
                        <div className="relay-economics-col">
                          <span className="relay-economics-label">Fuel Cost</span>
                          <strong>{fmtGBP(job.economics.fuelCost)}</strong>
                          <small>{fmtGBP(job.economics.fuelCostPerMile)}/mi</small>
                        </div>
                        <div className="relay-economics-col">
                          <span className="relay-economics-label">Driver Cost</span>
                          <strong>{fmtGBP(job.economics.driverCost)}</strong>
                          <small>{fmtMins(job.totalJobDurationMins)} job time</small>
                        </div>
                        <div className="relay-economics-col">
                          <span className="relay-economics-label">Fleet Cost</span>
                          <strong>{fmtGBP(job.economics.fleetCost)}</strong>
                          <small>{fmtGBP(job.economics.fleetCostPerHour)}/hr</small>
                        </div>
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
                          <span className="relay-economics-label">{job.isProfitable ? "Profit" : job.isProfitable === false ? "Loss" : "P&L"}</span>
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
                      <div className="relay-dispatch-label">Quick Dispatch</div>
                      <div className="relay-dispatch-selects">
                        <div className="relay-dispatch-field">
                          <label>Driver</label>
                          <select
                            className={`jobs-planner-select ${driverToneVal}`}
                            disabled={busyId === `driver-${job.id}`}
                            value={job.driverId || ""}
                            onChange={e => updatePlannerField(job, { driver_id: e.target.value ? Number(e.target.value) : null }, "driver", "Driver could not be assigned.")}
                          >
                            <option value="">Assign Driver</option>
                            {(data?.drivers || []).map(driver => (
                              <option key={driver.id} value={driver.id}>
                                {driver.full_name} · {driver.shift_status}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="relay-dispatch-field">
                          <label>Truck</label>
                          <select
                            className={`jobs-planner-select ${vehicleToneVal}`}
                            disabled={busyId === `vehicle-${job.id}`}
                            value={job.vehicleId || ""}
                            onChange={e => updatePlannerField(job, { vehicle_id: e.target.value ? Number(e.target.value) : null }, "vehicle", "Truck could not be assigned.")}
                          >
                            <option value="">Assign Truck</option>
                            {(data?.vehicles || []).map(vehicle => (
                              <option key={vehicle.id} value={vehicle.id}>
                                {vehicle.registration_number} · {vehicle.truck_type || vehicle.model_name || "Truck"} · {vehicle.status}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="relay-dispatch-field">
                          <label>Trailer</label>
                          <select
                            className={`jobs-planner-select ${trolleyToneVal}`}
                            disabled={busyId === `trailer-${job.id}`}
                            value={job.trailerId || ""}
                            onChange={e => updatePlannerField(job, { trailer_id: e.target.value ? Number(e.target.value) : null }, "trailer", "Trailer could not be assigned.")}
                          >
                            <option value="">Assign Trailer</option>
                            {(data?.trailers || []).map(trailer => (
                              <option key={trailer.id} value={trailer.id}>
                                {trailer.registration_number} · {trailer.trailer_type || "Trailer"} · {trailer.status}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="relay-dispatch-field">
                          <label>Status</label>
                          <select
                            className="jobs-planner-select compact"
                            disabled={busyId === job.id}
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
                        <button className="relay-bottom-icon-btn" type="button" title="View job details"
                          onClick={() => navigate(`/admin/jobs/${job.id}`)}>
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
                      </div>
                    </div>

                  </div>
                )}
              </div>
            );
          })}
        </div>
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

      {/* Job details modal (Notes / Payout / Shipment) */}
      {notesModalJob && (
        <JobDetailsModal job={notesModalJob} onClose={() => setNotesModalJob(null)} />
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
    </AdminWorkspaceLayout>
  );
}
