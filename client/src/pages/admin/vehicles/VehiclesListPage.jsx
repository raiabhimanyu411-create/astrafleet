import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getVehicles, updateVehicleStatus } from "../../../api/vehicleApi";
import { StatCard } from "../../../components/StatCard";
import { StateNotice } from "../../../components/StateNotice";
import { StatusPill } from "../../../components/StatusPill";
import { AdminWorkspaceLayout } from "../AdminWorkspaceLayout";

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "available", label: "Available" },
  { value: "planned", label: "Planned" },
  { value: "in_transit", label: "In transit" },
  { value: "maintenance", label: "Maintenance" },
  { value: "stopped", label: "Stopped" }
];

const TYPE_OPTIONS = [
  { value: "", label: "All types" },
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

function ExpiryBadge({ label, tone }) {
  return <StatusPill tone={tone}>{label}</StatusPill>;
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
  const [busyId, setBusyId] = useState(null);

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
          v.modelName.toLowerCase().includes(q) ||
          v.truckType.toLowerCase().includes(q) ||
          (v.currentLocation || "").toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [data, filterStatus, filterType, riskFilter, search]);

  const visibleStats = useMemo(() => [
    { label: "Visible vehicles", value: vehicles.length, description: "After current filters.", change: "Filtered", tone: "neutral" },
    { label: "Ready assets", value: vehicles.filter(v => v.status === "available" && !v.complianceRisk).length, description: "Available with no visible risk.", change: "Assignable", tone: "success" },
    { label: "Needs workshop", value: vehicles.filter(v => ["maintenance", "stopped"].includes(v.status) || v.openDefects > 0).length, description: "Stopped, maintenance, or defects.", change: "Workshop", tone: "danger" },
    { label: "Open trips", value: vehicles.reduce((sum, v) => sum + Number(v.openTrips || 0), 0), description: "Planned/loading/active trips.", change: "Dispatch", tone: "warning" }
  ], [vehicles]);

  const hasFilters = Boolean(search || filterStatus || filterType || riskFilter);

  function clearFilters() {
    setSearch("");
    setFilterStatus("");
    setFilterType("");
    setRiskFilter("");
  }

  async function setStatus(vehicle, status) {
    setError("");
    setBusyId(vehicle.id);
    try {
      await updateVehicleStatus(vehicle.id, { status });
      await load();
    } catch (err) {
      setError(err?.response?.data?.message || "Vehicle status could not be updated.");
    } finally {
      setBusyId(null);
    }
  }

  function exportVehicles() {
    exportCsv("vehicles-register.csv", [
      ["Registration", "Fleet code", "Model", "Type", "Status", "Location", "MOT", "Insurance", "Road tax", "Next service", "Trips", "Open trips", "Open defects"],
      ...vehicles.map(v => [
        v.registrationNumber,
        v.fleetCode,
        v.modelName,
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
      highlights={[
        "Fleet health shows compliance expiry, service risk, open defects, and dispatch usage.",
        "Filter by status, vehicle type, service risk, defects, or open trips to focus attention.",
        "Quick actions let dispatch move vehicles into availability, maintenance, or stopped states."
      ]}
    >
      <div className="finance-command-bar">
        <button className="header-action-button" type="button" onClick={load}>Refresh</button>
        <button className="header-action-button" type="button" onClick={exportVehicles}>Export CSV</button>
        <button className="af-submit-btn" type="button" onClick={() => navigate("/admin/vehicles/new")}>+ Add vehicle</button>
      </div>

      <StateNotice loading={loading} error={error} />

      <section className="stats-grid">
        {(data?.stats || []).map(item => (
          <StatCard key={item.label} item={item} />
        ))}
      </section>

      <section className="stats-grid inline finance-position-grid">
        {(data?.fleetHealth || []).map(item => (
          <StatCard key={item.label} item={item} />
        ))}
      </section>

      <section className="content-grid">
        <article className="content-card">
          <div className="section-head">
            <div>
              <span className="card-label">Fleet readiness</span>
              <h2>Visible vehicle workload</h2>
            </div>
            <StatusPill tone="neutral">Filtered view</StatusPill>
          </div>
          <div className="billing-workflow-grid">
            {visibleStats.map(item => (
              <button className="billing-workflow-tile" key={item.label} type="button" onClick={() => {
                if (item.label === "Needs workshop") setRiskFilter("defects");
                if (item.label === "Open trips") setRiskFilter("open_trips");
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
              <span className="card-label">Fleet exceptions</span>
              <h2>Compliance and workshop watch</h2>
            </div>
            <StatusPill tone="warning">Ops review</StatusPill>
          </div>
          <div className="alert-stack">
            {vehicles.filter(v => v.complianceRisk || v.openDefects > 0 || ["maintenance", "stopped"].includes(v.status)).slice(0, 6).map(v => (
              <div className="alert-card" key={v.id} onClick={() => navigate(`/admin/vehicles/${v.id}`)} style={{ cursor: "pointer" }}>
                <div className={`alert-bar ${v.criticalDefects > 0 || v.status === "stopped" ? "danger" : "warning"}`} />
                <div>
                  <strong>{v.registrationNumber}</strong>
                  <p>{v.openDefects > 0 ? `${v.openDefects} open defect${v.openDefects === 1 ? "" : "s"}.` : v.complianceRisk ? "Compliance or service date needs review." : `Vehicle status is ${v.status.replace("_", " ")}.`}</p>
                </div>
              </div>
            ))}
            {!loading && vehicles.filter(v => v.complianceRisk || v.openDefects > 0 || ["maintenance", "stopped"].includes(v.status)).length === 0 && (
              <p className="finance-empty">No fleet exceptions right now. Compliance risks, defects, and maintenance vehicles will appear here.</p>
            )}
          </div>
        </article>
      </section>

      <section className="content-card vehicle-filter-card">
        <input
          className="af-input"
          type="text"
          placeholder="Search reg, fleet code, model, type, or location..."
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
          <option value="">All risk states</option>
          <option value="compliance">Compliance risk</option>
          <option value="defects">Open defects</option>
          <option value="service">Service due soon</option>
          <option value="open_trips">Open trips</option>
        </select>
        <button className="header-action-button" disabled={!hasFilters} type="button" onClick={clearFilters}>Clear filters</button>
      </section>

      <section className="content-card">
        <div className="section-head">
          <div>
            <span className="card-label">Fleet register</span>
            <h2>Vehicles, compliance and service readiness</h2>
          </div>
          <StatusPill tone={vehicles.length ? "success" : "neutral"}>{vehicles.length} visible</StatusPill>
        </div>

        <div className="data-rows compact finance-list">
          {vehicles.map(v => (
            <div className="data-row finance-row vehicle-row" key={v.id}>
              <button className="finance-row-main vehicle-row-main" type="button" onClick={() => navigate(`/admin/vehicles/${v.id}`)}>
                <div>
                  <strong>{v.registrationNumber}</strong>
                  <p>{v.fleetCode} · {v.modelName} · {v.truckType}</p>
                </div>
                <div>
                  <span>{v.currentLocation}</span>
                  <p>{v.totalTrips} trips · {v.openTrips} open</p>
                </div>
                <div className="vehicle-doc-strip">
                  <ExpiryBadge label={`MOT ${v.motExpiry}`} tone={v.motExpiryTone} />
                  <ExpiryBadge label={`Insurance ${v.insuranceExpiry}`} tone={v.insuranceExpiryTone} />
                  <ExpiryBadge label={`Tax ${v.roadTaxExpiry}`} tone={v.roadTaxExpiryTone} />
                  <ExpiryBadge label={`Service ${v.nextServiceDue}`} tone={v.nextServiceTone} />
                </div>
              </button>
              <div className="finance-row-actions">
                {v.openDefects > 0 && <StatusPill tone={v.criticalDefects > 0 ? "danger" : "warning"}>{v.openDefects} defects</StatusPill>}
                <StatusPill tone={v.statusTone}>{v.status.replace("_", " ")}</StatusPill>
                {v.status !== "available" && (
                  <button className="header-action-button" disabled={busyId === v.id} type="button" onClick={() => setStatus(v, "available")}>Available</button>
                )}
                {v.status !== "maintenance" && (
                  <button className="header-action-button" disabled={busyId === v.id} type="button" onClick={() => setStatus(v, "maintenance")}>Maintenance</button>
                )}
                {v.status !== "stopped" && (
                  <button className="header-action-button danger" disabled={busyId === v.id} type="button" onClick={() => setStatus(v, "stopped")}>Stop</button>
                )}
                <button className="header-action-button" type="button" onClick={() => navigate(`/admin/vehicles/${v.id}/edit`)}>Edit</button>
              </div>
            </div>
          ))}
          {!loading && vehicles.length === 0 && (
            <p className="finance-empty">{hasFilters ? "No vehicles match your filters." : "No vehicles yet. Add your first vehicle."}</p>
          )}
        </div>
      </section>
    </AdminWorkspaceLayout>
  );
}
