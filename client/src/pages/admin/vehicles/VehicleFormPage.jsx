import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { createVehicle, getVehicleById, updateVehicle } from "../../../api/vehicleApi";
import { AdminWorkspaceLayout } from "../AdminWorkspaceLayout";

function Field({ label, hint, required, children }) {
  return (
    <div className="af-field">
      <label className="af-label">
        {label}{required && <span style={{ color: "#dc2626" }}> *</span>}
      </label>
      {children}
      {hint && <p className="af-hint">{hint}</p>}
    </div>
  );
}

const TRUCK_TYPES = [
  "Rigid HGV", "Articulated HGV", "Curtainsider", "Flatbed",
  "Refrigerated", "Box Van", "Tipper", "Skip Lorry", "Tanker", "Other"
];

const empty = {
  registration_number: "", fleet_code: "", make: "", model: "",
  truck_type: "Rigid HGV", status: "available",
  fuel_type: "Diesel", capacity_tonnes: "", year_of_manufacture: "", colour: "",
  mot_expiry: "", insurance_expiry: "", road_tax_expiry: "", permit_expiry: "",
  pollution_expiry: "", fitness_expiry: "", odometer_reading: "", next_service_due: "",
  current_location: ""
};

function splitVehicleModelName(modelName = "") {
  const [make = "", ...modelParts] = String(modelName || "").trim().split(/\s+/);
  return { make, model: modelParts.join(" ") };
}

