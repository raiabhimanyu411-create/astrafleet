import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { updateAlertStatus } from "../../api/adminApi";
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
  const [selectedAlertKey, setSelectedAlertKey] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [resolutionNote, setResolutionNote] = useState("");
  const [saving, setSaving] = useState(false);

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
  const selectedAlert = allAlerts.find(item => `${item.code}-${item.status}` === selectedAlertKey) || allAlerts[0] || null;

  useEffect(() => {
    if (!selectedAlert) return;
    setSelectedAlertKey(`${selectedAlert.code}-${selectedAlert.status}`);
    setOwnerName(selectedAlert.owner === "Unassigned" ? "" : selectedAlert.owner || "");
    setResolutionNote(selectedAlert.resolutionNote || "");
  }, [selectedAlert?.code, selectedAlert?.status]);

  async function handleStatus(item, nextStatus, workflow = {}) {
    if (!item.id) return;
    setActionError("");
    setSaving(true);
    try {
      await updateAlertStatus(item.id, {
        alert_status: nextStatus,
        owner_name: workflow.owner_name,
        resolution_note: workflow.resolution_note
      });
      refetch(false);
    } catch (err) {
      setActionError(err?.response?.data?.message || "Alert status could not be updated.");
    } finally {
      setSaving(false);
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
      badge={data?.header?.badge || "Control Room Alerts"}
      title={data?.header?.title || "Delay, Breakdown And Compliance Escalations"}
      description={
        data?.header?.description ||
        "A dedicated admin view for delay, breakdown, compliance breach, and reassignment escalations."
      }
      highlights={[]}
      className="alerts-page-shell"
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

      <section className="alerts-command-strip" aria-label="Alert Operations Summary">
        {[...(data?.stats || []), ...(data?.operations || [])].map(item => (
          <button
            className={`alerts-command-item ${item.tone}`}
            key={item.label}
            type="button"
            onClick={() => {
              if (item.label === "Critical open") setSeverity("critical");
              if (["Watch queue"].includes(item.label)) setStatus("watch");
              if (item.label === "Resolved") setStatus("resolved");
              if (item.label === "Open queue") setStatus("open");
              if (item.label === "High severity") setSeverity("high");
            }}
          >
            <span>{item.label}</span>
            <strong>{item.value}</strong>
            <small>{item.description}</small>
          </button>
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

      <section className="alerts-workbench">
        <article className="content-card alerts-register-panel">
          <div className="section-head">
            <div>
              <span className="card-label">Unified Alert Queue</span>
              <h2>Operational Incidents And Exceptions</h2>
            </div>
            <StatusPill tone="neutral">{allAlerts.length} Visible</StatusPill>
          </div>
          <div className="alerts-register-list">
            {allAlerts.map(item => {
              const key = `${item.code}-${item.status}`;
              return (
                <button className={`alerts-register-item ${key === selectedAlertKey ? "active" : ""}`} key={key} type="button" onClick={() => setSelectedAlertKey(key)}>
                  <span className={`alerts-severity-marker ${item.tone}`} />
                  <span className="alerts-register-copy">
                    <span><strong>{item.title}</strong><StatusPill tone={item.tone}>{item.severity}</StatusPill></span>
                    <small>{item.description}</small>
                    <span className="alert-meta-strip"><span>{item.code}</span><span>{item.module}</span><span>{item.owner}</span></span>
                  </span>
                  <span className="alerts-register-state"><StatusPill tone={item.status === "resolved" ? "success" : item.status === "watch" ? "warning" : "danger"}>{item.status}</StatusPill><small>{item.created}</small></span>
                </button>
              );
            })}
            {!loading && allAlerts.length === 0 && <p className="finance-empty">{hasFilters ? "No Alerts Match Your Filters." : "No Alert Workload Is Available Yet."}</p>}
          </div>
        </article>

        <aside className="content-card alerts-inspector">
          {selectedAlert ? (
            <>
              <div className="section-head">
                <div><span className="card-label">Incident Inspector</span><h2>{selectedAlert.code}</h2></div>
                <StatusPill tone={selectedAlert.tone}>{selectedAlert.severity}</StatusPill>
              </div>
              <div className="alerts-inspector-heading"><h3>{selectedAlert.title}</h3><p>{selectedAlert.description}</p></div>
              <dl className="alerts-inspector-facts">
                <div><dt>Status</dt><dd>{selectedAlert.status}</dd></div>
                <div><dt>Module</dt><dd>{selectedAlert.module}</dd></div>
                <div><dt>Source</dt><dd>{selectedAlert.source}</dd></div>
                <div><dt>Created</dt><dd>{selectedAlert.created}</dd></div>
                <div><dt>Owner</dt><dd>{selectedAlert.owner}</dd></div>
                <div><dt>Updated</dt><dd>{selectedAlert.updated || selectedAlert.created}</dd></div>
              </dl>
              {alertTarget(selectedAlert) && <button className="header-action-button alerts-context-button" type="button" onClick={() => navigate(alertTarget(selectedAlert))}>Open Affected Record</button>}
              {selectedAlert.id ? (
                <div className="alerts-workflow-form">
                  <label><span>Assigned Owner</span><input className="af-input" value={ownerName} onChange={event => setOwnerName(event.target.value)} placeholder="e.g. Dispatch Desk Or Team Member" /></label>
                  <label><span>Resolution Note</span><textarea className="af-input" value={resolutionNote} onChange={event => setResolutionNote(event.target.value)} placeholder="Action Taken, Outcome, And Closure Evidence..." rows={4} /></label>
                  <div className="alerts-workflow-actions">
                    {selectedAlert.status !== "open" && <button className="header-action-button" disabled={saving} type="button" onClick={() => handleStatus(selectedAlert, "open", { owner_name: ownerName, resolution_note: resolutionNote })}>Reopen</button>}
                    {selectedAlert.status !== "watch" && selectedAlert.status !== "resolved" && <button className="header-action-button" disabled={saving} type="button" onClick={() => handleStatus(selectedAlert, "watch", { owner_name: ownerName, resolution_note: resolutionNote })}>Assign And Watch</button>}
                    {selectedAlert.status !== "resolved" && <button className="af-submit-btn" disabled={saving} type="button" onClick={() => handleStatus(selectedAlert, "resolved", { owner_name: ownerName, resolution_note: resolutionNote })}>{saving ? "Saving..." : "Resolve Alert"}</button>}
                  </div>
                  <p className="af-hint">Watch Requires An Owner. Resolve Requires A Closure Note.</p>
                </div>
              ) : <div className="alerts-live-source-note"><strong>Live Source Alert</strong><p>Resolve The Failed Delivery Or Vehicle Defect In Its Source Record. The Alert Will Clear When The Source Workflow Is Completed.</p></div>}
            </>
          ) : <p className="finance-empty">Select An Alert To Review Its Workflow.</p>}
        </aside>
      </section>
    </AdminWorkspaceLayout>
  );
}
