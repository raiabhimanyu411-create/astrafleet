import { useMemo, useRef, useState } from "react";
import { createJob, getJobFormData } from "../../../api/jobApi";
import { csvRowsToJobs, downloadJobCsvTemplate } from "../../../utils/jobCsvImport";

const REQUIRED = ["client_name", "pickup_address", "drop_address", "planned_departure", "loading_done_time", "load_description"];
const assetMatch = (items, query, fields) => { const q = String(query || "").trim().toLowerCase(); return q && items.find(item => fields.some(field => String(item[field] || "").trim().toLowerCase() === q)); };

function validate(row, rows, existingJobs) {
  const errors = {};
  REQUIRED.forEach(field => { if (!String(row[field] || "").trim()) errors[field] = "Required"; });
  if (row._rawPlanned && !row.planned_departure) errors.planned_departure = "Use DD/MM/YYYY HH:mm";
  if (row._rawLoadingDone && !row.loading_done_time) errors.loading_done_time = "Use DD/MM/YYYY HH:mm";
  if (row.planned_departure && row.loading_done_time && row.loading_done_time < row.planned_departure) errors.loading_done_time = "Before arrival";
  if (row.freight_amount && (!Number.isFinite(Number(row.freight_amount)) || Number(row.freight_amount) < 0)) errors.freight_amount = "Invalid amount";
  if (!["standard", "priority", "critical"].includes(row.priority_level)) errors.priority_level = "Invalid priority";
  const reference = String(row.reference || "").trim().toLowerCase(), loadId = String(row.load_id || "").trim().toLowerCase();
  if (rows.some(other => other._key !== row._key && ((reference && String(other.reference || "").trim().toLowerCase() === reference) || (loadId && String(other.load_id || "").trim().toLowerCase() === loadId)))) errors.reference = "Duplicate in CSV";
  if (existingJobs.some(job => (reference && String(job.reference || "").trim().toLowerCase() === reference) || (loadId && String(job.loadId || "").trim().toLowerCase() === loadId))) errors.reference = "Already exists";
  if (row._serverError) errors.server = row._serverError;
  return errors;
}

function Cell({ value, change, error, type = "text", options }) {
  return options ? <select className={error ? "import-cell-error" : ""} value={value} onChange={event => change(event.target.value)}><option value="">Unassigned</option>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
    : <input className={error ? "import-cell-error" : ""} title={error || ""} type={type} value={value} onChange={event => change(event.target.value)} />;
}

