import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { createJob, getJobById, getJobFormData, updateJob } from "../../../api/jobApi";
import { AdminWorkspaceLayout } from "../AdminWorkspaceLayout";

function Field({ label, hint, required, error, children }) {
  return (
    <div className="af-field">
      <label className="af-label">{label}{required && <span style={{ color: "#dc2626" }}> *</span>}</label>
      {children}
      {error && <p className="af-field-error">{error}</p>}
      {hint && <p className="af-hint">{hint}</p>}
    </div>
  );
}

const emptyFields = {
  customer_id: "",
  client_name: "",
  client_phone: "",
  route_id: "",
  pickup_address: "",
  drop_address: "",
  planned_departure: "",
  delivery_deadline: "",
  load_description: "",
  freight_amount: "",
  driver_id: "",
  vehicle_id: "",
  trailer_id: ""
};

function toInputDateTime(date) {
  if (!date) return "";
  const next = new Date(date);
  if (Number.isNaN(next.getTime())) return "";
  const offsetMs = next.getTimezoneOffset() * 60000;
  return new Date(next.getTime() - offsetMs).toISOString().slice(0, 16);
}

function addHours(value, hours) {
  if (!value || !hours) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  date.setMinutes(date.getMinutes() + Number(hours) * 60 + 30);
  return toInputDateTime(date);
}

