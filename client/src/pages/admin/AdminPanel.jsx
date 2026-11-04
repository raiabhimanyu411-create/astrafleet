import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getRealtimeSocket } from "../../api/realtime";
import { StateNotice } from "../../components/StateNotice";
import { statusTone } from "../../components/StatusChip";
import { usePanelData } from "../../hooks/usePanelData";
import { AdminWorkspaceLayout } from "./AdminWorkspaceLayout";
import "./AdminOverview.css";
import { ColumnChart, FleetMap, formatGbp, SERIES, STATUS_COLORS, StatusMeter } from "./OverviewCharts";
import { firstNameOf, useAuthSession } from "../../utils/authSession";

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

// Only the four numbers people act on every day; everything else lives on its own page.
const kpiLabels = ["Active trips", "Delayed deliveries", "Available vehicles", "Profit / loss"];

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

// Short card subtitles; the full backend description stays in the tooltip.
const kpiHints = {
  "Active trips": "Loading or on the road",
  "Delayed deliveries": "Behind schedule",
  "Available vehicles": "Free and road-legal",
  "Profit / loss": "Paid revenue minus costs"
};

// Shown instead of the hint when an exception card is at zero.
const kpiAllClear = {
  "Delayed deliveries": "All clear, no delays today",
  "Pending invoices": "All invoices paid",
  "Cancelled trips": "Nothing cancelled"
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

// Same status always gets the same colour (see StatusChip); backend tone is only a fallback.
function OvBadge({ tone = "neutral", children }) {
  return <span className={`ov-badge ${statusTone(children, tone || "neutral")}`}>{children}</span>;
}

// "£7,650.00" → "£7,650"; pennies are kept when they are not zero.
function displayValue(value) {
  return typeof value === "string" ? value.replace(/\.00$/, "") : value;
}

function isNegative(value) {
  return Number(String(value ?? "").replace(/[^0-9.-]/g, "")) < 0;
}

function KpiCard({ item, label }) {
  if (!item) return null;
  const route = overviewStatRoutes[label.toLowerCase()] || "/admin/activity";
  const flagged = (attentionLabels.has(label) && !isZero(item.value)) || (label === "Profit / loss" && isNegative(item.value));
  const allClear = kpiAllClear[label] && isZero(item.value);
  const hint = allClear ? kpiAllClear[label] : kpiHints[label] || item.description;
  return (
    <Link
      className={`ov-kpi${flagged ? " flagged" : ""}`}
      to={route}
      title={item.description || undefined}
      aria-label={`${item.label}: ${item.value}. Open details`}
    >
      <span className="ov-kpi-top">
        <span className="ov-kpi-label">{metricDisplayLabels[label] || item.label}</span>
        <span className="ov-kpi-icon"><MetricIcon label={label} /></span>
      </span>
      <strong className="ov-kpi-value">{displayValue(item.value)}</strong>
      {hint && (
        <small className={`ov-kpi-hint${allClear ? " clear" : ""}`}>
          {allClear && <span aria-hidden="true">✓ </span>}
          {hint}
        </small>
      )}
    </Link>
  );
}

function KpiSkeleton() {
  return (
    <div className="ov-kpi ov-skeleton-card" aria-hidden="true">
      <span className="ov-skel" style={{ width: "40%" }} />
      <span className="ov-skel ov-skel-lg" style={{ width: "55%" }} />
      <span className="ov-skel" style={{ width: "70%" }} />
    </div>
  );
}

function CardSkeleton({ rows = 4 }) {
  return (
    <div className="ov-skeleton-rows" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <span className="ov-skel" key={i} style={{ width: `${88 - i * 9}%` }} />
      ))}
    </div>
  );
}

// "MX22KHT · No trailer · No driver" → the parts, with missing ones flagged.
const MISSING_PARTS = new Set(["unassigned truck", "no trailer", "no driver"]);

