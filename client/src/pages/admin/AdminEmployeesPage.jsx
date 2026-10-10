import { useEffect, useMemo, useState } from "react";
import { getEmployees, updateEmployeeAccess } from "../../api/adminApi";
import { StateNotice } from "../../components/StateNotice";
import { AdminWorkspaceLayout } from "./AdminWorkspaceLayout";
import "./AdminEmployeesPage.css";

const moduleLabels = {
  jobs: "Jobs",
  customers: "Customers",
  trips: "Dispatch",
  drivers: "Drivers",
  vehicles: "Vehicles",
  maintenance: "Maintenance",
  finance: "Finance",
  billing: "Billing",
  tracking: "Live tracking",
  alerts: "Alerts"
};

const accessPresets = [
  { key: "operations", label: "Operations", modules: ["jobs", "customers", "trips", "drivers", "vehicles", "maintenance", "tracking", "alerts"] },
  { key: "finance", label: "Finance desk", modules: ["finance", "billing", "alerts"] },
  { key: "control", label: "Control room", modules: ["trips", "drivers", "vehicles", "maintenance", "tracking", "alerts"] }
];

const statusMeta = {
  pending: { label: "Pending review", tone: "warning" },
  active: { label: "Active", tone: "success" },
  rejected: { label: "Access off", tone: "danger" }
};

const statusOptions = [
  { value: "active", label: "Active", hint: "Can log in and use the pages below." },
  { value: "pending", label: "Pending review", hint: "Cannot log in until approved." },
  { value: "rejected", label: "Access off", hint: "Login blocked. Pages are kept if you turn it back on." }
];

function sameModules(a = [], b = []) {
  return [...a].sort().join("|") === [...b].sort().join("|");
}

function initials(name = "") {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join("") || "?";
}

function StatusBadge({ status }) {
  const meta = statusMeta[status] || { label: status, tone: "neutral" };
  return <span className={`emp-badge ${meta.tone}`}>{meta.label}</span>;
}

function PagesSummary({ modules, muted }) {
  if (!modules.length) return <span className="emp-muted">No pages</span>;
  const shown = modules.slice(0, 3);
  return (
    <div className={`emp-page-chips${muted ? " muted" : ""}`}>
      {shown.map((module) => <span key={module}>{moduleLabels[module] || module}</span>)}
      {modules.length > shown.length && <span className="more">+{modules.length - shown.length}</span>}
    </div>
  );
}

