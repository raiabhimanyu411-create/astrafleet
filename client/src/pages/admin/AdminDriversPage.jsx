import { StatCard } from "../../components/StatCard";
import { StateNotice } from "../../components/StateNotice";
import { StatusPill } from "../../components/StatusPill";
import { usePanelData } from "../../hooks/usePanelData";
import { AdminWorkspaceLayout } from "./AdminWorkspaceLayout";

export function AdminDriversPage() {
  const { data, error, loading } = usePanelData("/api/admin/drivers");

  return (
    <AdminWorkspaceLayout
      badge={data?.header?.badge || "Driver management"}
      title={data?.header?.title || "Driver onboarding and compliance"}
      description={
        data?.header?.description ||
        "Handle onboarding, document expiry, shift readiness, and trip allocation approvals in one place."
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
              <span className="card-label">Onboarding queue</span>
              <h2>Drivers waiting for release</h2>
            </div>
            <StatusPill tone="warning">Review lane</StatusPill>
          </div>

          <div className="data-rows">
            {(data?.onboarding || []).map((item) => (
              <div className="data-row" key={item.name}>
                <div>
                  <strong>{item.name}</strong>
                  <p>{item.identity}</p>
                </div>
                <div>
                  <span>{item.stage}</span>
                  <p>{item.note}</p>
                </div>
                <StatusPill tone={item.tone}>{item.status}</StatusPill>
              </div>
            ))}
          </div>
        </article>

        <article className="content-card">
          <div className="section-head">
            <div>
              <span className="card-label">Document expiry</span>
              <h2>Compliance watchlist</h2>
            </div>
            <StatusPill tone="danger">Expiry risk</StatusPill>
          </div>

          <div className="data-rows">
            {(data?.documents || []).map((item) => (
              <div className="data-row" key={`${item.name}-${item.document}`}>
                <div>
                  <strong>{item.name}</strong>
                  <p>{item.document}</p>
                </div>
                <div>
                  <span>{item.expiry}</span>
                  <p>{item.note}</p>
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
              <span className="card-label">Trip allocation approvals</span>
              <h2>Driver-to-trip assignments</h2>
            </div>
            <StatusPill tone="neutral">Allocation desk</StatusPill>
          </div>

          <div className="data-rows">
            {(data?.assignments || []).map((item) => (
              <div className="data-row" key={item.trip}>
                <div>
                  <strong>{item.trip}</strong>
                  <p>{item.driver}</p>
                </div>
                <div>
                  <span>{item.vehicle}</span>
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
