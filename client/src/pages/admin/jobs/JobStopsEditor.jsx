import { useMemo, useState } from "react";
import { updateJob } from "../../../api/jobApi";

const clean = value => value && value !== "—" ? value : "";
const toDraft = job => ({
  pickupAddress: clean(job.pickupAddress), dropAddress: clean(job.dropAddress),
  pickupArrival: clean(job.departureRaw), pickupDeparture: clean(job.loadingDoneTime),
  dropArrival: clean(job.calculatedArrival), dropDeparture: clean(job.calculatedUnloadEnd),
  driverId: job.driverId || "", vehicleId: job.vehicleId || "", trailerId: job.trailerId || "",
  stops: (job.stops || []).map(stop => ({ id: stop.id, address: clean(stop.address), stop_type: stop.type || "delivery", contact_name: clean(stop.contactName), contact_phone: clean(stop.contactPhone), planned_arrival: clean(stop.plannedArrivalRaw), planned_departure: clean(stop.plannedDepartureRaw), notes: clean(stop.notes) }))
});

function fmt(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function SheetInput({ value, onChange, type = "text", ariaLabel }) {
  return <input className="job-sheet-input" aria-label={ariaLabel} type={type} value={value || ""} onChange={event => onChange(event.target.value)} />;
}

function AssetSelect({ value, onChange, items, label }) {
  return <select className="job-sheet-input" value={value || ""} onChange={event => onChange(event.target.value)} aria-label={label}>
    <option value="">Unassigned</option>{items.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
  </select>;
}

export function JobStopsEditor({ job, drivers = [], vehicles = [], trailers = [], onSaved }) {
  const [editing, setEditing] = useState(false), [draft, setDraft] = useState(() => toDraft(job));
  const [saving, setSaving] = useState(false), [error, setError] = useState("");
  const locked = job.status !== "planned";
  const driverOptions = useMemo(() => drivers.map(item => ({ id: item.id, label: `${item.full_name}${item.employee_code ? ` · ${item.employee_code}` : ""}` })), [drivers]);
  const vehicleOptions = useMemo(() => vehicles.map(item => ({ id: item.id, label: item.registration_number })), [vehicles]);
  const trailerOptions = useMemo(() => trailers.map(item => ({ id: item.id, label: item.trailer_code || item.registration_number })), [trailers]);
  const set = (field, value) => { setError(""); setDraft(current => ({ ...current, [field]: value })); };
  const setStop = (index, field, value) => { setError(""); setDraft(current => ({ ...current, stops: current.stops.map((stop, i) => i === index ? { ...stop, [field]: value } : stop) })); };

  function beginEdit() { setDraft(toDraft(job)); setError(""); setEditing(true); }
  function cancel() { setDraft(toDraft(job)); setError(""); setEditing(false); }
  function validate() {
    if (!draft.pickupAddress.trim() || !draft.dropAddress.trim()) return "Collection and delivery addresses are required.";
    if (!draft.pickupArrival || !draft.pickupDeparture) return "Collection arrival and departure are required.";
    if (draft.pickupDeparture < draft.pickupArrival) return "Collection departure cannot be before arrival.";
    if (draft.dropArrival && draft.dropArrival < draft.pickupDeparture) return "Delivery arrival cannot be before collection departure.";
    if (draft.dropArrival && draft.dropDeparture && draft.dropDeparture < draft.dropArrival) return "Delivery departure cannot be before arrival.";
    const invalidStop = draft.stops.find(stop => !stop.address.trim() || (stop.planned_arrival && stop.planned_departure && stop.planned_departure < stop.planned_arrival));
    return invalidStop ? "Every stop needs an address and departure must be after arrival." : "";
  }

  async function save() {
    const validationError = validate(); if (validationError) { setError(validationError); return; }
    setSaving(true); setError("");
    try {
      await updateJob(job.id, {
        customer_id: job.customerId || null, client_name: job.customer, client_phone: clean(job.customerPhone) || null,
        route_id: job.routeId || null, pickup_address: draft.pickupAddress, drop_address: draft.dropAddress,
        planned_departure: draft.pickupArrival, loading_done_time: draft.pickupDeparture,
        calculated_arrival: draft.dropArrival || null, calculated_unload_end: draft.dropDeparture || null,
        driver_id: draft.driverId ? Number(draft.driverId) : null, vehicle_id: draft.vehicleId ? Number(draft.vehicleId) : null, trailer_id: draft.trailerId ? Number(draft.trailerId) : null,
        load_type: job.loadType, load_weight_kg: job.loadWeightKg || null, load_volume_cbm: job.loadVolumeCbm || null,
        vehicle_type_requirement: clean(job.vehicleRequirement) || null, delivery_deadline: clean(job.deadlineRaw) || null,
        load_description: clean(job.loadDescription) || null, freight_amount: job.freightValue, priority_level: job.priority,
        special_instructions: clean(job.specialInstructions) || null, dispatcher_notes: clean(job.dispatcherNotes) || null,
        loading_duration_mins: job.loadingDurationMins, unloading_duration_mins: job.unloadingDurationMins,
        estimated_distance_km: job.distanceKm || null, total_job_duration_mins: job.totalJobDurationMins || null,
        reference: job.reference || null, load_id: job.loadId || null,
        stops: draft.stops.map(stop => ({ address: stop.address.trim(), stop_type: stop.stop_type, contact_name: stop.contact_name || null, contact_phone: stop.contact_phone || null, planned_arrival: stop.planned_arrival || null, planned_departure: stop.planned_departure || null, notes: stop.notes || null }))
      });
      setEditing(false); await onSaved?.();
    } catch (err) { setError(err?.response?.data?.message || "Could not update this job."); }
    finally { setSaving(false); }
  }

  const equipment = editing ? <div className="job-sheet-equipment-edit">
    <AssetSelect label="Driver" value={draft.driverId} onChange={value => set("driverId", value)} items={driverOptions} />
    <AssetSelect label="Vehicle" value={draft.vehicleId} onChange={value => set("vehicleId", value)} items={vehicleOptions} />
    <AssetSelect label="Trailer" value={draft.trailerId} onChange={value => set("trailerId", value)} items={trailerOptions} />
  </div> : <><span><small>Driver</small>{job.driver}</span><span><small>Tractor</small>{job.vehicle}</span><span><small>Trailer</small>{job.trailer}</span></>;

  return <div className={`job-sheet${editing ? " editing" : ""}`}>
    <div className="job-sheet-toolbar"><div><strong>Stops & schedule</strong><span>Spreadsheet view · {job.code}</span></div><div className="job-sheet-actions">
      {error && <span className="job-sheet-error">{error}</span>}
      {!editing && <button className="header-action-button" type="button" disabled={locked} title={locked ? "Active and completed jobs are locked" : "Edit this schedule"} onClick={beginEdit}>✎ Edit grid</button>}
      {editing && <><button className="header-action-button" type="button" disabled={saving} onClick={cancel}>Cancel</button><button className="af-submit-btn" type="button" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save changes"}</button></>}
    </div></div>
    <div className="job-sheet-scroll"><div className="job-sheet-grid job-sheet-head"><span>#</span><span>Stop & address</span><span>Equipment</span><span>Arrival</span><span>Departure</span><span>Contact / notes</span></div>
      <div className="job-sheet-grid job-sheet-row"><span className="job-sheet-index collection">C</span><div>{editing ? <SheetInput ariaLabel="Collection address" value={draft.pickupAddress} onChange={value => set("pickupAddress", value)} /> : <><strong>Collection</strong><small>{job.pickupAddress}</small></>}</div><div className="job-sheet-equipment">{equipment}</div><div>{editing ? <SheetInput ariaLabel="Collection arrival" type="datetime-local" value={draft.pickupArrival} onChange={value => set("pickupArrival", value)} /> : <strong>{fmt(job.departureRaw)}</strong>}</div><div>{editing ? <SheetInput ariaLabel="Collection departure" type="datetime-local" value={draft.pickupDeparture} onChange={value => set("pickupDeparture", value)} /> : <strong>{fmt(job.loadingDoneTime)}</strong>}</div><div><small>{clean(job.specialInstructions) || "No pickup instructions"}</small></div></div>
      <div className="job-sheet-grid job-sheet-row"><span className="job-sheet-index">1</span><div>{editing ? <SheetInput ariaLabel="Delivery address" value={draft.dropAddress} onChange={value => set("dropAddress", value)} /> : <><strong>Delivery</strong><small>{job.dropAddress}</small></>}</div><div className="job-sheet-equipment">{equipment}</div><div>{editing ? <SheetInput ariaLabel="Delivery arrival" type="datetime-local" value={draft.dropArrival} onChange={value => set("dropArrival", value)} /> : <strong>{fmt(job.calculatedArrival)}</strong>}</div><div>{editing ? <SheetInput ariaLabel="Delivery departure" type="datetime-local" value={draft.dropDeparture} onChange={value => set("dropDeparture", value)} /> : <strong>{fmt(job.calculatedUnloadEnd)}</strong>}</div><div><small>{clean(job.dispatcherNotes) || "No delivery instructions"}</small><span className="job-sheet-status">POD: {job.podStatus}</span></div></div>
      {draft.stops.map((stop, index) => <div className="job-sheet-grid job-sheet-row" key={stop.id || index}><span className="job-sheet-index">{index + 2}</span><div>{editing ? <><SheetInput ariaLabel={`Stop ${index + 2} address`} value={stop.address} onChange={value => setStop(index, "address", value)} /><select className="job-sheet-mini-select" value={stop.stop_type} onChange={event => setStop(index, "stop_type", event.target.value)}><option value="delivery">Delivery</option><option value="pickup">Pickup</option><option value="waypoint">Waypoint</option></select></> : <><strong>{stop.stop_type}</strong><small>{stop.address}</small></>}</div><div className="job-sheet-equipment"><small>Intermediate stop</small></div><div>{editing ? <SheetInput type="datetime-local" value={stop.planned_arrival} onChange={value => setStop(index, "planned_arrival", value)} /> : <strong>{fmt(stop.planned_arrival)}</strong>}</div><div>{editing ? <SheetInput type="datetime-local" value={stop.planned_departure} onChange={value => setStop(index, "planned_departure", value)} /> : <strong>{fmt(stop.planned_departure)}</strong>}</div><div>{editing ? <><SheetInput value={stop.contact_name} onChange={value => setStop(index, "contact_name", value)} ariaLabel="Contact name" /><SheetInput value={stop.notes} onChange={value => setStop(index, "notes", value)} ariaLabel="Stop notes" /></> : <><strong>{stop.contact_name || "—"}</strong><small>{stop.notes || "No instructions"}</small></>}</div></div>)}
    </div>
    {locked && <div className="job-sheet-lock">This job is {job.status}; operational schedule is read-only.</div>}
  </div>;
}
