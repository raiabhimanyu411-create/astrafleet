import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { updateAlertStatus } from "../../api/adminApi";
import { StatCard } from "../../components/StatCard";
import { StateNotice } from "../../components/StateNotice";
import { StatusPill } from "../../components/StatusPill";
import { usePanelData } from "../../hooks/usePanelData";
import { AdminWorkspaceLayout } from "./AdminWorkspaceLayout";

function alertTarget(item) {
  if (item.tripId) return `/admin/jobs/${item.tripId}`;
  if (item.vehicleId) return `/admin/tracking/vehicles/${item.vehicleId}`;
  return "";
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

export function AdminAlertsPage() {
  const { data, error, loading, refetch } = usePanelData("/api/admin/alerts");
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [severity, setSeverity] = useState("");
  const [status, setStatus] = useState("");
  const [module, setModule] = useState("");
  const [actionError, setActionError] = useState("");

  const allAlerts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.allAlerts || []).filter(item => {
      if (severity && item.severity !== severity) return false;
      if (status && item.status !== status) return false;
      if (module && item.module !== module) return false;
      if (!q) return true;
      return [item.code, item.title, item.description, item.owner, item.module]
        .filter(Boolean)
        .some(value => value.toLowerCase().includes(q));
    });
  }, [data, module, search, severity, status]);

  const hasFilters = Boolean(search || severity || status || module);

  async function handleStatus(item, nextStatus) {
    if (!item.id) return;
    setActionError("");
    try {
      await updateAlertStatus(item.id, { alert_status: nextStatus });
      refetch(false);
    } catch (err) {
      setActionError(err?.response?.data?.message || "Alert status could not be updated.");
    }
  }

  function clearFilters() {
    setSearch("");
    setSeverity("");
    setStatus("");
    setModule("");
  }

  function exportAlerts() {
    exportCsv("control-room-alerts.csv", [
      ["Code", "Module", "Severity", "Status", "Owner", "Title", "Description", "Created"],
      ...allAlerts.map(item => [
        item.code,
        item.module,
        item.severity,
        item.status,
        item.owner,
        item.title,
        item.description,
        item.created
      ])
    ]);
  }

  return (
    <AdminWorkspaceLayout
      badge={data?.header?.badge || "Control room alerts"}
      title={data?.header?.title || "Delay, breakdown and compliance escalations"}
      description={
        data?.header?.description ||
        "A dedicated admin view for delay, breakdown, compliance breach, and reassignment escalations."
      }
      highlights={data?.highlights || []}
    >
      <div className="finance-command-bar">
        <button className="header-action-button" type="button" onClick={() => refetch(false)}>Refresh</button>
        <button className="header-action-button" type="button" onClick={exportAlerts}>Export CSV</button>
      </div>

      <StateNotice loading={loading} error={error} />

      {actionError && (
        <div className="state-card error" style={{ marginBottom: 16 }}>
          <span className="state-dot error" />
          <div><strong>Action error</strong><p>{actionError}</p></div>
        </div>
      )}

      <section className="stats-grid">
        {(data?.stats || []).map((item) => (
          <StatCard item={item} key={item.label} />
        ))}
      </section>

      <section className="stats-grid inline finance-position-grid">
        {(data?.operations || []).map((item) => (
          <StatCard item={item} key={item.label} />
        ))}
      </section>

      <section className="content-card alert-filter-card">
        <input
          className="af-input"
          placeholder="Search Alert Code, Owner, Module, Title, Or Description..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select className="af-select" value={severity} onChange={e => setSeverity(e.target.value)}>
          <option value="">All Severities</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <select className="af-select" value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">All Statuses</option>
          <option value="open">Open</option>
          <option value="watch">Watch</option>
          <option value="resolved">Resolved</option>
        </select>
        <select className="af-select" value={module} onChange={e => setModule(e.target.value)}>
          <option value="">All Modules</option>
          <option value="drivers">Drivers</option>
          <option value="vehicles">Vehicles</option>
          <option value="trips">Trips</option>
          <option value="tracking">Tracking</option>
          <option value="billing">Billing</option>
          <option value="finance">Finance</option>
          <option value="alerts">Alerts</option>
        </select>
        <button className="header-action-button" disabled={!hasFilters} type="button" onClick={clearFilters}>Clear Filters</button>
      </section>

      <section className="content-grid">
        <article className="content-card">
          <div className="section-head">
            <div>
              <span className="card-label">Live Escalations</span>
              <h2>Open Alert Register</h2>
            </div>
            <StatusPill tone="danger">Critical feed</StatusPill>
          </div>

          <div className="alert-stack">
            {(data?.alerts || []).map((item) => (
              <div
                className="alert-card"
                key={item.code || item.title}
                onClick={() => alertTarget(item) && navigate(alertTarget(item))}
                style={alertTarget(item) ? { cursor: "pointer" } : undefined}
              >
                <div className={`alert-bar ${item.tone}`} />
                <div>
                  <strong>{item.title}</strong>
                  <p>{item.description}</p>
                  <div className="alert-meta-strip">
                    <span>{item.code}</span>
                    <span>{item.owner}</span>
                    <span>{item.created}</span>
                  </div>
                </div>
              </div>
            ))}
            {!loading && (data?.alerts || []).length === 0 && (
              <p className="finance-empty">No open alerts right now. Critical driver, vehicle, billing, and tracking issues will appear here.</p>
            )}
          </div>
        </article>

        <article className="content-card">
          <div className="section-head">
            <div>
              <span className="card-label">Resolution Queue</span>
              <h2>Next Actions For The Desk</h2>
            </div>
            <StatusPill tone="warning">Pending closure</StatusPill>
          </div>

          <div className="data-rows">
            {(data?.resolutions || []).map((item) => (
              <div className="data-row alert-resolution-row" key={item.reference}>
                <div>
                  <strong>{item.reference}</strong>
                  <p>{item.owner} · {item.module}</p>
                </div>
                <div>
                  <span>{item.action}</span>
                  <p>{item.note}</p>
                </div>
                <div className="finance-row-actions">
                  <StatusPill tone={item.tone}>{item.status}</StatusPill>
                  {item.tripId && (
                    <button className="header-action-button" type="button" onClick={() => navigate(`/admin/jobs/${item.tripId}`)}>Open</button>
                  )}
                  {item.vehicleId && !item.tripId && (
                    <button className="header-action-button" type="button" onClick={() => navigate(`/admin/tracking/vehicles/${item.vehicleId}`)}>Open</button>
                  )}
                  {item.id && (
                    <button className="header-action-button" type="button" onClick={() => handleStatus(item, "resolved")}>Resolve</button>
                  )}
                </div>
              </div>
            ))}
            {!loading && (data?.resolutions || []).length === 0 && (
              <p className="finance-empty">No watch items assigned. Move open database alerts to watch when ownership is confirmed.</p>
            )}
          </div>
        </article>
      </section>

      <section className="content-card">
        <div className="section-head">
          <div>
            <span className="card-label">Alert Register</span>
            <h2>Filtered Control-Room Workload</h2>
          </div>
          <StatusPill tone="neutral">{allAlerts.length} visible</StatusPill>
        </div>

        <div className="data-rows compact finance-list">
          {allAlerts.map(item => (
            <div className="data-row finance-row alert-register-row" key={`${item.code}-${item.status}`}>
              <button
                className="finance-row-main alert-row-main"
                type="button"
                onClick={() => alertTarget(item) && navigate(alertTarget(item))}
                disabled={!alertTarget(item)}
              >
                <div>
                  <strong>{item.title}</strong>
                  <p>{item.description}</p>
                  <div className="alert-meta-strip">
                    <span>{item.code}</span>
                    <span>{item.module}</span>
                    <span>{item.owner}</span>
                  </div>
                </div>
                <div>
                  <span>{item.severity}</span>
                  <p>{item.created}</p>
                </div>
              </button>
              <div className="finance-row-actions">
                <StatusPill tone={item.tone}>{item.status}</StatusPill>
                {item.id && item.status !== "open" && (
                  <button className="header-action-button" type="button" onClick={() => handleStatus(item, "open")}>Reopen</button>
                )}
                {item.id && item.status !== "watch" && item.status !== "resolved" && (
                  <button className="header-action-button" type="button" onClick={() => handleStatus(item, "watch")}>Watch</button>
                )}
                {item.id && item.status !== "resolved" && (
                  <button className="header-action-button" type="button" onClick={() => handleStatus(item, "resolved")}>Resolve</button>
                )}
              </div>
            </div>
          ))}
          {!loading && allAlerts.length === 0 && (
            <p className="finance-empty">{hasFilters ? "No alerts match your filters." : "No alert workload is available yet."}</p>
          )}
        </div>
      </section>
    </AdminWorkspaceLayout>
  );
}
