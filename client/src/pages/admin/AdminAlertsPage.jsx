import { useNavigate } from "react-router-dom";
import { StatCard } from "../../components/StatCard";
import { StateNotice } from "../../components/StateNotice";
import { StatusPill } from "../../components/StatusPill";
import { usePanelData } from "../../hooks/usePanelData";
import { AdminWorkspaceLayout } from "./AdminWorkspaceLayout";

export function AdminAlertsPage() {
  const { data, error, loading } = usePanelData("/api/admin/alerts");
  const navigate = useNavigate();

  return (
    <AdminWorkspaceLayout
      badge={data?.header?.badge || "Control room alerts"}
      title={data?.header?.title || "Delay, breakdown and compliance escalations"}
      description={
        data?.header?.description ||
        "A dedicated admin view for delay, breakdown, compliance breach, and reassignment escalations."
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
              <span className="card-label">Live escalations</span>
              <h2>Open alert register</h2>
            </div>
            <StatusPill tone="danger">Critical feed</StatusPill>
          </div>

          <div className="alert-stack">
            {(data?.alerts || []).map((item) => (
              <div
                className="alert-card"
                key={item.title}
                onClick={() => item.tripId && navigate(`/admin/jobs/${item.tripId}`)}
                style={item.tripId ? { cursor: "pointer" } : undefined}
              >
                <div className={`alert-bar ${item.tone}`} />
                <div>
                  <strong>{item.title}</strong>
                  <p>{item.description}</p>
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="content-card">
          <div className="section-head">
            <div>
              <span className="card-label">Resolution queue</span>
              <h2>Next actions for the desk</h2>
            </div>
            <StatusPill tone="warning">Pending closure</StatusPill>
          </div>

          <div className="data-rows">
            {(data?.resolutions || []).map((item) => (
              <div className="data-row" key={item.reference}>
                <div>
                  <strong>{item.reference}</strong>
                  <p>{item.owner}</p>
                </div>
                <div>
                  <span>{item.action}</span>
                  <p>{item.note}</p>
                </div>
                <StatusPill tone={item.tone}>{item.status}</StatusPill>
              </div>
            ))}
          </div>
        </article>
      </section>
    </AdminWorkspaceLayout>
  );
}
