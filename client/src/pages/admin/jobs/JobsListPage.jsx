import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { cancelJob, getJobs, updateJobStatus } from "../../../api/jobApi";
import { StatCard } from "../../../components/StatCard";
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

export function JobsListPage() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterPriority, setFilterPriority] = useState("");
  const [riskFilter, setRiskFilter] = useState("");
  const [busyId, setBusyId] = useState(null);

  function load() {
    setLoading(true);
    const params = {};
    if (filterStatus) params.status = filterStatus;
    if (filterPriority) params.priority = filterPriority;
    if (search) params.search = search;

    return getJobs(params)
      .then(r => {
        setData(r.data);
        setError("");
      })
      .catch(() => setError("Could not load jobs. Please refresh."))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [filterStatus, filterPriority]);

  const jobs = useMemo(() => {
    return (data?.jobs || []).filter(job => {
      if (riskFilter === "assignment" && job.driverAssigned && job.vehicleAssigned) return false;
      if (riskFilter === "eta" && !job.etaRisk) return false;
      if (riskFilter === "blocked" && job.status !== "blocked") return false;
      if (riskFilter === "multi_stop" && Number(job.stopCount || 0) === 0) return false;
      return true;
    });
  }, [data, riskFilter]);

  const visibleStats = useMemo(() => {
    const rows = jobs;
    return [
      { label: "Visible jobs", value: rows.length, description: "After current filters.", change: "Filtered", tone: "neutral" },
      { label: "Open jobs", value: rows.filter(job => !["completed", "blocked"].includes(job.status)).length, description: "Still in operation.", change: "Live queue", tone: "warning" },
      { label: "Unassigned", value: rows.filter(job => !job.driverAssigned || !job.vehicleAssigned).length, description: "Missing driver or vehicle.", change: "Dispatch gap", tone: "danger" },
      { label: "Visible value", value: `£${rows.reduce((sum, job) => sum + Number(job.freightValue || 0), 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, description: "Freight value in view.", change: "GBP", tone: "success" }
    ];
  }, [jobs]);

  const hasFilters = Boolean(search || filterStatus || filterPriority || riskFilter);

  function handleSearch(e) {
    e.preventDefault();
    load();
  }

  function clearFilters() {
    setSearch("");
    setFilterStatus("");
    setFilterPriority("");
    setRiskFilter("");
  }

  async function setStatus(job, status) {
    setError("");
    setBusyId(job.id);
    try {
      await updateJobStatus(job.id, { status, reason: status === "blocked" ? "Blocked from jobs board" : undefined });
      await load();
    } catch (err) {
      setError(err?.response?.data?.message || "Job status could not be updated.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleCancel(job) {
    const label = job.code || "this job";
    if (!window.confirm(`Block ${label}? Vehicle and trolley will be released.`)) return;

    setError("");
    setBusyId(job.id);
    try {
      await cancelJob(job.id, { reason: "Blocked from jobs board" });
      await load();
    } catch (err) {
      setError(err?.response?.data?.message || "Job could not be blocked. Please try again.");
    } finally {
      setBusyId(null);
    }
  }

  function exportJobs() {
    exportCsv("jobs-register.csv", [
      ["Job code", "Customer", "Lane", "Load", "Weight kg", "Driver", "Vehicle", "Trolley", "Departure", "ETA", "Stops", "Priority", "Status", "Freight GBP", "Risk"],
      ...jobs.map(job => [
        job.code,
        job.customer,
        job.lane,
        job.loadType,
        job.loadWeightKg,
        job.driver,
        job.vehicle,
        job.trailer,
        job.departureRaw,
        job.etaRaw,
        job.stopCount,
        job.priority,
        job.status,
        job.freightValue,
        [!job.driverAssigned || !job.vehicleAssigned ? "Assignment gap" : "", job.etaRisk ? "ETA risk" : "", job.status === "blocked" ? "Blocked" : ""].filter(Boolean).join("; ")
      ])
    ]);
  }

  return (
    <AdminWorkspaceLayout
      badge="Job management"
      title="Jobs & bookings"
      description="Create, manage, and track all freight jobs from booking to proof of delivery."
      highlights={[
        "All jobs are listed with customer, driver, vehicle, and load details.",
        "Use filters to view by status, priority, assignment risk, or ETA risk.",
        "Quick actions help dispatch move jobs from planned to loading, active, and completed."
      ]}
    >
      <div className="finance-command-bar">
        <button className="header-action-button" type="button" onClick={load}>Refresh</button>
        <button className="header-action-button" type="button" onClick={exportJobs}>Export CSV</button>
        <button className="af-submit-btn" type="button" onClick={() => navigate("/admin/jobs/new")}>+ New job</button>
      </div>

      <StateNotice loading={loading} error={error} />

      <section className="stats-grid">
        {(data?.stats || []).map(item => (
          <StatCard key={item.label} item={item} />
        ))}
      </section>

      <section className="stats-grid inline finance-position-grid">
        {(data?.opsHealth || []).map(item => (
          <StatCard key={item.label} item={item} />
        ))}
      </section>

      <section className="content-grid">
        <article className="content-card">
          <div className="section-head">
            <div>
              <span className="card-label">Dispatch control</span>
              <h2>Visible job workload</h2>
            </div>
            <StatusPill tone="neutral">Filtered view</StatusPill>
          </div>
          <div className="billing-workflow-grid">
            {visibleStats.map(item => (
              <button className="billing-workflow-tile" key={item.label} type="button" onClick={() => {
                if (item.label === "Unassigned") setRiskFilter("assignment");
                if (item.label === "Open jobs") setFilterStatus("");
              }}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
                <p>{item.description}</p>
              </button>
            ))}
          </div>
        </article>

        <article className="content-card">
          <div className="section-head">
            <div>
              <span className="card-label">Exceptions</span>
              <h2>Jobs needing attention</h2>
            </div>
            <StatusPill tone="warning">Ops review</StatusPill>
          </div>
          <div className="alert-stack">
            {jobs.filter(job => job.etaRisk || !job.driverAssigned || !job.vehicleAssigned || job.status === "blocked").slice(0, 6).map(job => (
              <div className="alert-card" key={job.id} onClick={() => navigate(`/admin/jobs/${job.id}`)} style={{ cursor: "pointer" }}>
                <div className={`alert-bar ${job.status === "blocked" || job.etaRisk ? "danger" : "warning"}`} />
                <div>
                  <strong>{job.code}</strong>
                  <p>
                    {job.status === "blocked"
                      ? job.cancellationReason || "Blocked job requires dispatch review."
                      : job.etaRisk
                        ? `ETA risk on ${job.lane}.`
                        : "Driver or vehicle assignment is missing."}
                  </p>
                </div>
              </div>
            ))}
            {!loading && jobs.filter(job => job.etaRisk || !job.driverAssigned || !job.vehicleAssigned || job.status === "blocked").length === 0 && (
              <p className="finance-empty">No job exceptions right now. Assignment gaps, blocked jobs, and ETA risk will appear here.</p>
            )}
          </div>
        </article>
      </section>

      <section className="content-card jobs-filter-card">
        <form onSubmit={handleSearch} className="jobs-search-form">
          <input
            className="af-input"
            type="text"
            placeholder="Search by job code, customer, or booking..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <button type="submit" className="header-action-button">Search</button>
        </form>

        <select className="af-select" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>

        <select className="af-select" value={filterPriority} onChange={e => setFilterPriority(e.target.value)}>
          {PRIORITY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>

        <select className="af-select" value={riskFilter} onChange={e => setRiskFilter(e.target.value)}>
          <option value="">All risk states</option>
          <option value="assignment">Assignment gaps</option>
          <option value="eta">ETA risk</option>
          <option value="blocked">Blocked jobs</option>
          <option value="multi_stop">Multi-stop jobs</option>
        </select>

        <button className="header-action-button" disabled={!hasFilters} type="button" onClick={clearFilters}>Clear filters</button>
      </section>

      <section className="content-card">
        <div className="section-head">
          <div>
            <span className="card-label">Jobs register</span>
            <h2>Freight booking records</h2>
          </div>
          <StatusPill tone={jobs.length ? "success" : "neutral"}>{jobs.length} visible</StatusPill>
        </div>

        <div className="data-rows compact finance-list">
          {jobs.map(job => (
            <div className="data-row finance-row jobs-row" key={job.id}>
              <button className="finance-row-main jobs-row-main" type="button" onClick={() => navigate(`/admin/jobs/${job.id}`)}>
                <div>
                  <strong>{job.code}</strong>
                  <p>{job.customer} · {job.lane}</p>
                </div>
                <div>
                  <span>{job.freight}</span>
                  <p>{job.loadType} · {job.loadWeightKg ? `${job.loadWeightKg} kg` : "Weight TBD"}</p>
                </div>
                <div>
                  <span>{job.driver}</span>
                  <p>{job.vehicle} · {job.trailer}</p>
                </div>
                <div>
                  <span>{job.departure}</span>
                  <p>ETA {job.eta}{job.stopCount > 0 ? ` · ${job.stopCount} stops` : ""}</p>
                </div>
              </button>
              <div className="finance-row-actions">
                <StatusPill tone={job.priorityTone}>{job.priority}</StatusPill>
                <StatusPill tone={job.statusTone}>{job.status}</StatusPill>
                {job.status === "planned" && (
                  <button className="header-action-button" disabled={busyId === job.id} type="button" onClick={() => setStatus(job, "loading")}>Load</button>
                )}
                {["planned", "loading"].includes(job.status) && (
                  <button className="header-action-button" disabled={busyId === job.id} type="button" onClick={() => setStatus(job, "active")}>Start</button>
                )}
                {["active", "loading"].includes(job.status) && (
                  <button className="header-action-button" disabled={busyId === job.id} type="button" onClick={() => setStatus(job, "completed")}>Complete</button>
                )}
                <button className="header-action-button" type="button" onClick={() => navigate(`/admin/jobs/${job.id}/edit`)}>Edit</button>
                {job.status !== "blocked" && job.status !== "completed" && (
                  <button className="header-action-button danger" disabled={busyId === job.id} type="button" onClick={() => handleCancel(job)}>
                    {busyId === job.id ? "Saving..." : "Block"}
                  </button>
                )}
              </div>
            </div>
          ))}
          {!loading && jobs.length === 0 && (
            <p className="finance-empty">
              {hasFilters ? "No jobs match your filters." : "No jobs yet. Create your first job."}
            </p>
          )}
        </div>
      </section>
    </AdminWorkspaceLayout>
  );
}
