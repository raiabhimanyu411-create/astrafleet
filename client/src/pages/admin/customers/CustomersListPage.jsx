import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { deleteCustomer, getCustomers, updateCustomerStatus } from "../../../api/customerApi";
import { StatCard } from "../../../components/StatCard";
import { StateNotice } from "../../../components/StateNotice";
import { StatusPill } from "../../../components/StatusPill";
import { AdminWorkspaceLayout } from "../AdminWorkspaceLayout";

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

export function CustomersListPage() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [risk, setRisk] = useState("");
  const [busyId, setBusyId] = useState(null);

  function load() {
    setLoading(true);
    getCustomers()
      .then(r => {
        setData(r.data);
        setError("");
      })
      .catch(() => setError("Could not load customers. Please refresh."))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  const customers = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (data?.customers || []).filter(c => {
      if (status && c.status !== status) return false;
      if (risk === "overdue" && c.overdueValue <= 0) return false;
      if (risk === "outstanding" && c.outstandingValue <= 0) return false;
      if (risk === "inactive" && c.totalTrips > 0) return false;
      if (!query) return true;
      return (
        c.companyName.toLowerCase().includes(query) ||
        (c.contactName || "").toLowerCase().includes(query) ||
        (c.email || "").toLowerCase().includes(query) ||
        (c.phone || "").toLowerCase().includes(query) ||
        (c.postcode || "").toLowerCase().includes(query)
      );
    });
  }, [data, risk, search, status]);

  const visibleStats = useMemo(() => [
    { label: "Visible accounts", value: customers.length, description: "After current filters.", change: "Filtered", tone: "neutral" },
    { label: "At-risk accounts", value: customers.filter(c => c.atRisk).length, description: "Overdue or not active.", change: "Review", tone: "danger" },
    { label: "Open balance", value: `£${customers.reduce((sum, c) => sum + Number(c.outstandingValue || 0), 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, description: "Outstanding in view.", change: "Receivables", tone: "warning" },
    { label: "Trips booked", value: customers.reduce((sum, c) => sum + Number(c.totalTrips || 0), 0), description: "Trips from visible customers.", change: "Bookings", tone: "success" }
  ], [customers]);

  const hasFilters = Boolean(search || status || risk);

  function clearFilters() {
    setSearch("");
    setStatus("");
    setRisk("");
  }

  async function setAccountStatus(customer, nextStatus) {
    if (nextStatus === "closed" && !window.confirm(`Close account for "${customer.companyName}"?`)) return;
    setError("");
    setBusyId(customer.id);
    try {
      if (nextStatus === "closed") {
        await deleteCustomer(customer.id);
      } else {
        await updateCustomerStatus(customer.id, { account_status: nextStatus });
      }
      await load();
    } catch (err) {
      setError(err?.response?.data?.message || "Customer status could not be updated.");
    } finally {
      setBusyId(null);
    }
  }

  function exportCustomers() {
    exportCsv("customers-register.csv", [
      ["Company", "Contact", "Email", "Phone", "Postcode", "Terms", "Trips", "Invoices", "Billed", "Outstanding", "Overdue", "Status", "Last activity"],
      ...customers.map(c => [
        c.companyName,
        c.contactName,
        c.email,
        c.phone,
        c.postcode,
        c.paymentTerms,
        c.totalTrips,
        c.totalInvoices,
        c.billedValue,
        c.outstandingValue,
        c.overdueValue,
        c.status,
        c.lastActivity
      ])
    ]);
  }

  return (
    <AdminWorkspaceLayout
      badge="Customer accounts"
      title="Customer management"
      description="Manage client companies, contact details, payment terms, account status, and receivable risk."
      highlights={[
        "Customer accounts show linked trips, invoices, billed value, and outstanding exposure.",
        "Use filters to find active, suspended, overdue, or inactive accounts quickly.",
        "Click a customer to view full details, trip history, and invoices."
      ]}
    >
      <div className="finance-command-bar">
        <button className="header-action-button" type="button" onClick={load}>Refresh</button>
        <button className="header-action-button" type="button" onClick={exportCustomers}>Export CSV</button>
        <button className="af-submit-btn" type="button" onClick={() => navigate("/admin/customers/new")}>
          + Add customer
        </button>
      </div>

      <StateNotice loading={loading} error={error} />

      <section className="stats-grid">
        {(data?.stats || []).map(item => (
          <StatCard key={item.label} item={item} />
        ))}
      </section>

      <section className="stats-grid inline finance-position-grid">
        {(data?.accountHealth || []).map(item => (
          <StatCard key={item.label} item={item} />
        ))}
      </section>

      <section className="content-grid">
        <article className="content-card">
          <div className="section-head">
            <div>
              <span className="card-label">Account portfolio</span>
              <h2>Visible customer workload</h2>
            </div>
            <StatusPill tone="neutral">Filtered view</StatusPill>
          </div>
          <div className="billing-workflow-grid">
            {visibleStats.map(item => (
              <button className="billing-workflow-tile" key={item.label} type="button" onClick={() => {
                if (item.label === "At-risk accounts") setRisk("overdue");
                if (item.label === "Open balance") setRisk("outstanding");
              }}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
                <p>{item.description}</p>
              </button>
            ))}
          </div>
        </article>

        <article className="content-card">
          <div className="section-head">
            <div>
              <span className="card-label">Customer risk</span>
              <h2>Receivable and account exceptions</h2>
            </div>
            <StatusPill tone="warning">Review queue</StatusPill>
          </div>
          <div className="alert-stack">
            {customers.filter(c => c.atRisk || c.outstandingValue > 0).slice(0, 6).map(c => (
              <div className="alert-card" key={c.id} onClick={() => navigate(`/admin/customers/${c.id}`)} style={{ cursor: "pointer" }}>
                <div className={`alert-bar ${c.overdueValue > 0 || c.status === "closed" ? "danger" : "warning"}`} />
                <div>
                  <strong>{c.companyName}</strong>
                  <p>{c.overdueValue > 0 ? `${c.overdueAmount} overdue.` : c.outstandingValue > 0 ? `${c.outstandingAmount} outstanding.` : `Account status is ${c.status}.`}</p>
                </div>
              </div>
            ))}
            {!loading && customers.filter(c => c.atRisk || c.outstandingValue > 0).length === 0 && (
              <p className="finance-empty">No customer account risks right now. Overdue balances and suspended accounts will appear here.</p>
            )}
          </div>
        </article>
      </section>

      <section className="content-card customer-filter-card">
        <input
          className="af-input"
          type="text"
          placeholder="Search by company, contact, email, phone, or postcode..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select className="af-select" value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
          <option value="closed">Closed</option>
        </select>
        <select className="af-select" value={risk} onChange={e => setRisk(e.target.value)}>
          <option value="">All account states</option>
          <option value="outstanding">Outstanding balance</option>
          <option value="overdue">Overdue balance</option>
          <option value="inactive">No trips booked</option>
        </select>
        <button className="header-action-button" disabled={!hasFilters} type="button" onClick={clearFilters}>Clear filters</button>
      </section>

      <section className="content-card">
        <div className="section-head">
          <div>
            <span className="card-label">Customer register</span>
            <h2>Client account records</h2>
          </div>
          <StatusPill tone={customers.length ? "success" : "neutral"}>{customers.length} visible</StatusPill>
        </div>

        <div className="data-rows compact finance-list">
          {customers.map(c => (
            <div className="data-row finance-row customer-row" key={c.id}>
              <button className="finance-row-main customer-row-main" type="button" onClick={() => navigate(`/admin/customers/${c.id}`)}>
                <div>
                  <strong>{c.companyName}</strong>
                  <p>{c.contactName} · {c.email}</p>
                </div>
                <div>
                  <span>{c.paymentTerms}</span>
                  <p>{c.phone} · {c.postcode}</p>
                </div>
                <div>
                  <span>{c.billedAmount}</span>
                  <p>{c.totalTrips} trips · {c.totalInvoices} invoices</p>
                </div>
                <div>
                  <span>{c.outstandingAmount}</span>
                  <p>Last activity {c.lastActivity}</p>
                </div>
              </button>
              <div className="finance-row-actions">
                <StatusPill tone={c.tone}>{c.status}</StatusPill>
                {c.status !== "active" && (
                  <button className="header-action-button" disabled={busyId === c.id} type="button" onClick={() => setAccountStatus(c, "active")}>Activate</button>
                )}
                {c.status === "active" && (
                  <button className="header-action-button" disabled={busyId === c.id} type="button" onClick={() => setAccountStatus(c, "suspended")}>Suspend</button>
                )}
                <button className="header-action-button" type="button" onClick={() => navigate(`/admin/customers/${c.id}/edit`)}>Edit</button>
                {c.status !== "closed" && (
                  <button className="header-action-button danger" disabled={busyId === c.id} type="button" onClick={() => setAccountStatus(c, "closed")}>
                    {busyId === c.id ? "Saving..." : "Close"}
                  </button>
                )}
              </div>
            </div>
          ))}
          {!loading && customers.length === 0 && (
            <p className="finance-empty">
              {hasFilters ? "No customers match your filters." : "No customers yet. Add your first customer."}
            </p>
          )}
        </div>
      </section>
    </AdminWorkspaceLayout>
  );
}
