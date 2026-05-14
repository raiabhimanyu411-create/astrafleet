import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createRoute, deleteRoute, getRoutes, updateRoute } from "../../api/adminApi";
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
  const { data, error, loading } = usePanelData("/api/admin/trips");
  const navigate = useNavigate();

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
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
        <button
          className="af-submit-btn"
          type="button"
          onClick={() => navigate("/admin/trips/assign")}
        >
          + Assign new trip
        </button>
      </div>

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
              <span className="card-label">Lane planning</span>
              <h2>Planned and active trips</h2>
            </div>
            <StatusPill tone="neutral">Route desk</StatusPill>
          </div>

          <div className="data-rows">
            {(data?.routes || []).map((item) => (
              <div
                className="data-row"
                key={item.trip}
                onClick={() => item.id && navigate(`/admin/trips/${item.id}`)}
                style={item.id ? { cursor: "pointer" } : {}}
              >
                <div>
                  <strong>{item.trip}</strong>
                  <p>{item.lane}</p>
                </div>
                <div>
                  <span>{item.schedule}</span>
                  <p>{item.vehicle} · {item.trailer}</p>
                </div>
                <StatusPill tone={item.tone}>{item.status}</StatusPill>
                <button className="header-action-button" style={{ height: 28, padding: "0 9px", fontSize: "0.76rem" }} type="button" onClick={(e) => { e.stopPropagation(); navigate(`/admin/trips/${item.id}/edit`); }}>
                  Edit
                </button>
              </div>
            ))}
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
