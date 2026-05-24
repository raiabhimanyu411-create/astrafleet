import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { deleteDriver, getDrivers } from "../../../api/driverApi";
import { StatCard } from "../../../components/StatCard";
import { StateNotice } from "../../../components/StateNotice";
import { StatusPill } from "../../../components/StatusPill";
import { DriverChatWidget } from "../DriverChatWidget";
import { AdminWorkspaceLayout } from "../AdminWorkspaceLayout";

const COMPLIANCE_OPTIONS = [
  { value: "", label: "All compliance" },
  { value: "clear", label: "Clear" },
  { value: "review", label: "Review" },
  { value: "blocked", label: "Blocked" }
];

const SHIFT_OPTIONS = [
  { value: "", label: "All shift status" },
  { value: "ready", label: "Ready" },
  { value: "on_trip", label: "On trip" },
  { value: "rest", label: "Rest" },
  { value: "review", label: "Review" }
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

export function DriversListPage() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [filterCompliance, setFilterCompliance] = useState("");
  const [filterShift, setFilterShift] = useState("");
  const [riskFilter, setRiskFilter] = useState("");
  const [deletingId, setDeletingId] = useState(null);

  function load() {
    setLoading(true);
    return getDrivers()
      .then(r => {
        setData(r.data);
        setError("");
      })
      .catch(() => setError("Could not load drivers. Please refresh."))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  async function handleDelete(driver) {
    const label = driver.fullName || "this driver";
    if (!window.confirm(`Delete ${label}? Their assigned jobs will become unassigned.`)) return;

    setError("");
    setDeletingId(driver.id);
    try {
      await deleteDriver(driver.id);
      await load();
    } catch (err) {
      setError(err?.response?.data?.message || "Driver could not be deleted. Please try again.");
    } finally {
      setDeletingId(null);
    }
  }

  function handleChat(driver) {
    window.dispatchEvent(new CustomEvent("admin-driver-chat:select", { detail: { driverId: driver.id } }));
  }

  const drivers = useMemo(() => {
    return (data?.drivers || []).filter(d => {
      if (filterCompliance && d.complianceStatus !== filterCompliance) return false;
      if (filterShift && d.shiftStatus !== filterShift) return false;
      if (riskFilter === "docs" && !d.docRisk) return false;
      if (riskFilter === "messages" && Number(d.unreadMessages || 0) === 0) return false;
      if (riskFilter === "open_trips" && Number(d.openTrips || 0) === 0) return false;
      if (riskFilter === "onboarding" && !["new", "docs_pending"].includes(d.onboardingStatus)) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          d.fullName.toLowerCase().includes(q) ||
          d.employeeCode.toLowerCase().includes(q) ||
          (d.phone || "").includes(q) ||
          (d.email || "").toLowerCase().includes(q) ||
          (d.homeDepot || "").toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [data, filterCompliance, filterShift, riskFilter, search]);

  const visibleStats = useMemo(() => [
    { label: "Visible drivers", value: drivers.length, description: "After current filters.", change: "Filtered", tone: "neutral" },
    { label: "Ready now", value: drivers.filter(d => d.shiftStatus === "ready" && d.complianceStatus === "clear").length, description: "Clear and ready for dispatch.", change: "Assignable", tone: "success" },
    { label: "Needs review", value: drivers.filter(d => d.complianceStatus !== "clear" || d.docRisk).length, description: "Compliance or document risk.", change: "Check docs", tone: "danger" },
    { label: "Unread chats", value: drivers.reduce((sum, d) => sum + Number(d.unreadMessages || 0), 0), description: "Messages from drivers.", change: "Support desk", tone: "warning" }
  ], [drivers]);

  const hasFilters = Boolean(search || filterCompliance || filterShift || riskFilter);

  function clearFilters() {
    setSearch("");
    setFilterCompliance("");
    setFilterShift("");
    setRiskFilter("");
  }

  function exportDrivers() {
    exportCsv("drivers-register.csv", [
      ["Driver", "Code", "Phone", "Email", "Depot", "Shift", "Compliance", "Trips", "Open trips", "Docs", "Unread messages", "Licence", "Medical", "CPC", "Tacho"],
      ...drivers.map(d => [
        d.fullName,
        d.employeeCode,
        d.phone,
        d.email,
        d.homeDepot,
        d.shiftStatus,
        d.complianceStatus,
        d.totalTrips,
        d.openTrips,
        d.totalDocs,
        d.unreadMessages,
        d.licenceExpiry,
        d.medicalExpiry,
        d.cpcExpiry,
        d.tachoExpiry
      ])
    ]);
  }

  return (
    <AdminWorkspaceLayout
      badge="Driver management"
      title="Drivers"
      description="Manage driver profiles, UK compliance documents, licences, shift status, and live support."
      highlights={[
        "Driver health shows document risk, onboarding gaps, unread chats, and dispatch readiness.",
        "Filter by compliance, shift, document risk, or open trips to find drivers needing attention.",
        "The support console keeps driver messages connected to the same operations workspace."
      ]}
    >
      <div className="finance-command-bar">
        <button className="header-action-button" type="button" onClick={load}>Refresh</button>
        <button className="header-action-button" type="button" onClick={exportDrivers}>Export CSV</button>
        <button className="af-submit-btn" type="button" onClick={() => navigate("/admin/drivers/new")}>+ Add driver</button>
      </div>

      <StateNotice loading={loading} error={error} />

      <section className="stats-grid">
        {(data?.stats || []).map(item => (
          <StatCard key={item.label} item={item} />
        ))}
      </section>

      <section className="stats-grid inline finance-position-grid">
        {(data?.driverHealth || []).map(item => (
          <StatCard key={item.label} item={item} />
        ))}
      </section>

      <section className="content-grid">
        <article className="content-card">
          <div className="section-head">
            <div>
              <span className="card-label">Driver readiness</span>
              <h2>Visible driver workload</h2>
            </div>
            <StatusPill tone="neutral">Filtered view</StatusPill>
          </div>
          <div className="billing-workflow-grid">
            {visibleStats.map(item => (
              <button className="billing-workflow-tile" key={item.label} type="button" onClick={() => {
                if (item.label === "Needs review") setRiskFilter("docs");
                if (item.label === "Unread chats") setRiskFilter("messages");
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
              <span className="card-label">Driver exceptions</span>
              <h2>Compliance and support watch</h2>
            </div>
            <StatusPill tone="warning">Ops review</StatusPill>
          </div>
          <div className="alert-stack">
            {drivers.filter(d => d.docRisk || d.complianceStatus !== "clear" || d.unreadMessages > 0).slice(0, 6).map(d => (
              <div className="alert-card" key={d.id} onClick={() => navigate(`/admin/drivers/${d.id}`)} style={{ cursor: "pointer" }}>
                <div className={`alert-bar ${d.complianceStatus === "blocked" || d.docRisk ? "danger" : "warning"}`} />
                <div>
                  <strong>{d.fullName}</strong>
                  <p>{d.unreadMessages > 0 ? `${d.unreadMessages} unread driver message${d.unreadMessages === 1 ? "" : "s"}.` : d.docRisk ? "Document renewal or expiry needs review." : `Compliance status is ${d.complianceStatus}.`}</p>
                </div>
              </div>
            ))}
            {!loading && drivers.filter(d => d.docRisk || d.complianceStatus !== "clear" || d.unreadMessages > 0).length === 0 && (
              <p className="finance-empty">No driver exceptions right now. Document risks, review status, and unread messages will appear here.</p>
            )}
          </div>
        </article>
      </section>

      <DriverChatWidget compact />

      <section className="content-card driver-filter-card">
        <input
          className="af-input"
          type="text"
          placeholder="Search by name, code, phone, email, or depot..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select className="af-select" value={filterCompliance} onChange={e => setFilterCompliance(e.target.value)}>
          {COMPLIANCE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select className="af-select" value={filterShift} onChange={e => setFilterShift(e.target.value)}>
          {SHIFT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select className="af-select" value={riskFilter} onChange={e => setRiskFilter(e.target.value)}>
          <option value="">All risk states</option>
          <option value="docs">Document risk</option>
          <option value="messages">Unread messages</option>
          <option value="open_trips">Open trips</option>
          <option value="onboarding">Onboarding queue</option>
        </select>
        <button className="header-action-button" disabled={!hasFilters} type="button" onClick={clearFilters}>Clear filters</button>
      </section>

      <section className="content-card">
        <div className="section-head">
          <div>
            <span className="card-label">Driver register</span>
            <h2>Profiles, documents and dispatch readiness</h2>
          </div>
          <StatusPill tone={drivers.length ? "success" : "neutral"}>{drivers.length} visible</StatusPill>
        </div>

        <div className="data-rows compact finance-list">
          {drivers.map(d => (
            <div className="data-row finance-row driver-row" key={d.id}>
              <button className="finance-row-main driver-row-main" type="button" onClick={() => navigate(`/admin/drivers/${d.id}`)}>
                <div>
                  <strong>{d.fullName}</strong>
                  <p>{d.employeeCode} · {d.phone} · {d.homeDepot}</p>
                </div>
                <div>
                  <span>{d.totalTrips} trips</span>
                  <p>{d.openTrips} open · {d.totalDocs} docs</p>
                </div>
                <div className="driver-doc-strip">
                  <ExpiryBadge label={`Licence ${d.licenceExpiry}`} tone={d.licenceExpiryTone} />
                  <ExpiryBadge label={`Medical ${d.medicalExpiry}`} tone={d.medicalExpiryTone} />
                  <ExpiryBadge label={`CPC ${d.cpcExpiry}`} tone={d.cpcExpiryTone} />
                  <ExpiryBadge label={`Tacho ${d.tachoExpiry}`} tone={d.tachoExpiryTone} />
                </div>
              </button>
              <div className="finance-row-actions">
                {d.unreadMessages > 0 && <StatusPill tone="danger">{d.unreadMessages} unread</StatusPill>}
                <StatusPill tone={d.shiftTone}>{d.shiftStatus.replace("_", " ")}</StatusPill>
                <StatusPill tone={d.complianceTone}>{d.complianceStatus}</StatusPill>
                <button className="header-action-button" type="button" onClick={() => handleChat(d)}>Chat</button>
                <button className="header-action-button" type="button" onClick={() => navigate(`/admin/drivers/${d.id}/edit`)}>Edit</button>
                <button className="header-action-button danger" type="button" disabled={deletingId === d.id} onClick={() => handleDelete(d)}>
                  {deletingId === d.id ? "Deleting..." : "Delete"}
                </button>
              </div>
            </div>
          ))}
          {!loading && drivers.length === 0 && (
            <p className="finance-empty">{hasFilters ? "No drivers match your filters." : "No drivers yet. Add your first driver."}</p>
          )}
        </div>
      </section>
    </AdminWorkspaceLayout>
  );
}
