import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getRealtimeSocket } from "../../../api/realtime";
import { cancelJob, getJobs, updateJobAssignment, updateJobStatus } from "../../../api/jobApi";
import { DeleteReasonModal } from "../../../components/DeleteReasonModal";
import { StateNotice } from "../../../components/StateNotice";
import { StatusPill } from "../../../components/StatusPill";
import { AdminWorkspaceLayout } from "../AdminWorkspaceLayout";

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "planned", label: "Planned" },
  { value: "loading", label: "Loading" },
  { value: "active", label: "Active" },
  { value: "completed", label: "Completed" },
  { value: "blocked", label: "Blocked" }
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
  { value: "freight_desc", label: "Freight (high–low)" },
  { value: "freight_asc", label: "Freight (low–high)" },
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
  history: ["completed", "blocked"]
};

const STATUS_TONE = {
  planned: "neutral", loading: "warning", active: "success",
  completed: "neutral", blocked: "danger"
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
  const [busyId, setBusyId] = useState(null);
  const [blockTarget, setBlockTarget] = useState(null);
  const [delayTarget, setDelayTarget] = useState(null);
  const [delayReason, setDelayReason] = useState("");

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

      if (tab === "history" && job.departureRaw) {
        const dep = new Date(job.departureRaw);
        if (dep < weekRange.start || dep > weekRange.end) return false;
      }

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
       "Departure", "ETA", "Distance km", "Status", "Freight GBP", "POD Status"],
      ...jobs.map(job => [job.code, job.customer, job.lane, job.loadType, job.priority,
        job.driver, job.vehicle, job.trailer, job.departureRaw, job.etaRaw,
        job.distanceKm, job.status, job.freightValue, job.podStatus])
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
            History
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

          <div className="relay-date-nav">
            <button className="relay-date-arrow" type="button" onClick={() => setWeekOffset(o => o - 1)}>‹</button>
            <span className="relay-date-label">{weekLabel}</span>
            <button className="relay-date-arrow" type="button" onClick={() => setWeekOffset(o => o + 1)}>›</button>
          </div>

          <select className="relay-filter-select" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            {STATUS_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
          </select>

          <select className="relay-filter-select" value={priorityFilter} onChange={e => setPriorityFilter(e.target.value)}>
            {PRIORITY_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
          </select>

          <div className="relay-toggle-wrap">
            <span className="relay-toggle-label">Show unassigned only</span>
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
              Clear filters
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
              <span className="relay-sort-label">Sort by:</span>
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
                  : `No ${tab === "upcoming" ? "upcoming" : tab === "intransit" ? "in-transit" : "history"} jobs${tab === "history" ? " for this week" : ""}.`}
              </p>
              {hasActiveFilters && (
                <button className="header-action-button" type="button" onClick={clearAllFilters}>Clear filters</button>
              )}
              {tab === "upcoming" && !hasActiveFilters && (
                <button className="af-submit-btn" type="button" onClick={() => navigate("/admin/jobs/new")}>
                  Create first job
                </button>
              )}
              {tab === "history" && weekOffset !== 0 && (
                <button className="header-action-button" type="button" onClick={() => setWeekOffset(0)}>
                  Back to current week
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
            const stopCount = Number(job.stopCount || 0);
            const totalStops = Math.max(stopCount, 2);
            const hasGap = !job.driverAssigned || !job.vehicleAssigned;
            const podPending = isPodPending(job);
            const loadIcon = LOAD_ICONS[job.loadType] || "📦";

            const driverStatusLabel = job.driverJobStatus && job.driverJobStatus !== "—"
              ? DRIVER_STATUS_LABEL[job.driverJobStatus] || job.driverJobStatus
              : null;
            const driverStatusToneVal = DRIVER_STATUS_TONE[job.driverJobStatus] || "neutral";

            const depTimeTone = job.actualDeparture && job.actualDeparture !== "—"
              ? timeLateClass(job.actualDeparture?.replace(" ", "T"), job.departureRaw)
              : "";
            const arrTimeTone = job.actualArrival && job.actualArrival !== "—"
              ? timeLateClass(job.actualArrival?.replace(" ", "T"), job.etaRaw)
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

                  {/* Route visualization */}
                  <div className="relay-route-vis">
                    <div className="relay-stop-node">
                      <span className="relay-stop-bubble">1</span>
                      <span className="relay-stop-name" title={job.pickupAddress}>{pickupShort}</span>
                    </div>
                    <div className="relay-route-arrow">
                      <span className="relay-route-line" />
                      {stopCount > 2 && <span className="relay-route-mid">+{stopCount - 2} stops</span>}
                      <span className="relay-route-arrowhead">→</span>
                    </div>
                    <div className="relay-stop-node">
                      <span className="relay-stop-bubble">{totalStops}</span>
                      <span className="relay-stop-name" title={job.dropAddress}>{dropShort}</span>
                    </div>
                  </div>

                  {/* Distance / ETA */}
                  <div className="relay-job-stats">
                    {job.distanceKm && <span>{job.distanceKm} km</span>}
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

                  {/* Freight */}
                  <div className="relay-job-freight">{job.freight}</div>

                  {/* Driver + driver status */}
                  <div className="relay-job-driver-cell">
                    <span>{job.driverAssigned ? job.driver : <em className="relay-unassigned">Unassigned</em>}</span>
                    {driverStatusLabel && isActive && (
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
                          Reset to planned
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
                          Report delay
                        </button>
                      </div>
                    )}

                    {/* POD pending banner */}
                    {podPending && (
                      <div className="relay-status-banner warning">
                        <span>📋 POD pending · Proof of delivery has not been uploaded or verified</span>
                        <button className="header-action-button" type="button" onClick={() => navigate(`/admin/jobs/${job.id}`)}>
                          View job
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
                            Drop Trailer
                          </span>
                          <span>Trailer Id <strong>{job.trailerAssigned ? job.trailer : "—"}</strong></span>
                          {(isActive || isLoading || isCompleted) && (
                            <span className={`relay-live-badge${isCompleted ? " success" : ""}`}>
                              {isActive ? "Live · in transit" : isLoading ? "Live · loading" : "Departed"}
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
                            <small>Sch. {job.departure}</small>
                          )}
                          {(isActive || isLoading) && (
                            <button
                              className="relay-report-delay-btn"
                              type="button"
                              onClick={e => { e.stopPropagation(); setDelayTarget(job); }}
                            >
                              Report delay
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Stop 2 — Drop */}
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
                            Drop Trailer
                          </span>
                          <span>Trailer Id <strong>{job.trailerAssigned ? job.trailer : "—"}</strong></span>
                          {isCompleted && <span className="relay-live-badge success">Delivered</span>}
                          <span className="relay-pod-status">
                            POD: <strong>{job.podStatus}</strong>
                          </span>
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
                            <small>Sch. {job.eta}</small>
                          )}
                          {isActive && (
                            <button
                              className="relay-report-delay-btn"
                              type="button"
                              onClick={e => { e.stopPropagation(); setDelayTarget(job); }}
                            >
                              Report delay
                            </button>
                          )}
                        </div>
                        <div className="relay-stop-time">
                          <span className="relay-time-dash">—</span>
                        </div>
                      </div>
                    </div>

                    {/* ── Instructions toggle ── */}
                    {(job.specialInstructions !== "—" || job.dispatcherNotes !== "—") && (
                      <div className="relay-instructions-bar">
                        <button
                          className="relay-instructions-toggle"
                          type="button"
                          onClick={() => toggleInstructions(job.id)}
                        >
                          {isShowingInstructions ? "▲" : "▼"} Pick-up / drop-off instructions
                        </button>
                        {isShowingInstructions && (
                          <div className="relay-instructions-body">
                            {job.specialInstructions !== "—" && (
                              <p><strong>Special instructions:</strong> {job.specialInstructions}</p>
                            )}
                            {job.dispatcherNotes !== "—" && (
                              <p><strong>Dispatcher notes:</strong> {job.dispatcherNotes}</p>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* ── Quick dispatch controls ── */}
                    <div className="relay-dispatch-controls">
                      <div className="relay-dispatch-label">Quick dispatch</div>
                      <div className="relay-dispatch-selects">
                        <div className="relay-dispatch-field">
                          <label>Driver</label>
                          <select
                            className={`jobs-planner-select ${driverToneVal}`}
                            disabled={busyId === `driver-${job.id}`}
                            value={job.driverId || ""}
                            onChange={e => updatePlannerField(job, { driver_id: e.target.value ? Number(e.target.value) : null }, "driver", "Driver could not be assigned.")}
                          >
                            <option value="">Assign driver</option>
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
                            <option value="">Assign truck</option>
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
                            onChange={e => updatePlannerField(job, { trailer_id: e.target.value ? Number(e.target.value) : null }, "trailer", "Trolley could not be assigned.")}
                          >
                            <option value="">Assign trolley</option>
                            {(data?.trailers || []).map(trailer => (
                              <option key={trailer.id} value={trailer.id}>
                                {trailer.registration_number} · {trailer.trailer_type || "Trolley"} · {trailer.status}
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

                    {/* ── Footer: Contact / Reference / Instructions ── */}
                    <div className="relay-job-footer">
                      <div className="relay-footer-section">
                        <span className="relay-footer-label">Contact</span>
                        <span>{job.customerContact !== "—" ? job.customerContact : job.customer}</span>
                        <span className="relay-footer-sub">{job.customerPhone}</span>
                      </div>
                      <div className="relay-footer-section">
                        <span className="relay-footer-label">Reference #</span>
                        <span>{job.code}</span>
                        {job.routeCode !== "—" && <span className="relay-footer-sub">{job.routeCode}</span>}
                      </div>
                      <div className="relay-footer-section">
                        <span className="relay-footer-label">Load</span>
                        <span>{loadIcon} {job.loadType}</span>
                        {job.loadWeightKg && <span className="relay-footer-sub">{job.loadWeightKg} kg{job.loadVolumeCbm ? ` · ${job.loadVolumeCbm} cbm` : ""}</span>}
                      </div>
                      <div className="relay-footer-actions">
                        <button className="header-action-button" type="button" onClick={() => navigate(`/admin/jobs/${job.id}`)}>
                          Open details
                        </button>
                        <button className="header-action-button" type="button" onClick={() => navigate(`/admin/jobs/${job.id}/edit`)}>
                          Edit
                        </button>
                        {(isActive || isLoading) && (
                          <button className="header-action-button" type="button" onClick={() => setDelayTarget(job)}>
                            Report delay
                          </button>
                        )}
                        {!isBlocked && !isCompleted && (
                          <button
                            className="header-action-button danger"
                            type="button"
                            disabled={busyId === job.id}
                            onClick={() => setBlockTarget(job)}
                          >
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
        title="Block job"
        recordLabel={blockTarget ? `${blockTarget.code} · ${blockTarget.customer}` : ""}
        body="The job will be blocked, its vehicle and trolley will be released, and this reason will be logged."
        confirmLabel="Block job"
        loading={Boolean(busyId)}
        onCancel={() => setBlockTarget(null)}
        onConfirm={handleCancel}
      />

      {/* Report delay modal */}
      {delayTarget && (
        <div className="relay-modal-overlay" onClick={() => setDelayTarget(null)}>
          <div className="relay-modal" onClick={e => e.stopPropagation()}>
            <div className="relay-modal-header">
              <strong>Report delay</strong>
              <span>{delayTarget.code} · {delayTarget.customer}</span>
            </div>
            <div className="relay-modal-body">
              <label className="relay-modal-label">Delay reason</label>
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
                {busyId ? "Saving…" : "Submit delay report"}
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminWorkspaceLayout>
  );
}
