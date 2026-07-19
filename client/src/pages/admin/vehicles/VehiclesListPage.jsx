import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createTrolley, deleteVehicle, deleteTrolley, getVehicles, updateVehicleInline } from "../../../api/vehicleApi";
import { StateNotice } from "../../../components/StateNotice";
import { StatusPill } from "../../../components/StatusPill";
import { AdminWorkspaceLayout } from "../AdminWorkspaceLayout";

const STATUS_OPTIONS = [
  { value: "", label: "All Statuses" },
  { value: "available", label: "Available" },
  { value: "planned", label: "Planned" },
  { value: "in_transit", label: "In Transit" },
  { value: "maintenance", label: "Maintenance" },
  { value: "stopped", label: "Stopped" }
];

const TYPE_OPTIONS = [
  { value: "", label: "All Types" },
  { value: "Rigid HGV", label: "Rigid HGV" },
  { value: "Articulated HGV", label: "Articulated HGV" },
  { value: "Curtainsider", label: "Curtainsider" },
  { value: "Flatbed", label: "Flatbed" },
  { value: "Refrigerated", label: "Refrigerated" },
  { value: "Box Van", label: "Box Van" },
  { value: "Tipper", label: "Tipper" },
  { value: "Tanker", label: "Tanker" },
  { value: "Other", label: "Other" }
];

const TROLLEY_TYPES = ["Curtain side", "Box", "Flatbed", "Refrigerated", "Low loader", "Tanker", "Other"];

function ComplianceDateCell({ lastDone, nextDue, tone = "neutral", source = "Maintenance synced" }) {
  const hasCompletedRecord = Boolean(lastDone && lastDone !== "—");
  return (
    <div className="vehicle-compliance-date">
      <div className={`vehicle-compliance-line done${hasCompletedRecord ? "" : " empty"}`}>
        <span>Done</span>
        <strong>{hasCompletedRecord ? lastDone : "No record"}</strong>
      </div>
      <div className={`vehicle-compliance-line due ${tone}`}>
        <span>Next due</span>
        <strong>{nextDue || "—"}</strong>
      </div>
      <small>{source}</small>
    </div>
  );
}

