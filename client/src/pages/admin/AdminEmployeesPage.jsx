import { useEffect, useMemo, useState } from "react";
import { getEmployees, updateEmployeeAccess } from "../../api/adminApi";
import { StateNotice } from "../../components/StateNotice";
import { StatusPill } from "../../components/StatusPill";
import { AdminWorkspaceLayout } from "./AdminWorkspaceLayout";

const moduleLabels = {
  jobs: "Jobs",
  customers: "Customers",
  trips: "Dispatch",
  drivers: "Drivers",
  vehicles: "Vehicles",
  maintenance: "Maintenance",
  finance: "Finance",
  billing: "Billing",
  tracking: "Live Tracking",
  alerts: "Alerts"
};

const accessPresets = {
  operations: ["jobs", "customers", "trips", "drivers", "vehicles", "maintenance", "tracking", "alerts"],
  financeDesk: ["finance", "billing", "alerts"],
  controlRoom: ["trips", "drivers", "vehicles", "maintenance", "tracking", "alerts"],
  fullAccess: Object.keys(moduleLabels)
};

function sameModules(a = [], b = []) {
  const left = [...a].sort().join("|");
  const right = [...b].sort().join("|");
  return left === right;
}

function EmployeeAccessRow({ employee, modules, onSaved }) {
  const [approvalStatus, setApprovalStatus] = useState(employee.approvalStatus);
  const [accessModules, setAccessModules] = useState(employee.accessModules || []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    setApprovalStatus(employee.approvalStatus);
    setAccessModules(employee.accessModules || []);
  }, [employee.approvalStatus, employee.accessModules]);

  function toggleModule(module) {
    setSuccess("");
    setError("");
    setAccessModules((current) => (
      current.includes(module)
        ? current.filter((item) => item !== module)
        : [...current, module]
    ));
  }

  function applyModules(nextModules) {
    setSuccess("");
    setError("");
    setAccessModules(nextModules.filter((module) => modules.includes(module)));
  }

  async function handleSave() {
    setError("");
    setSuccess("");
    setSaving(true);
    try {
      await updateEmployeeAccess(employee.id, { approvalStatus, accessModules });
      await onSaved(employee.id);
      setSuccess("Access saved. Employee should log out and log in again to get the updated pages.");
    } catch (err) {
      setError(err.response?.data?.message || "Could not update employee access.");
    } finally {
      setSaving(false);
    }
  }

  const tone = approvalStatus === "active" ? "success" : approvalStatus === "rejected" ? "danger" : "warning";
  const hasUnsavedChanges = approvalStatus !== employee.approvalStatus || !sameModules(accessModules, employee.accessModules);
  const activeAccessText = accessModules.length
    ? accessModules.map((module) => moduleLabels[module] || module).join(", ")
    : "No pages selected";

  return (
    <tr>
      <td>
        <strong>{employee.name}</strong>
        <small>{employee.email}</small>
        <small>{employee.phone || "No phone"}</small>
      </td>
      <td>
        <strong>{employee.employeeCode || "—"}</strong>
        <small>{employee.createdAt}</small>
      </td>
      <td>
        <strong>{employee.jobTitle || "Role not set"}</strong>
        <small>{employee.department || "Department not set"}</small>
      </td>
      <td>
        <div className="employee-status-cell">
          <select
            className="employee-table-select"
            value={approvalStatus}
            onChange={(e) => {
              setApprovalStatus(e.target.value);
              setSuccess("");
              setError("");
            }}
          >
            <option value="pending">Pending review</option>
            <option value="active">Approve login</option>
            <option value="rejected">Reject access</option>
          </select>
          <StatusPill tone={tone}>{approvalStatus}</StatusPill>
        </div>
      </td>
      <td>
        <div className="employee-preset-row compact">
          <button className="header-action-button" type="button" onClick={() => applyModules(accessPresets.operations)}>Ops</button>
          <button className="header-action-button" type="button" onClick={() => applyModules(accessPresets.financeDesk)}>Finance</button>
          <button className="header-action-button" type="button" onClick={() => applyModules(accessPresets.controlRoom)}>Control</button>
          <button className="header-action-button" type="button" onClick={() => applyModules(modules)}>All</button>
          <button className="header-action-button danger" type="button" onClick={() => applyModules([])}>Clear</button>
        </div>
        <small>{activeAccessText}</small>
      </td>
      <td>
        <div className="employee-module-table-grid">
          {modules.map((module) => (
            <label className="module-check compact" key={module}>
              <input
                type="checkbox"
                checked={accessModules.includes(module)}
                onChange={() => toggleModule(module)}
              />
              <span>{moduleLabels[module] || module}</span>
            </label>
          ))}
        </div>
      </td>
      <td>
        <div className="employee-table-actions">
          <button className="header-action-button" disabled={saving || (!hasUnsavedChanges && !error)} type="button" onClick={handleSave}>
            {saving ? "Saving..." : hasUnsavedChanges ? "Save" : "Saved"}
          </button>
          {hasUnsavedChanges && !success && !error && <small>Unsaved changes</small>}
          {error && <small className="employee-row-error">{error}</small>}
          {success && <small className="employee-row-success">{success}</small>}
        </div>
      </td>
    </tr>
  );
}

