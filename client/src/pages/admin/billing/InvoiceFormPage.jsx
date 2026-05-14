import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { createInvoice, getBillingFormData, getInvoiceById, updateInvoice } from "../../../api/adminApi";
import { AdminWorkspaceLayout } from "../AdminWorkspaceLayout";

const empty = {
  invoice_no: "",
  trip_id: "",
  client_name: "",
  amount_gbp: "",
  issued_at: new Date().toISOString().slice(0, 10),
  due_date: "",
  payment_status: "draft",
  pod_verified: false,
  notes: ""
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
    setFields(prev => ({
      ...prev,
      trip_id: value,
      client_name: trip?.clientName || prev.client_name,
      amount_gbp: trip?.freightAmountGbp || prev.amount_gbp,
      pod_verified: trip?.podStatus === "verified" ? true : prev.pod_verified
    }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitError("");
    setSubmitting(true);
    try {
      const payload = {
        ...fields,
        trip_id: fields.trip_id || null,
        amount_gbp: Number(fields.amount_gbp),
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
      badge="Invoicing & billing"
      title={isEdit ? "Edit invoice" : "Create invoice"}
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
              <p className="af-section-title">Invoice details</p>
              <div className="af-grid-3">
                <Field label="Invoice number">
                  <input className="af-input" value={fields.invoice_no} onChange={e => set("invoice_no", e.target.value.toUpperCase())} placeholder="e.g. INV-5001" required />
                </Field>
                <Field label="Linked trip" hint={selectedTrip ? `${selectedTrip.lane} · POD ${selectedTrip.podStatus}` : "Optional, but useful for POD tracking"}>
                  <select className="af-select" value={fields.trip_id || ""} onChange={e => handleTripChange(e.target.value)}>
                    <option value="">No linked trip</option>
                    {formData.trips.map(trip => (
                      <option key={trip.id} value={trip.id}>
                        {trip.tripCode} · {trip.clientName || "Internal dispatch"}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Client name">
                  <input className="af-input" value={fields.client_name} onChange={e => set("client_name", e.target.value)} placeholder="Customer or billing entity" required />
                </Field>
                <Field label="Amount (£)">
                  <input className="af-input" type="number" min="0" step="0.01" value={fields.amount_gbp} onChange={e => set("amount_gbp", e.target.value)} required />
                </Field>
                <Field label="Issued date">
                  <input className="af-input" type="date" value={fields.issued_at} onChange={e => set("issued_at", e.target.value)} required />
                </Field>
                <Field label="Due date">
                  <input className="af-input" type="date" value={fields.due_date} onChange={e => set("due_date", e.target.value)} required />
                </Field>
                <Field label="Payment status">
                  <select className="af-select" value={fields.payment_status} onChange={e => set("payment_status", e.target.value)}>
                    <option value="draft">Draft</option>
                    <option value="sent">Sent</option>
                    <option value="pending">Pending</option>
                    <option value="overdue">Overdue</option>
                    <option value="paid">Paid</option>
                    <option value="hold">Hold</option>
                  </select>
                </Field>
                <Field label="POD verified">
                  <label style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 42, color: "#334155", fontWeight: 700 }}>
                    <input type="checkbox" checked={fields.pod_verified} onChange={e => set("pod_verified", e.target.checked)} />
                    Verified
                  </label>
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
                {submitting ? "Saving..." : isEdit ? "Save invoice →" : "Create invoice →"}
              </button>
            </div>
          </form>
        )}
      </div>
    </AdminWorkspaceLayout>
  );
}
