import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { deleteInvoice, getInvoiceById, recordInvoicePayment, updateInvoiceStatus } from "../../../api/adminApi";
import { DeleteReasonModal } from "../../../components/DeleteReasonModal";
import { StatusPill } from "../../../components/StatusPill";
import { AdminWorkspaceLayout } from "../AdminWorkspaceLayout";

function DetailBlock({ label, value }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value || "—"}</strong>
    </div>
  );
}

export function InvoiceDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [recordingPayment, setRecordingPayment] = useState(false);
  const [payment, setPayment] = useState({
    payment_date: new Date().toISOString().slice(0, 10),
    amount_gbp: "",
    payment_method: "bank_transfer",
    payment_reference: "",
    notes: ""
  });

  function load() {
    setLoading(true);
    getInvoiceById(id)
      .then(r => setInvoice(r.data))
      .catch(() => setError("Invoice details could not be loaded."))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, [id]);

  async function handleStatus(payment_status) {
    setActionError("");
    try {
      await updateInvoiceStatus(id, { payment_status });
      load();
    } catch (err) {
      setActionError(err?.response?.data?.message || "Invoice status could not be updated.");
    }
  }

  async function handlePodToggle() {
    setActionError("");
    try {
      await updateInvoiceStatus(id, { pod_verified: !invoice.podVerified });
      load();
    } catch (err) {
      setActionError(err?.response?.data?.message || "POD status could not be updated.");
    }
  }

  async function handleDelete(payload) {
    setActionError("");
    setDeleting(true);
    try {
      await deleteInvoice(id, payload);
      navigate("/admin/billing");
    } catch (err) {
      setActionError(err?.response?.data?.message || "Invoice could not be deleted.");
    } finally {
      setDeleting(false);
    }
  }

  async function handlePayment(e) {
    e.preventDefault();
    setActionError("");
    setRecordingPayment(true);
    try {
      await recordInvoicePayment(id, { ...payment, amount_gbp: Number(payment.amount_gbp) });
      setPayment(prev => ({ ...prev, amount_gbp: "", payment_reference: "", notes: "" }));
      load();
    } catch (err) {
      setActionError(err?.response?.data?.message || "Payment could not be recorded.");
    } finally {
      setRecordingPayment(false);
    }
  }

  return (
    <AdminWorkspaceLayout
      badge="Invoicing & Billing"
      title={invoice ? invoice.invoiceNo : "Invoice detail"}
      description={invoice ? `${invoice.clientName} · ${invoice.amountFormatted}` : "Invoice detail with trip, POD, and payment tracking."}
      highlights={[]}
    >
      <div style={{ maxWidth: 900 }}>
        <div className="af-back-row">
          <button className="af-back-btn" type="button" onClick={() => navigate("/admin/billing")}>
            ← Back To Billing
          </button>
        </div>

        {loading && (
          <div className="state-card">
            <span className="state-dot loading" />
            <div><strong>Loading...</strong><p>Loading invoice details</p></div>
          </div>
        )}

        {error && (
          <div className="state-card error">
            <span className="state-dot error" />
            <div><strong>Load error</strong><p>{error}</p></div>
          </div>
        )}

        {invoice && (
          <>
            <div className="content-card" style={{ marginBottom: 16 }}>
              <div className="section-head">
                <div>
                  <span className="card-label">Invoice</span>
                  <h2 style={{ margin: "4px 0 0", fontSize: "1.35rem" }}>{invoice.invoiceNo}</h2>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                  <StatusPill tone={invoice.tone}>{invoice.paymentStatus}</StatusPill>
                  <StatusPill tone={invoice.podVerified ? "success" : "warning"}>
                    {invoice.podVerified ? "POD Verified" : "POD Pending"}
                  </StatusPill>
                </div>
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                {["draft", "sent", "pending", "overdue", "hold"].map(status => (
                  invoice.paymentStatus !== status && (
                    <button key={status} className="header-action-button" style={{ height: 30, padding: "0 10px", fontSize: "0.78rem" }} type="button" onClick={() => handleStatus(status)}>
                      Set {status}
                    </button>
                  )
                ))}
                <button className="header-action-button" style={{ height: 30, padding: "0 10px", fontSize: "0.78rem" }} type="button" onClick={handlePodToggle}>
                  {invoice.podVerified ? "Mark POD Pending" : "Verify POD"}
                </button>
              </div>

              {actionError && (
                <div className="state-card error" style={{ marginTop: 12 }}>
                  <span className="state-dot error" />
                  <div><strong>Action error</strong><p>{actionError}</p></div>
                </div>
              )}
            </div>

            <div className="content-grid" style={{ marginBottom: 16 }}>
              <article className="content-card">
                <div className="section-head">
                  <div>
                    <span className="card-label">Billing</span>
                    <h2>Customer And Payment</h2>
                  </div>
                </div>
                <div className="detail-grid">
                  <div className="detail-wide"><DetailBlock label="Client" value={invoice.clientName} /></div>
                  <DetailBlock label="Amount" value={invoice.amountFormatted} />
                  <DetailBlock label="Net" value={invoice.netAmountFormatted} />
                  <DetailBlock label={`VAT (${invoice.vatRate}%)`} value={invoice.vatAmountFormatted} />
                  <DetailBlock label="Paid" value={invoice.paidAmountFormatted} />
                  <DetailBlock label="Balance" value={invoice.balanceFormatted} />
                  <DetailBlock label="Currency" value={invoice.currency} />
                  <DetailBlock label="Issued" value={invoice.issuedAt} />
                  <DetailBlock label="Due" value={invoice.dueDate} />
                  <DetailBlock label="Supply / Tax Point" value={invoice.supplyDate} />
                  <DetailBlock label="PO Reference" value={invoice.purchaseOrderRef} />
                  <div className="detail-wide"><DetailBlock label="Customer Address" value={invoice.customerAddress} /></div>
                  <DetailBlock label="Customer VAT No." value={invoice.customerVatNumber} />
                  <div className="detail-wide"><DetailBlock label="Description" value={invoice.serviceDescription} /></div>
                </div>
              </article>

              <article className="content-card">
                <div className="section-head">
                  <div>
                    <span className="card-label">Trip Link</span>
                    <h2>Dispatch And POD</h2>
                  </div>
                </div>
                <div className="detail-grid">
                  <DetailBlock label="Trip Code" value={invoice.tripCode} />
                  <DetailBlock label="POD Status" value={invoice.tripPodStatus} />
                  <div className="detail-wide"><DetailBlock label="Lane" value={invoice.lane} /></div>
                </div>
              </article>
            </div>

            <div className="content-grid" style={{ marginBottom: 16 }}>
              <article className="content-card">
                <div className="section-head">
                  <div><span className="card-label">Supplier</span><h2>Legal And Remittance Details</h2></div>
                </div>
                <div className="detail-grid">
                  <DetailBlock label="Legal Name" value={invoice.supplierName} />
                  <DetailBlock label="VAT Number" value={invoice.supplierVatNumber} />
                  <div className="detail-wide"><DetailBlock label="Address" value={invoice.supplierAddress} /></div>
                  <div className="detail-wide"><DetailBlock label="Payment Terms" value={invoice.paymentTerms} /></div>
                  <div className="detail-wide"><DetailBlock label="Bank Details" value={invoice.bankDetails} /></div>
                </div>
              </article>

              <article className="content-card">
                <div className="section-head">
                  <div><span className="card-label">Receipts</span><h2>Payment Ledger</h2></div>
                </div>
                <div className="data-rows compact">
                  {(invoice.payments || []).map(item => (
                    <div className="data-row" key={item.id}>
                      <div><strong>{item.amount}</strong><p>{item.date} · {item.method.replaceAll("_", " ")}</p></div>
                      <div><strong>{item.reference}</strong><p>{item.notes || "No note"}</p></div>
                    </div>
                  ))}
                  {(invoice.payments || []).length === 0 && <p className="finance-empty">No payments recorded.</p>}
                </div>
                {invoice.paymentStatus !== "paid" && (
                  <form className="af-form" onSubmit={handlePayment} style={{ marginTop: 12 }}>
                    <div className="af-grid-3">
                      <input className="af-input" type="date" value={payment.payment_date} onChange={e => setPayment(prev => ({ ...prev, payment_date: e.target.value }))} required />
                      <input className="af-input" type="number" min="0.01" step="0.01" placeholder="Amount £" value={payment.amount_gbp} onChange={e => setPayment(prev => ({ ...prev, amount_gbp: e.target.value }))} required />
                      <select className="af-select" value={payment.payment_method} onChange={e => setPayment(prev => ({ ...prev, payment_method: e.target.value }))}>
                        <option value="bank_transfer">Bank transfer</option>
                        <option value="card">Card</option>
                        <option value="direct_debit">Direct debit</option>
                        <option value="cheque">Cheque</option>
                        <option value="cash">Cash</option>
                        <option value="other">Other</option>
                      </select>
                      <input className="af-input" placeholder="Payment reference" value={payment.payment_reference} onChange={e => setPayment(prev => ({ ...prev, payment_reference: e.target.value }))} required />
                    </div>
                    <button className="af-submit-btn" type="submit" disabled={recordingPayment}>
                      {recordingPayment ? "Recording..." : "Record Payment"}
                    </button>
                  </form>
                )}
              </article>
            </div>

            <div className="content-card" style={{ marginBottom: 16 }}>
              <div className="section-head">
                <div>
                  <span className="card-label">Notes</span>
                  <h2>Billing Notes</h2>
                </div>
              </div>
              <p style={{ margin: 0, color: "#475569", fontSize: "0.9rem" }}>{invoice.notes || "No notes recorded."}</p>
            </div>

            <div className="af-actions">
              <button className="header-action-button" type="button" onClick={() => window.print()}>
                Print / Save PDF
              </button>
              <button className="header-action-button" type="button" onClick={() => navigate(`/admin/billing/${id}/edit`)}>
                Edit Invoice
              </button>
              <button className="af-submit-btn" type="button" onClick={() => navigate("/admin/billing/new")}>
                + Create Invoice
              </button>
              <button className="header-action-button danger" type="button" onClick={() => setShowDeleteModal(true)}>
                Delete Invoice
              </button>
            </div>
          </>
        )}
      </div>
      <DeleteReasonModal
        open={showDeleteModal}
        title="Delete Invoice"
        recordLabel={invoice ? `${invoice.invoiceNo} · ${invoice.clientName}` : ""}
        loading={deleting}
        onCancel={() => setShowDeleteModal(false)}
        onConfirm={handleDelete}
      />
    </AdminWorkspaceLayout>
  );
}
