import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  addJobNote,
  completeEventFromSchedule,
  completeMaintenanceJob,
  createBulkMaintenanceJobs,
  createJobFromDefect,
  getJobNotes,
  getMaintenancePortal,
  markTrailerInspectionDone,
  markVehicleInspectionDone,
  reportBreakdown,
  setVorStatus,
  updateDefectWorkflow,
  updateMaintenanceBill,
  updateMaintenanceJob
} from "../../api/maintenanceApi";
import { getAuthSession } from "../../utils/authSession";
import { StateNotice } from "../../components/StateNotice";
import { StatusPill } from "../../components/StatusPill";
import { AdminWorkspaceLayout } from "./AdminWorkspaceLayout";
import "./AdminMaintenancePage.css";

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

const statusOptions = ["planned", "booked", "in_progress", "completed", "cancelled", "failed"];
const priorityOptions = ["low", "normal", "high", "critical"];
const severityOptions = ["low", "medium", "high", "critical"];
const allMaintenanceItems = [
  { value: "Roller brake test", label: "Roller brake test", interval: "Every 6 weeks", days: 42, trailerOk: false },
  { value: "Safety inspection", label: "Safety inspection", interval: "Every 6 weeks", days: 42, trailerOk: true },
  { value: "MOT", label: "MOT", interval: "Every 12 months", months: 12, trailerOk: true },
  { value: "Tacho Calibration", label: "Tacho Calibration", interval: "Every 2 years", months: 24, trailerOk: false },
  { value: "Road Tax", label: "Road Tax", interval: "Every 6 or 12 months", roadTax: true, trailerOk: false },
  { value: "Insurance", label: "Insurance", interval: "Every 12 months", months: 12, trailerOk: false },
  { value: "Full Service", label: "Full Service", interval: "Every 6 months / 85,000 km", months: 6, mileageKm: 85000, trailerOk: false }
];
function getMaintenanceItems(assetType) {
  return assetType === "trailer"
    ? allMaintenanceItems
        .filter((item) => item.trailerOk)
        .map((item) => item.value === "Safety inspection" ? { ...item, interval: "Every 10 weeks", days: 70 } : item)
    : allMaintenanceItems;
}
const maintenanceItems = allMaintenanceItems;
function dateKey(date) {
  const value = date instanceof Date ? date : new Date(date);
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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

function daysFromToday(value) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((date - today) / (1000 * 60 * 60 * 24));
}

function nextDueForItem(serviceType, serviceDate, roadTaxIntervalMonths, assetType = "vehicle") {
  const item = maintenanceItems.find((option) => option.value === serviceType);
  if (!item || !serviceDate) return "";
  if (item.roadTax) return addMonthsToKey(serviceDate, Number(roadTaxIntervalMonths || 12));
  if (assetType === "trailer" && serviceType === "Safety inspection") return addDaysToKey(serviceDate, 70);
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

function writeAttachmentPreview(blobUrl, mime) {
  const preview = window.open("", "_blank");
  if (!preview) return false;
  preview.opener = null;
  const isPdf = mime === "application/pdf";
  const isImage = (mime || "").startsWith("image/");
  const body = isImage
    ? `<img src="${blobUrl}" alt="Document attachment" />`
    : `<iframe title="Document attachment" src="${blobUrl}"></iframe>`;
  preview.document.write(`
    <!doctype html>
    <title>Document attachment</title>
    <style>
      html, body { height: 100%; margin: 0; background: #0f172a; font-family: system-ui, sans-serif; }
      header { height: 48px; display: flex; align-items: center; justify-content: space-between; padding: 0 14px; background: #fff; color: #0f172a; border-bottom: 1px solid #cbd5e1; box-sizing: border-box; }
      strong { font-size: 14px; }
      a { display: inline-flex; padding: 8px 10px; border-radius: 6px; background: #2563eb; color: #fff; font-size: 13px; font-weight: 800; text-decoration: none; }
      iframe { width: 100%; height: calc(100% - 48px); border: 0; background: #fff; }
      img { display: block; max-width: 100%; max-height: calc(100% - 48px); margin: 0 auto; object-fit: contain; background: #fff; }
    </style>
    <header>
      <strong>${isPdf ? "PDF document" : "Document attachment"}</strong>
      <a href="${blobUrl}" target="_blank" rel="noreferrer">Open / download</a>
    </header>
    ${body}
  `);
  preview.document.close();
  return true;
}

// Browsers block top-level navigation to data: URLs (shows a blank tab) and some
// mime types force a silent download instead of opening. Converting to a blob: URL
// first makes "open in new tab" behave the same way as a normal uploaded file link.
function openAttachment(dataUrl) {
  if (!dataUrl) return;
  const match = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(dataUrl);
  if (!match) {
    window.open(dataUrl, "_blank", "noopener,noreferrer");
    return;
  }
  const [, mime, isBase64, payload] = match;
  try {
    const binary = isBase64 ? atob(payload) : decodeURIComponent(payload);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: mime || "application/octet-stream" });
    const blobUrl = URL.createObjectURL(blob);
    const previewable = (mime || "").startsWith("image/") || mime === "application/pdf" || (mime || "").startsWith("text/");
    if (previewable) {
      if (!writeAttachmentPreview(blobUrl, mime)) {
        window.open(blobUrl, "_blank", "noopener,noreferrer");
      }
    } else {
      const preview = window.open("", "_blank");
      if (!preview) {
        window.open(blobUrl, "_blank", "noopener,noreferrer");
      } else {
        preview.opener = null;
        preview.document.write(`
          <!doctype html>
          <title>Document attachment</title>
          <style>
            body { font-family: system-ui, sans-serif; margin: 0; display: grid; min-height: 100vh; place-items: center; background: #f8fafc; color: #0f172a; }
            main { max-width: 520px; padding: 28px; border: 1px solid #cbd5e1; border-radius: 8px; background: #fff; box-shadow: 0 18px 50px rgba(15,23,42,.12); }
            h1 { margin: 0 0 8px; font-size: 22px; }
            p { margin: 0 0 18px; color: #475569; line-height: 1.5; }
            a { display: inline-flex; padding: 10px 14px; border-radius: 6px; background: #2563eb; color: #fff; font-weight: 800; text-decoration: none; }
          </style>
          <main>
            <h1>Document ready</h1>
            <p>This file type cannot be previewed directly by the browser. Open or download it from here.</p>
            <a href="${blobUrl}" target="_blank" rel="noreferrer">Open document</a>
          </main>
        `);
        preview.document.close();
      }
    }
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
  } catch (_err) {
    window.open(dataUrl, "_blank", "noopener,noreferrer");
  }
}

