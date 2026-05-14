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

const FUEL_TYPES = ["Diesel", "Petrol", "Electric", "Hybrid", "LPG", "Other"];

const empty = {
  registration_number: "", fleet_code: "", model_name: "",
  truck_type: "Rigid HGV", status: "available",
  fuel_type: "Diesel", capacity_tonnes: "", year_of_manufacture: "", colour: "",
  mot_expiry: "", insurance_expiry: "", road_tax_expiry: "", next_service_due: "",
  current_location: ""
};

export function VehicleFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isEdit = Boolean(id);

  const [fields, setFields]         = useState(empty);
  const [loading, setLoading]       = useState(isEdit);
  const [loadErr, setLoadErr]       = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr]   = useState("");

  useEffect(() => {
    if (!isEdit) return;
    getVehicleById(id)
      .then(r => {
        const v = r.data;
        setFields({
          registration_number: v.registrationNumber || "",
          fleet_code:          v.fleetCode || "",
          model_name:          v.modelName || "",
          truck_type:          v.truckType || "Rigid HGV",
          status:              v.status || "available",
          fuel_type:           v.fuelType || "Diesel",
          capacity_tonnes:     v.capacityTonnes || "",
          year_of_manufacture: v.yearOfManufacture || "",
          colour:              v.colour || "",
          mot_expiry:          v.mot?.raw || "",
          insurance_expiry:    v.insurance?.raw || "",
          road_tax_expiry:     v.roadTax?.raw || "",
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
    try {
      if (isEdit) {
        await updateVehicle(id, fields);
        navigate(`/admin/vehicles/${id}`);
      } else {
        const res = await createVehicle(fields);
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
      description={isEdit ? "Update vehicle profile, compliance dates, and operational status." : "Register a new vehicle with full UK compliance and fleet details."}
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

            {/* Vehicle identity */}
            <div className="af-section">
              <p className="af-section-title">Vehicle identity</p>
              <div className="af-grid-3">
                <Field label="Registration number" required hint="e.g. AB12 CDE">
                  <input className="af-input" type="text" placeholder="e.g. AB12 CDE" value={fields.registration_number} onChange={e => set("registration_number", e.target.value.toUpperCase())} required />
                </Field>
                <Field label="Fleet code" required hint="Internal code e.g. FLT-001">
                  <input className="af-input" type="text" placeholder="e.g. FLT-001" value={fields.fleet_code} onChange={e => set("fleet_code", e.target.value)} required />
                </Field>
                <Field label="Vehicle model" required hint="Make and model e.g. Volvo FH16">
                  <input className="af-input" type="text" placeholder="e.g. Volvo FH16" value={fields.model_name} onChange={e => set("model_name", e.target.value)} required />
                </Field>
                <Field label="Vehicle type" required>
                  <select className="af-select" value={fields.truck_type} onChange={e => set("truck_type", e.target.value)} required>
                    {TRUCK_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </Field>
                <Field label="Colour">
                  <input className="af-input" type="text" placeholder="e.g. White" value={fields.colour} onChange={e => set("colour", e.target.value)} />
                </Field>
                <Field label="Year of manufacture">
                  <input className="af-input" type="number" placeholder="e.g. 2019" min="1990" max={new Date().getFullYear()} value={fields.year_of_manufacture} onChange={e => set("year_of_manufacture", e.target.value)} />
                </Field>
              </div>
            </div>

            {/* Specifications */}
            <div className="af-section">
              <p className="af-section-title">Specifications</p>
              <div className="af-grid-3">
                <Field label="Fuel type">
                  <select className="af-select" value={fields.fuel_type} onChange={e => set("fuel_type", e.target.value)}>
                    {FUEL_TYPES.map(f => <option key={f} value={f}>{f}</option>)}
                  </select>
                </Field>
                <Field label="Capacity (tonnes)" hint="Maximum payload in metric tonnes">
                  <input className="af-input" type="number" placeholder="e.g. 26" step="0.5" min="0" value={fields.capacity_tonnes} onChange={e => set("capacity_tonnes", e.target.value)} />
                </Field>
                <Field label="Current location" hint="Depot or last known location">
                  <input className="af-input" type="text" placeholder="e.g. Manchester Depot" value={fields.current_location} onChange={e => set("current_location", e.target.value)} />
                </Field>
              </div>
            </div>

            {/* UK Compliance */}
            <div className="af-section">
              <p className="af-section-title">UK compliance dates</p>
              <p style={{ fontSize: "0.82rem", color: "#64748b", margin: "0 0 14px" }}>
                Alerts will be sent 90 days before expiry. Leave blank if not applicable.
              </p>
              <div className="af-grid-3">
                <Field label="MOT expiry" required={!isEdit} hint="Annual HGV test">
                  <input className="af-input" type="date" value={fields.mot_expiry} onChange={e => set("mot_expiry", e.target.value)} required={!isEdit} />
                </Field>
                <Field label="Insurance expiry" required={!isEdit} hint="Commercial vehicle insurance">
                  <input className="af-input" type="date" value={fields.insurance_expiry} onChange={e => set("insurance_expiry", e.target.value)} required={!isEdit} />
                </Field>
                <Field label="Road tax expiry" required={!isEdit} hint="Vehicle Excise Duty (VED)">
                  <input className="af-input" type="date" value={fields.road_tax_expiry} onChange={e => set("road_tax_expiry", e.target.value)} required={!isEdit} />
                </Field>
                <Field label="Next service due" hint="Scheduled maintenance date">
                  <input className="af-input" type="date" value={fields.next_service_due} onChange={e => set("next_service_due", e.target.value)} />
                </Field>
              </div>
            </div>

            {/* Status */}
            <div className="af-section">
              <p className="af-section-title">Operational status</p>
              <div className="af-grid-3">
                <Field label="Vehicle status">
                  <select className="af-select" value={fields.status} onChange={e => set("status", e.target.value)}>
                    <option value="available">Available</option>
                    <option value="planned">Planned</option>
                    <option value="in_transit">In transit</option>
                    <option value="maintenance">Maintenance</option>
                    <option value="stopped">Stopped</option>
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
              <button type="button" className="header-action-button" onClick={() => navigate(isEdit ? `/admin/vehicles/${id}` : "/admin/vehicles")}>
                Cancel
              </button>
              <button type="submit" className="af-submit-btn" disabled={submitting}>
                {submitting ? "Saving..." : isEdit ? "Save changes →" : "Register vehicle →"}
              </button>
            </div>
          </form>
        )}
      </div>
    </AdminWorkspaceLayout>
  );
}
