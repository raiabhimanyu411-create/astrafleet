import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  createPayout,
  deletePayout,
  updateInvoiceStatus,
  updatePayout,
  updatePayoutStatus
} from "../../api/adminApi";
import { DeleteReasonModal } from "../../components/DeleteReasonModal";
import { StateNotice } from "../../components/StateNotice";
import { StatusPill } from "../../components/StatusPill";
import { usePanelData } from "../../hooks/usePanelData";
import { AdminWorkspaceLayout } from "./AdminWorkspaceLayout";

const emptyPayout = {
  payout_reference: "",
  vendor_name: "",
  lane_code: "",
  amount_gbp: "",
  due_date: "",
  payout_status: "scheduled",
  notes: ""
};

function matchesDate(itemDate, from, to) {
  if (from && itemDate < from) return false;
  if (to && itemDate > to) return false;
  return true;
}

function exportCsv(name, rows) {
  const csv = rows
    .map(row => row.map(value => `"${String(value ?? "").replaceAll('"', '""')}"`).join(","))
    .join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

export function AdminFinancePage() {
  const { data, error, loading, refetch } = usePanelData("/api/admin/finance");
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [invoiceStatus, setInvoiceStatus] = useState("");
  const [payoutStatus, setPayoutStatus] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [form, setForm] = useState(emptyPayout);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const collections = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.collections || []).filter(item => {
      if (invoiceStatus && item.status !== invoiceStatus) return false;
      if (!matchesDate(item.dueDate, dateFrom, dateTo)) return false;
      if (!q) return true;
      return item.reference.toLowerCase().includes(q) || item.counterparty.toLowerCase().includes(q);
    });
  }, [data, dateFrom, dateTo, invoiceStatus, search]);

  const payouts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.payouts || []).filter(item => {
      if (payoutStatus && item.status !== payoutStatus) return false;
      if (!matchesDate(item.dueDate, dateFrom, dateTo)) return false;
      if (!q) return true;
      return (
        item.reference.toLowerCase().includes(q) ||
        item.vendorName.toLowerCase().includes(q) ||
        item.laneCode.toLowerCase().includes(q)
      );
    });
  }, [data, dateFrom, dateTo, payoutStatus, search]);

  function resetForm() {
    setForm(emptyPayout);
    setEditingId(null);
    setActionError("");
  }

  function startEdit(item) {
    setEditingId(item.id);
    setForm({
      payout_reference: item.reference,
      vendor_name: item.vendorName,
      lane_code: item.laneCode,
      amount_gbp: item.amountValue,
      due_date: item.dueDate,
      payout_status: item.status,
      notes: item.notes || ""
    });
    setActionError("");
  }

  async function handleInvoiceStatus(id, payment_status) {
    setActionError("");
    try {
      await updateInvoiceStatus(id, { payment_status });
      refetch(false);
    } catch (err) {
      setActionError(err?.response?.data?.message || "Invoice status could not be updated.");
    }
  }

  async function handlePayoutStatus(id, status) {
    setActionError("");
    try {
      await updatePayoutStatus(id, { payout_status: status });
      refetch(false);
    } catch (err) {
      setActionError(err?.response?.data?.message || "Payout status could not be updated.");
    }
  }

  async function confirmDeletePayout(payload) {
    if (!deleteTarget) return;
    setActionError("");
    setDeleting(true);
    try {
      await deletePayout(deleteTarget.id, payload);
      if (editingId === deleteTarget.id) resetForm();
      setDeleteTarget(null);
      refetch(false);
    } catch (err) {
      setActionError(err?.response?.data?.message || "Payout could not be deleted.");
    } finally {
      setDeleting(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setActionError("");
    try {
      if (editingId) {
        await updatePayout(editingId, form);
      } else {
        await createPayout(form);
      }
      resetForm();
      refetch(false);
    } catch (err) {
      setActionError(err?.response?.data?.message || "Payout could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  function exportFinance() {
    exportCsv("finance-register.csv", [
      ["Type", "Reference", "Counterparty", "Amount GBP", "Due date", "Status"],
      ...collections.map(item => ["Receivable", item.reference, item.counterparty, item.amountValue, item.dueDate, item.status]),
      ...payouts.map(item => ["Payout", item.reference, item.counterparty, item.amountValue, item.dueDate, item.status])
    ]);
  }

  return (
    <AdminWorkspaceLayout
      badge={data?.header?.badge || "Finance management"}
      title={data?.header?.title || "Collections, payouts and cash position"}
      description={
        data?.header?.description ||
        "Track collections follow-up, vendor payouts, cash flow, and overdue controls in pound sterling."
      }
      highlights={data?.highlights || []}
    >
      <div className="finance-command-bar">
        <button className="header-action-button" type="button" onClick={() => refetch(false)}>Refresh</button>
        <button className="header-action-button" type="button" onClick={exportFinance}>Export CSV</button>
      </div>

      <StateNotice loading={loading} error={error} />

      {actionError && (
        <div className="state-card error" style={{ marginBottom: 16 }}>
          <span className="state-dot error" />
          <div><strong>Action error</strong><p>{actionError}</p></div>
        </div>
      )}

      <section className="content-card">
        <div className="section-head">
          <div>
            <span className="card-label">Finance Overview</span>
            <h2>Key Metrics</h2>
          </div>
        </div>

        <div className="finance-table-shell">
          <table className="finance-table finance-summary-table">
            <thead>
              <tr>
                <th>Metric</th>
                <th>Value</th>
                <th>Detail</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {(data?.stats || []).map((item) => (
                <tr key={item.label}>
                  <td>{item.label}</td>
                  <td><strong>{item.value}</strong></td>
                  <td>{item.description}</td>
                  <td><StatusPill tone={item.tone}>{item.change}</StatusPill></td>
                </tr>
              ))}
              {(data?.cashPosition || []).map((item) => (
                <tr key={item.label}>
                  <td>{item.label}</td>
                  <td><strong>{item.value}</strong></td>
                  <td>{item.description}</td>
                  <td><StatusPill tone={item.tone}>Calculated live</StatusPill></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="content-card finance-filter-card">
        <input
          className="af-input"
          placeholder="Search Invoice, Customer, Payout, Vendor, Or Lane..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select className="af-select" value={invoiceStatus} onChange={e => setInvoiceStatus(e.target.value)}>
          <option value="">All Invoice Statuses</option>
          <option value="draft">Draft</option>
          <option value="sent">Sent</option>
          <option value="pending">Pending</option>
          <option value="overdue">Overdue</option>
          <option value="paid">Paid</option>
          <option value="hold">Hold</option>
        </select>
        <select className="af-select" value={payoutStatus} onChange={e => setPayoutStatus(e.target.value)}>
          <option value="">All Payout Statuses</option>
          <option value="scheduled">Scheduled</option>
          <option value="processing">Processing</option>
          <option value="paid">Paid</option>
          <option value="hold">Hold</option>
        </select>
        <input className="af-input" type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
        <input className="af-input" type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} />
      </section>

      <section className="content-grid">
        <article className="content-card">
          <div className="section-head">
            <div>
              <span className="card-label">Collection Follow-Up</span>
              <h2>Customer Receivables</h2>
            </div>
            <StatusPill tone="warning">Pound collections</StatusPill>
          </div>

          <div className="finance-table-shell">
            <table className="finance-table">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Customer</th>
                  <th>Amount</th>
                  <th>Due</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {collections.map((item) => (
                  <tr key={item.reference}>
                    <td>
                      <button className="finance-table-link" type="button" onClick={() => navigate(`/admin/billing/${item.id}`)}>
                        {item.reference}
                      </button>
                    </td>
                    <td>{item.counterparty}</td>
                    <td><strong>{item.amount}</strong></td>
                    <td>{item.due}</td>
                    <td><StatusPill tone={item.tone}>{item.status}</StatusPill></td>
                    <td>
                      <div className="finance-table-actions">
                        {item.status !== "paid" && (
                          <button className="header-action-button" type="button" onClick={() => navigate(`/admin/billing/${item.id}`)}>Record Payment</button>
                        )}
                        {item.status !== "hold" && (
                          <button className="header-action-button" type="button" onClick={() => handleInvoiceStatus(item.id, "hold")}>Hold</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {!loading && collections.length === 0 && (
                  <tr>
                    <td colSpan={6} className="finance-empty">{search || invoiceStatus || dateFrom || dateTo ? "No receivables match your filters." : "No open receivables. Customer collections are clear."}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </article>

        <article className="content-card">
          <div className="section-head">
            <div>
              <span className="card-label">Vendor Payouts</span>
              <h2>Outgoing Settlement Queue</h2>
            </div>
            <StatusPill tone="neutral">Treasury desk</StatusPill>
          </div>

          <div className="finance-table-shell">
            <table className="finance-table">
              <thead>
                <tr>
                  <th>Payout</th>
                  <th>Vendor / Lane</th>
                  <th>Amount</th>
                  <th>Due</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {payouts.map((item) => (
                  <tr key={item.reference}>
                    <td>
                      <button className="finance-table-link" type="button" onClick={() => startEdit(item)}>
                        {item.reference}
                      </button>
                    </td>
                    <td>{item.counterparty}</td>
                    <td><strong>{item.amount}</strong></td>
                    <td>{item.due}</td>
                    <td><StatusPill tone={item.tone}>{item.status}</StatusPill></td>
                    <td>
                      <div className="finance-table-actions">
                        {item.status !== "processing" && (
                          <button className="header-action-button" type="button" onClick={() => handlePayoutStatus(item.id, "processing")}>Process</button>
                        )}
                        {item.status !== "paid" && (
                          <button className="header-action-button" type="button" onClick={() => handlePayoutStatus(item.id, "paid")}>Mark Paid</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {!loading && payouts.length === 0 && (
                  <tr>
                    <td colSpan={6} className="finance-empty">{search || payoutStatus || dateFrom || dateTo ? "No payouts match your filters." : "No vendor payouts yet. Add a settlement to start the queue."}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </article>
      </section>

      <section className="content-grid">
        <article className="content-card">
          <div className="section-head">
            <div>
              <span className="card-label">Payout Control</span>
              <h2>{editingId ? "Edit Vendor Payout" : "Add Vendor Payout"}</h2>
            </div>
            {editingId && <button className="header-action-button" type="button" onClick={resetForm}>New Payout</button>}
          </div>

          <form className="af-form" onSubmit={handleSubmit}>
            <div className="af-grid-2">
              <label className="af-field">
                <span className="af-label">Reference</span>
                <input className="af-input" value={form.payout_reference} onChange={e => setForm(prev => ({ ...prev, payout_reference: e.target.value.toUpperCase() }))} placeholder="e.g. PAY-240" required />
              </label>
              <label className="af-field">
                <span className="af-label">Vendor</span>
                <input className="af-input" value={form.vendor_name} onChange={e => setForm(prev => ({ ...prev, vendor_name: e.target.value }))} placeholder="Vendor or supplier name" required />
              </label>
              <label className="af-field">
                <span className="af-label">Lane Code</span>
                <input className="af-input" value={form.lane_code} onChange={e => setForm(prev => ({ ...prev, lane_code: e.target.value.toUpperCase() }))} placeholder="e.g. LON-MAN" />
              </label>
              <label className="af-field">
                <span className="af-label">Amount (£)</span>
                <input className="af-input" type="number" min="0" step="0.01" value={form.amount_gbp} onChange={e => setForm(prev => ({ ...prev, amount_gbp: e.target.value }))} required />
              </label>
              <label className="af-field">
                <span className="af-label">Due Date</span>
                <input className="af-input" type="date" value={form.due_date} onChange={e => setForm(prev => ({ ...prev, due_date: e.target.value }))} required />
              </label>
              <label className="af-field">
                <span className="af-label">Status</span>
                <select className="af-select" value={form.payout_status} onChange={e => setForm(prev => ({ ...prev, payout_status: e.target.value }))}>
                  <option value="scheduled">Scheduled</option>
                  <option value="processing">Processing</option>
                  <option value="paid">Paid</option>
                  <option value="hold">Hold</option>
                </select>
              </label>
            </div>
            <label className="af-field">
              <span className="af-label">Notes</span>
              <textarea className="af-input" style={{ minHeight: 76, resize: "vertical" }} value={form.notes} onChange={e => setForm(prev => ({ ...prev, notes: e.target.value }))} placeholder="Settlement notes, approval detail, exception reason..." />
            </label>
            <div className="af-actions">
              {editingId && (
                <button className="header-action-button danger" type="button" onClick={() => setDeleteTarget({ id: editingId, reference: form.payout_reference, vendorName: form.vendor_name })}>
                  Delete
                </button>
              )}
              <button className="af-submit-btn" type="submit" disabled={saving}>
                {saving ? "Saving..." : editingId ? "Update Payout" : "Create Payout"}
              </button>
            </div>
          </form>
        </article>

        <article className="content-card">
          <div className="section-head">
            <div>
              <span className="card-label">Cash Flow View</span>
              <h2>Finance Notes And Actions</h2>
            </div>
            <StatusPill tone="success">Updated today</StatusPill>
          </div>

          <div className="alert-stack">
            {(data?.cashNotes || []).map((note) => (
              <div className="alert-card" key={note.title}>
                <div className={`alert-bar ${note.tone}`} />
                <div>
                  <strong>{note.title}</strong>
                  <p>{note.description}</p>
                </div>
              </div>
            ))}
            {!loading && (data?.cashNotes || []).length === 0 && (
              <p className="finance-empty">No finance actions right now. Alerts from the control room will appear here.</p>
            )}
          </div>
        </article>
      </section>
      <DeleteReasonModal
        open={Boolean(deleteTarget)}
        title="Delete payout"
        recordLabel={deleteTarget ? `${deleteTarget.reference} · ${deleteTarget.vendorName || "Vendor"}` : ""}
        loading={deleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={confirmDeletePayout}
      />
    </AdminWorkspaceLayout>
  );
}
