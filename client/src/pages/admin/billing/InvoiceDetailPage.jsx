import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { deleteInvoice, getInvoiceById, updateInvoiceStatus } from "../../../api/adminApi";
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

  async function handleDelete() {
    if (!window.confirm("Delete this invoice?")) return;
    setActionError("");
    try {
      await deleteInvoice(id);
      navigate("/admin/billing");
    } catch (err) {
      setActionError(err?.response?.data?.message || "Invoice could not be deleted.");
    }
  }

  return (
    <AdminWorkspaceLayout
      badge="Invoicing & billing"
      title={invoice ? invoice.invoiceNo : "Invoice detail"}
      description={invoice ? `${invoice.clientName} · ${invoice.amountFormatted}` : "Invoice detail with trip, POD, and payment tracking."}
      highlights={[]}
    >
      <div style={{ maxWidth: 900 }}>
        <div className="af-back-row">
          <button className="af-back-btn" type="button" onClick={() => navigate("/admin/billing")}>
            ← Back to billing
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
                    {invoice.podVerified ? "POD verified" : "POD pending"}
                  </StatusPill>
                </div>
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                {["draft", "sent", "pending", "overdue", "paid", "hold"].map(status => (
                  invoice.paymentStatus !== status && (
                    <button key={status} className="header-action-button" style={{ height: 30, padding: "0 10px", fontSize: "0.78rem" }} type="button" onClick={() => handleStatus(status)}>
                      Set {status}
                    </button>
                  )
                ))}
                <button className="header-action-button" style={{ height: 30, padding: "0 10px", fontSize: "0.78rem" }} type="button" onClick={handlePodToggle}>
                  {invoice.podVerified ? "Mark POD pending" : "Verify POD"}
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
                    <h2>Customer and payment</h2>
                  </div>
                </div>
                <div className="detail-grid">
                  <div className="detail-wide"><DetailBlock label="Client" value={invoice.clientName} /></div>
                  <DetailBlock label="Amount" value={invoice.amountFormatted} />
                  <DetailBlock label="Currency" value={invoice.currency} />
                  <DetailBlock label="Issued" value={invoice.issuedAt} />
                  <DetailBlock label="Due" value={invoice.dueDate} />
                </div>
              </article>

              <article className="content-card">
                <div className="section-head">
                  <div>
                    <span className="card-label">Trip link</span>
                    <h2>Dispatch and POD</h2>
                  </div>
                </div>
                <div className="detail-grid">
                  <DetailBlock label="Trip code" value={invoice.tripCode} />
                  <DetailBlock label="POD status" value={invoice.tripPodStatus} />
                  <div className="detail-wide"><DetailBlock label="Lane" value={invoice.lane} /></div>
                </div>
              </article>
            </div>

            <div className="content-card" style={{ marginBottom: 16 }}>
              <div className="section-head">
                <div>
                  <span className="card-label">Notes</span>
                  <h2>Billing notes</h2>
                </div>
              </div>
              <p style={{ margin: 0, color: "#475569", fontSize: "0.9rem" }}>{invoice.notes || "No notes recorded."}</p>
            </div>

            <div className="af-actions">
              <button className="header-action-button" type="button" onClick={() => navigate(`/admin/billing/${id}/edit`)}>
                Edit invoice
              </button>
              <button className="af-submit-btn" type="button" onClick={() => navigate("/admin/billing/new")}>
                + Create invoice
              </button>
              <button className="header-action-button danger" type="button" onClick={handleDelete}>
                Delete invoice
              </button>
            </div>
          </>
        )}
      </div>
    </AdminWorkspaceLayout>
  );
}
