import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getCustomers, deleteCustomer } from "../../../api/customerApi";
import { StatCard } from "../../../components/StatCard";
import { StateNotice } from "../../../components/StateNotice";
import { StatusPill } from "../../../components/StatusPill";
import { AdminWorkspaceLayout } from "../AdminWorkspaceLayout";

export function CustomersListPage() {
  const navigate = useNavigate();
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");
  const [search, setSearch]   = useState("");
  const [closing, setClosing] = useState(null);

  function load() {
    setLoading(true);
    getCustomers()
      .then(r => setData(r.data))
      .catch(() => setError("Could not load customers. Please refresh."))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  async function handleClose(id, name) {
    if (!window.confirm(`Close account for "${name}"? This will mark them as closed.`)) return;
    setClosing(id);
    try {
      await deleteCustomer(id);
      load();
    } catch {
      alert("Could not close account. Please try again.");
    } finally {
      setClosing(null);
    }
  }

  const filtered = (data?.customers || []).filter(c =>
    !search ||
    c.companyName.toLowerCase().includes(search.toLowerCase()) ||
    (c.contactName || "").toLowerCase().includes(search.toLowerCase()) ||
    (c.email || "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <AdminWorkspaceLayout
      badge="Customer accounts"
      title="Customer management"
      description="Manage client companies, contact details, payment terms, and account status."
      highlights={[
        "All customer accounts are listed with linked trips and invoices.",
        "Use the search to quickly find any client by name or email.",
        "Click a customer to view full details, trip history, and invoices."
      ]}
    >
      <StateNotice loading={loading} error={error} />

      <section className="stats-grid">
        {(data?.stats || []).map(item => (
          <StatCard key={item.label} item={item} />
        ))}
      </section>

      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 16 }}>
        <input
          className="af-input"
          style={{ maxWidth: 320, margin: 0 }}
          type="text"
          placeholder="Search by name, contact or email..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <button
          className="af-submit-btn"
          type="button"
          onClick={() => navigate("/admin/customers/new")}
        >
          + Add customer
        </button>
      </div>

      {/* Table */}
      <div className="content-card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.86rem" }}>
            <thead>
              <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                {["Company", "Contact", "Email / Phone", "Postcode", "Terms", "Trips", "Invoices", "Status", "Actions"].map(h => (
                  <th key={h} style={{ padding: "12px 16px", textAlign: "left", fontWeight: 700, color: "#475569", fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em", whiteSpace: "nowrap" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && !loading && (
                <tr>
                  <td colSpan={9} style={{ padding: "32px 16px", textAlign: "center", color: "#94a3b8", fontSize: "0.88rem" }}>
                    {search ? "No customers match your search." : "No customers yet. Add your first customer."}
                  </td>
                </tr>
              )}
              {filtered.map((c, i) => (
                <tr
                  key={c.id}
                  style={{
                    borderBottom: i < filtered.length - 1 ? "1px solid #e2e8f0" : "none",
                    background: "#ffffff",
                    transition: "background 120ms"
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = "#f8fafc"}
                  onMouseLeave={e => e.currentTarget.style.background = "#ffffff"}
                >
                  <td style={{ padding: "12px 16px" }}>
                    <strong style={{ display: "block", fontWeight: 600, color: "#0f172a" }}>{c.companyName}</strong>
                    <span style={{ fontSize: "0.76rem", color: "#94a3b8" }}>Since {c.since}</span>
                  </td>
                  <td style={{ padding: "12px 16px", color: "#334155" }}>{c.contactName}</td>
                  <td style={{ padding: "12px 16px" }}>
                    <span style={{ display: "block", color: "#334155" }}>{c.email}</span>
                    <span style={{ fontSize: "0.78rem", color: "#64748b" }}>{c.phone}</span>
                  </td>
                  <td style={{ padding: "12px 16px", color: "#64748b" }}>{c.postcode}</td>
                  <td style={{ padding: "12px 16px", color: "#64748b" }}>{c.paymentTerms}</td>
                  <td style={{ padding: "12px 16px", textAlign: "center", fontWeight: 700, color: "#0f172a" }}>{c.totalTrips}</td>
                  <td style={{ padding: "12px 16px", textAlign: "center", fontWeight: 700, color: "#0f172a" }}>{c.totalInvoices}</td>
                  <td style={{ padding: "12px 16px" }}>
                    <StatusPill tone={c.tone}>{c.status}</StatusPill>
                  </td>
                  <td style={{ padding: "12px 16px" }}>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        className="header-action-button"
                        style={{ height: 30, padding: "0 10px", fontSize: "0.78rem" }}
                        type="button"
                        onClick={() => navigate(`/admin/customers/${c.id}`)}
                      >
                        View
                      </button>
                      <button
                        className="header-action-button"
                        style={{ height: 30, padding: "0 10px", fontSize: "0.78rem" }}
                        type="button"
                        onClick={() => navigate(`/admin/customers/${c.id}/edit`)}
                      >
                        Edit
                      </button>
                      {c.status !== "closed" && (
                        <button
                          className="header-action-button danger"
                          style={{ height: 30, padding: "0 10px", fontSize: "0.78rem" }}
                          type="button"
                          disabled={closing === c.id}
                          onClick={() => handleClose(c.id, c.companyName)}
                        >
                          {closing === c.id ? "..." : "Close"}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AdminWorkspaceLayout>
  );
}