function TrolleyModal({ onClose, onSaved }) {
  const [fields, setFields] = useState({
    registration_number: "",
    trailer_code: "",
    trailer_type: "Curtain side",
    capacity_tonnes: "",
    status: "available"
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function set(key, value) {
    setError("");
    setFields(prev => ({ ...prev, [key]: value }));
  }

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      await createTrolley(fields);
      await onSaved();
      onClose();
    } catch (err) {
      setError(err?.response?.data?.message || "Could not add trailer.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="maintenance-modal-backdrop">
      <form className="maintenance-modal" onSubmit={submit}>
        <div className="section-head">
          <div>
            <span className="card-label">Fleet Asset</span>
            <h2>Add Trailer</h2>
          </div>
          <button className="header-action-button" type="button" onClick={onClose}>Close</button>
        </div>
        <div className="af-grid-2">
          <div className="af-field">
            <label className="af-label">Registration Number <span style={{ color: "#dc2626" }}>*</span></label>
            <input className="af-input" type="text" placeholder="e.g. TR12 ABC" value={fields.registration_number} onChange={e => set("registration_number", e.target.value.toUpperCase())} required />
          </div>
          <div className="af-field">
            <label className="af-label">Trailer Code</label>
            <input className="af-input" type="text" placeholder="Auto if blank" value={fields.trailer_code} onChange={e => set("trailer_code", e.target.value)} />
          </div>
          <div className="af-field">
            <label className="af-label">Trailer Type</label>
            <select className="af-select" value={fields.trailer_type} onChange={e => set("trailer_type", e.target.value)}>
              {TROLLEY_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
            </select>
          </div>
          <div className="af-field">
            <label className="af-label">Capacity (Tonnes)</label>
            <input className="af-input" type="number" min="0" step="0.01" value={fields.capacity_tonnes} onChange={e => set("capacity_tonnes", e.target.value)} />
          </div>
          <div className="af-field">
            <label className="af-label">Status</label>
            <select className="af-select" value={fields.status} onChange={e => set("status", e.target.value)}>
              <option value="available">Available</option>
              <option value="planned">Planned</option>
              <option value="in_use">In use</option>
              <option value="maintenance">Maintenance</option>
            </select>
          </div>
        </div>
        {error && <p className="state-card error" style={{ marginTop: 14 }}>{error}</p>}
        <div className="af-actions">
          <button className="header-action-button" type="button" onClick={onClose}>Cancel</button>
          <button className="af-submit-btn" type="submit" disabled={saving}>{saving ? "Saving..." : "Add Trailer →"}</button>
        </div>
      </form>
    </div>
  );
}

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

export function VehiclesListPage() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterType, setFilterType] = useState("");
  const [riskFilter, setRiskFilter] = useState("");
  const [view, setView] = useState("fleet");
  const [assetTab, setAssetTab] = useState("vehicles");
  const [savingCell, setSavingCell] = useState("");
  const [showTrolleyModal, setShowTrolleyModal] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  function load() {
    setLoading(true);
    return getVehicles()
      .then(r => {
        setData(r.data);
        setError("");
      })
      .catch(() => setError("Could not load vehicles. Please refresh."))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  const vehicles = useMemo(() => {
    return (data?.vehicles || []).filter(v => {
      if (filterStatus && v.status !== filterStatus) return false;
      if (filterType && v.truckType !== filterType) return false;
      if (riskFilter === "compliance" && !v.complianceRisk) return false;
      if (riskFilter === "defects" && Number(v.openDefects || 0) === 0) return false;
      if (riskFilter === "service" && !["danger", "warning"].includes(v.nextServiceTone)) return false;
      if (riskFilter === "open_trips" && Number(v.openTrips || 0) === 0) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          v.registrationNumber.toLowerCase().includes(q) ||
          v.fleetCode.toLowerCase().includes(q) ||
          (v.make || "").toLowerCase().includes(q) ||
          (v.model || "").toLowerCase().includes(q) ||
          v.modelName.toLowerCase().includes(q) ||
          v.truckType.toLowerCase().includes(q) ||
          (v.currentLocation || "").toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [data, filterStatus, filterType, riskFilter, search]);

  const hasFilters = Boolean(search || filterStatus || filterType || riskFilter);

  const quickFilters = useMemo(() => {
    const rows = data?.vehicles || [];
    return [
      { key: "available", label: "Available", value: rows.filter(v => v.status === "available").length },
      { key: "on_job", label: "On Job", value: rows.filter(v => Number(v.openTrips || 0) > 0 || ["planned", "in_transit"].includes(v.status)).length },
      { key: "maintenance", label: "Maintenance", value: rows.filter(v => ["maintenance", "stopped"].includes(v.status)).length },
      { key: "compliance", label: "Compliance Risk", value: rows.filter(v => v.complianceRisk).length }
    ];
  }, [data]);

  function clearFilters() {
    setSearch("");
    setFilterStatus("");
    setFilterType("");
    setRiskFilter("");
  }

  function applyQuickFilter(key) {
    setFilterStatus("");
    setRiskFilter("");
    if (key === "available") setFilterStatus("available");
    if (key === "on_job") setRiskFilter("open_trips");
    if (key === "maintenance") setFilterStatus("maintenance");
    if (key === "compliance") {
      setRiskFilter("compliance");
      setView("compliance");
    }
  }

  async function updateCell(vehicle, field, value) {
    const key = `${vehicle.id}-${field}`;
    setError("");
    setSavingCell(key);
    try {
      await updateVehicleInline(vehicle.id, { [field]: value });
      await load();
    } catch (err) {
      setError(err?.response?.data?.message || "Vehicle could not be updated.");
    } finally {
      setSavingCell("");
    }
  }

  function saveOnBlur(vehicle, field, oldValue) {
    return e => {
      const nextValue = e.target.value;
      if (String(oldValue ?? "") !== String(nextValue ?? "")) {
        updateCell(vehicle, field, nextValue);
      }
    };
  }

  async function handleDeleteVehicle(vehicle) {
    if (!window.confirm(`Delete "${vehicle.registrationNumber}"? This action cannot be undone.`)) return;
    setDeletingId(vehicle.id);
    setError("");
    try {
      await deleteVehicle(vehicle.id);
      await load();
    } catch (err) {
      setError(err?.response?.data?.message || "Vehicle could not be deleted. Please try again.");
    } finally {
      setDeletingId(null);
    }
  }

  async function handleDeleteTrolley(trailer) {
    if (!window.confirm(`Delete trailer "${trailer.registrationNumber}"? This action cannot be undone.`)) return;
    setDeletingId(trailer.id);
    setError("");
    try {
      await deleteTrolley(trailer.id);
      await load();
    } catch (err) {
      setError(err?.response?.data?.message || "Trailer could not be deleted. Please try again.");
    } finally {
      setDeletingId(null);
    }
  }

  function dateClass(tone) {
    return ["danger", "warning"].includes(tone) ? tone : "";
  }

  function exportVehicles() {
    exportCsv("vehicles-register.csv", [
      ["Registration", "Fleet code", "Make", "Model", "Type", "Status", "Location", "MOT", "Insurance", "Road tax", "Next service", "Trips", "Open trips", "Open defects"],
      ...vehicles.map(v => [
        v.registrationNumber,
        v.fleetCode,
        v.make,
        v.model,
        v.truckType,
        v.status,
        v.currentLocation,
        v.motExpiry,
        v.insuranceExpiry,
        v.roadTaxExpiry,
        v.nextServiceDue,
        v.totalTrips,
        v.openTrips,
        v.openDefects
      ])
    ]);
  }

  return (
    <AdminWorkspaceLayout
      badge="Fleet management"
      title="Vehicles"
      description="Manage fleet availability, compliance, roadworthiness, maintenance, and dispatch readiness."
      highlights={[]}
      className="vehicles-page-shell"
    >
      <div className="finance-command-bar">
        <button className="header-action-button" type="button" onClick={load}>Refresh</button>
        {assetTab === "vehicles" && (
          <button className="header-action-button" type="button" onClick={exportVehicles}>Export CSV</button>
        )}
        <button className="header-action-button" type="button" onClick={() => setShowTrolleyModal(true)}>+ Add Trailer</button>
        <button className="af-submit-btn" type="button" onClick={() => navigate("/admin/vehicles/new")}>+ Add Vehicle</button>
      </div>

      <section className="vehicle-tabs" aria-label="Asset type">
        <button className={assetTab === "vehicles" ? "active" : ""} type="button" onClick={() => setAssetTab("vehicles")}>
          Vehicles ({(data?.vehicles || []).length})
        </button>
        <button className={assetTab === "trailers" ? "active" : ""} type="button" onClick={() => setAssetTab("trailers")}>
          Trailers ({(data?.trailers || []).length})
        </button>
      </section>

      {showTrolleyModal && (
        <TrolleyModal onClose={() => setShowTrolleyModal(false)} onSaved={load} />
      )}

      <StateNotice loading={loading} error={error} />

      {assetTab === "vehicles" && (
      <section className="vehicle-control-strip">
        <div className="vehicle-quick-strip">
          {quickFilters.map(item => (
            <button
              className={(
                (item.key === "available" && filterStatus === "available") ||
                (item.key === "on_job" && riskFilter === "open_trips") ||
                (item.key === "maintenance" && filterStatus === "maintenance") ||
                (item.key === "compliance" && riskFilter === "compliance")
              ) ? "active" : ""}
              key={item.key}
              type="button"
              onClick={() => applyQuickFilter(item.key)}
            >
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </button>
          ))}
        </div>
        <div className="vehicle-filter-card">
        <input
          className="af-input"
          type="text"
          placeholder="Search Reg, Fleet Code, Make, Model, Type, Or Location..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select className="af-select" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select className="af-select" value={filterType} onChange={e => setFilterType(e.target.value)}>
          {TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select className="af-select" value={riskFilter} onChange={e => setRiskFilter(e.target.value)}>
          <option value="">All Risk States</option>
          <option value="compliance">Compliance Risk</option>
          <option value="defects">Open Defects</option>
          <option value="service">Service Due Soon</option>
          <option value="open_trips">Open Trips</option>
        </select>
        <button className="header-action-button" disabled={!hasFilters} type="button" onClick={clearFilters}>Clear Filters</button>
        </div>
      </section>
      )}

      {assetTab === "vehicles" && (
        <section className="vehicle-tabs" aria-label="Vehicle views">
          {[
            ["fleet", "Fleet List"],
            ["compliance", "Compliance"],
            ["workshop", "Workshop"]
          ].map(([key, label]) => (
            <button className={view === key ? "active" : ""} key={key} type="button" onClick={() => setView(key)}>
              {label}
            </button>
          ))}
        </section>
      )}

      {assetTab === "vehicles" && (
      <section className="vehicle-register-card">
        <div className="section-head">
          <div>
            <span className="card-label">Fleet Register</span>
            <h2>{view === "fleet" ? "Fleet List" : view === "compliance" ? "Compliance Dates" : "Workshop View"}</h2>
          </div>
          <div className="vehicle-register-status">
            {savingCell && <span className="vehicle-inline-saving">Saving changes…</span>}
            <StatusPill tone={vehicles.length ? "success" : "neutral"}>{vehicles.length} visible</StatusPill>
          </div>
        </div>

        <div className="vehicle-table-shell">
          <table className={`vehicle-edit-table ${view}`}>
            <thead>
              {view === "fleet" && (
              <tr>
                <th>Registration</th>
                <th>Fleet Code</th>
                <th>Vehicle</th>
                <th>Type</th>
                <th>Status</th>
                <th>Location</th>
                <th>Service</th>
                <th>Trips</th>
                <th>Defects</th>
                <th>Actions</th>
              </tr>
              )}
              {view === "compliance" && (
              <tr>
                <th>Registration</th>
                <th>Fleet Code</th>
                <th>Vehicle</th>
                <th>MOT</th>
                <th>Insurance</th>
                <th>Road Tax</th>
                <th>Permit</th>
                <th>Pollution</th>
                <th>Fitness</th>
                <th>Risk</th>
                <th>Actions</th>
              </tr>
              )}
              {view === "workshop" && (
              <tr>
                <th>Registration</th>
                <th>Fleet Code</th>
                <th>Vehicle</th>
                <th>Status</th>
                <th>Location</th>
                <th>Odometer</th>
                <th>Next Service</th>
                <th>Open Defects</th>
                <th>Trips</th>
                <th>Last Activity</th>
                <th>Actions</th>
              </tr>
              )}
            </thead>
            <tbody>
              {vehicles.map(v => (
                <tr key={v.id}>
                  {view === "fleet" && (
                  <>
                  <td>
                    <input className="vehicle-table-input strong" defaultValue={v.registrationNumber || ""} onBlur={saveOnBlur(v, "registrationNumber", v.registrationNumber)} />
                  </td>
                  <td>
                    <input className="vehicle-table-input code" defaultValue={v.fleetCode || ""} onBlur={saveOnBlur(v, "fleetCode", v.fleetCode)} />
                  </td>
                  <td>
                    <div className="vehicle-name-edit">
                      <input className="vehicle-table-input" aria-label="Vehicle make" defaultValue={v.make === "—" ? "" : v.make || ""} placeholder="Make" onBlur={saveOnBlur(v, "make", v.make === "—" ? "" : v.make)} />
                      <input className="vehicle-table-input" aria-label="Vehicle model" defaultValue={v.model === "—" ? "" : v.model || ""} placeholder="Model" onBlur={saveOnBlur(v, "model", v.model === "—" ? "" : v.model)} />
                    </div>
                    <small>{v.fuelType === "—" ? "Fuel not set" : v.fuelType} · {v.capacityTonnes === "—" ? "capacity not set" : `${v.capacityTonnes}t`}</small>
                  </td>
                  <td>
                    <select className="vehicle-table-select" value={v.truckType || ""} disabled={savingCell === `${v.id}-truckType`} onChange={e => updateCell(v, "truckType", e.target.value)}>
                      {TYPE_OPTIONS.filter(o => o.value).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </td>
                  <td>
                    <select className="vehicle-table-select" value={v.status || "available"} disabled={savingCell === `${v.id}-status`} onChange={e => updateCell(v, "status", e.target.value)}>
                      {STATUS_OPTIONS.filter(o => o.value).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </td>
                  <td>
                    <input className="vehicle-table-input" defaultValue={v.currentLocation === "—" ? "" : v.currentLocation || ""} onBlur={saveOnBlur(v, "currentLocation", v.currentLocation === "—" ? "" : v.currentLocation)} />
                  </td>
                  <td>
                    <input className={`vehicle-table-input date ${dateClass(v.nextServiceTone)}`} type="date" defaultValue={v.nextServiceDueRaw || ""} onBlur={saveOnBlur(v, "nextServiceDue", v.nextServiceDueRaw || "")} />
                    <small>{v.nextServiceDue}</small>
                  </td>
                  <td>
                    <strong>{v.totalTrips}</strong>
                    <small>{v.openTrips} open</small>
                  </td>
                  <td>
                    <StatusPill tone={v.openDefects > 0 ? (v.criticalDefects > 0 ? "danger" : "warning") : "success"}>
                      {v.openDefects} open
                    </StatusPill>
                    <small>{v.criticalDefects} critical</small>
                  </td>
                  <td>
                    <div className="vehicle-table-actions">
                      <button className="header-action-button" type="button" onClick={() => navigate(`/admin/vehicles/${v.id}`)}>Open</button>
                      <button className="header-action-button" type="button" onClick={() => navigate(`/admin/vehicles/${v.id}/edit`)}>Edit</button>
                      <button className="header-action-button danger" type="button" disabled={deletingId === v.id} onClick={() => handleDeleteVehicle(v)}>
                        {deletingId === v.id ? "Deleting..." : "Delete"}
                      </button>
                    </div>
                  </td>
                  </>
                  )}

                  {view === "compliance" && (
                  <>
                  <td>
                    <input className="vehicle-table-input strong" defaultValue={v.registrationNumber || ""} onBlur={saveOnBlur(v, "registrationNumber", v.registrationNumber)} />
                  </td>
                  <td>
                    <input className="vehicle-table-input code" defaultValue={v.fleetCode || ""} onBlur={saveOnBlur(v, "fleetCode", v.fleetCode)} />
                  </td>
                  <td>
                    <strong>{v.make} {v.model}</strong>
                    <small>{v.truckType}</small>
                  </td>
                  <td>
                    <ComplianceDateCell lastDone={v.motLastDone} nextDue={v.motExpiry} tone={v.motExpiryTone} />
                  </td>
                  <td>
                    <ComplianceDateCell lastDone={v.insuranceLastDone} nextDue={v.insuranceExpiry} tone={v.insuranceExpiryTone} />
                  </td>
                  <td>
                    <ComplianceDateCell lastDone={v.roadTaxLastDone} nextDue={v.roadTaxExpiry} tone={v.roadTaxExpiryTone} />
                  </td>
                  <td>
                    <input className={`vehicle-table-input date ${dateClass(v.permitExpiryTone)}`} type="date" defaultValue={v.permitExpiryRaw || ""} onBlur={saveOnBlur(v, "permitExpiry", v.permitExpiryRaw || "")} />
                    <small>{v.permitExpiry}</small>
                  </td>
                  <td>
                    <input className={`vehicle-table-input date ${dateClass(v.pollutionExpiryTone)}`} type="date" defaultValue={v.pollutionExpiryRaw || ""} onBlur={saveOnBlur(v, "pollutionExpiry", v.pollutionExpiryRaw || "")} />
                    <small>{v.pollutionExpiry}</small>
                  </td>
                  <td>
                    <input className={`vehicle-table-input date ${dateClass(v.fitnessExpiryTone)}`} type="date" defaultValue={v.fitnessExpiryRaw || ""} onBlur={saveOnBlur(v, "fitnessExpiry", v.fitnessExpiryRaw || "")} />
                    <small>{v.fitnessExpiry}</small>
                  </td>
                  <td>
                    <StatusPill tone={v.complianceRisk ? "warning" : "success"}>{v.complianceRisk ? "Review" : "Clear"}</StatusPill>
                  </td>
                  <td>
                    <div className="vehicle-table-actions">
                      <button className="header-action-button" type="button" onClick={() => navigate(`/admin/vehicles/${v.id}`)}>Open</button>
                      <button className="header-action-button" type="button" onClick={() => navigate(`/admin/vehicles/${v.id}/edit`)}>Edit</button>
                      <button className="header-action-button danger" type="button" disabled={deletingId === v.id} onClick={() => handleDeleteVehicle(v)}>
                        {deletingId === v.id ? "Deleting..." : "Delete"}
                      </button>
                    </div>
                  </td>
                  </>
                  )}

                  {view === "workshop" && (
                  <>
                  <td>
                    <input className="vehicle-table-input strong" defaultValue={v.registrationNumber || ""} onBlur={saveOnBlur(v, "registrationNumber", v.registrationNumber)} />
                  </td>
                  <td>
                    <input className="vehicle-table-input code" defaultValue={v.fleetCode || ""} onBlur={saveOnBlur(v, "fleetCode", v.fleetCode)} />
                  </td>
                  <td>
                    <div className="vehicle-name-edit">
                      <input className="vehicle-table-input" aria-label="Vehicle make" defaultValue={v.make === "—" ? "" : v.make || ""} placeholder="Make" onBlur={saveOnBlur(v, "make", v.make === "—" ? "" : v.make)} />
                      <input className="vehicle-table-input" aria-label="Vehicle model" defaultValue={v.model === "—" ? "" : v.model || ""} placeholder="Model" onBlur={saveOnBlur(v, "model", v.model === "—" ? "" : v.model)} />
                    </div>
                    <small>{v.truckType}</small>
                  </td>
                  <td>
                    <select className="vehicle-table-select" value={v.status || "available"} disabled={savingCell === `${v.id}-status`} onChange={e => updateCell(v, "status", e.target.value)}>
                      {STATUS_OPTIONS.filter(o => o.value).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </td>
                  <td>
                    <input className="vehicle-table-input" defaultValue={v.currentLocation === "—" ? "" : v.currentLocation || ""} onBlur={saveOnBlur(v, "currentLocation", v.currentLocation === "—" ? "" : v.currentLocation)} />
                  </td>
                  <td>
                    <input className="vehicle-table-input number" type="number" step="1" defaultValue={v.odometerReadingRaw || ""} onBlur={saveOnBlur(v, "odometerReading", v.odometerReadingRaw || "")} />
                    <small>km</small>
                  </td>
                  <td>
                    <input className={`vehicle-table-input date ${dateClass(v.nextServiceTone)}`} type="date" defaultValue={v.nextServiceDueRaw || ""} onBlur={saveOnBlur(v, "nextServiceDue", v.nextServiceDueRaw || "")} />
                    <small>{v.nextServiceDue}</small>
                  </td>
                  <td>
                    <StatusPill tone={v.openDefects > 0 ? (v.criticalDefects > 0 ? "danger" : "warning") : "success"}>
                      {v.openDefects} open
                    </StatusPill>
                    <small>{v.criticalDefects} critical</small>
                  </td>
                  <td>
                    <strong>{v.totalTrips}</strong>
                    <small>{v.openTrips} open</small>
                  </td>
                  <td>
                    <strong>{v.lastActivity}</strong>
                  </td>
                  <td>
                    <div className="vehicle-table-actions">
                      <button className="header-action-button" type="button" onClick={() => navigate(`/admin/vehicles/${v.id}`)}>Open</button>
                      <button className="header-action-button" type="button" onClick={() => navigate(`/admin/vehicles/${v.id}/edit`)}>Edit</button>
                      <button className="header-action-button danger" type="button" disabled={deletingId === v.id} onClick={() => handleDeleteVehicle(v)}>
                        {deletingId === v.id ? "Deleting..." : "Delete"}
                      </button>
                    </div>
                  </td>
                  </>
                  )}
                </tr>
              ))}
              {!loading && vehicles.length === 0 && (
                <tr>
                  <td colSpan={view === "fleet" ? 10 : 11}>
                    <p className="finance-empty">{hasFilters ? "No vehicles match your filters." : "No vehicles yet. Add your first vehicle."}</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      )}

      {assetTab === "trailers" && (
      <section className="vehicle-register-card">
        <div className="section-head">
          <div>
            <span className="card-label">Trailer Register</span>
            <h2>Trailers List</h2>
          </div>
          <StatusPill tone={(data?.trailers || []).length ? "success" : "neutral"}>{(data?.trailers || []).length} trailers</StatusPill>
        </div>
        <div className="vehicle-table-shell">
          <table className="vehicle-edit-table fleet">
            <thead>
              <tr>
                <th>Registration</th>
                <th>Trailer Code</th>
                <th>Type</th>
                <th>Capacity</th>
                <th>Status</th>
                <th>Location</th>
                <th>Added</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {(data?.trailers || []).map(t => (
                <tr key={t.id}>
                  <td><strong>{t.registrationNumber}</strong></td>
                  <td><span className="vehicle-table-input code" style={{ display: "block" }}>{t.trailerCode}</span></td>
                  <td>{t.trailerType}</td>
                  <td>{t.capacityTonnes === "—" ? "—" : `${t.capacityTonnes}t`}</td>
                  <td>
                    <StatusPill tone={t.status === "available" ? "success" : t.status === "maintenance" ? "danger" : "neutral"}>
                      {t.status}
                    </StatusPill>
                  </td>
                  <td>{t.currentLocation}</td>
                  <td>{t.since}</td>
                  <td>
                    <div className="vehicle-table-actions">
                      <button className="header-action-button danger" type="button" disabled={deletingId === t.id} onClick={() => handleDeleteTrolley(t)}>
                        {deletingId === t.id ? "Deleting..." : "Delete"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && (data?.trailers || []).length === 0 && (
                <tr>
                  <td colSpan={8}>
                    <p className="finance-empty">No trailers yet. Use "Add Trailer" above to add one.</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      )}
    </AdminWorkspaceLayout>
  );
}
