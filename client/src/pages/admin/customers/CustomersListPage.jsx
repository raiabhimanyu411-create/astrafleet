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

      <section className="content-card customer-register-card">
        <div className="section-head">
          <div>
            <span className="card-label">Customer register</span>
            <h2>Editable customer table</h2>
          </div>
          <StatusPill tone={customers.length ? "success" : "neutral"}>{customers.length} visible</StatusPill>
        </div>

        <div className="customer-table-shell">
          <table className="customer-edit-table">
            <thead>
              <tr>
                <th>Company</th>
                <th>Contact</th>
                <th>Email</th>
                <th>Phone</th>
                <th>Postcode</th>
                <th>Status</th>
                <th>Terms</th>
                <th>Credit limit</th>
                <th>VAT</th>
                <th>Tax / ref</th>
                <th>Address</th>
                <th>Billing address</th>
                <th>Pickup notes</th>
                <th>Drop notes</th>
                <th>Rate contract</th>
                <th>Trips</th>
                <th>Invoices</th>
                <th>Billed</th>
                <th>Outstanding</th>
                <th>Overdue</th>
                <th>Last activity</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {customers.map(c => (
                <tr key={c.id}>
                  <td><input className="customer-table-input strong" defaultValue={c.companyName || ""} onBlur={saveOnBlur(c, "companyName", c.companyName)} /></td>
                  <td><input className="customer-table-input" defaultValue={c.contactName === "—" ? "" : c.contactName || ""} onBlur={saveOnBlur(c, "contactName", c.contactName === "—" ? "" : c.contactName)} /></td>
                  <td><input className="customer-table-input" type="email" defaultValue={c.email === "—" ? "" : c.email || ""} onBlur={saveOnBlur(c, "email", c.email === "—" ? "" : c.email)} /></td>
                  <td><input className="customer-table-input" defaultValue={c.phone === "—" ? "" : c.phone || ""} onBlur={saveOnBlur(c, "phone", c.phone === "—" ? "" : c.phone)} /></td>
                  <td><input className="customer-table-input code" defaultValue={c.postcode === "—" ? "" : c.postcode || ""} onBlur={saveOnBlur(c, "postcode", c.postcode === "—" ? "" : c.postcode)} /></td>
                  <td>
                    <select className="customer-table-select" value={c.status || "active"} disabled={savingCell === `${c.id}-status`} onChange={e => updateCell(c, "status", e.target.value)}>
                      <option value="active">Active</option>
                      <option value="suspended">Suspended</option>
                      <option value="closed">Closed</option>
                    </select>
                  </td>
                  <td>
                    <input className="customer-table-input number" type="number" min="0" defaultValue={c.paymentTermsDays || 30} onBlur={saveOnBlur(c, "paymentTermsDays", c.paymentTermsDays || 30)} />
                    <small>days</small>
                  </td>
                  <td>
                    <input className="customer-table-input money" type="number" step="0.01" defaultValue={c.creditLimitRaw || ""} onBlur={saveOnBlur(c, "creditLimitGbp", c.creditLimitRaw || "")} />
                    <small>{c.creditLimit}</small>
                  </td>
                  <td><input className="customer-table-input code" defaultValue={c.vatNumber === "—" ? "" : c.vatNumber || ""} onBlur={saveOnBlur(c, "vatNumber", c.vatNumber === "—" ? "" : c.vatNumber)} /></td>
                  <td><input className="customer-table-input" defaultValue={c.taxDetails === "—" ? "" : c.taxDetails || ""} onBlur={saveOnBlur(c, "taxDetails", c.taxDetails === "—" ? "" : c.taxDetails)} /></td>
                  <td><textarea className="customer-table-textarea" defaultValue={c.address === "—" ? "" : c.address || ""} onBlur={saveOnBlur(c, "address", c.address === "—" ? "" : c.address)} /></td>
                  <td><textarea className="customer-table-textarea" defaultValue={c.billingAddress === "—" ? "" : c.billingAddress || ""} onBlur={saveOnBlur(c, "billingAddress", c.billingAddress === "—" ? "" : c.billingAddress)} /></td>
                  <td><textarea className="customer-table-textarea" defaultValue={c.savedPickupAddresses === "—" ? "" : c.savedPickupAddresses || ""} onBlur={saveOnBlur(c, "savedPickupAddresses", c.savedPickupAddresses === "—" ? "" : c.savedPickupAddresses)} /></td>
                  <td><textarea className="customer-table-textarea" defaultValue={c.savedDropAddresses === "—" ? "" : c.savedDropAddresses || ""} onBlur={saveOnBlur(c, "savedDropAddresses", c.savedDropAddresses === "—" ? "" : c.savedDropAddresses)} /></td>
                  <td><textarea className="customer-table-textarea" defaultValue={c.rateContract === "—" ? "" : c.rateContract || ""} onBlur={saveOnBlur(c, "rateContract", c.rateContract === "—" ? "" : c.rateContract)} /></td>
                  <td><strong>{c.totalTrips}</strong><small>bookings</small></td>
                  <td><strong>{c.totalInvoices}</strong><small>invoices</small></td>
                  <td><strong>{c.billedAmount}</strong></td>
                  <td><strong>{c.outstandingAmount}</strong></td>
                  <td>
                    <StatusPill tone={c.overdueValue > 0 ? "danger" : "success"}>{c.overdueAmount}</StatusPill>
                  </td>
                  <td><strong>{c.lastActivity}</strong></td>
                  <td>
                    <div className="customer-table-actions">
                      <button className="header-action-button" type="button" onClick={() => navigate(`/admin/customers/${c.id}`)}>Open</button>
                      <button className="header-action-button" type="button" onClick={() => navigate(`/admin/customers/${c.id}/edit`)}>Edit</button>
                      {c.status !== "closed" && (
                        <button className="header-action-button danger" disabled={savingCell === `${c.id}-close`} type="button" onClick={() => closeAccount(c)}>
                          Close
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && customers.length === 0 && (
                <tr>
                  <td colSpan="22">
                    <p className="finance-empty">
                      {hasFilters ? "No customers match your filters." : "No customers yet. Add your first customer."}
                    </p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </AdminWorkspaceLayout>
  );
}
