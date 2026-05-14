import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { createJob, getJobById, getJobFormData, updateJob } from "../../../api/jobApi";
import { AdminWorkspaceLayout } from "../AdminWorkspaceLayout";

const LOAD_TYPES = [
  { value: "general",      label: "General cargo" },
  { value: "hazardous",    label: "Hazardous materials" },
  { value: "refrigerated", label: "Refrigerated / temperature-controlled" },
  { value: "oversized",    label: "Oversized / heavy load" },
  { value: "fragile",      label: "Fragile goods" }
];

const PRIORITY_OPTIONS = [
  { value: "standard", label: "Standard" },
  { value: "priority", label: "Priority" },
  { value: "critical", label: "Critical — urgent dispatch" }
];

const STOP_TYPES = [
  { value: "pickup",   label: "Pickup" },
  { value: "delivery", label: "Delivery" },
  { value: "waypoint", label: "Waypoint / transit stop" }
];

function Field({ label, hint, required, children }) {
  return (
    <div className="af-field">
      <label className="af-label">{label}{required && <span style={{ color: "#dc2626" }}> *</span>}</label>
      {children}
      {hint && <p className="af-hint">{hint}</p>}
    </div>
  );
}

const emptyStop = () => ({ stop_type: "delivery", address: "", contact_name: "", contact_phone: "", planned_arrival: "", notes: "" });

const emptyFields = {
  customer_id: "", client_name: "", route_id: "",
  pickup_address: "", drop_address: "",
  planned_departure: "", dock_window: "",
  load_type: "general", load_weight_kg: "", load_description: "", freight_amount: "",
  priority_level: "standard", special_instructions: "",
  driver_id: "", vehicle_id: "", trailer_id: ""
};

