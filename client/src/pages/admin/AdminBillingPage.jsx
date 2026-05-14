import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { StatCard } from "../../components/StatCard";
import { StateNotice } from "../../components/StateNotice";
import { StatusPill } from "../../components/StatusPill";
import { usePanelData } from "../../hooks/usePanelData";
import { AdminWorkspaceLayout } from "./AdminWorkspaceLayout";

export function AdminBillingPage() {
  const { data, error, loading } = usePanelData("/api/admin/billing");
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [pod, setPod] = useState("");

  const invoices = useMemo(() => {
    return (data?.invoices || []).filter(inv => {
      const query = search.toLowerCase();
      if (status && inv.status !== status) return false;
      if (pod && inv.podVerified !== (pod === "verified")) return false;
      if (!query) return true;
      return (
        inv.invoice.toLowerCase().includes(query) ||
        inv.client.toLowerCase().includes(query)
      );
    });
  }, [data, pod, search, status]);

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
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
        <button className="af-submit-btn" type="button" onClick={() => navigate("/admin/billing/new")}>
          + Create invoice
        </button>
      </div>

      <StateNotice loading={loading} error={error} />

      <section className="stats-grid">
        {(data?.stats || []).map((item) => (
          <StatCard item={item} key={item.label} />
        ))}
      </section>

      <section className="content-grid">
        <article className="content-card">
          <div className="section-head">
            <div>
              <span className="card-label">Invoice register</span>
              <h2>Customer billing records</h2>
            </div>
            <StatusPill tone="warning">Pound invoices</StatusPill>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
            <input
              className="af-input"
              style={{ margin: 0, flex: "1 1 220px" }}
              placeholder="Search invoice or client..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <select className="af-select" style={{ margin: 0, width: 160 }} value={status} onChange={e => setStatus(e.target.value)}>
              <option value="">All statuses</option>
              <option value="draft">Draft</option>
              <option value="sent">Sent</option>
              <option value="pending">Pending</option>
              <option value="overdue">Overdue</option>
              <option value="paid">Paid</option>
              <option value="hold">Hold</option>
            </select>
            <select className="af-select" style={{ margin: 0, width: 170 }} value={pod} onChange={e => setPod(e.target.value)}>
              <option value="">All POD states</option>
              <option value="verified">POD verified</option>
              <option value="pending">POD pending</option>
            </select>
          </div>

          <div className="data-rows compact">
            {invoices.map((item) => (
              <div
                className="data-row"
                key={item.id}
                style={{ cursor: "pointer" }}
                onClick={() => navigate(`/admin/billing/${item.id}`)}
              >
                <div>
                  <strong>{item.invoice}</strong>
                  <p>{item.client}</p>
                </div>
                <div>
                  <span>{item.amount}</span>
                  <p>{item.note}</p>
                </div>
                <StatusPill tone={item.tone}>{item.status}</StatusPill>
              </div>
            ))}
            {!loading && invoices.length === 0 && (
              <p style={{ color: "#94a3b8", fontSize: "0.86rem", margin: 0 }}>
                {search || status || pod ? "No invoices match your filters." : "No invoices yet. Create your first invoice."}
              </p>
            )}
          </div>
        </article>

        <article className="content-card">
          <div className="section-head">
            <div>
              <span className="card-label">Billing blockers</span>
              <h2>POD and payment exceptions</h2>
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
          </div>
        </article>
      </section>
    </AdminWorkspaceLayout>
  );
}
