import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getMyProfile, updateMyProfile } from "../../api/authApi";
import { getRealtimeSocket } from "../../api/realtime";
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

const overviewMetricSets = {
  operations: ["Total bookings / jobs", "Active trips", "Pending trips", "Completed trips"],
  finance: ["Profit / loss", "Today's revenue", "Pending invoices", "Fuel expense"],
  health: ["Available drivers", "Available vehicles", "Cancelled trips", "Delayed deliveries"]
};

function OverviewGlyph({ type }) {
  if (type === "finance") {
    return (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M5 18V9m7 9V5m7 13v-6" />
        <path d="M3.5 20h17" />
      </svg>
    );
  }

  if (type === "health") {
    return (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M4 12h3l2-5 4 10 2-5h5" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4" y="7" width="16" height="11" rx="2" />
      <path d="M9 7V5.5h6V7M4 12h16" />
    </svg>
  );
}

function OverviewMetricLink({ item, variant = "compact" }) {
  if (!item) return null;

  const route = overviewStatRoutes[item.label.toLowerCase()] || "/admin/activity";

  return (
    <Link
      className={`overview-metric-link overview-metric-${variant} tone-${item.tone || "neutral"}`}
      to={route}
      aria-label={`${item.label}: ${item.value}. Open details`}
    >
      <div className="overview-metric-copy">
        <span className="overview-metric-label">{item.label}</span>
        <strong>{item.value}</strong>
        {variant === "featured" && <p>{item.description}</p>}
      </div>
      <div className="overview-metric-meta">
        {item.change && <span>{item.change}</span>}
        <span className="overview-metric-arrow" aria-hidden="true">→</span>
      </div>
    </Link>
  );
}

function OverviewPanelFooter({ total, visible, label }) {
  const remaining = Math.max(0, total - visible);

  return (
    <div className="overview-panel-footer">
      <span>{remaining ? `+${remaining} more in queue` : "Workspace synced"}</span>
      <strong>{label} <span aria-hidden="true">→</span></strong>
    </div>
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
  const statsByLabel = new Map((data?.stats || []).map((item) => [item.label, item]));
  const metrics = Object.fromEntries(
    Object.entries(overviewMetricSets).map(([group, labels]) => [group, labels.map((label) => statsByLabel.get(label))])
  );

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

      <section className="overview-dashboard" aria-label="Key performance metrics">
        <article className="overview-cluster overview-operations-cluster">
          <header className="overview-cluster-head">
            <span className="overview-cluster-icon"><OverviewGlyph type="operations" /></span>
            <div>
              <span>Operations</span>
              <h3>Trip activity</h3>
            </div>
            <span className="overview-cluster-note">Live workflow</span>
          </header>
          <div className="overview-operations-body">
            <OverviewMetricLink item={metrics.operations[0]} variant="featured" />
            <div className="overview-operations-list">
              {metrics.operations.slice(1).filter(Boolean).map((item) => (
                <OverviewMetricLink item={item} key={item.label} />
              ))}
            </div>
          </div>
        </article>

        <article className="overview-cluster overview-finance-cluster">
          <header className="overview-cluster-head">
            <span className="overview-cluster-icon"><OverviewGlyph type="finance" /></span>
            <div>
              <span>Finance</span>
              <h3>Money at a glance</h3>
            </div>
            <span className="overview-cluster-note">GBP</span>
          </header>
          <OverviewMetricLink item={metrics.finance[0]} variant="finance" />
          <div className="overview-finance-list">
            {metrics.finance.slice(1).filter(Boolean).map((item) => (
              <OverviewMetricLink item={item} variant="mini" key={item.label} />
            ))}
          </div>
        </article>

        <article className="overview-cluster overview-health-cluster">
          <header className="overview-cluster-head">
            <span className="overview-cluster-icon"><OverviewGlyph type="health" /></span>
            <div>
              <span>Fleet health</span>
              <h3>Capacity &amp; exceptions</h3>
            </div>
            <span className="overview-cluster-note">Actionable</span>
          </header>
          <div className="overview-health-list">
            {metrics.health.filter(Boolean).map((item) => (
              <OverviewMetricLink item={item} variant="health" key={item.label} />
            ))}
          </div>
        </article>
      </section>

      <div className="overview-workspace-head">
        <div>
          <span className="card-label">Live workspace</span>
          <h2>Action centre</h2>
          <p>Priority queues, fleet movement and approvals in one compact view.</p>
        </div>
        <Link to="/admin/activity">
          Open activity report
          <span aria-hidden="true">→</span>
        </Link>
      </div>

      <section className="overview-bento-grid" aria-label="Operations action centre">
        <Link className="content-card content-card-link overview-bento-card overview-bento-alerts tone-danger" to="/admin/alerts">
          <div className="section-head">
            <div>
              <span className="card-label">Control room alerts</span>
              <h2>Priority Watchlist</h2>
            </div>
            <StatusPill tone="danger">Take action</StatusPill>
          </div>

          <div className="alert-stack">
            {(data?.alerts || []).slice(0, 6).map((alert, index) => (
              <div className="alert-card" key={`${alert.title}-${index}`}>
                <div className={`alert-bar ${alert.tone}`} />
                <div>
                  <strong>{alert.title}</strong>
                  <p>{alert.description}</p>
                </div>
              </div>
            ))}
            {!loading && (data?.alerts || []).length === 0 && (
              <div className="overview-panel-empty">
                <strong>No active alerts</strong>
                <p>The control-room queue is clear.</p>
              </div>
            )}
          </div>
          <OverviewPanelFooter total={(data?.alerts || []).length} visible={6} label="Open alerts" />
        </Link>

        <Link className="content-card content-card-link overview-bento-card overview-bento-tracking tone-success" to="/admin/tracking">
          <div className="section-head">
            <div>
              <span className="card-label">GPS / live tracking</span>
              <h2>Where Every Truck Is Right Now</h2>
            </div>
            <StatusPill tone="success">Live feed</StatusPill>
          </div>

          <div className="data-rows">
            {(data?.trackingBoard || []).slice(0, 6).map((truck) => (
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
            {!loading && (data?.trackingBoard || []).length === 0 && (
              <div className="overview-panel-empty">
                <strong>No vehicles reporting</strong>
                <p>Live GPS updates will appear here.</p>
              </div>
            )}
          </div>
          <OverviewPanelFooter total={(data?.trackingBoard || []).length} visible={6} label="Open live map" />
        </Link>
        <Link className="content-card content-card-link overview-bento-card overview-bento-employee tone-warning" to="/admin/employees">
          <div className="section-head">
            <div>
              <span className="card-label">Employee access</span>
              <h2>Registration Approvals</h2>
            </div>
            <StatusPill tone="warning">Admin controlled</StatusPill>
          </div>

          <div className="data-rows">
            {(data?.employeeRequests || []).slice(0, 4).map((employee) => (
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
          <OverviewPanelFooter total={(data?.employeeRequests || []).length} visible={4} label="Manage access" />
        </Link>

        <Link className="content-card content-card-link overview-bento-card overview-bento-drivers tone-warning" to="/admin/drivers">
          <div className="section-head">
            <div>
              <span className="card-label">Driver management</span>
              <h2>Approvals And Assignment Queue</h2>
            </div>
            <StatusPill tone="warning">Needs admin review</StatusPill>
          </div>

          <div className="data-rows">
            {(data?.driverQueue || []).slice(0, 4).map((driver) => (
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
            {!loading && (data?.driverQueue || []).length === 0 && (
              <div className="overview-panel-empty">
                <strong>No driver reviews</strong>
                <p>Driver approvals and compliance are clear.</p>
              </div>
            )}
          </div>
          <OverviewPanelFooter total={(data?.driverQueue || []).length} visible={4} label="Open drivers" />
        </Link>
        <Link className="content-card content-card-link overview-bento-card overview-bento-dispatch tone-neutral" to="/admin/trips">
          <div className="section-head">
            <div>
              <span className="card-label">Trip / route planning</span>
              <h2>Dispatch Planning Board</h2>
            </div>
            <StatusPill tone="neutral">Planner synced</StatusPill>
          </div>

          <div className="data-rows">
            {(data?.tripPlans || []).slice(0, 4).map((trip) => (
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
            {!loading && (data?.tripPlans || []).length === 0 && (
              <div className="overview-panel-empty">
                <strong>No open trip plans</strong>
                <p>The dispatch planning queue is clear.</p>
              </div>
            )}
          </div>
          <OverviewPanelFooter total={(data?.tripPlans || []).length} visible={4} label="Open dispatch" />
        </Link>

        <Link className="content-card content-card-link overview-bento-card overview-bento-finance tone-warning" to="/admin/finance">
          <div className="section-head">
            <div>
              <span className="card-label">Finance snapshot</span>
              <h2>Pound-Denominated Invoice Watch</h2>
            </div>
            <StatusPill tone="warning">Pound mode</StatusPill>
          </div>

          <div className="data-rows compact">
            {(data?.finance || []).slice(0, 4).map((invoice) => (
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
            {!loading && (data?.finance || []).length === 0 && (
              <div className="overview-panel-empty">
                <strong>No pending invoices</strong>
                <p>The finance watchlist is clear.</p>
              </div>
            )}
          </div>
          <OverviewPanelFooter total={(data?.finance || []).length} visible={4} label="Open finance" />
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