function EmployeeAccessPanel({ employee, modules, onClose, onSaved }) {
  // Seeded once per open: a reload of the list must not wipe edits in progress.
  const [approvalStatus, setApprovalStatus] = useState(employee.approvalStatus);
  const [accessModules, setAccessModules] = useState(employee.accessModules || []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const dirty = approvalStatus !== employee.approvalStatus || !sameModules(accessModules, employee.accessModules);
  const needsPages = approvalStatus === "active" && accessModules.length === 0;

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape" && !saving) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  function toggleModule(module) {
    setError("");
    setAccessModules((current) => (
      current.includes(module) ? current.filter((item) => item !== module) : [...current, module]
    ));
  }

  function applyModules(next) {
    setError("");
    setAccessModules(next.filter((module) => modules.includes(module)));
  }

  async function handleSave() {
    setError("");
    setSaving(true);
    try {
      await updateEmployeeAccess(employee.id, { approvalStatus, accessModules });
      await onSaved(`Access saved for ${employee.name}.`);
    } catch (err) {
      setError(err.response?.data?.message || "Could not update employee access.");
      setSaving(false);
    }
  }

  return (
    <div className="emp-panel-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}>
      <aside className="emp-panel" role="dialog" aria-modal="true" aria-labelledby="emp-panel-title">
        <header className="emp-panel-head">
          <div className="emp-person">
            <span className="emp-avatar large">{initials(employee.name)}</span>
            <div>
              <h2 id="emp-panel-title">{employee.name}</h2>
              <p>{employee.jobTitle || "Role not set"} · {employee.department || "Department not set"}</p>
            </div>
          </div>
          <button className="emp-icon-btn" type="button" aria-label="Close" onClick={onClose} disabled={saving}>×</button>
        </header>

        <div className="emp-panel-body">
          <dl className="emp-details">
            <div><dt>Email</dt><dd>{employee.email}</dd></div>
            <div><dt>Phone</dt><dd>{employee.phone || "—"}</dd></div>
            <div><dt>Employee code</dt><dd>{employee.employeeCode || "—"}</dd></div>
            <div><dt>Registered</dt><dd>{employee.createdAt}</dd></div>
          </dl>

          <section className="emp-panel-section">
            <h3>Login status</h3>
            <div className="emp-status-options" role="radiogroup" aria-label="Login status">
              {statusOptions.map((option) => (
                <label className={`emp-status-option${approvalStatus === option.value ? " selected" : ""}`} key={option.value}>
                  <input
                    type="radio"
                    name="approvalStatus"
                    value={option.value}
                    checked={approvalStatus === option.value}
                    onChange={() => { setApprovalStatus(option.value); setError(""); }}
                  />
                  <span>
                    <strong>{option.label}</strong>
                    <small>{option.hint}</small>
                  </span>
                </label>
              ))}
            </div>
          </section>

          <section className="emp-panel-section">
            <div className="emp-section-head">
              <h3>Pages this employee can open</h3>
              <span className="emp-muted">{accessModules.length} of {modules.length}</span>
            </div>
            <div className="emp-presets">
              {accessPresets.map((preset) => (
                <button
                  className={`emp-chip-btn${sameModules(accessModules, preset.modules.filter((m) => modules.includes(m))) ? " selected" : ""}`}
                  key={preset.key}
                  type="button"
                  onClick={() => applyModules(preset.modules)}
                >
                  {preset.label}
                </button>
              ))}
              <button className={`emp-chip-btn${accessModules.length === modules.length ? " selected" : ""}`} type="button" onClick={() => applyModules(modules)}>All pages</button>
              <button className="emp-chip-btn subtle" type="button" onClick={() => applyModules([])} disabled={!accessModules.length}>Clear</button>
            </div>
            <div className="emp-module-grid">
              {modules.map((module) => (
                <label className={`emp-check${accessModules.includes(module) ? " checked" : ""}`} key={module}>
                  <input type="checkbox" checked={accessModules.includes(module)} onChange={() => toggleModule(module)} />
                  <span>{moduleLabels[module] || module}</span>
                </label>
              ))}
            </div>
            {needsPages && <p className="emp-inline-note warning">Select at least one page to make this employee active.</p>}
          </section>
        </div>

        <footer className="emp-panel-foot">
          {error && <p className="emp-inline-note danger" role="alert">{error}</p>}
          <div className="emp-panel-actions">
            <button className="emp-btn primary" type="button" onClick={handleSave} disabled={saving || !dirty || needsPages}>
              {saving ? "Saving…" : "Save changes"}
            </button>
            <button className="emp-btn" type="button" onClick={onClose} disabled={saving}>Cancel</button>
          </div>
        </footer>
      </aside>
    </div>
  );
}