export function AdminEmployeesPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [moduleFilter, setModuleFilter] = useState("");

  function load() {
    setLoading(true);
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

  const employees = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (data?.employees || []).filter(employee => {
      if (status && employee.approvalStatus !== status) return false;
      if (moduleFilter && !employee.accessModules.includes(moduleFilter)) return false;
      if (!query) return true;
      return (
        employee.name.toLowerCase().includes(query) ||
        employee.email.toLowerCase().includes(query) ||
        employee.employeeCode?.toLowerCase().includes(query) ||
        employee.department?.toLowerCase().includes(query) ||
        employee.jobTitle?.toLowerCase().includes(query)
      );
    });
  }, [data, moduleFilter, search, status]);

  const hasFilters = Boolean(search || status || moduleFilter);

  function clearFilters() {
    setSearch("");
    setStatus("");
    setModuleFilter("");
  }

  return (
    <AdminWorkspaceLayout
      badge={data?.header?.badge || "Employee access control"}
      title={data?.header?.title || "Admin-controlled employee permissions"}
      description={data?.header?.description || "Approve employees and assign the exact TMS pages they can handle."}
      highlights={data?.highlights || []}
    >
      <StateNotice loading={loading} error={error} />

      <section className="employee-quick-grid">
        {(data?.stats || []).map(item => (
          <article className={`employee-quick-card ${item.tone || "neutral"}`} key={item.label}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
            <p>{item.change}</p>
          </article>
        ))}
        {(data?.accessHealth || []).map(item => (
          <article className={`employee-quick-card ${item.tone || "neutral"}`} key={item.label}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
            <p>{item.change}</p>
          </article>
        ))}
      </section>

      <section className="content-card employee-filter-card">
        <input
          className="af-input"
          placeholder="Search employee, email, role, or department..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select className="af-select" value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="pending">Pending review</option>
          <option value="active">Active</option>
          <option value="rejected">Rejected</option>
        </select>
        <select className="af-select" value={moduleFilter} onChange={e => setModuleFilter(e.target.value)}>
          <option value="">All pages</option>
          {(data?.modules || []).map(module => (
            <option key={module} value={module}>{moduleLabels[module] || module}</option>
          ))}
        </select>
        <button className="header-action-button" disabled={!hasFilters} type="button" onClick={clearFilters}>Clear filters</button>
      </section>

      <section className="content-card employee-table-card">
        <div className="section-head">
          <div>
            <span className="card-label">Employee access</span>
            <h2>Permission control table</h2>
          </div>
          <StatusPill tone={employees.length ? "success" : "neutral"}>{employees.length} visible</StatusPill>
        </div>
        <div className="employee-table-shell">
          <table className="employee-access-table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Code / Joined</th>
                <th>Role</th>
                <th>Status</th>
                <th>Presets</th>
                <th>Allowed pages</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((employee) => (
                <EmployeeAccessRow
                  employee={employee}
                  key={employee.id}
                  modules={data?.modules || []}
                  onSaved={load}
                />
              ))}
              {!loading && employees.length === 0 && (
                <tr>
                  <td colSpan="7">
                    <p className="finance-empty">
                      {hasFilters ? "No employees match your filters." : "No employee registrations yet."}
                    </p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </AdminWorkspaceLayout>
  );
}
