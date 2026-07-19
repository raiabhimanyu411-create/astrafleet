import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { deleteCustomer, getCustomers, updateCustomerInline } from "../../../api/customerApi";
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

function getCompanyInitials(name = "") {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return parts.slice(0, 2).map(part => part[0]).join("").toUpperCase();
}

export function CustomersListPage() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [risk, setRisk] = useState("");
  const [savingCell, setSavingCell] = useState("");

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

  const hasFilters = Boolean(search || status || risk);

  function clearFilters() {
    setSearch("");
    setStatus("");
    setRisk("");
  }

  async function updateCell(customer, field, value) {
    const key = `${customer.id}-${field}`;
    setError("");
    setSavingCell(key);
    try {
      await updateCustomerInline(customer.id, { [field]: value });
      await load();
    } catch (err) {
      setError(err?.response?.data?.message || "Customer could not be updated.");
    } finally {
      setSavingCell("");
    }
  }

  function saveOnBlur(customer, field, oldValue) {
    return e => {
      const nextValue = e.target.value;
      if (String(oldValue ?? "") !== String(nextValue ?? "")) {
        updateCell(customer, field, nextValue);
      }
    };
  }

  async function closeAccount(customer) {
    if (!window.confirm(`Close account for "${customer.companyName}"?`)) return;
    setError("");
    setSavingCell(`${customer.id}-close`);
    try {
      await deleteCustomer(customer.id);
      await load();
    } catch (err) {
      setError(err?.response?.data?.message || "Customer could not be closed.");
    } finally {
      setSavingCell("");
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
      highlights={[]}
    >
      <div className="finance-command-bar">
        <button className="header-action-button" type="button" onClick={load}>Refresh</button>
        <button className="header-action-button" type="button" onClick={exportCustomers}>Export CSV</button>
        <button className="af-submit-btn" type="button" onClick={() => navigate("/admin/customers/new")}>
          + Add Customer
        </button>
      </div>

      <StateNotice loading={loading} error={error} />

      <section className="content-card customer-filter-card">
        <input
          className="af-input"
          type="text"
          placeholder="Search By Company, Contact, Email, Phone, Or Postcode..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select className="af-select" value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">All Statuses</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
          <option value="closed">Closed</option>
        </select>
        <select className="af-select" value={risk} onChange={e => setRisk(e.target.value)}>
          <option value="">All Account States</option>
          <option value="outstanding">Outstanding Balance</option>
          <option value="overdue">Overdue Balance</option>
          <option value="inactive">No Trips Booked</option>
        </select>
        <button className="header-action-button" disabled={!hasFilters} type="button" onClick={clearFilters}>Clear Filters</button>
      </section>

      <section className="content-card customer-register-card">
        <div className="section-head">
          <div>
            <span className="card-label">Customer Register</span>
            <h2>Customer Account Directory</h2>
          </div>
          <StatusPill tone={customers.length ? "success" : "neutral"}>{customers.length} visible</StatusPill>
        </div>

        <div className="customer-account-list">
          {customers.map(c => (
            <details className="customer-account-card" key={c.id}>
              <summary className="customer-account-summary">
                <span className="customer-company-avatar" aria-hidden="true">{getCompanyInitials(c.companyName)}</span>
                <div className="customer-company-primary">
                  <strong>{c.companyName}</strong>
                  <span>{c.contactName} · {c.email}</span>
                </div>
                <div className="customer-summary-stat">
                  <span>Activity</span>
                  <strong>{c.totalTrips} trips · {c.totalInvoices} invoices</strong>
                </div>
                <div className="customer-summary-stat">
                  <span>Outstanding</span>
                  <strong className={c.outstandingValue > 0 ? "warning" : ""}>{c.outstandingAmount}</strong>
                </div>
                <StatusPill tone={c.status === "active" ? "success" : c.status === "suspended" ? "warning" : "neutral"}>{c.status}</StatusPill>
                <span className="customer-expand-control">
                  <span className="customer-expand-label">Details</span>
                  <span className="customer-expand-chevron" aria-hidden="true">⌄</span>
                </span>
              </summary>

              <div className="customer-account-body">
                <div className="customer-account-section-head">
                  <div>
                    <span className="card-label">Editable account profile</span>
                    <h3>Contact &amp; company information</h3>
                  </div>
                  {savingCell.startsWith(`${c.id}-`) && <span className="customer-saving-state">Saving…</span>}
                </div>

                <div className="customer-edit-grid">
                  <label className="customer-edit-field">
                    <span>Company name</span>
                    <input className="customer-table-input strong" defaultValue={c.companyName || ""} onBlur={saveOnBlur(c, "companyName", c.companyName)} />
                  </label>
                  <label className="customer-edit-field">
                    <span>Primary contact</span>
                    <input className="customer-table-input" defaultValue={c.contactName === "—" ? "" : c.contactName || ""} onBlur={saveOnBlur(c, "contactName", c.contactName === "—" ? "" : c.contactName)} />
                  </label>
                  <label className="customer-edit-field">
                    <span>Email address</span>
                    <input className="customer-table-input" type="email" defaultValue={c.email === "—" ? "" : c.email || ""} onBlur={saveOnBlur(c, "email", c.email === "—" ? "" : c.email)} />
                  </label>
                  <label className="customer-edit-field">
                    <span>Phone</span>
                    <input className="customer-table-input" defaultValue={c.phone === "—" ? "" : c.phone || ""} onBlur={saveOnBlur(c, "phone", c.phone === "—" ? "" : c.phone)} />
                  </label>
                  <label className="customer-edit-field">
                    <span>Postcode</span>
                    <input className="customer-table-input code" defaultValue={c.postcode === "—" ? "" : c.postcode || ""} onBlur={saveOnBlur(c, "postcode", c.postcode === "—" ? "" : c.postcode)} />
                  </label>
                  <label className="customer-edit-field">
                    <span>Account status</span>
                    <select className="customer-table-select" value={c.status || "active"} disabled={savingCell === `${c.id}-status`} onChange={e => updateCell(c, "status", e.target.value)}>
                      <option value="active">Active</option>
                      <option value="suspended">Suspended</option>
                      <option value="closed">Closed</option>
                    </select>
                  </label>
                </div>

                <div className="customer-account-section-head compact">
                  <div>
                    <span className="card-label">Commercial setup</span>
                    <h3>Billing, tax &amp; terms</h3>
                  </div>
                </div>
                <div className="customer-edit-grid commercial">
                  <label className="customer-edit-field">
                    <span>Payment terms (days)</span>
                    <input className="customer-table-input number" type="number" min="0" defaultValue={c.paymentTermsDays || 30} onBlur={saveOnBlur(c, "paymentTermsDays", c.paymentTermsDays || 30)} />
                  </label>
                  <label className="customer-edit-field">
                    <span>Credit limit (£)</span>
                    <input className="customer-table-input money" type="number" step="0.01" defaultValue={c.creditLimitRaw || ""} onBlur={saveOnBlur(c, "creditLimitGbp", c.creditLimitRaw || "")} />
                  </label>
                  <label className="customer-edit-field">
                    <span>VAT number</span>
                    <input className="customer-table-input code" defaultValue={c.vatNumber === "—" ? "" : c.vatNumber || ""} onBlur={saveOnBlur(c, "vatNumber", c.vatNumber === "—" ? "" : c.vatNumber)} />
                  </label>
                  <label className="customer-edit-field">
                    <span>Tax / reference</span>
                    <input className="customer-table-input" defaultValue={c.taxDetails === "—" ? "" : c.taxDetails || ""} onBlur={saveOnBlur(c, "taxDetails", c.taxDetails === "—" ? "" : c.taxDetails)} />
                  </label>
                </div>

                <div className="customer-edit-grid notes">
                  <label className="customer-edit-field">
                    <span>Company address</span>
                    <textarea className="customer-table-textarea" defaultValue={c.address === "—" ? "" : c.address || ""} onBlur={saveOnBlur(c, "address", c.address === "—" ? "" : c.address)} />
                  </label>
                  <label className="customer-edit-field">
                    <span>Billing address</span>
                    <textarea className="customer-table-textarea" defaultValue={c.billingAddress === "—" ? "" : c.billingAddress || ""} onBlur={saveOnBlur(c, "billingAddress", c.billingAddress === "—" ? "" : c.billingAddress)} />
                  </label>
                  <label className="customer-edit-field">
                    <span>Saved pickup notes</span>
                    <textarea className="customer-table-textarea" defaultValue={c.savedPickupAddresses === "—" ? "" : c.savedPickupAddresses || ""} onBlur={saveOnBlur(c, "savedPickupAddresses", c.savedPickupAddresses === "—" ? "" : c.savedPickupAddresses)} />
                  </label>
                  <label className="customer-edit-field">
                    <span>Saved drop notes</span>
                    <textarea className="customer-table-textarea" defaultValue={c.savedDropAddresses === "—" ? "" : c.savedDropAddresses || ""} onBlur={saveOnBlur(c, "savedDropAddresses", c.savedDropAddresses === "—" ? "" : c.savedDropAddresses)} />
                  </label>
                  <label className="customer-edit-field wide">
                    <span>Rate contract</span>
                    <textarea className="customer-table-textarea" defaultValue={c.rateContract === "—" ? "" : c.rateContract || ""} onBlur={saveOnBlur(c, "rateContract", c.rateContract === "—" ? "" : c.rateContract)} />
                  </label>
                </div>

                <div className="customer-finance-strip">
                  <div><span>Trips</span><strong>{c.totalTrips}</strong></div>
                  <div><span>Invoices</span><strong>{c.totalInvoices}</strong></div>
                  <div><span>Total billed</span><strong>{c.billedAmount}</strong></div>
                  <div><span>Outstanding</span><strong>{c.outstandingAmount}</strong></div>
                  <div><span>Overdue</span><strong className={c.overdueValue > 0 ? "danger" : "success"}>{c.overdueAmount}</strong></div>
                  <div><span>Last activity</span><strong>{c.lastActivity}</strong></div>
                </div>

                <div className="customer-account-actions">
                  <button className="af-submit-btn" type="button" onClick={() => navigate(`/admin/customers/${c.id}`)}>Open Full Account</button>
                  <button className="header-action-button" type="button" onClick={() => navigate(`/admin/customers/${c.id}/edit`)}>Edit Page</button>
                  {c.status !== "closed" && (
                    <button className="header-action-button danger" disabled={savingCell === `${c.id}-close`} type="button" onClick={() => closeAccount(c)}>
                      Close Account
                    </button>
                  )}
                </div>
              </div>
            </details>
          ))}
          {!loading && customers.length === 0 && (
            <div className="customer-account-empty">
              <p>{hasFilters ? "No customers match your filters." : "No customers yet. Add your first customer."}</p>
              {hasFilters && <button className="header-action-button" type="button" onClick={clearFilters}>Clear Filters</button>}
            </div>
          )}
        </div>
      </section>
    </AdminWorkspaceLayout>
  );
}
