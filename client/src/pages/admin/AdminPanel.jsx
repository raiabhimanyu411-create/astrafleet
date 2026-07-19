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

const overviewStatRoutes = {
  "total bookings / jobs": "/admin/jobs",
  "active trips": "/admin/trips",
  "pending trips": "/admin/trips",
  "completed trips": "/admin/trips",
  "cancelled trips": "/admin/trips",
  "available drivers": "/admin/drivers",
  "available vehicles": "/admin/vehicles",
  "delayed deliveries": "/admin/trips",
  "today's revenue": "/admin/billing",
  "pending invoices": "/admin/billing",
  "fuel expense": "/admin/finance",
  "profit / loss": "/admin/finance"
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
          <span className="card-label">Profile Settings</span>
          <h2>Admin Account</h2>
        </div>
        <StatusPill tone="neutral">{loading ? "Loading" : "Secure"}</StatusPill>
      </div>

      <form className="admin-profile-form" onSubmit={handleSubmit}>
        <div className="profile-settings-grid">
          <label className="af-field">
            <span className="af-label">Admin Name</span>
            <input className="af-input" value={profile.name} onChange={e => setProfile(prev => ({ ...prev, name: e.target.value }))} required />
          </label>
          <label className="af-field">
            <span className="af-label">Email / Username</span>
            <input className="af-input" type="email" value={profile.email} onChange={e => setProfile(prev => ({ ...prev, email: e.target.value }))} required />
          </label>
          <label className="af-field">
            <span className="af-label">Current Password</span>
            <input className="af-input" type="password" value={passwords.currentPassword} onChange={e => setPasswords(prev => ({ ...prev, currentPassword: e.target.value }))} required />
          </label>
          <label className="af-field">
            <span className="af-label">New Password</span>
            <input className="af-input" type="password" value={passwords.newPassword} onChange={e => setPasswords(prev => ({ ...prev, newPassword: e.target.value }))} placeholder="Leave blank to keep current" />
          </label>
          <label className="af-field">
            <span className="af-label">Confirm New Password</span>
            <input className="af-input" type="password" value={passwords.confirmPassword} onChange={e => setPasswords(prev => ({ ...prev, confirmPassword: e.target.value }))} placeholder="Repeat new password" />
          </label>
        </div>
        {error && <p className="lp-error">{error}</p>}
        {success && <p className="lp-success">{success}</p>}
        <button className="header-action-button" type="submit" disabled={loading || saving}>
          {saving ? "Saving..." : "Save Profile"}
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
      <div className="admin-overview">
      <StateNotice loading={loading} error={error} />

      <div className="overview-metrics-head">
        <div>
          <span className="card-label">Live business snapshot</span>
          <h2>Key performance overview</h2>
          <p>Operational and financial metrics, updated from your workspace data.</p>
        </div>
        <span className="overview-live-status">
          <span aria-hidden="true" />
          Live data
        </span>
      </div>

      <section className="stats-grid">
        {(data?.stats || []).map((item) => (
          <StatCard
            item={item}
            key={item.label}
            to={overviewStatRoutes[item.label.toLowerCase()] || "/admin/activity"}
          />
        ))}
      </section>

      <h3 className="overview-group-label">Alerts &amp; Live Ops</h3>
      <section className="content-grid overview-content-grid">
        <Link className="content-card content-card-link tone-danger" to="/admin/alerts">
          <div className="section-head">
            <div>
              <span className="card-label">Control room alerts</span>
              <h2>Priority Watchlist</h2>
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
        </Link>

        <Link className="content-card content-card-link tone-success" to="/admin/tracking">
          <div className="section-head">
            <div>
              <span className="card-label">GPS / live tracking</span>
              <h2>Where Every Truck Is Right Now</h2>
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
        </Link>
      </section>

      <h3 className="overview-group-label">Approvals</h3>
      <section className="content-grid overview-content-grid">
        <Link className="content-card content-card-link tone-warning" to="/admin/employees">
          <div className="section-head">
            <div>
              <span className="card-label">Employee access</span>
              <h2>Registration Approvals</h2>
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
        </Link>

        <Link className="content-card content-card-link tone-warning" to="/admin/drivers">
          <div className="section-head">
            <div>
              <span className="card-label">Driver management</span>
              <h2>Approvals And Assignment Queue</h2>
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
        </Link>
      </section>

      <h3 className="overview-group-label">Dispatch &amp; Finance</h3>
      <section className="content-grid overview-content-grid">
        <Link className="content-card content-card-link tone-neutral" to="/admin/trips">
          <div className="section-head">
            <div>
              <span className="card-label">Trip / route planning</span>
              <h2>Dispatch Planning Board</h2>
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
        </Link>

        <Link className="content-card content-card-link tone-warning" to="/admin/finance">
          <div className="section-head">
            <div>
              <span className="card-label">Finance snapshot</span>
              <h2>Pound-Denominated Invoice Watch</h2>
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
        </Link>
      </section>

      <h3 className="overview-group-label">Support &amp; Account Tools</h3>
      <details className="content-card overview-tools overview-standalone-card">
        <summary className="overview-tools-summary">
          <div>
            <span className="card-label">Driver support &amp; profile</span>
            <h2>Chat With Drivers, Manage Your Admin Account</h2>
          </div>
          <span className="overview-tools-chevron" aria-hidden="true" />
        </summary>
        <div className="overview-tools-body">
          <DriverChatWidget />
          <AdminProfileSettings />
        </div>
      </details>
      </div>
    </AdminWorkspaceLayout>
  );
}
