import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createTrolley, deleteTrolley, deleteVehicle, getVehicles, updateTrolleyInline, updateVehicleInline } from "../../../api/vehicleApi";
import { StateNotice } from "../../../components/StateNotice";
import { AdminWorkspaceLayout } from "../AdminWorkspaceLayout";
import "./VehiclesListPage.css";

const VEHICLE_STATUS = [
  { value: "available", label: "Available", tone: "success" },
  { value: "planned", label: "Planned", tone: "info" },
  { value: "in_transit", label: "In transit", tone: "info" },
  { value: "maintenance", label: "In workshop", tone: "warning" },
  { value: "stopped", label: "Stopped", tone: "danger" }
];

const TRAILER_STATUS = [
  { value: "available", label: "Available", tone: "success" },
  { value: "planned", label: "Planned", tone: "info" },
  { value: "in_use", label: "In use", tone: "info" },
  { value: "maintenance", label: "Maintenance", tone: "warning" }
];

const VEHICLE_TYPES = ["Rigid HGV", "Articulated HGV", "Curtainsider", "Flatbed", "Refrigerated", "Box Van", "Tipper", "Tanker", "Other"];
const TRAILER_TYPES = ["Curtain side", "Box", "Flatbed", "Refrigerated", "Low loader", "Tanker", "Other"];

const VIEWS = [
  { key: "fleet", label: "Fleet" },
  { key: "compliance", label: "Compliance" },
  { key: "workshop", label: "Workshop" }
];

function statusMeta(list, value) {
  return list.find(item => item.value === value) || { label: value || "—", tone: "neutral" };
}