export function JobFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isEdit = Boolean(id);

  const [formData, setFormData]   = useState({ customers: [], drivers: [], vehicles: [], trailers: [], routes: [] });
  const [fields, setFields]       = useState(emptyFields);
  const [stops, setStops]         = useState([]);
  const [loading, setLoading]     = useState(true);
  const [loadErr, setLoadErr]     = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr]   = useState("");

  useEffect(() => {
    async function init() {
      try {
        const fdRes = await getJobFormData();
        setFormData(fdRes.data);

        if (isEdit) {
          const jobRes = await getJobById(id);
          const j = jobRes.data;
          setFields({
            customer_id:         j.customer?.id ? String(j.customer.id) : "",
            client_name:         j.customer?.name || "",
            route_id:            j.route?.code ? "" : "",
            pickup_address:      j.route?.pickupAddress || "",
            drop_address:        j.route?.dropAddress || "",
            planned_departure:   j.form?.planned_departure || "",
            dock_window:         j.schedule?.dockWindow !== "—" ? j.schedule?.dockWindow || "" : "",
            load_type:           j.load?.type || "general",
            load_weight_kg:      j.load?.weightKg !== "—" ? (j.load?.weightKg || "").replace(" kg", "") : "",
            load_description:    j.load?.description !== "—" ? j.load?.description || "" : "",
            freight_amount:      j.load?.freight !== "—" ? (j.load?.freight || "").replace("£", "").replace(/,/g, "") : "",
            priority_level:      j.priority || "standard",
            special_instructions: j.specialInstructions || "",
            driver_id:           j.form?.driver_id ? String(j.form.driver_id) : "",
            vehicle_id:          j.form?.vehicle_id ? String(j.form.vehicle_id) : "",
            trailer_id:          j.form?.trailer_id ? String(j.form.trailer_id) : ""
          });
          setStops(j.stops.map(s => ({
            stop_type:       s.type,
            address:         s.address,
            contact_name:    s.contactName !== "—" ? s.contactName : "",
            contact_phone:   s.contactPhone !== "—" ? s.contactPhone : "",
            planned_arrival: "",
            notes:           s.notes !== "—" ? s.notes : ""
          })));
        }
      } catch {
        setLoadErr("Could not load form data. Please go back and try again.");
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [id, isEdit]);

  function set(key, val) {
    setFields(prev => ({ ...prev, [key]: val }));
  }

  function handleRouteChange(routeId) {
    const route = formData.routes.find(r => String(r.id) === routeId);
    setFields(prev => ({
      ...prev,
      route_id: routeId,
      pickup_address: route && !prev.pickup_address ? route.origin_hub : prev.pickup_address,
      drop_address: route && !prev.drop_address ? route.destination_hub : prev.drop_address
    }));
  }

  // Stops helpers
  function addStop() { setStops(prev => [...prev, emptyStop()]); }
  function removeStop(i) { setStops(prev => prev.filter((_, idx) => idx !== i)); }
  function setStop(i, key, val) {
    setStops(prev => prev.map((s, idx) => idx === i ? { ...s, [key]: val } : s));
  }

  const selectedRoute = formData.routes.find(r => String(r.id) === fields.route_id);
  const selectedCustomer = formData.customers.find(c => String(c.id) === fields.customer_id);

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitErr("");

    const payload = {
      customer_id:          fields.customer_id ? Number(fields.customer_id) : null,
      client_name:          fields.client_name || null,
      route_id:             fields.route_id ? Number(fields.route_id) : null,
      pickup_address:       fields.pickup_address || null,
      drop_address:         fields.drop_address || null,
      planned_departure:    fields.planned_departure || null,
      dock_window:          fields.dock_window || null,
      load_type:            fields.load_type,
      load_weight_kg:       fields.load_weight_kg ? Number(fields.load_weight_kg) : null,
      load_description:     fields.load_description || null,
      freight_amount:       fields.freight_amount ? Number(fields.freight_amount) : null,
      priority_level:       fields.priority_level,
      special_instructions: fields.special_instructions || null,
      driver_id:            fields.driver_id ? Number(fields.driver_id) : null,
      vehicle_id:           fields.vehicle_id ? Number(fields.vehicle_id) : null,
      trailer_id:           fields.trailer_id ? Number(fields.trailer_id) : null,
      stops:                stops.filter(s => s.address.trim())
    };

    setSubmitting(true);
    try {
      if (isEdit) {
        await updateJob(id, payload);
        navigate(`/admin/jobs/${id}`);
      } else {
        const res = await createJob(payload);
        navigate(`/admin/jobs/${res.data.job.id}`);
      }
    } catch (err) {
      setSubmitErr(err?.response?.data?.message || "Could not save job. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AdminWorkspaceLayout
      badge="Job management"
      title={isEdit ? "Edit job" : "Create new job"}
      description={isEdit ? "Update job details, load info, and stops." : "Book a new freight job with customer, load, route, and multi-stop details."}
      highlights={[]}
    >
      <div className="af-page" style={{ maxWidth: 920 }}>
        <div className="af-back-row">
          <button className="af-back-btn" type="button" onClick={() => navigate(isEdit ? `/admin/jobs/${id}` : "/admin/jobs")}>
            ← Back
          </button>
        </div>

        {loadErr && (
          <div className="state-card error" style={{ marginBottom: 20 }}>
            <span className="state-dot error" />
            <div><strong>Load error</strong><p>{loadErr}</p></div>
          </div>
        )}

        {loading ? (
          <div className="state-card">
            <span className="state-dot loading" />
            <div><strong>Loading...</strong><p>Fetching form data</p></div>
          </div>
        ) : (
          <form className="af-form" onSubmit={handleSubmit}>

            {/* ── Section 1: Customer & Priority ── */}
            <div className="af-section">
              <p className="af-section-title">Customer & job details</p>
              <div className="af-grid-2">
                <Field label="Customer account" hint={selectedCustomer ? `Contact: ${selectedCustomer.contact_name || "—"} · ${selectedCustomer.phone || "—"}` : "Select a registered customer or enter a free-text client name below"}>
                  <select className="af-select" value={fields.customer_id} onChange={e => set("customer_id", e.target.value)}>
                    <option value="">— Select customer —</option>
                    {formData.customers.map(c => (
                      <option key={c.id} value={c.id}>{c.company_name}</option>
                    ))}
                  </select>
                </Field>

                <Field label="Client name (if no account)" hint="Used when customer has no account in the system">
                  <input
                    className="af-input"
                    type="text"
                    placeholder="e.g. Northline Retail"
                    value={fields.client_name}
                    onChange={e => set("client_name", e.target.value)}
                    disabled={Boolean(fields.customer_id)}
                  />
                </Field>

                <Field label="Priority level">
                  <select className="af-select" value={fields.priority_level} onChange={e => set("priority_level", e.target.value)}>
                    {PRIORITY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </Field>

                <Field label="Special instructions" hint="Any special handling, access codes, or delivery notes">
                  <textarea
                    className="af-input"
                    style={{ minHeight: 68, resize: "vertical" }}
                    placeholder="e.g. Call 30 mins before arrival. Gate code: 1234."
                    value={fields.special_instructions}
                    onChange={e => set("special_instructions", e.target.value)}
                  />
                </Field>
              </div>
            </div>

            {/* ── Section 2: Pickup & Drop ── */}
            <div className="af-section">
              <p className="af-section-title">Pickup & delivery locations</p>
              <div className="af-grid-2">
                <Field label="Predefined route (optional)" hint={selectedRoute ? `${selectedRoute.distance_km} km · ETA ${selectedRoute.standard_eta_hours}h · Toll ~£${Number(selectedRoute.toll_estimate_gbp).toFixed(2)}` : "Select a predefined route or use custom addresses below"}>
                  <select className="af-select" value={fields.route_id} onChange={e => handleRouteChange(e.target.value)}>
                    <option value="">— Custom addresses —</option>
                    {formData.routes.map(r => (
                      <option key={r.id} value={r.id}>{r.origin_hub} → {r.destination_hub} ({r.route_code})</option>
                    ))}
                  </select>
                </Field>

                <Field label="Dock window (optional)" hint="e.g. 07:00 – 09:00 AM">
                  <input className="af-input" type="text" placeholder="e.g. 07:00 – 09:00 AM" value={fields.dock_window} onChange={e => set("dock_window", e.target.value)} />
                </Field>

                <Field label="Pickup address">
                  <textarea
                    className="af-input"
                    style={{ minHeight: 72, resize: "vertical" }}
                    placeholder="Full pickup address"
                    value={fields.pickup_address}
                    onChange={e => set("pickup_address", e.target.value)}
                  />
                </Field>

                <Field label="Drop / delivery address">
                  <textarea
                    className="af-input"
                    style={{ minHeight: 72, resize: "vertical" }}
                    placeholder="Full delivery address"
                    value={fields.drop_address}
                    onChange={e => set("drop_address", e.target.value)}
                  />
                </Field>

                <Field label="Planned departure date & time">
                  <input className="af-input" type="datetime-local" value={fields.planned_departure} onChange={e => set("planned_departure", e.target.value)} />
                </Field>
              </div>
            </div>

            {/* ── Section 3: Load Details ── */}
            <div className="af-section">
              <p className="af-section-title">Load details</p>
              <div className="af-grid-3">
                <Field label="Load type">
                  <select className="af-select" value={fields.load_type} onChange={e => set("load_type", e.target.value)}>
                    {LOAD_TYPES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </Field>

                <Field label="Weight (kg)" hint="Total load weight in kilograms">
                  <input className="af-input" type="number" min="0" step="0.1" placeholder="e.g. 5000" value={fields.load_weight_kg} onChange={e => set("load_weight_kg", e.target.value)} />
                </Field>

                <Field label="Freight amount (£)" hint="Invoice value for this job">
                  <div className="af-input-prefix-wrap">
                    <span className="af-prefix">£</span>
                    <input className="af-input af-input-prefixed" type="number" min="0" step="0.01" placeholder="e.g. 1800.00" value={fields.freight_amount} onChange={e => set("freight_amount", e.target.value)} />
                  </div>
                </Field>

                <div style={{ gridColumn: "1 / -1" }}>
                  <Field label="Load description" hint="Describe the goods being transported">
                    <textarea
                      className="af-input"
                      style={{ minHeight: 60, resize: "vertical" }}
                      placeholder="e.g. Palletised retail goods — 20 pallets of mixed clothing"
                      value={fields.load_description}
                      onChange={e => set("load_description", e.target.value)}
                    />
                  </Field>
                </div>
              </div>
            </div>

            {/* ── Section 4: Driver & Vehicle ── */}
            <div className="af-section">
              <p className="af-section-title">Driver, vehicle & trolley assignment (optional)</p>
              <div className="af-grid-3">
                <Field label="Driver" hint="You can assign a driver now or later from the job detail page">
                  <select className="af-select" value={fields.driver_id} onChange={e => set("driver_id", e.target.value)}>
                    <option value="">— Assign later —</option>
                    {formData.drivers.map(d => (
                      <option key={d.id} value={d.id}>
                        {d.full_name} ({d.employee_code}) · {d.shift_status}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label="Vehicle / truck" hint="Selecting a vehicle marks it as planned">
                  <select className="af-select" value={fields.vehicle_id} onChange={e => set("vehicle_id", e.target.value)}>
                    <option value="">— Assign later —</option>
                    {formData.vehicles.map(v => (
                      <option key={v.id} value={v.id}>
                        {v.registration_number} · {v.model_name} ({v.truck_type}){v.capacity_tonnes ? ` · ${v.capacity_tonnes}t` : ""}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label="Trailer / trolley" hint="Select the trolley to send with this truck">
                  <select className="af-select" value={fields.trailer_id} onChange={e => set("trailer_id", e.target.value)}>
                    <option value="">— Assign later —</option>
                    {formData.trailers.map(t => (
                      <option key={t.id} value={t.id}>
                        {t.registration_number} · {t.trailer_type} ({t.trailer_code}){t.capacity_tonnes ? ` · ${t.capacity_tonnes}t` : ""}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            </div>

            {/* ── Section 5: Multi-stop ── */}
            <div className="af-section">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                <div>
                  <p className="af-section-title" style={{ margin: 0 }}>Additional stops</p>
                  <p style={{ fontSize: "0.78rem", color: "#64748b", margin: "4px 0 0" }}>Add intermediate pickups, deliveries, or waypoints along the route.</p>
                </div>
                <button type="button" className="header-action-button" onClick={addStop} style={{ whiteSpace: "nowrap" }}>
                  + Add stop
                </button>
              </div>

              {stops.length === 0 && (
                <div style={{ padding: "20px", background: "#f8fafc", borderRadius: 8, border: "1px dashed #cbd5e1", textAlign: "center", color: "#94a3b8", fontSize: "0.86rem" }}>
                  No additional stops. Click "+ Add stop" for multi-stop deliveries.
                </div>
              )}

              {stops.map((s, i) => (
                <div key={i} style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: "16px", marginBottom: 10, position: "relative" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                    <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "#2563eb", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                      Stop {i + 1}
                    </span>
                    <button
                      type="button"
                      className="header-action-button danger"
                      style={{ height: 26, padding: "0 10px", fontSize: "0.74rem" }}
                      onClick={() => removeStop(i)}
                    >
                      Remove
                    </button>
                  </div>

                  <div className="af-grid-3" style={{ gap: 12 }}>
                    <Field label="Stop type">
                      <select className="af-select" value={s.stop_type} onChange={e => setStop(i, "stop_type", e.target.value)}>
                        {STOP_TYPES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </Field>

                    <Field label="Contact name">
                      <input className="af-input" type="text" placeholder="Contact at this stop" value={s.contact_name} onChange={e => setStop(i, "contact_name", e.target.value)} />
                    </Field>

                    <Field label="Contact phone">
                      <input className="af-input" type="tel" placeholder="Phone number" value={s.contact_phone} onChange={e => setStop(i, "contact_phone", e.target.value)} />
                    </Field>

                    <div style={{ gridColumn: "1 / -1" }}>
                      <Field label="Stop address" required>
                        <textarea
                          className="af-input"
                          style={{ minHeight: 60, resize: "vertical" }}
                          placeholder="Full address for this stop"
                          value={s.address}
                          onChange={e => setStop(i, "address", e.target.value)}
                          required
                        />
                      </Field>
                    </div>

                    <Field label="Planned arrival">
                      <input className="af-input" type="datetime-local" value={s.planned_arrival} onChange={e => setStop(i, "planned_arrival", e.target.value)} />
                    </Field>

                    <div style={{ gridColumn: "2 / -1" }}>
                      <Field label="Stop notes">
                        <input className="af-input" type="text" placeholder="e.g. Unload bay 3, call on arrival" value={s.notes} onChange={e => setStop(i, "notes", e.target.value)} />
                      </Field>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {submitErr && (
              <div className="state-card error">
                <span className="state-dot error" />
                <div><strong>Error</strong><p>{submitErr}</p></div>
              </div>
            )}

            <div className="af-actions">
              <button type="button" className="header-action-button" onClick={() => navigate(isEdit ? `/admin/jobs/${id}` : "/admin/jobs")}>
                Cancel
              </button>
              <button type="submit" className="af-submit-btn" disabled={submitting}>
                {submitting ? "Saving..." : isEdit ? "Save changes →" : `Create job${stops.length > 0 ? ` (${stops.length} stop${stops.length > 1 ? "s" : ""})` : ""} →`}
              </button>
            </div>
          </form>
        )}
      </div>
    </AdminWorkspaceLayout>
  );
}
