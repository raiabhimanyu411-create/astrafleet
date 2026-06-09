import { useEffect, useMemo, useState } from "react";
import { getEmployees, updateEmployeeAccess } from "../../api/adminApi";
import { StatCard } from "../../components/StatCard";
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

function EmployeeAccessCard({ employee, modules, onSaved }) {
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

  async function handleSave(e) {
    e.preventDefault();
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
  const recommendedAction = employee.approvalStatus === "pending"
    ? "Review registration"
    : employee.approvalStatus === "active" && employee.accessModules.length === 0
      ? "Assign pages"
      : employee.approvalStatus === "rejected"
        ? "Access blocked"
        : "Access configured";

  return (
    <article className="content-card employee-access-card">
      <div className="section-head">
        <div>
          <span className="card-label">{employee.employeeCode || "Employee"}</span>
          <h2>{employee.name}</h2>
          <p className="employee-meta">{employee.email} · {employee.phone || "No phone"}</p>
        </div>
        <StatusPill tone={tone}>{approvalStatus}</StatusPill>
      </div>

      <div className="data-row employee-profile-row">
        <div>
          <strong>{employee.jobTitle || "Role not set"}</strong>
          <p>{employee.department || "Department not set"}</p>
        </div>
        <div>
          <span>Action</span>
          <p>{recommendedAction}</p>
        </div>
        <div>
          <span>Registered</span>
          <p>{employee.createdAt}</p>
        </div>
      </div>

      <form className="employee-access-controls" onSubmit={handleSave}>
        <label className="af-field">
          <span className="af-label">Approval status</span>
          <select
            className="af-select"
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
        </label>

        <div>
          <span className="af-label">Allowed pages</span>
          <p className="employee-access-summary">{activeAccessText}</p>
          <div className="employee-preset-row">
            <button className="header-action-button" type="button" onClick={() => applyModules(accessPresets.operations)}>Operations</button>
            <button className="header-action-button" type="button" onClick={() => applyModules(accessPresets.financeDesk)}>Finance desk</button>
            <button className="header-action-button" type="button" onClick={() => applyModules(accessPresets.controlRoom)}>Control room</button>
            <button className="header-action-button" type="button" onClick={() => applyModules(modules)}>All pages</button>
            <button className="header-action-button danger" type="button" onClick={() => applyModules([])}>Clear</button>
          </div>
          <div className="module-check-grid">
            {modules.map((module) => (
              <label className="module-check" key={module}>
                <input
                  type="checkbox"
                  checked={accessModules.includes(module)}
                  onChange={() => toggleModule(module)}
                />
                <span>{moduleLabels[module] || module}</span>
              </label>
            ))}
          </div>
        </div>

        {error && <p className="lp-error">{error}</p>}
        {success && <p className="lp-success">{success}</p>}
        {hasUnsavedChanges && !success && !error && (
          <p className="employee-unsaved-note">Unsaved changes are ready to apply.</p>
        )}

        <button className="header-action-button" disabled={saving} type="submit">
          {saving ? "Saving..." : hasUnsavedChanges ? "Save changes" : "Save access"}
        </button>
      </form>
    </article>
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

      <section className="stats-grid">
        {(data?.stats || []).map((item) => (
          <StatCard item={item} key={item.label} />
        ))}
      </section>

      <section className="stats-grid inline finance-position-grid">
        {(data?.accessHealth || []).map((item) => (
          <StatCard item={item} key={item.label} />
        ))}
      </section>

      <section className="content-grid">
        <article className="content-card">
          <div className="section-head">
            <div>
              <span className="card-label">Access coverage</span>
              <h2>Assigned workspace owners</h2>
            </div>
            <StatusPill tone="neutral">Live permissions</StatusPill>
          </div>
          <div className="employee-coverage-grid">
            {(data?.moduleCoverage || []).map(item => (
              <button className="employee-coverage-tile" key={item.module} type="button" onClick={() => setModuleFilter(item.module)}>
                <span>{moduleLabels[item.module] || item.module}</span>
                <strong>{item.activeCount}</strong>
                <p>{item.activeCount === 1 ? "active employee" : "active employees"}</p>
              </button>
            ))}
          </div>
        </article>

        <article className="content-card">
          <div className="section-head">
            <div>
              <span className="card-label">Review queue</span>
              <h2>Employee access controls</h2>
            </div>
            <StatusPill tone={employees.length ? "success" : "neutral"}>{employees.length} visible</StatusPill>
          </div>
          <div className="employee-filter-card">
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
          </div>
        </article>
      </section>

      <section className="employee-access-grid">
        {employees.map((employee) => (
          <EmployeeAccessCard
            employee={employee}
            key={employee.id}
            modules={data?.modules || []}
            onSaved={load}
          />
        ))}
      </section>

      {!loading && employees.length === 0 && (
        <article className="content-card employee-empty-state">
          <span className="card-label">{hasFilters ? "No matches" : "No requests"}</span>
          <strong>{hasFilters ? "No employees match your filters." : "No employee registrations yet."}</strong>
          <p className="employee-meta">{hasFilters ? "Clear filters to return to the full access queue." : "New employee signups will appear here for admin approval and page assignment."}</p>
        </article>
      )}
    </AdminWorkspaceLayout>
  );
}
