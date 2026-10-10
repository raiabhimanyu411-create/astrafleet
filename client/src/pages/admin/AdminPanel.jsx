import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getMyProfile, updateMyProfile } from "../../api/authApi";
import { getRealtimeSocket } from "../../api/realtime";
import { StateNotice } from "../../components/StateNotice";
import { StatusPill } from "../../components/StatusPill";
import { usePanelData } from "../../hooks/usePanelData";
import { AdminWorkspaceLayout } from "./AdminWorkspaceLayout";
import { DriverChatWidget } from "./DriverChatWidget";
import "./AdminOverview.css";
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

const overviewMetricGroups = [
  { key: "operations", title: "Operations", labels: ["Active trips", "Pending trips", "Delayed deliveries", "Completed trips", "Cancelled trips", "Total bookings / jobs"] },
  { key: "fleet", title: "Fleet & finance", labels: ["Available drivers", "Available vehicles", "Pending invoices", "Today's revenue", "Fuel expense", "Profit / loss"] }
];

const metricDisplayLabels = {
  "Total bookings / jobs": "Total jobs"
};

// Exceptions only draw colour when there is something to act on.
const attentionLabels = new Set(["Delayed deliveries", "Cancelled trips", "Pending invoices", "Pending trips"]);

const ukDateLabel = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "long", day: "numeric", month: "long" });
const ukTimeLabel = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const ukHour = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "numeric", hourCycle: "h23" });