export function VehicleFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isEdit = Boolean(id);

  const [fields, setFields]         = useState(empty);
  const [loading, setLoading]       = useState(isEdit);
  const [loadErr, setLoadErr]       = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr]   = useState("");
  const [showMore, setShowMore]     = useState(isEdit);

  useEffect(() => {
    if (!isEdit) return;
    getVehicleById(id)
      .then(r => {
        const v = r.data;
        const fallback = splitVehicleModelName(v.modelName);
        setFields({
          registration_number: v.registrationNumber || "",
          fleet_code:          v.fleetCode || "",
          make:                v.make || fallback.make,
          model:               v.model || fallback.model,
          truck_type:          v.truckType || "Rigid HGV",
          status:              v.status || "available",
          fuel_type:           v.fuelType || "Diesel",
          capacity_tonnes:     v.capacityTonnes || "",
          year_of_manufacture: v.yearOfManufacture || "",
          colour:              v.colour || "",
          mot_expiry:          v.mot?.raw || "",
          insurance_expiry:    v.insurance?.raw || "",
          road_tax_expiry:     v.roadTax?.raw || "",
          permit_expiry:       v.permit?.raw || "",
          pollution_expiry:    v.pollution?.raw || "",
          fitness_expiry:      v.fitness?.raw || "",
          odometer_reading:    v.odometerReading || "",
          next_service_due:    v.nextServiceDueRaw || "",
          current_location:    v.currentLocation !== "—" ? v.currentLocation || "" : ""
        });
      })
      .catch(() => setLoadErr("Could not load vehicle. Please go back and try again."))
      .finally(() => setLoading(false));
  }, [id, isEdit]);

  function set(key, val) { setFields(prev => ({ ...prev, [key]: val })); }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitErr("");
    setSubmitting(true);
    const payload = {
      ...fields,
      model_name: [fields.make, fields.model].filter(Boolean).join(" ").trim()
    };
    try {
      if (isEdit) {
        await updateVehicle(id, payload);
        navigate(`/admin/vehicles/${id}`);
      } else {
        const res = await createVehicle(payload);
        navigate(`/admin/vehicles/${res.data.id}`);
      }
    } catch (err) {
      setSubmitErr(err?.response?.data?.message || "Could not save. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AdminWorkspaceLayout
      badge="Fleet management"
      title={isEdit ? "Edit vehicle" : "Add new vehicle"}
      description={isEdit ? "Update vehicle details." : "Add a vehicle quickly. Compliance details can be completed later."}
      highlights={[]}
    >
      <div className="af-page" style={{ maxWidth: 920 }}>
        <div className="af-back-row">
          <button className="af-back-btn" type="button" onClick={() => navigate(isEdit ? `/admin/vehicles/${id}` : "/admin/vehicles")}>
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
            <div><strong>Loading...</strong><p>Fetching vehicle data</p></div>
          </div>
        ) : (
          <form className="af-form" onSubmit={handleSubmit}>

            <div className="af-section">
              <p className="af-section-title">Vehicle details</p>
              <div className="af-grid-3">
                <Field label="Registration number" required hint="e.g. AB12 CDE">
                  <input className="af-input" type="text" placeholder="e.g. AB12 CDE" value={fields.registration_number} onChange={e => set("registration_number", e.target.value.toUpperCase())} required />
                </Field>
                <Field label="Vehicle type" required>
                  <select className="af-select" value={fields.truck_type} onChange={e => set("truck_type", e.target.value)} required>
                    {TRUCK_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </Field>
                <Field label="Capacity (tonnes)">
                  <input className="af-input" type="number" min="0" step="0.01" value={fields.capacity_tonnes} onChange={e => set("capacity_tonnes", e.target.value)} />
                </Field>
                <Field label="Current status">
                  <select className="af-select" value={fields.status} onChange={e => set("status", e.target.value)}>
                    <option value="available">Available</option>
                    <option value="planned">On trip / planned</option>
                    <option value="in_transit">In transit</option>
                    <option value="maintenance">Maintenance</option>
                    <option value="stopped">Inactive / stopped</option>
                  </select>
                </Field>
              </div>
              <button className="header-action-button" style={{ marginTop: 16 }} type="button" onClick={() => setShowMore(current => !current)}>
                {showMore ? "Hide extra details" : "More vehicle details"}
              </button>
            </div>

            {showMore && (
            <div className="af-section">
              <p className="af-section-title">Extra details</p>
              <div className="af-grid-3">
                <Field label="Fleet code" hint="Leave blank to auto-generate">
                  <input className="af-input" type="text" placeholder="e.g. FLT-001" value={fields.fleet_code} onChange={e => set("fleet_code", e.target.value)} />
                </Field>
                <Field label="Vehicle make">
                  <input className="af-input" type="text" placeholder="e.g. Volvo" value={fields.make} onChange={e => set("make", e.target.value)} />
                </Field>
                <Field label="Vehicle model">
                  <input className="af-input" type="text" placeholder="e.g. FH16" value={fields.model} onChange={e => set("model", e.target.value)} />
                </Field>
                <Field label="Colour">
                  <input className="af-input" type="text" placeholder="e.g. White" value={fields.colour} onChange={e => set("colour", e.target.value)} />
                </Field>
                <Field label="Year of manufacture">
                  <input className="af-input" type="number" placeholder="e.g. 2019" min="1990" max={new Date().getFullYear()} value={fields.year_of_manufacture} onChange={e => set("year_of_manufacture", e.target.value)} />
                </Field>
                <Field label="Fuel type">
                  <select className="af-select" value={fields.fuel_type} onChange={e => set("fuel_type", e.target.value)}>
                    <option value="Diesel">Diesel</option>
                    <option value="Petrol">Petrol</option>
                    <option value="CNG">CNG</option>
                    <option value="Electric">Electric</option>
                    <option value="Hybrid">Hybrid</option>
                  </select>
                </Field>
              </div>
            </div>
            )}

            {showMore && (
            <div className="af-section">
              <p className="af-section-title">Compliance and service dates</p>
              <div className="af-grid-3">
                <Field label="Insurance expiry">
                  <input className="af-input" type="date" value={fields.insurance_expiry} onChange={e => set("insurance_expiry", e.target.value)} />
                </Field>
                <Field label="Fitness / MOT expiry">
                  <input className="af-input" type="date" value={fields.fitness_expiry || fields.mot_expiry} onChange={e => { set("fitness_expiry", e.target.value); set("mot_expiry", e.target.value); }} />
                </Field>
                <Field label="Permit expiry">
                  <input className="af-input" type="date" value={fields.permit_expiry} onChange={e => set("permit_expiry", e.target.value)} />
                </Field>
                <Field label="Pollution certificate expiry">
                  <input className="af-input" type="date" value={fields.pollution_expiry} onChange={e => set("pollution_expiry", e.target.value)} />
                </Field>
                <Field label="Road tax expiry">
                  <input className="af-input" type="date" value={fields.road_tax_expiry} onChange={e => set("road_tax_expiry", e.target.value)} />
                </Field>
                <Field label="Service due date">
                  <input className="af-input" type="date" value={fields.next_service_due} onChange={e => set("next_service_due", e.target.value)} />
                </Field>
                <Field label="Odometer reading (km)">
                  <input className="af-input" type="number" min="0" step="0.1" value={fields.odometer_reading} onChange={e => set("odometer_reading", e.target.value)} />
                </Field>
                <Field label="Current location">
                  <input className="af-input" type="text" value={fields.current_location} onChange={e => set("current_location", e.target.value)} />
                </Field>
              </div>
            </div>
            )}

            {submitErr && (
              <div className="state-card error">
                <span className="state-dot error" />
                <div><strong>Error</strong><p>{submitErr}</p></div>
              </div>
            )}

            <div className="af-actions">
              <button type="button" className="header-action-button" onClick={() => navigate(isEdit ? `/admin/vehicles/${id}` : "/admin/vehicles")}>
                Cancel
              </button>
              <button type="submit" className="af-submit-btn" disabled={submitting}>
                {submitting ? "Saving..." : isEdit ? "Save changes →" : "Add vehicle →"}
              </button>
            </div>
          </form>
        )}
      </div>
    </AdminWorkspaceLayout>
  );
}
