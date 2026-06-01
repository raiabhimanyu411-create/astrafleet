import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getMyProfile, updateMyProfile } from "../../api/authApi";
import { getRealtimeSocket } from "../../api/realtime";
import { StatCard } from "../../components/StatCard";
import { StateNotice } from "../../components/StateNotice";
import { StatusPill } from "../../components/StatusPill";
import { usePanelData } from "../../hooks/usePanelData";
import { AdminWorkspaceLayout } from "./AdminWorkspaceLayout";
import { DriverChatWidget } from "./DriverChatWidget";
import { getAuthSession, saveAuthSession } from "../../utils/authSession";

const moduleLinks = {
  "Employee Access Control": "/admin/employees",
  "Driver Management": "/admin/drivers",
  "Finance Management": "/admin/finance",
  "Trip / Route Planning": "/admin/trips",
  "Vehicle Management": "/admin/vehicles",
  "Invoicing & Billing": "/admin/billing",
  "GPS / Live Tracking": "/admin/tracking",
  "Control Room Alerts": "/admin/alerts"
};

function AdminProfileSettings() {
  const [profile, setProfile] = useState({ name: "", email: "" });
  const [passwords, setPasswords] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    getMyProfile()
      .then((res) => {
        setProfile({ name: res.data.name || "", email: res.data.email || "" });
        setError("");
      })
      .catch((err) => setError(err.response?.data?.message || "Profile could not be loaded."))
      .finally(() => setLoading(false));
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (passwords.newPassword && passwords.newPassword !== passwords.confirmPassword) {
      setError("New password and confirmation do not match.");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: profile.name,
        email: profile.email,
        currentPassword: passwords.currentPassword,
        newPassword: passwords.newPassword
      };
      const res = await updateMyProfile(payload);
      const session = getAuthSession();
      if (session) saveAuthSession({ ...session, name: res.data.profile?.name || profile.name });
      setPasswords({ currentPassword: "", newPassword: "", confirmPassword: "" });
      setSuccess("Profile settings updated.");
    } catch (err) {
      setError(err.response?.data?.message || "Profile could not be updated.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className="content-card admin-profile-card">
      <div className="section-head">
        <div>
          <span className="card-label">Profile settings</span>
          <h2>Admin account</h2>
        </div>
        <StatusPill tone="neutral">{loading ? "Loading" : "Secure"}</StatusPill>
      </div>

      <form className="admin-profile-form" onSubmit={handleSubmit}>
        <div className="profile-settings-grid">
          <label className="af-field">
            <span className="af-label">Admin name</span>
            <input className="af-input" value={profile.name} onChange={e => setProfile(prev => ({ ...prev, name: e.target.value }))} required />
          </label>
          <label className="af-field">
            <span className="af-label">Email / username</span>
            <input className="af-input" type="email" value={profile.email} onChange={e => setProfile(prev => ({ ...prev, email: e.target.value }))} required />
          </label>
          <label className="af-field">
            <span className="af-label">Current password</span>
            <input className="af-input" type="password" value={passwords.currentPassword} onChange={e => setPasswords(prev => ({ ...prev, currentPassword: e.target.value }))} required />
          </label>
          <label className="af-field">
            <span className="af-label">New password</span>
            <input className="af-input" type="password" value={passwords.newPassword} onChange={e => setPasswords(prev => ({ ...prev, newPassword: e.target.value }))} placeholder="Leave blank to keep current" />
          </label>
          <label className="af-field">
            <span className="af-label">Confirm new password</span>
            <input className="af-input" type="password" value={passwords.confirmPassword} onChange={e => setPasswords(prev => ({ ...prev, confirmPassword: e.target.value }))} placeholder="Repeat new password" />
          </label>
        </div>
        {error && <p className="lp-error">{error}</p>}
        {success && <p className="lp-success">{success}</p>}
        <button className="header-action-button" type="submit" disabled={loading || saving}>
          {saving ? "Saving..." : "Save profile"}
        </button>
      </form>
    </article>
  );
}

