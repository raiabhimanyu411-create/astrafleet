import { StatCard } from "../../components/StatCard";
import { StateNotice } from "../../components/StateNotice";
import { StatusPill } from "../../components/StatusPill";
import { usePanelData } from "../../hooks/usePanelData";
import { AdminWorkspaceLayout } from "./AdminWorkspaceLayout";

export function AdminFinancePage() {
  const { data, error, loading } = usePanelData("/api/admin/finance");

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
              <span className="card-label">Collection follow-up</span>
              <h2>Customer receivables</h2>
            </div>
            <StatusPill tone="warning">Pound collections</StatusPill>
          </div>

          <div className="data-rows compact">
            {(data?.collections || []).map((item) => (
              <div className="data-row" key={item.reference}>
                <div>
                  <strong>{item.reference}</strong>
                  <p>{item.counterparty}</p>
                </div>
                <div>
                  <span>{item.amount}</span>
                  <p>{item.due}</p>
                </div>
                <StatusPill tone={item.tone}>{item.status}</StatusPill>
              </div>
            ))}
          </div>
        </article>

        <article className="content-card">
          <div className="section-head">
            <div>
              <span className="card-label">Vendor payouts</span>
              <h2>Outgoing settlement queue</h2>
            </div>
            <StatusPill tone="neutral">Treasury desk</StatusPill>
          </div>

          <div className="data-rows compact">
            {(data?.payouts || []).map((item) => (
              <div className="data-row" key={item.reference}>
                <div>
                  <strong>{item.reference}</strong>
                  <p>{item.counterparty}</p>
                </div>
                <div>
                  <span>{item.amount}</span>
                  <p>{item.due}</p>
                </div>
                <StatusPill tone={item.tone}>{item.status}</StatusPill>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="content-grid">
        <article className="content-card">
          <div className="section-head">
            <div>
              <span className="card-label">Cash flow view</span>
              <h2>Finance notes and actions</h2>
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
          </div>
        </article>
      </section>
    </AdminWorkspaceLayout>
  );
}
