import { useEffect, useMemo, useState } from "react";
import { getRealtimeSocket } from "../../api/realtime";
import { getActivityReport, restoreActivityRecord } from "../../api/adminApi";
import { StateNotice } from "../../components/StateNotice";
import { StatusPill } from "../../components/StatusPill";
import { AdminWorkspaceLayout } from "./AdminWorkspaceLayout";

const actionLabels = {
  login: "Login",
  create: "Added",
  update: "Updated",
  status_update: "Status changed",
  delete: "Deleted",
  restore: "Restored",
  access_update: "Access changed"
};

const actionTone = {
  login: "success",
  create: "success",
  update: "neutral",
  status_update: "warning",
  delete: "danger",
  restore: "success",
  access_update: "warning"
};

function formatValue(value) {
  if (value == null || value === "") return "empty";
  if (typeof value === "boolean") return value ? "yes" : "no";
  return String(value);
}

function ChangeList({ changes }) {
  const entries = Object.entries(changes || {});
  if (entries.length === 0) return null;
  return (
    <div className="audit-change-list">
      {entries.slice(0, 5).map(([field, change]) => (
        <div className="audit-change-item" key={field}>
          <strong>{field.replaceAll("_", " ")}</strong>
          <span>{formatValue(change.before)} {"->"} {formatValue(change.after)}</span>
        </div>
      ))}
    </div>
  );
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

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

export function AdminActivityPage() {
  const [data, setData] = useState(null);
  const [filters, setFilters] = useState({
    employeeId: "",
    module: "",
    action: "",
    risk: "",
    from: "",
    to: todayIso()
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [restoringId, setRestoringId] = useState(null);
  const [view, setView] = useState("audit");

  const params = useMemo(() => {
    return Object.fromEntries(Object.entries(filters).filter(([, value]) => value));
  }, [filters]);

  function load(isInitial = false) {
    if (isInitial) setLoading(true);
    getActivityReport(params)
      .then((res) => {
        setData(res.data);
        setError("");
      })
      .catch((err) => setError(err.response?.data?.message || "Activity report could not be loaded."))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load(true);
  }, [params]);

  useEffect(() => {
    const socket = getRealtimeSocket();
    socket.connect();
    socket.emit("admin-audit:join");
    socket.on("admin-audit:event", () => load(false));
    return () => {
      socket.off("admin-audit:event");
      socket.emit("admin-audit:leave");
    };
  }, [params]);

  function updateFilter(key, value) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function clearFilters() {
    setFilters({ employeeId: "", module: "", action: "", risk: "", from: "", to: todayIso() });
  }

  async function restoreLog(log) {
    setActionError("");
    setRestoringId(log.id);
    try {
      await restoreActivityRecord(log.id);
      await load(false);
    } catch (err) {
      setActionError(err.response?.data?.message || "Record could not be restored.");
    } finally {
      setRestoringId(null);
    }
  }

  const hasFilters = Boolean(filters.employeeId || filters.module || filters.action || filters.risk || filters.from || filters.to !== todayIso());
  const visibleLogs = useMemo(() => {
    return (data?.logs || []).filter(log => {
      if (filters.risk === "critical" && !["delete", "restore"].includes(log.action)) return false;
      if (filters.risk === "deleted" && log.action !== "delete") return false;
      if (filters.risk === "restored" && log.action !== "restore") return false;
      return true;
    });
  }, [data?.logs, filters.risk]);

  function exportActivity() {
    exportCsv("activity-report.csv", [
      ["Time", "Actor", "Role", "Panel", "Action", "Entity", "Reason category", "Reason", "Hash"],
      ...visibleLogs.map(log => [log.at, log.actorName, log.actorRole, log.module, log.action, log.entityLabel, log.reasonCategory, log.reason, log.entryHash])
    ]);
  }

  return (
    <AdminWorkspaceLayout
      badge="Activity report"
      title="Employee portal audit trail"
      description="Track logins, created records, updates, deletes, and deletion reasons across assigned panels."
      highlights={[
        "Every employee login is timestamped",
        "Finance and billing deletes require a reason",
        "Admin can filter by employee, panel, action, and date"
      ]}
    >
      <StateNotice loading={loading} error={error} />

      {actionError && (
        <div className="state-card error" style={{ marginBottom: 16 }}>
          <span className="state-dot error" />
          <div><strong>Action error</strong><p>{actionError}</p></div>
        </div>
      )}

      <section className="activity-quick-grid">
        {(data?.summary || []).map(item => (
          <article className={`activity-quick-card ${item.tone || "neutral"}`} key={item.label}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
            <p>{item.change}</p>
          </article>
        ))}
      </section>

      <section className="content-card activity-filter-card">
        <select className="af-select" value={filters.employeeId} onChange={e => updateFilter("employeeId", e.target.value)}>
          <option value="">All employees</option>
          {(data?.employees || []).map(employee => (
            <option key={employee.id} value={employee.id}>{employee.name} · {employee.email}</option>
          ))}
        </select>
        <select className="af-select" value={filters.module} onChange={e => updateFilter("module", e.target.value)}>
          <option value="">All panels</option>
          {(data?.modules || []).map(module => <option key={module} value={module}>{module}</option>)}
        </select>
        <select className="af-select" value={filters.action} onChange={e => updateFilter("action", e.target.value)}>
          <option value="">All actions</option>
          {(data?.actions || []).map(action => <option key={action} value={action}>{actionLabels[action] || action}</option>)}
        </select>
        <select className="af-select" value={filters.risk} onChange={e => updateFilter("risk", e.target.value)}>
          <option value="">All risk levels</option>
          <option value="critical">Critical activity</option>
          <option value="deleted">Deleted only</option>
          <option value="restored">Restored only</option>
        </select>
        <input className="af-input" type="date" value={filters.from} onChange={e => updateFilter("from", e.target.value)} />
        <input className="af-input" type="date" value={filters.to} onChange={e => updateFilter("to", e.target.value)} />
        <button className="header-action-button" type="button" onClick={() => setFilters(current => ({ ...current, from: todayIso(), to: todayIso() }))}>Today</button>
        <button className="header-action-button" type="button" onClick={() => {
          const date = new Date();
          date.setDate(date.getDate() - 6);
          setFilters(current => ({ ...current, from: date.toISOString().slice(0, 10), to: todayIso() }));
        }}>7 days</button>
        <button className="header-action-button" type="button" onClick={exportActivity}>Export CSV</button>
        <button className="header-action-button" disabled={!hasFilters} type="button" onClick={clearFilters}>Clear</button>
      </section>

      <section className="activity-tabs" aria-label="Activity report views">
        <button className={view === "audit" ? "active" : ""} type="button" onClick={() => setView("audit")}>
          Audit feed
        </button>
        <button className={view === "sessions" ? "active" : ""} type="button" onClick={() => setView("sessions")}>
          Sessions
        </button>
      </section>

      {view === "audit" && (
      <section className="content-card activity-table-card">
        <div className="section-head">
          <div>
            <span className="card-label">Audit feed</span>
            <h2>Employee actions</h2>
          </div>
          <div className="activity-head-actions">
            <StatusPill tone="neutral">{visibleLogs.length} events</StatusPill>
            <button className="header-action-button" type="button" onClick={() => load(false)}>Refresh</button>
          </div>
        </div>
        <div className="activity-table-shell">
          <table className="activity-audit-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Employee</th>
                <th>Panel</th>
                <th>Action</th>
                <th>Record</th>
                <th>Changes / reason</th>
                <th>Hash</th>
                <th>Control</th>
              </tr>
            </thead>
            <tbody>
              {visibleLogs.map(log => (
                <tr key={log.id}>
                  <td><strong>{log.at}</strong><small>{log.ipAddress}</small></td>
                  <td><strong>{log.actorName}</strong><small>{log.actorRole}</small></td>
                  <td><strong>{log.module}</strong><small>{log.entityType}</small></td>
                  <td><StatusPill tone={actionTone[log.action] || "neutral"}>{actionLabels[log.action] || log.action}</StatusPill></td>
                  <td><strong>{log.entityLabel}</strong><small>ID {log.entityId || "—"}</small></td>
                  <td>
                    {log.reason && <p className="activity-reason"><strong>Reason:</strong> {log.reasonCategory ? `${log.reasonCategory.replaceAll("_", " ")} · ` : ""}{log.reason}</p>}
                    <ChangeList changes={log.details?.changes} />
                    {!log.reason && !log.details?.changes && <small>No field changes recorded</small>}
                  </td>
                  <td>{log.hashVerified ? <small>{log.entryHash.slice(0, 12)}...</small> : <small>—</small>}</td>
                  <td>
                    <div className="activity-table-actions">
                      {log.canRestore && (
                        <button className="header-action-button" type="button" disabled={restoringId === log.id} onClick={() => restoreLog(log)}>
                          {restoringId === log.id ? "Restoring..." : "Restore"}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && visibleLogs.length === 0 && (
                <tr>
                  <td colSpan="8">
                    <p className="finance-empty">No audit events found. Change filters or wait for portal activity to appear.</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      )}

      {view === "sessions" && (
      <section className="content-card activity-table-card">
        <div className="section-head">
          <div>
            <span className="card-label">Sessions</span>
            <h2>Login duration report</h2>
          </div>
          <StatusPill tone="neutral">{data?.sessions?.length || 0} sessions</StatusPill>
        </div>
        <div className="activity-table-shell">
          <table className="activity-session-table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Role</th>
                <th>Login</th>
                <th>Last activity</th>
                <th>Logout</th>
                <th>Duration</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {(data?.sessions || []).map(session => (
                <tr key={session.id}>
                  <td><strong>{session.name}</strong><small>{session.email || "—"}</small></td>
                  <td>{session.role}</td>
                  <td>{session.loginAt}</td>
                  <td>{session.lastActivityAt}</td>
                  <td>{session.logoutAt}</td>
                  <td><strong>{session.active ? "Running" : `${session.durationMinutes} min`}</strong></td>
                  <td><StatusPill tone={session.active ? "success" : "neutral"}>{session.active ? "Active" : "Closed"}</StatusPill></td>
                </tr>
              ))}
              {!loading && (data?.sessions || []).length === 0 && (
                <tr>
                  <td colSpan="7"><p className="finance-empty">No sessions found for this report.</p></td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      )}
    </AdminWorkspaceLayout>
  );
}
