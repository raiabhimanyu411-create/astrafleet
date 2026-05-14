import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getVehicles } from "../../../api/vehicleApi";
import { StatCard } from "../../../components/StatCard";
import { StateNotice } from "../../../components/StateNotice";
import { StatusPill } from "../../../components/StatusPill";
import { AdminWorkspaceLayout } from "../AdminWorkspaceLayout";

const STATUS_OPTIONS = [
  { value: "",            label: "All statuses" },
  { value: "available",   label: "Available" },
  { value: "planned",     label: "Planned" },
  { value: "in_transit",  label: "In transit" },
  { value: "maintenance", label: "Maintenance" },
  { value: "stopped",     label: "Stopped" }
];

const TYPE_OPTIONS = [
  { value: "", label: "All types" },
  { value: "Rigid HGV",       label: "Rigid HGV" },
  { value: "Articulated HGV", label: "Articulated HGV" },
  { value: "Curtainsider",    label: "Curtainsider" },
  { value: "Flatbed",         label: "Flatbed" },
  { value: "Refrigerated",    label: "Refrigerated" },
  { value: "Box Van",         label: "Box Van" },
  { value: "Tipper",          label: "Tipper" },
  { value: "Tanker",          label: "Tanker" },
  { value: "Other",           label: "Other" }
];

function ExpiryBadge({ label, tone }) {
  const colors = {
    success: { bg: "#dcfce7", color: "#15803d" },
    warning: { bg: "#fef3c7", color: "#b45309" },
    danger:  { bg: "#fee2e2", color: "#b91c1c" },
    neutral: { bg: "#f1f5f9", color: "#475569" }
  };
  const s = colors[tone] || colors.neutral;
  return (
    <span style={{ ...s, padding: "2px 7px", borderRadius: 999, fontSize: "0.72rem", fontWeight: 700, whiteSpace: "nowrap" }}>
      {label}
    </span>
  );
}

export function VehiclesListPage() {
  const navigate = useNavigate();
  const [data, setData]             = useState(null);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState("");
  const [search, setSearch]         = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterType, setFilterType]     = useState("");

  useEffect(() => {
    getVehicles()
      .then(r => setData(r.data))
      .catch(() => setError("Could not load vehicles. Please refresh."))
      .finally(() => setLoading(false));
  }, []);

  const filtered = (data?.vehicles || []).filter(v => {
    if (filterStatus && v.status !== filterStatus) return false;
    if (filterType   && v.truckType !== filterType) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        v.registrationNumber.toLowerCase().includes(q) ||
        v.fleetCode.toLowerCase().includes(q)          ||
        v.modelName.toLowerCase().includes(q)          ||
        v.truckType.toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <AdminWorkspaceLayout
      badge="Fleet management"
      title="Vehicles"
      description="Manage your fleet — MOT, insurance, road tax, maintenance, and compliance tracking."
      highlights={[
        "Colour-coded badges highlight expiring MOT, insurance, and road tax at a glance.",
        "Filter by status or vehicle type to focus on vehicles needing attention.",
        "Click any vehicle to view full profile, maintenance history, and inspections."
      ]}
    >
      <StateNotice loading={loading} error={error} />

      <section className="stats-grid">
        {(data?.stats || []).map(item => (
          <StatCard key={item.label} item={item} />
        ))}
      </section>

      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <input
          className="af-input"
          style={{ margin: 0, flex: 1, minWidth: 200, maxWidth: 280 }}
          type="text"
          placeholder="Search reg, fleet code, model..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select className="af-select" style={{ width: 160, margin: 0 }} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select className="af-select" style={{ width: 160, margin: 0 }} value={filterType} onChange={e => setFilterType(e.target.value)}>
          {TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <button className="af-submit-btn" type="button" onClick={() => navigate("/admin/vehicles/new")}>
          + Add vehicle
        </button>
      </div>

      {/* Table */}
      <div className="content-card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
            <thead>
              <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                {["Vehicle", "Type", "Status", "MOT expiry", "Insurance", "Road tax", "Next service", "Trips", ""].map(h => (
                  <th key={h} style={{ padding: "11px 14px", textAlign: "left", fontWeight: 700, color: "#475569", fontSize: "0.71rem", textTransform: "uppercase", letterSpacing: "0.05em", whiteSpace: "nowrap" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && !loading && (
                <tr>
                  <td colSpan={9} style={{ padding: "40px", textAlign: "center", color: "#94a3b8", fontSize: "0.88rem" }}>
                    {search || filterStatus || filterType ? "No vehicles match your filters." : "No vehicles yet. Add your first vehicle."}
                  </td>
                </tr>
              )}
              {filtered.map((v, i) => (
                <tr
                  key={v.id}
                  style={{ borderBottom: i < filtered.length - 1 ? "1px solid #e2e8f0" : "none", background: "#fff", cursor: "pointer", transition: "background 120ms" }}
                  onClick={() => navigate(`/admin/vehicles/${v.id}`)}
                  onMouseEnter={e => e.currentTarget.style.background = "#f8fafc"}
                  onMouseLeave={e => e.currentTarget.style.background = "#fff"}
                >
                  <td style={{ padding: "11px 14px" }}>
                    <strong style={{ display: "block", fontWeight: 600, color: "#0f172a" }}>{v.registrationNumber}</strong>
                    <span style={{ fontSize: "0.76rem", color: "#94a3b8", fontFamily: "monospace" }}>{v.fleetCode}</span>
                  </td>
                  <td style={{ padding: "11px 14px" }}>
                    <span style={{ display: "block", color: "#334155", fontSize: "0.83rem" }}>{v.truckType}</span>
                    <span style={{ fontSize: "0.76rem", color: "#64748b" }}>{v.modelName}</span>
                  </td>
                  <td style={{ padding: "11px 14px" }}>
                    <StatusPill tone={v.statusTone}>{v.status.replace("_", " ")}</StatusPill>
                  </td>
                  <td style={{ padding: "11px 14px" }}>
                    <ExpiryBadge label={v.motExpiry} tone={v.motExpiryTone} />
                  </td>
                  <td style={{ padding: "11px 14px" }}>
                    <ExpiryBadge label={v.insuranceExpiry} tone={v.insuranceExpiryTone} />
                  </td>
                  <td style={{ padding: "11px 14px" }}>
                    <ExpiryBadge label={v.roadTaxExpiry} tone={v.roadTaxExpiryTone} />
                  </td>
                  <td style={{ padding: "11px 14px" }}>
                    <ExpiryBadge label={v.nextServiceDue} tone={v.nextServiceTone} />
                  </td>
                  <td style={{ padding: "11px 14px", textAlign: "center", fontWeight: 700, color: "#0f172a" }}>
                    {v.totalTrips}
                  </td>
                  <td style={{ padding: "11px 14px" }} onClick={e => e.stopPropagation()}>
                    <div style={{ display: "flex", gap: 5 }}>
                      <button className="header-action-button" style={{ height: 28, padding: "0 10px", fontSize: "0.76rem" }} type="button" onClick={() => navigate(`/admin/vehicles/${v.id}`)}>View</button>
                      <button className="header-action-button" style={{ height: 28, padding: "0 10px", fontSize: "0.76rem" }} type="button" onClick={() => navigate(`/admin/vehicles/${v.id}/edit`)}>Edit</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AdminWorkspaceLayout>
  );
}
