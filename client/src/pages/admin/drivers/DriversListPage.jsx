import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { deleteDriver, getDrivers, updateDriverInline } from "../../../api/driverApi";
import { StateNotice } from "../../../components/StateNotice";
import { StatusPill } from "../../../components/StatusPill";
import { DriverChatWidget } from "../DriverChatWidget";
import { AdminWorkspaceLayout } from "../AdminWorkspaceLayout";

const COMPLIANCE_OPTIONS = [
  { value: "", label: "All compliance" },
  { value: "clear", label: "Clear" },
  { value: "review", label: "Review" },
  { value: "blocked", label: "Blocked" }
];

const SHIFT_OPTIONS = [
  { value: "", label: "All shift status" },
  { value: "ready", label: "Ready" },
  { value: "on_trip", label: "On trip" },
  { value: "rest", label: "Rest" },
  { value: "review", label: "Review" }
];

const ONBOARDING_OPTIONS = ["new", "docs_pending", "approved", "rejected"];

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

export function DriversListPage() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [filterCompliance, setFilterCompliance] = useState("");
  const [filterShift, setFilterShift] = useState("");
  const [riskFilter, setRiskFilter] = useState("");
  const [view, setView] = useState("drivers");
  const [deletingId, setDeletingId] = useState(null);
  const [savingCell, setSavingCell] = useState("");

  function load() {
    setLoading(true);
    return getDrivers()
      .then(r => {
        setData(r.data);
        setError("");
      })
      .catch(() => setError("Could not load drivers. Please refresh."))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  async function handleDelete(driver) {
    const label = driver.fullName || "this driver";
    if (!window.confirm(`Delete ${label}? Their assigned jobs will become unassigned.`)) return;

    setError("");
    setDeletingId(driver.id);
    try {
      await deleteDriver(driver.id);
      await load();
    } catch (err) {
      setError(err?.response?.data?.message || "Driver could not be deleted. Please try again.");
    } finally {
      setDeletingId(null);
    }
  }

  function handleChat(driver) {
    window.dispatchEvent(new CustomEvent("admin-driver-chat:select", { detail: { driverId: driver.id } }));
  }

  async function updateCell(driver, field, value) {
    const key = `${driver.id}-${field}`;
    setError("");
    setSavingCell(key);
    try {
      await updateDriverInline(driver.id, { [field]: value });
      await load();
    } catch (err) {
      setError(err?.response?.data?.message || "Driver could not be updated.");
    } finally {
      setSavingCell("");
    }
  }

  function updateCellOnBlur(driver, field, value, currentValue) {
    const next = String(value ?? "").trim();
    const current = String(currentValue ?? "").trim();
    if (next === current) return;
    updateCell(driver, field, next);
  }

  const drivers = useMemo(() => {
    return (data?.drivers || []).filter(d => {
      if (filterCompliance && d.complianceStatus !== filterCompliance) return false;
      if (filterShift && d.shiftStatus !== filterShift) return false;
      if (riskFilter === "docs" && !d.docRisk) return false;
      if (riskFilter === "messages" && Number(d.unreadMessages || 0) === 0) return false;
      if (riskFilter === "open_trips" && Number(d.openTrips || 0) === 0) return false;
      if (riskFilter === "onboarding" && !["new", "docs_pending"].includes(d.onboardingStatus)) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          d.fullName.toLowerCase().includes(q) ||
          d.employeeCode.toLowerCase().includes(q) ||
          (d.phone || "").includes(q) ||
          (d.email || "").toLowerCase().includes(q) ||
          (d.homeDepot || "").toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [data, filterCompliance, filterShift, riskFilter, search]);

  const hasFilters = Boolean(search || filterCompliance || filterShift || riskFilter);

  const quickFilters = useMemo(() => {
    const rows = data?.drivers || [];
    return [
      { key: "ready", label: "Ready", value: rows.filter(d => d.shiftStatus === "ready" && d.complianceStatus === "clear" && !d.docRisk).length },
      { key: "on_trip", label: "On trip", value: rows.filter(d => d.shiftStatus === "on_trip" || Number(d.openTrips || 0) > 0).length },
      { key: "review", label: "Needs review", value: rows.filter(d => d.complianceStatus !== "clear" || d.docRisk || d.shiftStatus === "review").length },
      { key: "messages", label: "Unread messages", value: rows.filter(d => Number(d.unreadMessages || 0) > 0).length }
    ];
  }, [data]);

  function clearFilters() {
    setSearch("");
    setFilterCompliance("");
    setFilterShift("");
    setRiskFilter("");
  }

  function applyQuickFilter(key) {
    setFilterCompliance("");
    setFilterShift("");
    setRiskFilter("");
    if (key === "ready") {
      setFilterShift("ready");
      setFilterCompliance("clear");
    }
    if (key === "on_trip") setFilterShift("on_trip");
    if (key === "review") {
      setRiskFilter("docs");
      setView("compliance");
    }
    if (key === "messages") {
      setRiskFilter("messages");
      setView("support");
    }
  }

  function exportDrivers() {
    exportCsv("drivers-register.csv", [
      ["Driver", "Code", "Phone", "Email", "Depot", "Shift", "Compliance", "Trips", "Open trips", "Docs", "Unread messages", "Licence", "Medical", "CPC", "Tacho"],
      ...drivers.map(d => [
        d.fullName,
        d.employeeCode,
        d.phone,
        d.email,
        d.homeDepot,
        d.shiftStatus,
        d.complianceStatus,
        d.totalTrips,
        d.openTrips,
        d.totalDocs,
        d.unreadMessages,
        d.licenceExpiry,
        d.medicalExpiry,
        d.cpcExpiry,
        d.tachoExpiry
      ])
    ]);
  }

  return (
    <AdminWorkspaceLayout
      badge="Driver management"
      title="Drivers"
      description="Manage driver profiles, UK compliance documents, licences, shift status, and live support."
      highlights={[
        "Driver health shows document risk, onboarding gaps, unread chats, and dispatch readiness.",
        "Filter by compliance, shift, document risk, or open trips to find drivers needing attention.",
        "The support console keeps driver messages connected to the same operations workspace."
      ]}
    >
      <div className="finance-command-bar">
        <button className="header-action-button" type="button" onClick={load}>Refresh</button>
        <button className="header-action-button" type="button" onClick={exportDrivers}>Export CSV</button>
        <button className="af-submit-btn" type="button" onClick={() => navigate("/admin/drivers/new")}>+ Add driver</button>
      </div>

      <StateNotice loading={loading} error={error} />

      <section className="driver-control-strip">
        <div className="driver-quick-strip">
          {quickFilters.map(item => (
            <button
              className={(
                (item.key === "ready" && filterShift === "ready" && filterCompliance === "clear") ||
                (item.key === "on_trip" && filterShift === "on_trip") ||
                (item.key === "review" && riskFilter === "docs") ||
                (item.key === "messages" && riskFilter === "messages")
              ) ? "active" : ""}
              key={item.key}
              type="button"
              onClick={() => applyQuickFilter(item.key)}
            >
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </button>
          ))}
        </div>
        <div className="driver-filter-card">
          <input
            className="af-input"
            type="text"
            placeholder="Search by name, code, phone, email, or depot..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <select className="af-select" value={filterCompliance} onChange={e => setFilterCompliance(e.target.value)}>
            {COMPLIANCE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select className="af-select" value={filterShift} onChange={e => setFilterShift(e.target.value)}>
            {SHIFT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select className="af-select" value={riskFilter} onChange={e => setRiskFilter(e.target.value)}>
            <option value="">All risk states</option>
            <option value="docs">Document risk</option>
            <option value="messages">Unread messages</option>
            <option value="open_trips">Open trips</option>
            <option value="onboarding">Onboarding queue</option>
          </select>
          <button className="header-action-button" disabled={!hasFilters} type="button" onClick={clearFilters}>Clear filters</button>
        </div>
      </section>

      <section className="driver-tabs" aria-label="Driver views">
        {[
          ["drivers", "Driver List"],
          ["compliance", "Compliance"],
          ["support", "Support"]
        ].map(([key, label]) => (
          <button className={view === key ? "active" : ""} key={key} type="button" onClick={() => setView(key)}>
            {label}
          </button>
        ))}
      </section>

      <section className="driver-register-card">
        <div className="section-head">
          <div>
            <span className="card-label">Driver register</span>
            <h2>{view === "drivers" ? "Driver list" : view === "compliance" ? "Compliance documents" : "Support view"}</h2>
          </div>
          <StatusPill tone={drivers.length ? "success" : "neutral"}>{drivers.length} visible</StatusPill>
        </div>

        <div className="driver-table-shell">
          <table className={`driver-edit-table ${view}`}>
            <thead>
              {view === "drivers" && (
              <tr>
                <th>Driver</th>
                <th>Code</th>
                <th>Phone</th>
                <th>Depot</th>
                <th>Shift</th>
                <th>Readiness</th>
                <th>Trips</th>
                <th>Unread</th>
                <th>Actions</th>
              </tr>
              )}
              {view === "compliance" && (
              <tr>
                <th>Driver</th>
                <th>Code</th>
                <th>Compliance</th>
                <th>Onboarding</th>
                <th>Licence</th>
                <th>Medical</th>
                <th>CPC</th>
                <th>Tacho</th>
                <th>Docs</th>
                <th>Actions</th>
              </tr>
              )}
              {view === "support" && (
              <tr>
                <th>Driver</th>
                <th>Code</th>
                <th>Phone</th>
                <th>Shift</th>
                <th>Compliance</th>
                <th>Unread messages</th>
                <th>Last message</th>
                <th>Actions</th>
              </tr>
              )}
            </thead>
            <tbody>
              {drivers.map(d => (
                <tr key={d.id}>
                  {view === "drivers" && (
                  <>
                  <td>
                    <input
                      className="driver-table-input strong"
                      defaultValue={d.fullName}
                      disabled={savingCell === `${d.id}-fullName`}
                      onBlur={(e) => updateCellOnBlur(d, "fullName", e.target.value, d.fullName)}
                    />
                    <small>{d.email}</small>
                  </td>
                  <td>
                    <input
                      className="driver-table-input code"
                      defaultValue={d.employeeCode}
                      disabled={savingCell === `${d.id}-employeeCode`}
                      onBlur={(e) => updateCellOnBlur(d, "employeeCode", e.target.value, d.employeeCode)}
                    />
                  </td>
                  <td>
                    <input
                      className="driver-table-input"
                      defaultValue={d.phone === "—" ? "" : d.phone}
                      disabled={savingCell === `${d.id}-phone`}
                      onBlur={(e) => updateCellOnBlur(d, "phone", e.target.value, d.phone === "—" ? "" : d.phone)}
                    />
                  </td>
                  <td>
                    <input
                      className="driver-table-input"
                      defaultValue={d.homeDepot === "—" ? "" : d.homeDepot}
                      disabled={savingCell === `${d.id}-homeDepot`}
                      onBlur={(e) => updateCellOnBlur(d, "homeDepot", e.target.value, d.homeDepot === "—" ? "" : d.homeDepot)}
                    />
                  </td>
                  <td>
                    <select className="driver-table-select" value={d.shiftStatus} disabled={savingCell === `${d.id}-shiftStatus`} onChange={(e) => updateCell(d, "shiftStatus", e.target.value)}>
                      {SHIFT_OPTIONS.filter(option => option.value).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  </td>
                  <td>
                    <StatusPill tone={d.shiftStatus === "ready" && d.complianceStatus === "clear" && !d.docRisk ? "success" : d.complianceStatus === "blocked" || d.docRisk ? "danger" : "warning"}>
                      {d.shiftStatus === "ready" && d.complianceStatus === "clear" && !d.docRisk ? "Ready" : "Review"}
                    </StatusPill>
                    <small>{d.docRisk ? "Document risk" : d.openTrips > 0 ? `${d.openTrips} open trip${d.openTrips === 1 ? "" : "s"}` : "No open trip"}</small>
                  </td>
                  <td><strong>{d.totalTrips}</strong><small>{d.openTrips} open</small></td>
                  <td>
                    {d.unreadMessages > 0 && <StatusPill tone="danger">{d.unreadMessages} unread</StatusPill>}
                    {d.unreadMessages === 0 && <StatusPill tone="neutral">No unread</StatusPill>}
                  </td>
                  <td>
                    <div className="driver-table-actions">
                      <button className="header-action-button" type="button" onClick={() => handleChat(d)}>Chat</button>
                      <button className="header-action-button" type="button" onClick={() => navigate(`/admin/drivers/${d.id}`)}>Open</button>
                      <button className="header-action-button" type="button" onClick={() => navigate(`/admin/drivers/${d.id}/edit`)}>Edit</button>
                      <button className="header-action-button danger" type="button" disabled={deletingId === d.id} onClick={() => handleDelete(d)}>
                        {deletingId === d.id ? "Deleting..." : "Delete"}
                      </button>
                    </div>
                  </td>
                  </>
                  )}

                  {view === "compliance" && (
                  <>
                  <td>
                    <input
                      className="driver-table-input strong"
                      defaultValue={d.fullName}
                      disabled={savingCell === `${d.id}-fullName`}
                      onBlur={(e) => updateCellOnBlur(d, "fullName", e.target.value, d.fullName)}
                    />
                    <small>{d.email}</small>
                  </td>
                  <td>
                    <input
                      className="driver-table-input code"
                      defaultValue={d.employeeCode}
                      disabled={savingCell === `${d.id}-employeeCode`}
                      onBlur={(e) => updateCellOnBlur(d, "employeeCode", e.target.value, d.employeeCode)}
                    />
                  </td>
                  <td>
                    <select className="driver-table-select" value={d.complianceStatus} disabled={savingCell === `${d.id}-complianceStatus`} onChange={(e) => updateCell(d, "complianceStatus", e.target.value)}>
                      {COMPLIANCE_OPTIONS.filter(option => option.value).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  </td>
                  <td>
                    <select className="driver-table-select" value={d.onboardingStatus} disabled={savingCell === `${d.id}-onboardingStatus`} onChange={(e) => updateCell(d, "onboardingStatus", e.target.value)}>
                      {ONBOARDING_OPTIONS.map(option => <option key={option} value={option}>{option.replace("_", " ")}</option>)}
                    </select>
                  </td>
                  <td><input className={`driver-table-input date ${d.licenceExpiryTone}`} type="date" defaultValue={d.licenceExpiryRaw} onBlur={(e) => updateCellOnBlur(d, "licenceExpiry", e.target.value, d.licenceExpiryRaw)} /></td>
                  <td><input className={`driver-table-input date ${d.medicalExpiryTone}`} type="date" defaultValue={d.medicalExpiryRaw} onBlur={(e) => updateCellOnBlur(d, "medicalExpiry", e.target.value, d.medicalExpiryRaw)} /></td>
                  <td><input className={`driver-table-input date ${d.cpcExpiryTone}`} type="date" defaultValue={d.cpcExpiryRaw} onBlur={(e) => updateCellOnBlur(d, "cpcExpiry", e.target.value, d.cpcExpiryRaw)} /></td>
                  <td><input className={`driver-table-input date ${d.tachoExpiryTone}`} type="date" defaultValue={d.tachoExpiryRaw} onBlur={(e) => updateCellOnBlur(d, "tachoExpiry", e.target.value, d.tachoExpiryRaw)} /></td>
                  <td><strong>{d.totalDocs}</strong><small>{d.docRisk ? "Review" : "Clear"}</small></td>
                  <td>
                    <div className="driver-table-actions">
                      <button className="header-action-button" type="button" onClick={() => navigate(`/admin/drivers/${d.id}`)}>Open</button>
                      <button className="header-action-button" type="button" onClick={() => navigate(`/admin/drivers/${d.id}/edit`)}>Edit</button>
                    </div>
                  </td>
                  </>
                  )}

                  {view === "support" && (
                  <>
                  <td>
                    <strong>{d.fullName}</strong>
                    <small>{d.email}</small>
                  </td>
                  <td><strong>{d.employeeCode}</strong></td>
                  <td>
                    <input
                      className="driver-table-input"
                      defaultValue={d.phone === "—" ? "" : d.phone}
                      disabled={savingCell === `${d.id}-phone`}
                      onBlur={(e) => updateCellOnBlur(d, "phone", e.target.value, d.phone === "—" ? "" : d.phone)}
                    />
                  </td>
                  <td>
                    <select className="driver-table-select" value={d.shiftStatus} disabled={savingCell === `${d.id}-shiftStatus`} onChange={(e) => updateCell(d, "shiftStatus", e.target.value)}>
                      {SHIFT_OPTIONS.filter(option => option.value).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  </td>
                  <td><StatusPill tone={d.complianceStatus === "clear" ? "success" : d.complianceStatus === "blocked" ? "danger" : "warning"}>{d.complianceStatus}</StatusPill></td>
                  <td>
                    {d.unreadMessages > 0 && <StatusPill tone="danger">{d.unreadMessages} unread</StatusPill>}
                    {d.unreadMessages === 0 && <StatusPill tone="neutral">No unread</StatusPill>}
                  </td>
                  <td><strong>{d.lastMessageAt !== "—" ? d.lastMessageAt : "No recent message"}</strong></td>
                  <td>
                    <div className="driver-table-actions">
                      <button className="header-action-button" type="button" onClick={() => handleChat(d)}>Chat</button>
                      <button className="header-action-button" type="button" onClick={() => navigate(`/admin/drivers/${d.id}`)}>Open</button>
                      <button className="header-action-button" type="button" onClick={() => navigate(`/admin/drivers/${d.id}/edit`)}>Edit</button>
                    </div>
                  </td>
                  </>
                  )}
                </tr>
              ))}
              {!loading && drivers.length === 0 && (
                <tr>
                  <td colSpan={view === "drivers" ? 9 : view === "compliance" ? 10 : 8}>
                    <p className="finance-empty">{hasFilters ? "No drivers match your filters." : "No drivers yet. Add your first driver."}</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <DriverChatWidget compact />
    </AdminWorkspaceLayout>
  );
}