function blank(value) {
  return value === "—" ? "" : value ?? "";
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

function dueText(days) {
  if (days === null || days === undefined) return "Not recorded";
  if (days < 0) return `${Math.abs(days)} ${Math.abs(days) === 1 ? "day" : "days"} overdue`;
  if (days === 0) return "Due today";
  return `In ${days} ${days === 1 ? "day" : "days"}`;
}

function dueTone(days) {
  if (days === null || days === undefined) return "neutral";
  if (days < 0) return "danger";
  if (days < 30) return "warning";
  return "success";
}

function Badge({ tone = "neutral", children }) {
  return <span className={`vh-badge ${tone}`}>{children}</span>;
}

function DueCell({ date, days, emptyLabel = "Not recorded" }) {
  if (!date || date === "—") return <span className="vh-muted">{emptyLabel}</span>;
  return (
    <>
      <span className="vh-cell-main">{date}</span>
      <small className={`vh-tone ${dueTone(days)}`}>{dueText(days)}</small>
    </>
  );
}

function usePanelKeys(onClose) {
  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
}

function TextField({ label, value, onSave, type = "text", disabled, mono, transform }) {
  return (
    <label className="vh-field">
      <span>{label}</span>
      <input
        className={`vh-input${mono ? " mono" : ""}`}
        type={type}
        defaultValue={value}
        disabled={disabled}
        onChange={transform ? e => { e.target.value = transform(e.target.value); } : undefined}
        onBlur={e => { if (String(e.target.value).trim() !== String(value ?? "").trim()) onSave(e.target.value.trim()); }}
      />
    </label>
  );
}

function VehiclePanel({ vehicle: v, busy, onClose, onInline, onDelete, navigate }) {
  usePanelKeys(onClose);
  const status = statusMeta(VEHICLE_STATUS, v.status);
  const save = field => value => onInline(v, field, value);

  const legalDates = [
    { label: "MOT", date: v.motExpiry, days: v.motDaysLeft, last: v.motLastDone },
    { label: "Insurance", date: v.insuranceExpiry, days: v.insuranceDaysLeft, last: v.insuranceLastDone },
    { label: "Road tax", date: v.roadTaxExpiry, days: v.roadTaxDaysLeft, last: v.roadTaxLastDone }
  ];
  const optionalDates = [
    { field: "permitExpiry", label: "International permit", raw: v.permitExpiryRaw, days: v.permitDaysLeft },
    { field: "pollutionExpiry", label: "RPC / emissions", raw: v.pollutionExpiryRaw, days: v.pollutionDaysLeft },
    { field: "fitnessExpiry", label: "Additional certificate", raw: v.fitnessExpiryRaw, days: v.fitnessDaysLeft }
  ];

  return (
    <div className="vh-panel-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <aside className="vh-panel" role="dialog" aria-modal="true" aria-labelledby="vh-panel-title">
        <header className="vh-panel-head">
          <div>
            <h2 id="vh-panel-title"><span className="vh-plate">{v.registrationNumber}</span></h2>
            <p>{[v.make, v.model].filter(x => x && x !== "—").join(" ") || v.modelName} · {v.fleetCode} · {v.truckType}</p>
            <div className="vh-head-badges">
              <Badge tone={status.tone}>{status.label}</Badge>
              <Badge tone={v.complianceTone || "neutral"}>{v.complianceStatus || "Compliance"}</Badge>
            </div>
          </div>
          <button className="vh-icon-btn" type="button" aria-label="Close" onClick={onClose}>×</button>
        </header>

        <div className="vh-panel-body">
          <dl className="vh-figures">
            <div><dt>Open jobs</dt><dd>{v.openTrips}</dd></div>
            <div><dt>Total jobs</dt><dd>{v.totalTrips}</dd></div>
            <div><dt>Open defects</dt><dd className={v.openDefects ? (v.criticalDefects ? "danger" : "warning") : ""}>{v.openDefects}{v.criticalDefects ? ` (${v.criticalDefects} critical)` : ""}</dd></div>
            <div><dt>Odometer</dt><dd>{v.odometerReading}</dd></div>
          </dl>

          {(v.complianceReasons || []).length > 0 && (
            <div className="vh-note warning">
              <strong>Needs attention</strong>
              <ul>{v.complianceReasons.map(reason => <li key={reason}>{reason}</li>)}</ul>
            </div>
          )}

          <section className="vh-section">
            <div className="vh-section-head">
              <h3>Vehicle</h3>
              <span className="vh-save-state" aria-live="polite">{busy ? "Saving…" : "Changes save automatically"}</span>
            </div>
            <div className="vh-fields">
              <TextField label="Registration" value={v.registrationNumber} mono transform={x => x.toUpperCase()} onSave={save("registrationNumber")} />
              <TextField label="Fleet code" value={v.fleetCode} mono onSave={save("fleetCode")} />
              <TextField label="Make" value={blank(v.make)} onSave={save("make")} />
              <TextField label="Model" value={blank(v.model)} onSave={save("model")} />
              <label className="vh-field">
                <span>Type</span>
                <select className="vh-input" value={v.truckType} onChange={e => onInline(v, "truckType", e.target.value)}>
                  {!VEHICLE_TYPES.includes(v.truckType) && <option value={v.truckType}>{v.truckType}</option>}
                  {VEHICLE_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
                </select>
              </label>
              <label className="vh-field">
                <span>Status</span>
                <select className="vh-input" value={v.status} onChange={e => onInline(v, "status", e.target.value)}>
                  {VEHICLE_STATUS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
              </label>
              <div className="vh-field wide">
                <TextField label="Current location" value={blank(v.currentLocation)} onSave={save("currentLocation")} />
              </div>
              <TextField label="Odometer (km)" type="number" value={v.odometerReadingRaw} onSave={save("odometerReading")} />
              <label className="vh-field">
                <span>Next service due</span>
                <input
                  className="vh-input"
                  type="date"
                  defaultValue={v.nextServiceDueRaw}
                  onBlur={e => { if (e.target.value !== v.nextServiceDueRaw) onInline(v, "nextServiceDue", e.target.value); }}
                />
                <small className={`vh-tone ${dueTone(v.nextServiceDaysLeft)}`}>{dueText(v.nextServiceDaysLeft)}</small>
              </label>
            </div>
          </section>

          <section className="vh-section">
            <h3>Legal compliance</h3>
            <ul className="vh-dates">
              {legalDates.map(item => (
                <li key={item.label}>
                  <div>
                    <strong>{item.label}</strong>
                    <small>{item.last && item.last !== "—" ? `Last recorded ${item.last}` : "No record on file"}</small>
                  </div>
                  <div className="vh-dates-end">
                    <span>{item.date && item.date !== "—" ? item.date : "—"}</span>
                    <small className={`vh-tone ${dueTone(item.days)}`}>{dueText(item.days)}</small>
                  </div>
                </li>
              ))}
            </ul>
            <p className="vh-hint">Taken from maintenance records. Add MOT, insurance or tax records in the full profile. These are internal records, not a live DVLA / DVSA check.</p>
          </section>

          <section className="vh-section">
            <h3>Other certificates <small>if applicable</small></h3>
            <ul className="vh-dates">
              {optionalDates.map(item => (
                <li key={item.field}>
                  <div>
                    <strong>{item.label}</strong>
                    <small className={`vh-tone ${item.raw ? dueTone(item.days) : "neutral"}`}>{item.raw ? dueText(item.days) : "Not recorded"}</small>
                  </div>
                  <input
                    className="vh-input vh-date"
                    type="date"
                    aria-label={`${item.label} expiry`}
                    defaultValue={item.raw}
                    onBlur={e => { if (e.target.value !== item.raw) onInline(v, item.field, e.target.value); }}
                  />
                </li>
              ))}
            </ul>
          </section>
        </div>

        <footer className="vh-panel-foot">
          <button className="vh-btn primary" type="button" onClick={() => navigate(`/admin/vehicles/${v.id}`)}>Full profile</button>
          <button className="vh-btn" type="button" onClick={() => navigate(`/admin/vehicles/${v.id}/edit`)}>Edit all details</button>
          <span className="vh-foot-spacer" />
          <button className="vh-btn danger" type="button" disabled={busy} onClick={() => onDelete(v)}>Delete</button>
        </footer>
      </aside>
    </div>
  );
}

function TrailerPanel({ trailer: t, busy, isNew, onClose, onInline, onCreate, onDelete }) {
  usePanelKeys(onClose);
  const [draft, setDraft] = useState({ registration_number: "", trailer_code: "", trailer_type: TRAILER_TYPES[0], capacity_tonnes: "", status: "available" });
  const [error, setError] = useState("");
  const status = statusMeta(TRAILER_STATUS, t?.status);
  const save = field => value => onInline(t, field, value);

  async function submit(e) {
    e.preventDefault();
    setError("");
    const message = await onCreate(draft);
    if (message) setError(message);
  }

  return (
    <div className="vh-panel-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <aside className="vh-panel narrow" role="dialog" aria-modal="true" aria-labelledby="vh-trailer-title">
        <header className="vh-panel-head">
          <div>
            <h2 id="vh-trailer-title">{isNew ? "Add trailer" : <span className="vh-plate">{t.registrationNumber}</span>}</h2>
            {!isNew && (
              <>
                <p>{t.trailerCode} · {t.trailerType} · added {t.since}</p>
                <div className="vh-head-badges">
                  <Badge tone={status.tone}>{status.label}</Badge>
                  {t.currentJob && <Badge tone="info">On {t.currentJob}</Badge>}
                </div>
              </>
            )}
          </div>
          <button className="vh-icon-btn" type="button" aria-label="Close" onClick={onClose}>×</button>
        </header>

        {isNew ? (
          <form className="vh-panel-form" onSubmit={submit}>
            <div className="vh-panel-body">
              <div className="vh-fields">
                <label className="vh-field">
                  <span>Registration *</span>
                  <input className="vh-input mono" required value={draft.registration_number} placeholder="e.g. C123456" onChange={e => setDraft(d => ({ ...d, registration_number: e.target.value.toUpperCase() }))} />
                </label>
                <label className="vh-field">
                  <span>Trailer code</span>
                  <input className="vh-input mono" value={draft.trailer_code} placeholder="Created if left blank" onChange={e => setDraft(d => ({ ...d, trailer_code: e.target.value }))} />
                </label>
                <label className="vh-field">
                  <span>Type</span>
                  <select className="vh-input" value={draft.trailer_type} onChange={e => setDraft(d => ({ ...d, trailer_type: e.target.value }))}>
                    {TRAILER_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
                  </select>
                </label>
                <label className="vh-field">
                  <span>Capacity (tonnes)</span>
                  <input className="vh-input" type="number" min="0" step="0.01" value={draft.capacity_tonnes} onChange={e => setDraft(d => ({ ...d, capacity_tonnes: e.target.value }))} />
                </label>
                <label className="vh-field">
                  <span>Status</span>
                  <select className="vh-input" value={draft.status} onChange={e => setDraft(d => ({ ...d, status: e.target.value }))}>
                    {TRAILER_STATUS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </select>
                </label>
              </div>
              {error && <p className="vh-note danger" role="alert">{error}</p>}
            </div>
            <footer className="vh-panel-foot">
              <button className="vh-btn primary" type="submit" disabled={busy}>{busy ? "Adding…" : "Add trailer"}</button>
              <button className="vh-btn" type="button" onClick={onClose}>Cancel</button>
            </footer>
          </form>
        ) : (
          <>
            <div className="vh-panel-body">
              <dl className="vh-figures three">
                <div><dt>Current job</dt><dd>{t.currentJob || "None"}</dd></div>
                <div><dt>Total jobs</dt><dd>{t.totalTrips}</dd></div>
                <div><dt>Capacity</dt><dd>{t.capacityTonnes === "—" ? "—" : `${t.capacityTonnes} t`}</dd></div>
              </dl>
              <section className="vh-section">
                <div className="vh-section-head">
                  <h3>Trailer</h3>
                  <span className="vh-save-state" aria-live="polite">{busy ? "Saving…" : "Changes save automatically"}</span>
                </div>
                <div className="vh-fields">
                  <TextField label="Registration" value={t.registrationNumber} mono transform={x => x.toUpperCase()} onSave={save("registrationNumber")} />
                  <TextField label="Trailer code" value={t.trailerCode} mono onSave={save("trailerCode")} />
                  <label className="vh-field">
                    <span>Type</span>
                    <select className="vh-input" value={t.trailerType} onChange={e => onInline(t, "trailerType", e.target.value)}>
                      {!TRAILER_TYPES.includes(t.trailerType) && <option value={t.trailerType}>{t.trailerType}</option>}
                      {TRAILER_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
                    </select>
                  </label>
                  <label className="vh-field">
                    <span>Status</span>
                    <select className="vh-input" value={t.status} onChange={e => onInline(t, "status", e.target.value)}>
                      {TRAILER_STATUS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
                    </select>
                  </label>
                  <TextField label="Capacity (tonnes)" type="number" value={t.capacityTonnes === "—" ? "" : t.capacityTonnes} onSave={save("capacityTonnes")} />
                  <TextField label="Current location" value={blank(t.currentLocation)} onSave={save("currentLocation")} />
                </div>
              </section>
            </div>
            <footer className="vh-panel-foot">
              <span className="vh-foot-spacer" />
              <button className="vh-btn danger" type="button" disabled={busy} onClick={() => onDelete(t)}>Delete</button>
            </footer>
          </>
        )}
      </aside>
    </div>
  );
}

export function VehiclesListPage() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [assetTab, setAssetTab] = useState("vehicles");
  const [view, setView] = useState("fleet");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [trailerFilter, setTrailerFilter] = useState("");
  const [openVehicleId, setOpenVehicleId] = useState(null);
  const [openTrailerId, setOpenTrailerId] = useState(null);
  const [addingTrailer, setAddingTrailer] = useState(false);
  const [busyId, setBusyId] = useState(null);

  // Only the first load shows the loading notice; edits refresh quietly.
  function load() {
    return getVehicles()
      .then(r => {
        setData(r.data);
        setError("");
      })
      .catch(() => setError("Could not load vehicles. Please refresh."))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(""), 6000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const allVehicles = useMemo(() => data?.vehicles || [], [data]);
  const allTrailers = useMemo(() => data?.trailers || [], [data]);

  const vehicleCounts = useMemo(() => ({
    available: allVehicles.filter(v => v.status === "available" && Number(v.openTrips || 0) === 0).length,
    onJob: allVehicles.filter(v => Number(v.openTrips || 0) > 0 || ["planned", "in_transit"].includes(v.status)).length,
    workshop: allVehicles.filter(v => ["maintenance", "stopped"].includes(v.status)).length,
    compliance: allVehicles.filter(v => v.complianceRisk).length,
    defects: allVehicles.filter(v => Number(v.openDefects || 0) > 0).length
  }), [allVehicles]);

  const vehicleCards = [
    { key: "", label: "All vehicles", value: allVehicles.length, tone: "neutral" },
    { key: "available", label: "Free to dispatch", value: vehicleCounts.available, tone: "success" },
    { key: "on_job", label: "On a job", value: vehicleCounts.onJob, tone: "info" },
    { key: "workshop", label: "Off road", value: vehicleCounts.workshop, tone: vehicleCounts.workshop ? "warning" : "neutral" },
    { key: "compliance", label: "Compliance risk", value: vehicleCounts.compliance, tone: vehicleCounts.compliance ? "danger" : "neutral" },
    { key: "defects", label: "Open defects", value: vehicleCounts.defects, tone: vehicleCounts.defects ? "danger" : "neutral" }
  ];

  const trailerCards = [
    { key: "", label: "All trailers", value: allTrailers.length, tone: "neutral" },
    ...TRAILER_STATUS.map(item => ({ key: item.value, label: item.label, value: allTrailers.filter(t => t.status === item.value).length, tone: item.value === "maintenance" ? "warning" : item.tone }))
  ];

  const vehicles = useMemo(() => {
    const query = search.trim().toLowerCase();
    return allVehicles.filter(v => {
      if (filter === "available" && !(v.status === "available" && Number(v.openTrips || 0) === 0)) return false;
      if (filter === "on_job" && !(Number(v.openTrips || 0) > 0 || ["planned", "in_transit"].includes(v.status))) return false;
      if (filter === "workshop" && !["maintenance", "stopped"].includes(v.status)) return false;
      if (filter === "compliance" && !v.complianceRisk) return false;
      if (filter === "defects" && Number(v.openDefects || 0) === 0) return false;
      if (typeFilter && v.truckType !== typeFilter) return false;
      if (!query) return true;
      return [v.registrationNumber, v.fleetCode, v.make, v.model, v.modelName, v.truckType, v.currentLocation]
        .some(value => String(value || "").toLowerCase().includes(query));
    });
  }, [allVehicles, filter, search, typeFilter]);

  const trailers = useMemo(() => {
    const query = search.trim().toLowerCase();
    return allTrailers.filter(t => {
      if (trailerFilter && t.status !== trailerFilter) return false;
      if (!query) return true;
      return [t.registrationNumber, t.trailerCode, t.trailerType, t.currentLocation, t.currentJob]
        .some(value => String(value || "").toLowerCase().includes(query));
    });
  }, [allTrailers, search, trailerFilter]);

  const openVehicle = allVehicles.find(v => v.id === openVehicleId) || null;
  const openTrailer = allTrailers.find(t => t.id === openTrailerId) || null;
  const hasFilters = assetTab === "vehicles" ? Boolean(search || filter || typeFilter) : Boolean(search || trailerFilter);

  function clearFilters() {
    setSearch("");
    setFilter("");
    setTypeFilter("");
    setTrailerFilter("");
  }

  function switchAsset(tab) {
    setAssetTab(tab);
    setSearch("");
  }

  async function inlineVehicle(vehicle, field, value) {
    setError("");
    setBusyId(`v-${vehicle.id}`);
    try {
      await updateVehicleInline(vehicle.id, { [field]: value });
    } catch (err) {
      setError(err?.response?.data?.message || "Vehicle could not be updated.");
    } finally {
      await load();
      setBusyId(null);
    }
  }

  async function inlineTrailer(trailer, field, value) {
    setError("");
    setBusyId(`t-${trailer.id}`);
    try {
      await updateTrolleyInline(trailer.id, { [field]: value });
    } catch (err) {
      setError(err?.response?.data?.message || "Trailer could not be updated.");
    } finally {
      await load();
      setBusyId(null);
    }
  }

  async function createTrailer(fields) {
    setBusyId("t-new");
    try {
      await createTrolley(fields);
      await load();
      setAddingTrailer(false);
      setNotice(`Trailer ${fields.registration_number} added.`);
      return "";
    } catch (err) {
      return err?.response?.data?.message || "Could not add trailer.";
    } finally {
      setBusyId(null);
    }
  }

  async function removeVehicle(vehicle) {
    if (!window.confirm(`Delete ${vehicle.registrationNumber} permanently?`)) return;
    setError("");
    setBusyId(`v-${vehicle.id}`);
    try {
      await deleteVehicle(vehicle.id);
      await load();
      setOpenVehicleId(null);
      setNotice(`${vehicle.registrationNumber} was deleted.`);
    } catch (err) {
      const body = err?.response?.data;
      if (body?.code === "VEHICLE_HAS_HISTORY" && vehicle.status !== "stopped") {
        if (window.confirm(`${body.message}\n\nMark ${vehicle.registrationNumber} as Stopped now?`)) {
          await inlineVehicle(vehicle, "status", "stopped");
          setNotice(`${vehicle.registrationNumber} is now Stopped and will not be offered for dispatch.`);
        }
      } else {
        setError(body?.message || "Vehicle could not be deleted.");
      }
    } finally {
      setBusyId(null);
    }
  }

  async function removeTrailer(trailer) {
    if (!window.confirm(`Delete trailer ${trailer.registrationNumber} permanently?`)) return;
    setError("");
    setBusyId(`t-${trailer.id}`);
    try {
      await deleteTrolley(trailer.id);
      await load();
      setOpenTrailerId(null);
      setNotice(`Trailer ${trailer.registrationNumber} was deleted.`);
    } catch (err) {
      const body = err?.response?.data;
      if (body?.code === "TRAILER_HAS_HISTORY" && trailer.status !== "maintenance") {
        if (window.confirm(`${body.message}\n\nSet ${trailer.registrationNumber} to Maintenance now?`)) {
          await inlineTrailer(trailer, "status", "maintenance");
          setNotice(`${trailer.registrationNumber} is now in Maintenance.`);
        }
      } else {
        setError(body?.message || "Trailer could not be deleted.");
      }
    } finally {
      setBusyId(null);
    }
  }

  function exportList() {
    if (assetTab === "trailers") {
      exportCsv("trailers-register.csv", [
        ["Registration", "Code", "Type", "Capacity (t)", "Status", "Location", "Current job", "Total jobs"],
        ...trailers.map(t => [t.registrationNumber, t.trailerCode, t.trailerType, blank(t.capacityTonnes), t.status, blank(t.currentLocation), t.currentJob || "", t.totalTrips])
      ]);
      return;
    }
    exportCsv("vehicles-register.csv", [
      ["Registration", "Fleet code", "Make", "Model", "Type", "Status", "Location", "MOT", "Insurance", "Road tax", "Next service", "Trips", "Open trips", "Open defects", "Compliance"],
      ...vehicles.map(v => [
        v.registrationNumber, v.fleetCode, blank(v.make), blank(v.model), v.truckType, v.status, blank(v.currentLocation),
        blank(v.motExpiry), blank(v.insuranceExpiry), blank(v.roadTaxExpiry), blank(v.nextServiceDue),
        v.totalTrips, v.openTrips, v.openDefects, v.complianceStatus
      ])
    ]);
  }

  const cards = assetTab === "vehicles" ? vehicleCards : trailerCards;
  const activeCardKey = assetTab === "vehicles" ? filter : trailerFilter;

  return (
    <AdminWorkspaceLayout
      badge="Fleet management"
      title="Vehicles"
      highlights={[]}
      hideHeaderIntro
      className="vehicles-page-shell"
    >
      <div className="vh-command-bar">
        <div className="vh-tabs" role="tablist" aria-label="Asset type">
          <button className={assetTab === "vehicles" ? "active" : ""} type="button" role="tab" aria-selected={assetTab === "vehicles"} onClick={() => switchAsset("vehicles")}>
            Vehicles <span className="vh-tab-count">{allVehicles.length}</span>
          </button>
          <button className={assetTab === "trailers" ? "active" : ""} type="button" role="tab" aria-selected={assetTab === "trailers"} onClick={() => switchAsset("trailers")}>
            Trailers <span className="vh-tab-count">{allTrailers.length}</span>
          </button>
        </div>
        <div className="vh-actions">
          <button className="vh-btn subtle" type="button" onClick={load}>Refresh</button>
          <button className="vh-btn subtle" type="button" onClick={exportList}>Export</button>
          {assetTab === "trailers" ? (
            <button className="vh-btn primary" type="button" onClick={() => setAddingTrailer(true)}>
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12" /></svg>
              Add trailer
            </button>
          ) : (
            <>
              <button className="vh-btn subtle" type="button" onClick={() => setAddingTrailer(true)}>Add trailer</button>
              <button className="vh-btn primary" type="button" onClick={() => navigate("/admin/vehicles/new")}>
                <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12" /></svg>
                Add vehicle
              </button>
            </>
          )}
        </div>
      </div>

      <StateNotice loading={loading && !data} error={error} />
      {notice && <p className="vh-note success banner" role="status">{notice}</p>}

      <div className={`vh-summary${assetTab === "trailers" ? " five" : ""}`} aria-label="Summary">
        {cards.map(card => {
          const active = activeCardKey === card.key;
          return (
            <button
              className={`vh-summary-card ${card.tone}${active ? " active" : ""}`}
              key={card.label}
              type="button"
              aria-pressed={active}
              onClick={() => {
                if (assetTab === "vehicles") {
                  setFilter(card.key);
                  if (card.key === "compliance") setView("compliance");
                  if (card.key === "defects" || card.key === "workshop") setView("workshop");
                } else {
                  setTrailerFilter(card.key);
                }
              }}
            >
              <span>{card.label}</span>
              <strong>{card.value}</strong>
            </button>
          );
        })}
      </div>

      <section className="vh-card">
        <div className="vh-toolbar">
          <label className="vh-search">
            <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="9" cy="9" r="5.5" /><path d="m13 13 3.5 3.5" /></svg>
            <input
              type="search"
              placeholder={assetTab === "vehicles" ? "Search registration, fleet code, make, model or location" : "Search registration, code, type, location or job"}
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </label>
          {assetTab === "vehicles" && (
            <>
              <select className="vh-input vh-select" aria-label="Vehicle type" value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
                <option value="">All types</option>
                {VEHICLE_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
              </select>
              <div className="vh-segmented" role="tablist" aria-label="Columns">
                {VIEWS.map(item => (
                  <button key={item.key} className={view === item.key ? "active" : ""} type="button" role="tab" aria-selected={view === item.key} onClick={() => setView(item.key)}>
                    {item.label}
                  </button>
                ))}
              </div>
            </>
          )}
          <button className="vh-btn subtle" disabled={!hasFilters} type="button" onClick={clearFilters}>Clear filters</button>
          <span className="vh-count">
            {assetTab === "vehicles" ? `${vehicles.length} of ${allVehicles.length}` : `${trailers.length} of ${allTrailers.length}`}
          </span>
        </div>

        {assetTab === "vehicles" && view === "compliance" && (
          <p className="vh-disclaimer">Internal fleet records, not a live DVLA, DVSA or askMID check. Confirm official status before dispatch.</p>
        )}

        <div className="vh-table-shell">
          {assetTab === "vehicles" ? (
            <table className={`vh-table ${view}`}>
              <thead>
                <tr>
                  <th>Vehicle</th>
                  {view === "fleet" && (
                    <>
                      <th>Type</th>
                      <th>Status</th>
                      <th>Location</th>
                      <th>Next service</th>
                      <th className="num">Jobs</th>
                      <th>Defects</th>
                    </>
                  )}
                  {view === "compliance" && (
                    <>
                      <th>MOT</th>
                      <th>Insurance</th>
                      <th>Road tax</th>
                      <th>Other certificates</th>
                      <th>Compliance</th>
                    </>
                  )}
                  {view === "workshop" && (
                    <>
                      <th>Status</th>
                      <th className="num">Odometer</th>
                      <th>Last service</th>
                      <th>Next service</th>
                      <th>Defects</th>
                      <th>Last job</th>
                    </>
                  )}
                  <th aria-label="Open" />
                </tr>
              </thead>
              <tbody>
                {vehicles.map(v => {
                  const status = statusMeta(VEHICLE_STATUS, v.status);
                  const otherCerts = [
                    ["Permit", v.permitExpiry, v.permitDaysLeft],
                    ["RPC", v.pollutionExpiry, v.pollutionDaysLeft],
                    ["Cert.", v.fitnessExpiry, v.fitnessDaysLeft]
                  ].filter(([, date]) => date && date !== "—");
                  return (
                    <tr key={v.id} tabIndex={0} onClick={() => setOpenVehicleId(v.id)} onKeyDown={e => { if (e.key === "Enter") setOpenVehicleId(v.id); }}>
                      <td>
                        <div className="vh-asset">
                          <span className="vh-plate">{v.registrationNumber}</span>
                          <div>
                            <strong>{[v.make, v.model].filter(x => x && x !== "—").join(" ") || v.modelName}</strong>
                            <small>{v.fleetCode}{view !== "fleet" ? ` · ${v.truckType}` : ""}</small>
                          </div>
                        </div>
                      </td>

                      {view === "fleet" && (
                        <>
                          <td className="nowrap">{v.truckType}</td>
                          <td><Badge tone={status.tone}>{status.label}</Badge></td>
                          <td className="vh-location" title={blank(v.currentLocation)}>{blank(v.currentLocation) || <span className="vh-muted">Unknown</span>}</td>
                          <td><DueCell date={v.nextServiceDue} days={v.nextServiceDaysLeft} /></td>
                          <td className="num">
                            <span className="vh-cell-main">{v.openTrips} open</span>
                            <small>{v.totalTrips} total</small>
                          </td>
                          <td>
                            {v.openDefects > 0
                              ? <Badge tone={v.criticalDefects ? "danger" : "warning"}>{v.openDefects} open{v.criticalDefects ? ` · ${v.criticalDefects} critical` : ""}</Badge>
                              : <span className="vh-muted">None</span>}
                          </td>
                        </>
                      )}

                      {view === "compliance" && (
                        <>
                          <td><DueCell date={v.motExpiry} days={v.motDaysLeft} emptyLabel="No record" /></td>
                          <td><DueCell date={v.insuranceExpiry} days={v.insuranceDaysLeft} emptyLabel="No record" /></td>
                          <td><DueCell date={v.roadTaxExpiry} days={v.roadTaxDaysLeft} emptyLabel="No record" /></td>
                          <td>
                            {otherCerts.length
                              ? otherCerts.map(([label, date, days]) => (
                                <small key={label} className={`vh-tone ${dueTone(days)}`}>{label} · {date}</small>
                              ))
                              : <span className="vh-muted">None recorded</span>}
                          </td>
                          <td>
                            <Badge tone={v.complianceTone || "neutral"}>{v.complianceStatus}</Badge>
                            {(v.complianceReasons || []).slice(0, 2).map(reason => <small key={reason}>{reason}</small>)}
                            {(v.complianceReasons || []).length > 2 && <small>+{v.complianceReasons.length - 2} more</small>}
                          </td>
                        </>
                      )}

                      {view === "workshop" && (
                        <>
                          <td><Badge tone={status.tone}>{status.label}</Badge></td>
                          <td className="num">{v.odometerReading}</td>
                          <td className="nowrap">{blank(v.lastServiceDone) || <span className="vh-muted">No record</span>}</td>
                          <td><DueCell date={v.nextServiceDue} days={v.nextServiceDaysLeft} /></td>
                          <td>
                            {v.openDefects > 0
                              ? <Badge tone={v.criticalDefects ? "danger" : "warning"}>{v.openDefects} open{v.criticalDefects ? ` · ${v.criticalDefects} critical` : ""}</Badge>
                              : <span className="vh-muted">None</span>}
                          </td>
                          <td className="nowrap">{v.lastActivity}</td>
                        </>
                      )}
                      <td className="vh-open-cell"><span aria-hidden="true">›</span></td>
                    </tr>
                  );
                })}
                {!loading && vehicles.length === 0 && (
                  <tr className="vh-empty-row">
                    <td colSpan="9">
                      {hasFilters ? "No vehicles match these filters." : "No vehicles yet."}
                      {hasFilters
                        ? <button className="vh-link-btn" type="button" onClick={clearFilters}>Clear filters</button>
                        : <button className="vh-link-btn" type="button" onClick={() => navigate("/admin/vehicles/new")}>Add your first vehicle</button>}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          ) : (
            <table className="vh-table trailers">
              <thead>
                <tr>
                  <th>Trailer</th>
                  <th>Type</th>
                  <th className="num">Capacity</th>
                  <th>Status</th>
                  <th>Current job</th>
                  <th>Location</th>
                  <th className="num">Jobs</th>
                  <th aria-label="Open" />
                </tr>
              </thead>
              <tbody>
                {trailers.map(t => {
                  const status = statusMeta(TRAILER_STATUS, t.status);
                  return (
                    <tr key={t.id} tabIndex={0} onClick={() => setOpenTrailerId(t.id)} onKeyDown={e => { if (e.key === "Enter") setOpenTrailerId(t.id); }}>
                      <td>
                        <div className="vh-asset">
                          <span className="vh-plate">{t.registrationNumber}</span>
                          <div>
                            <strong>{t.trailerCode}</strong>
                            <small>Added {t.since}</small>
                          </div>
                        </div>
                      </td>
                      <td className="nowrap">{t.trailerType}</td>
                      <td className="num">{t.capacityTonnes === "—" ? "—" : `${t.capacityTonnes} t`}</td>
                      <td><Badge tone={status.tone}>{status.label}</Badge></td>
                      <td>{t.currentJob ? <span className="vh-job">{t.currentJob}</span> : <span className="vh-muted">None</span>}</td>
                      <td className="vh-location">{blank(t.currentLocation) || <span className="vh-muted">Unknown</span>}</td>
                      <td className="num">{t.totalTrips}</td>
                      <td className="vh-open-cell"><span aria-hidden="true">›</span></td>
                    </tr>
                  );
                })}
                {!loading && trailers.length === 0 && (
                  <tr className="vh-empty-row">
                    <td colSpan="8">
                      {hasFilters ? "No trailers match these filters." : "No trailers yet."}
                      {hasFilters
                        ? <button className="vh-link-btn" type="button" onClick={clearFilters}>Clear filters</button>
                        : <button className="vh-link-btn" type="button" onClick={() => setAddingTrailer(true)}>Add your first trailer</button>}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {openVehicle && (
        <VehiclePanel
          key={openVehicle.id}
          vehicle={openVehicle}
          busy={busyId === `v-${openVehicle.id}`}
          onClose={() => setOpenVehicleId(null)}
          onInline={inlineVehicle}
          onDelete={removeVehicle}
          navigate={navigate}
        />
      )}

      {(openTrailer || addingTrailer) && (
        <TrailerPanel
          key={addingTrailer ? "new" : openTrailer.id}
          trailer={openTrailer}
          isNew={addingTrailer}
          busy={addingTrailer ? busyId === "t-new" : busyId === `t-${openTrailer.id}`}
          onClose={() => { setAddingTrailer(false); setOpenTrailerId(null); }}
          onInline={inlineTrailer}
          onCreate={createTrailer}
          onDelete={removeTrailer}
        />
      )}
    </AdminWorkspaceLayout>
  );
}