function displayDateTime(value) {
  if (!value) return "Select route and pickup time";
  return new Date(value).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function addressLines(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
}

function getApiErrorMessage(err) {
  const data = err?.response?.data;
  return data?.error || data?.message || err?.message || "Could not save job. Please try again.";
}

function validateJobForm(fields) {
  const errors = {};
  if (!fields.client_name.trim()) errors.client_name = "Enter the client name.";
  if (!fields.pickup_address.trim()) errors.pickup_address = "Enter the pickup address.";
  if (!fields.drop_address.trim()) errors.drop_address = "Enter the delivery address.";
  if (!fields.load_description.trim()) errors.load_description = "Enter the goods or load details.";
  return errors;
}

export function JobFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isEdit = Boolean(id);

  const [formData, setFormData] = useState({ customers: [], drivers: [], vehicles: [], routes: [] });
  const [fields, setFields] = useState(emptyFields);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});

  useEffect(() => {
    async function init() {
      try {
        const fdRes = await getJobFormData();
        setFormData(fdRes.data);

        if (isEdit) {
          const jobRes = await getJobById(id);
          const j = jobRes.data;
          setFields({
            customer_id: j.form?.customer_id ? String(j.form.customer_id) : "",
            client_name: j.customer?.name !== "—" ? j.customer?.name || "" : "",
            client_phone: j.customer?.phone !== "—" ? j.customer?.phone || "" : "",
            route_id: j.form?.route_id ? String(j.form.route_id) : "",
            pickup_address: j.route?.pickupAddress || "",
            drop_address: j.route?.dropAddress || "",
            planned_departure: j.form?.planned_departure || "",
            delivery_deadline: j.form?.delivery_deadline || "",
            load_description: j.load?.description !== "—" ? j.load?.description || "" : "",
            freight_amount: j.load?.freight !== "—" ? (j.load?.freight || "").replace("£", "").replace(/,/g, "") : "",
            driver_id: j.form?.driver_id ? String(j.form.driver_id) : "",
            vehicle_id: j.form?.vehicle_id ? String(j.form.vehicle_id) : "",
            trailer_id: j.form?.trailer_id ? String(j.form.trailer_id) : ""
          });
        }
      } catch {
        setLoadErr("Could not load form data. Please go back and try again.");
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [id, isEdit]);

  function set(key, value) {
    setSubmitErr("");
    setFieldErrors(prev => ({ ...prev, [key]: "" }));
    setFields(prev => ({ ...prev, [key]: value }));
  }

  function handleCustomerChange(customerId) {
    const customer = formData.customers.find(c => String(c.id) === customerId);
    const pickupOptions = customer ? addressLines(customer.saved_pickup_addresses || customer.address) : [];
    const dropOptions = customer ? addressLines(customer.saved_drop_addresses) : [];
    setFields(prev => ({
      ...prev,
      customer_id: customerId,
      client_name: customer ? customer.company_name : "",
      client_phone: customer ? customer.phone || "" : prev.client_phone,
      pickup_address: customer ? pickupOptions[0] || customer.address || prev.pickup_address : prev.pickup_address,
      drop_address: customer ? dropOptions[0] || prev.drop_address : prev.drop_address
    }));
    setFieldErrors(prev => ({ ...prev, client_name: "", pickup_address: "", drop_address: "" }));
  }

  function handleRouteChange(routeId) {
    const route = formData.routes.find(r => String(r.id) === routeId);
    setFields(prev => {
      const suggestedDeadline = route ? addHours(prev.planned_departure, route.standard_eta_hours) : "";
      return {
        ...prev,
        route_id: routeId,
        pickup_address: route ? route.origin_hub : prev.pickup_address,
        drop_address: route ? route.destination_hub : prev.drop_address,
        delivery_deadline: prev.delivery_deadline || suggestedDeadline
      };
    });
    if (route) setFieldErrors(prev => ({ ...prev, pickup_address: "", drop_address: "" }));
  }

  function handleDepartureChange(value) {
    setFields(prev => {
      const route = formData.routes.find(r => String(r.id) === prev.route_id);
      return {
        ...prev,
        planned_departure: value,
        delivery_deadline: prev.delivery_deadline || (route ? addHours(value, route.standard_eta_hours) : "")
      };
    });
  }

  const selectedRoute = useMemo(
    () => formData.routes.find(r => String(r.id) === fields.route_id),
    [fields.route_id, formData.routes]
  );
  const selectedCustomer = useMemo(
    () => formData.customers.find(c => String(c.id) === fields.customer_id),
    [fields.customer_id, formData.customers]
  );
  const pickupOptions = useMemo(() => {
    if (!selectedCustomer) return [];
    return addressLines(selectedCustomer.saved_pickup_addresses || selectedCustomer.address);
  }, [selectedCustomer]);
  const dropOptions = useMemo(() => {
    if (!selectedCustomer) return [];
    return addressLines(selectedCustomer.saved_drop_addresses);
  }, [selectedCustomer]);

  const etaPreview = selectedRoute ? addHours(fields.planned_departure, selectedRoute.standard_eta_hours) : "";

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitErr("");
    const validationErrors = validateJobForm(fields);
    setFieldErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) {
      setSubmitErr("Please amend the highlighted fields.");
      return;
    }

    const payload = {
      customer_id: fields.customer_id ? Number(fields.customer_id) : null,
      client_name: fields.client_name || null,
      client_phone: fields.client_phone || null,
      route_id: fields.route_id ? Number(fields.route_id) : null,
      pickup_address: fields.pickup_address || null,
      drop_address: fields.drop_address || null,
      planned_departure: fields.planned_departure || null,
      delivery_deadline: fields.delivery_deadline || etaPreview || null,
      load_type: "general",
      load_description: fields.load_description || null,
      freight_amount: fields.freight_amount ? Number(fields.freight_amount) : null,
      priority_level: "standard",
      driver_id: fields.driver_id ? Number(fields.driver_id) : null,
      vehicle_id: fields.vehicle_id ? Number(fields.vehicle_id) : null,
      trailer_id: fields.trailer_id ? Number(fields.trailer_id) : null,
      stops: []
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
      setSubmitErr(getApiErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AdminWorkspaceLayout
      badge="Job management"
      title={isEdit ? "Edit job" : "Add job"}
      description="Simple job booking with automatic ETA when a saved route is selected."
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
          <form className="af-form" onSubmit={handleSubmit} noValidate>
            <div className="af-section">
              <p className="af-section-title">Client details</p>
              <div className="af-grid-2">
                <Field label="Customer account" hint="Optional. Select if this client already exists.">
                  <select className="af-select" value={fields.customer_id} onChange={e => handleCustomerChange(e.target.value)}>
                    <option value="">No account / enter manually</option>
                    {formData.customers.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
                  </select>
                </Field>
                <Field label="Client name" required error={fieldErrors.client_name}>
                  <input className="af-input" type="text" placeholder="e.g. Northline Retail" value={fields.client_name} onChange={e => set("client_name", e.target.value)} aria-invalid={Boolean(fieldErrors.client_name)} />
                </Field>
                <Field label="Contact number">
                  <input className="af-input" type="tel" placeholder="e.g. 07700 900000" value={fields.client_phone} onChange={e => set("client_phone", e.target.value)} />
                </Field>
                {selectedCustomer && (
                  <div style={{ gridColumn: "1 / -1", padding: 12, border: "1px solid #e2e8f0", borderRadius: 8, background: "#f8fafc" }}>
                    <span className="card-label">Auto-filled from customer</span>
                    <p style={{ margin: "5px 0 0", color: "#475569", fontSize: "0.86rem" }}>
                      {selectedCustomer.contact_name || "Contact not set"} · {selectedCustomer.phone || "Phone not set"} · {selectedCustomer.email || "Email not set"}
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="af-section">
              <p className="af-section-title">Trip details</p>
              <div className="af-grid-2">
                <Field label="Saved route" hint="Select a route to auto-fill pickup, delivery, distance, and ETA.">
                  <select className="af-select" value={fields.route_id} onChange={e => handleRouteChange(e.target.value)}>
                    <option value="">Custom pickup and delivery</option>
                    {formData.routes.map(r => (
                      <option key={r.id} value={r.id}>{r.origin_hub} → {r.destination_hub}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Pickup date & time">
                  <input className="af-input" type="datetime-local" value={fields.planned_departure} onChange={e => handleDepartureChange(e.target.value)} />
                </Field>
                <Field label="Pickup address" required error={fieldErrors.pickup_address}>
                  {pickupOptions.length > 0 && (
                    <select className="af-select" style={{ marginBottom: 8 }} value="" onChange={e => e.target.value && set("pickup_address", e.target.value)}>
                      <option value="">Choose saved pickup address</option>
                      {pickupOptions.map((address, index) => <option key={`${address}-${index}`} value={address}>{address}</option>)}
                    </select>
                  )}
                  <textarea className="af-input" style={{ minHeight: 72, resize: "vertical" }} placeholder="Full pickup address" value={fields.pickup_address} onChange={e => set("pickup_address", e.target.value)} aria-invalid={Boolean(fieldErrors.pickup_address)} />
                </Field>
                <Field label="Delivery address" required error={fieldErrors.drop_address}>
                  {dropOptions.length > 0 && (
                    <select className="af-select" style={{ marginBottom: 8 }} value="" onChange={e => e.target.value && set("drop_address", e.target.value)}>
                      <option value="">Choose saved delivery address</option>
                      {dropOptions.map((address, index) => <option key={`${address}-${index}`} value={address}>{address}</option>)}
                    </select>
                  )}
                  <textarea className="af-input" style={{ minHeight: 72, resize: "vertical" }} placeholder="Full delivery address" value={fields.drop_address} onChange={e => set("drop_address", e.target.value)} aria-invalid={Boolean(fieldErrors.drop_address)} />
                </Field>
              </div>

              <div style={{ marginTop: 16, padding: 16, border: "1px solid #dbeafe", background: "#eff6ff", borderRadius: 8 }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 12 }}>
                  <div>
                    <span className="card-label">Distance</span>
                    <strong style={{ display: "block", color: "#1e3a8a" }}>{selectedRoute?.distance_km ? `${selectedRoute.distance_km} km` : "Route not selected"}</strong>
                  </div>
                  <div>
                    <span className="card-label">ETA</span>
                    <strong style={{ display: "block", color: "#1e3a8a" }}>{selectedRoute?.standard_eta_hours ? `${selectedRoute.standard_eta_hours}h travel + 30m buffer` : "Manual"}</strong>
                  </div>
                  <div>
                    <span className="card-label">Suggested delivery</span>
                    <strong style={{ display: "block", color: "#1e3a8a" }}>{displayDateTime(etaPreview)}</strong>
                  </div>
                </div>
              </div>

              <div className="af-grid-2" style={{ marginTop: 16 }}>
                <Field label="Delivery deadline" hint="Auto-filled from route ETA. You can change it.">
                  <input className="af-input" type="datetime-local" value={fields.delivery_deadline} onChange={e => set("delivery_deadline", e.target.value)} />
                </Field>
              </div>
            </div>

            <div className="af-section">
              <p className="af-section-title">Load & assignment</p>
              <div className="af-grid-2">
                <Field label="Goods / load details" required error={fieldErrors.load_description}>
                  <textarea className="af-input" style={{ minHeight: 78, resize: "vertical" }} placeholder="e.g. 20 pallets of retail goods" value={fields.load_description} onChange={e => set("load_description", e.target.value)} aria-invalid={Boolean(fieldErrors.load_description)} />
                </Field>
                <Field label="Freight amount (£)">
                  <div className="af-input-prefix-wrap">
                    <span className="af-prefix">£</span>
                    <input className="af-input af-input-prefixed" type="number" min="0" step="0.01" placeholder="e.g. 1800.00" value={fields.freight_amount} onChange={e => set("freight_amount", e.target.value)} />
                  </div>
                </Field>
                <Field label="Assign driver">
                  <select className="af-select" value={fields.driver_id} onChange={e => set("driver_id", e.target.value)}>
                    <option value="">Assign later</option>
                    {formData.drivers.map(d => <option key={d.id} value={d.id}>{d.full_name} · {d.shift_status}</option>)}
                  </select>
                </Field>
                <Field label="Assign vehicle">
                  <select className="af-select" value={fields.vehicle_id} onChange={e => set("vehicle_id", e.target.value)}>
                    <option value="">Assign later</option>
                    {formData.vehicles.map(v => (
                      <option key={v.id} value={v.id}>
                        {v.registration_number} · {v.truck_type || v.model_name || "Truck"} · {v.status}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Assign trolley / trailer">
                  <select className="af-select" value={fields.trailer_id} onChange={e => set("trailer_id", e.target.value)}>
                    <option value="">Assign later</option>
                    {(formData.trailers || []).map(t => (
                      <option key={t.id} value={t.id}>
                        {t.registration_number} · {t.trailer_type || "Trolley"} · {t.status}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
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
                {submitting ? "Saving..." : isEdit ? "Save changes →" : "Create job →"}
              </button>
            </div>
          </form>
        )}
      </div>
    </AdminWorkspaceLayout>
  );
}
