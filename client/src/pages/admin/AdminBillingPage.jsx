import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { deleteInvoice, updateInvoiceStatus } from "../../api/adminApi";
import { DeleteReasonModal } from "../../components/DeleteReasonModal";
import { StatCard } from "../../components/StatCard";
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
  const [actionError, setActionError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const hasFilters = Boolean(search || status || pod || dateFrom || dateTo);

  const invoices = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (data?.invoices || []).filter(inv => {
      if (status && inv.status !== status) return false;
      if (pod && inv.podVerified !== (pod === "verified")) return false;
      if (!matchesDate(inv.dueDate, dateFrom, dateTo)) return false;
      if (!query) return true;
      return (
        inv.invoice.toLowerCase().includes(query) ||
        inv.client.toLowerCase().includes(query) ||
        inv.tripCode.toLowerCase().includes(query) ||
        inv.lane.toLowerCase().includes(query)
      );
    });
  }, [data, dateFrom, dateTo, pod, search, status]);

  const workflow = useMemo(() => {
    const rows = data?.invoices || [];
    return [
      { label: "Draft", value: rows.filter(inv => inv.status === "draft").length, tone: "neutral" },
      { label: "Ready to send", value: rows.filter(inv => inv.podVerified && ["draft", "pending"].includes(inv.status)).length, tone: "success" },
      { label: "POD needed", value: rows.filter(inv => !inv.podVerified).length, tone: "warning" },
      { label: "Payment risk", value: rows.filter(inv => ["overdue", "hold"].includes(inv.status)).length, tone: "danger" }
    ];
  }, [data]);

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
      ["Invoice", "Client", "Amount GBP", "Issued", "Due", "Status", "POD verified", "Trip", "Lane", "Notes"],
      ...invoices.map(inv => [
        inv.invoice,
        inv.client,
        inv.amountValue,
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
  }

  return (
    <AdminWorkspaceLayout
      badge={data?.header?.badge || "Invoicing & billing"}
      title={data?.header?.title || "Freight invoices and POD billing"}
      description={
        data?.header?.description ||
        "Manage invoice generation, POD-linked billing, and payment status tracking in pound sterling."
      }
      highlights={data?.highlights || []}
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

      <section className="stats-grid">
        {(data?.stats || []).map((item) => (
          <StatCard item={item} key={item.label} />
        ))}
      </section>

      <section className="stats-grid inline finance-position-grid">
        {(data?.amountSummary || []).map((item) => (
          <StatCard item={item} key={item.label} />
        ))}
      </section>

      <section className="content-grid">
        <article className="content-card">
          <div className="section-head">
            <div>
              <span className="card-label">Billing Workflow</span>
              <h2>Invoice Control Board</h2>
            </div>
            <StatusPill tone="neutral">Live queue</StatusPill>
          </div>

          <div className="billing-workflow-grid">
            {workflow.map(item => (
              <button className="billing-workflow-tile" key={item.label} type="button" onClick={() => {
                if (item.label === "Draft") setStatus("draft");
                if (item.label === "POD needed") setPod("pending");
                if (item.label === "Payment risk") setStatus("overdue");
              }}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
                <StatusPill tone={item.tone}>Review</StatusPill>
              </button>
            ))}
          </div>
        </article>

        <article className="content-card">
          <div className="section-head">
            <div>
              <span className="card-label">Billing Blockers</span>
              <h2>POD And Payment Exceptions</h2>
            </div>
            <StatusPill tone="danger">Clear before send</StatusPill>
          </div>

          <div className="alert-stack">
            {(data?.blockers || []).map((item) => (
              <div className="alert-card" key={item.title}>
                <div className={`alert-bar ${item.tone}`} />
                <div>
                  <strong>{item.title}</strong>
                  <p>{item.description}</p>
                </div>
              </div>
            ))}
            {!loading && (data?.blockers || []).length === 0 && (
              <p className="finance-empty">No billing blockers right now. POD and payment exceptions will appear here.</p>
            )}
          </div>
        </article>
      </section>

      <section className="content-card finance-filter-card billing-filter-card">
        <input
          className="af-input"
          placeholder="Search Invoice, Client, Trip, Or Lane..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select className="af-select" value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">All Statuses</option>
          <option value="draft">Draft</option>
          <option value="sent">Sent</option>
          <option value="pending">Pending</option>
          <option value="overdue">Overdue</option>
          <option value="paid">Paid</option>
          <option value="hold">Hold</option>
        </select>
        <select className="af-select" value={pod} onChange={e => setPod(e.target.value)}>
          <option value="">All POD States</option>
          <option value="verified">POD Verified</option>
          <option value="pending">POD Pending</option>
        </select>
        <input className="af-input" type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
        <input className="af-input" type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} />
        <button className="header-action-button" type="button" onClick={clearFilters} disabled={!hasFilters}>Clear Filters</button>
      </section>

      <section className="content-card">
        <div className="section-head">
          <div>
            <span className="card-label">Invoice Register</span>
            <h2>Customer Billing Records</h2>
          </div>
          <StatusPill tone="warning">{invoices.length} visible</StatusPill>
        </div>

        <div className="data-rows compact finance-list">
          {invoices.map((item) => (
            <div className="data-row finance-row billing-row" key={item.id}>
              <button className="finance-row-main billing-row-main" type="button" onClick={() => navigate(`/admin/billing/${item.id}`)}>
                <div>
                  <strong>{item.invoice}</strong>
                  <p>{item.client} · {item.tripCode || "No Trip Link"}</p>
                </div>
                <div>
                  <span>{item.amount}</span>
                  <p>Issued {item.issued} · Due {item.dueLabel}</p>
                </div>
                <div>
                  <span>{item.podVerified ? "POD Verified" : "POD Pending"}</span>
                  <p>{item.lane}</p>
                </div>
              </button>
              <div className="finance-row-actions">
                <StatusPill tone={item.tone}>{item.status}</StatusPill>
                <button className="header-action-button" type="button" onClick={() => togglePod(item)}>
                  {item.podVerified ? "POD Pending" : "Verify POD"}
                </button>
                {item.status !== "sent" && item.status !== "paid" && (
                  <button className="header-action-button" type="button" onClick={() => updateStatus(item.id, "sent")}>Send</button>
                )}
                {item.status !== "hold" && item.status !== "paid" && (
                  <button className="header-action-button" type="button" onClick={() => updateStatus(item.id, "hold")}>Hold</button>
                )}
                {item.status !== "paid" && (
                  <button className="header-action-button" type="button" onClick={() => updateStatus(item.id, "paid")}>Mark Paid</button>
                )}
                <button className="header-action-button" type="button" onClick={() => navigate(`/admin/billing/${item.id}/edit`)}>Edit</button>
                <button className="header-action-button danger" type="button" onClick={() => setDeleteTarget(item)}>Delete</button>
              </div>
            </div>
          ))}
          {!loading && invoices.length === 0 && (
            <p className="finance-empty">
              {hasFilters ? "No invoices match your filters." : "No invoices yet. Create your first invoice."}
            </p>
          )}
        </div>
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
