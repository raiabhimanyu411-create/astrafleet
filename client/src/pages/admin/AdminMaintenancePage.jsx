import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  completeMaintenanceJob,
  createJobFromDefect,
  createMaintenanceJob,
  getMaintenancePortal,
  markVehicleInspectionDone,
  updateMaintenanceJob
} from "../../api/maintenanceApi";
import { StatCard } from "../../components/StatCard";
import { StateNotice } from "../../components/StateNotice";
import { StatusPill } from "../../components/StatusPill";
import { AdminWorkspaceLayout } from "./AdminWorkspaceLayout";

const emptyJob = {
  vehicle_id: "",
  defect_id: "",
  service_type: "",
  service_date: "",
  due_date: "",
  road_tax_interval_months: "12",
  completed_mileage_km: "",
  next_due_mileage_km: "",
  garage_name: "",
  assigned_mechanic: "",
  estimated_cost_gbp: "",
  labour_cost_gbp: "",
  parts_cost_gbp: "",
  final_cost_gbp: "",
  bill_number: "",
  bill_date: "",
  bill_amount_gbp: "",
  bill_notes: "",
  bill_attachment_data: "",
  priority: "normal",
  status: "planned",
  notes: "",
  parts_required: "",
  completion_notes: ""
};

const statusOptions = ["planned", "booked", "in_progress", "completed", "cancelled"];
const priorityOptions = ["low", "normal", "high", "critical"];
const maintenanceItems = [
  { value: "Roller brake test", label: "Roller brake test", interval: "Every 6 weeks", days: 42 },
  { value: "Safety inspection", label: "Safety inspection", interval: "Every 6 weeks", days: 42 },
  { value: "MOT", label: "MOT", interval: "Every 12 months", months: 12 },
  { value: "Tacho Calibration", label: "Tacho Calibration", interval: "Every 2 years", months: 24 },
  { value: "Road Tax", label: "Road Tax", interval: "Every 6 or 12 months", roadTax: true },
  { value: "Full Service", label: "Full Service", interval: "Every 85,000 km", mileageKm: 85000 }
];
const dueWindows = [
  { value: "", label: "All due windows" },
  { value: "overdue", label: "Overdue only" },
  { value: "7", label: "Due next 7 days" },
  { value: "14", label: "Due next 14 days" },
  { value: "30", label: "Due next 30 days" }
];

function dateKey(date) {
  return date.toISOString().slice(0, 10);
}

function addDaysToKey(value, days) {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() + days);
  return dateKey(date);
}

function addMonthsToKey(value, months) {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00`);
  date.setMonth(date.getMonth() + months);
  return dateKey(date);
}

function nextDueForItem(serviceType, serviceDate, roadTaxIntervalMonths) {
  const item = maintenanceItems.find((option) => option.value === serviceType);
  if (!item || !serviceDate) return "";
  if (item.roadTax) return addMonthsToKey(serviceDate, Number(roadTaxIntervalMonths || 12));
  if (item.days) return addDaysToKey(serviceDate, item.days);
  if (item.months) return addMonthsToKey(serviceDate, item.months);
  return "";
}

function nextMileageForItem(serviceType, completedMileageKm) {
  if (serviceType !== "Full Service" || !completedMileageKm) return "";
  return String(Number(completedMileageKm) + 85000);
}

function readFileAsDataUrl(file, onDone) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => onDone(reader.result);
  reader.readAsDataURL(file);
}

function displayDay(date) {
  return date.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short" });
}

function buildCalendarDays(mode) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(today);
  if (mode === "month") {
    start.setDate(1);
  }
  const length = mode === "week" ? 7 : 35;
  return Array.from({ length }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return { key: dateKey(date), label: displayDay(date), isToday: dateKey(date) === dateKey(today) };
  });
}

function exportCsv(name, rows) {
  const csv = rows
    .map((row) => row.map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`).join(","))
    .join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

