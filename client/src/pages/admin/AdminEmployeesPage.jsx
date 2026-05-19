import { useEffect, useState } from "react";
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
  finance: "Finance",
  billing: "Billing",
  tracking: "Live Tracking",
  alerts: "Alerts"
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

      <section className="employee-access-grid">
        {(data?.employees || []).map((employee) => (
          <EmployeeAccessCard
            employee={employee}
            key={employee.id}
            modules={data?.modules || []}
            onSaved={load}
          />
        ))}
      </section>

      {!loading && (data?.employees || []).length === 0 && (
        <article className="content-card employee-empty-state">
          <span className="card-label">No requests</span>
          <strong>No employee registrations yet.</strong>
          <p className="employee-meta">New employee signups will appear here for admin approval and page assignment.</p>
        </article>
      )}
    </AdminWorkspaceLayout>
  );
}
