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
import { ColumnChart, FleetMap, formatGbp, SERIES, StatusMeter } from "./OverviewCharts";
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

// Four headline numbers ride in the hero band; the rest sit in a compact tile strip.
const heroMetricLabels = ["Active trips", "Delayed deliveries", "Available vehicles", "Profit / loss"];
const tileMetricLabels = ["Total bookings / jobs", "Pending trips", "Completed trips", "Cancelled trips", "Available drivers", "Today's revenue", "Pending invoices", "Fuel expense"];

const metricDisplayLabels = {
  "Total bookings / jobs": "Total jobs",
  "Active trips": "On the road",
  "Available vehicles": "Trucks free",
  "Delayed deliveries": "Delayed",
  "Pending trips": "Pending",
  "Completed trips": "Completed",
  "Cancelled trips": "Cancelled",
  "Available drivers": "Drivers free",
  "Today's revenue": "Revenue today",
  "Pending invoices": "Unpaid invoices",
  "Fuel expense": "Fuel spend"
};

// Exceptions only draw colour when there is something to act on.
const attentionLabels = new Set(["Delayed deliveries", "Cancelled trips", "Pending invoices", "Pending trips"]);

const metricIcons = {
  "Total bookings / jobs": "M4 6.5h12v9H4zM7.5 6.5V4.5h5v2M4 10h12",
  "Active trips": "M2.5 6h9v7h-9zM11.5 8.5h3l2.5 2.5v2h-5.5M5 15.5a1.5 1.5 0 1 0 0-.01M14 15.5a1.5 1.5 0 1 0 0-.01",
  "Pending trips": "M10 3.5a6.5 6.5 0 1 0 0 13a6.5 6.5 0 1 0 0-13M10 6.5V10l2.5 1.5",
  "Completed trips": "M10 3.5a6.5 6.5 0 1 0 0 13a6.5 6.5 0 1 0 0-13M7 10.2l2 2 4-4.2",
  "Cancelled trips": "M10 3.5a6.5 6.5 0 1 0 0 13a6.5 6.5 0 1 0 0-13M7.5 7.5l5 5M12.5 7.5l-5 5",
  "Available drivers": "M10 4a3 3 0 1 0 0 6a3 3 0 1 0 0-6M4.5 16.5c.8-3 2.9-4.5 5.5-4.5s4.7 1.5 5.5 4.5",
  "Available vehicles": "M2.5 6h9v7h-9zM11.5 8.5h3l2.5 2.5v2h-5.5M5 15.5a1.5 1.5 0 1 0 0-.01M14 15.5a1.5 1.5 0 1 0 0-.01",
  "Delayed deliveries": "M10 3.5a6.5 6.5 0 1 0 0 13a6.5 6.5 0 1 0 0-13M10 6.5v4M10 13.5v.2",
  "Today's revenue": "M12.5 5.5c-.6-.7-1.5-1-2.5-1-2 0-3 1.2-3 3v6.5M5.5 10h5M5.5 15.5h8",
  "Pending invoices": "M5.5 3h7l3 3v11h-10zM12.5 3v3h3M8 10h5M8 13h5",
  "Fuel expense": "M4.5 16.5V4.5h7v12M4.5 9h7M11.5 7l3 2v5.5a1 1 0 0 0 2 0V8.5l-2-2",
  "Profit / loss": "M3.5 14l4-4 3 3 6-6.5M12.5 6.5h4v4"
};

function MetricIcon({ label }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d={metricIcons[label] || metricIcons["Total bookings / jobs"]} />
    </svg>
  );
}

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
    <Link className={`ov-tile${flagged ? ` flagged ${item.tone || "warning"}` : ""}`} to={route} aria-label={`${item.label}: ${item.value}. Open details`}>
      <span className="ov-tile-icon"><MetricIcon label={label} /></span>
      <span className="ov-tile-text">
        <span className="ov-tile-label">{metricDisplayLabels[label] || item.label}</span>
        <strong className="ov-tile-value">{item.value}</strong>
      </span>
    </Link>
  );
}