function DispatchAssets({ text }) {
  const parts = String(text || "").split(" · ").filter(Boolean);
  return (
    <span className="ov-assets">
      {parts.map((part, index) => (
        MISSING_PARTS.has(part.toLowerCase())
          ? <span className="ov-missing" key={`${part}-${index}`}>{part}</span>
          : <span key={`${part}-${index}`}>{part}</span>
      ))}
    </span>
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;

// "25 Apr 2026" → "194 days overdue" / "Due today" / "Due in 3 days".
function dueLabel(due, status) {
  const date = new Date(due);
  if (!due || Number.isNaN(date.getTime())) return due ? `Due ${due}` : "";
  const today = new Date();
  const days = Math.round((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
    - Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) / DAY_MS);
  if (String(status).toLowerCase() === "paid") return `Due ${due}`;
  if (days < 0) return `${-days} ${days === -1 ? "day" : "days"} overdue`;
  if (days === 0) return "Due today";
  return `Due in ${days} ${days === 1 ? "day" : "days"}`;
}

// A name like "Fleet Admin" is a role, not a person; greet without it.
function personalFirstName(name) {
  if (!name || /\badmin(istrator)?\b/i.test(name)) return "";
  return firstNameOf(name);
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

export function AdminPanel() {
  const { data, error, loading, refetch } = usePanelData("/api/admin/overview");
  const [lastSync, setLastSync] = useState(null);
  const [chartView, setChartView] = useState("jobs");
  const statsByLabel = new Map((data?.stats || []).map((item) => [item.label, item]));
  const session = useAuthSession();
  const firstName = personalFirstName(session?.name);
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

  // With little history, 12 mostly empty months read as "no data"; show the last 6 instead.
  const activeMonths = trend.filter((m) => m.jobs || m.invoiced).length;
  const chartMonths = trend.length > 6 && activeMonths <= 3 ? trend.slice(-6) : trend;
  const trendJobs = chartMonths.map((m) => ({ ...m, open: Math.max(0, m.jobs - m.completed) }));
  const yearJobs = chartMonths.reduce((sum, m) => sum + m.jobs, 0);
  const yearInvoiced = chartMonths.reduce((sum, m) => sum + m.invoiced, 0);
  const firstLoad = loading && !data;

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
      title="Overview"
      description="Today across dispatch, fleet and finance."
      highlights={[]}
      hideHeaderIntro
      className="overview-page-shell"
    >
      <div className="ov-page">
        <header className="ov-head">
          <div className="ov-head-text">
            <p className="ov-head-date">{ukDateLabel.format(now)} · UK time</p>
            <h1>{greeting(now)}{firstName ? `, ${firstName}` : ""}</h1>
            <p className="ov-head-summary">{summaryParts.join(" · ")}</p>
          </div>
          <div className="ov-head-actions">
            <button className="ov-sync" type="button" onClick={() => refetch(false)} title="Refresh now">
              <span className="ov-live-dot" aria-hidden="true" />
              {lastSync ? `Updated ${ukTimeLabel.format(lastSync)}` : "Connecting…"}
            </button>
            <Link className="ov-btn" to="/admin/tracking">Live map</Link>
            <Link className="ov-btn" to="/admin/trips">Dispatch</Link>
            <Link className="ov-btn primary" to="/admin/jobs/new">
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12" /></svg>
              New job
            </Link>
          </div>
        </header>

        <StateNotice loading={false} error={error} />

        <section className="ov-kpis" aria-label="Today at a glance" aria-busy={firstLoad}>
          {firstLoad
            ? kpiLabels.map((label) => <KpiSkeleton key={label} />)
            : kpiLabels.map((label) => <KpiCard item={statsByLabel.get(label)} key={label} label={label} />)}
        </section>

        <div className="ov-grid">
          <div className="ov-col">
            <OvCard title="Needs attention" count={alerts.length} to="/admin/alerts">
              {firstLoad ? <CardSkeleton /> : alerts.length ? (
                <>
                  <ul className="ov-attention-list">
                    {alerts.slice(0, 5).map((alert, index) => (
                      <li className={`ov-attention-item ${alert.tone || "warning"}`} key={`${alert.title}-${index}`}>
                        <span className="ov-attention-icon"><AttentionIcon tone={alert.tone} /></span>
                        <div className="ov-attention-text">
                          <strong>{alert.title}</strong>
                          <p title={alert.description}>{alert.description}</p>
                        </div>
                        <Link className="ov-row-action" to="/admin/alerts">Review</Link>
                      </li>
                    ))}
                  </ul>
                  {alerts.length > 5 && (
                    <Link className="ov-more" to="/admin/alerts">+{alerts.length - 5} more</Link>
                  )}
                </>
              ) : (
                <OvEmpty>All clear. Nothing needs action right now ✓</OvEmpty>
              )}
            </OvCard>

            <OvCard title="Dispatch" count={tripPlans.length} to="/admin/trips">
              {firstLoad ? <CardSkeleton rows={3} /> : tripPlans.length ? (
                <div className="ov-table-shell">
                  <table className="ov-table ov-dispatch-table">
                    <thead>
                      <tr><th>Route</th><th>Vehicle · trailer · driver</th><th>Date</th><th>Status</th></tr>
                    </thead>
                    <tbody>
                      {tripPlans.slice(0, 5).map((trip) => (
                        <tr key={trip.id || trip.route}>
                          <td className="ov-strong">{trip.route}</td>
                          <td className="ov-muted-cell"><DispatchAssets text={trip.vehicle} /></td>
                          <td className="ov-nowrap">{trip.schedule}</td>
                          <td><OvBadge tone={trip.tone}>{trip.status}</OvBadge></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <OvEmpty>No open trips in the dispatch queue.</OvEmpty>
              )}
            </OvCard>

            <section className="ov-card">
              <header className="ov-card-head">
                <div>
                  <h2>Last {chartMonths.length} months</h2>
                  <p className="ov-card-sub">
                    {chartView === "jobs"
                      ? `${yearJobs} ${yearJobs === 1 ? "job" : "jobs"} booked`
                      : `${formatGbp(yearInvoiced)} invoiced`}
                  </p>
                </div>
                <div className="ov-segment" role="tablist" aria-label="Chart">
                  <button type="button" role="tab" aria-selected={chartView === "jobs"} className={chartView === "jobs" ? "active" : ""} onClick={() => setChartView("jobs")}>Jobs</button>
                  <button type="button" role="tab" aria-selected={chartView === "revenue"} className={chartView === "revenue" ? "active" : ""} onClick={() => setChartView("revenue")}>Revenue</button>
                </div>
              </header>
              {chartView === "jobs" ? (
                <>
                  <div className="ov-legend">
                    <span><i style={{ background: STATUS_COLORS.success }} />Completed</span>
                    <span><i style={{ background: STATUS_COLORS.neutral }} />Open or cancelled</span>
                  </div>
                  <ColumnChart
                    data={trendJobs}
                    height={200}
                    series={[
                      { key: "completed", label: "Completed", color: STATUS_COLORS.success },
                      { key: "open", label: "Open or cancelled", color: STATUS_COLORS.neutral }
                    ]}
                    formatAxis={(v) => (Number.isInteger(v) ? String(v) : "")}
                    ariaLabel={`Jobs per month for the last ${chartMonths.length} months, completed and open or cancelled`}
                  />
                </>
              ) : (
                <ColumnChart
                  data={chartMonths}
                  height={200}
                  series={[{ key: "invoiced", label: "Invoiced", color: SERIES[0] }]}
                  formatValue={(v) => formatGbp(v)}
                  formatAxis={(v) => formatGbp(v, true)}
                  ariaLabel={`Invoiced revenue per month for the last ${chartMonths.length} months`}
                />
              )}
            </section>
          </div>

          <div className="ov-col">
            <OvCard title="Fleet" count={trackingBoard.length} to="/admin/tracking" linkLabel="Live map" className="ov-fleet-card">
              <StatusMeter
                parts={[
                  { label: "Available", value: fleetCounts.available, color: STATUS_COLORS.success },
                  { label: "On a job", value: fleetCounts.onJob, color: STATUS_COLORS.info },
                  { label: "Off road", value: fleetCounts.offRoad, color: STATUS_COLORS.danger }
                ]}
              />
              <FleetMap points={fleetMap} />
              <ul className="ov-truck-list">
                {trackingBoard.slice(0, 4).map((truck) => (
                  <li key={truck.truck}>
                    <span className="ov-plate">{truck.truck}</span>
                    <span className="ov-truck-driver">
                      <span className={truck.driver === "Unassigned" ? "ov-faint" : ""}>{truck.driver === "Unassigned" ? "No driver" : truck.driver}</span>
                      {truck.location && truck.location !== "No ping" && <small title={truck.location}>{truck.location}</small>}
                    </span>
                    <OvBadge tone={truck.tone}>{truck.status}</OvBadge>
                  </li>
                ))}
              </ul>
            </OvCard>

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
                !loading && <OvEmpty>All drivers are compliant ✓</OvEmpty>
              )}
            </OvCard>

            <OvCard title="Unpaid invoices" count={invoices.length} to="/admin/finance">
              {invoices.length ? (
                <ul className="ov-list">
                  {invoices.slice(0, 4).map((invoice) => (
                    <li key={invoice.invoice}>
                      <div>
                        <strong>{invoice.client}</strong>
                        <small>
                          {invoice.invoice} ·{" "}
                          <span className={dueLabel(invoice.due, invoice.status).includes("overdue") ? "ov-overdue" : ""}>
                            {dueLabel(invoice.due, invoice.status)}
                          </span>
                        </small>
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

            {pendingEmployees.length > 0 && (
              <OvCard title="Employee approvals" count={pendingEmployees.length} to="/admin/employees" linkLabel="Manage">
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
              </OvCard>
            )}
          </div>
        </div>

      </div>
    </AdminWorkspaceLayout>
  );
}
