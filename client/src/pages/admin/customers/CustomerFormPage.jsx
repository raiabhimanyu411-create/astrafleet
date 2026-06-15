import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { createCustomer, getCustomerById, updateCustomer } from "../../../api/customerApi";
import { AdminWorkspaceLayout } from "../AdminWorkspaceLayout";

const PAYMENT_TERMS = [
  { value: 7,  label: "Net 7 days" },
  { value: 14, label: "Net 14 days" },
  { value: 30, label: "Net 30 days" },
  { value: 45, label: "Net 45 days" },
  { value: 60, label: "Net 60 days" },
  { value: 90, label: "Net 90 days" }
];

function Field({ label, hint, children }) {
  return (
    <div className="af-field">
      <label className="af-label">{label}</label>
      {children}
      {hint && <p className="af-hint">{hint}</p>}
    </div>
  );
}

const empty = {
  company_name: "", contact_name: "", email: "", phone: "",
  address: "", billing_address: "", saved_pickup_addresses: "", saved_drop_addresses: "",
  postcode: "", vat_number: "", tax_details: "", credit_limit_gbp: "",
  payment_terms_days: 30, account_status: "active", rate_contract: ""
};

export function CustomerFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isEdit = Boolean(id);

  const [fields, setFields]     = useState(empty);
  const [loading, setLoading]   = useState(isEdit);
  const [loadErr, setLoadErr]   = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr]   = useState("");

  useEffect(() => {
    if (!isEdit) return;
    getCustomerById(id)
      .then(r => {
        const c = r.data;
        setFields({
          company_name:       c.companyName || "",
          contact_name:       c.contactName !== "—" ? c.contactName || "" : "",
          email:              c.email !== "—" ? c.email || "" : "",
          phone:              c.phone !== "—" ? c.phone || "" : "",
          address:            c.address || "",
          billing_address:    c.billingAddress || "",
          saved_pickup_addresses: c.savedPickupAddresses || "",
          saved_drop_addresses: c.savedDropAddresses || "",
          postcode:           c.postcode !== "—" ? c.postcode || "" : "",
          vat_number:         c.vatNumber || "",
          tax_details:        c.taxDetails || "",
          credit_limit_gbp:   c.creditLimitGbp || "",
          payment_terms_days: c.paymentTermsDays || 30,
          account_status:     c.status || "active",
          rate_contract:      c.rateContract || ""
        });
      })
      .catch(() => setLoadErr("Could not load customer. Please go back and try again."))
      .finally(() => setLoading(false));
  }, [id, isEdit]);

  function set(key, val) {
    setFields(prev => ({ ...prev, [key]: val }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitErr("");

    if (!fields.company_name.trim()) {
      setSubmitErr("Company name is required.");
      return;
    }

    setSubmitting(true);
    try {
      if (isEdit) {
        await updateCustomer(id, fields);
        navigate(`/admin/customers/${id}`);
      } else {
        const res = await createCustomer(fields);
        navigate(`/admin/customers/${res.data.customer.id}`);
      }
    } catch (err) {
      setSubmitErr(err?.response?.data?.message || "Could not save. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const pageTitle = isEdit ? "Edit customer" : "Add new customer";

  return (
    <AdminWorkspaceLayout
      badge="Customer accounts"
      title={pageTitle}
      description={isEdit ? "Update company details, contact info, and payment terms." : "Add a new client company to the system."}
      highlights={[]}
    >
      <div className="af-page">
        <div className="af-back-row">
          <button
            className="af-back-btn"
            type="button"
            onClick={() => navigate(isEdit ? `/admin/customers/${id}` : "/admin/customers")}
          >
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
            <div><strong>Loading...</strong><p>Fetching customer data</p></div>
          </div>
        ) : (
          <form className="af-form" onSubmit={handleSubmit}>

            {/* Company details */}
            <div className="af-section">
              <p className="af-section-title">Company details</p>
              <div className="af-grid-2">
                <Field label="Company name *">
                  <input
                    className="af-input"
                    type="text"
                    placeholder="e.g. Northline Retail Ltd"
                    value={fields.company_name}
                    onChange={e => set("company_name", e.target.value)}
                    required
                  />
                </Field>
                <Field label="VAT number" hint="UK format: GB 123 4567 89">
                  <input
                    className="af-input"
                    type="text"
                    placeholder="e.g. GB 123 4567 89"
                    value={fields.vat_number}
                    onChange={e => set("vat_number", e.target.value)}
                  />
                </Field>
                <Field label="GST / VAT / company tax details">
                  <input
                    className="af-input"
                    type="text"
                    placeholder="e.g. GSTIN, VAT registration, company tax ID"
                    value={fields.tax_details}
                    onChange={e => set("tax_details", e.target.value)}
                  />
                </Field>
              </div>
            </div>

            {/* Contact details */}
            <div className="af-section">
              <p className="af-section-title">Contact details</p>
              <div className="af-grid-2">
                <Field label="Contact name">
                  <input
                    className="af-input"
                    type="text"
                    placeholder="e.g. James Williams"
                    value={fields.contact_name}
                    onChange={e => set("contact_name", e.target.value)}
                  />
                </Field>
                <Field label="Phone number">
                  <input
                    className="af-input"
                    type="tel"
                    placeholder="e.g. 07700 900000"
                    value={fields.phone}
                    onChange={e => set("phone", e.target.value)}
                  />
                </Field>
                <Field label="Email address">
                  <input
                    className="af-input"
                    type="email"
                    placeholder="e.g. accounts@company.co.uk"
                    value={fields.email}
                    onChange={e => set("email", e.target.value)}
                  />
                </Field>
              </div>
            </div>

            {/* Address */}
            <div className="af-section">
              <p className="af-section-title">Address</p>
              <div className="af-grid-2">
                <Field label="Full address">
                  <textarea
                    className="af-input"
                    style={{ minHeight: 80, resize: "vertical" }}
                    placeholder="e.g. 12 Warehouse Lane, Manchester"
                    value={fields.address}
                    onChange={e => set("address", e.target.value)}
                  />
                </Field>
                <Field label="Billing address">
                  <textarea
                    className="af-input"
                    style={{ minHeight: 80, resize: "vertical" }}
                    placeholder="Billing address if different"
                    value={fields.billing_address}
                    onChange={e => set("billing_address", e.target.value)}
                  />
                </Field>
                <Field label="Postcode">
                  <input
                    className="af-input"
                    type="text"
                    placeholder="e.g. M1 2AB"
                    value={fields.postcode}
                    onChange={e => set("postcode", e.target.value)}
                  />
                </Field>
                <Field label="Saved pickup addresses" hint="One address per line">
                  <textarea className="af-input" style={{ minHeight: 90, resize: "vertical" }} value={fields.saved_pickup_addresses} onChange={e => set("saved_pickup_addresses", e.target.value)} />
                </Field>
                <Field label="Saved drop addresses" hint="One address per line">
                  <textarea className="af-input" style={{ minHeight: 90, resize: "vertical" }} value={fields.saved_drop_addresses} onChange={e => set("saved_drop_addresses", e.target.value)} />
                </Field>
              </div>
            </div>

            {/* Billing settings */}
            <div className="af-section">
              <p className="af-section-title">Billing settings</p>
              <div className="af-grid-2">
                <Field label="Payment terms" hint="Number of days allowed for invoice payment">
                  <select
                    className="af-select"
                    value={fields.payment_terms_days}
                    onChange={e => set("payment_terms_days", Number(e.target.value))}
                  >
                    {PAYMENT_TERMS.map(t => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Credit limit (£)">
                  <input className="af-input" type="number" min="0" step="0.01" placeholder="e.g. 25000" value={fields.credit_limit_gbp} onChange={e => set("credit_limit_gbp", e.target.value)} />
                </Field>
                <div style={{ gridColumn: "1 / -1" }}>
                  <Field label="Rate contract per customer">
                    <textarea className="af-input" style={{ minHeight: 90, resize: "vertical" }} placeholder="Lane rates, per-tonne rates, minimum charges, fuel surcharge rules..." value={fields.rate_contract} onChange={e => set("rate_contract", e.target.value)} />
                  </Field>
                </div>
                {isEdit && (
                  <Field label="Account status">
                    <select
                      className="af-select"
                      value={fields.account_status}
                      onChange={e => set("account_status", e.target.value)}
                    >
                      <option value="active">Active</option>
                      <option value="suspended">Suspended</option>
                      <option value="closed">Closed</option>
                    </select>
                  </Field>
                )}
              </div>
            </div>

            {submitErr && (
              <div className="state-card error">
                <span className="state-dot error" />
                <div><strong>Error</strong><p>{submitErr}</p></div>
              </div>
            )}

            <div className="af-actions">
              <button
                type="button"
                className="header-action-button"
                onClick={() => navigate(isEdit ? `/admin/customers/${id}` : "/admin/customers")}
              >
                Cancel
              </button>
              <button type="submit" className="af-submit-btn" disabled={submitting}>
                {submitting ? "Saving..." : isEdit ? "Save changes →" : "Create customer →"}
              </button>
            </div>
          </form>
        )}
      </div>
    </AdminWorkspaceLayout>
  );
}