export function AdminPanel() {
  const { data, error, loading, refetch } = usePanelData("/api/admin/overview");

  useEffect(() => {
    const socket = getRealtimeSocket();

    function handleLocationUpdate() {
      refetch(false);
    }

    socket.connect();
    socket.emit("admin-tracking:join");
    socket.on("driver-location:updated", handleLocationUpdate);

    return () => {
      socket.off("driver-location:updated", handleLocationUpdate);
      socket.emit("admin-tracking:leave");
    };
  }, [refetch]);

  return (
    <AdminWorkspaceLayout
      badge={data?.header?.badge || "Admin control tower"}
      title={data?.header?.title || "Transport management system admin panel"}
      description={
        data?.header?.description ||
        "Manage fleet, drivers, routes, billing, and live truck movement from one admin workspace."
      }
      highlights={
        data?.highlights || [
          "Admins get a consolidated view of dispatch, compliance, finance, and live tracking.",
          "Driver approvals, trip planning, and truck availability are visible in one control layer.",
          "All payments and billing values are now tracked in pound sterling."
        ]
      }
    >
      <StateNotice loading={loading} error={error} />

      <DriverChatWidget />

      <AdminProfileSettings />

      <section className="stats-grid">
        {(data?.stats || []).map((item) => (
          <StatCard item={item} key={item.label} />
        ))}
      </section>

      <section className="content-grid">
        <article className="content-card">
          <div className="section-head">
            <div>
              <span className="card-label">Employee access</span>
              <h2>Registration approvals</h2>
            </div>
            <StatusPill tone="warning">Admin controlled</StatusPill>
          </div>

          <div className="data-rows">
            {(data?.employeeRequests || []).map((employee) => (
              <div className="data-row" key={employee.id}>
                <div>
                  <strong>{employee.name}</strong>
                  <p>{employee.email} · {employee.identity}</p>
                </div>
                <div>
                  <span>{employee.department}</span>
                  <p>{employee.access.length ? employee.access.join(", ") : "No access yet"}</p>
                </div>
                <StatusPill tone={employee.tone}>{employee.status}</StatusPill>
              </div>
            ))}
            {!loading && (data?.employeeRequests || []).length === 0 && (
              <div className="data-row">
                <div>
                  <strong>No employee access requests</strong>
                  <p>New self-registrations will appear here for admin approval.</p>
                </div>
                <div>
                  <span>Queue clear</span>
                  <p>Access control is up to date</p>
                </div>
                <StatusPill tone="success">Clear</StatusPill>
              </div>
            )}
          </div>
        </article>

        <article className="content-card">
          <div className="section-head">
            <div>
              <span className="card-label">Admin modules</span>
              <h2>Core transport workflows</h2>
            </div>
            <StatusPill tone="success">Pages ready</StatusPill>
          </div>

          <div className="module-list">
            {(data?.modules || []).map((module, index) => (
              <div className="module-row" key={module.title}>
                <span className="module-index">{index + 1}</span>
                <div>
                  <div className="module-row-head">
                    <h3>{module.title}</h3>
                    <Link className="module-row-link" to={module.path || moduleLinks[module.title] || "/admin"}>
                      Open page
                    </Link>
                  </div>
                  <p>{module.description}</p>
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="content-card">
          <div className="section-head">
            <div>
              <span className="card-label">Driver management</span>
              <h2>Approvals and assignment queue</h2>
            </div>
            <StatusPill tone="warning">Needs admin review</StatusPill>
          </div>

          <div className="data-rows">
            {(data?.driverQueue || []).map((driver) => (
              <div className="data-row" key={driver.name}>
                <div>
                  <strong>{driver.name}</strong>
                  <p>{driver.assignment}</p>
                </div>
                <div>
                  <span>Compliance</span>
                  <p>{driver.compliance}</p>
                </div>
                <StatusPill tone={driver.tone}>{driver.status}</StatusPill>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="content-grid">
        <article className="content-card">
          <div className="section-head">
            <div>
              <span className="card-label">Trip / route planning</span>
              <h2>Dispatch planning board</h2>
            </div>
            <StatusPill tone="neutral">Planner synced</StatusPill>
          </div>

          <div className="data-rows">
            {(data?.tripPlans || []).map((trip) => (
              <div className="data-row" key={trip.route}>
                <div>
                  <strong>{trip.route}</strong>
                  <p>{trip.vehicle}</p>
                </div>
                <div>
                  <span>{trip.status}</span>
                  <p>{trip.schedule}</p>
                </div>
                <StatusPill tone={trip.tone}>{trip.status}</StatusPill>
              </div>
            ))}
          </div>
        </article>

        <article className="content-card">
          <div className="section-head">
            <div>
              <span className="card-label">Finance snapshot</span>
              <h2>Pound-denominated invoice watch</h2>
            </div>
            <StatusPill tone="warning">Pound mode</StatusPill>
          </div>

          <div className="data-rows compact">
            {(data?.finance || []).map((invoice) => (
              <div className="data-row" key={invoice.invoice}>
                <div>
                  <strong>{invoice.invoice}</strong>
                  <p>{invoice.client}</p>
                </div>
                <div>
                  <span>{invoice.amount}</span>
                  <p>{invoice.due}</p>
                </div>
                <StatusPill tone={invoice.tone}>{invoice.status}</StatusPill>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="content-grid">
        <article className="content-card">
          <div className="section-head">
            <div>
              <span className="card-label">GPS / live tracking</span>
              <h2>Where every truck is right now</h2>
            </div>
            <StatusPill tone="success">Live feed</StatusPill>
          </div>

          <div className="data-rows">
            {(data?.trackingBoard || []).map((truck) => (
              <div className="data-row" key={truck.truck}>
                <div>
                  <strong>{truck.truck}</strong>
                  <p>{truck.driver} · {truck.location}</p>
                </div>
                <div>
                  <span>{truck.status}</span>
                  <p>{truck.note} · ETA {truck.eta}</p>
                </div>
                <StatusPill tone={truck.tone}>{truck.status}</StatusPill>
              </div>
            ))}
          </div>
        </article>

        <article className="content-card">
          <div className="section-head">
            <div>
              <span className="card-label">Control room alerts</span>
              <h2>Priority watchlist</h2>
            </div>
            <StatusPill tone="danger">Take action</StatusPill>
          </div>

          <div className="alert-stack">
            {(data?.alerts || []).map((alert) => (
              <div className="alert-card" key={alert.title}>
                <div className={`alert-bar ${alert.tone}`} />
                <div>
                  <strong>{alert.title}</strong>
                  <p>{alert.description}</p>
                </div>
              </div>
            ))}
          </div>
        </article>
      </section>
    </AdminWorkspaceLayout>
  );
}
