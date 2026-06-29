import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getDriverById } from "../../../api/driverApi";
import { StateNotice } from "../../../components/StateNotice";
import { AdminWorkspaceLayout } from "../AdminWorkspaceLayout";

function DetailField({ label, value }) {
  return (
    <div style={{ padding: "11px 14px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8 }}>
      <span style={{ display: "block", fontSize: "0.7rem", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>{label}</span>
      <strong style={{ fontSize: "0.88rem", fontWeight: 600, color: "#0f172a" }}>{value || "—"}</strong>
    </div>
  );
}

export function DriverDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");

  useEffect(() => {
    getDriverById(id)
      .then(r => setData(r.data))
      .catch(() => setError("Could not load driver details."))
      .finally(() => setLoading(false));
  }, [id]);

  return (
    <AdminWorkspaceLayout
      badge="Driver management"
      title={data?.fullName || "Driver profile"}
      description="Basic driver profile and login contact details."
      highlights={[]}
    >
      <div style={{ maxWidth: 980 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
          <button className="af-back-btn" type="button" onClick={() => navigate("/admin/drivers")}>
            ← Back To Drivers
          </button>
          {data && (
            <button className="af-submit-btn" type="button" onClick={() => navigate(`/admin/drivers/${id}/edit`)}>
              Edit Driver
            </button>
          )}
        </div>

        <StateNotice loading={loading} error={error} />

        {data && (
          <div className="content-card" style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 18, flexWrap: "wrap" }}>
              <div>
                <span className="card-label">Driver Profile</span>
                <h2 style={{ margin: "6px 0 4px", fontSize: "1.3rem" }}>{data.fullName}</h2>
              </div>
              <span style={{ fontSize: "0.78rem", color: "#94a3b8" }}>Since {data.since}</span>
            </div>

            <div className="detail-grid">
              <DetailField label="Name" value={data.fullName} />
              <DetailField label="Contact Number" value={data.phone} />
              <DetailField label="Email" value={data.email} />
            </div>
          </div>
        )}
      </div>
    </AdminWorkspaceLayout>
  );
}