export function AdminEmployeesPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [moduleFilter, setModuleFilter] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [notice, setNotice] = useState("");

  function load() {
    return getEmployees()
      .then((res) => {
        setData(res.data);
        setError("");
      })
      .catch((err) => setError(err.response?.data?.message || "Could not load employee access requests."))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(""), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const allEmployees = useMemo(() => data?.employees || [], [data]);
  const modules = data?.modules || [];

  const counts = useMemo(() => allEmployees.reduce((acc, employee) => {
    acc[employee.approvalStatus] = (acc[employee.approvalStatus] || 0) + 1;
    if (employee.approvalStatus === "active" && employee.accessModules.length === 0) acc.gaps += 1;
    return acc;
  }, { pending: 0, active: 0, rejected: 0, gaps: 0 }), [allEmployees]);

  const employees = useMemo(() => {
    const query = search.trim().toLowerCase();
    return allEmployees.filter((employee) => {
      if (status && employee.approvalStatus !== status) return false;
      if (moduleFilter && !employee.accessModules.includes(moduleFilter)) return false;
      if (!query) return true;
      return [employee.name, employee.email, employee.employeeCode, employee.department, employee.jobTitle]
        .some((value) => value?.toLowerCase().includes(query));
    });
  }, [allEmployees, moduleFilter, search, status]);

  const editingEmployee = allEmployees.find((employee) => employee.id === editingId) || null;
  const hasFilters = Boolean(search || status || moduleFilter);

  const summaryCards = [
    { key: "", label: "All employees", value: allEmployees.length, tone: "neutral" },
    { key: "pending", label: "Pending review", value: counts.pending, tone: counts.pending ? "warning" : "neutral" },
    { key: "active", label: "Active", value: counts.active, tone: "success" },
    { key: "rejected", label: "Access off", value: counts.rejected, tone: "danger" }
  ];

  function clearFilters() {
    setSearch("");
    setStatus("");
    setModuleFilter("");
  }

  async function handleSaved(message) {
    await load();
    setEditingId(null);
    setNotice(message);
  }

  return (
    <AdminWorkspaceLayout
      badge={data?.header?.badge || "Employee access control"}
      title={data?.header?.title || "Employees"}
      description={data?.header?.description || "Approve employees and assign the pages they can use."}
      highlights={[]}
      hideHeaderIntro
      className="employees-page-shell"
    >
      <div className="emp-command-bar">
        <div className="emp-summary" aria-label="Employee summary">
          {summaryCards.map((card) => (
            <button
              className={`emp-summary-card ${card.tone}${status === card.key ? " active" : ""}`}
              key={card.label}
              type="button"
              aria-pressed={status === card.key}
              onClick={() => setStatus(card.key)}
            >
              <span>{card.label}</span>
              <strong>{card.value}</strong>
            </button>
          ))}
        </div>
        <button className="emp-btn" type="button" onClick={() => { setLoading(true); load(); }} disabled={loading}>Refresh</button>
      </div>

      <StateNotice loading={loading && !data} error={error} />

      {counts.gaps > 0 && (
        <p className="emp-inline-note warning banner">
          {counts.gaps === 1 ? "1 active employee has" : `${counts.gaps} active employees have`} no pages assigned and will see an empty workspace.
        </p>
      )}
      {notice && <p className="emp-inline-note success banner" role="status">{notice}</p>}

      <section className="content-card emp-table-card">
        <div className="emp-toolbar">
          <input
            className="emp-input"
            type="search"
            placeholder="Search by name, email, code, role or department"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select className="emp-input" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="">All statuses</option>
            <option value="pending">Pending review</option>
            <option value="active">Active</option>
            <option value="rejected">Access off</option>
          </select>
          <select className="emp-input" value={moduleFilter} onChange={(e) => setModuleFilter(e.target.value)} aria-label="Page">
            <option value="">All pages</option>
            {modules.map((module) => (
              <option key={module} value={module}>{moduleLabels[module] || module}</option>
            ))}
          </select>
          <button className="emp-btn subtle" disabled={!hasFilters} type="button" onClick={clearFilters}>Clear filters</button>
          <span className="emp-muted emp-count">{employees.length} of {allEmployees.length}</span>
        </div>

        <div className="emp-table-shell">
          <table className="emp-table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Role</th>
                <th>Code</th>
                <th>Registered</th>
                <th>Status</th>
                <th>Pages</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {employees.map((employee) => (
                <tr key={employee.id} onClick={() => setEditingId(employee.id)}>
                  <td>
                    <div className="emp-person">
                      <span className="emp-avatar">{initials(employee.name)}</span>
                      <div>
                        <strong>{employee.name}</strong>
                        <small>{employee.email}</small>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className="emp-cell-main">{employee.jobTitle || "—"}</span>
                    <small>{employee.department || ""}</small>
                  </td>
                  <td className="emp-mono">{employee.employeeCode || "—"}</td>
                  <td>{employee.createdAt}</td>
                  <td><StatusBadge status={employee.approvalStatus} /></td>
                  <td><PagesSummary modules={employee.accessModules} muted={employee.approvalStatus !== "active"} /></td>
                  <td className="emp-actions-cell">
                    <button
                      className={`emp-btn${employee.approvalStatus === "pending" ? " primary" : ""}`}
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setEditingId(employee.id); }}
                    >
                      {employee.approvalStatus === "pending" ? "Review" : "Manage"}
                    </button>
                  </td>
                </tr>
              ))}
              {!loading && employees.length === 0 && (
                <tr className="emp-empty-row">
                  <td colSpan="7">
                    {hasFilters ? "No employees match these filters." : "No employee registrations yet."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {editingEmployee && (
        <EmployeeAccessPanel
          key={editingEmployee.id}
          employee={editingEmployee}
          modules={modules}
          onClose={() => setEditingId(null)}
          onSaved={handleSaved}
        />
      )}
    </AdminWorkspaceLayout>
  );
}