function greeting(date) {
  const hour = Number(ukHour.format(date));
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function isZero(value) {
  return Number(String(value ?? "").replace(/[^0-9.-]/g, "")) === 0;
}

function OvBadge({ tone = "neutral", children }) {
  return <span className={`ov-badge ${tone || "neutral"}`}>{children}</span>;
}

function OvMetric({ item, label }) {
  if (!item) return null;
  const route = overviewStatRoutes[label.toLowerCase()] || "/admin/activity";
  const flagged = attentionLabels.has(label) && !isZero(item.value);
  return (
    <Link className={`ov-metric${flagged ? ` flagged ${item.tone || "warning"}` : ""}`} to={route} aria-label={`${item.label}: ${item.value}. Open details`}>
      <span className="ov-metric-label">{metricDisplayLabels[label] || item.label}</span>
      <strong className="ov-metric-value">{item.value}</strong>
      <span className="ov-metric-hint">{item.description}</span>
    </Link>
  );
}

function OvCard({ title, count, to, linkLabel = "View all", className = "", children }) {
  return (
    <section className={`ov-card ${className}`}>
      <header className="ov-card-head">
        <h2>
          {title}
          {count !== undefined && <span className="ov-count">{count}</span>}
        </h2>
        {to && <Link className="ov-link" to={to}>{linkLabel}</Link>}
      </header>
      {children}
    </section>
  );
}

function OvEmpty({ children }) {
  return <p className="ov-empty">{children}</p>;
}

function AttentionIcon({ tone }) {
  if (tone === "danger") {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <circle cx="10" cy="10" r="8" />
        <path d="M10 5.5v5.5M10 13.8v.2" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M10 2.8 18 17H2z" />
      <path d="M10 8v4M10 14.4v.2" />
    </svg>
  );
}

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
  const [lastSync, setLastSync] = useState(null);
  const statsByLabel = new Map((data?.stats || []).map((item) => [item.label, item]));
  const session = getAuthSession();
  const firstName = String(session?.name || "").trim().split(/\s+/)[0];
  const now = lastSync || new Date();

  const alerts = data?.alerts || [];
  const tripPlans = data?.tripPlans || [];
  const trackingBoard = data?.trackingBoard || [];
  const driverQueue = data?.driverQueue || [];
  const employeeRequests = data?.employeeRequests || [];
  const invoices = data?.finance || [];
  const pendingEmployees = employeeRequests.filter((employee) => String(employee.status).toLowerCase() === "pending");

  useEffect(() => {
    if (data) setLastSync(new Date());
  }, [data]);

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
      title="Overview"
      description="Today across dispatch, fleet and finance."
      highlights={[]}
      hideHeaderIntro
      className="overview-page-shell"
    >
      <div className="ov-page">
        <header className="ov-head">
          <div>
            <h1>{greeting(now)}{firstName ? `, ${firstName}` : ""}</h1>
            <p>{ukDateLabel.format(now)} · UK time</p>
          </div>
          <div className="ov-head-actions">
            <span className="ov-sync">
              <span className="ov-live-dot" aria-hidden="true" />
              {lastSync ? `Updated ${ukTimeLabel.format(lastSync)}` : "Connecting…"}
            </span>
            <button className="ov-btn" type="button" onClick={() => refetch(false)}>Refresh</button>
          </div>
        </header>

        <StateNotice loading={loading && !data} error={error} />

        <section className="ov-metric-groups" aria-label="Key metrics">
          {overviewMetricGroups.map((group) => (
            <div className="ov-card ov-metric-card" key={group.key}>
              <h2 className="ov-metric-title">{group.title}</h2>
              <div className="ov-metric-grid">
                {group.labels.map((label) => (
                  <OvMetric item={statsByLabel.get(label)} key={label} label={label} />
                ))}
              </div>
            </div>
          ))}
        </section>

        <div className="ov-layout">
          <div className="ov-col">
            <OvCard title="Needs attention" count={alerts.length} to="/admin/alerts" className="ov-attention">
              {alerts.length ? (
                <ul className="ov-attention-list">
                  {alerts.slice(0, 6).map((alert, index) => (
                    <li className={`ov-attention-item ${alert.tone || "warning"}`} key={`${alert.title}-${index}`}>
                      <span className="ov-attention-icon"><AttentionIcon tone={alert.tone} /></span>
                      <div>
                        <strong>{alert.title}</strong>
                        <p>{alert.description}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                !loading && <OvEmpty>You're all caught up. Nothing needs action right now.</OvEmpty>
              )}
            </OvCard>

            <OvCard title="Dispatch" count={tripPlans.length} to="/admin/trips">
              {tripPlans.length ? (
                <div className="ov-table-shell">
                  <table className="ov-table ov-dispatch-table">
                    <thead>
                      <tr><th>Route</th><th>Vehicle · trailer · driver</th><th>Date</th><th>Status</th></tr>
                    </thead>
                    <tbody>
                      {tripPlans.slice(0, 5).map((trip) => (
                        <tr key={trip.id || trip.route}>
                          <td className="ov-strong">{trip.route}</td>
                          <td className="ov-muted-cell">{trip.vehicle}</td>
                          <td className="ov-nowrap">{trip.schedule}</td>
                          <td><OvBadge tone={trip.tone}>{trip.status}</OvBadge></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                !loading && <OvEmpty>No open trips in the dispatch queue.</OvEmpty>
              )}
            </OvCard>

            <OvCard title="Live vehicles" count={trackingBoard.length} to="/admin/tracking" linkLabel="Open map">
              {trackingBoard.length ? (
                <div className="ov-table-shell">
                  <table className="ov-table ov-vehicle-table">
                    <thead>
                      <tr><th>Vehicle</th><th>Driver</th><th>Last location</th><th>Speed</th><th>ETA</th><th>Status</th></tr>
                    </thead>
                    <tbody>
                      {trackingBoard.slice(0, 6).map((truck) => (
                        <tr key={truck.truck}>
                          <td className="ov-strong ov-nowrap">{truck.truck}</td>
                          <td className="ov-nowrap">{truck.driver}</td>
                          <td className="ov-muted-cell">{truck.location}</td>
                          <td className="ov-nowrap">{truck.note}</td>
                          <td className="ov-nowrap">{truck.eta}</td>
                          <td><OvBadge tone={truck.tone}>{truck.status}</OvBadge></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                !loading && <OvEmpty>No vehicles are reporting GPS right now.</OvEmpty>
              )}
            </OvCard>
          </div>

          <div className="ov-col ov-side">
            <OvCard title="Driver compliance" count={driverQueue.length} to="/admin/drivers">
              {driverQueue.length ? (
                <ul className="ov-list">
                  {driverQueue.slice(0, 4).map((driver) => (
                    <li key={driver.name}>
                      <div>
                        <strong>{driver.name}</strong>
                        <small>{driver.assignment}</small>
                      </div>
                      <OvBadge tone={driver.tone}>{driver.compliance}</OvBadge>
                    </li>
                  ))}
                </ul>
              ) : (
                !loading && <OvEmpty>All drivers are compliant.</OvEmpty>
              )}
            </OvCard>

            <OvCard title="Unpaid invoices" count={invoices.length} to="/admin/finance">
              {invoices.length ? (
                <ul className="ov-list">
                  {invoices.slice(0, 4).map((invoice) => (
                    <li key={invoice.invoice}>
                      <div>
                        <strong>{invoice.client}</strong>
                        <small>{invoice.invoice} · due {invoice.due}</small>
                      </div>
                      <div className="ov-list-end">
                        <strong>{invoice.amount}</strong>
                        <OvBadge tone={invoice.tone}>{invoice.status}</OvBadge>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                !loading && <OvEmpty>No unpaid invoices.</OvEmpty>
              )}
            </OvCard>

            <OvCard title="Employee approvals" count={pendingEmployees.length} to="/admin/employees" linkLabel="Manage">
              {pendingEmployees.length ? (
                <ul className="ov-list">
                  {pendingEmployees.slice(0, 4).map((employee) => (
                    <li key={employee.id}>
                      <div>
                        <strong>{employee.name}</strong>
                        <small>{employee.department || employee.email}</small>
                      </div>
                      <OvBadge tone="warning">Pending review</OvBadge>
                    </li>
                  ))}
                </ul>
              ) : (
                !loading && <OvEmpty>No registrations waiting for review.</OvEmpty>
              )}
            </OvCard>
          </div>
        </div>

        <details className="ov-card ov-tools">
          <summary>
            <span>
              <strong>Driver chat and account settings</strong>
              <small>Message drivers or change your admin name, email and password.</small>
            </span>
            <span className="ov-chevron" aria-hidden="true" />
          </summary>
          <div className="ov-tools-body">
            <DriverChatWidget />
            <AdminProfileSettings />
          </div>
        </details>
      </div>
    </AdminWorkspaceLayout>
  );
}
