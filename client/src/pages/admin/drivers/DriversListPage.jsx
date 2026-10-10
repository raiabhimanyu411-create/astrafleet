import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { deleteDriver, getDrivers, setDriverArchived, updateDriverInline } from "../../../api/driverApi";
import { StateNotice } from "../../../components/StateNotice";
import { DriverChatWidget } from "../DriverChatWidget";
import { AdminWorkspaceLayout } from "../AdminWorkspaceLayout";
import "./DriversListPage.css";

const SHIFT_LABEL = { ready: "Ready", on_trip: "On trip", rest: "Resting", review: "In review" };
const SHIFT_TONE = { ready: "success", on_trip: "info", rest: "neutral", review: "warning" };
const COMPLIANCE_LABEL = { clear: "Compliant", review: "Under review", blocked: "Blocked" };
const COMPLIANCE_TONE = { clear: "success", review: "warning", blocked: "danger" };
const ONBOARDING_LABEL = { new: "New", docs_pending: "Documents pending", approved: "Approved", rejected: "Rejected" };

// Licence and medical expiry are required columns, so they can be changed but not cleared.
const DOCUMENTS = [
  { field: "licenceExpiry", raw: "licenceExpiryRaw", label: "Driving licence", required: true },
  { field: "medicalExpiry", raw: "medicalExpiryRaw", label: "Medical", required: true },
  { field: "cpcExpiry", raw: "cpcExpiryRaw", label: "Driver CPC" },
  { field: "tachoExpiry", raw: "tachoExpiryRaw", label: "Tacho card" }
];

const UK_TODAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());

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

function initials(name = "") {
  return name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0].toUpperCase()).join("") || "?";
}

function blank(value) {
  return value === "—" ? "" : value ?? "";
}

// Calendar-day distance from today in the UK (DST-safe: both sides are dates, not instants).
function daysFromToday(isoDate) {
  if (!isoDate) return null;
  const toUtc = value => Date.UTC(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, Number(value.slice(8, 10)));
  return Math.round((toUtc(isoDate) - toUtc(UK_TODAY)) / 86400000);
}

function expiryText(days) {
  if (days === null || days === undefined) return "Not recorded";
  if (days < 0) return `Expired ${Math.abs(days)} ${Math.abs(days) === 1 ? "day" : "days"} ago`;
  if (days === 0) return "Expires today";
  return `Expires in ${days} ${days === 1 ? "day" : "days"}`;
}

function Badge({ tone = "neutral", children }) {
  return <span className={`dv-badge ${tone}`}>{children}</span>;
}

