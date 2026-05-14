import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getJobs } from "../../../api/jobApi";
import { StatCard } from "../../../components/StatCard";
import { StateNotice } from "../../../components/StateNotice";
import { StatusPill } from "../../../components/StatusPill";
import { AdminWorkspaceLayout } from "../AdminWorkspaceLayout";

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "planned",   label: "Planned" },
  { value: "loading",   label: "Loading" },
  { value: "active",    label: "Active" },
  { value: "completed", label: "Completed" },
  { value: "blocked",   label: "Blocked" }
];

const PRIORITY_OPTIONS = [
  { value: "",         label: "All priorities" },
  { value: "standard", label: "Standard" },
  { value: "priority", label: "Priority" },
  { value: "critical", label: "Critical" }
];

const LOAD_ICONS = {
  general: "📦", hazardous: "⚠️", refrigerated: "❄️", oversized: "🔩", fragile: "🫙"
};

export function JobsListPage() {
  const navigate = useNavigate();
  const [data, setData]         = useState(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState("");
  const [search, setSearch]     = useState("");
  const [filterStatus, setFilterStatus]     = useState("");
  const [filterPriority, setFilterPriority] = useState("");

  function load() {
    setLoading(true);
    const params = {};
    if (filterStatus)   params.status   = filterStatus;
    if (filterPriority) params.priority = filterPriority;
    if (search)         params.search   = search;

    getJobs(params)
      .then(r => setData(r.data))
      .catch(() => setError("Could not load jobs. Please refresh."))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [filterStatus, filterPriority]);

  function handleSearch(e) {
    e.preventDefault();
    load();
  }

  const jobs = data?.jobs || [];

  return (
    <AdminWorkspaceLayout
      badge="Job management"
      title="Jobs & bookings"
      description="Create, manage, and track all freight jobs — from booking to proof of delivery."
      highlights={[
        "All jobs are listed with customer, driver, vehicle, and load details.",
        "Use filters to view by status or priority. Click any job to see full details.",
        "Multi-stop jobs show the number of additional stops alongside the primary route."
      ]}
    >
      <StateNotice loading={loading} error={error} />

      {/* Stats */}
      <section className="stats-grid">
        {(data?.stats || []).map(item => (
          <StatCard key={item.label} item={item} />
        ))}
      </section>

      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <form onSubmit={handleSearch} style={{ display: "flex", gap: 8, flex: 1, minWidth: 240 }}>
          <input
            className="af-input"
            style={{ margin: 0, flex: 1, maxWidth: 280 }}
            type="text"
            placeholder="Search by job code or customer..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <button type="submit" className="header-action-button">Search</button>
        </form>

        <select
          className="af-select"
          style={{ width: 160, margin: 0 }}
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
        >
          {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>

        <select
          className="af-select"
          style={{ width: 160, margin: 0 }}
          value={filterPriority}
          onChange={e => setFilterPriority(e.target.value)}
        >
          {PRIORITY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>

        <button
          className="af-submit-btn"
          type="button"
          onClick={() => navigate("/admin/jobs/new")}
          style={{ whiteSpace: "nowrap" }}
        >
          + New job
        </button>
      </div>

      {/* Jobs table */}
      <div className="content-card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.86rem" }}>
            <thead>
              <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                {["Job code", "Customer", "Route / Lane", "Load", "Driver", "Vehicle", "Trolley", "Departure", "Stops", "Priority", "Status", "Actions"].map(h => (
                  <th key={h} style={{ padding: "11px 14px", textAlign: "left", fontWeight: 700, color: "#475569", fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.05em", whiteSpace: "nowrap" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {jobs.length === 0 && !loading && (
                <tr>
                  <td colSpan={12} style={{ padding: "40px 16px", textAlign: "center", color: "#94a3b8", fontSize: "0.88rem" }}>
                    {search || filterStatus || filterPriority ? "No jobs match your filters." : "No jobs yet. Create your first job."}
                  </td>
                </tr>
              )}
              {jobs.map((job, i) => (
                <tr
                  key={job.id}
                  style={{ borderBottom: i < jobs.length - 1 ? "1px solid #e2e8f0" : "none", background: "#fff", cursor: "pointer", transition: "background 120ms" }}
                  onClick={() => navigate(`/admin/jobs/${job.id}`)}
                  onMouseEnter={e => e.currentTarget.style.background = "#f8fafc"}
                  onMouseLeave={e => e.currentTarget.style.background = "#fff"}
                >
                  <td style={{ padding: "11px 14px" }}>
                    <strong style={{ fontWeight: 700, color: "#0f172a", fontFamily: "monospace", fontSize: "0.84rem" }}>{job.code}</strong>
                  </td>
                  <td style={{ padding: "11px 14px", color: "#334155", maxWidth: 140 }}>
                    <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{job.customer}</span>
                  </td>
                  <td style={{ padding: "11px 14px", color: "#334155", maxWidth: 160 }}>
                    <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "0.83rem" }}>{job.lane}</span>
                  </td>
                  <td style={{ padding: "11px 14px", whiteSpace: "nowrap" }}>
                    <span style={{ fontSize: "0.78rem" }}>{LOAD_ICONS[job.loadType] || "📦"} {job.loadType}</span>
                  </td>
                  <td style={{ padding: "11px 14px", color: job.driver === "Unassigned" ? "#94a3b8" : "#334155", fontSize: "0.83rem" }}>
                    {job.driver}
                  </td>
                  <td style={{ padding: "11px 14px", color: job.vehicle === "Unassigned" ? "#94a3b8" : "#334155", fontSize: "0.83rem", fontFamily: "monospace" }}>
                    {job.vehicle}
                  </td>
                  <td style={{ padding: "11px 14px", color: job.trailer === "Unassigned" ? "#94a3b8" : "#334155", fontSize: "0.83rem", fontFamily: "monospace" }}>
                    {job.trailer}
                  </td>
                  <td style={{ padding: "11px 14px", color: "#64748b", fontSize: "0.83rem", whiteSpace: "nowrap" }}>
                    {job.departure}
                  </td>
                  <td style={{ padding: "11px 14px", textAlign: "center" }}>
                    {job.stopCount > 0
                      ? <span style={{ background: "#eff6ff", color: "#2563eb", borderRadius: 999, padding: "2px 8px", fontSize: "0.75rem", fontWeight: 700 }}>+{job.stopCount}</span>
                      : <span style={{ color: "#94a3b8", fontSize: "0.78rem" }}>—</span>
                    }
                  </td>
                  <td style={{ padding: "11px 14px" }}>
                    <StatusPill tone={job.priorityTone}>{job.priority}</StatusPill>
                  </td>
                  <td style={{ padding: "11px 14px" }}>
                    <StatusPill tone={job.statusTone}>{job.status}</StatusPill>
                  </td>
                  <td style={{ padding: "11px 14px" }} onClick={e => e.stopPropagation()}>
                    <div style={{ display: "flex", gap: 5 }}>
                      <button
                        className="header-action-button"
                        style={{ height: 28, padding: "0 10px", fontSize: "0.76rem" }}
                        type="button"
                        onClick={() => navigate(`/admin/jobs/${job.id}`)}
                      >
                        View
                      </button>
                      <button
                        className="header-action-button"
                        style={{ height: 28, padding: "0 10px", fontSize: "0.76rem" }}
                        type="button"
                        onClick={() => navigate(`/admin/jobs/${job.id}/edit`)}
                      >
                        Edit
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AdminWorkspaceLayout>
  );
}