function HeroMetric({ item, label }) {
  if (!item) return null;
  const route = overviewStatRoutes[label.toLowerCase()] || "/admin/activity";
  const flagged = attentionLabels.has(label) && !isZero(item.value);
  return (
    <Link className={`ov-hero-metric${flagged ? " flagged" : ""}`} to={route} aria-label={`${item.label}: ${item.value}. Open details`}>
      <span className="ov-hero-metric-icon"><MetricIcon label={label} /></span>
      <span className="ov-hero-metric-label">{metricDisplayLabels[label] || item.label}</span>
      <strong>{item.value}</strong>
      <small>{item.description}</small>
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
  const trend = data?.monthlyTrend || [];
  const fleetMap = data?.fleetMap || [];
  const pendingEmployees = employeeRequests.filter((employee) => String(employee.status).toLowerCase() === "pending");

  const trendJobs = trend.map((m) => ({ ...m, open: Math.max(0, m.jobs - m.completed) }));
  const yearJobs = trend.reduce((sum, m) => sum + m.jobs, 0);
  const yearInvoiced = trend.reduce((sum, m) => sum + m.invoiced, 0);

  const fleetCounts = trackingBoard.reduce((acc, truck) => {
    const status = String(truck.status || "").replace(" ", "_");
    if (["in_transit", "planned"].includes(status)) acc.onJob += 1;
    else if (["maintenance", "stopped"].includes(status)) acc.offRoad += 1;
    else acc.available += 1;
    return acc;
  }, { available: 0, onJob: 0, offRoad: 0 });

  const activeTrips = Number(statsByLabel.get("Active trips")?.value || 0);
  const delayed = Number(statsByLabel.get("Delayed deliveries")?.value || 0);
  const summaryParts = [
    `${activeTrips} ${activeTrips === 1 ? "job" : "jobs"} on the road`,
    delayed ? `${delayed} running late` : "nothing running late",
    alerts.length ? `${alerts.length} ${alerts.length === 1 ? "alert" : "alerts"} to review` : "no open alerts"
  ];

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
        <section className="ov-hero" aria-label="Today">
          <svg className="ov-hero-art" viewBox="0 0 600 200" preserveAspectRatio="none" aria-hidden="true">
            <path d="M-20 160 C 120 60, 220 190, 340 110 S 560 40, 640 90" />
            <path d="M-20 190 C 140 110, 260 220, 380 140 S 580 90, 640 130" />
            <circle cx="340" cy="110" r="5" />
            <circle cx="560" cy="58" r="5" />
          </svg>
          <div className="ov-hero-top">
            <div>
              <p className="ov-hero-date">{ukDateLabel.format(now)} · UK time</p>
              <h1>{greeting(now)}{firstName ? `, ${firstName}` : ""}</h1>
              <p className="ov-hero-summary">{summaryParts.join(" · ")}</p>
            </div>
            <div className="ov-hero-actions">
              <Link className="ov-hero-btn primary" to="/admin/jobs/new">
                <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12" /></svg>
                New job
              </Link>
              <Link className="ov-hero-btn" to="/admin/trips">Dispatch</Link>
              <Link className="ov-hero-btn" to="/admin/tracking">Live map</Link>
              <button className="ov-hero-btn ghost" type="button" onClick={() => refetch(false)}>
                <span className="ov-live-dot" aria-hidden="true" />
                {lastSync ? `Updated ${ukTimeLabel.format(lastSync)}` : "Connecting…"}
              </button>
            </div>
          </div>
          <div className="ov-hero-metrics">
            {heroMetricLabels.map((label) => <HeroMetric item={statsByLabel.get(label)} key={label} label={label} />)}
          </div>
        </section>

        <StateNotice loading={loading && !data} error={error} />

        <section className="ov-tiles" aria-label="More metrics">
          {tileMetricLabels.map((label) => <OvMetric item={statsByLabel.get(label)} key={label} label={label} />)}
        </section>

        <div className="ov-charts">
          <OvCard title="Jobs per month" to="/admin/jobs" linkLabel="All jobs">
            <p className="ov-card-sub">{yearJobs} {yearJobs === 1 ? "job" : "jobs"} in the last 12 months</p>
            <div className="ov-legend">
              <span><i style={{ background: SERIES[0] }} />Completed</span>
              <span><i style={{ background: SERIES[1] }} />Not completed</span>
            </div>
            <ColumnChart
              data={trendJobs}
              series={[
                { key: "completed", label: "Completed", color: SERIES[0] },
                { key: "open", label: "Not completed", color: SERIES[1] }
              ]}
              formatAxis={(v) => (Number.isInteger(v) ? String(v) : "")}
              ariaLabel="Jobs per month for the last 12 months, completed and not completed"
            />
          </OvCard>
          <OvCard title="Invoiced revenue" to="/admin/billing" linkLabel="Billing">
            <p className="ov-card-sub">{formatGbp(yearInvoiced)} invoiced in the last 12 months</p>
            <ColumnChart
              data={trend}
              series={[{ key: "invoiced", label: "Invoiced", color: SERIES[0] }]}
              formatValue={(v) => formatGbp(v)}
              formatAxis={(v) => formatGbp(v, true)}
              ariaLabel="Invoiced revenue per month for the last 12 months"
            />
          </OvCard>
        </div>

        <div className="ov-fleet">
          <OvCard title="Live fleet" count={fleetMap.length} to="/admin/tracking" linkLabel="Open live map" className="ov-map-card">
            <FleetMap points={fleetMap} />
          </OvCard>
          <OvCard title="Fleet availability" to="/admin/vehicles" linkLabel="Vehicles" className="ov-availability">
            <StatusMeter
              parts={[
                { label: "Available", value: fleetCounts.available, color: "#0ca30c" },
                { label: "On a job", value: fleetCounts.onJob, color: SERIES[0] },
                { label: "Off road", value: fleetCounts.offRoad, color: "#d03b3b" }
              ]}
            />
            <ul className="ov-truck-list">
              {trackingBoard.slice(0, 5).map((truck) => (
                <li key={truck.truck}>
                  <span className="ov-plate">{truck.truck}</span>
                  <span className="ov-truck-driver">{truck.driver}</span>
                  <OvBadge tone={truck.tone}>{truck.status}</OvBadge>
                </li>
              ))}
            </ul>
          </OvCard>
        </div>

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