function DriverPanel({ driver: d, busy, onClose, onInline, onArchive, onDelete, onMessage, navigate }) {
  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function saveText(field, current) {
    return e => {
      const next = e.target.value.trim();
      if (next !== String(current ?? "").trim()) onInline(d, field, next);
    };
  }

  return (
    <div className="dv-panel-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <aside className="dv-panel" role="dialog" aria-modal="true" aria-labelledby="dv-panel-title">
        <header className="dv-panel-head">
          <div className="dv-person">
            <span className="dv-avatar large" aria-hidden="true">{initials(d.fullName)}</span>
            <div>
              <h2 id="dv-panel-title">{d.fullName}</h2>
              <p>{d.employeeCode || "No code"} · Driver since {d.since}</p>
              <div className="dv-head-badges">
                {d.archived
                  ? <Badge tone="neutral">Archived {d.archivedAt !== "—" ? d.archivedAt : ""}</Badge>
                  : (
                    <>
                      <Badge tone={SHIFT_TONE[d.shiftStatus]}>{SHIFT_LABEL[d.shiftStatus] || d.shiftStatus}</Badge>
                      <Badge tone={COMPLIANCE_TONE[d.complianceStatus]}>{COMPLIANCE_LABEL[d.complianceStatus] || d.complianceStatus}</Badge>
                    </>
                  )}
              </div>
            </div>
          </div>
          <button className="dv-icon-btn" type="button" aria-label="Close" onClick={onClose}>×</button>
        </header>

        <div className="dv-panel-body">
          {d.archived && (
            <p className="dv-note neutral">
              Archived drivers keep their jobs, PODs and checks, but cannot sign in or be dispatched. Restore to send them back to compliance review.
            </p>
          )}

          <dl className="dv-figures">
            <div><dt>Open jobs</dt><dd>{d.openTrips}</dd></div>
            <div><dt>Total jobs</dt><dd>{d.totalTrips}</dd></div>
            <div><dt>Unread messages</dt><dd className={d.unreadMessages ? "danger" : ""}>{d.unreadMessages}</dd></div>
          </dl>

          <section className="dv-section">
            <div className="dv-section-head">
              <h3>Contact</h3>
              <span className="dv-save-state" aria-live="polite">{busy ? "Saving…" : "Changes save automatically"}</span>
            </div>
            <div className="dv-fields">
              <label className="dv-field">
                <span>Name</span>
                <input className="dv-input" defaultValue={d.fullName} disabled={d.archived} onBlur={saveText("fullName", d.fullName)} />
              </label>
              <label className="dv-field">
                <span>Phone</span>
                <input className="dv-input" type="tel" defaultValue={blank(d.phone)} disabled={d.archived} onBlur={saveText("phone", blank(d.phone))} />
              </label>
              <div className="dv-field">
                <span>Driver app login</span>
                <p className="dv-static">
                  {d.hasLogin ? d.email : "No login yet"}
                  <button className="dv-link-btn" type="button" onClick={() => navigate(`/admin/drivers/${d.id}/edit`)}>
                    {d.hasLogin ? "Reset password" : "Create login"}
                  </button>
                </p>
              </div>
              <div className="dv-field">
                <span>Assigned truck</span>
                <p className="dv-static">{d.assignedVehicle}</p>
              </div>
            </div>
          </section>

          {!d.archived && (
            <section className="dv-section">
              <h3>Status</h3>
              <div className="dv-fields three">
                <label className="dv-field">
                  <span>Shift</span>
                  <select className="dv-input" value={d.shiftStatus} onChange={e => onInline(d, "shiftStatus", e.target.value)}>
                    {Object.entries(SHIFT_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
                <label className="dv-field">
                  <span>Compliance</span>
                  <select className="dv-input" value={d.complianceStatus} onChange={e => onInline(d, "complianceStatus", e.target.value)}>
                    {Object.entries(COMPLIANCE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
                <label className="dv-field">
                  <span>Onboarding</span>
                  <select className="dv-input" value={d.onboardingStatus} onChange={e => onInline(d, "onboardingStatus", e.target.value)}>
                    {Object.entries(ONBOARDING_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
              </div>
            </section>
          )}

          <section className="dv-section">
            <h3>Documents</h3>
            <ul className="dv-docs">
              {DOCUMENTS.map(doc => {
                const raw = d[doc.raw] && d[doc.raw] < "2099-01-01" ? d[doc.raw] : "";
                const days = daysFromToday(raw);
                const tone = !raw ? "neutral" : days < 0 ? "danger" : days < 30 ? "danger" : days < 90 ? "warning" : "success";
                return (
                  <li key={doc.field}>
                    <div>
                      <strong>{doc.label}</strong>
                      <small className={`dv-tone ${tone}`}>{expiryText(raw ? days : null)}</small>
                    </div>
                    <input
                      className="dv-input dv-date"
                      type="date"
                      aria-label={`${doc.label} expiry`}
                      defaultValue={raw}
                      disabled={d.archived}
                      onBlur={e => {
                        if (e.target.value === raw) return;
                        if (doc.required && !e.target.value) { e.target.value = raw; return; }
                        onInline(d, doc.field, e.target.value);
                      }}
                    />
                  </li>
                );
              })}
            </ul>
          </section>
        </div>

        <footer className="dv-panel-foot">
          <button className="dv-btn primary" type="button" onClick={() => onMessage(d)}>Message</button>
          <button className="dv-btn" type="button" onClick={() => navigate(`/admin/drivers/${d.id}`)}>Full profile</button>
          <button className="dv-btn" type="button" onClick={() => navigate(`/admin/drivers/${d.id}/edit`)}>Edit</button>
          <span className="dv-foot-spacer" />
          <button className="dv-btn" type="button" disabled={busy} onClick={() => onArchive(d, !d.archived)}>
            {d.archived ? "Restore" : "Archive"}
          </button>
          <button className="dv-btn danger" type="button" disabled={busy} onClick={() => onDelete(d)}>Delete</button>
        </footer>
      </aside>
    </div>
  );
}

export function DriversListPage() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [view, setView] = useState("drivers");
  const [chatDriverId, setChatDriverId] = useState(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [busyId, setBusyId] = useState(null);

  // Only the first load shows the loading notice; edits refresh quietly.
  function load() {
    return getDrivers()
      .then(r => {
        setData(r.data);
        setError("");
      })
      .catch(() => setError("Could not load drivers. Please refresh."))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  // Message notifications navigate here and ask for a driver's chat.
  useEffect(() => {
    function onSelect(event) {
      const driverId = event.detail?.driverId;
      if (!driverId) return;
      setChatDriverId(driverId);
      setView("messages");
    }
    window.addEventListener("admin-driver-chat:select", onSelect);
    return () => window.removeEventListener("admin-driver-chat:select", onSelect);
  }, []);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(""), 6000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const allDrivers = useMemo(() => data?.drivers || [], [data]);
  const activeDrivers = useMemo(() => allDrivers.filter(d => !d.archived), [allDrivers]);
  const archivedCount = allDrivers.length - activeDrivers.length;
  const unreadTotal = activeDrivers.reduce((sum, d) => sum + Number(d.unreadMessages || 0), 0);

  const counts = useMemo(() => ({
    ready: activeDrivers.filter(d => d.shiftStatus === "ready" && d.complianceStatus === "clear").length,
    onTrip: activeDrivers.filter(d => d.shiftStatus === "on_trip").length,
    attention: activeDrivers.filter(d => d.complianceStatus !== "clear").length,
    docs: activeDrivers.filter(d => d.nextExpiry && d.nextExpiry.days < 90).length
  }), [activeDrivers]);

  const summaryCards = [
    { key: "", label: "Active drivers", value: activeDrivers.length, tone: "neutral" },
    { key: "ready", label: "Ready to dispatch", value: counts.ready, tone: "success" },
    { key: "on_trip", label: "On a job", value: counts.onTrip, tone: "info" },
    { key: "attention", label: "Compliance review", value: counts.attention, tone: counts.attention ? "warning" : "neutral" },
    { key: "docs", label: "Documents due", value: counts.docs, tone: counts.docs ? "danger" : "neutral" }
  ];

  const drivers = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (showArchived ? allDrivers.filter(d => d.archived) : activeDrivers).filter(d => {
      if (!showArchived) {
        if (filter === "ready" && !(d.shiftStatus === "ready" && d.complianceStatus === "clear")) return false;
        if (filter === "on_trip" && d.shiftStatus !== "on_trip") return false;
        if (filter === "attention" && d.complianceStatus === "clear") return false;
        if (filter === "docs" && !(d.nextExpiry && d.nextExpiry.days < 90)) return false;
      }
      if (!query) return true;
      return [d.fullName, d.employeeCode, d.phone, d.email, d.assignedVehicle]
        .some(value => String(value || "").toLowerCase().includes(query));
    });
  }, [activeDrivers, allDrivers, filter, search, showArchived]);

  const openDriver = allDrivers.find(d => d.id === openId) || null;
  const hasFilters = Boolean(search || filter || showArchived);

  function clearFilters() {
    setSearch("");
    setFilter("");
    setShowArchived(false);
  }

  async function updateInline(driver, field, value) {
    setError("");
    setBusyId(driver.id);
    try {
      await updateDriverInline(driver.id, { [field]: value });
      await load();
    } catch (err) {
      setError(err?.response?.data?.message || "Driver could not be updated.");
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function archive(driver, archived) {
    const prompt = archived
      ? `Archive ${driver.fullName}? They will be signed out, removed from dispatch and unassigned from planned jobs. Their history is kept.`
      : `Restore ${driver.fullName}? They will return as "Under review" until compliance is cleared.`;
    if (!window.confirm(prompt)) return;
    setError("");
    setBusyId(driver.id);
    try {
      const res = await setDriverArchived(driver.id, archived);
      await load();
      setOpenId(null);
      setNotice(res.data?.message || (archived ? "Driver archived." : "Driver restored."));
    } catch (err) {
      setError(err?.response?.data?.message || "Driver could not be updated.");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(driver) {
    if (!window.confirm(`Delete ${driver.fullName} permanently? This also removes their driver app login.`)) return;
    setError("");
    setBusyId(driver.id);
    try {
      await deleteDriver(driver.id);
      await load();
      setOpenId(null);
      setNotice(`${driver.fullName} was deleted.`);
    } catch (err) {
      const body = err?.response?.data;
      if (body?.code === "DRIVER_HAS_HISTORY" && !driver.archived) {
        if (window.confirm(`${body.message}\n\nArchive ${driver.fullName} now?`)) {
          setBusyId(null);
          try {
            const res = await setDriverArchived(driver.id, true);
            await load();
            setOpenId(null);
            setNotice(res.data?.message || "Driver archived.");
          } catch (archiveErr) {
            setError(archiveErr?.response?.data?.message || "Driver could not be archived.");
          }
        }
      } else {
        setError(body?.message || "Driver could not be deleted. Please try again.");
      }
    } finally {
      setBusyId(null);
    }
  }

  function openChat(driver) {
    setOpenId(null);
    setChatDriverId(driver.id);
    setView("messages");
  }

  function exportDrivers() {
    exportCsv("drivers-register.csv", [
      ["Code", "Driver", "Phone", "Email", "Shift", "Compliance", "Next expiry", "Open jobs", "Total jobs", "Archived"],
      ...drivers.map(d => [
        d.employeeCode,
        d.fullName,
        blank(d.phone),
        blank(d.email),
        SHIFT_LABEL[d.shiftStatus] || d.shiftStatus,
        COMPLIANCE_LABEL[d.complianceStatus] || d.complianceStatus,
        d.nextExpiry ? `${d.nextExpiry.label} ${d.nextExpiry.date}` : "",
        d.openTrips,
        d.totalTrips,
        d.archived ? "Yes" : "No"
      ])
    ]);
  }

  return (
    <AdminWorkspaceLayout
      badge="Driver management"
      title="Drivers"
      highlights={[]}
      hideHeaderIntro
      className="drivers-page-shell"
    >
      <div className="dv-command-bar">
        <div className="dv-tabs" role="tablist" aria-label="Driver views">
          <button className={view === "drivers" ? "active" : ""} type="button" role="tab" aria-selected={view === "drivers"} onClick={() => setView("drivers")}>
            Drivers <span className="dv-tab-count">{activeDrivers.length}</span>
          </button>
          <button className={view === "messages" ? "active" : ""} type="button" role="tab" aria-selected={view === "messages"} onClick={() => setView("messages")}>
            Messages {unreadTotal > 0 && <span className="dv-tab-count unread">{unreadTotal}</span>}
          </button>
        </div>
        <div className="dv-actions">
          <button className="dv-btn subtle" type="button" onClick={load}>Refresh</button>
          {view === "drivers" && <button className="dv-btn subtle" type="button" onClick={exportDrivers}>Export</button>}
          <button className="dv-btn primary" type="button" onClick={() => navigate("/admin/drivers/new")}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12" /></svg>
            Add driver
          </button>
        </div>
      </div>

      <StateNotice loading={loading && !data} error={error} />
      {notice && <p className="dv-note success banner" role="status">{notice}</p>}

      {view === "messages" ? (
        <section className="dv-card dv-messages">
          <DriverChatWidget key={chatDriverId || "all"} initialDriverId={chatDriverId} title="Driver messages" />
        </section>
      ) : (
        <>
          <div className="dv-summary" aria-label="Driver summary">
            {summaryCards.map(card => {
              const active = !showArchived && filter === card.key;
              return (
                <button
                  className={`dv-summary-card ${card.tone}${active ? " active" : ""}`}
                  key={card.label}
                  type="button"
                  aria-pressed={active}
                  onClick={() => { setShowArchived(false); setFilter(card.key); }}
                >
                  <span>{card.label}</span>
                  <strong>{card.value}</strong>
                </button>
              );
            })}
          </div>

          <section className="dv-card">
            <div className="dv-toolbar">
              <label className="dv-search">
                <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="9" cy="9" r="5.5" /><path d="m13 13 3.5 3.5" /></svg>
                <input
                  type="search"
                  placeholder="Search name, code, phone, email or truck"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </label>
              <label className="dv-switch">
                <input type="checkbox" role="switch" checked={showArchived} onChange={() => { setShowArchived(v => !v); setFilter(""); }} />
                <span className="dv-switch-track" aria-hidden="true"><span /></span>
                Archived ({archivedCount})
              </label>
              <button className="dv-btn subtle" disabled={!hasFilters} type="button" onClick={clearFilters}>Clear filters</button>
              <span className="dv-count">{drivers.length} {drivers.length === 1 ? "driver" : "drivers"}</span>
            </div>

            <div className="dv-table-shell">
              <table className="dv-table">
                <thead>
                  <tr>
                    <th>Driver</th>
                    <th>Contact</th>
                    <th>Shift</th>
                    <th>Compliance</th>
                    <th>Next document due</th>
                    <th className="num">Jobs</th>
                    <th aria-label="Messages" />
                    <th aria-label="Open" />
                  </tr>
                </thead>
                <tbody>
                  {drivers.map(d => (
                    <tr
                      key={d.id}
                      className={d.archived ? "archived" : ""}
                      tabIndex={0}
                      onClick={() => setOpenId(d.id)}
                      onKeyDown={e => { if (e.key === "Enter") setOpenId(d.id); }}
                    >
                      <td>
                        <div className="dv-person">
                          <span className="dv-avatar" aria-hidden="true">{initials(d.fullName)}</span>
                          <div>
                            <strong>{d.fullName}</strong>
                            <small>{d.employeeCode}{d.assignedVehicle !== "—" ? ` · ${d.assignedVehicle}` : ""}</small>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className="dv-cell-main">{blank(d.phone) || "—"}</span>
                        <small>{d.hasLogin ? d.email : "No app login"}</small>
                      </td>
                      <td>
                        {d.archived
                          ? <Badge tone="neutral">Archived</Badge>
                          : <Badge tone={SHIFT_TONE[d.shiftStatus]}>{SHIFT_LABEL[d.shiftStatus] || d.shiftStatus}</Badge>}
                      </td>
                      <td>
                        {!d.archived && <Badge tone={COMPLIANCE_TONE[d.complianceStatus]}>{COMPLIANCE_LABEL[d.complianceStatus] || d.complianceStatus}</Badge>}
                      </td>
                      <td>
                        {d.nextExpiry ? (
                          <>
                            <span className="dv-cell-main">{d.nextExpiry.label} · {d.nextExpiry.date}</span>
                            <small className={`dv-tone ${d.nextExpiry.tone}`}>{expiryText(d.nextExpiry.days)}</small>
                          </>
                        ) : <span className="dv-muted">Not recorded</span>}
                      </td>
                      <td className="num">
                        <span className="dv-cell-main">{d.openTrips} open</span>
                        <small>{d.totalTrips} total</small>
                      </td>
                      <td className="dv-msg-cell">
                        <button
                          className="dv-icon-btn"
                          type="button"
                          title={`Message ${d.fullName}`}
                          aria-label={`Message ${d.fullName}${d.unreadMessages ? `, ${d.unreadMessages} unread` : ""}`}
                          onClick={e => { e.stopPropagation(); openChat(d); }}
                        >
                          <svg viewBox="0 0 20 20" aria-hidden="true">
                            <path d="M16.5 3h-13a1 1 0 0 0-1 1v9.5a1 1 0 0 0 1 1h2V17l3.5-2.5h7.5a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1z" />
                            <path d="M6.5 7.5h7M6.5 10.5h4.5" />
                          </svg>
                          {d.unreadMessages > 0 && <span className="dv-unread">{d.unreadMessages > 9 ? "9+" : d.unreadMessages}</span>}
                        </button>
                      </td>
                      <td className="dv-open-cell"><span aria-hidden="true">›</span></td>
                    </tr>
                  ))}
                  {!loading && drivers.length === 0 && (
                    <tr className="dv-empty-row">
                      <td colSpan="8">
                        {hasFilters ? "No drivers match these filters." : "No drivers yet."}
                        {hasFilters
                          ? <button className="dv-link-btn" type="button" onClick={clearFilters}>Clear filters</button>
                          : <button className="dv-link-btn" type="button" onClick={() => navigate("/admin/drivers/new")}>Add your first driver</button>}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {openDriver && (
        <DriverPanel
          key={`${openDriver.id}-${openDriver.archived}`}
          driver={openDriver}
          busy={busyId === openDriver.id}
          onClose={() => setOpenId(null)}
          onInline={updateInline}
          onArchive={archive}
          onDelete={remove}
          onMessage={openChat}
          navigate={navigate}
        />
      )}
    </AdminWorkspaceLayout>
  );
}
