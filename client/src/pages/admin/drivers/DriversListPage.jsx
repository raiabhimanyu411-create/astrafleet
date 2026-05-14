import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getDrivers } from "../../../api/driverApi";
import { StatCard } from "../../../components/StatCard";
import { StateNotice } from "../../../components/StateNotice";
import { StatusPill } from "../../../components/StatusPill";
import { AdminWorkspaceLayout } from "../AdminWorkspaceLayout";

const COMPLIANCE_OPTIONS = [
  { value: "",        label: "All compliance" },
  { value: "clear",   label: "Clear" },
  { value: "review",  label: "Review" },
  { value: "blocked", label: "Blocked" }
];

const SHIFT_OPTIONS = [
  { value: "",         label: "All shift status" },
  { value: "ready",    label: "Ready" },
  { value: "on_trip",  label: "On trip" },
  { value: "rest",     label: "Rest" },
  { value: "review",   label: "Review" }
];

function ExpiryBadge({ label, tone }) {
  const colors = {
    success: { bg: "#dcfce7", color: "#15803d" },
    warning: { bg: "#fef3c7", color: "#b45309" },
    danger:  { bg: "#fee2e2", color: "#b91c1c" },
    neutral: { bg: "#f1f5f9", color: "#475569" }
  };
  const style = colors[tone] || colors.neutral;
  return (
    <span style={{ ...style, padding: "2px 7px", borderRadius: 999, fontSize: "0.72rem", fontWeight: 700, whiteSpace: "nowrap" }}>
      {label}
    </span>
  );
}

export function DriversListPage() {
  const navigate = useNavigate();
  const [data, setData]                   = useState(null);
  const [loading, setLoading]             = useState(true);
  const [error, setError]                 = useState("");
  const [search, setSearch]               = useState("");
  const [filterCompliance, setFilterCompliance] = useState("");
  const [filterShift, setFilterShift]           = useState("");

  useEffect(() => {
    getDrivers()
      .then(r => setData(r.data))
      .catch(() => setError("Could not load drivers. Please refresh."))
      .finally(() => setLoading(false));
  }, []);

  const filtered = (data?.drivers || []).filter(d => {
    if (filterCompliance && d.complianceStatus !== filterCompliance) return false;
    if (filterShift      && d.shiftStatus      !== filterShift)      return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        d.fullName.toLowerCase().includes(q)     ||
        d.employeeCode.toLowerCase().includes(q) ||
        (d.phone || "").includes(q)              ||
        (d.email || "").toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <AdminWorkspaceLayout
      badge="Driver management"
      title="Drivers"
      description="Manage driver profiles, UK compliance documents, licences, and shift status."
      highlights={[
        "Colour-coded expiry badges show licence, medical, CPC, and tacho card status at a glance.",
        "Filter by compliance or shift status to quickly find drivers needing attention.",
        "Click any driver to view full profile, documents, and trip history."
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
          placeholder="Search by name, code or phone..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select className="af-select" style={{ width: 160, margin: 0 }} value={filterCompliance} onChange={e => setFilterCompliance(e.target.value)}>
          {COMPLIANCE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select className="af-select" style={{ width: 160, margin: 0 }} value={filterShift} onChange={e => setFilterShift(e.target.value)}>
          {SHIFT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <button className="af-submit-btn" type="button" onClick={() => navigate("/admin/drivers/new")}>
          + Add driver
        </button>
      </div>

      {/* Table */}
      <div className="content-card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
            <thead>
              <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                {["Driver", "Contact", "Depot", "Licence expiry", "Medical", "CPC", "Tacho", "Trips", "Shift", "Compliance", ""].map(h => (
                  <th key={h} style={{ padding: "11px 14px", textAlign: "left", fontWeight: 700, color: "#475569", fontSize: "0.71rem", textTransform: "uppercase", letterSpacing: "0.05em", whiteSpace: "nowrap" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && !loading && (
                <tr>
                  <td colSpan={11} style={{ padding: "40px", textAlign: "center", color: "#94a3b8", fontSize: "0.88rem" }}>
                    {search || filterCompliance || filterShift ? "No drivers match your filters." : "No drivers yet. Add your first driver."}
                  </td>
                </tr>
              )}
              {filtered.map((d, i) => (
                <tr
                  key={d.id}
                  style={{ borderBottom: i < filtered.length - 1 ? "1px solid #e2e8f0" : "none", background: "#fff", cursor: "pointer", transition: "background 120ms" }}
                  onClick={() => navigate(`/admin/drivers/${d.id}`)}
                  onMouseEnter={e => e.currentTarget.style.background = "#f8fafc"}
                  onMouseLeave={e => e.currentTarget.style.background = "#fff"}
                >
                  <td style={{ padding: "11px 14px" }}>
                    <strong style={{ display: "block", fontWeight: 600, color: "#0f172a" }}>{d.fullName}</strong>
                    <span style={{ fontSize: "0.76rem", color: "#94a3b8", fontFamily: "monospace" }}>{d.employeeCode}</span>
                  </td>
                  <td style={{ padding: "11px 14px" }}>
                    <span style={{ display: "block", color: "#334155", fontSize: "0.83rem" }}>{d.phone}</span>
                    <span style={{ fontSize: "0.76rem", color: "#64748b" }}>{d.email}</span>
                  </td>
                  <td style={{ padding: "11px 14px", color: "#64748b", fontSize: "0.83rem" }}>{d.homeDepot}</td>
                  <td style={{ padding: "11px 14px" }}>
                    <ExpiryBadge label={d.licenceExpiry} tone={d.licenceExpiryTone} />
                  </td>
                  <td style={{ padding: "11px 14px" }}>
                    <ExpiryBadge label={d.medicalExpiry} tone={d.medicalExpiryTone} />
                  </td>
                  <td style={{ padding: "11px 14px" }}>
                    <ExpiryBadge label={d.cpcExpiry !== "—" ? d.cpcExpiry : "N/A"} tone={d.cpcExpiry !== "—" ? d.cpcExpiryTone : "neutral"} />
                  </td>
                  <td style={{ padding: "11px 14px" }}>
                    <ExpiryBadge label={d.tachoExpiry !== "—" ? d.tachoExpiry : "N/A"} tone={d.tachoExpiry !== "—" ? d.tachoExpiryTone : "neutral"} />
                  </td>
                  <td style={{ padding: "11px 14px", textAlign: "center", fontWeight: 700, color: "#0f172a" }}>{d.totalTrips}</td>
                  <td style={{ padding: "11px 14px" }}>
                    <StatusPill tone={d.shiftTone}>{d.shiftStatus.replace("_", " ")}</StatusPill>
                  </td>
                  <td style={{ padding: "11px 14px" }}>
                    <StatusPill tone={d.complianceTone}>{d.complianceStatus}</StatusPill>
                  </td>
                  <td style={{ padding: "11px 14px" }} onClick={e => e.stopPropagation()}>
                    <div style={{ display: "flex", gap: 5 }}>
                      <button
                        className="header-action-button"
                        style={{ height: 28, padding: "0 10px", fontSize: "0.76rem" }}
                        type="button"
                        onClick={() => navigate(`/admin/drivers/${d.id}`)}
                      >
                        View
                      </button>
                      <button
                        className="header-action-button"
                        style={{ height: 28, padding: "0 10px", fontSize: "0.76rem" }}
                        type="button"
                        onClick={() => navigate(`/admin/drivers/${d.id}/edit`)}
                      >
                        Edit
                      </button>
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
