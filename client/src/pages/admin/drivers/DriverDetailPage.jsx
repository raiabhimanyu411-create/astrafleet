import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { addDocument, deleteDocument, getDriverById, updateDocument } from "../../../api/driverApi";
import { StateNotice } from "../../../components/StateNotice";
import { StatusPill } from "../../../components/StatusPill";
import { AdminWorkspaceLayout } from "../AdminWorkspaceLayout";

function DetailField({ label, value, tone }) {
  return (
    <div style={{ padding: "11px 14px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8 }}>
      <span style={{ display: "block", fontSize: "0.7rem", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>{label}</span>
      {tone ? (
        <StatusPill tone={tone}>{value || "—"}</StatusPill>
      ) : (
        <strong style={{ fontSize: "0.88rem", fontWeight: 600, color: "#0f172a" }}>{value || "—"}</strong>
      )}
    </div>
  );
}

function ExpiryField({ label, expiry, tone, daysLeft }) {
  const suffix = daysLeft !== null
    ? daysLeft < 0
      ? ` (expired ${Math.abs(daysLeft)}d ago)`
      : ` (${daysLeft}d left)`
    : "";
  return (
    <div style={{ padding: "11px 14px", background: "#f8fafc", border: `1px solid ${tone === "danger" ? "#fecaca" : tone === "warning" ? "#fde68a" : "#e2e8f0"}`, borderRadius: 8 }}>
      <span style={{ display: "block", fontSize: "0.7rem", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>{label}</span>
      <strong style={{ fontSize: "0.88rem", fontWeight: 600, color: tone === "danger" ? "#b91c1c" : tone === "warning" ? "#b45309" : "#0f172a" }}>
        {expiry}{suffix}
      </strong>
    </div>
  );
}

const DOC_TYPES = [
  "Driving Licence", "Medical Certificate", "CPC Card", "Tachograph Card",
  "Passport", "Right to Work", "Criminal Record Check", "Other"
];

const emptyDoc = { document_type: "Driving Licence", document_number: "", expiry_date: "", verification_status: "pending" };

export function DriverDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData]         = useState(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState("");
  const [showDocForm, setShowDocForm] = useState(false);
  const [docForm, setDocForm]   = useState(emptyDoc);
  const [editDocId, setEditDocId] = useState(null);
  const [savingDoc, setSavingDoc] = useState(false);

  function load() {
    getDriverById(id)
      .then(r => setData(r.data))
      .catch(() => setError("Could not load driver details."))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [id]);

  function openAddDoc() {
    setDocForm(emptyDoc);
    setEditDocId(null);
    setShowDocForm(true);
  }

  function openEditDoc(doc) {
    setDocForm({ document_type: doc.type, document_number: doc.number, expiry_date: "", verification_status: doc.status });
    setEditDocId(doc.id);
    setShowDocForm(true);
  }

  async function handleSaveDoc(e) {
    e.preventDefault();
    setSavingDoc(true);
    try {
      if (editDocId) {
        await updateDocument(id, editDocId, docForm);
      } else {
        await addDocument(id, docForm);
      }
      setShowDocForm(false);
      setLoading(true);
      load();
    } catch {
      alert("Could not save document. Please try again.");
    } finally {
      setSavingDoc(false);
    }
  }

  async function handleDeleteDoc(docId) {
    if (!window.confirm("Remove this document?")) return;
    try {
      await deleteDocument(id, docId);
      load();
    } catch {
      alert("Could not remove document.");
    }
  }

  return (
    <AdminWorkspaceLayout
      badge="Driver management"
      title={data?.fullName || "Driver profile"}
      description="Full driver profile with UK compliance, documents, and trip history."
      highlights={[]}
    >
      <div style={{ maxWidth: 980 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
          <button className="af-back-btn" type="button" onClick={() => navigate("/admin/drivers")}>
            ← Back to drivers
          </button>
          {data && (
            <button className="af-submit-btn" type="button" onClick={() => navigate(`/admin/drivers/${id}/edit`)}>
              Edit driver
            </button>
          )}
        </div>

        <StateNotice loading={loading} error={error} />

        {data && (
          <>
            {/* Header card */}
            <div className="content-card" style={{ marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 18, flexWrap: "wrap" }}>
                <div>
                  <span className="card-label">Driver profile</span>
                  <h2 style={{ margin: "6px 0 4px", fontSize: "1.3rem" }}>{data.fullName}</h2>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
                    <span style={{ fontFamily: "monospace", fontSize: "0.82rem", background: "#eff6ff", color: "#2563eb", padding: "3px 10px", borderRadius: 999, fontWeight: 700 }}>
                      {data.employeeCode}
                    </span>
                    <StatusPill tone={data.complianceTone}>{data.complianceStatus} compliance</StatusPill>
                    <StatusPill tone={data.shiftStatus === "ready" ? "success" : data.shiftStatus === "on_trip" ? "warning" : "neutral"}>
                      {data.shiftStatus?.replace("_", " ")}
                    </StatusPill>
                  </div>
                </div>
                <span style={{ fontSize: "0.78rem", color: "#94a3b8" }}>Since {data.since}</span>
              </div>

              <div className="detail-grid">
                <DetailField label="Phone"         value={data.phone} />
                <DetailField label="Email"         value={data.email} />
                <DetailField label="Home depot"    value={data.homeDepot} />
                <DetailField label="Postcode"      value={data.postcode} />
                <DetailField label="NI number"     value={data.nationalInsurance} />
                <DetailField label="Date of birth" value={data.dateOfBirth} />
                <div className="detail-wide"><DetailField label="Address" value={data.address} /></div>
              </div>
            </div>

            {/* UK Compliance */}
            <div className="content-card" style={{ marginBottom: 14 }}>
              <div className="section-head">
                <div>
                  <span className="card-label">UK compliance</span>
                  <h2 style={{ margin: "4px 0 0", fontSize: "1rem" }}>Licence, medical, CPC & tacho</h2>
                </div>
                <StatusPill tone={data.complianceTone}>{data.complianceStatus}</StatusPill>
              </div>
              <div className="detail-grid">
                <DetailField label="Licence number" value={data.licence?.number} />
                <ExpiryField label="Licence expiry" expiry={data.licence?.expiry} tone={data.licence?.expiryTone} daysLeft={data.licence?.daysLeft} />
                <ExpiryField label="Medical expiry" expiry={data.medical?.expiry} tone={data.medical?.expiryTone} daysLeft={data.medical?.daysLeft} />
                <DetailField label="CPC number" value={data.cpc?.number} />
                <ExpiryField label="CPC expiry" expiry={data.cpc?.expiry} tone={data.cpc?.expiryTone} daysLeft={data.cpc?.daysLeft} />
                <DetailField label="Tacho card number" value={data.tacho?.cardNumber} />
                <ExpiryField label="Tacho card expiry" expiry={data.tacho?.expiry} tone={data.tacho?.expiryTone} daysLeft={data.tacho?.daysLeft} />
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 14, marginBottom: 14 }}>
              {/* Emergency contact */}
              <div className="content-card">
                <div className="section-head">
                  <div>
                    <span className="card-label">Emergency contact</span>
                    <h2 style={{ margin: "4px 0 0", fontSize: "1rem" }}>Next of kin</h2>
                  </div>
                </div>
                <div className="detail-grid">
                  <DetailField label="Name"  value={data.emergency?.name} />
                  <DetailField label="Phone" value={data.emergency?.phone} />
                </div>
              </div>

              {/* Bank */}
              <div className="content-card">
                <div className="section-head">
                  <div>
                    <span className="card-label">Payroll</span>
                    <h2 style={{ margin: "4px 0 0", fontSize: "1rem" }}>Bank details</h2>
                  </div>
                </div>
                <div className="detail-grid">
                  <DetailField label="Sort code"      value={data.bank?.sortCode} />
                  <DetailField label="Account number" value={data.bank?.accountNumber} />
                </div>
              </div>
            </div>

            {/* Documents */}
            <div className="content-card" style={{ marginBottom: 14 }}>
              <div className="section-head">
                <div>
                  <span className="card-label">Documents</span>
                  <h2 style={{ margin: "4px 0 0", fontSize: "1rem" }}>Compliance documents & expiry tracking</h2>
                </div>
                <button className="header-action-button" type="button" onClick={openAddDoc}>
                  + Add document
                </button>
              </div>

              {/* Document form */}
              {showDocForm && (
                <form onSubmit={handleSaveDoc} style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: 16, marginBottom: 14 }}>
                  <p style={{ margin: "0 0 12px", fontWeight: 700, fontSize: "0.86rem", color: "#334155" }}>
                    {editDocId ? "Edit document" : "Add new document"}
                  </p>
                  <div className="af-grid-3" style={{ gap: 12 }}>
                    <div className="af-field">
                      <label className="af-label">Document type</label>
                      <select className="af-select" value={docForm.document_type} onChange={e => setDocForm(p => ({ ...p, document_type: e.target.value }))}>
                        {DOC_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                    <div className="af-field">
                      <label className="af-label">Document number</label>
                      <input className="af-input" type="text" placeholder="Reference or number" value={docForm.document_number} onChange={e => setDocForm(p => ({ ...p, document_number: e.target.value }))} />
                    </div>
                    <div className="af-field">
                      <label className="af-label">Expiry date <span style={{ color: "#dc2626" }}>*</span></label>
                      <input className="af-input" type="date" value={docForm.expiry_date} onChange={e => setDocForm(p => ({ ...p, expiry_date: e.target.value }))} required />
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                    <button type="submit" className="af-submit-btn" style={{ height: 34, padding: "0 18px", fontSize: "0.84rem" }} disabled={savingDoc}>
                      {savingDoc ? "Saving..." : "Save document"}
                    </button>
                    <button type="button" className="header-action-button" onClick={() => setShowDocForm(false)}>Cancel</button>
                  </div>
                </form>
              )}

              {data.documents.length === 0 && !showDocForm ? (
                <p style={{ color: "#94a3b8", fontSize: "0.86rem", margin: 0 }}>No documents added yet. Click "+ Add document" to start.</p>
              ) : (
                <div className="data-rows">
                  {data.documents.map(doc => (
                    <div className="data-row" key={doc.id}>
                      <div>
                        <strong>{doc.type}</strong>
                        <p>{doc.number || "No number"}</p>
                      </div>
                      <div>
                        <span style={{ color: doc.expiryTone === "danger" ? "#b91c1c" : doc.expiryTone === "warning" ? "#b45309" : "#0f172a" }}>
                          {doc.expiry}
                        </span>
                        <p>{doc.daysLeft !== null ? (doc.daysLeft < 0 ? `Expired ${Math.abs(doc.daysLeft)}d ago` : `${doc.daysLeft}d remaining`) : "—"}</p>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <StatusPill tone={doc.statusTone}>{doc.status}</StatusPill>
                        <button className="header-action-button" style={{ height: 26, padding: "0 8px", fontSize: "0.74rem" }} type="button" onClick={() => openEditDoc(doc)}>Edit</button>
                        <button className="header-action-button danger" style={{ height: 26, padding: "0 8px", fontSize: "0.74rem" }} type="button" onClick={() => handleDeleteDoc(doc.id)}>Remove</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Trip history */}
            <div className="content-card" style={{ marginBottom: 14 }}>
              <div className="section-head">
                <div>
                  <span className="card-label">Trip history</span>
                  <h2 style={{ margin: "4px 0 0", fontSize: "1rem" }}>Jobs assigned to this driver</h2>
                </div>
                <StatusPill tone="neutral">{data.trips.length} trips</StatusPill>
              </div>
              {data.trips.length === 0 ? (
                <p style={{ color: "#94a3b8", fontSize: "0.86rem", margin: 0 }}>No trips assigned yet.</p>
              ) : (
                <div className="data-rows">
                  {data.trips.map(t => (
                    <div className="data-row" key={t.id} style={{ cursor: "pointer" }} onClick={() => navigate(`/admin/jobs/${t.id}`)}>
                      <div>
                        <strong>{t.code}</strong>
                        <p>{t.lane}</p>
                      </div>
                      <div>
                        <span>{t.vehicle}</span>
                        <p>{t.departure}</p>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                        <StatusPill tone={t.statusTone}>{t.status}</StatusPill>
                        <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "#334155" }}>{t.freight}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Shift history */}
            {data.shifts.length > 0 && (
              <div className="content-card">
                <div className="section-head">
                  <div>
                    <span className="card-label">Shift records</span>
                    <h2 style={{ margin: "4px 0 0", fontSize: "1rem" }}>Recent shifts</h2>
                  </div>
                  <StatusPill tone="neutral">{data.shifts.length} records</StatusPill>
                </div>
                <div className="data-rows">
                  {data.shifts.map(s => (
                    <div className="data-row" key={s.id}>
                      <div>
                        <strong>Shift start</strong>
                        <p>{s.start}</p>
                      </div>
                      <div>
                        <span>{s.totalHours}</span>
                        <p>End: {s.end}</p>
                      </div>
                      <StatusPill tone={s.status === "completed" ? "success" : s.status === "active" ? "warning" : "neutral"}>
                        {s.status}
                      </StatusPill>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </AdminWorkspaceLayout>
  );
}
