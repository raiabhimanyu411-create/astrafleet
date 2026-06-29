import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { createAdminTrip, getAdminTripById, getTripFormData, updateAdminTrip } from "../../api/adminApi";
import { AdminWorkspaceLayout } from "./AdminWorkspaceLayout";

const PRIORITY_OPTIONS = [
  { value: "standard", label: "Standard" },
  { value: "priority", label: "Priority" },
  { value: "critical", label: "Critical — Urgent Dispatch" }
];

function Field({ label, children, hint }) {
  return (
    <div className="af-field">
      <label className="af-label">{label}</label>
      {children}
      {hint && <p className="af-hint">{hint}</p>}
    </div>
  );
}

export function AdminTripAssignPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEdit = Boolean(id);

  const [formData, setFormData] = useState({ drivers: [], vehicles: [], trailers: [], routes: [] });
  const [loadingForm, setLoadingForm] = useState(true);
  const [formError, setFormError] = useState("");

  const [fields, setFields] = useState({
    route_id: "",
    vehicle_id: "",
    trailer_id: "",
    driver_id: "",
    client_name: "",
    planned_departure: "",
    dock_window: "",
    freight_amount: "",
    priority_level: "standard",
    dispatcher_notes: ""
  });

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  useEffect(() => {
    Promise.all([
      getTripFormData(),
      isEdit ? getAdminTripById(id) : Promise.resolve(null)
    ])
      .then(([fdRes, tripRes]) => {
        setFormData(fdRes.data);
        if (tripRes) {
          const trip = tripRes.data;
          setFields({
            route_id: trip.form?.route_id ? String(trip.form.route_id) : "",
            vehicle_id: trip.form?.vehicle_id ? String(trip.form.vehicle_id) : "",
            trailer_id: trip.form?.trailer_id ? String(trip.form.trailer_id) : "",
            driver_id: trip.form?.driver_id ? String(trip.form.driver_id) : "",
            client_name: trip.form?.client_name || "",
            planned_departure: trip.form?.planned_departure || "",
            dock_window: trip.form?.dock_window || "",
            freight_amount: trip.form?.freight_amount || "",
            priority_level: trip.form?.priority_level || "standard",
            dispatcher_notes: trip.dispatcherNotes !== "—" ? trip.dispatcherNotes || "" : ""
          });
        }
      })
      .catch(() => setFormError("Form data could not be loaded. Please refresh the page."))
      .finally(() => setLoadingForm(false));
  }, [id, isEdit]);

  const selectedRoute = formData.routes.find(r => String(r.id) === fields.route_id);
  const suggestedDriver = formData.drivers.find(d => d.shift_status === "ready" && d.compliance_status !== "blocked") || formData.drivers[0];
  const suggestedVehicle = formData.vehicles.find(v => v.status === "available") || formData.vehicles[0];

  function set(key, val) {
    setFields(prev => ({ ...prev, [key]: val }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitError("");

    if (!fields.route_id || !fields.vehicle_id || !fields.trailer_id || !fields.driver_id || !fields.planned_departure) {
      setSubmitError("Route, truck, trailer, driver, and departure date/time are required.");
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        route_id: Number(fields.route_id),
        vehicle_id: Number(fields.vehicle_id),
        trailer_id: Number(fields.trailer_id),
        driver_id: Number(fields.driver_id),
        client_name: fields.client_name || null,
        planned_departure: fields.planned_departure,
        dock_window: fields.dock_window || null,
        freight_amount: fields.freight_amount ? Number(fields.freight_amount) : null,
        priority_level: fields.priority_level,
        dispatcher_notes: fields.dispatcher_notes || null
      };

      if (isEdit) {
        await updateAdminTrip(id, payload);
        navigate(`/admin/trips/${id}`);
      } else {
        const res = await createAdminTrip(payload);
        navigate(`/admin/trips/${res.data.trip.id}`);
      }
    } catch (err) {
      setSubmitError(err?.response?.data?.message || `Trip could not be ${isEdit ? "updated" : "assigned"}. Please try again.`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AdminWorkspaceLayout
      badge={isEdit ? "Trip editing" : "Trip assignment"}
      title={isEdit ? "Edit trip" : "Assign a new trip"}
      description={isEdit ? "Update the route, driver, truck, trailer, schedule, and freight details for this dispatch." : "Select a driver, route, truck, trailer, and schedule to create a new dispatch."}
      highlights={[]}
    >
      <div className="af-page">
        <div className="af-back-row">
          <button className="af-back-btn" type="button" onClick={() => navigate("/admin/trips")}>
            ← Back To Trips Dashboard
          </button>
        </div>

        {formError && (
          <div className="state-card error" style={{ marginBottom: 20 }}>
            <span className="state-dot error" />
            <div><strong>Load Error</strong><p>{formError}</p></div>
          </div>
        )}

        {loadingForm ? (
          <div className="state-card" style={{ marginBottom: 20 }}>
            <span className="state-dot loading" />
            <div><strong>Loading...</strong><p>Loading form data</p></div>
          </div>
        ) : (
          <form className="af-form" onSubmit={handleSubmit}>

            {/* ── Section: Route ── */}
            <div className="af-section">
              <p className="af-section-title">Select Route</p>
              <div className="af-grid-2">
                <Field label="Route" hint={selectedRoute ? `${Math.round(selectedRoute.distance_km * 0.621371)} mi · Est. ${selectedRoute.standard_eta_hours}h · Toll ~£${Number(selectedRoute.toll_estimate_gbp).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : null}>
                  <select
                    className="af-select"
                    value={fields.route_id}
                    onChange={e => set("route_id", e.target.value)}
                    required
                  >
                    <option value="">— Select Route —</option>
                    {formData.routes.map(r => (
                      <option key={r.id} value={r.id}>
                        {r.origin_hub} → {r.destination_hub} ({r.route_code})
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label="Client Name (Optional)">
                  <input
                    className="af-input"
                    type="text"
                    placeholder="e.g. Northline Retail"
                    value={fields.client_name}
                    onChange={e => set("client_name", e.target.value)}
                  />
                </Field>
              </div>
            </div>

            {/* ── Section: Driver + Vehicle ── */}
            <div className="af-section">
              <p className="af-section-title">Assign Driver, Truck And Trailer</p>
              <div className="state-card" style={{ marginBottom: 14 }}>
                <span className="state-dot loading" />
                <div>
                  <strong>Auto Suggestions</strong>
                  <p>
                    Driver: {suggestedDriver ? `${suggestedDriver.full_name} (${suggestedDriver.shift_status})` : "No Driver Available"} ·
                    Vehicle: {suggestedVehicle ? `${suggestedVehicle.registration_number} (${suggestedVehicle.truck_type || suggestedVehicle.status})` : "No Vehicle Available"}
                  </p>
                </div>
                <button className="header-action-button" type="button" onClick={() => {
                  if (suggestedDriver) set("driver_id", String(suggestedDriver.id));
                  if (suggestedVehicle) set("vehicle_id", String(suggestedVehicle.id));
                }}>
                  Use Suggestions
                </button>
              </div>
              <div className="af-grid-3">
                <Field label="Driver">
                  <select
                    className="af-select"
                    value={fields.driver_id}
                    onChange={e => set("driver_id", e.target.value)}
                    required
                  >
                    <option value="">— Select Driver —</option>
                    {formData.drivers.map(d => (
                      <option key={d.id} value={d.id}>
                        {d.full_name} ({d.employee_code}) · {d.shift_status}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label="Vehicle / Truck">
                  <select
                    className="af-select"
                    value={fields.vehicle_id}
                    onChange={e => set("vehicle_id", e.target.value)}
                    required
                  >
                    <option value="">— Select Vehicle —</option>
                    {formData.vehicles.map(v => (
                      <option key={v.id} value={v.id}>
                        {v.registration_number} · {v.model_name} ({v.truck_type}) · {v.status}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label="Trailer">
                  <select
                    className="af-select"
                    value={fields.trailer_id}
                    onChange={e => set("trailer_id", e.target.value)}
                    required
                  >
                    <option value="">— Select Trailer —</option>
                    {formData.trailers.map(t => (
                      <option key={t.id} value={t.id}>
                        {t.registration_number} · {t.trailer_type} ({t.trailer_code}) · {t.status}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            </div>

            {/* ── Section: Schedule ── */}
            <div className="af-section">
              <p className="af-section-title">Schedule And Dispatch Details</p>
              <div className="af-grid-3">
                <Field label="Planned Departure" hint="ETA will be calculated automatically from the selected route">
                  <input
                    className="af-input"
                    type="datetime-local"
                    value={fields.planned_departure}
                    onChange={e => set("planned_departure", e.target.value)}
                    required
                  />
                </Field>

                <Field label="Dock Window (Optional)" hint="e.g. 07:00 – 09:00 AM">
                  <input
                    className="af-input"
                    type="text"
                    placeholder="e.g. 07:00 – 09:00 AM"
                    value={fields.dock_window}
                    onChange={e => set("dock_window", e.target.value)}
                  />
                </Field>

                <Field label="Priority Level">
                  <select
                    className="af-select"
                    value={fields.priority_level}
                    onChange={e => set("priority_level", e.target.value)}
                  >
                    {PRIORITY_OPTIONS.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </Field>
              </div>
            </div>

            {/* ── Section: Payout ── */}
            <div className="af-section">
              <p className="af-section-title">Freight Payout</p>
              <div className="af-grid-2">
                <Field label="Freight Amount (£)" hint="Driver payout for this trip">
                  <div className="af-input-prefix-wrap">
                    <span className="af-prefix">£</span>
                    <input
                      className="af-input af-input-prefixed"
                      type="number"
                      min="0"
                      step="100"
                      placeholder="e.g. 18000"
                      value={fields.freight_amount}
                      onChange={e => set("freight_amount", e.target.value)}
                    />
                  </div>
                </Field>
              </div>
            </div>

            <div className="af-section">
              <p className="af-section-title">Trip Sheet And Dispatcher Notes</p>
              <Field label="Dispatcher Notes" hint="Printed on the trip sheet and used for reassignment or reschedule context">
                <textarea className="af-input" style={{ minHeight: 86, resize: "vertical" }} value={fields.dispatcher_notes} onChange={e => set("dispatcher_notes", e.target.value)} />
              </Field>
            </div>

            {submitError && (
              <div className="state-card error">
                <span className="state-dot error" />
                <div><strong>Submit Error</strong><p>{submitError}</p></div>
              </div>
            )}

            <div className="af-actions">
              <button
                type="button"
                className="header-action-button"
                onClick={() => navigate("/admin/trips")}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="af-submit-btn"
                disabled={submitting}
              >
                {submitting ? (isEdit ? "Saving..." : "Assigning...") : isEdit ? "Save Trip →" : "Assign Trip →"}
              </button>
            </div>
          </form>
        )}
      </div>
    </AdminWorkspaceLayout>
  );
}