function toJobForm(job) {
  if (!job) return emptyJob;
  return {
    vehicle_id: job.vehicleId || "",
    defect_id: job.defectId || "",
    service_type: job.serviceType || "",
    service_date: job.serviceDateRaw || "",
    due_date: job.dueDateRaw || "",
    road_tax_interval_months: job.roadTaxIntervalMonths || "12",
    completed_mileage_km: job.completedMileageKm || "",
    next_due_mileage_km: job.nextDueMileageKm || "",
    garage_name: job.garageName === "-" ? "" : job.garageName,
    assigned_mechanic: job.assignedMechanic === "-" ? "" : job.assignedMechanic,
    estimated_cost_gbp: job.estimatedCostGbp || "",
    labour_cost_gbp: job.labourCostGbp || "",
    parts_cost_gbp: job.partsCostGbp || "",
    final_cost_gbp: job.finalCostGbp || "",
    bill_number: job.billNumber || "",
    bill_date: job.billDateRaw || "",
    bill_amount_gbp: job.billAmountGbp || "",
    bill_notes: job.billNotes === "-" ? "" : job.billNotes,
    bill_attachment_data: job.billAttachmentData || "",
    priority: job.priority || "normal",
    status: job.status || "planned",
    notes: job.notes === "-" ? "" : job.notes,
    parts_required: job.partsRequired === "-" ? "" : job.partsRequired,
    completion_notes: job.completionNotes === "-" ? "" : job.completionNotes
  };
}

function Field({ label, children }) {
  return (
    <label className="af-field">
      <span className="af-label">{label}</span>
      {children}
    </label>
  );
}