export function ImportJobsModal({ existingJobs = [], onClose, onComplete }) {
  const fileRef = useRef(null);
  const [rows, setRows] = useState([]), [formData, setFormData] = useState({ drivers: [], vehicles: [], trailers: [] });
  const [fileName, setFileName] = useState(""), [message, setMessage] = useState(""), [creating, setCreating] = useState(false);
  const errors = useMemo(() => rows.map(row => validate(row, rows, existingJobs)), [rows, existingJobs]);
  const validCount = errors.filter((item, index) => !Object.keys(item).length && rows[index]._status !== "created").length;
  const errorCount = errors.filter((item, index) => Object.keys(item).length && rows[index]._status !== "created").length;

  async function selectFile(event) {
    const file = event.target.files?.[0]; if (!file) return; setFileName(file.name); setMessage("");
    try {
      const [text, response] = await Promise.all([file.text(), getJobFormData()]); const fd = response.data; setFormData(fd);
      setRows(csvRowsToJobs(text).map(row => ({ ...row,
        driver_id: assetMatch(fd.drivers || [], row.driver, ["full_name", "employee_code"])?.id || "",
        vehicle_id: assetMatch(fd.vehicles || [], row.vehicle, ["registration_number", "fleet_code"])?.id || "",
        trailer_id: assetMatch(fd.trailers || [], row.trailer, ["trailer_code", "registration_number"])?.id || ""
      })));
    } catch (error) { setRows([]); setMessage(error.message || "Could not read this CSV file."); }
  }
  const edit = (index, field, value) => setRows(current => current.map((row, i) => i === index ? { ...row, [field]: value, _serverError: "", _status: "pending" } : row));

  async function submit() {
    setCreating(true); setMessage(""); let count = 0; const next = [...rows];
    for (let index = 0; index < next.length; index += 1) {
      if (next[index]._status === "created" || Object.keys(validate(next[index], next, existingJobs)).length) continue;
      const row = next[index];
      try {
        await createJob({ client_name: row.client_name, client_phone: row.client_phone || null, reference: row.reference || null, load_id: row.load_id || null, pickup_address: row.pickup_address, drop_address: row.drop_address, planned_departure: row.planned_departure, loading_done_time: row.loading_done_time, load_description: row.load_description, load_type: "general", freight_amount: row.freight_amount === "" ? null : Number(row.freight_amount), priority_level: row.priority_level, driver_id: row.driver_id ? Number(row.driver_id) : null, vehicle_id: row.vehicle_id ? Number(row.vehicle_id) : null, trailer_id: row.trailer_id ? Number(row.trailer_id) : null, loading_duration_mins: Number(row.loading_duration_mins || 90), unloading_duration_mins: Number(row.unloading_duration_mins || 90), stops: [] });
        next[index] = { ...row, _status: "created", _serverError: "" }; count += 1;
      } catch (error) { next[index] = { ...row, _status: "failed", _serverError: error?.response?.data?.message || "Could not create job" }; }
      setRows([...next]);
    }
    setCreating(false); setMessage(count ? `${count} job${count === 1 ? "" : "s"} created successfully.` : "No valid jobs were available to create."); if (count) onComplete?.();
  }

  const drivers = (formData.drivers || []).map(item => ({ value: item.id, label: `${item.full_name} (${item.employee_code || "no code"})` }));
  const vehicles = (formData.vehicles || []).map(item => ({ value: item.id, label: item.registration_number }));
  const trailers = (formData.trailers || []).map(item => ({ value: item.id, label: item.trailer_code }));
  const columns = [
    ["client_name", "Customer *"], ["reference", "Reference"], ["load_id", "Load ID"], ["pickup_address", "Pickup *"], ["drop_address", "Delivery *"],
    ["planned_departure", "Collection arrival *", "datetime-local"], ["loading_done_time", "Collection departure *", "datetime-local"], ["load_description", "Load details *"], ["freight_amount", "Freight £", "number"]
  ];

  return <div className="relay-modal-overlay" onClick={onClose}><section className="jobs-import-modal" onClick={event => event.stopPropagation()} role="dialog" aria-modal="true">
    <header className="jobs-import-head"><div><h2>Import jobs from CSV</h2><p>Upload, check and edit every row before creating jobs.</p></div><button type="button" onClick={onClose}>✕</button></header>
    <div className="jobs-import-toolbar"><input ref={fileRef} hidden type="file" accept=".csv,text/csv" onChange={selectFile} /><button className="af-submit-btn" type="button" onClick={() => fileRef.current?.click()}>Choose CSV</button><button className="header-action-button" type="button" onClick={downloadJobCsvTemplate}>Download template</button><span>{fileName || "No file selected"}</span></div>
    {message && <div className="jobs-import-message">{message}</div>}
    {rows.length > 0 && <><div className="jobs-import-summary"><strong>{rows.length} rows</strong><span className="valid">{validCount} ready</span><span className={errorCount ? "invalid" : ""}>{errorCount} need attention</span><small>Red fields must be corrected. Assignments are optional.</small></div>
      <div className="jobs-import-grid-wrap"><table className="jobs-import-grid"><thead><tr><th>Row</th>{columns.map(column => <th key={column[0]}>{column[1]}</th>)}<th>Driver</th><th>Vehicle</th><th>Trailer</th><th>Priority</th><th>Status</th><th /></tr></thead><tbody>{rows.map((row, index) => <tr key={row._key} className={row._status === "created" ? "created" : Object.keys(errors[index]).length ? "invalid" : ""}>
        <td>{row._sourceRow}</td>{columns.map(([field,, type]) => <td key={field}><Cell type={type} value={row[field]} error={errors[index][field]} change={value => edit(index, field, value)} /></td>)}
        <td><Cell value={row.driver_id} options={drivers} change={value => edit(index, "driver_id", value)} /></td><td><Cell value={row.vehicle_id} options={vehicles} change={value => edit(index, "vehicle_id", value)} /></td><td><Cell value={row.trailer_id} options={trailers} change={value => edit(index, "trailer_id", value)} /></td>
        <td><select className={errors[index].priority_level ? "import-cell-error" : ""} value={row.priority_level} onChange={event => edit(index, "priority_level", event.target.value)}><option value="standard">Standard</option><option value="priority">Priority</option><option value="critical">Critical</option></select></td>
        <td className="jobs-import-status">{row._status === "created" ? "✓ Created" : errors[index].server || Object.values(errors[index])[0] || "Ready"}</td><td><button className="jobs-import-remove" type="button" onClick={() => setRows(current => current.filter((_, i) => i !== index))}>Remove</button></td>
      </tr>)}</tbody></table></div></>}
    <footer className="jobs-import-actions"><button className="header-action-button" type="button" onClick={onClose}>Close</button><button className="af-submit-btn" disabled={creating || !validCount} type="button" onClick={submit}>{creating ? "Creating jobs…" : `Create ${validCount} valid job${validCount === 1 ? "" : "s"}`}</button></footer>
  </section></div>;
}
