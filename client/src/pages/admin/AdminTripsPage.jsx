import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createRoute, deleteRoute, getRoutes, updateRoute, updateAdminTripStatus } from "../../api/adminApi";
import { StatCard } from "../../components/StatCard";
import { StateNotice } from "../../components/StateNotice";
import { StatusPill } from "../../components/StatusPill";
import { usePanelData } from "../../hooks/usePanelData";
import { AdminWorkspaceLayout } from "./AdminWorkspaceLayout";

const emptyRoute = {
  route_code: "",
  origin_hub: "",
  destination_hub: "",
  distance_km: "",
  toll_estimate_gbp: "",
  standard_eta_hours: "",
  status: "planned"
};

function exportCsv(name, rows) {
  const csv = rows
    .map(row => row.map(value => `"${String(value ?? "").replaceAll('"', '""')}"`).join(","))
    .join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

function RouteMaster() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState(emptyRoute);
  const [editId, setEditId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState("");

  function loadRoutes() {
    setLoading(true);
    getRoutes()
      .then(r => setData(r.data))
      .catch(() => setError("Routes could not be loaded."))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadRoutes();
  }, []);

  function set(key, value) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  function startEdit(route) {
    setEditId(route.id);
    setForm({
      route_code: route.routeCode,
      origin_hub: route.originHub,
      destination_hub: route.destinationHub,
      distance_km: route.distanceKm || "",
      toll_estimate_gbp: route.tollEstimateGbp || "",
      standard_eta_hours: route.standardEtaHours || "",
      status: route.status || "planned"
    });
  }

  function resetForm() {
    setEditId(null);
    setForm(emptyRoute);
    setSubmitError("");
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitError("");
    setSaving(true);
    try {
      const payload = {
        ...form,
        distance_km: Number(form.distance_km),
        toll_estimate_gbp: form.toll_estimate_gbp ? Number(form.toll_estimate_gbp) : 0,
        standard_eta_hours: form.standard_eta_hours ? Number(form.standard_eta_hours) : 0
      };
      if (editId) {
        await updateRoute(editId, payload);
      } else {
        await createRoute(payload);
      }
      resetForm();
      loadRoutes();
    } catch (err) {
      setSubmitError(err?.response?.data?.message || "Route could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(route) {
    if (!window.confirm(`Delete route ${route.routeCode}?`)) return;
    setSubmitError("");
    try {
      await deleteRoute(route.id);
      loadRoutes();
    } catch (err) {
      setSubmitError(err?.response?.data?.message || "Route could not be deleted.");
    }
  }

  return (
    <section className="content-grid">
      <article className="content-card">
        <div className="section-head">
          <div>
            <span className="card-label">Route master</span>
            <h2>Lane catalogue</h2>
          </div>
          <StatusPill tone="neutral">{loading ? "Loading" : `${data?.routes?.length || 0} routes`}</StatusPill>
        </div>

        {error && (
          <div className="state-card error" style={{ marginBottom: 12 }}>
            <span className="state-dot error" />
            <div><strong>Load error</strong><p>{error}</p></div>
          </div>
        )}

        <div className="data-rows">
          {(data?.routes || []).map(route => (
            <div className="data-row" key={route.id}>
              <div>
                <strong>{route.routeCode}</strong>
                <p>{route.originHub} → {route.destinationHub}</p>
              </div>
              <div>
                <span>{route.distanceKm} km · {route.standardEtaHours}h</span>
                <p>£{Number(route.tollEstimateGbp || 0).toLocaleString("en-GB", { minimumFractionDigits: 2 })} toll · {route.tripCount} trips</p>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
                <StatusPill tone={route.tone}>{route.status}</StatusPill>
                <button className="header-action-button" style={{ height: 28, padding: "0 9px", fontSize: "0.76rem" }} type="button" onClick={() => startEdit(route)}>
                  Edit
                </button>
                <button className="header-action-button danger" style={{ height: 28, padding: "0 9px", fontSize: "0.76rem" }} type="button" onClick={() => handleDelete(route)}>
                  Delete
                </button>
              </div>
            </div>
          ))}
          {!loading && (data?.routes || []).length === 0 && (
            <p style={{ color: "#94a3b8", fontSize: "0.86rem", margin: 0 }}>No routes yet. Add your first lane.</p>
          )}
        </div>
      </article>

      <article className="content-card">
        <div className="section-head">
          <div>
            <span className="card-label">{editId ? "Edit route" : "New route"}</span>
            <h2>{editId ? "Update lane" : "Add lane"}</h2>
          </div>
          {editId && (
            <button className="header-action-button" type="button" onClick={resetForm}>
              New
            </button>
          )}
        </div>

        <form className="af-form" onSubmit={handleSubmit}>
          <div className="af-grid-2">
            <div className="af-field">
              <label className="af-label">Route code</label>
              <input className="af-input" value={form.route_code} onChange={e => set("route_code", e.target.value.toUpperCase())} placeholder="e.g. LON-MAN" required />
            </div>
            <div className="af-field">
              <label className="af-label">Status</label>
              <select className="af-select" value={form.status} onChange={e => set("status", e.target.value)}>
                <option value="draft">Draft</option>
                <option value="planned">Planned</option>
                <option value="approved">Approved</option>
                <option value="active">Active</option>
                <option value="blocked">Blocked</option>
              </select>
            </div>
            <div className="af-field">
              <label className="af-label">Origin hub</label>
              <input className="af-input" value={form.origin_hub} onChange={e => set("origin_hub", e.target.value)} placeholder="e.g. London" required />
            </div>
            <div className="af-field">
              <label className="af-label">Destination hub</label>
              <input className="af-input" value={form.destination_hub} onChange={e => set("destination_hub", e.target.value)} placeholder="e.g. Manchester" required />
            </div>
            <div className="af-field">
              <label className="af-label">Distance (km)</label>
              <input className="af-input" type="number" min="1" value={form.distance_km} onChange={e => set("distance_km", e.target.value)} required />
            </div>
            <div className="af-field">
              <label className="af-label">ETA hours</label>
              <input className="af-input" type="number" min="0" step="0.1" value={form.standard_eta_hours} onChange={e => set("standard_eta_hours", e.target.value)} />
            </div>
            <div className="af-field">
              <label className="af-label">Toll estimate (£)</label>
              <input className="af-input" type="number" min="0" step="0.01" value={form.toll_estimate_gbp} onChange={e => set("toll_estimate_gbp", e.target.value)} />
            </div>
          </div>

          {submitError && (
            <div className="state-card error">
              <span className="state-dot error" />
              <div><strong>Route error</strong><p>{submitError}</p></div>
            </div>
          )}

          <div className="af-actions">
            <button className="af-submit-btn" type="submit" disabled={saving}>
              {saving ? "Saving..." : editId ? "Save route" : "Create route"}
            </button>
          </div>
        </form>
      </article>
    </section>
  );
}

export function AdminTripsPage() {
  const { data, error, loading, refetch } = usePanelData("/api/admin/trips");
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [risk, setRisk] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [actionError, setActionError] = useState("");

  const trips = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (data?.routes || []).filter(trip => {
      if (status && trip.status !== status) return false;
      if (risk === "assignment" && !trip.assignmentGap) return false;
      if (risk === "eta" && !trip.etaRisk) return false;
      if (risk === "blocked" && trip.status !== "blocked") return false;
      if (!query) return true;
      return (
        trip.trip.toLowerCase().includes(query) ||
        trip.lane.toLowerCase().includes(query) ||
        trip.driver.toLowerCase().includes(query) ||
        trip.vehicle.toLowerCase().includes(query) ||
        trip.trailer.toLowerCase().includes(query)
      );
    });
  }, [data, risk, search, status]);

  const hasFilters = Boolean(search || status || risk);

  const visibleStats = useMemo(() => [
    { label: "Visible trips", value: trips.length, description: "After current filters.", change: "Filtered", tone: "neutral" },
    { label: "Open trips", value: trips.filter(trip => !["completed", "blocked"].includes(trip.status)).length, description: "Still moving through dispatch.", change: "Live queue", tone: "warning" },
    { label: "Assignment gaps", value: trips.filter(trip => trip.assignmentGap).length, description: "Missing driver, truck, or trolley.", change: "Fleet desk", tone: "danger" },
    { label: "Visible value", value: `£${trips.reduce((sum, trip) => sum + Number(trip.freightValue || 0), 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, description: "Freight value in view.", change: "GBP", tone: "success" }
  ], [trips]);

  function clearFilters() {
    setSearch("");
    setStatus("");
    setRisk("");
  }

  async function setTripStatus(trip, nextStatus) {
    setActionError("");
    setBusyId(trip.id);
    try {
      await updateAdminTripStatus(trip.id, { status: nextStatus });
      refetch(false);
    } catch (err) {
      setActionError(err?.response?.data?.message || "Trip status could not be updated.");
    } finally {
      setBusyId(null);
    }
  }

  function exportTrips() {
    exportCsv("dispatch-trips.csv", [
      ["Trip", "Lane", "Driver", "Vehicle", "Trolley", "Departure", "ETA", "Priority", "Status", "Freight GBP", "Risk"],
      ...trips.map(trip => [
        trip.trip,
        trip.lane,
        trip.driver,
        trip.vehicle,
        trip.trailer,
        trip.departureRaw,
        trip.etaRaw,
        trip.priority,
        trip.status,
        trip.freightValue,
        [trip.assignmentGap ? "Assignment gap" : "", trip.etaRisk ? "ETA risk" : "", trip.status === "blocked" ? "Blocked" : ""].filter(Boolean).join("; ")
      ])
    ]);
  }

  return (
    <AdminWorkspaceLayout
      badge={data?.header?.badge || "Trip / route planning"}
      title={data?.header?.title || "Dispatch routes and dock scheduling"}
      description={
        data?.header?.description ||
        "Run lane planning, dispatch scheduling, dock windows, and vehicle assignments from one workspace."
      }
      highlights={data?.highlights || []}
    >
      <div className="finance-command-bar">
        <button className="header-action-button" type="button" onClick={() => refetch(false)}>Refresh</button>
        <button className="header-action-button" type="button" onClick={exportTrips}>Export CSV</button>
        <button
          className="af-submit-btn"
          type="button"
          onClick={() => navigate("/admin/trips/assign")}
        >
          + Assign new trip
        </button>
      </div>

      <StateNotice loading={loading} error={error} />

      {actionError && (
        <div className="state-card error" style={{ marginBottom: 16 }}>
          <span className="state-dot error" />
          <div><strong>Action error</strong><p>{actionError}</p></div>
        </div>
      )}

      <section className="stats-grid">
        {(data?.stats || []).map((item) => (
          <StatCard item={item} key={item.label} />
        ))}
      </section>

      <section className="stats-grid inline finance-position-grid">
        {(data?.dispatchHealth || []).map((item) => (
          <StatCard item={item} key={item.label} />
        ))}
      </section>

      <section className="content-grid">
        <article className="content-card">
          <div className="section-head">
            <div>
              <span className="card-label">Dispatch control</span>
              <h2>Visible trip workload</h2>
            </div>
            <StatusPill tone="neutral">Filtered view</StatusPill>
          </div>
          <div className="billing-workflow-grid">
            {visibleStats.map(item => (
              <button className="billing-workflow-tile" key={item.label} type="button" onClick={() => {
                if (item.label === "Assignment gaps") setRisk("assignment");
                if (item.label === "Open trips") setStatus("");
              }}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
                <p>{item.description}</p>
              </button>
            ))}
          </div>
        </article>

        <article className="content-card">
          <div className="section-head">
            <div>
              <span className="card-label">Dispatch exceptions</span>
              <h2>Trips needing action</h2>
            </div>
            <StatusPill tone="warning">Ops review</StatusPill>
          </div>
          <div className="alert-stack">
            {trips.filter(trip => trip.assignmentGap || trip.etaRisk || trip.status === "blocked").slice(0, 6).map(trip => (
              <div className="alert-card" key={trip.id} onClick={() => navigate(`/admin/trips/${trip.id}`)} style={{ cursor: "pointer" }}>
                <div className={`alert-bar ${trip.status === "blocked" || trip.etaRisk ? "danger" : "warning"}`} />
                <div>
                  <strong>{trip.trip}</strong>
                  <p>{trip.status === "blocked" ? "Blocked trip requires resolution." : trip.etaRisk ? `ETA risk on ${trip.lane}.` : "Driver, truck, or trolley assignment is missing."}</p>
                </div>
              </div>
            ))}
            {!loading && trips.filter(trip => trip.assignmentGap || trip.etaRisk || trip.status === "blocked").length === 0 && (
              <p className="finance-empty">No dispatch exceptions right now. Assignment gaps, blocked trips, and ETA risk will appear here.</p>
            )}
          </div>
        </article>
      </section>

      <section className="content-card dispatch-filter-card">
        <input
          className="af-input"
          placeholder="Search trip, lane, driver, truck, or trolley..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select className="af-select" value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="planned">Planned</option>
          <option value="loading">Loading</option>
          <option value="active">Active</option>
          <option value="blocked">Blocked</option>
          <option value="completed">Completed</option>
        </select>
        <select className="af-select" value={risk} onChange={e => setRisk(e.target.value)}>
          <option value="">All risk states</option>
          <option value="assignment">Assignment gaps</option>
          <option value="eta">ETA risk</option>
          <option value="blocked">Blocked trips</option>
        </select>
        <button className="header-action-button" disabled={!hasFilters} type="button" onClick={clearFilters}>Clear filters</button>
      </section>

      <section className="content-grid">
        <article className="content-card">
          <div className="section-head">
            <div>
              <span className="card-label">Lane planning</span>
              <h2>Planned and active trips</h2>
            </div>
            <StatusPill tone="neutral">Route desk</StatusPill>
          </div>

          <div className="data-rows compact finance-list">
            {trips.map((item) => (
              <div
                className="data-row finance-row dispatch-row"
                key={item.trip}
              >
                <button
                  className="finance-row-main dispatch-row-main"
                  type="button"
                  onClick={() => item.id && navigate(`/admin/trips/${item.id}`)}
                >
                  <div>
                    <strong>{item.trip}</strong>
                    <p>{item.lane}</p>
                  </div>
                  <div>
                    <span>{item.freight}</span>
                    <p>{item.priority} · {item.driverJobStatus}</p>
                  </div>
                  <div>
                    <span>{item.driver}</span>
                    <p>{item.vehicle} · {item.trailer}</p>
                  </div>
                  <div>
                    <span>{item.schedule}</span>
                    <p>ETA {item.eta}{item.etaRisk ? " · ETA risk" : ""}</p>
                  </div>
                </button>
                <div className="finance-row-actions">
                  <StatusPill tone={item.tone}>{item.status}</StatusPill>
                  {item.status === "planned" && (
                    <button className="header-action-button" disabled={busyId === item.id} type="button" onClick={() => setTripStatus(item, "loading")}>Load</button>
                  )}
                  {["planned", "loading"].includes(item.status) && (
                    <button className="header-action-button" disabled={busyId === item.id} type="button" onClick={() => setTripStatus(item, "active")}>Start</button>
                  )}
                  {["active", "loading"].includes(item.status) && (
                    <button className="header-action-button" disabled={busyId === item.id} type="button" onClick={() => setTripStatus(item, "completed")}>Complete</button>
                  )}
                  {item.status !== "blocked" && item.status !== "completed" && (
                    <button className="header-action-button danger" disabled={busyId === item.id} type="button" onClick={() => setTripStatus(item, "blocked")}>Block</button>
                  )}
                  <button className="header-action-button" type="button" onClick={() => navigate(`/admin/trips/${item.id}/edit`)}>
                    Edit
                  </button>
                </div>
              </div>
            ))}
            {!loading && trips.length === 0 && (
              <p className="finance-empty">{hasFilters ? "No trips match your filters." : "No dispatch trips yet. Assign the first trip."}</p>
            )}
          </div>
        </article>

        <article className="content-card">
          <div className="section-head">
            <div>
              <span className="card-label">Dock windows</span>
              <h2>Warehouse and yard slots</h2>
            </div>
            <StatusPill tone="warning">Timing watch</StatusPill>
          </div>

          <div className="data-rows">
            {(data?.docks || []).map((item) => (
              <div className="data-row" key={item.trip}>
                <div>
                  <strong>{item.trip}</strong>
                  <p>{item.warehouse}</p>
                </div>
                <div>
                  <span>{item.window}</span>
                  <p>{item.note}</p>
                </div>
                <StatusPill tone={item.tone}>{item.status}</StatusPill>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="content-grid">
        <article className="content-card">
          <div className="section-head">
            <div>
              <span className="card-label">Vehicle assignment</span>
              <h2>Truck and trolley allocation queue</h2>
            </div>
            <StatusPill tone="success">Fleet sync</StatusPill>
          </div>

          <div className="data-rows">
            {(data?.allocations || []).map((item) => (
              <div className="data-row" key={item.vehicle}>
                <div>
                  <strong>{item.vehicle}</strong>
                  <p>{item.trip} · {item.trailer}</p>
                </div>
                <div>
                  <span>{item.driver}</span>
                  <p>{item.note}</p>
                </div>
                <StatusPill tone={item.tone}>{item.status}</StatusPill>
              </div>
            ))}
          </div>
        </article>
      </section>

      <RouteMaster />
    </AdminWorkspaceLayout>
  );
}