function JobModal({ vehicles, defects, editingJob, initialForm, onClose, onSaved }) {
  const [form, setForm] = useState(initialForm || emptyJob);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setForm(initialForm || emptyJob);
  }, [initialForm]);

  function set(name, value) {
    setError("");
    setForm((current) => {
      const next = { ...current, [name]: value };
      if (["service_type", "service_date", "road_tax_interval_months"].includes(name)) {
        const calculatedDue = nextDueForItem(next.service_type, next.service_date, next.road_tax_interval_months);
        if (calculatedDue) next.due_date = calculatedDue;
      }
      if (["service_type", "completed_mileage_km"].includes(name)) {
        next.next_due_mileage_km = nextMileageForItem(next.service_type, next.completed_mileage_km);
      }
      return next;
    });
  }

  const selectedItem = maintenanceItems.find((item) => item.value === form.service_type);

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      if (editingJob) {
        await updateMaintenanceJob(editingJob.id, form);
      } else {
        await createMaintenanceJob(form);
      }
      await onSaved();
      onClose();
    } catch (err) {
      setError(err.response?.data?.message || "Could not save maintenance job.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="maintenance-modal-backdrop">
      <form className="maintenance-modal" onSubmit={submit}>
        <div className="section-head">
          <div>
            <span className="card-label">{editingJob ? editingJob.jobNumber : "New job"}</span>
            <h2>{editingJob ? "Edit maintenance job" : "Add maintenance job"}</h2>
          </div>
          <button className="header-action-button" type="button" onClick={onClose}>Close</button>
        </div>

        <div className="maintenance-form-grid">
          <Field label="Vehicle">
            <select className="af-select" value={form.vehicle_id} onChange={(e) => set("vehicle_id", e.target.value)} required>
              <option value="">Select vehicle</option>
              {vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.label}</option>)}
            </select>
          </Field>
          <Field label="Service type">
            <select className="af-select" value={form.service_type} onChange={(e) => set("service_type", e.target.value)} required>
              <option value="">Select maintenance item</option>
              {maintenanceItems.map((item) => <option key={item.value} value={item.value}>{item.label} · {item.interval}</option>)}
            </select>
          </Field>
          <Field label="Date completed / done">
            <input className="af-input" type="date" value={form.service_date} onChange={(e) => set("service_date", e.target.value)} />
          </Field>
          {form.service_type === "Road Tax" && (
            <Field label="Road tax period">
              <select className="af-select" value={form.road_tax_interval_months} onChange={(e) => set("road_tax_interval_months", e.target.value)}>
                <option value="6">6 months</option>
                <option value="12">12 months</option>
              </select>
            </Field>
          )}
          <Field label="Next due date">
            <input className="af-input" type="date" value={form.due_date} onChange={(e) => set("due_date", e.target.value)} required />
          </Field>
          {selectedItem?.interval && (
            <div className="maintenance-rule-note">
              <span>Interval</span>
              <strong>{selectedItem.interval}</strong>
            </div>
          )}
          <Field label="Status">
            <select className="af-select" value={form.status} onChange={(e) => set("status", e.target.value)}>
              {statusOptions.map((status) => <option key={status} value={status}>{status.replace("_", " ")}</option>)}
            </select>
          </Field>
          <Field label="Priority">
            <select className="af-select" value={form.priority} onChange={(e) => set("priority", e.target.value)}>
              {priorityOptions.map((priority) => <option key={priority} value={priority}>{priority}</option>)}
            </select>
          </Field>
          <Field label="Garage / vendor">
            <input className="af-input" value={form.garage_name} onChange={(e) => set("garage_name", e.target.value)} placeholder="Workshop or vendor" />
          </Field>
          <Field label="Mechanic / owner">
            <input className="af-input" value={form.assigned_mechanic} onChange={(e) => set("assigned_mechanic", e.target.value)} placeholder="Assigned mechanic" />
          </Field>
          <Field label="Estimated cost">
            <input className="af-input" type="number" min="0" step="0.01" value={form.estimated_cost_gbp} onChange={(e) => set("estimated_cost_gbp", e.target.value)} />
          </Field>
          <Field label="Labour cost">
            <input className="af-input" type="number" min="0" step="0.01" value={form.labour_cost_gbp} onChange={(e) => set("labour_cost_gbp", e.target.value)} />
          </Field>
          <Field label="Parts cost">
            <input className="af-input" type="number" min="0" step="0.01" value={form.parts_cost_gbp} onChange={(e) => set("parts_cost_gbp", e.target.value)} />
          </Field>
          <Field label="Linked defect">
            <select className="af-select" value={form.defect_id} onChange={(e) => set("defect_id", e.target.value)}>
              <option value="">No linked defect</option>
              {defects.filter((defect) => !defect.jobId || String(defect.jobId) === String(editingJob?.id)).map((defect) => (
                <option key={defect.id} value={defect.id}>{defect.vehicle} · {defect.defectType}</option>
              ))}
            </select>
          </Field>
          <Field label="Final cost">
            <input className="af-input" type="number" min="0" step="0.01" value={form.final_cost_gbp} onChange={(e) => set("final_cost_gbp", e.target.value)} />
          </Field>
          {form.service_type === "Full Service" && (
            <>
              <Field label="Completed mileage (km)">
                <input className="af-input" type="number" min="0" value={form.completed_mileage_km} onChange={(e) => set("completed_mileage_km", e.target.value)} placeholder="e.g. 185000" />
              </Field>
              <Field label="Next due mileage (km)">
                <input className="af-input" type="number" min="0" value={form.next_due_mileage_km} onChange={(e) => set("next_due_mileage_km", e.target.value)} placeholder="Auto +85,000 km" />
              </Field>
            </>
          )}
        </div>

        <div className="maintenance-form-grid bill">
          <Field label="Bill / invoice number">
            <input className="af-input" value={form.bill_number} onChange={(e) => set("bill_number", e.target.value)} placeholder="e.g. INV-9821" />
          </Field>
          <Field label="Bill date">
            <input className="af-input" type="date" value={form.bill_date} onChange={(e) => set("bill_date", e.target.value)} />
          </Field>
          <Field label="Bill amount">
            <input className="af-input" type="number" min="0" step="0.01" value={form.bill_amount_gbp} onChange={(e) => set("bill_amount_gbp", e.target.value)} />
          </Field>
          <Field label="Attach bill / paper">
            <input
              className="af-input"
              type="file"
              accept="image/*,.pdf"
              onChange={(e) => readFileAsDataUrl(e.target.files?.[0], (value) => set("bill_attachment_data", value))}
            />
          </Field>
          <Field label="Bill notes">
            <textarea className="af-textarea" value={form.bill_notes} onChange={(e) => set("bill_notes", e.target.value)} rows={2} placeholder="Parts invoice, labour sheet, VAT note..." />
          </Field>
          <div className="maintenance-rule-note">
            <span>Attachment</span>
            <strong>{form.bill_attachment_data ? "Bill attached" : "No bill attached"}</strong>
          </div>
        </div>

        <div className="maintenance-form-grid single">
          <Field label="Parts required">
            <textarea className="af-textarea" value={form.parts_required} onChange={(e) => set("parts_required", e.target.value)} rows={3} />
          </Field>
          <Field label="Notes">
            <textarea className="af-textarea" value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={3} />
          </Field>
          <Field label="Completion notes">
            <textarea className="af-textarea" value={form.completion_notes} onChange={(e) => set("completion_notes", e.target.value)} rows={3} />
          </Field>
        </div>

        {error && <p className="lp-error">{error}</p>}
        <div className="finance-command-bar">
          <button className="header-action-button" type="button" onClick={onClose}>Cancel</button>
          <button className="af-submit-btn" disabled={saving} type="submit">{saving ? "Saving..." : "Save job"}</button>
        </div>
      </form>
    </div>
  );
}

