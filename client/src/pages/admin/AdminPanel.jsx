import { useEffect } from "react";
import { Link } from "react-router-dom";
import { getRealtimeSocket } from "../../api/realtime";
import { StatCard } from "../../components/StatCard";
import { StateNotice } from "../../components/StateNotice";
import { StatusPill } from "../../components/StatusPill";
import { usePanelData } from "../../hooks/usePanelData";
import { AdminWorkspaceLayout } from "./AdminWorkspaceLayout";

const moduleLinks = {
  "Driver Management": "/admin/drivers",
  "Finance Management": "/admin/finance",
  "Trip / Route Planning": "/admin/trips",
  "Vehicle Management": "/admin/vehicles",
  "Invoicing & Billing": "/admin/billing",
  "GPS / Live Tracking": "/admin/tracking",
  "Control Room Alerts": "/admin/alerts"
};

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

      <section className="stats-grid">
        {(data?.stats || []).map((item) => (
          <StatCard item={item} key={item.label} />
        ))}
      </section>

      <section className="content-grid">
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
