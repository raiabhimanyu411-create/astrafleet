import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { createDriver, getDriverById, updateDriver } from "../../../api/driverApi";
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

const empty = {
  full_name: "", employee_code: "", phone: "", home_depot: "",
  address: "", postcode: "", date_of_birth: "", national_insurance: "",
  license_number: "", license_expiry: "", medical_expiry: "",
  cpc_number: "", cpc_expiry: "",
  tacho_card_number: "", tacho_card_expiry: "",
  emergency_contact_name: "", emergency_contact_phone: "",
  bank_sort_code: "", bank_account_number: "",
  onboarding_status: "new", shift_status: "review", compliance_status: "review",
  email: "", password: ""
};

export function DriverFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isEdit = Boolean(id);

  const [fields, setFields]       = useState(empty);
  const [loading, setLoading]     = useState(isEdit);
  const [loadErr, setLoadErr]     = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr]   = useState("");

  useEffect(() => {
    if (!isEdit) return;
    getDriverById(id)
      .then(r => {
        const d = r.data;
        setFields({
          full_name:               d.fullName || "",
          employee_code:           d.employeeCode || "",
          phone:                   d.phone || "",
          home_depot:              d.homeDepot !== "—" ? d.homeDepot || "" : "",
          address:                 d.address || "",
          postcode:                d.postcode || "",
          date_of_birth:           "",
          national_insurance:      d.nationalInsurance || "",
          license_number:          d.licence?.number || "",
          license_expiry:          "",
          medical_expiry:          "",
          cpc_number:              d.cpc?.number || "",
          cpc_expiry:              "",
          tacho_card_number:       d.tacho?.cardNumber || "",
          tacho_card_expiry:       "",
          emergency_contact_name:  d.emergency?.name || "",
          emergency_contact_phone: d.emergency?.phone || "",
          bank_sort_code:          d.bank?.sortCode || "",
          bank_account_number:     d.bank?.accountNumber || "",
          onboarding_status:       d.onboardingStatus || "new",
          shift_status:            d.shiftStatus || "review",
          compliance_status:       d.complianceStatus || "review",
          email: d.email || "", password: ""
        });
      })
      .catch(() => setLoadErr("Could not load driver. Please go back and try again."))
      .finally(() => setLoading(false));
  }, [id, isEdit]);

  function set(key, val) { setFields(prev => ({ ...prev, [key]: val })); }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitErr("");

    const payload = { ...fields };
    if (!payload.email || !payload.password) {
      delete payload.email;
      delete payload.password;
    }

    setSubmitting(true);
    try {
      if (isEdit) {
        await updateDriver(id, payload);
        navigate(`/admin/drivers/${id}`);
      } else {
        const res = await createDriver(payload);
        navigate(`/admin/drivers/${res.data.id}`);
      }
    } catch (err) {
      setSubmitErr(err?.response?.data?.message || "Could not save. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AdminWorkspaceLayout
      badge="Driver management"
      title={isEdit ? "Edit driver" : "Add new driver"}
      description={isEdit ? "Update driver profile, licence details, and status." : "Register a new driver with full UK compliance details."}
      highlights={[]}
    >
      <div className="af-page" style={{ maxWidth: 920 }}>
        <div className="af-back-row">
          <button className="af-back-btn" type="button" onClick={() => navigate(isEdit ? `/admin/drivers/${id}` : "/admin/drivers")}>
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
            <div><strong>Loading...</strong><p>Fetching driver data</p></div>
          </div>
        ) : (
          <form className="af-form" onSubmit={handleSubmit}>

            {/* Personal info */}
            <div className="af-section">
              <p className="af-section-title">Personal details</p>
              <div className="af-grid-3">
                <Field label="Full name" required>
                  <input className="af-input" type="text" placeholder="e.g. James Williams" value={fields.full_name} onChange={e => set("full_name", e.target.value)} required />
                </Field>
                <Field label="Employee code" required hint="Unique code e.g. DRV-001">
                  <input className="af-input" type="text" placeholder="e.g. DRV-001" value={fields.employee_code} onChange={e => set("employee_code", e.target.value)} required />
                </Field>
                <Field label="Phone number">
                  <input className="af-input" type="tel" placeholder="e.g. 07700 900000" value={fields.phone} onChange={e => set("phone", e.target.value)} />
                </Field>
                <Field label="Date of birth">
                  <input className="af-input" type="date" value={fields.date_of_birth} onChange={e => set("date_of_birth", e.target.value)} />
                </Field>
                <Field label="National Insurance number" hint="UK NI format: AB 12 34 56 C">
                  <input className="af-input" type="text" placeholder="e.g. AB 12 34 56 C" value={fields.national_insurance} onChange={e => set("national_insurance", e.target.value)} />
                </Field>
                <Field label="Home depot / base">
                  <input className="af-input" type="text" placeholder="e.g. Manchester Depot" value={fields.home_depot} onChange={e => set("home_depot", e.target.value)} />
                </Field>
              </div>
              <div className="af-grid-2" style={{ marginTop: 16 }}>
                <Field label="Address">
                  <textarea className="af-input" style={{ minHeight: 72, resize: "vertical" }} placeholder="Full home address" value={fields.address} onChange={e => set("address", e.target.value)} />
                </Field>
                <Field label="Postcode">
                  <input className="af-input" type="text" placeholder="e.g. M1 2AB" value={fields.postcode} onChange={e => set("postcode", e.target.value)} />
                </Field>
              </div>
            </div>

            {/* UK Licence */}
            <div className="af-section">
              <p className="af-section-title">UK driving licence</p>
              <div className="af-grid-3">
                <Field label="Licence number" required>
                  <input className="af-input" type="text" placeholder="e.g. SMITH701045JA9AB" value={fields.license_number} onChange={e => set("license_number", e.target.value)} required />
                </Field>
                <Field label="Licence expiry date" required hint="Alert sent 90 days before expiry">
                  <input className="af-input" type="date" value={fields.license_expiry} onChange={e => set("license_expiry", e.target.value)} required={!isEdit} />
                </Field>
                <Field label="Medical certificate expiry" required hint="Driver CPC medical — alert at 90 days">
                  <input className="af-input" type="date" value={fields.medical_expiry} onChange={e => set("medical_expiry", e.target.value)} required={!isEdit} />
                </Field>
              </div>
            </div>

            {/* CPC & Tacho */}
            <div className="af-section">
              <p className="af-section-title">CPC & tachograph card</p>
              <div className="af-grid-3">
                <Field label="CPC qualification number" hint="Driver Certificate of Professional Competence">
                  <input className="af-input" type="text" placeholder="e.g. CPC12345678" value={fields.cpc_number} onChange={e => set("cpc_number", e.target.value)} />
                </Field>
                <Field label="CPC expiry date" hint="Alert sent 90 days before expiry">
                  <input className="af-input" type="date" value={fields.cpc_expiry} onChange={e => set("cpc_expiry", e.target.value)} />
                </Field>
                <div />
                <Field label="Tachograph card number">
                  <input className="af-input" type="text" placeholder="e.g. UK0123456789" value={fields.tacho_card_number} onChange={e => set("tacho_card_number", e.target.value)} />
                </Field>
                <Field label="Tachograph card expiry">
                  <input className="af-input" type="date" value={fields.tacho_card_expiry} onChange={e => set("tacho_card_expiry", e.target.value)} />
                </Field>
              </div>
            </div>

            {/* Emergency contact */}
            <div className="af-section">
              <p className="af-section-title">Emergency contact</p>
              <div className="af-grid-2">
                <Field label="Emergency contact name">
                  <input className="af-input" type="text" placeholder="e.g. Sarah Williams" value={fields.emergency_contact_name} onChange={e => set("emergency_contact_name", e.target.value)} />
                </Field>
                <Field label="Emergency contact phone">
                  <input className="af-input" type="tel" placeholder="e.g. 07700 900111" value={fields.emergency_contact_phone} onChange={e => set("emergency_contact_phone", e.target.value)} />
                </Field>
              </div>
            </div>

            {/* Bank details */}
            <div className="af-section">
              <p className="af-section-title">Bank details (for payroll)</p>
              <div className="af-grid-2">
                <Field label="Sort code" hint="Format: 00-00-00">
                  <input className="af-input" type="text" placeholder="e.g. 20-00-00" value={fields.bank_sort_code} onChange={e => set("bank_sort_code", e.target.value)} />
                </Field>
                <Field label="Account number">
                  <input className="af-input" type="text" placeholder="e.g. 12345678" value={fields.bank_account_number} onChange={e => set("bank_account_number", e.target.value)} />
                </Field>
              </div>
            </div>

            {/* Status */}
            <div className="af-section">
              <p className="af-section-title">Status & compliance</p>
              <div className="af-grid-3">
                <Field label="Onboarding status">
                  <select className="af-select" value={fields.onboarding_status} onChange={e => set("onboarding_status", e.target.value)}>
                    <option value="new">New</option>
                    <option value="docs_pending">Docs pending</option>
                    <option value="ready">Ready</option>
                    <option value="active">Active</option>
                  </select>
                </Field>
                <Field label="Shift status">
                  <select className="af-select" value={fields.shift_status} onChange={e => set("shift_status", e.target.value)}>
                    <option value="ready">Ready</option>
                    <option value="on_trip">On trip</option>
                    <option value="rest">Rest</option>
                    <option value="review">Review</option>
                  </select>
                </Field>
                <Field label="Compliance status">
                  <select className="af-select" value={fields.compliance_status} onChange={e => set("compliance_status", e.target.value)}>
                    <option value="clear">Clear</option>
                    <option value="review">Review</option>
                    <option value="blocked">Blocked</option>
                  </select>
                </Field>
              </div>
            </div>

            {/* Login account (create only) */}
            {!isEdit && (
              <div className="af-section">
                <p className="af-section-title">Driver login account (optional)</p>
                <p style={{ fontSize: "0.82rem", color: "#64748b", margin: "0 0 14px" }}>
                  Create a login so the driver can access the driver web panel. Leave blank to add later.
                </p>
                <div className="af-grid-2">
                  <Field label="Email address" hint="Used to log in to the driver panel">
                    <input className="af-input" type="email" placeholder="driver@company.co.uk" value={fields.email} onChange={e => set("email", e.target.value)} />
                  </Field>
                  <Field label="Password" hint="Minimum 8 characters">
                    <input className="af-input" type="password" placeholder="Set initial password" value={fields.password} onChange={e => set("password", e.target.value)} />
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
              <button type="button" className="header-action-button" onClick={() => navigate(isEdit ? `/admin/drivers/${id}` : "/admin/drivers")}>
                Cancel
              </button>
              <button type="submit" className="af-submit-btn" disabled={submitting}>
                {submitting ? "Saving..." : isEdit ? "Save changes →" : "Register driver →"}
              </button>
            </div>
          </form>
        )}
      </div>
    </AdminWorkspaceLayout>
  );
}