function JobDrawer({ job, history, onClose, onEdit, onComplete }) {
  if (!job) return null;
  const vehicleHistory = history.filter((item) => item.vehicleId === job.vehicleId).slice(0, 10);
  return (
    <aside className="maintenance-drawer">
      <div className="section-head">
        <div>
          <span className="card-label">{job.jobNumber}</span>
          <h2>{job.vehicle}</h2>
          <p className="finance-empty">{job.serviceType}</p>
        </div>
        <button className="header-action-button" type="button" onClick={onClose}>Close</button>
      </div>
      <div className="maintenance-drawer-badges">
        <StatusPill tone={job.statusTone}>{job.statusLabel}</StatusPill>
        <StatusPill tone={job.priorityTone}>{job.priority}</StatusPill>
        <StatusPill tone={job.statusTone}>{job.dueLabel}</StatusPill>
      </div>
      <div className="maintenance-detail-grid">
        <div><span>Vendor</span><strong>{job.garageName}</strong></div>
        <div><span>Owner</span><strong>{job.assignedMechanic}</strong></div>
        <div><span>Cost</span><strong>{job.costLabel}</strong></div>
        <div><span>Bill</span><strong>{job.billNumber || "-"}</strong></div>
        <div><span>Bill amount</span><strong>{job.billAmountLabel}</strong></div>
        <div><span>Vehicle type</span><strong>{job.truckType}</strong></div>
        <div><span>Date done</span><strong>{job.serviceDateRaw ? job.serviceDate : "-"}</strong></div>
        <div><span>Mileage</span><strong>{job.mileageLabel}</strong></div>
      </div>
      {(job.billNotes !== "-" || job.billAttachmentData) && (
        <section className="maintenance-drawer-section">
          <span className="card-label">Bill paperwork</span>
          <p><strong>Bill date:</strong> {job.billDateRaw ? job.billDate : "-"}</p>
          <p><strong>Notes:</strong> {job.billNotes}</p>
          {job.billAttachmentData && (
            <a className="header-action-button maintenance-bill-link" href={job.billAttachmentData} target="_blank" rel="noreferrer">
              Open attached bill
            </a>
          )}
        </section>
      )}
      <div className="maintenance-drawer-actions">
        <button className="header-action-button" type="button" onClick={() => onEdit(job)}>Edit job</button>
        {!["completed", "cancelled"].includes(job.status) && (
          <button className="af-submit-btn" type="button" onClick={() => onComplete(job)}>Mark complete</button>
        )}
      </div>
      <section className="maintenance-drawer-section">
        <span className="card-label">Job card</span>
        <p><strong>Problem/service:</strong> {job.serviceType}</p>
        <p><strong>Parts required:</strong> {job.partsRequired}</p>
        <p><strong>Notes:</strong> {job.notes}</p>
        <p><strong>Completion:</strong> {job.completionNotes}</p>
      </section>
      <section className="maintenance-drawer-section">
        <span className="card-label">Service history timeline</span>
        <div className="maintenance-timeline">
          {vehicleHistory.map((item, index) => (
            <div className="maintenance-timeline-item" key={`${item.source}-${index}`}>
              <StatusPill tone={item.tone}>{item.source}</StatusPill>
              <strong>{item.title}</strong>
              <p>{item.date} · {item.garageName} · {item.cost}</p>
            </div>
          ))}
          {vehicleHistory.length === 0 && <p className="finance-empty">No history yet for this vehicle.</p>}
        </div>
      </section>
    </aside>
  );
}

