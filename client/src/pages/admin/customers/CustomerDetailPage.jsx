import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getCustomerById } from "../../../api/customerApi";
import { StateNotice } from "../../../components/StateNotice";
import { StatusPill } from "../../../components/StatusPill";
import { AdminWorkspaceLayout } from "../AdminWorkspaceLayout";

function DetailField({ label, value }) {
  return (
    <div style={{ padding: "12px 14px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8 }}>
      <span style={{ display: "block", fontSize: "0.72rem", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 5 }}>
        {label}
      </span>
      <strong style={{ fontSize: "0.9rem", fontWeight: 600, color: "#0f172a" }}>{value || "—"}</strong>
    </div>
  );
}

export function CustomerDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");

  useEffect(() => {
    getCustomerById(id)
      .then(r => setData(r.data))
      .catch(() => setError("Could not load customer details."))
      .finally(() => setLoading(false));
  }, [id]);

  return (
    <AdminWorkspaceLayout
      badge="Customer accounts"
      title={data?.companyName || "Customer detail"}
      description="Full customer profile, linked trips, and invoice history."
      highlights={[]}
    >
      <div className="af-page" style={{ maxWidth: 1000 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <button className="af-back-btn" type="button" onClick={() => navigate("/admin/customers")}>
            ← Back to customers
          </button>
          {data && (
            <button
              className="af-submit-btn"
              type="button"
              onClick={() => navigate(`/admin/customers/${id}/edit`)}
            >
              Edit customer
            </button>
          )}
        </div>

        <StateNotice loading={loading} error={error} />

        {data && (
          <>
            {/* Profile card */}
            <div className="af-section" style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 16 }}>
                <div>
                  <p className="af-section-title" style={{ margin: 0 }}>Company profile</p>
                  <h2 style={{ margin: "6px 0 4px", fontSize: "1.3rem" }}>{data.companyName}</h2>
                  <span style={{ fontSize: "0.8rem", color: "#64748b" }}>Customer since {data.since}</span>
                </div>
                <StatusPill tone={data.tone}>{data.status}</StatusPill>
              </div>
              <div className="detail-grid">
                <DetailField label="Contact name"    value={data.contactName} />
                <DetailField label="Email"           value={data.email} />
                <DetailField label="Phone"           value={data.phone} />
                <DetailField label="Postcode"        value={data.postcode} />
                <DetailField label="VAT number"      value={data.vatNumber} />
                <DetailField label="Payment terms"   value={`Net ${data.paymentTermsDays} days`} />
                <div className="detail-wide">
                  <DetailField label="Address" value={data.address} />
                </div>
              </div>
            </div>

            {/* Trips */}
            <div className="content-card" style={{ marginBottom: 16 }}>
              <div className="section-head">
                <div>
                  <span className="card-label">Trip history</span>
                  <h2>Jobs linked to this customer</h2>
                </div>
                <StatusPill tone="neutral">{data.trips.length} trips</StatusPill>
              </div>

              {data.trips.length === 0 ? (
                <p style={{ color: "#94a3b8", fontSize: "0.86rem", margin: 0 }}>No trips found for this customer.</p>
              ) : (
                <div className="data-rows">
                  {data.trips.map(t => (
                    <div
                      className="data-row"
                      key={t.id}
                      style={{ cursor: "pointer" }}
                      onClick={() => navigate(`/admin/jobs/${t.id}`)}
                    >
                      <div>
                        <strong>{t.code}</strong>
                        <p>{t.lane}</p>
                      </div>
                      <div>
                        <span>{t.driver}</span>
                        <p>Departure: {t.departure}</p>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                        <StatusPill tone={t.tone}>{t.status}</StatusPill>
                        <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "#334155" }}>{t.freight}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Invoices */}
            <div className="content-card">
              <div className="section-head">
                <div>
                  <span className="card-label">Invoice history</span>
                  <h2>Invoices raised for this customer</h2>
                </div>
                <StatusPill tone="neutral">{data.invoices.length} invoices</StatusPill>
              </div>

              {data.invoices.length === 0 ? (
                <p style={{ color: "#94a3b8", fontSize: "0.86rem", margin: 0 }}>No invoices found for this customer.</p>
              ) : (
                <div className="data-rows">
                  {data.invoices.map(inv => (
                    <div className="data-row" key={inv.id}>
                      <div>
                        <strong>{inv.invoiceNo}</strong>
                        <p>{inv.podVerified ? "POD verified" : "POD pending"}</p>
                      </div>
                      <div>
                        <span>{inv.amount}</span>
                        <p>Due: {inv.due}</p>
                      </div>
                      <StatusPill tone={inv.tone}>{inv.status}</StatusPill>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </AdminWorkspaceLayout>
  );
}
