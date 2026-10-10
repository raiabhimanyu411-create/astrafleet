import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { createDriver, getDriverById, updateDriver } from "../../../api/driverApi";
import { AdminWorkspaceLayout } from "../AdminWorkspaceLayout";

function Field({ label, hint, required, children }) {
  return (
    <div className="af-field">
      <label className="af-label">
        {label}{required && <span style={{ color: "#D91515" }}> *</span>}
      </label>
      {children}
      {hint && <p className="af-hint">{hint}</p>}
    </div>
  );
}

const empty = {
  full_name: "",
  phone: "",
  email: "", password: ""
};

export function DriverFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isEdit = Boolean(id);

  const [fields, setFields]       = useState(empty);
  const [hasLogin, setHasLogin]   = useState(false);
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
          full_name: d.fullName || "",
          phone: d.phone || "",
          email: d.email || "", password: ""
        });
        setHasLogin(Boolean(d.email));
      })
      .catch(() => setLoadErr("Could not load driver. Please go back and try again."))
      .finally(() => setLoading(false));
  }, [id, isEdit]);

  function set(key, val) { setFields(prev => ({ ...prev, [key]: val })); }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitErr("");

    const email = fields.email.trim();
    const password = fields.password;
    const payload = { full_name: fields.full_name.trim(), phone: fields.phone.trim() };

    // Login fields go together; a lone email used to be dropped without telling anyone.
    if (hasLogin) {
      if (password) payload.password = password;
    } else if (email || password) {
      if (!email || !password) {
        setSubmitErr("Enter both an email and a password to create the driver login, or leave both empty.");
        return;
      }
      payload.email = email;
      payload.password = password;
    }
    if (payload.password && payload.password.length < 8) {
      setSubmitErr("Password must be at least 8 characters.");
      return;
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
      setSubmitErr(err?.response?.data?.error || err?.response?.data?.message || "Could not save. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AdminWorkspaceLayout
      badge="Driver management"
      title={isEdit ? "Edit Driver" : "Add New Driver"}
      description={isEdit ? "Update the driver's basic profile." : "Register a driver with the basic details needed to start."}
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
              <p className="af-section-title">Personal Details</p>
              <div className="af-grid-3">
                <Field label="Name" required>
                  <input className="af-input" type="text" placeholder="e.g. James Williams" value={fields.full_name} onChange={e => set("full_name", e.target.value)} required />
                </Field>
                <Field label="Contact Number">
                  <input className="af-input" type="tel" placeholder="e.g. 07700 900000" value={fields.phone} onChange={e => set("phone", e.target.value)} />
                </Field>
              </div>
            </div>

            {/* Driver app login: create one, or reset the password of an existing one */}
            <div className="af-section">
              <p className="af-section-title">Driver App Login</p>
              <p style={{ fontSize: "0.82rem", color: "#5F6B7A", margin: "0 0 14px" }}>
                {hasLogin
                  ? "This driver already has a login. Enter a new password only if you want to reset it; they will be signed out of every device."
                  : "Optional. Add an email and an initial password so the driver can use the driver app. Leave both empty to skip."}
              </p>
              <div className="af-grid-3">
                <Field label="Login email" hint={hasLogin ? "Login email cannot be changed here." : undefined}>
                  <input className="af-input" type="email" placeholder="driver@company.co.uk" value={fields.email} onChange={e => set("email", e.target.value)} disabled={hasLogin} autoComplete="off" />
                </Field>
                <Field label={hasLogin ? "New password" : "Password"} hint="Minimum 8 characters">
                  <input className="af-input" type="password" placeholder={hasLogin ? "Leave blank to keep current" : "Set initial password"} value={fields.password} onChange={e => set("password", e.target.value)} autoComplete="new-password" />
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
              <button type="button" className="header-action-button" onClick={() => navigate(isEdit ? `/admin/drivers/${id}` : "/admin/drivers")}>
                Cancel
              </button>
              <button type="submit" className="af-submit-btn" disabled={submitting}>
                {submitting ? "Saving..." : isEdit ? "Save Changes →" : "Register Driver →"}
              </button>
            </div>
          </form>
        )}
      </div>
    </AdminWorkspaceLayout>
  );
}
