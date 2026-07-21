import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { createInvoice, getBillingFormData, getInvoiceById, updateInvoice } from "../../../api/adminApi";
import { AdminWorkspaceLayout } from "../AdminWorkspaceLayout";

const empty = {
  invoice_no: "",
  trip_id: "",
  client_name: "",
  customer_address: "",
  customer_vat_number: "",
  supplier_name: "AstraFleet",
  supplier_address: "",
  supplier_vat_number: "",
  service_description: "Road freight transport service",
  supply_date: new Date().toISOString().slice(0, 10),
  purchase_order_ref: "",
  net_amount_gbp: "",
  vat_rate: "20",
  vat_amount_gbp: "0.00",
  amount_gbp: "",
  issued_at: new Date().toISOString().slice(0, 10),
  due_date: "",
  payment_status: "draft",
  pod_verified: false,
  notes: "",
  payment_terms: "Payment due by the stated due date",
  bank_details: ""
};

function Field({ label, children, hint }) {
  return (
    <div className="af-field">
      <label className="af-label">{label}</label>
      {children}
      {hint && <p className="af-hint">{hint}</p>}
    </div>
  );
}

export function InvoiceFormPage() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();

  const [formData, setFormData] = useState({ trips: [] });
  const [fields, setFields] = useState(empty);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    Promise.all([
      getBillingFormData(),
      isEdit ? getInvoiceById(id) : Promise.resolve(null)
    ])
      .then(([fdRes, invoiceRes]) => {
        setFormData(fdRes.data);
        if (invoiceRes) {
          setFields(invoiceRes.data.form);
        }
      })
      .catch(() => setLoadError("Billing form data could not be loaded."))
      .finally(() => setLoading(false));
  }, [id, isEdit]);

  const selectedTrip = useMemo(
    () => formData.trips.find(trip => String(trip.id) === String(fields.trip_id)),
    [fields.trip_id, formData.trips]
  );

  function set(key, value) {
    setFields(prev => ({ ...prev, [key]: value }));
  }

  function handleTripChange(value) {
    const trip = formData.trips.find(item => String(item.id) === value);
    const issuedDate = new Date(`${fields.issued_at}T12:00:00`);
    issuedDate.setDate(issuedDate.getDate() + Number(trip?.paymentTermsDays || 30));
    setFields(prev => ({
      ...prev,
      trip_id: value,
      client_name: trip?.clientName || prev.client_name,
      customer_address: trip?.billingAddress || prev.customer_address,
      customer_vat_number: trip?.vatNumber || prev.customer_vat_number,
      net_amount_gbp: trip?.freightAmountGbp || prev.net_amount_gbp,
      service_description: trip ? `Road freight transport · ${trip.tripCode} · ${trip.lane}` : prev.service_description,
      due_date: trip ? issuedDate.toISOString().slice(0, 10) : prev.due_date,
      payment_terms: trip ? `Net ${trip.paymentTermsDays || 30} days` : prev.payment_terms,
      pod_verified: trip?.podStatus === "verified" ? true : prev.pod_verified
    }));
  }

  const netAmount = Number(fields.net_amount_gbp || 0);
  const vatRate = Number(fields.vat_rate || 0);
  const vatAmount = Number.isFinite(netAmount * vatRate) ? Number((netAmount * vatRate / 100).toFixed(2)) : 0;
  const grossAmount = Number((netAmount + vatAmount).toFixed(2));

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitError("");
    setSubmitting(true);
    try {
      const payload = {
        ...fields,
        trip_id: fields.trip_id || null,
        net_amount_gbp: netAmount,
        vat_rate: vatRate,
        vat_amount_gbp: vatAmount,
        amount_gbp: grossAmount,
        pod_verified: Boolean(fields.pod_verified)
      };
      if (isEdit) {
        await updateInvoice(id, payload);
        navigate(`/admin/billing/${id}`);
      } else {
        const res = await createInvoice(payload);
        navigate(`/admin/billing/${res.data.id}`);
      }
    } catch (err) {
      setSubmitError(err?.response?.data?.message || "Invoice could not be saved.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AdminWorkspaceLayout
      badge="Invoicing & Billing"
      title={isEdit ? "Edit Invoice" : "Create Invoice"}
      description={isEdit ? "Update invoice amount, due date, POD verification, and payment status." : "Raise a freight invoice and optionally link it to a dispatch trip."}
      highlights={[]}
    >
      <div className="af-page" style={{ maxWidth: 920 }}>
        <div className="af-back-row">
          <button className="af-back-btn" type="button" onClick={() => navigate(isEdit ? `/admin/billing/${id}` : "/admin/billing")}>
            ← Back
          </button>
        </div>

        {loadError && (
          <div className="state-card error">
            <span className="state-dot error" />
            <div><strong>Load error</strong><p>{loadError}</p></div>
          </div>
        )}

        {loading ? (
          <div className="state-card">
            <span className="state-dot loading" />
            <div><strong>Loading...</strong><p>Preparing invoice form</p></div>
          </div>
        ) : (
          <form className="af-form" onSubmit={handleSubmit}>
            <div className="af-section">
              <p className="af-section-title">Invoice Details</p>
              <div className="af-grid-3">
                <Field label="Invoice Number">
                  <input className="af-input" value={fields.invoice_no} onChange={e => set("invoice_no", e.target.value.toUpperCase())} placeholder="e.g. INV-5001" required />
                </Field>
                <Field label="Linked Trip" hint={selectedTrip ? `${selectedTrip.lane} · POD ${selectedTrip.podStatus}` : "Optional, but useful for POD tracking"}>
                  <select className="af-select" value={fields.trip_id || ""} onChange={e => handleTripChange(e.target.value)}>
                    <option value="">No Linked Trip</option>
                    {formData.trips.map(trip => (
                      <option key={trip.id} value={trip.id}>
                        {trip.tripCode} · {trip.clientName || "Internal dispatch"}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Client Name">
                  <input className="af-input" value={fields.client_name} onChange={e => set("client_name", e.target.value)} placeholder="Customer or billing entity" required />
                </Field>
                <Field label="Customer Billing Address">
                  <textarea className="af-input" value={fields.customer_address || ""} onChange={e => set("customer_address", e.target.value)} placeholder="Registered or billing address" required={fields.payment_status !== "draft"} />
                </Field>
                <Field label="Customer VAT Number" hint="Required where applicable">
                  <input className="af-input" value={fields.customer_vat_number || ""} onChange={e => set("customer_vat_number", e.target.value.toUpperCase())} placeholder="GB 123 4567 89" />
                </Field>
                <Field label="Supplier Legal Name">
                  <input className="af-input" value={fields.supplier_name || ""} onChange={e => set("supplier_name", e.target.value)} required={fields.payment_status !== "draft"} />
                </Field>
                <Field label="Supplier Address">
                  <textarea className="af-input" value={fields.supplier_address || ""} onChange={e => set("supplier_address", e.target.value)} placeholder="Registered business address" required={fields.payment_status !== "draft"} />
                </Field>
                <Field label="Supplier VAT Number">
                  <input className="af-input" value={fields.supplier_vat_number || ""} onChange={e => set("supplier_vat_number", e.target.value.toUpperCase())} placeholder="GB 123 4567 89" />
                </Field>
                <Field label="Service Description">
                  <textarea className="af-input" value={fields.service_description || ""} onChange={e => set("service_description", e.target.value)} required={fields.payment_status !== "draft"} />
                </Field>
                <Field label="Supply / Tax Point Date">
                  <input className="af-input" type="date" value={fields.supply_date || ""} onChange={e => set("supply_date", e.target.value)} required={fields.payment_status !== "draft"} />
                </Field>
                <Field label="Customer PO Reference">
                  <input className="af-input" value={fields.purchase_order_ref || ""} onChange={e => set("purchase_order_ref", e.target.value)} placeholder="Optional PO / booking reference" />
                </Field>
                <Field label="Net Amount (£)">
                  <input className="af-input" type="number" min="0.01" step="0.01" value={fields.net_amount_gbp} onChange={e => set("net_amount_gbp", e.target.value)} required />
                </Field>
                <Field label="VAT Rate">
                  <select className="af-select" value={fields.vat_rate} onChange={e => set("vat_rate", e.target.value)}>
                    <option value="20">20% Standard</option>
                    <option value="5">5% Reduced</option>
                    <option value="0">0% Zero rated / exempt</option>
                  </select>
                </Field>
                <Field label="VAT Amount">
                  <input className="af-input" value={`£${vatAmount.toFixed(2)}`} readOnly />
                </Field>
                <Field label="Total Due">
                  <input className="af-input" value={`£${grossAmount.toFixed(2)}`} readOnly />
                </Field>
                <Field label="Issued Date">
                  <input className="af-input" type="date" value={fields.issued_at} onChange={e => set("issued_at", e.target.value)} required />
                </Field>
                <Field label="Due Date">
                  <input className="af-input" type="date" value={fields.due_date} onChange={e => set("due_date", e.target.value)} required />
                </Field>
                <Field label="Payment Status">
                  <select className="af-select" value={fields.payment_status} onChange={e => set("payment_status", e.target.value)}>
                    <option value="draft">Draft</option>
                    <option value="sent">Sent</option>
                    <option value="pending">Pending</option>
                    <option value="overdue">Overdue</option>
                    {isEdit && fields.payment_status === "paid" && <option value="paid">Paid</option>}
                    <option value="hold">Hold</option>
                  </select>
                </Field>
                <Field label="POD Verified">
                  <label style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 42, color: "#334155", fontWeight: 700 }}>
                    <input type="checkbox" checked={fields.pod_verified} onChange={e => set("pod_verified", e.target.checked)} />
                    Verified
                  </label>
                </Field>
              </div>
              <div className="af-grid-3">
                <Field label="Payment Terms">
                  <input className="af-input" value={fields.payment_terms || ""} onChange={e => set("payment_terms", e.target.value)} />
                </Field>
                <Field label="Bank / Remittance Details">
                  <textarea className="af-input" value={fields.bank_details || ""} onChange={e => set("bank_details", e.target.value)} placeholder="Account name, sort code and account number" />
                </Field>
              </div>
              <Field label="Notes">
                <textarea className="af-input" style={{ minHeight: 78, resize: "vertical" }} value={fields.notes || ""} onChange={e => set("notes", e.target.value)} placeholder="Billing notes, exception reason, approval note..." />
              </Field>
            </div>

            {submitError && (
              <div className="state-card error">
                <span className="state-dot error" />
                <div><strong>Save error</strong><p>{submitError}</p></div>
              </div>
            )}

            <div className="af-actions">
              <button className="header-action-button" type="button" onClick={() => navigate(isEdit ? `/admin/billing/${id}` : "/admin/billing")}>
                Cancel
              </button>
              <button className="af-submit-btn" type="submit" disabled={submitting}>
                {submitting ? "Saving..." : isEdit ? "Save Invoice →" : "Create Invoice →"}
              </button>
            </div>
          </form>
        )}
      </div>
    </AdminWorkspaceLayout>
  );
}
