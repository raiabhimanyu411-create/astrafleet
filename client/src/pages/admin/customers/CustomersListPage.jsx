import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { deleteCustomer, getCustomers, updateCustomerInline } from "../../../api/customerApi";
import { StateNotice } from "../../../components/StateNotice";
import { AdminWorkspaceLayout } from "../AdminWorkspaceLayout";
import "./CustomersListPage.css";

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

const STATUS_TONE = { active: "success", suspended: "warning", closed: "neutral" };

function blank(value) {
  return value === "—" ? "" : value ?? "";
}

// Edits save field by field on blur, as before; the panel only reshapes the layout.
function CustomerPanel({ customer: c, savingCell, onClose, saveOnBlur, updateCell, closeAccount, navigate }) {
  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const saving = savingCell.startsWith(`${c.id}-`);

  return (
    <div className="cu-panel-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <aside className="cu-panel" role="dialog" aria-modal="true" aria-labelledby="cu-panel-title">
        <header className="cu-panel-head">
          <div className="cu-company">
            <span className="cu-avatar large" aria-hidden="true">{getCompanyInitials(c.companyName)}</span>
            <div>
              <h2 id="cu-panel-title">{c.companyName}</h2>
              <p>Customer since {c.since || "—"} · <span className={`cu-badge ${STATUS_TONE[c.status] || "neutral"}`}>{c.status}</span></p>
            </div>
          </div>
          <button className="cu-icon-btn" type="button" aria-label="Close" onClick={onClose}>×</button>
        </header>

        <div className="cu-panel-body">
          <dl className="cu-figures">
            <div><dt>Jobs</dt><dd>{c.totalTrips}</dd></div>
            <div><dt>Invoices</dt><dd>{c.totalInvoices}</dd></div>
            <div><dt>Total billed</dt><dd>{c.billedAmount}</dd></div>
            <div><dt>Outstanding</dt><dd className={c.outstandingValue > 0 ? "warning" : ""}>{c.outstandingAmount}</dd></div>
            <div><dt>Overdue</dt><dd className={c.overdueValue > 0 ? "danger" : ""}>{c.overdueAmount}</dd></div>
            <div><dt>Last activity</dt><dd>{c.lastActivity}</dd></div>
          </dl>

          <section className="cu-section">
            <div className="cu-section-head">
              <h3>Contact and company</h3>
              <span className="cu-save-state" aria-live="polite">{saving ? "Saving…" : "Changes save automatically"}</span>
            </div>
            <div className="cu-fields">
              <label className="cu-field wide">
                <span>Company name</span>
                <input className="cu-input" defaultValue={c.companyName || ""} onBlur={saveOnBlur(c, "companyName", c.companyName)} />
              </label>
              <label className="cu-field">
                <span>Primary contact</span>
                <input className="cu-input" defaultValue={blank(c.contactName)} onBlur={saveOnBlur(c, "contactName", blank(c.contactName))} />
              </label>
              <label className="cu-field">
                <span>Phone</span>
                <input className="cu-input" defaultValue={blank(c.phone)} onBlur={saveOnBlur(c, "phone", blank(c.phone))} />
              </label>
              <label className="cu-field">
                <span>Email</span>
                <input className="cu-input" type="email" defaultValue={blank(c.email)} onBlur={saveOnBlur(c, "email", blank(c.email))} />
              </label>
              <label className="cu-field">
                <span>Postcode</span>
                <input className="cu-input" defaultValue={blank(c.postcode)} onBlur={saveOnBlur(c, "postcode", blank(c.postcode))} />
              </label>
              <label className="cu-field">
                <span>Account status</span>
                <select className="cu-input" value={c.status || "active"} disabled={savingCell === `${c.id}-status`} onChange={e => updateCell(c, "status", e.target.value)}>
                  <option value="active">Active</option>
                  <option value="suspended">Suspended</option>
                  <option value="closed">Closed</option>
                </select>
              </label>
              <label className="cu-field wide">
                <span>Company address</span>
                <textarea className="cu-input" rows={2} defaultValue={blank(c.address)} onBlur={saveOnBlur(c, "address", blank(c.address))} />
              </label>
            </div>
          </section>

          <section className="cu-section">
            <h3>Billing and terms</h3>
            <div className="cu-fields">
              <label className="cu-field">
                <span>Payment terms (days)</span>
                <input className="cu-input" type="number" min="0" defaultValue={c.paymentTermsDays || 30} onBlur={saveOnBlur(c, "paymentTermsDays", c.paymentTermsDays || 30)} />
              </label>
              <label className="cu-field">
                <span>Credit limit (£)</span>
                <input className="cu-input" type="number" step="0.01" defaultValue={c.creditLimitRaw || ""} onBlur={saveOnBlur(c, "creditLimitGbp", c.creditLimitRaw || "")} />
              </label>
              <label className="cu-field">
                <span>VAT number</span>
                <input className="cu-input" defaultValue={blank(c.vatNumber)} onBlur={saveOnBlur(c, "vatNumber", blank(c.vatNumber))} />
              </label>
              <label className="cu-field">
                <span>Tax / reference</span>
                <input className="cu-input" defaultValue={blank(c.taxDetails)} onBlur={saveOnBlur(c, "taxDetails", blank(c.taxDetails))} />
              </label>
              <label className="cu-field wide">
                <span>Billing address</span>
                <textarea className="cu-input" rows={2} defaultValue={blank(c.billingAddress)} onBlur={saveOnBlur(c, "billingAddress", blank(c.billingAddress))} />
              </label>
            </div>
          </section>

          <section className="cu-section">
            <h3>Saved locations and rates</h3>
            <div className="cu-fields">
              <label className="cu-field wide">
                <span>Saved pickup notes</span>
                <textarea className="cu-input" rows={2} defaultValue={blank(c.savedPickupAddresses)} onBlur={saveOnBlur(c, "savedPickupAddresses", blank(c.savedPickupAddresses))} />
              </label>
              <label className="cu-field wide">
                <span>Saved drop notes</span>
                <textarea className="cu-input" rows={2} defaultValue={blank(c.savedDropAddresses)} onBlur={saveOnBlur(c, "savedDropAddresses", blank(c.savedDropAddresses))} />
              </label>
              <label className="cu-field wide">
                <span>Rate contract</span>
                <textarea className="cu-input" rows={3} defaultValue={blank(c.rateContract)} onBlur={saveOnBlur(c, "rateContract", blank(c.rateContract))} />
              </label>
            </div>
          </section>
        </div>

        <footer className="cu-panel-foot">
          <button className="cu-btn primary" type="button" onClick={() => navigate(`/admin/customers/${c.id}`)}>Open full account</button>
          <button className="cu-btn" type="button" onClick={() => navigate(`/admin/customers/${c.id}/edit`)}>Edit page</button>
          {c.status !== "closed" && (
            <button className="cu-btn danger" disabled={savingCell === `${c.id}-close`} type="button" onClick={() => closeAccount(c)}>
              Close account
            </button>
          )}
        </footer>
      </aside>
    </div>
  );
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
  const [openId, setOpenId] = useState(null);

  // Only the first load shows the loading notice; saves refresh quietly.
  function load() {
    return getCustomers()
      .then(r => {
        setData(r.data);
        setError("");
      })
      .catch(() => setError("Could not load customers. Please refresh."))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  const allCustomers = useMemo(() => data?.customers || [], [data]);

  const customers = useMemo(() => {
    const query = search.trim().toLowerCase();
    return allCustomers.filter(c => {
      if (status && c.status !== status) return false;
      if (risk === "overdue" && c.overdueValue <= 0) return false;
      if (risk === "outstanding" && c.outstandingValue <= 0) return false;
      if (risk === "inactive" && c.totalTrips > 0) return false;
      if (!query) return true;
      return [c.companyName, c.contactName, c.email, c.phone, c.postcode]
        .some(value => String(value || "").toLowerCase().includes(query));
    });
  }, [allCustomers, risk, search, status]);

  const counts = useMemo(() => ({
    active: allCustomers.filter(c => c.status === "active").length,
    outstanding: allCustomers.filter(c => c.outstandingValue > 0).length,
    overdue: allCustomers.filter(c => c.overdueValue > 0).length
  }), [allCustomers]);

  const summaryCards = [
    { key: "all", label: "All customers", value: allCustomers.length, tone: "neutral", active: !status && !risk, apply: () => { setStatus(""); setRisk(""); } },
    { key: "active", label: "Active", value: counts.active, tone: "success", active: status === "active" && !risk, apply: () => { setStatus("active"); setRisk(""); } },
    { key: "outstanding", label: "With balance due", value: counts.outstanding, tone: counts.outstanding ? "warning" : "neutral", active: risk === "outstanding" && !status, apply: () => { setStatus(""); setRisk("outstanding"); } },
    { key: "overdue", label: "Overdue", value: counts.overdue, tone: counts.overdue ? "danger" : "neutral", active: risk === "overdue" && !status, apply: () => { setStatus(""); setRisk("overdue"); } }
  ];

  const openCustomer = allCustomers.find(c => c.id === openId) || null;
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
      title="Customers"
      highlights={[]}
      hideHeaderIntro
      className="customers-page-shell"
    >
      <div className="cu-command-bar">
        <div className="cu-summary" aria-label="Customer summary">
          {summaryCards.map(card => (
            <button
              className={`cu-summary-card ${card.tone}${card.active ? " active" : ""}`}
              key={card.key}
              type="button"
              aria-pressed={card.active}
              onClick={card.apply}
            >
              <span>{card.label}</span>
              <strong>{card.value}</strong>
            </button>
          ))}
        </div>
        <div className="cu-actions">
          <button className="cu-btn subtle" type="button" onClick={load}>Refresh</button>
          <button className="cu-btn subtle" type="button" onClick={exportCustomers}>Export</button>
          <button className="cu-btn primary" type="button" onClick={() => navigate("/admin/customers/new")}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12" /></svg>
            Add customer
          </button>
        </div>
      </div>

      <StateNotice loading={loading && !data} error={error} />

      <section className="cu-card">
        <div className="cu-toolbar">
          <label className="cu-search">
            <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="9" cy="9" r="5.5" /><path d="m13 13 3.5 3.5" /></svg>
            <input
              type="search"
              placeholder="Search company, contact, email, phone or postcode"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </label>
          <select className="cu-input" aria-label="Status" value={status} onChange={e => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
            <option value="closed">Closed</option>
          </select>
          <select className="cu-input" aria-label="Account state" value={risk} onChange={e => setRisk(e.target.value)}>
            <option value="">All balances</option>
            <option value="outstanding">Balance due</option>
            <option value="overdue">Overdue</option>
            <option value="inactive">No jobs booked</option>
          </select>
          <button className="cu-btn subtle" disabled={!hasFilters} type="button" onClick={clearFilters}>Clear filters</button>
          <span className="cu-count">{customers.length} of {allCustomers.length}</span>
        </div>

        <div className="cu-table-shell">
          <table className="cu-table">
            <thead>
              <tr>
                <th>Company</th>
                <th>Phone</th>
                <th>Terms</th>
                <th className="num">Jobs</th>
                <th className="num">Billed</th>
                <th className="num">Outstanding</th>
                <th>Last activity</th>
                <th>Status</th>
                <th aria-label="Open" />
              </tr>
            </thead>
            <tbody>
              {customers.map(c => (
                <tr
                  key={c.id}
                  tabIndex={0}
                  onClick={() => setOpenId(c.id)}
                  onKeyDown={e => { if (e.key === "Enter") setOpenId(c.id); }}
                >
                  <td>
                    <div className="cu-company">
                      <span className="cu-avatar" aria-hidden="true">{getCompanyInitials(c.companyName)}</span>
                      <div>
                        <strong>{c.companyName}</strong>
                        <small>{[blank(c.contactName), blank(c.email)].filter(Boolean).join(" · ") || "No contact"}</small>
                      </div>
                    </div>
                  </td>
                  <td className="nowrap">{blank(c.phone) || "—"}</td>
                  <td className="nowrap">{c.paymentTerms}</td>
                  <td className="num">{c.totalTrips}</td>
                  <td className="num">{c.billedAmount}</td>
                  <td className="num">
                    <span className={c.overdueValue > 0 ? "danger" : c.outstandingValue > 0 ? "warning" : "cu-muted"}>{c.outstandingAmount}</span>
                    {c.overdueValue > 0 && <small className="danger">{c.overdueAmount} overdue</small>}
                  </td>
                  <td className="nowrap">{c.lastActivity}</td>
                  <td><span className={`cu-badge ${STATUS_TONE[c.status] || "neutral"}`}>{c.status}</span></td>
                  <td className="cu-open-cell"><span className="cu-chevron" aria-hidden="true">›</span></td>
                </tr>
              ))}
              {!loading && customers.length === 0 && (
                <tr className="cu-empty-row">
                  <td colSpan="9">
                    {hasFilters ? "No customers match these filters." : "No customers yet."}
                    {hasFilters
                      ? <button className="cu-link-btn" type="button" onClick={clearFilters}>Clear filters</button>
                      : <button className="cu-link-btn" type="button" onClick={() => navigate("/admin/customers/new")}>Add your first customer</button>}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {openCustomer && (
        <CustomerPanel
          key={openCustomer.id}
          customer={openCustomer}
          savingCell={savingCell}
          onClose={() => setOpenId(null)}
          saveOnBlur={saveOnBlur}
          updateCell={updateCell}
          closeAccount={closeAccount}
          navigate={navigate}
        />
      )}
    </AdminWorkspaceLayout>
  );
}
