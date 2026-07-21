import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { deleteInvoice, updateInvoiceStatus } from "../../api/adminApi";
import { DeleteReasonModal } from "../../components/DeleteReasonModal";
import { StateNotice } from "../../components/StateNotice";
import { StatusPill } from "../../components/StatusPill";
import { usePanelData } from "../../hooks/usePanelData";
import { AdminWorkspaceLayout } from "./AdminWorkspaceLayout";

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

export function AdminBillingPage() {
  const { data, error, loading, refetch } = usePanelData("/api/admin/billing");
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [pod, setPod] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [queue, setQueue] = useState("");
  const [actionError, setActionError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState(null);
  const hasFilters = Boolean(search || status || pod || dateFrom || dateTo || queue);

  const invoices = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (data?.invoices || []).filter(inv => {
      if (status && inv.status !== status) return false;
      if (pod && inv.podVerified !== (pod === "verified")) return false;
      if (queue === "ready" && !(inv.podVerified && ["draft", "pending"].includes(inv.status))) return false;
      if (queue === "pod" && inv.podVerified) return false;
      if (queue === "risk" && !["overdue", "hold"].includes(inv.status)) return false;
      if (!matchesDate(inv.dueDate, dateFrom, dateTo)) return false;
      if (!query) return true;
      return (
        inv.invoice.toLowerCase().includes(query) ||
        inv.client.toLowerCase().includes(query) ||
        inv.tripCode.toLowerCase().includes(query) ||
        inv.lane.toLowerCase().includes(query)
      );
    });
  }, [data, dateFrom, dateTo, pod, queue, search, status]);

  const workflow = useMemo(() => {
    const rows = data?.invoices || [];
    return [
      { label: "Draft", value: rows.filter(inv => inv.status === "draft").length, tone: "neutral" },
      { label: "Ready to send", value: rows.filter(inv => inv.podVerified && ["draft", "pending"].includes(inv.status)).length, tone: "success" },
      { label: "POD needed", value: rows.filter(inv => !inv.podVerified).length, tone: "warning" },
      { label: "Payment risk", value: rows.filter(inv => ["overdue", "hold"].includes(inv.status)).length, tone: "danger" }
    ];
  }, [data]);
  const selectedInvoice = invoices.find(item => item.id === selectedInvoiceId) || invoices[0] || null;

  useEffect(() => {
    if (selectedInvoice && selectedInvoice.id !== selectedInvoiceId) setSelectedInvoiceId(selectedInvoice.id);
  }, [selectedInvoice?.id, selectedInvoiceId]);

  async function updateStatus(id, payment_status) {
    setActionError("");
    try {
      await updateInvoiceStatus(id, { payment_status });
      refetch(false);
    } catch (err) {
      setActionError(err?.response?.data?.message || "Invoice status could not be updated.");
    }
  }

  async function togglePod(item) {
    setActionError("");
    try {
      await updateInvoiceStatus(item.id, { pod_verified: !item.podVerified });
      refetch(false);
    } catch (err) {
      setActionError(err?.response?.data?.message || "POD status could not be updated.");
    }
  }

  async function confirmDeleteInvoice(payload) {
    if (!deleteTarget) return;
    setActionError("");
    setDeleting(true);
    try {
      await deleteInvoice(deleteTarget.id, payload);
      setDeleteTarget(null);
      refetch(false);
    } catch (err) {
      setActionError(err?.response?.data?.message || "Invoice could not be deleted.");
    } finally {
      setDeleting(false);
    }
  }

  function exportInvoices() {
    exportCsv("billing-register.csv", [
      ["Invoice", "Client", "Net GBP", "VAT Rate", "VAT GBP", "Gross GBP", "Paid GBP", "Balance GBP", "Issued", "Due", "Status", "POD verified", "Trip", "Lane", "Notes"],
      ...invoices.map(inv => [
        inv.invoice,
        inv.client,
        inv.netAmountValue,
        inv.vatRate,
        inv.vatAmountValue,
        inv.amountValue,
        inv.paidAmountValue,
        inv.balanceAmountValue,
        inv.issuedAt,
        inv.dueDate,
        inv.status,
        inv.podVerified ? "Yes" : "No",
        inv.tripCode,
        inv.lane,
        inv.notes
      ])
    ]);
  }

  function clearFilters() {
    setSearch("");
    setStatus("");
    setPod("");
    setDateFrom("");
    setDateTo("");
    setQueue("");
  }

  return (
    <AdminWorkspaceLayout
      badge={data?.header?.badge || "Invoicing & Billing"}
      title={data?.header?.title || "Freight Invoices And POD Billing"}
      description={
        data?.header?.description ||
        "Manage invoice generation, POD-linked billing, and payment status tracking in pound sterling."
      }
      highlights={[]}
      className="billing-page-shell"
    >
      <div className="finance-command-bar">
        <button className="header-action-button" type="button" onClick={() => refetch(false)}>Refresh</button>
        <button className="header-action-button" type="button" onClick={exportInvoices}>Export CSV</button>
        <button className="af-submit-btn" type="button" onClick={() => navigate("/admin/billing/new")}>
          + Create Invoice
        </button>
      </div>

      <StateNotice loading={loading} error={error} />

      {actionError && (
        <div className="state-card error" style={{ marginBottom: 16 }}>
          <span className="state-dot error" />
          <div><strong>Action error</strong><p>{actionError}</p></div>
        </div>
      )}

      <section className="billing-command-strip" aria-label="Billing Summary">
        {[...(data?.amountSummary || []), ...workflow].map(item => (
          <button className={`billing-command-item ${item.tone}`} key={item.label} type="button" onClick={() => {
            setQueue("");
            if (item.label === "Draft") setStatus("draft");
            if (item.label === "Ready to send") { setStatus(""); setPod(""); setQueue("ready"); }
            if (item.label === "POD needed") { setStatus(""); setPod(""); setQueue("pod"); }
            if (item.label === "Payment risk") { setStatus(""); setPod(""); setQueue("risk"); }
          }}>
            <span>{item.label}</span><strong>{item.value}</strong><small>{item.description || "Invoice Workflow"}</small>
          </button>
        ))}
      </section>

      {(data?.blockers || []).length > 0 && (
        <section className="billing-exception-bar">
          <div><span className="card-label">Billing Exceptions</span><strong>{data.blockers.length} Items Need Review</strong></div>
          <div className="billing-exception-list">{data.blockers.map(item => <span key={item.title}>{item.title}</span>)}</div>
          <button className="header-action-button" type="button" onClick={() => setStatus("hold")}>Review Exceptions</button>
        </section>
      )}

      <section className="content-card finance-filter-card billing-filter-card">
        <input
          className="af-input"
          placeholder="Search Invoice, Client, Trip, Or Lane..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select className="af-select" value={status} onChange={e => { setStatus(e.target.value); setQueue(""); }}>
          <option value="">All Statuses</option>
          <option value="draft">Draft</option>
          <option value="sent">Sent</option>
          <option value="pending">Pending</option>
          <option value="overdue">Overdue</option>
          <option value="paid">Paid</option>
          <option value="hold">Hold</option>
        </select>
        <select className="af-select" value={pod} onChange={e => { setPod(e.target.value); setQueue(""); }}>
          <option value="">All POD States</option>
          <option value="verified">POD Verified</option>
          <option value="pending">POD Pending</option>
        </select>
        <input className="af-input" type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
        <input className="af-input" type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} />
        <button className="header-action-button" type="button" onClick={clearFilters} disabled={!hasFilters}>Clear Filters</button>
      </section>

      <section className="billing-workbench">
        <article className="content-card billing-register-panel">
          <div className="section-head"><div><span className="card-label">Invoice Register</span><h2>Customer Receivables</h2></div><StatusPill tone="neutral">{invoices.length} Visible</StatusPill></div>
          <div className="billing-register-head"><span>Invoice And Customer</span><span>Gross / Balance</span><span>Due And POD</span><span>Status</span></div>
          <div className="billing-register-list">
            {invoices.map(item => (
              <button className={`billing-register-item${item.id === selectedInvoice?.id ? " active" : ""}`} key={item.id} type="button" onClick={() => setSelectedInvoiceId(item.id)}>
                <span><strong>{item.invoice}</strong><small>{item.client} · {item.tripCode || "No Trip Link"}</small></span>
                <span><strong>{item.amount}</strong><small>{item.balanceAmount} Outstanding</small></span>
                <span><strong>{item.dueLabel}</strong><small>{item.podVerified ? "POD Verified" : "POD Pending"}</small></span>
                <span><StatusPill tone={item.tone}>{item.status}</StatusPill><small>{item.lane}</small></span>
              </button>
            ))}
            {!loading && invoices.length === 0 && <p className="finance-empty">{hasFilters ? "No Invoices Match Your Filters." : "No Invoices Yet. Create Your First Invoice."}</p>}
          </div>
        </article>

        <aside className="content-card billing-inspector">
          {selectedInvoice ? <>
            <div className="section-head"><div><span className="card-label">Invoice Inspector</span><h2>{selectedInvoice.invoice}</h2></div><StatusPill tone={selectedInvoice.tone}>{selectedInvoice.status}</StatusPill></div>
            <div className="billing-inspector-client"><strong>{selectedInvoice.client}</strong><p>{selectedInvoice.tripCode || "No Trip Link"} · {selectedInvoice.lane}</p></div>
            <dl className="billing-inspector-facts">
              <div><dt>Net</dt><dd>{selectedInvoice.netAmount}</dd></div><div><dt>VAT ({selectedInvoice.vatRate}%)</dt><dd>{selectedInvoice.vatAmount}</dd></div>
              <div><dt>Gross</dt><dd>{selectedInvoice.amount}</dd></div><div><dt>Paid</dt><dd>{selectedInvoice.paidAmount}</dd></div>
              <div><dt>Balance</dt><dd>{selectedInvoice.balanceAmount}</dd></div><div><dt>Due</dt><dd>{selectedInvoice.dueLabel}</dd></div>
            </dl>
            <div className={`billing-pod-state ${selectedInvoice.podVerified ? "verified" : "pending"}`}><span>{selectedInvoice.podVerified ? "POD Verified" : "POD Pending"}</span><button type="button" onClick={() => togglePod(selectedInvoice)}>{selectedInvoice.podVerified ? "Mark Pending" : "Verify POD"}</button></div>
            <div className="billing-inspector-actions">
              <button className="af-submit-btn" type="button" onClick={() => navigate(`/admin/billing/${selectedInvoice.id}`)}>{selectedInvoice.status === "paid" ? "Open Invoice" : "Open And Record Payment"}</button>
              {selectedInvoice.status !== "sent" && selectedInvoice.status !== "paid" && <button className="header-action-button" type="button" onClick={() => updateStatus(selectedInvoice.id, "sent")}>Send Invoice</button>}
              {selectedInvoice.status !== "hold" && selectedInvoice.status !== "paid" && <button className="header-action-button" type="button" onClick={() => updateStatus(selectedInvoice.id, "hold")}>Place On Hold</button>}
              <button className="header-action-button" type="button" onClick={() => navigate(`/admin/billing/${selectedInvoice.id}/edit`)}>Edit Invoice</button>
              <button className="header-action-button danger" type="button" onClick={() => setDeleteTarget(selectedInvoice)}>Delete Invoice</button>
            </div>
          </> : <p className="finance-empty">Select An Invoice To Review.</p>}
        </aside>
      </section>
      <DeleteReasonModal
        open={Boolean(deleteTarget)}
        title="Delete invoice"
        recordLabel={deleteTarget ? `${deleteTarget.invoice} · ${deleteTarget.client}` : ""}
        loading={deleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={confirmDeleteInvoice}
      />
    </AdminWorkspaceLayout>
  );
}