function toJobForm(job) {
  if (!job) return emptyJob;
  return {
    vehicle_id: job.vehicleId ? `vehicle:${job.vehicleId}` : "",
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
  const selectedAssetType = form.vehicle_id?.startsWith("trailer:") ? "trailer" : "vehicle";
  const availableItems = getMaintenanceItems(selectedAssetType);
  const [selectedServices, setSelectedServices] = useState(availableItems.map((item) => item.value));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setForm(initialForm || emptyJob);
    const assetType = (initialForm?.vehicle_id || "").startsWith("trailer:") ? "trailer" : "vehicle";
    const items = getMaintenanceItems(assetType);
    setSelectedServices(editingJob ? [initialForm?.service_type].filter(Boolean) : items.map((i) => i.value));
  }, [initialForm]);

  function set(name, value) {
    setError("");
    setForm((current) => {
      const next = { ...current, [name]: value };
      if (["service_type", "service_date", "road_tax_interval_months"].includes(name)) {
        const assetType = next.vehicle_id?.startsWith("trailer:") ? "trailer" : "vehicle";
        const calculatedDue = nextDueForItem(next.service_type, next.service_date, next.road_tax_interval_months, assetType);
        if (calculatedDue) next.due_date = calculatedDue;
      }
      if (["service_type", "completed_mileage_km"].includes(name)) {
        next.next_due_mileage_km = nextMileageForItem(next.service_type, next.completed_mileage_km);
      }
      return next;
    });
  }

  const selectedItem = availableItems.find((item) => item.value === form.service_type);
  const bulkRows = availableItems.map((item) => {
    const nextDue = nextDueForItem(item.value, form.service_date, form.road_tax_interval_months, selectedAssetType);
    const nextMileage = item.value === "Full Service" ? nextMileageForItem(item.value, form.completed_mileage_km) : "";
    return { ...item, nextDue, nextMileage, selected: selectedServices.includes(item.value) };
  });

  function toggleService(value) {
    setSelectedServices((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
  }

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      if (editingJob) {
        await updateMaintenanceJob(editingJob.id, form);
      } else {
        const items = bulkRows
          .filter((item) => item.selected)
          .map((item) => ({
            service_type: item.value,
            due_date: item.nextDue,
            completed_mileage_km: item.value === "Full Service" ? form.completed_mileage_km : "",
            next_due_mileage_km: item.nextMileage
          }));
        if (items.length === 0) {
          throw new Error("Select at least one maintenance item.");
        }
        await createBulkMaintenanceJobs({ ...form, items });
      }
      await onSaved();
      onClose();
    } catch (err) {
      setError(err.response?.data?.message || err.message || "Could not save maintenance job.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="maintenance-modal-backdrop">
      <form className="maintenance-modal" onSubmit={submit}>
        <div className="section-head">
          <div>
            <span className="card-label">{editingJob ? editingJob.jobNumber : "New Job"}</span>
            <h2>{editingJob ? "Edit Maintenance Job" : "Add Maintenance Job"}</h2>
          </div>
          <button className="header-action-button" type="button" onClick={onClose}>Close</button>
        </div>

        <div className="maintenance-form-grid">
          <Field label="Vehicle / Trailer">
            <select className="af-select" value={form.vehicle_id} onChange={(e) => {
              set("vehicle_id", e.target.value);
              const newAssetType = e.target.value.startsWith("trailer:") ? "trailer" : "vehicle";
              const newItems = getMaintenanceItems(newAssetType);
              setSelectedServices(newItems.map((i) => i.value));
            }} required>
              <option value="">Select Vehicle or Trailer</option>
              {vehicles.filter((v) => v.assetType !== "trailer").map((v) => <option key={v.assetId} value={v.assetId}>{v.label}</option>)}
              <optgroup label="── Trailers ──">
                {vehicles.filter((v) => v.assetType === "trailer").map((v) => <option key={v.assetId} value={v.assetId}>{v.label}</option>)}
              </optgroup>
            </select>
          </Field>
          {editingJob && (
            <Field label="Service type">
              <select className="af-select" value={form.service_type} onChange={(e) => set("service_type", e.target.value)} required>
                <option value="">Select Maintenance Item</option>
                {availableItems.map((item) => <option key={item.value} value={item.value}>{item.label} · {item.interval}</option>)}
              </select>
            </Field>
          )}
          <Field label="Date Completed / Done">
            <input className="af-input" type="date" value={form.service_date} onChange={(e) => set("service_date", e.target.value)} required={!editingJob} />
          </Field>
          {(!editingJob || form.service_type === "Road Tax") && (
            <Field label="Road Tax Period">
              <select className="af-select" value={form.road_tax_interval_months} onChange={(e) => set("road_tax_interval_months", e.target.value)}>
                <option value="6">6 months</option>
                <option value="12">12 months</option>
              </select>
            </Field>
          )}
          {editingJob && (
            <>
              <Field label="Next Due Date">
                <input className="af-input" type="date" value={form.due_date} onChange={(e) => set("due_date", e.target.value)} required />
              </Field>
              {selectedItem?.interval && (
                <div className="maintenance-rule-note">
                  <span>Interval</span>
                  <strong>{selectedItem.interval}</strong>
                </div>
              )}
            </>
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
          <Field label="Garage / Vendor">
            <input className="af-input" value={form.garage_name} onChange={(e) => set("garage_name", e.target.value)} placeholder="Workshop or vendor" />
          </Field>
          <Field label="Mechanic / Owner">
            <input className="af-input" value={form.assigned_mechanic} onChange={(e) => set("assigned_mechanic", e.target.value)} placeholder="Assigned mechanic" />
          </Field>
          <Field label="Estimated Cost">
            <input className="af-input" type="number" min="0" step="0.01" value={form.estimated_cost_gbp} onChange={(e) => set("estimated_cost_gbp", e.target.value)} />
          </Field>
          <Field label="Labour Cost">
            <input className="af-input" type="number" min="0" step="0.01" value={form.labour_cost_gbp} onChange={(e) => set("labour_cost_gbp", e.target.value)} />
          </Field>
          <Field label="Parts Cost">
            <input className="af-input" type="number" min="0" step="0.01" value={form.parts_cost_gbp} onChange={(e) => set("parts_cost_gbp", e.target.value)} />
          </Field>
          {editingJob && (
            <Field label="Linked Defect">
              <select className="af-select" value={form.defect_id} onChange={(e) => set("defect_id", e.target.value)}>
                <option value="">No Linked Defect</option>
                {defects.filter((defect) => !defect.jobId || String(defect.jobId) === String(editingJob?.id)).map((defect) => (
                  <option key={defect.id} value={defect.id}>{defect.vehicle} · {defect.defectType}</option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Final Cost">
            <input className="af-input" type="number" min="0" step="0.01" value={form.final_cost_gbp} onChange={(e) => set("final_cost_gbp", e.target.value)} />
          </Field>
          {(!editingJob || form.service_type === "Full Service") && (
            <>
              <Field label="Completed Mileage (km)">
                <input className="af-input" type="number" min="0" value={form.completed_mileage_km} onChange={(e) => set("completed_mileage_km", e.target.value)} placeholder="e.g. 185000" />
              </Field>
              <Field label="Next Due Mileage (km)">
                <input className="af-input" type="number" min="0" value={form.next_due_mileage_km} onChange={(e) => set("next_due_mileage_km", e.target.value)} placeholder="Auto +85,000 km" />
              </Field>
            </>
          )}
        </div>

        {!editingJob && (
          <section className="maintenance-bulk-card">
            <div className="section-head">
              <div>
                <span className="card-label">Maintenance Items</span>
                <h2>Select Once, Save All Due Dates</h2>
              </div>
              <StatusPill tone="neutral">{selectedServices.length} selected</StatusPill>
            </div>
            <div className="maintenance-bulk-list">
              {bulkRows.map((item) => (
                <label className={`maintenance-bulk-row${item.selected ? " selected" : ""}`} key={item.value}>
                  <input type="checkbox" checked={item.selected} onChange={() => toggleService(item.value)} />
                  <div>
                    <strong>{item.label}</strong>
                    <p>{item.interval}</p>
                  </div>
                  <div>
                    <span>{item.value === "Full Service" ? "Mileage target" : "Next due"}</span>
                    <strong>{item.value === "Full Service" ? (item.nextMileage ? `${Number(item.nextMileage).toLocaleString("en-GB")} km` : "Add mileage") : (item.nextDue || "Select date")}</strong>
                  </div>
                </label>
              ))}
            </div>
          </section>
        )}

        <div className="maintenance-form-grid bill">
          <Field label="Bill / Invoice Number">
            <input className="af-input" value={form.bill_number} onChange={(e) => set("bill_number", e.target.value)} placeholder="e.g. INV-9821" />
          </Field>
          <Field label="Bill Date">
            <input className="af-input" type="date" value={form.bill_date} onChange={(e) => set("bill_date", e.target.value)} />
          </Field>
          <Field label="Bill Amount">
            <input className="af-input" type="number" min="0" step="0.01" value={form.bill_amount_gbp} onChange={(e) => set("bill_amount_gbp", e.target.value)} />
          </Field>
          <Field label="Attach Document / Bill">
            <input
              className="af-input"
              type="file"
              accept="image/*,.pdf,.doc,.docx,.xls,.xlsx"
              onChange={(e) => readFileAsDataUrl(e.target.files?.[0], (value) => set("bill_attachment_data", value))}
            />
          </Field>
          <Field label="Document Notes">
            <textarea className="af-textarea" value={form.bill_notes} onChange={(e) => set("bill_notes", e.target.value)} rows={2} placeholder="Invoice, repair report, inspection sheet, VAT note..." />
          </Field>
          <div className="maintenance-rule-note">
            <span>Document</span>
            <strong>{form.bill_attachment_data ? "Document attached" : "No document attached"}</strong>
          </div>
        </div>

        <div className="maintenance-form-grid single">
          <Field label="Parts Required">
            <textarea className="af-textarea" value={form.parts_required} onChange={(e) => set("parts_required", e.target.value)} rows={3} />
          </Field>
          <Field label="Breakdown / Problem Note">
            <textarea className="af-textarea" value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={3} placeholder="Breakdown reason, problem found, driver note..." />
          </Field>
          <Field label="Completion Notes">
            <textarea className="af-textarea" value={form.completion_notes} onChange={(e) => set("completion_notes", e.target.value)} rows={3} />
          </Field>
        </div>

        {error && <p className="lp-error">{error}</p>}
        <div className="finance-command-bar">
          <button className="header-action-button" type="button" onClick={onClose}>Cancel</button>
          <button className="af-submit-btn" disabled={saving} type="submit">
            {saving ? "Saving..." : editingJob ? "Save Job" : "Save Selected Maintenance"}
          </button>
        </div>
      </form>
    </div>
  );
}

function VehicleDetailModal({ target, profiles, onClose, onSaved }) {
  const profile = useMemo(() => {
    if (!target) return null;
    const wantsTrailer = target.assetType === "trailer";
    return profiles.find((p) => Number(p.vehicleId) === Number(target.vehicleId) && Boolean(p.assetType === "trailer") === wantsTrailer) || null;
  }, [profiles, target]);

  const [activeType, setActiveType] = useState(target?.preselectType || null);
  const [form, setForm] = useState({
    service_date: dateKey(new Date()),
    due_date: "",
    garage_name: "",
    final_cost_gbp: "",
    completed_mileage_km: "",
    bill_number: "",
    bill_amount_gbp: "",
    bill_notes: "",
    bill_attachment_data: "",
    road_tax_interval_months: "12"
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  useEffect(() => {
    const selectedItem = profile?.items?.find((item) => item.type === target?.preselectType);
    const isCompletedSelection = target?.selectionKind === "completed";
    setActiveType(target?.preselectType || null);
    setForm({
      service_date: isCompletedSelection
        ? (selectedItem?.lastDoneRaw || target?.scheduledDueDate || dateKey(new Date()))
        : dateKey(new Date()),
      due_date: target?.scheduledDueDate || "",
      garage_name: "",
      final_cost_gbp: "",
      completed_mileage_km: "",
      bill_number: isCompletedSelection ? (selectedItem?.billNumber || "") : "",
      bill_amount_gbp: isCompletedSelection ? (selectedItem?.billAmountGbp || "") : "",
      bill_notes: isCompletedSelection ? (selectedItem?.billNotes || "") : "",
      bill_attachment_data: isCompletedSelection ? (selectedItem?.attachmentData || "") : "",
      road_tax_interval_months: String(selectedItem?.roadTaxIntervalMonths || 12)
    });
    setError("");
    setSuccessMessage("");
  }, [profile, target?.vehicleId, target?.assetType, target?.preselectType, target?.scheduledDueDate, target?.selectionKind]);

  function set(name, value) {
    setForm((c) => ({ ...c, [name]: value }));
  }

  function openItem(type) {
    setActiveType(type);
    setError("");
    setSuccessMessage("");
    const item = profile?.items?.find((entry) => entry.type === type);
    const isSelectedCompletedEvent = type === target?.preselectType && target?.selectionKind === "completed";
    const isSelectedUpcomingEvent = type === target?.preselectType && Boolean(target?.scheduledDueDate) && !isSelectedCompletedEvent;
    setForm((c) => ({
      ...c,
      service_date: isSelectedCompletedEvent ? (item?.lastDoneRaw || dateKey(new Date())) : dateKey(new Date()),
      due_date: isSelectedUpcomingEvent ? target.scheduledDueDate : (item?.nextDueRaw || ""),
      bill_number: isSelectedCompletedEvent ? (item?.billNumber || "") : "",
      bill_amount_gbp: isSelectedCompletedEvent ? (item?.billAmountGbp || "") : "",
      bill_notes: isSelectedCompletedEvent ? (item?.billNotes || "") : "",
      bill_attachment_data: isSelectedCompletedEvent ? (item?.attachmentData || "") : "",
      road_tax_interval_months: String(item?.roadTaxIntervalMonths || 12)
    }));
  }

  const nextDue = useMemo(() => {
    if (!activeType || !form.service_date) return "";
    return nextDueForItem(activeType, form.service_date, form.road_tax_interval_months, target?.assetType) || "";
  }, [activeType, form.service_date, form.road_tax_interval_months, target?.assetType]);
  const isEditingCompleted = target?.selectionKind === "completed";

  async function submit(e) {
    e.preventDefault();
    if (!profile || !activeType) return;
    setSaving(true);
    setError("");
    try {
      await completeEventFromSchedule({
        asset_id: `${target.assetType === "trailer" ? "trailer" : "vehicle"}:${profile.vehicleId}`,
        service_type: activeType,
        service_date: form.service_date,
        due_date: form.due_date,
        garage_name: form.garage_name,
        final_cost_gbp: form.final_cost_gbp,
        completed_mileage_km: form.completed_mileage_km,
        bill_number: form.bill_number,
        bill_amount_gbp: form.bill_amount_gbp,
        bill_notes: form.bill_notes,
        completion_notes: form.bill_notes,
        bill_attachment_data: form.bill_attachment_data,
        road_tax_interval_months: form.road_tax_interval_months,
        completed_job_id: isEditingCompleted
          ? (target?.completedJobId || profile.items.find((item) => item.type === activeType)?.latestJobId || null)
          : null
      });
      await onSaved();
      setSuccessMessage(isEditingCompleted
        ? `${activeType} completion updated.`
        : `${activeType} marked done${form.bill_attachment_data ? " and document attached." : "."}`);
      setActiveType(null);
    } catch (err) {
      const detail = err.response?.data?.error;
      const message = err.response?.data?.message || "Could not mark item as done.";
      setError(detail ? `${message}: ${detail}` : message);
    } finally {
      setSaving(false);
    }
  }

  if (!target) return null;

  if (!profile) {
    return (
      <div className="maintenance-modal-backdrop">
        <div className="maintenance-modal">
          <div className="section-head">
            <h2>Vehicle not found</h2>
            <button className="header-action-button" type="button" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="maintenance-modal-backdrop">
      <div className="maintenance-modal vehicle-detail-modal">
        <div className="section-head">
          <div>
            <span className="card-label">{target.assetType === "trailer" ? "Trailer" : "Vehicle"} · {profile.fleetCode}</span>
            <h2>{profile.vehicle}</h2>
            <p className="finance-empty">{profile.make} · {profile.currentKmLabel}</p>
          </div>
          <button className="header-action-button" type="button" onClick={onClose}>Close</button>
        </div>

        {successMessage && <p className="lp-success">{successMessage}</p>}

        <div className="maintenance-profile-items vehicle-detail-items">
          {profile.items.map((item) => {
            const code = TYPE_TO_CODE[item.type] || item.type;
            const color = EVENT_COLORS[code] || { bg: "#94a3b8", text: "#fff" };
            const isSelectedUpcoming = activeType === item.type
              && target?.preselectType === item.type
              && Boolean(target?.scheduledDueDate)
              && target?.selectionKind !== "completed";
            return (
              <div
                className={`maintenance-profile-item${activeType === item.type ? " active" : ""}`}
                key={item.type}
                role="button"
                tabIndex={0}
                onClick={() => openItem(item.type)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    openItem(item.type);
                  }
                }}
              >
                <span className="vehicle-detail-item-code" style={{ background: color.bg, color: color.text }}>{code}</span>
                <strong>{item.type}</strong>
                <p>Last done: {item.lastDone}{item.lastDoneKm ? ` · ${Number(item.lastDoneKm).toLocaleString("en-GB")} km` : ""}</p>
                <p>Next due: {item.nextDue}</p>
                <StatusPill tone={isSelectedUpcoming ? "danger" : item.tone}>
                  {isSelectedUpcoming ? "Upcoming" : item.status}
                </StatusPill>
                {item.hasAttachment && !isSelectedUpcoming && (
                  <div className="vehicle-detail-item-document">
                    <button
                      type="button"
                      className="vehicle-detail-item-doc-link"
                      onClick={(e) => {
                        e.stopPropagation();
                        openAttachment(item.attachmentData);
                      }}
                    >
                      View last document
                    </button>
                    {item.documentSubmittedAt && <small>Submitted: {item.documentSubmittedAt}</small>}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {activeType && (
          <form className="vehicle-detail-done-form" onSubmit={submit}>
            <div className="section-head">
              <div>
                <h3>{isEditingCompleted ? "Update" : "Mark"} {activeType} {isEditingCompleted ? "Completion" : "As Done"}</h3>
                <p className="finance-empty">Keep the actual test date here. You can attach the certificate later without changing when the work was done.</p>
              </div>
              <button className="header-action-button" type="button" onClick={() => setActiveType(null)}>Cancel</button>
            </div>
            {nextDue && (
              <div className="event-done-next-due">
                <span>Next due date will be set to</span>
                <strong>{nextDue}</strong>
              </div>
            )}
            {activeType === "Road Tax" && (
              <Field label="Road Tax Period">
                <select className="af-select" value={form.road_tax_interval_months} onChange={(e) => set("road_tax_interval_months", e.target.value)}>
                  <option value="6">6 months</option>
                  <option value="12">12 months</option>
                </select>
              </Field>
            )}
            <div className="maintenance-form-grid">
              <Field label="Date Done">
                <input className="af-input" type="date" value={form.service_date} onChange={(e) => set("service_date", e.target.value)} required />
              </Field>
              <Field label="Garage / Vendor">
                <input className="af-input" value={form.garage_name} onChange={(e) => set("garage_name", e.target.value)} placeholder="Workshop or vendor name" />
              </Field>
              <Field label="Cost (£)">
                <input className="af-input" type="number" min="0" step="0.01" value={form.final_cost_gbp} onChange={(e) => set("final_cost_gbp", e.target.value)} />
              </Field>
              {target.assetType !== "trailer" && (
                <Field label="Odometer Reading (KM)">
                  <input className="af-input" type="number" min="0" step="1" value={form.completed_mileage_km} onChange={(e) => set("completed_mileage_km", e.target.value)} placeholder="e.g. 45230" />
                </Field>
              )}
              <Field label="Bill / Invoice Number">
                <input className="af-input" value={form.bill_number} onChange={(e) => set("bill_number", e.target.value)} placeholder="e.g. INV-9821" />
              </Field>
              <Field label="Bill Amount (£)">
                <input className="af-input" type="number" min="0" step="0.01" value={form.bill_amount_gbp} onChange={(e) => set("bill_amount_gbp", e.target.value)} />
              </Field>
              <Field label="Attach Document / Certificate">
                <input className="af-input" type="file" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx"
                  onChange={(e) => readFileAsDataUrl(e.target.files?.[0], (v) => set("bill_attachment_data", v))} />
              </Field>
              <Field label="Notes">
                <textarea className="af-textarea" value={form.bill_notes} onChange={(e) => set("bill_notes", e.target.value)} rows={2} placeholder="Certificate number, MOT pass notes, inspector..." />
              </Field>
              <div className="maintenance-rule-note">
                <span>Document</span>
                <strong>{form.bill_attachment_data ? "Document attached" : "No document"}</strong>
                {form.bill_attachment_data && (
                  <button
                    className="vehicle-detail-item-doc-link"
                    type="button"
                    onClick={() => openAttachment(form.bill_attachment_data)}
                  >
                    View document
                  </button>
                )}
              </div>
            </div>
            {error && <p className="lp-error">{error}</p>}
            <div className="finance-command-bar">
              <button className="header-action-button" type="button" onClick={() => setActiveType(null)}>Cancel</button>
              <button className="af-submit-btn" disabled={saving} type="submit">
                {saving ? "Saving..." : isEditingCompleted ? `Update ${activeType}` : `Mark ${activeType} Done`}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function BreakdownModal({ vehicles, onClose, onSaved }) {
  const [form, setForm] = useState({
    asset_id: "",
    defect_type: "",
    description: "",
    severity: "high",
    garage_name: "",
    estimated_cost_gbp: "",
    bill_number: "",
    bill_amount_gbp: "",
    bill_notes: "",
    bill_attachment_data: "",
    reported_by: ""
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function set(name, value) {
    setForm((c) => ({ ...c, [name]: value }));
  }

  async function submit(e) {
    e.preventDefault();
    if (!form.asset_id || !form.defect_type) {
      setError("Select an asset and enter the problem type.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await reportBreakdown(form);
      await onSaved();
      onClose();
    } catch (err) {
      setError(err.response?.data?.message || "Could not report breakdown.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="maintenance-modal-backdrop">
      <form className="maintenance-modal breakdown-modal" onSubmit={submit}>
        <div className="section-head">
          <div>
            <span className="card-label">Breakdown / Defect Report</span>
            <h2>Report Vehicle or Trailer Problem</h2>
            <p className="finance-empty">Creates a defect record and a linked repair job immediately.</p>
          </div>
          <button className="header-action-button" type="button" onClick={onClose}>Close</button>
        </div>
        <div className="maintenance-form-grid" style={{ padding: "0 24px" }}>
          <Field label="Vehicle / Trailer">
            <select className="af-select" value={form.asset_id} onChange={(e) => set("asset_id", e.target.value)} required>
              <option value="">Select Asset</option>
              {vehicles.filter((v) => v.assetType !== "trailer").map((v) => <option key={v.assetId} value={v.assetId}>{v.label}</option>)}
              <optgroup label="── Trailers ──">
                {vehicles.filter((v) => v.assetType === "trailer").map((v) => <option key={v.assetId} value={v.assetId}>{v.label}</option>)}
              </optgroup>
            </select>
          </Field>
          <Field label="Problem / Defect Type">
            <input className="af-input" value={form.defect_type} onChange={(e) => set("defect_type", e.target.value)} placeholder="e.g. Brake failure, Tyre blowout, Engine fault" required />
          </Field>
          <Field label="Severity">
            <select className="af-select" value={form.severity} onChange={(e) => set("severity", e.target.value)}>
              {severityOptions.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Reported By">
            <input className="af-input" value={form.reported_by} onChange={(e) => set("reported_by", e.target.value)} placeholder="Driver or staff name" />
          </Field>
          <Field label="Description / Details">
            <textarea className="af-textarea" value={form.description} onChange={(e) => set("description", e.target.value)} rows={3} placeholder="Describe the breakdown or fault..." />
          </Field>
          <Field label="Vendor / Garage Sent To">
            <input className="af-input" value={form.garage_name} onChange={(e) => set("garage_name", e.target.value)} placeholder="Recovery company or garage" />
          </Field>
          <Field label="Estimated Cost (£)">
            <input className="af-input" type="number" min="0" step="0.01" value={form.estimated_cost_gbp} onChange={(e) => set("estimated_cost_gbp", e.target.value)} />
          </Field>
          <Field label="Bill / Invoice Number">
            <input className="af-input" value={form.bill_number} onChange={(e) => set("bill_number", e.target.value)} placeholder="e.g. INV-1234" />
          </Field>
          <Field label="Bill Amount (£)">
            <input className="af-input" type="number" min="0" step="0.01" value={form.bill_amount_gbp} onChange={(e) => set("bill_amount_gbp", e.target.value)} />
          </Field>
          <Field label="Attach Bill / Slip">
            <input className="af-input" type="file" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx"
              onChange={(e) => readFileAsDataUrl(e.target.files?.[0], (v) => set("bill_attachment_data", v))} />
          </Field>
          <Field label="Document Notes">
            <textarea className="af-textarea" value={form.bill_notes} onChange={(e) => set("bill_notes", e.target.value)} rows={2} placeholder="Repair invoice note, receipt reference..." />
          </Field>
        </div>
        {error && <p className="lp-error" style={{ padding: "0 24px" }}>{error}</p>}
        <div className="finance-command-bar">
          <button className="header-action-button" type="button" onClick={onClose}>Cancel</button>
          <button className="af-submit-btn" disabled={saving} type="submit">
            {saving ? "Reporting..." : "Report Breakdown & Create Job"}
          </button>
        </div>
      </form>
    </div>
  );
}

function VorModal({ vehicles, profiles, onClose, onSaved }) {
  const [assetId, setAssetId] = useState("");
  const [reason, setReason] = useState("");
  const [since, setSince] = useState(() => dateKey(new Date()));
  const [till, setTill] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const selectedProfile = useMemo(() => {
    if (!assetId) return null;
    const [type, id] = assetId.split(":");
    const wantsTrailer = type === "trailer";
    return profiles.find((p) => Number(p.vehicleId) === Number(id) && Boolean(p.assetType === "trailer") === wantsTrailer) || null;
  }, [assetId, profiles]);

  const isCurrentlyVor = selectedProfile?.status === "maintenance" && Boolean(selectedProfile?.vorReason);

  async function markOffRoad(e) {
    e.preventDefault();
    if (!assetId) { setError("Select a vehicle or trailer."); return; }
    if (!reason.trim()) { setError("Reason is required."); return; }
    if (till && since && till < since) { setError("Expected back date cannot be before the off road since date."); return; }
    setSaving(true);
    setError("");
    try {
      await setVorStatus({ asset_id: assetId, reason: reason.trim(), since: since || null, till: till || null });
      await onSaved();
      onClose();
    } catch (err) {
      setError(err.response?.data?.message || "Could not mark vehicle off road.");
    } finally {
      setSaving(false);
    }
  }

  async function markBackOnRoad() {
    setSaving(true);
    setError("");
    try {
      await setVorStatus({ asset_id: assetId, on_road: true });
      await onSaved();
      onClose();
    } catch (err) {
      setError(err.response?.data?.message || "Could not mark vehicle back on road.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="maintenance-modal-backdrop">
      <form className="maintenance-modal compact" onSubmit={markOffRoad}>
        <div className="section-head">
          <div>
            <span className="card-label">VOR</span>
            <h2>Vehicle Off Road</h2>
          </div>
          <button className="header-action-button" type="button" onClick={onClose}>Close</button>
        </div>
        <div className="maintenance-form-grid">
          <Field label="Vehicle / Trailer">
            <select className="af-select" value={assetId} onChange={(e) => { setAssetId(e.target.value); setError(""); }} required>
              <option value="">Select Vehicle or Trailer</option>
              {vehicles.filter((v) => v.assetType !== "trailer").map((v) => <option key={v.assetId} value={v.assetId}>{v.label}</option>)}
              <optgroup label="── Trailers ──">
                {vehicles.filter((v) => v.assetType === "trailer").map((v) => <option key={v.assetId} value={v.assetId}>{v.label}</option>)}
              </optgroup>
            </select>
          </Field>
        </div>

        {isCurrentlyVor ? (
          <>
            <div className="maintenance-rule-note">
              <span>Off road: {selectedProfile.vorMarkedAt} → {selectedProfile.vorTill || "Ongoing (no return date set)"}</span>
              <strong>{selectedProfile.vorReason}</strong>
            </div>
            {error && <p className="lp-error">{error}</p>}
            <div className="finance-command-bar">
              <button className="header-action-button" type="button" onClick={onClose}>Cancel</button>
              <button className="af-submit-btn" disabled={saving} type="button" onClick={markBackOnRoad}>
                {saving ? "Saving..." : "Mark Back On Road"}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="maintenance-form-grid">
              <Field label="Off Road Since">
                <input className="af-input" type="date" value={since} onChange={(e) => { setSince(e.target.value); setError(""); }} required />
              </Field>
              <Field label="Expected Back On Road (optional)">
                <input className="af-input" type="date" value={till} min={since || undefined} onChange={(e) => { setTill(e.target.value); setError(""); }} />
              </Field>
            </div>
            <div className="maintenance-form-grid single">
              <Field label="Reason">
                <textarea className="af-textarea" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="e.g. Awaiting parts, MOT failure, accident damage..." required />
              </Field>
            </div>
            {error && <p className="lp-error">{error}</p>}
            <div className="finance-command-bar">
              <button className="header-action-button" type="button" onClick={onClose}>Cancel</button>
              <button className="af-submit-btn" disabled={saving || !assetId} type="submit">
                {saving ? "Saving..." : "Mark Off Road"}
              </button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}

function ExportJobsModal({ vehicles, weeks, jobs, onClose }) {
  const [assetId, setAssetId] = useState("");
  const [fromWeekKey, setFromWeekKey] = useState("");
  const [toWeekKey, setToWeekKey] = useState("");

  function runExport() {
    const [assetType, assetNumericId] = assetId ? assetId.split(":") : [null, null];
    const fromWeek = weeks.find((w) => w.key === fromWeekKey);
    const toWeek = weeks.find((w) => w.key === toWeekKey);
    const startRaw = fromWeek?.startRaw || null;
    const endRaw = toWeek?.endRaw || null;

    const filtered = jobs.filter((job) => {
      if (assetType) {
        const jobAssetType = job.assetType === "trailer" ? "trailer" : "vehicle";
        if (jobAssetType !== assetType) return false;
        const jobAssetId = assetType === "trailer" ? job.trailerId : job.vehicleId;
        if (Number(jobAssetId) !== Number(assetNumericId)) return false;
      }
      if (startRaw && (!job.dueDateRaw || job.dueDateRaw < startRaw)) return false;
      if (endRaw && (!job.dueDateRaw || job.dueDateRaw > endRaw)) return false;
      return true;
    });

    const header = ["Job Number", "Vehicle", "Fleet Code", "Service Type", "Due Date", "Status", "Priority", "Garage", "Mechanic", "Cost", "Bill Number", "Bill Amount", "Bill Status"];
    const rows = filtered.map((job) => [
      job.jobNumber, job.vehicle, job.fleetCode, job.serviceType, job.dueDate, job.statusLabel,
      job.priority, job.garageName, job.assignedMechanic, job.costLabel,
      job.billNumber, job.billAmountLabel, job.billStatus
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`).join(","))
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    const vehicleSlug = assetId ? (vehicles.find((v) => v.assetId === assetId)?.label || "vehicle").split(" ")[0] : "all-vehicles";
    const weekSlug = (fromWeek || toWeek) ? `${fromWeek?.label || "start"}-${toWeek?.label || "end"}` : "all-weeks";
    link.download = `maintenance-jobs-${vehicleSlug}-${weekSlug}-${dateKey(new Date())}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    onClose();
  }

  return (
    <div className="maintenance-modal-backdrop">
      <div className="maintenance-modal compact">
        <div className="section-head">
          <div>
            <span className="card-label">Export</span>
            <h2>Export Maintenance Jobs To Excel</h2>
          </div>
          <button className="header-action-button" type="button" onClick={onClose}>Close</button>
        </div>
        <p className="finance-empty">Leave a filter on "All" to include everything for that filter.</p>
        <div className="maintenance-form-grid">
          <Field label="Vehicle / Trailer">
            <select className="af-select" value={assetId} onChange={(e) => setAssetId(e.target.value)}>
              <option value="">All vehicles &amp; trailers</option>
              {vehicles.filter((v) => v.assetType !== "trailer").map((v) => <option key={v.assetId} value={v.assetId}>{v.label}</option>)}
              <optgroup label="── Trailers ──">
                {vehicles.filter((v) => v.assetType === "trailer").map((v) => <option key={v.assetId} value={v.assetId}>{v.label}</option>)}
              </optgroup>
            </select>
          </Field>
          <Field label="From Week">
            <select className="af-select" value={fromWeekKey} onChange={(e) => setFromWeekKey(e.target.value)}>
              <option value="">Start of year</option>
              {weeks.map((w) => <option key={w.key} value={w.key}>{w.label} · {w.range}</option>)}
            </select>
          </Field>
          <Field label="To Week">
            <select className="af-select" value={toWeekKey} onChange={(e) => setToWeekKey(e.target.value)}>
              <option value="">End of year</option>
              {weeks.map((w) => <option key={w.key} value={w.key}>{w.label} · {w.range}</option>)}
            </select>
          </Field>
        </div>
        <div className="finance-command-bar">
          <button className="header-action-button" type="button" onClick={onClose}>Cancel</button>
          <button className="af-submit-btn" type="button" onClick={runExport}>Export CSV</button>
        </div>
      </div>
    </div>
  );
}

function JobDrawer({ job, history, onClose, onEdit, onComplete, onBillStatus, savingAction }) {
  const [notes, setNotes] = useState([]);
  const [noteText, setNoteText] = useState("");
  const [authorName, setAuthorName] = useState(() => getAuthSession()?.name || "");
  const [addingNote, setAddingNote] = useState(false);
  const [noteError, setNoteError] = useState("");

  useEffect(() => {
    if (!job) return;
    setNotes([]);
    setNoteText("");
    setNoteError("");
    getJobNotes(job.id).then((res) => setNotes(res.data.notes || [])).catch(() => {});
  }, [job?.id]);

  async function submitNote(e) {
    e.preventDefault();
    if (!noteText.trim()) return;
    setAddingNote(true);
    setNoteError("");
    try {
      await addJobNote(job.id, { note_text: noteText.trim(), author_name: authorName.trim() || "Admin" });
      const res = await getJobNotes(job.id);
      setNotes(res.data.notes || []);
      setNoteText("");
    } catch (err) {
      setNoteError(err.response?.data?.message || "Could not add note.");
    } finally {
      setAddingNote(false);
    }
  }

  if (!job) return null;
  const vehicleHistory = history.filter((item) => {
    if (job.assetType === "trailer") {
      return item.assetType === "trailer" && Number(item.trailerId) === Number(job.trailerId);
    }
    return item.assetType !== "trailer" && Number(item.vehicleId) === Number(job.vehicleId);
  }).slice(0, 10);
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
        <div><span>Bill status</span><strong>{job.billStatus} · {job.billPaymentStatus}</strong></div>
        <div><span>Vehicle type</span><strong>{job.truckType}</strong></div>
        <div><span>Date done</span><strong>{job.serviceDateRaw ? job.serviceDate : "-"}</strong></div>
        <div><span>Mileage</span><strong>{job.mileageLabel}</strong></div>
      </div>
      {(job.billNotes !== "-" || job.billAttachmentData) && (
        <section className="maintenance-drawer-section">
          <span className="card-label">Documents And Paperwork</span>
          <p><strong>Bill date:</strong> {job.billDateRaw ? job.billDate : "-"}</p>
          <p><strong>Document notes:</strong> {job.billNotes}</p>
          {job.billAttachmentData && (
            <button
              type="button"
              className="header-action-button maintenance-bill-link"
              onClick={() => openAttachment(job.billAttachmentData)}
            >
              Open attached document
            </button>
          )}
        </section>
      )}
      <div className="maintenance-drawer-actions">
        <button className="header-action-button" type="button" onClick={() => onEdit(job)}>Edit Job</button>
        {job.billStatus === "pending" && (job.billAmountGbp || job.billAttachmentData) && (
          <>
            <button className="header-action-button" disabled={savingAction === `bill-${job.id}`} type="button" onClick={() => onBillStatus(job, "approved")}>Approve Bill</button>
            <button className="header-action-button danger" disabled={savingAction === `bill-${job.id}`} type="button" onClick={() => onBillStatus(job, "rejected")}>Reject Bill</button>
          </>
        )}
        {job.billStatus === "approved" && job.billPaymentStatus !== "paid" && (
          <button className="header-action-button" disabled={savingAction === `bill-${job.id}`} type="button" onClick={() => onBillStatus(job, "paid", "paid")}>Mark Bill Paid</button>
        )}
        {!["completed", "cancelled", "failed"].includes(job.status) && (
          <button className="af-submit-btn" type="button" onClick={() => onComplete(job)}>Mark complete</button>
        )}
      </div>
      <section className="maintenance-drawer-section">
        <span className="card-label">Job Card</span>
        <p><strong>Problem/service:</strong> {job.serviceType}</p>
        <p><strong>Parts required:</strong> {job.partsRequired}</p>
        <p><strong>Breakdown/problem note:</strong> {job.notes}</p>
        <p><strong>Completion:</strong> {job.completionNotes}</p>
      </section>

      <section className="maintenance-drawer-section">
        <span className="card-label">Job Notes</span>
        <div className="maintenance-job-notes-list">
          {notes.length === 0 && <p className="finance-empty">No notes yet. Add the first note below.</p>}
          {notes.map((note) => (
            <div className="maintenance-job-note" key={note.id}>
              <div className="maintenance-job-note-header">
                <strong>{note.author_name}</strong>
                <span>{new Date(note.created_at).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
              </div>
              <p>{note.note_text}</p>
            </div>
          ))}
        </div>
        <form className="maintenance-job-note-form" onSubmit={submitNote}>
          <input
            className="af-input"
            placeholder="Your name"
            value={authorName}
            onChange={(e) => setAuthorName(e.target.value)}
            required
          />
          <textarea
            className="af-textarea"
            placeholder="Add a note — e.g. issue found, part ordered, update from garage..."
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            rows={3}
            required
          />
          {noteError && <p className="lp-error">{noteError}</p>}
          <button className="header-action-button" disabled={addingNote || !noteText.trim()} type="submit">
            {addingNote ? "Saving..." : "Add Note"}
          </button>
        </form>
      </section>

      <section className="maintenance-drawer-section">
        <span className="card-label">Service History Timeline</span>
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

const EVENT_COLORS = {
  TAX: { bg: "#f97316", text: "#fff", label: "Road Tax" },
  IB:  { bg: "#3b82f6", text: "#fff", label: "Inspection & Brake test" },
  MOT: { bg: "#eab308", text: "#1a1a1a", label: "Ministry of Transport" },
  VOR: { bg: "#14b8a6", text: "#fff", label: "Vechile Off Road" },
  INS: { bg: "#22c55e", text: "#fff", label: "Insurance" },
  T:   { bg: "#a855f7", text: "#fff", label: "Tacho" },
  SRV: { bg: "#64748b", text: "#fff", label: "Full Service" }
};

const COMPANY_COLORS = [
  "#c0392b", "#1a5276", "#117a65", "#6c3483", "#784212", "#0e6655", "#1f3a5f"
];

const TYPE_TO_CODE = {
  "Road Tax": "TAX",
  "Safety inspection": "IB",
  MOT: "MOT",
  "Roller brake test": "IB",
  Insurance: "INS",
  "Tacho Calibration": "T",
  "Full Service": "SRV"
};

function formatWeekStart(dateStr) {
  if (!dateStr) return "";
  const date = new Date(`${dateStr}T00:00:00`);
  const day = String(date.getDate()).padStart(2, "0");
  const month = date.toLocaleDateString("en-GB", { month: "short" });
  return `${day}-${month}`;
}

function isoWeekNumber(dateStr) {
  if (!dateStr) return 0;
  const d = new Date(`${dateStr}T12:00:00`);
  const year = d.getFullYear();
  const jan1 = new Date(year, 0, 1);
  const dow = jan1.getDay(); // 0=Sun,1=Mon,...
  const daysToFirstMonday = dow === 1 ? 0 : dow === 0 ? 1 : 8 - dow;
  const firstMonday = new Date(year, 0, 1 + daysToFirstMonday);
  if (d < firstMonday) return 0;
  return Math.floor((d - firstMonday) / 604800000) + 1;
}

function eventBelongsToWeek(event, week) {
  if (event.kind === "completed") {
    const eventDate = event.dueDateRaw;
    return Boolean(eventDate && eventDate >= week.startRaw && eventDate <= week.endRaw);
  }
  return event.weekKey === week.key;
}

function uniqueWeekEvents(events) {
  const completed = new Map();
  const scheduled = [];
  for (const event of events) {
    if (event.kind !== "completed") {
      scheduled.push(event);
      continue;
    }
    const key = `${event.kind}-${event.vehicleId}-${event.assetType || "vehicle"}-${event.type}`;
    const current = completed.get(key);
    if (!current || String(event.dueDateRaw || "") > String(current.dueDateRaw || "")) {
      completed.set(key, event);
    }
  }
  const completedEvents = [...completed.values()];
  const completedScheduleKeys = new Set(completedEvents.map((event) =>
    `${event.vehicleId}-${event.assetType || "vehicle"}-${event.type}-${event.dueDateRaw}`
  ));
  const seen = new Set(completedEvents.map((event) =>
    `${event.kind}-${event.vehicleId}-${event.assetType || "vehicle"}-${event.type}`
  ));
  return [
    ...completedEvents,
    ...scheduled.filter((event) => {
      const scheduleKey = `${event.vehicleId}-${event.assetType || "vehicle"}-${event.type}-${event.dueDateRaw}`;
      if (completedScheduleKeys.has(scheduleKey)) return false;
      const key = event.kind === "completed"
      ? `${event.kind}-${event.vehicleId}-${event.assetType || "vehicle"}-${event.type}-${event.dueDateRaw}`
      : event.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
  ];
}

function groupCompletedByDate(events) {
  const completed = events.filter((event) => event.kind === "completed");
  const others = events.filter((event) => event.kind !== "completed");
  if (completed.length <= 1) return events;
  const items = [...completed].sort((a, b) =>
    String(a.completedDateRaw || a.dueDateRaw || "").localeCompare(String(b.completedDateRaw || b.dueDateRaw || ""))
  );
  const firstCompletedDateRaw = items[0].completedDateRaw || items[0].dueDateRaw;
  const sameDate = items.every((event) => (event.completedDateRaw || event.dueDateRaw) === firstCompletedDateRaw);
  const group = {
    id: `group-${items.map((item) => item.id).join("-")}`,
    kind: "completed-group",
    dueDateRaw: items[0].dueDateRaw,
    completedDateRaw: firstCompletedDateRaw,
    dueDate: items[0].dueDate,
    sameDate,
    items
  };
  return [group, ...others];
}

function isGeneratedMaintenanceNote(note) {
  return /^auto-created/i.test(String(note || "").trim());
}

const fleetCodeSorter = new Intl.Collator("en-GB", {
  numeric: true,
  sensitivity: "base"
});

function parseFleetCodeForSort(code) {
  const raw = String(code || "").trim();
  const compact = raw.replace(/[\s-]+/g, "");
  const match = compact.match(/^([A-Za-z]*)(\d+)$/);
  if (!match) return { raw, prefix: compact.toUpperCase(), number: null };
  return {
    raw,
    prefix: match[1].toUpperCase(),
    number: Number(match[2])
  };
}

function compareScheduleRows(a, b) {
  const aIsTrailer = a.assetType === "trailer";
  const bIsTrailer = b.assetType === "trailer";
  if (aIsTrailer !== bIsTrailer) return aIsTrailer ? 1 : -1;

  const aCode = String(a.fleetCode || "").trim();
  const bCode = String(b.fleetCode || "").trim();
  if (!aCode && bCode) return 1;
  if (aCode && !bCode) return -1;
  const aSort = parseFleetCodeForSort(aCode);
  const bSort = parseFleetCodeForSort(bCode);
  const byPrefix = fleetCodeSorter.compare(aSort.prefix, bSort.prefix);
  if (byPrefix !== 0) return byPrefix;
  const byFleetCode = aSort.number != null && bSort.number != null
    ? aSort.number - bSort.number
    : fleetCodeSorter.compare(aSort.raw, bSort.raw);
  if (byFleetCode !== 0) return byFleetCode;
  return fleetCodeSorter.compare(String(a.vehicle || ""), String(b.vehicle || ""));
}

function ExcelScheduleView({ data, onOpenVehicle }) {
  const [search, setSearch] = useState("");
  const [selectedWeekKey, setSelectedWeekKey] = useState("");
  const [popover, setPopover] = useState(null); // { ev, x, y }
  const scheduleWrapRef = useRef(null);
  const popoverTimer = useRef(null);
  const weeks = useMemo(() => data?.yearPlan?.weeks || [], [data]);
  const allRows = useMemo(() => data?.yearPlan?.rows || [], [data]);

  const monthGroups = useMemo(() => {
    const groups = [];
    let current = null;
    for (const week of weeks) {
      const month = week.month;
      if (!current || current.month !== month) {
        current = { month, count: 1, key: week.key };
        groups.push(current);
      } else {
        current.count++;
      }
    }
    return groups;
  }, [weeks]);

  const filteredRows = useMemo(() => {
    const q = search.toLowerCase();
    const rows = search.trim()
      ? allRows.filter(row =>
          row.vehicle?.toLowerCase().includes(q) ||
          row.fleetCode?.toLowerCase().includes(q) ||
          row.make?.toLowerCase().includes(q) ||
          row.companyName?.toLowerCase().includes(q)
        )
      : allRows;
    return [...rows].sort(compareScheduleRows);
  }, [allRows, search]);

  const companies = useMemo(() => {
    const map = new Map();
    for (const row of filteredRows) {
      const co = row.companyName || "Fleet";
      if (!map.has(co)) map.set(co, []);
      map.get(co).push(row);
    }
    return [...map.entries()];
  }, [filteredRows]);

  const currentWeekKey = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return weeks.find((week) => today >= week.startRaw && today <= week.endRaw)?.key || weeks[0]?.key || "";
  }, [weeks]);

  const selectedWeek = weeks.find((week) => week.key === selectedWeekKey) || null;

  const selectedWeekItems = useMemo(() => {
    if (!selectedWeek) return [];
    return filteredRows.flatMap((row) => {
      const events = uniqueWeekEvents((row.events || []).filter((ev) => eventBelongsToWeek(ev, selectedWeek)));
      return events.map((event) => ({
        ...event,
        rowVehicle: row.vehicle,
        rowFleetCode: row.fleetCode,
        rowMake: row.make,
        rowAssetType: row.assetType === "trailer" ? "Trailer" : "Vehicle"
      }));
    }).sort((a, b) => {
      const byDate = String(a.dueDateRaw || "").localeCompare(String(b.dueDateRaw || ""));
      if (byDate !== 0) return byDate;
      return fleetCodeSorter.compare(String(a.rowFleetCode || ""), String(b.rowFleetCode || ""));
    });
  }, [filteredRows, selectedWeek]);

  useEffect(() => {
    if (!weeks.length || selectedWeekKey) return;
    setSelectedWeekKey(currentWeekKey);
  }, [currentWeekKey, selectedWeekKey, weeks]);

  useEffect(() => {
    if (!selectedWeekKey || !scheduleWrapRef.current) return;
    const weekIndex = weeks.findIndex((week) => week.key === selectedWeekKey);
    if (weekIndex < 0) return;

    // Each week column is 64px wide. Since the four asset columns are sticky,
    // scrolling by the selected week's index places it directly beside them.
    const frame = window.requestAnimationFrame(() => {
      scheduleWrapRef.current?.scrollTo({
        left: weekIndex * 64,
        behavior: "auto"
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selectedWeekKey, weeks]);

  const totalCols = 4 + weeks.length;

  if (!weeks.length) {
    return <p className="finance-empty">No annual schedule data available.</p>;
  }

  const legendChips = [
    <span key="upcoming" className="excel-legend-chip" style={{ background: "#dc2626", color: "#fff" }}>UPCOMING</span>,
    <span key="completed" className="excel-legend-chip" style={{ background: "#16a34a", color: "#fff" }}>DONE</span>,
    ...Object.entries(EVENT_COLORS).map(([code, { bg, text, label }]) => (
      <span key={code} className="excel-legend-chip" style={{ background: bg, color: text }} title={label}>{code}</span>
    ))
  ];

  return (
    <>
      <div className="schedule-search-bar">
        <div className="schedule-search-field">
          <input
            className="af-input"
            placeholder="Search reg number, trailer, make/model, fleet code, or company..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <span className="schedule-search-count">
              {filteredRows.length} of {allRows.length} vehicles
            </span>
          )}
          <select
            className="af-select schedule-week-select"
            value={selectedWeekKey}
            onChange={(event) => setSelectedWeekKey(event.target.value)}
            aria-label="Jump to week"
          >
            {weeks.map((week) => (
              <option key={week.key} value={week.key}>
                {week.label} · {formatWeekStart(week.startRaw)}
              </option>
            ))}
          </select>
        </div>
        <div className="schedule-legend-chips" aria-label="Maintenance schedule legend">
          {legendChips}
        </div>
      </div>
      {selectedWeek && (
        <div className="schedule-week-summary">
          <div>
            <strong>{selectedWeek.label} · {selectedWeek.range}</strong>
            <span>{selectedWeekItems.length} maintenance item{selectedWeekItems.length === 1 ? "" : "s"}</span>
          </div>
          <div className="schedule-week-summary-list">
            {selectedWeekItems.slice(0, 10).map((item) => (
              <button
                key={`${item.id}-${item.rowAssetType}`}
                className="schedule-week-summary-item"
                type="button"
                onClick={() => onOpenVehicle({
                  vehicleId: item.vehicleId,
                  assetType: item.rowAssetType === "Trailer" ? "trailer" : "vehicle"
                }, item.rowAssetType === "Trailer" ? "trailer" : "vehicle", item.type, item.dueDateRaw, item.kind, item.jobId)}
              >
                <span className="schedule-week-summary-code">{item.code}</span>
                <strong>{item.rowFleetCode || item.rowVehicle}</strong>
                <small>{item.rowVehicle} · {item.type} · {item.dueDate}</small>
              </button>
            ))}
            {selectedWeekItems.length === 0 && <span className="schedule-week-empty">No maintenance items in this week.</span>}
            {selectedWeekItems.length > 10 && <span className="schedule-week-more">+{selectedWeekItems.length - 10} more in table</span>}
          </div>
        </div>
      )}
    <div className="excel-schedule-wrap" ref={scheduleWrapRef}>
      <table
        className="excel-schedule-table"
        style={{ width: `${510 + (weeks.length * 64)}px` }}
      >
        <colgroup>
          <col className="excel-reg-col" />
          <col className="excel-fleet-code-col" />
          <col className="excel-freq-col" />
          <col className="excel-make-col" />
          {weeks.map((week) => (
            <col className="excel-week-col" key={`col-${week.key}`} />
          ))}
        </colgroup>
        <thead>
          <tr className="excel-month-row">
            <th className="excel-fixed-head">REG</th>
            <th className="excel-fixed-head">Fleet Code</th>
            <th className="excel-fixed-head">Inspection Frequency</th>
            <th className="excel-fixed-head">Make</th>
            {monthGroups.map((group) => (
              <th key={group.key} colSpan={group.count} className="excel-month-head">
                {group.month.toUpperCase()}
              </th>
            ))}
          </tr>
          <tr className="excel-date-row">
            <th className="excel-fixed-head excel-fixed-head-spacer" aria-hidden="true" />
            <th className="excel-fixed-head excel-fixed-head-spacer" aria-hidden="true" />
            <th className="excel-fixed-head excel-fixed-head-spacer" aria-hidden="true" />
            <th className="excel-fixed-head excel-fixed-head-spacer" aria-hidden="true" />
            {weeks.map((week) => (
              <th
                key={week.key}
                className={`excel-date-head${week.key === selectedWeekKey ? " selected-week" : ""}`}
                title="Week commencing (Monday)"
              >
                {formatWeekStart(week.startRaw)}
              </th>
            ))}
          </tr>
          <tr className="excel-week-row">
            <th className="excel-fixed-head excel-fixed-head-spacer" aria-hidden="true" />
            <th className="excel-fixed-head excel-fixed-head-spacer" aria-hidden="true" />
            <th className="excel-fixed-head excel-fixed-head-spacer" aria-hidden="true" />
            <th className="excel-fixed-head excel-fixed-head-spacer" aria-hidden="true" />
            {weeks.map((week) => (
              <th
                key={week.key}
                className={`excel-week-head${week.key === selectedWeekKey ? " selected-week" : ""}`}
              >
                {week.label || `WK${isoWeekNumber(week.startRaw || week.key)}`}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {companies.map(([company, rows], coIndex) => (
            <React.Fragment key={`co-${company}`}>
              <tr className="excel-company-row">
                <td
                  colSpan={4}
                  className="excel-company-cell excel-company-label-cell"
                  style={{ background: COMPANY_COLORS[coIndex % COMPANY_COLORS.length] }}
                >
                  {company.toUpperCase()}
                </td>
                <td
                  colSpan={weeks.length}
                  className="excel-company-cell"
                  style={{ background: COMPANY_COLORS[coIndex % COMPANY_COLORS.length] }}
                  aria-hidden="true"
                />
              </tr>
              {rows.map((row, rowIndex) => {
                const assetType = row.assetType === "trailer" ? "trailer" : "vehicle";
                const isFirstTrailer = assetType === "trailer" && rows[rowIndex - 1]?.assetType !== "trailer";
                return (
                <tr
                  key={`${assetType}-${row.vehicleId}`}
                  className={`excel-vehicle-row${isFirstTrailer ? " excel-trailer-start" : ""}`}
                >
                  <td className="excel-reg-cell" onClick={() => onOpenVehicle(row, assetType)} title="Click to open vehicle details">
                    <strong>{row.vehicle}</strong>
                  </td>
                  <td className="excel-fleet-code-cell" onClick={() => onOpenVehicle(row, assetType)}>{row.fleetCode}</td>
                  <td className="excel-freq-cell" onClick={() => onOpenVehicle(row, assetType)}>{row.inspectionFrequency}</td>
                  <td className="excel-make-cell" onClick={() => onOpenVehicle(row, assetType)}>{row.make}</td>
                  {weeks.map((week) => {
                    const events = groupCompletedByDate(uniqueWeekEvents((row.events || []).filter((ev) => eventBelongsToWeek(ev, week))));
                    return (
                      <td
                        key={`${row.vehicleId}-${week.key}`}
                        className={`excel-event-cell${week.key === selectedWeekKey ? " selected-week" : ""}`}
                        onClick={() => onOpenVehicle(row, assetType)}
                        title="Click to open vehicle details"
                      >
                        {events.map((ev) => {
                          if (ev.kind === "completed-group") {
                            const actualDateRaw = ev.completedDateRaw || ev.dueDateRaw;
                            const day = actualDateRaw?.slice(8, 10);
                            const mon = actualDateRaw?.slice(5, 7);
                            const codes = ev.items.map((item) => item.code).join("+");
                            const label = ev.sameDate ? `✓ ${codes} ${day}/${mon}` : `✓ ${codes}`;
                            return (
                              <button
                                key={ev.id}
                                className="excel-event-chip completed"
                                style={{ background: "#16a34a", color: "#fff" }}
                                onMouseEnter={(e) => {
                                  clearTimeout(popoverTimer.current);
                                  const rect = e.currentTarget.getBoundingClientRect();
                                  setPopover({ group: ev.items, x: rect.left + rect.width / 2, y: rect.top - 8 });
                                }}
                                onMouseLeave={() => {
                                  popoverTimer.current = setTimeout(() => setPopover(null), 150);
                                }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onOpenVehicle(row, assetType, ev.items[0].type, ev.dueDateRaw, "completed", ev.items[0].jobId);
                                }}
                              >
                                {label}
                              </button>
                            );
                          }
                          if (ev.kind === "vor") {
                            return (
                              <button
                                key={ev.id}
                                className="excel-event-chip vor"
                                style={{ background: EVENT_COLORS.VOR.bg, color: EVENT_COLORS.VOR.text }}
                                onMouseEnter={(e) => {
                                  clearTimeout(popoverTimer.current);
                                  const rect = e.currentTarget.getBoundingClientRect();
                                  setPopover({ vor: ev, x: rect.left + rect.width / 2, y: rect.top - 8 });
                                }}
                                onMouseLeave={() => {
                                  popoverTimer.current = setTimeout(() => setPopover(null), 150);
                                }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setPopover((current) => current?.vor?.id === ev.id ? null : { vor: ev, x: e.currentTarget.getBoundingClientRect().left + e.currentTarget.getBoundingClientRect().width / 2, y: e.currentTarget.getBoundingClientRect().top - 8 });
                                }}
                              >
                                VOR
                              </button>
                            );
                          }
                          const isCompleted = ev.kind === "completed";
                          const color = isCompleted
                            ? { bg: "#16a34a", text: "#fff" }
                            : { bg: "#dc2626", text: "#fff" };
                          const chipDateRaw = isCompleted ? (ev.completedDateRaw || ev.dueDateRaw) : ev.dueDateRaw;
                          const day = chipDateRaw?.slice(8, 10);
                          const mon = chipDateRaw?.slice(5, 7);
                          return (
                            <button
                              key={ev.id}
                              className={`excel-event-chip${isCompleted ? " completed" : ""}`}
                              style={{ background: color.bg, color: color.text }}
                              title={isCompleted ? undefined : `${ev.type} · ${ev.dueDate} · ${ev.dueLabel} — Click to mark done or attach document`}
                              onMouseEnter={isCompleted ? (e) => {
                                clearTimeout(popoverTimer.current);
                                const rect = e.currentTarget.getBoundingClientRect();
                                setPopover({ ev, x: rect.left + rect.width / 2, y: rect.top - 8 });
                              } : undefined}
                              onMouseLeave={isCompleted ? () => {
                                popoverTimer.current = setTimeout(() => setPopover(null), 150);
                              } : undefined}
                              onClick={(e) => {
                                e.stopPropagation();
                                onOpenVehicle(row, assetType, ev.type, ev.dueDateRaw, ev.kind || "upcoming", ev.jobId);
                              }}
                            >
                              {isCompleted ? `✓ ${ev.code} ${day}/${mon}` : `${ev.code} ${day}/${mon}`}
                            </button>
                          );
                        })}
                      </td>
                    );
                  })}
                </tr>
                );
              })}
            </React.Fragment>
          ))}
          {companies.length === 0 && (
            <tr>
              <td colSpan={totalCols} className="finance-empty">No vehicles found. Add vehicles to see the annual schedule.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>

    {/* Completed event popover */}
    {popover && (
      <div
        className="completed-chip-popover"
        style={{ left: popover.x, top: popover.y }}
        onMouseEnter={() => clearTimeout(popoverTimer.current)}
        onMouseLeave={() => { popoverTimer.current = setTimeout(() => setPopover(null), 150); }}
      >
        {popover.group ? (
          <>
            <div className="ccp-header">
              <strong className="ccp-title">{popover.group.length} items completed this week</strong>
            </div>
            {popover.group.map((ev) => (
              <div className="ccp-group-item" key={ev.id}>
                <div className="ccp-row">
                  <span className="ccp-badge" style={{ background: EVENT_COLORS[ev.code]?.bg || "#16a34a" }}>
                    {ev.code}
                  </span>
                  <span className="ccp-value">{ev.type}</span>
                </div>
                <div className="ccp-row">
                  <span className="ccp-label">Scheduled</span>
                  <span className="ccp-value">{ev.dueDate}</span>
                </div>
                <div className="ccp-row">
                  <span className="ccp-label">Done</span>
                  <span className="ccp-value">{ev.completedDate || ev.dueDate}</span>
                </div>
                {ev.completionNotes && !isGeneratedMaintenanceNote(ev.completionNotes) && (
                  <p className="ccp-notes-text">{ev.completionNotes}</p>
                )}
              </div>
            ))}
          </>
        ) : popover.vor ? (
          <>
            <div className="ccp-header">
              <span className="ccp-badge" style={{ background: EVENT_COLORS.VOR.bg, color: EVENT_COLORS.VOR.text }}>
                VOR
              </span>
              <strong className="ccp-title">{popover.vor.vehicle} · Off Road</strong>
            </div>
            <div className="ccp-row">
              <span className="ccp-label">Since</span>
              <span className="ccp-value">{popover.vor.vorSince}</span>
            </div>
            <div className="ccp-row">
              <span className="ccp-label">Expected back</span>
              <span className="ccp-value">{popover.vor.vorTill}</span>
            </div>
            <div className="ccp-notes">
              <span className="ccp-label">Reason</span>
              <p className="ccp-notes-text">{popover.vor.reason}</p>
            </div>
          </>
        ) : (
          <>
            <div className="ccp-header">
              <span className="ccp-badge" style={{ background: EVENT_COLORS[popover.ev.code]?.bg || "#16a34a" }}>
                {popover.ev.code}
              </span>
              <strong className="ccp-title">{popover.ev.type}</strong>
            </div>
            <div className="ccp-row">
              <span className="ccp-label">Scheduled</span>
              <span className="ccp-value">{popover.ev.dueDate}</span>
            </div>
            <div className="ccp-row">
              <span className="ccp-label">Done</span>
              <span className="ccp-value">{popover.ev.completedDate || popover.ev.dueDate}</span>
            </div>
            {popover.ev.completionNotes && !isGeneratedMaintenanceNote(popover.ev.completionNotes) && (
              <div className="ccp-notes">
                <span className="ccp-label">Notes</span>
                <p className="ccp-notes-text">{popover.ev.completionNotes}</p>
              </div>
            )}
          </>
        )}
        <div className="ccp-arrow" />
      </div>
    )}
    </>
  );
}

export function AdminMaintenancePage() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeView, setActiveView] = useState("annual");
  const [showModal, setShowModal] = useState(false);
  const [editingJob, setEditingJob] = useState(null);
  const [drawerJob, setDrawerJob] = useState(null);
  const [modalForm, setModalForm] = useState(emptyJob);
  const [savingAction, setSavingAction] = useState("");
  const [vehicleDetailTarget, setVehicleDetailTarget] = useState(null);
  const [showBreakdownModal, setShowBreakdownModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showVorModal, setShowVorModal] = useState(false);
  const [statPanel, setStatPanel] = useState(null);

  function load() {
    setLoading(true);
    return getMaintenancePortal()
      .then((res) => {
        setData(res.data);
        setError("");
      })
      .catch((err) => {
        const msg = err.response?.data?.message || "Could not load maintenance planner.";
        const detail = err.response?.data?.error || "";
        setError(detail ? `${msg}: ${detail}` : msg);
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  function openVehicleDetail(row, assetType = "vehicle", preselectType = null, scheduledDueDate = "", selectionKind = "", completedJobId = null) {
    setVehicleDetailTarget({ vehicleId: row.vehicleId, assetType, preselectType, scheduledDueDate, selectionKind, completedJobId });
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

  async function handleBillStatus(job, billStatus, billPaymentStatus) {
    setSavingAction(`bill-${job.id}`);
    try {
      await updateMaintenanceBill(job.id, { bill_status: billStatus, bill_payment_status: billPaymentStatus });
      await load();
      setDrawerJob((current) => current?.id === job.id ? null : current);
    } catch (err) {
      setError(err.response?.data?.message || "Could not update bill status.");
    } finally {
      setSavingAction("");
    }
  }

  async function handleDefectWorkflow(defect, workflowStatus) {
    setSavingAction(`defect-flow-${defect.id}`);
    try {
      await updateDefectWorkflow(defect.id, { workflow_status: workflowStatus });
      await load();
    } catch (err) {
      setError(err.response?.data?.message || "Could not update defect workflow.");
    } finally {
      setSavingAction("");
    }
  }

  async function handleInspectionDone(row) {
    const inspectionDate = window.prompt("Inspection date (YYYY-MM-DD)", dateKey(new Date()));
    if (inspectionDate === null) return;
    const inspectorName = window.prompt("Inspector name", "");
    if (inspectorName === null) return;
    const notes = window.prompt("Inspection notes", "6-week safety inspection completed. Roadworthy.");
    if (notes === null) return;
    setSavingAction(`inspection-${row.id}`);
    try {
      const payload = { inspection_date: inspectionDate, inspector_name: inspectorName, notes, result: "pass" };
      if (row.assetType === "trailer") {
        await markTrailerInspectionDone(row.id, payload);
      } else {
        await markVehicleInspectionDone(row.id, payload);
      }
      await load();
    } catch (err) {
      setError(err.response?.data?.message || "Could not mark inspection done.");
    } finally {
      setSavingAction("");
    }
  }

  async function handleMarkBackOnRoad(row) {
    if (!window.confirm(`Mark ${row.registrationNumber} back on road?`)) return;
    const assetType = row.assetType === "trailer" ? "trailer" : "vehicle";
    setSavingAction(`vor-${row.id}`);
    try {
      await setVorStatus({ asset_id: `${assetType}:${row.id}`, on_road: true });
      await load();
    } catch (err) {
      setError(err.response?.data?.message || "Could not mark vehicle back on road.");
    } finally {
      setSavingAction("");
    }
  }

  const findStat = (items, label) => (items || []).find((item) => item.label === label);
  const primaryCards = [
    {
      key: "attention",
      label: "Needs attention",
      value: findStat(data?.stats, "Overdue")?.value ?? 0,
      note: "Overdue service, inspection or repair work",
      tone: Number(findStat(data?.stats, "Overdue")?.value || 0) > 0 ? "danger" : "success"
    },
    {
      key: "offroad",
      label: "Off road",
      value: findStat(data?.stats, "Vehicles off road")?.value ?? 0,
      note: "Vehicles unavailable because of maintenance or stopped status",
      tone: Number(findStat(data?.stats, "Vehicles off road")?.value || 0) > 0 ? "danger" : "success"
    },
    {
      key: "bills",
      label: "Bills to check",
      value: findStat(data?.health, "Bills pending approval")?.value ?? 0,
      note: "Workshop bills waiting for approval",
      tone: Number(findStat(data?.health, "Bills pending approval")?.value || 0) > 0 ? "warning" : "success"
    }
  ];

  const attentionItems = (data?.plannerRows || []).filter((row) => row.priorityDays !== null && row.priorityDays < 0);
  const overdueJobs = (data?.jobs || []).filter((job) => job.daysLeft < 0 && !["completed", "cancelled"].includes(job.status));
  const offRoadItems = (data?.plannerRows || []).filter((row) => ["maintenance", "stopped"].includes(row.status));
  const billsItems = (data?.jobs || []).filter((job) => job.billStatus === "pending" && (job.billAmountGbp || job.billAttachmentData));

  const maintenanceViews = [
    { id: "annual", label: "Annual Schedule" },
    { id: "fleet", label: "Fleet Checks" },
    { id: "assets", label: "Parts & Tyres" },
    { id: "records", label: "History & Docs" }
  ];

  return (
    <AdminWorkspaceLayout
      badge={data?.header?.badge || "Maintenance planner"}
      title={data?.header?.title || "Fleet maintenance portal"}
      description={data?.header?.description || "Plan services, inspections, defects, and workshop work from live fleet data."}
      highlights={[]}
      hideHeaderIntro
      className="maintenance-page-shell"
    >
      <div className="maintenance-command-bar">
        <section className="maintenance-summary-grid" aria-label="Maintenance summary">
          {primaryCards.map((card) => (
            <article
              className={`maintenance-summary-card clickable ${card.tone}${statPanel === card.key ? " active" : ""}`}
              key={card.label}
              role="button"
              tabIndex={0}
              onClick={() => setStatPanel((current) => current === card.key ? null : card.key)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setStatPanel((current) => current === card.key ? null : card.key);
                }
              }}
            >
              <span>{card.label}</span>
              <strong>{card.value}</strong>
              <p>{card.note}</p>
            </article>
          ))}
        </section>
        <div className="maintenance-command-actions">
          <button
            className="af-submit-btn"
            type="button"
            onClick={() => {
              setEditingJob(null);
              setModalForm(emptyJob);
              setShowModal(true);
            }}
          >
            + Add Maintenance
          </button>
          <button className="header-action-button danger" type="button" onClick={() => setShowBreakdownModal(true)}>Report Breakdown</button>
          <button className="header-action-button" type="button" onClick={() => setShowVorModal(true)}>Mark Off Road</button>
          <button className="header-action-button" type="button" onClick={load}>Refresh</button>
          <button className="header-action-button" type="button" onClick={() => setShowExportModal(true)}>Export Schedule</button>
          <button className="header-action-button" type="button" onClick={() => navigate("/admin/vehicles")}>Vehicle Register</button>
        </div>
      </div>

      {statPanel && (
        <div className="maintenance-stat-panel">
          <div className="section-head">
            <h3>
              {statPanel === "attention" && "Needs Attention"}
              {statPanel === "offroad" && "Off Road Vehicles"}
              {statPanel === "bills" && "Bills To Check"}
            </h3>
            <button className="header-action-button" type="button" onClick={() => setStatPanel(null)}>Close</button>
          </div>
          <div className="maintenance-stat-panel-list">
            {statPanel === "attention" && (
              <>
                {attentionItems.map((row) => (
                  <button
                    key={`att-${row.assetType || "vehicle"}-${row.id}`}
                    className="maintenance-stat-panel-item"
                    type="button"
                    onClick={() => openVehicleDetail({ vehicleId: row.id }, row.assetType === "trailer" ? "trailer" : "vehicle")}
                  >
                    <strong>{row.registrationNumber}</strong>
                    <span>{row.fleetCode}</span>
                    <p>{row.action} · {Math.abs(row.priorityDays)}d overdue</p>
                  </button>
                ))}
                {overdueJobs.map((job) => (
                  <button key={`att-job-${job.id}`} className="maintenance-stat-panel-item" type="button" onClick={() => setDrawerJob(job)}>
                    <strong>{job.vehicle}</strong>
                    <span>{job.jobNumber}</span>
                    <p>{job.serviceType} · {Math.abs(job.daysLeft)}d overdue</p>
                  </button>
                ))}
                {attentionItems.length === 0 && overdueJobs.length === 0 && <p className="finance-empty">Nothing overdue right now.</p>}
              </>
            )}
            {statPanel === "offroad" && (
              <>
                {offRoadItems.map((row) => {
                  const overdueDays = row.vorTillRaw ? -daysFromToday(row.vorTillRaw) : null;
                  const isOverdue = overdueDays !== null && overdueDays > 0;
                  return (
                    <div
                      key={`vor-${row.assetType || "vehicle"}-${row.id}`}
                      className="maintenance-stat-panel-item"
                      role="button"
                      tabIndex={0}
                      onClick={() => openVehicleDetail({ vehicleId: row.id }, row.assetType === "trailer" ? "trailer" : "vehicle")}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          openVehicleDetail({ vehicleId: row.id }, row.assetType === "trailer" ? "trailer" : "vehicle");
                        }
                      }}
                    >
                      <strong>{row.registrationNumber}</strong>
                      <span>{row.fleetCode}</span>
                      <p>
                        {row.vorReason || "No VOR reason on file"}
                        {row.vorSince ? ` · since ${row.vorSince}` : ""}
                        {row.vorTill ? ` → ${row.vorTill}` : ""}
                      </p>
                      {isOverdue && (
                        <p className="maintenance-vor-overdue">
                          Overdue by {overdueDays} day{overdueDays === 1 ? "" : "s"} — expected back {row.vorTill}
                        </p>
                      )}
                      <button
                        type="button"
                        className="vehicle-detail-item-doc-link"
                        disabled={savingAction === `vor-${row.id}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleMarkBackOnRoad(row);
                        }}
                      >
                        {savingAction === `vor-${row.id}` ? "Saving..." : "Mark back on road"}
                      </button>
                    </div>
                  );
                })}
                {offRoadItems.length === 0 && <p className="finance-empty">No vehicles off road.</p>}
              </>
            )}
            {statPanel === "bills" && (
              <>
                {billsItems.map((job) => (
                  <button key={`bill-${job.id}`} className="maintenance-stat-panel-item" type="button" onClick={() => setDrawerJob(job)}>
                    <strong>{job.vehicle}</strong>
                    <span>{job.billNumber || job.jobNumber}</span>
                    <p>{job.billAmountLabel} · {job.serviceType}</p>
                  </button>
                ))}
                {billsItems.length === 0 && <p className="finance-empty">No bills waiting for approval.</p>}
              </>
            )}
          </div>
        </div>
      )}

      <StateNotice loading={loading} error={error} />

      <nav className="maintenance-view-tabs" aria-label="Maintenance views">
        {maintenanceViews.map((view) => (
          <button
            className={activeView === view.id ? "active" : ""}
            key={view.id}
            type="button"
            onClick={() => setActiveView(view.id)}
          >
            {view.label}
          </button>
        ))}
      </nav>

      {activeView === "annual" && (
      <section className="content-card excel-schedule-card">
        <ExcelScheduleView data={data} onOpenVehicle={openVehicleDetail} />
      </section>
      )}

      {activeView === "fleet" && (
      <section className="content-card">
        <div className="section-head">
          <div>
            <span className="card-label">Vehicle Maintenance Profiles</span>
            <h2>Vehicle-By-Vehicle Compliance</h2>
          </div>
          <StatusPill tone="neutral">{(data?.vehicleProfiles || []).length} vehicles</StatusPill>
        </div>
        <div className="maintenance-profile-grid">
          {(data?.vehicleProfiles || []).slice(0, 8).map((profile) => (
            <div className="maintenance-profile-card" key={`${profile.assetType === "trailer" ? "trailer" : "vehicle"}-${profile.vehicleId}`}>
              <div className="maintenance-profile-head">
                <div>
                  <strong>{profile.vehicle}</strong>
                  <p>{profile.fleetCode} · {profile.currentKmLabel}</p>
                </div>
                <button
                  className="header-action-button"
                  type="button"
                  onClick={() => profile.assetType === "trailer"
                    ? openVehicleDetail(profile, "trailer")
                    : navigate(`/admin/vehicles/${profile.vehicleId}`)}
                >
                  Open
                </button>
              </div>
              <div className="maintenance-profile-items">
                {profile.items.map((item) => (
                  <button
                    className="maintenance-profile-item"
                    key={item.type}
                    type="button"
                    onClick={() => openVehicleDetail(profile, profile.assetType === "trailer" ? "trailer" : "vehicle", item.type)}
                  >
                    <span>{item.type}</span>
                    <strong>{item.nextDue}</strong>
                    <p>{item.type === "Full Service" ? item.kmRemainingLabel : item.dueLabel}</p>
                    <StatusPill tone={item.tone}>{item.status}</StatusPill>
                  </button>
                ))}
              </div>
            </div>
          ))}
          {!loading && (data?.vehicleProfiles || []).length === 0 && <p className="finance-empty">No vehicle maintenance profiles available.</p>}
        </div>
      </section>
      )}

      {activeView === "fleet" && (
      <section className="content-card">
        <div className="section-head">
          <div>
            <span className="card-label">6-Week Safety Inspections</span>
            <h2>PMI / Roadworthiness Inspection Tracker</h2>
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
                Mark Inspection Done
              </button>
            </div>
          ))}
          {!loading && (data?.plannerRows || []).length === 0 && (
            <p className="finance-empty">No vehicles available for inspection tracking.</p>
          )}
        </div>
      </section>
      )}


      {activeView === "records" && (
      <section className="content-grid">
        <article className="content-card">
          <div className="section-head">
            <div>
              <span className="card-label">Cost Dashboard</span>
              <h2>Maintenance Cost Per Vehicle</h2>
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
              <span className="card-label">Service History Timeline</span>
              <h2>Recent Services, Inspections And Defects</h2>
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
      )}

      {activeView === "assets" && (
      <section className="content-grid">
        <article className="content-card">
          <div className="section-head">
            <div>
              <span className="card-label">Parts Inventory</span>
              <h2>Stock And Reorder Watch</h2>
            </div>
            <StatusPill tone={(data?.inventory || []).some((item) => item.tone === "warning") ? "warning" : "success"}>
              {(data?.inventory || []).length} parts
            </StatusPill>
          </div>
          <div className="maintenance-inventory-list">
            {(data?.inventory || []).slice(0, 8).map((part) => (
              <div className="maintenance-inventory-item" key={part.id}>
                <div>
                  <strong>{part.partName}</strong>
                  <p>{part.category} · {part.supplier}</p>
                </div>
                <span>{part.stockQty} in stock</span>
                <StatusPill tone={part.tone}>{part.status}</StatusPill>
              </div>
            ))}
            {!loading && (data?.inventory || []).length === 0 && <p className="finance-empty">No inventory parts configured.</p>}
          </div>
        </article>

        <article className="content-card">
          <div className="section-head">
            <div>
              <span className="card-label">Tyre Management</span>
              <h2>Tread, Pressure And Replacement Watch</h2>
            </div>
            <StatusPill tone={(data?.tyres || []).some((tyre) => tyre.status === "replace") ? "danger" : "neutral"}>{(data?.tyres || []).length} tyres</StatusPill>
          </div>
          <div className="maintenance-inventory-list">
            {(data?.tyres || []).slice(0, 8).map((tyre) => (
              <div className="maintenance-inventory-item" key={tyre.id}>
                <div>
                  <strong>{tyre.vehicle} · {tyre.position}</strong>
                  <p>{tyre.brand} · {tyre.treadDepth} · {tyre.pressure}</p>
                </div>
                <span>{tyre.replacementDue}</span>
                <StatusPill tone={tyre.tone}>{tyre.status}</StatusPill>
              </div>
            ))}
            {!loading && (data?.tyres || []).length === 0 && <p className="finance-empty">Tyre positions will appear after tyre records are added.</p>}
          </div>
        </article>
      </section>
      )}

      {activeView === "records" && (
      <section className="content-grid">
        <article className="content-card">
          <div className="section-head">
            <div>
              <span className="card-label">Documents Vault</span>
              <h2>Bills, Invoices And Workshop Papers</h2>
            </div>
            <StatusPill tone="neutral">{(data?.documentsVault || []).length} docs</StatusPill>
          </div>
          <div className="maintenance-compliance-list">
            {(data?.documentsVault || []).map((doc) => (
              <button className="maintenance-compliance-item" key={doc.id} type="button" onClick={() => setDrawerJob((data?.jobs || []).find((job) => job.id === doc.id))}>
                <StatusPill tone={doc.billStatusTone}>{doc.billStatus}</StatusPill>
                <strong>{doc.vehicle} · {doc.serviceType}</strong>
                <span>{doc.billAmount}</span>
                <p>{doc.billNumber} · {doc.billDate} · {doc.hasAttachment ? "Attachment available" : "No attachment"}</p>
              </button>
            ))}
            {!loading && (data?.documentsVault || []).length === 0 && <p className="finance-empty">Bills and workshop paperwork will appear here after upload.</p>}
          </div>
        </article>

        <article className="content-card">
          <div className="section-head">
            <div>
              <span className="card-label">Maintenance Analytics</span>
              <h2>Cost, Defects And Vendors</h2>
            </div>
            <StatusPill tone="neutral">Live</StatusPill>
          </div>
          <div className="maintenance-analytics-grid">
            <div>
              <span className="card-label">Repeated Defects</span>
              {(data?.analytics?.repeatedDefects || []).map((item) => <p key={item.type}><strong>{item.type}</strong> · {item.count}</p>)}
              {(data?.analytics?.repeatedDefects || []).length === 0 && <p>No repeated defects.</p>}
            </div>
            <div>
              <span className="card-label">Vendor Spend</span>
              {(data?.analytics?.vendorSpend || []).map((item) => <p key={item.vendor}><strong>{item.vendor}</strong> · {item.amountLabel}</p>)}
              {(data?.analytics?.vendorSpend || []).length === 0 && <p>No vendor spend yet.</p>}
            </div>
            <div>
              <span className="card-label">Cost / km</span>
              {(data?.analytics?.costPerKm || []).slice(0, 5).map((item) => <p key={item.vehicle}><strong>{item.vehicle}</strong> · {item.costPerKm}</p>)}
            </div>
          </div>
        </article>
      </section>
      )}

      <section className="content-card">
        <div className="section-head">
          <div>
            <span className="card-label">Defect-To-Repair Workflow</span>
            <h2>Driver Defects Awaiting Maintenance</h2>
          </div>
          <StatusPill tone={(data?.defects || []).length ? "warning" : "success"}>{(data?.defects || []).length} defects</StatusPill>
        </div>
        <div className="data-rows">
          {(data?.defects || []).slice(0, 8).map((defect) => (
            <div className="data-row maintenance-defect-row" key={defect.id}>
              <div><strong>{defect.vehicle}</strong><p>{defect.defectType} · {defect.description}</p></div>
              <StatusPill tone={defect.severityTone}>{defect.severity}</StatusPill>
              <div className="finance-row-actions">
                <StatusPill tone={defect.workflowStatus === "verified" ? "success" : defect.workflowStatus === "fixed" ? "warning" : "neutral"}>{defect.workflowStatus}</StatusPill>
                {["reported", "reviewed", "booked", "fixed"].map((step) => (
                  defect.workflowStatus !== step && (
                    <button
                      className="header-action-button"
                      disabled={savingAction === `defect-flow-${defect.id}`}
                      key={step}
                      type="button"
                      onClick={() => handleDefectWorkflow(defect, step)}
                    >
                      {step}
                    </button>
                  )
                ))}
                {defect.jobId ? (
                  <StatusPill tone="success">{defect.jobNumber}</StatusPill>
                ) : (
                  <button className="header-action-button" disabled={savingAction === `defect-${defect.id}`} type="button" onClick={() => repairFromDefect(defect)}>Create Repair Job</button>
                )}
              </div>
            </div>
          ))}
          {!loading && (data?.defects || []).length === 0 && <p className="finance-empty">No open defects.</p>}
        </div>
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
      {vehicleDetailTarget && (
        <VehicleDetailModal
          target={vehicleDetailTarget}
          profiles={data?.vehicleProfiles || []}
          onClose={() => setVehicleDetailTarget(null)}
          onSaved={load}
        />
      )}
      {showBreakdownModal && (
        <BreakdownModal
          vehicles={data?.vehicles || []}
          onClose={() => setShowBreakdownModal(false)}
          onSaved={load}
        />
      )}
      {showExportModal && (
        <ExportJobsModal
          vehicles={data?.vehicles || []}
          weeks={data?.yearPlan?.weeks || []}
          jobs={data?.jobs || []}
          onClose={() => setShowExportModal(false)}
        />
      )}
      {showVorModal && (
        <VorModal
          vehicles={data?.vehicles || []}
          profiles={data?.vehicleProfiles || []}
          onClose={() => setShowVorModal(false)}
          onSaved={load}
        />
      )}
      <JobDrawer
        job={drawerJob}
        history={data?.history || []}
        onClose={() => setDrawerJob(null)}
        onEdit={openEditJob}
        onComplete={handleComplete}
        onBillStatus={handleBillStatus}
        savingAction={savingAction}
      />
    </AdminWorkspaceLayout>
  );
}