export function AdminMaintenancePage() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState({ status: "", priority: "", vendor: "", type: "", window: "", from: "", to: "" });
  const [calendarMode, setCalendarMode] = useState("week");
  const [showModal, setShowModal] = useState(false);
  const [editingJob, setEditingJob] = useState(null);
  const [drawerJob, setDrawerJob] = useState(null);
  const [modalForm, setModalForm] = useState(emptyJob);
  const [savingAction, setSavingAction] = useState("");

  function load() {
    setLoading(true);
    return getMaintenancePortal()
      .then((res) => {
        setData(res.data);
        setError("");
      })
      .catch((err) => setError(err.response?.data?.message || "Could not load maintenance planner."))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  const jobs = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (data?.jobs || []).filter((job) => {
      if (filters.status && job.status !== filters.status) return false;
      if (filters.priority && job.priority !== filters.priority) return false;
      if (filters.vendor && job.garageName !== filters.vendor) return false;
      if (filters.type && job.truckType !== filters.type) return false;
      if (filters.window === "overdue" && !(job.daysLeft < 0 && !["completed", "cancelled"].includes(job.status))) return false;
      if (["7", "14", "30"].includes(filters.window) && !(job.daysLeft >= 0 && job.daysLeft <= Number(filters.window))) return false;
      if (filters.from && job.dueDateRaw < filters.from) return false;
      if (filters.to && job.dueDateRaw > filters.to) return false;
      if (!query) return true;
      return (
        job.jobNumber.toLowerCase().includes(query) ||
        job.vehicle.toLowerCase().includes(query) ||
        job.serviceType.toLowerCase().includes(query) ||
        job.garageName.toLowerCase().includes(query) ||
        job.assignedMechanic.toLowerCase().includes(query)
      );
    });
  }, [data, filters, search]);

  const calendarData = useMemo(() => {
    const events = data?.calendarEvents || [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const days = buildCalendarDays(calendarMode);
    const dayKeys = new Set(days.map((day) => day.key));
    const overdue = events
      .filter((event) => {
        const date = new Date(event.date);
        date.setHours(0, 0, 0, 0);
        return date < today && event.tone !== "success";
      })
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 8);
    const grouped = days.map((day) => ({
      ...day,
      events: events
        .filter((event) => dayKeys.has(event.date) && event.date === day.key)
        .slice(0, 4)
    }));
    return { overdue, days: grouped };
  }, [calendarMode, data]);

  const hasFilters = Boolean(search || Object.values(filters).some(Boolean));

  function setFilter(name, value) {
    setFilters((current) => ({ ...current, [name]: value }));
  }

  function clearFilters() {
    setSearch("");
    setFilters({ status: "", priority: "", vendor: "", type: "", window: "", from: "", to: "" });
  }

  function openAddJob(prefill = {}) {
    setEditingJob(null);
    setModalForm({ ...emptyJob, ...prefill });
    setShowModal(true);
  }

  function openEditJob(job) {
    setEditingJob(job);
    setModalForm(toJobForm(job));
    setShowModal(true);
  }

  async function handleComplete(job) {
    const finalCost = window.prompt("Final cost (£)", String(job.finalCostGbp ?? job.estimatedCostGbp ?? ""));
    if (finalCost === null) return;
    const serviceDate = window.prompt("Date completed (YYYY-MM-DD)", job.serviceDateRaw || dateKey(new Date()));
    if (serviceDate === null) return;
    const completionNotes = window.prompt("Completion notes", job.completionNotes === "-" ? "" : job.completionNotes);
    if (completionNotes === null) return;
    setSavingAction(job.id);
    try {
      await completeMaintenanceJob(job.id, {
        final_cost_gbp: finalCost,
        service_date: serviceDate,
        completed_mileage_km: job.completedMileageKm,
        next_due_mileage_km: job.nextDueMileageKm,
        bill_amount_gbp: job.billAmountGbp,
        completion_notes: completionNotes
      });
      await load();
      setDrawerJob(null);
    } catch (err) {
      setError(err.response?.data?.message || "Could not complete job.");
    } finally {
      setSavingAction("");
    }
  }

  async function repairFromDefect(defect) {
    setSavingAction(`defect-${defect.id}`);
    try {
      await createJobFromDefect(defect.id, { service_type: defect.defectType });
      await load();
    } catch (err) {
      setError(err.response?.data?.message || "Could not create repair job.");
    } finally {
      setSavingAction("");
    }
  }

  async function handleInspectionDone(row) {
    const inspectionDate = window.prompt("Inspection date (YYYY-MM-DD)", dateKey(new Date()));
    if (inspectionDate === null) return;
    const inspectorName = window.prompt("Inspector name", "");
    if (inspectorName === null) return;
    const notes = window.prompt("Inspection notes", "6-week safety inspection completed. Vehicle roadworthy.");
    if (notes === null) return;
    setSavingAction(`inspection-${row.id}`);
    try {
      await markVehicleInspectionDone(row.id, { inspection_date: inspectionDate, inspector_name: inspectorName, notes, result: "pass" });
      await load();
    } catch (err) {
      setError(err.response?.data?.message || "Could not mark inspection done.");
    } finally {
      setSavingAction("");
    }
  }

  function exportJobs() {
    exportCsv("maintenance-jobs.csv", [
      ["Job", "Vehicle", "Due item", "Last done", "Next due", "Status", "Priority", "Vendor", "Cost", "Bill no", "Bill amount", "Bill attached", "Action"],
      ...jobs.map((job) => [
        job.jobNumber,
        job.vehicle,
        job.serviceType,
        job.serviceDateRaw ? job.serviceDate : job.completedAtRaw ? job.completedAt : "-",
        job.dueDate,
        job.statusLabel,
        job.priority,
        job.garageName,
        job.costLabel,
        job.billNumber,
        job.billAmountLabel,
        job.billAttachmentData ? "Yes" : "No",
        job.status === "completed" ? "Completed" : job.daysLeft < 0 ? "Overdue" : "Open"
      ])
    ]);
  }

  const openJobs = jobs.filter((job) => !["completed", "cancelled"].includes(job.status));

  return (
    <AdminWorkspaceLayout
      badge={data?.header?.badge || "Maintenance planner"}
      title={data?.header?.title || "Fleet maintenance portal"}
      description={data?.header?.description || "Plan services, inspections, defects, and workshop work from live fleet data."}
      highlights={data?.highlights || []}
    >
      <div className="finance-command-bar">
        <button className="af-submit-btn" type="button" onClick={() => openAddJob()}>+ Add maintenance job</button>
        <button className="header-action-button" type="button" onClick={load}>Refresh</button>
        <button className="header-action-button" type="button" onClick={exportJobs}>Export CSV</button>
        <button className="header-action-button" type="button" onClick={() => navigate("/admin/vehicles")}>Vehicle register</button>
      </div>

      <StateNotice loading={loading} error={error} />

      <section className="stats-grid">
        {(data?.stats || []).map((item) => <StatCard key={item.label} item={item} />)}
      </section>

      <section className="stats-grid inline finance-position-grid">
        {(data?.health || []).map((item) => <StatCard key={item.label} item={item} />)}
      </section>

      <section className="content-grid maintenance-top-grid">
        <article className="content-card">
          <div className="section-head">
            <div>
              <span className="card-label">Maintenance calendar</span>
              <h2>MOT, service, inspection, tax, insurance and booked jobs</h2>
            </div>
            <div className="maintenance-segment">
              <button className={calendarMode === "week" ? "active" : ""} type="button" onClick={() => setCalendarMode("week")}>Week</button>
              <button className={calendarMode === "month" ? "active" : ""} type="button" onClick={() => setCalendarMode("month")}>Month</button>
            </div>
          </div>
          <div className="maintenance-calendar-shell">
            {calendarData.overdue.length > 0 && (
              <div className="maintenance-overdue-strip">
                {calendarData.overdue.map((event) => (
                  <button className={`maintenance-calendar-item ${event.tone}`} key={event.id} type="button">
                    <span>Overdue · {event.date}</span>
                    <strong>{event.label}</strong>
                    <p>{event.type} · {event.status}</p>
                  </button>
                ))}
              </div>
            )}
            <div className={`maintenance-calendar-grid ${calendarMode}`}>
              {calendarData.days.map((day) => (
                <div className={`maintenance-calendar-day${day.isToday ? " today" : ""}`} key={day.key}>
                  <strong>{day.label}</strong>
                  <div className="maintenance-calendar-events">
                    {day.events.map((event) => (
                      <button className={`maintenance-calendar-chip ${event.tone}`} key={event.id} type="button">
                        <span>{event.type}</span>
                        <p>{event.label}</p>
                      </button>
                    ))}
                    {day.events.length === 0 && <em>No items</em>}
                  </div>
                </div>
              ))}
            </div>
            {!loading && calendarData.overdue.length === 0 && calendarData.days.every((day) => day.events.length === 0) && (
              <p className="finance-empty">No due items found for this calendar view.</p>
            )}
          </div>
        </article>

        <article className="content-card">
          <div className="section-head">
            <div>
              <span className="card-label">Workshop job cards</span>
              <h2>Open work in progress</h2>
            </div>
            <StatusPill tone={openJobs.length ? "warning" : "success"}>{openJobs.length} open</StatusPill>
          </div>
          <div className="maintenance-job-card-grid">
            {openJobs.slice(0, 6).map((job) => (
              <button className="maintenance-job-card" key={job.id} type="button" onClick={() => setDrawerJob(job)}>
                <span>{job.jobNumber}</span>
                <strong>{job.vehicle}</strong>
                <p>{job.serviceType}</p>
                <div>
                  <StatusPill tone={job.statusTone}>{job.statusLabel}</StatusPill>
                  <StatusPill tone={job.priorityTone}>{job.priority}</StatusPill>
                </div>
              </button>
            ))}
            {!loading && openJobs.length === 0 && <p className="finance-empty">No open workshop jobs.</p>}
          </div>
        </article>
      </section>

      <section className="content-card maintenance-filter-card">
        <input className="af-input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search job, vehicle, vendor, owner..." />
        <select className="af-select" value={filters.status} onChange={(e) => setFilter("status", e.target.value)}>
          <option value="">All statuses</option>
          {statusOptions.map((status) => <option key={status} value={status}>{status.replace("_", " ")}</option>)}
        </select>
        <select className="af-select" value={filters.priority} onChange={(e) => setFilter("priority", e.target.value)}>
          <option value="">All priorities</option>
          {priorityOptions.map((priority) => <option key={priority} value={priority}>{priority}</option>)}
        </select>
        <select className="af-select" value={filters.vendor} onChange={(e) => setFilter("vendor", e.target.value)}>
          <option value="">All vendors</option>
          {(data?.filterOptions?.vendors || []).map((vendor) => <option key={vendor} value={vendor}>{vendor}</option>)}
        </select>
        <select className="af-select" value={filters.type} onChange={(e) => setFilter("type", e.target.value)}>
          <option value="">All vehicle types</option>
          {(data?.filterOptions?.vehicleTypes || []).map((type) => <option key={type} value={type}>{type}</option>)}
        </select>
        <select className="af-select" value={filters.window} onChange={(e) => setFilter("window", e.target.value)}>
          {dueWindows.map((window) => <option key={window.value} value={window.value}>{window.label}</option>)}
        </select>
        <input className="af-input" type="date" value={filters.from} onChange={(e) => setFilter("from", e.target.value)} />
        <input className="af-input" type="date" value={filters.to} onChange={(e) => setFilter("to", e.target.value)} />
        <button className="header-action-button" disabled={!hasFilters} type="button" onClick={clearFilters}>Clear filters</button>
      </section>

      <section className="content-card">
        <div className="section-head">
          <div>
            <span className="card-label">6-week safety inspections</span>
            <h2>PMI / roadworthiness inspection tracker</h2>
          </div>
          <StatusPill tone="neutral">{(data?.plannerRows || []).length} vehicles</StatusPill>
        </div>
        <div className="maintenance-inspection-grid">
          {(data?.plannerRows || []).map((row) => (
            <div className="maintenance-inspection-row" key={row.id}>
              <div>
                <strong>{row.registrationNumber}</strong>
                <p>{row.fleetCode} · {row.make}</p>
              </div>
              <div>
                <span>Frequency</span>
                <p>{row.inspectionFrequency}</p>
              </div>
              <div>
                <span>Last done</span>
                <p>{row.lastInspection}</p>
              </div>
              <div>
                <span>Next due</span>
                <p>{row.nextInspection} · {row.inspectionDueLabel}</p>
              </div>
              <StatusPill tone={row.inspectionTone}>{row.inspectionStatus}</StatusPill>
              <button
                className="header-action-button"
                disabled={savingAction === `inspection-${row.id}`}
                type="button"
                onClick={() => handleInspectionDone(row)}
              >
                Mark inspection done
              </button>
            </div>
          ))}
          {!loading && (data?.plannerRows || []).length === 0 && (
            <p className="finance-empty">No vehicles available for inspection tracking.</p>
          )}
        </div>
      </section>

      <section className="content-card">
        <div className="section-head">
          <div>
            <span className="card-label">Maintenance jobs</span>
            <h2>Professional workshop register</h2>
          </div>
          <StatusPill tone={jobs.length ? "success" : "neutral"}>{jobs.length} visible</StatusPill>
        </div>
        <div className="maintenance-table">
          <div className="maintenance-table-head">
            <span>Vehicle</span><span>Due item</span><span>Last done</span><span>Next due</span><span>Status</span><span>Priority</span><span>Vendor</span><span>Cost</span><span>Action</span>
          </div>
          {jobs.map((job) => (
            <div className="maintenance-table-row" key={job.id} onClick={() => setDrawerJob(job)}>
              <div><strong>{job.vehicle}</strong><p>{job.fleetCode} · {job.make}</p></div>
              <div><span>{job.serviceType}</span><p>{job.jobNumber}</p></div>
              <div><span>{job.serviceDateRaw ? job.serviceDate : job.completedAtRaw ? job.completedAt : "-"}</span><p>{job.defectType || "Planned work"}</p></div>
              <div><span>{job.dueDate}</span><p>{job.serviceType === "Full Service" ? job.mileageLabel : job.dueLabel}</p></div>
              <div><StatusPill tone={job.statusTone}>{job.statusLabel}</StatusPill></div>
              <div><StatusPill tone={job.priorityTone}>{job.priority}</StatusPill></div>
              <div><span>{job.garageName}</span><p>{job.assignedMechanic}</p></div>
              <div><span>{job.costLabel}</span><p>{job.billNumber ? `Bill ${job.billNumber}` : job.billAttachmentData ? "Bill attached" : "Estimate/final"}</p></div>
              <div className="finance-row-actions" onClick={(e) => e.stopPropagation()}>
                <button className="header-action-button" type="button" onClick={() => openEditJob(job)}>Edit</button>
                {!["completed", "cancelled"].includes(job.status) && (
                  <button className="header-action-button" disabled={savingAction === job.id} type="button" onClick={() => handleComplete(job)}>Complete</button>
                )}
              </div>
            </div>
          ))}
          {!loading && jobs.length === 0 && <p className="finance-empty">No maintenance jobs match this view. Add a job or create one from a defect.</p>}
        </div>
      </section>

      <section className="content-grid">
        <article className="content-card">
          <div className="section-head">
            <div>
              <span className="card-label">Cost dashboard</span>
              <h2>Maintenance cost per vehicle</h2>
            </div>
            <StatusPill tone="neutral">Actual + estimate</StatusPill>
          </div>
          <div className="maintenance-cost-list">
            {(data?.costByVehicle || []).slice(0, 8).map((item) => (
              <div className="maintenance-cost-item" key={item.vehicle}>
                <div>
                  <strong>{item.vehicle}</strong>
                  <p>{item.jobs} job{item.jobs === 1 ? "" : "s"}</p>
                </div>
                <span>{item.amountLabel}</span>
              </div>
            ))}
            {!loading && (data?.costByVehicle || []).length === 0 && <p className="finance-empty">Cost trend will appear after jobs are added or completed.</p>}
          </div>
        </article>

        <article className="content-card">
          <div className="section-head">
            <div>
              <span className="card-label">Service history timeline</span>
              <h2>Recent services, inspections and defects</h2>
            </div>
            <StatusPill tone="neutral">{(data?.history || []).length} events</StatusPill>
          </div>
          <div className="maintenance-timeline global">
            {(data?.history || []).slice(0, 10).map((item, index) => (
              <div className="maintenance-timeline-item" key={`${item.source}-${index}`}>
                <StatusPill tone={item.tone}>{item.source}</StatusPill>
                <strong>{item.title}</strong>
                <p>{item.date} · Vehicle #{item.vehicleId} · {item.garageName} · {item.cost}</p>
              </div>
            ))}
            {!loading && (data?.history || []).length === 0 && <p className="finance-empty">No maintenance history yet.</p>}
          </div>
        </article>
      </section>

      <section className="content-grid">
        <article className="content-card">
          <div className="section-head">
            <div>
              <span className="card-label">Defect-to-repair workflow</span>
              <h2>Driver defects awaiting maintenance</h2>
            </div>
            <StatusPill tone={(data?.defects || []).length ? "warning" : "success"}>{(data?.defects || []).length} defects</StatusPill>
          </div>
          <div className="data-rows">
            {(data?.defects || []).slice(0, 8).map((defect) => (
              <div className="data-row maintenance-defect-row" key={defect.id}>
                <div><strong>{defect.vehicle}</strong><p>{defect.defectType} · {defect.description}</p></div>
                <StatusPill tone={defect.severityTone}>{defect.severity}</StatusPill>
                <div className="finance-row-actions">
                  {defect.jobId ? (
                    <StatusPill tone="success">{defect.jobNumber}</StatusPill>
                  ) : (
                    <button className="header-action-button" disabled={savingAction === `defect-${defect.id}`} type="button" onClick={() => repairFromDefect(defect)}>Create repair job</button>
                  )}
                </div>
              </div>
            ))}
            {!loading && (data?.defects || []).length === 0 && <p className="finance-empty">No open defects.</p>}
          </div>
        </article>

        <article className="content-card">
          <div className="section-head">
            <div>
              <span className="card-label">Document & compliance planner</span>
              <h2>MOT, insurance, road tax, service reminders</h2>
            </div>
            <StatusPill tone="neutral">Reminder view</StatusPill>
          </div>
          <div className="maintenance-compliance-list">
            {(data?.complianceItems || []).slice(0, 12).map((item) => (
              <button className="maintenance-compliance-item" key={`${item.vehicleId}-${item.itemType}`} type="button" onClick={() => openAddJob({ vehicle_id: item.vehicleId, service_type: item.itemType, due_date: item.dueDateRaw, priority: item.tone === "danger" ? "critical" : "normal" })}>
                <StatusPill tone={item.tone}>{item.itemType}</StatusPill>
                <strong>{item.vehicle}</strong>
                <span>{item.dueDate}</span>
                <p>{item.dueLabel}</p>
              </button>
            ))}
          </div>
        </article>
      </section>

      {showModal && (
        <JobModal
          vehicles={data?.vehicles || []}
          defects={data?.defects || []}
          editingJob={editingJob}
          initialForm={modalForm}
          onClose={() => setShowModal(false)}
          onSaved={load}
        />
      )}
      <JobDrawer
        job={drawerJob}
        history={data?.history || []}
        onClose={() => setDrawerJob(null)}
        onEdit={openEditJob}
        onComplete={handleComplete}
      />
    </AdminWorkspaceLayout>
  );
}
