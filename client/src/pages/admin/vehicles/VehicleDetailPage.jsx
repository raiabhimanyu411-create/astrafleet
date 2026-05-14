import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  addDefect, addInspection, addMaintenance, addVehicleDocument,
  deleteVehicleDocument, deleteMaintenance,
  getVehicleById, updateDefectStatus, updateVehicleDocument, updateVehicleStatus
} from "../../../api/vehicleApi";
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

const DOC_TYPES = ["MOT Certificate", "Insurance Certificate", "Road Tax (VED)", "Operator Licence", "Roadworthiness Test", "FORS Certificate", "Other"];
const INSPECTION_TYPES = ["Routine", "Pre-trip", "Post-trip", "Annual", "DVSA", "Other"];
const DEFECT_TYPES = ["Tyre", "Brakes", "Lights", "Engine", "Bodywork", "Windscreen", "Mirrors", "Load Security", "Exhaust", "Other"];
const SEVERITY_OPTS = ["low", "medium", "high", "critical"];
const emptyDoc   = { document_type: "MOT Certificate", document_number: "", expiry_date: "" };
const emptyMaint = { service_date: "", service_type: "", description: "", cost_gbp: "", mileage: "", next_due_date: "", garage_name: "" };
const emptyInsp  = { inspection_date: "", inspection_type: "Routine", inspector_name: "", result: "pass", notes: "", next_due: "" };
const emptyDefect = { defect_type: "Tyre", description: "", severity: "medium", reported_by: "" };

export function VehicleDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");

  const [showDocForm,    setShowDocForm]    = useState(false);
  const [docForm,        setDocForm]        = useState(emptyDoc);
  const [editDocId,      setEditDocId]      = useState(null);
  const [savingDoc,      setSavingDoc]      = useState(false);

  const [showMaintForm,  setShowMaintForm]  = useState(false);
  const [maintForm,      setMaintForm]      = useState(emptyMaint);
  const [savingMaint,    setSavingMaint]    = useState(false);

  const [showInspForm,   setShowInspForm]   = useState(false);
  const [inspForm,       setInspForm]       = useState(emptyInsp);
  const [savingInsp,     setSavingInsp]     = useState(false);

  const [showDefectForm, setShowDefectForm] = useState(false);
  const [defectForm,     setDefectForm]     = useState(emptyDefect);
  const [savingDefect,   setSavingDefect]   = useState(false);

  function load() {
    setLoading(true);
    getVehicleById(id)
      .then(r => setData(r.data))
      .catch(() => setError("Could not load vehicle details."))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [id]);

  async function handleStatusChange(newStatus) {
    try {
      await updateVehicleStatus(id, { status: newStatus });
      load();
    } catch {
      alert("Could not update status.");
    }
  }

  async function handleSaveDoc(e) {
    e.preventDefault();
    setSavingDoc(true);
    try {
      if (editDocId) {
        await updateVehicleDocument(id, editDocId, docForm);
      } else {
        await addVehicleDocument(id, docForm);
      }
      setShowDocForm(false);
      load();
    } catch {
      alert("Could not save document.");
    } finally {
      setSavingDoc(false);
    }
  }

  async function handleDeleteDoc(docId) {
    if (!window.confirm("Remove this document?")) return;
    try {
      await deleteVehicleDocument(id, docId);
      load();
    } catch {
      alert("Could not remove document.");
    }
  }

  async function handleSaveMaint(e) {
    e.preventDefault();
    setSavingMaint(true);
    try {
      await addMaintenance(id, maintForm);
      setShowMaintForm(false);
      setMaintForm(emptyMaint);
      load();
    } catch {
      alert("Could not save maintenance record.");
    } finally {
      setSavingMaint(false);
    }
  }

  async function handleDeleteMaint(recId) {
    if (!window.confirm("Remove this maintenance record?")) return;
    try {
      await deleteMaintenance(id, recId);
      load();
    } catch {
      alert("Could not remove record.");
    }
  }

  async function handleSaveInsp(e) {
    e.preventDefault();
    setSavingInsp(true);
    try {
      await addInspection(id, inspForm);
      setShowInspForm(false);
      setInspForm(emptyInsp);
      load();
    } catch {
      alert("Could not save inspection.");
    } finally {
      setSavingInsp(false);
    }
  }

  async function handleSaveDefect(e) {
    e.preventDefault();
    setSavingDefect(true);
    try {
      await addDefect(id, defectForm);
      setShowDefectForm(false);
      setDefectForm(emptyDefect);
      load();
    } catch {
      alert("Could not report defect.");
    } finally {
      setSavingDefect(false);
    }
  }

  async function handleDefectStatus(defId, status) {
    try {
      await updateDefectStatus(id, defId, { status });
      load();
    } catch {
      alert("Could not update defect.");
    }
  }

  const formStyle = { background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: 16, marginBottom: 14 };
  const formTitle = { margin: "0 0 12px", fontWeight: 700, fontSize: "0.86rem", color: "#334155" };

  return (
    <AdminWorkspaceLayout
      badge="Fleet management"
      title={data?.registrationNumber || "Vehicle profile"}
      description="Full vehicle profile with UK compliance, documents, maintenance history, and inspections."
      highlights={[]}
    >
      <div style={{ maxWidth: 980 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
          <button className="af-back-btn" type="button" onClick={() => navigate("/admin/vehicles")}>
            ← Back to vehicles
          </button>
          {data && (
            <button className="af-submit-btn" type="button" onClick={() => navigate(`/admin/vehicles/${id}/edit`)}>
              Edit vehicle
            </button>
          )}
        </div>

        <StateNotice loading={loading} error={error} />

        {data && (
          <>
            {/* Header */}
            <div className="content-card" style={{ marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 18, flexWrap: "wrap" }}>
                <div>
                  <span className="card-label">Vehicle profile</span>
                  <h2 style={{ margin: "6px 0 4px", fontSize: "1.3rem" }}>{data.registrationNumber}</h2>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
                    <span style={{ fontFamily: "monospace", fontSize: "0.82rem", background: "#eff6ff", color: "#2563eb", padding: "3px 10px", borderRadius: 999, fontWeight: 700 }}>
                      {data.fleetCode}
                    </span>
                    <StatusPill tone={data.statusTone}>{data.status.replace("_", " ")}</StatusPill>
                    <StatusPill tone={data.complianceTone}>
                      {data.complianceTone === "danger" ? "Compliance issue" : data.complianceTone === "warning" ? "Expiry soon" : "Compliance OK"}
                    </StatusPill>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-start" }}>
                  {["available", "maintenance", "stopped"].map(s => (
                    data.status !== s && (
                      <button key={s} className="header-action-button" type="button" onClick={() => handleStatusChange(s)}
                        style={{ height: 30, padding: "0 12px", fontSize: "0.78rem" }}>
                        Set {s.replace("_", " ")}
                      </button>
                    )
                  ))}
                </div>
              </div>
              <div className="detail-grid">
                <DetailField label="Model"             value={data.modelName} />
                <DetailField label="Type"              value={data.truckType} />
                <DetailField label="Fuel type"         value={data.fuelType} />
                <DetailField label="Capacity"          value={data.capacityTonnes ? `${data.capacityTonnes} tonnes` : "—"} />
                <DetailField label="Year"              value={data.yearOfManufacture} />
                <DetailField label="Colour"            value={data.colour} />
                <div className="detail-wide"><DetailField label="Current location" value={data.currentLocation} /></div>
              </div>
            </div>

            {/* UK Compliance */}
            <div className="content-card" style={{ marginBottom: 14 }}>
              <div className="section-head">
                <div>
                  <span className="card-label">UK compliance</span>
                  <h2 style={{ margin: "4px 0 0", fontSize: "1rem" }}>MOT, insurance & road tax</h2>
                </div>
                <StatusPill tone={data.complianceTone}>
                  {data.complianceTone === "danger" ? "Action required" : data.complianceTone === "warning" ? "Expiring soon" : "All current"}
                </StatusPill>
              </div>
              <div className="detail-grid">
                <ExpiryField label="MOT expiry"       expiry={data.mot.expiry}       tone={data.mot.tone}       daysLeft={data.mot.daysLeft} />
                <ExpiryField label="Insurance expiry" expiry={data.insurance.expiry} tone={data.insurance.tone} daysLeft={data.insurance.daysLeft} />
                <ExpiryField label="Road tax expiry"  expiry={data.roadTax.expiry}   tone={data.roadTax.tone}   daysLeft={data.roadTax.daysLeft} />
                <ExpiryField label="Next service due" expiry={data.nextServiceDue}   tone={data.nextServiceTone} daysLeft={null} />
              </div>
            </div>

            {/* Documents */}
            <div className="content-card" style={{ marginBottom: 14 }}>
              <div className="section-head">
                <div>
                  <span className="card-label">Documents</span>
                  <h2 style={{ margin: "4px 0 0", fontSize: "1rem" }}>Compliance documents & certificates</h2>
                </div>
                <button className="header-action-button" type="button" onClick={() => { setDocForm(emptyDoc); setEditDocId(null); setShowDocForm(true); }}>
                  + Add document
                </button>
              </div>

              {showDocForm && (
                <form onSubmit={handleSaveDoc} style={formStyle}>
                  <p style={formTitle}>{editDocId ? "Edit document" : "Add new document"}</p>
                  <div className="af-grid-3" style={{ gap: 12 }}>
                    <div className="af-field">
                      <label className="af-label">Document type</label>
                      <select className="af-select" value={docForm.document_type} onChange={e => setDocForm(p => ({ ...p, document_type: e.target.value }))}>
                        {DOC_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                    <div className="af-field">
                      <label className="af-label">Document number</label>
                      <input className="af-input" type="text" placeholder="Reference or certificate number" value={docForm.document_number} onChange={e => setDocForm(p => ({ ...p, document_number: e.target.value }))} />
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
                <p style={{ color: "#94a3b8", fontSize: "0.86rem", margin: 0 }}>No documents added yet.</p>
              ) : (
                <div className="data-rows">
                  {data.documents.map(doc => (
                    <div className="data-row" key={doc.id}>
                      <div>
                        <strong>{doc.type}</strong>
                        <p>{doc.number || "No number"}</p>
                      </div>
                      <div>
                        <span style={{ color: doc.expiryTone === "danger" ? "#b91c1c" : doc.expiryTone === "warning" ? "#b45309" : "#0f172a" }}>{doc.expiry}</span>
                        <p>{doc.daysLeft !== null ? (doc.daysLeft < 0 ? `Expired ${Math.abs(doc.daysLeft)}d ago` : `${doc.daysLeft}d remaining`) : "—"}</p>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <StatusPill tone={doc.statusTone}>{doc.status}</StatusPill>
                        <button className="header-action-button" style={{ height: 26, padding: "0 8px", fontSize: "0.74rem" }} type="button"
                          onClick={() => { setDocForm({ document_type: doc.type, document_number: doc.number, expiry_date: doc.expiryRaw || "" }); setEditDocId(doc.id); setShowDocForm(true); }}>Edit</button>
                        <button className="header-action-button danger" style={{ height: 26, padding: "0 8px", fontSize: "0.74rem" }} type="button" onClick={() => handleDeleteDoc(doc.id)}>Remove</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Maintenance */}
            <div className="content-card" style={{ marginBottom: 14 }}>
              <div className="section-head">
                <div>
                  <span className="card-label">Maintenance</span>
                  <h2 style={{ margin: "4px 0 0", fontSize: "1rem" }}>Service & repair history</h2>
                </div>
                <button className="header-action-button" type="button" onClick={() => setShowMaintForm(v => !v)}>
                  {showMaintForm ? "Cancel" : "+ Log service"}
                </button>
              </div>

              {showMaintForm && (
                <form onSubmit={handleSaveMaint} style={formStyle}>
                  <p style={formTitle}>Log maintenance record</p>
                  <div className="af-grid-3" style={{ gap: 12 }}>
                    <div className="af-field">
                      <label className="af-label">Service date <span style={{ color: "#dc2626" }}>*</span></label>
                      <input className="af-input" type="date" value={maintForm.service_date} onChange={e => setMaintForm(p => ({ ...p, service_date: e.target.value }))} required />
                    </div>
                    <div className="af-field">
                      <label className="af-label">Service type <span style={{ color: "#dc2626" }}>*</span></label>
                      <input className="af-input" type="text" placeholder="e.g. Full service, Oil change" value={maintForm.service_type} onChange={e => setMaintForm(p => ({ ...p, service_type: e.target.value }))} required />
                    </div>
                    <div className="af-field">
                      <label className="af-label">Garage / workshop</label>
                      <input className="af-input" type="text" placeholder="e.g. City Truck Centre" value={maintForm.garage_name} onChange={e => setMaintForm(p => ({ ...p, garage_name: e.target.value }))} />
                    </div>
                    <div className="af-field">
                      <label className="af-label">Cost (£)</label>
                      <input className="af-input" type="number" placeholder="0.00" step="0.01" min="0" value={maintForm.cost_gbp} onChange={e => setMaintForm(p => ({ ...p, cost_gbp: e.target.value }))} />
                    </div>
                    <div className="af-field">
                      <label className="af-label">Mileage at service</label>
                      <input className="af-input" type="number" placeholder="e.g. 85000" value={maintForm.mileage} onChange={e => setMaintForm(p => ({ ...p, mileage: e.target.value }))} />
                    </div>
                    <div className="af-field">
                      <label className="af-label">Next service due</label>
                      <input className="af-input" type="date" value={maintForm.next_due_date} onChange={e => setMaintForm(p => ({ ...p, next_due_date: e.target.value }))} />
                    </div>
                  </div>
                  <div className="af-field" style={{ marginTop: 12 }}>
                    <label className="af-label">Description / notes</label>
                    <textarea className="af-input" style={{ minHeight: 60, resize: "vertical" }} placeholder="Work carried out..." value={maintForm.description} onChange={e => setMaintForm(p => ({ ...p, description: e.target.value }))} />
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                    <button type="submit" className="af-submit-btn" style={{ height: 34, padding: "0 18px", fontSize: "0.84rem" }} disabled={savingMaint}>
                      {savingMaint ? "Saving..." : "Save record"}
                    </button>
                  </div>
                </form>
              )}

              {data.maintenance.length === 0 && !showMaintForm ? (
                <p style={{ color: "#94a3b8", fontSize: "0.86rem", margin: 0 }}>No maintenance records yet.</p>
              ) : (
                <div className="data-rows">
                  {data.maintenance.map(m => (
                    <div className="data-row" key={m.id}>
                      <div>
                        <strong>{m.serviceType}</strong>
                        <p>{m.serviceDate} · {m.garageName}</p>
                      </div>
                      <div>
                        <span>{m.costGbp}</span>
                        <p>Mileage: {m.mileage}</p>
                      </div>
                      <div>
                        <span style={{ fontSize: "0.8rem", color: "#64748b" }}>Next due: {m.nextDue}</span>
                        <button className="header-action-button danger" style={{ marginTop: 4, height: 24, padding: "0 8px", fontSize: "0.72rem" }} type="button" onClick={() => handleDeleteMaint(m.id)}>Remove</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Inspections */}
            <div className="content-card" style={{ marginBottom: 14 }}>
              <div className="section-head">
                <div>
                  <span className="card-label">Inspections</span>
                  <h2 style={{ margin: "4px 0 0", fontSize: "1rem" }}>Vehicle inspection log</h2>
                </div>
                <button className="header-action-button" type="button" onClick={() => setShowInspForm(v => !v)}>
                  {showInspForm ? "Cancel" : "+ Log inspection"}
                </button>
              </div>

              {showInspForm && (
                <form onSubmit={handleSaveInsp} style={formStyle}>
                  <p style={formTitle}>Log inspection</p>
                  <div className="af-grid-3" style={{ gap: 12 }}>
                    <div className="af-field">
                      <label className="af-label">Inspection date <span style={{ color: "#dc2626" }}>*</span></label>
                      <input className="af-input" type="date" value={inspForm.inspection_date} onChange={e => setInspForm(p => ({ ...p, inspection_date: e.target.value }))} required />
                    </div>
                    <div className="af-field">
                      <label className="af-label">Type</label>
                      <select className="af-select" value={inspForm.inspection_type} onChange={e => setInspForm(p => ({ ...p, inspection_type: e.target.value }))}>
                        {INSPECTION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                    <div className="af-field">
                      <label className="af-label">Result <span style={{ color: "#dc2626" }}>*</span></label>
                      <select className="af-select" value={inspForm.result} onChange={e => setInspForm(p => ({ ...p, result: e.target.value }))}>
                        <option value="pass">Pass</option>
                        <option value="advisory">Advisory</option>
                        <option value="fail">Fail</option>
                      </select>
                    </div>
                    <div className="af-field">
                      <label className="af-label">Inspector name</label>
                      <input className="af-input" type="text" placeholder="e.g. John Smith" value={inspForm.inspector_name} onChange={e => setInspForm(p => ({ ...p, inspector_name: e.target.value }))} />
                    </div>
                    <div className="af-field">
                      <label className="af-label">Next inspection due</label>
                      <input className="af-input" type="date" value={inspForm.next_due} onChange={e => setInspForm(p => ({ ...p, next_due: e.target.value }))} />
                    </div>
                  </div>
                  <div className="af-field" style={{ marginTop: 12 }}>
                    <label className="af-label">Notes</label>
                    <textarea className="af-input" style={{ minHeight: 60, resize: "vertical" }} placeholder="Inspection notes..." value={inspForm.notes} onChange={e => setInspForm(p => ({ ...p, notes: e.target.value }))} />
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                    <button type="submit" className="af-submit-btn" style={{ height: 34, padding: "0 18px", fontSize: "0.84rem" }} disabled={savingInsp}>
                      {savingInsp ? "Saving..." : "Save inspection"}
                    </button>
                  </div>
                </form>
              )}

              {data.inspections.length === 0 && !showInspForm ? (
                <p style={{ color: "#94a3b8", fontSize: "0.86rem", margin: 0 }}>No inspections logged yet.</p>
              ) : (
                <div className="data-rows">
                  {data.inspections.map(i => (
                    <div className="data-row" key={i.id}>
                      <div>
                        <strong>{i.inspectionType}</strong>
                        <p>{i.inspectionDate} · {i.inspectorName}</p>
                      </div>
                      <div>
                        <StatusPill tone={i.resultTone}>{i.result}</StatusPill>
                        <p style={{ marginTop: 4, fontSize: "0.79rem" }}>{i.notes !== "—" ? i.notes : ""}</p>
                      </div>
                      <div>
                        <span style={{ fontSize: "0.8rem", color: "#64748b" }}>Next due: {i.nextDue}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Defect Reports */}
            <div className="content-card" style={{ marginBottom: 14 }}>
              <div className="section-head">
                <div>
                  <span className="card-label">Defect reports</span>
                  <h2 style={{ margin: "4px 0 0", fontSize: "1rem" }}>Reported faults & resolutions</h2>
                </div>
                <button className="header-action-button" type="button" onClick={() => setShowDefectForm(v => !v)}>
                  {showDefectForm ? "Cancel" : "+ Report defect"}
                </button>
              </div>

              {showDefectForm && (
                <form onSubmit={handleSaveDefect} style={formStyle}>
                  <p style={formTitle}>Report a defect</p>
                  <div className="af-grid-3" style={{ gap: 12 }}>
                    <div className="af-field">
                      <label className="af-label">Defect type <span style={{ color: "#dc2626" }}>*</span></label>
                      <select className="af-select" value={defectForm.defect_type} onChange={e => setDefectForm(p => ({ ...p, defect_type: e.target.value }))}>
                        {DEFECT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                    <div className="af-field">
                      <label className="af-label">Severity</label>
                      <select className="af-select" value={defectForm.severity} onChange={e => setDefectForm(p => ({ ...p, severity: e.target.value }))}>
                        {SEVERITY_OPTS.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
                      </select>
                    </div>
                    <div className="af-field">
                      <label className="af-label">Reported by</label>
                      <input className="af-input" type="text" placeholder="e.g. Driver name" value={defectForm.reported_by} onChange={e => setDefectForm(p => ({ ...p, reported_by: e.target.value }))} />
                    </div>
                  </div>
                  <div className="af-field" style={{ marginTop: 12 }}>
                    <label className="af-label">Description</label>
                    <textarea className="af-input" style={{ minHeight: 60, resize: "vertical" }} placeholder="Describe the defect..." value={defectForm.description} onChange={e => setDefectForm(p => ({ ...p, description: e.target.value }))} />
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                    <button type="submit" className="af-submit-btn" style={{ height: 34, padding: "0 18px", fontSize: "0.84rem" }} disabled={savingDefect}>
                      {savingDefect ? "Reporting..." : "Submit defect"}
                    </button>
                  </div>
                </form>
              )}

              {data.defects.length === 0 && !showDefectForm ? (
                <p style={{ color: "#94a3b8", fontSize: "0.86rem", margin: 0 }}>No defects reported.</p>
              ) : (
                <div className="data-rows">
                  {data.defects.map(d => (
                    <div className="data-row" key={d.id}>
                      <div>
                        <strong>{d.defectType}</strong>
                        <p>{d.reportedAt} · {d.reportedBy}</p>
                      </div>
                      <div>
                        <StatusPill tone={d.severityTone}>{d.severity}</StatusPill>
                        <p style={{ marginTop: 4, fontSize: "0.79rem" }}>{d.description !== "—" ? d.description : ""}</p>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                        <StatusPill tone={d.statusTone}>{d.status.replace("_", " ")}</StatusPill>
                        {d.status !== "resolved" && (
                          <div style={{ display: "flex", gap: 5 }}>
                            {d.status === "open" && (
                              <button className="header-action-button" style={{ height: 24, padding: "0 7px", fontSize: "0.72rem" }} type="button" onClick={() => handleDefectStatus(d.id, "in_progress")}>
                                In progress
                              </button>
                            )}
                            <button className="header-action-button" style={{ height: 24, padding: "0 7px", fontSize: "0.72rem", background: "#dcfce7", color: "#15803d", border: "1px solid #bbf7d0" }} type="button" onClick={() => handleDefectStatus(d.id, "resolved")}>
                              Resolve
                            </button>
                          </div>
                        )}
                        {d.resolvedAt && <span style={{ fontSize: "0.76rem", color: "#64748b" }}>Resolved {d.resolvedAt}</span>}
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
                  <h2 style={{ margin: "4px 0 0", fontSize: "1rem" }}>Jobs assigned to this vehicle</h2>
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
                        <span>{t.driver}</span>
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
          </>
        )}
      </div>
    </AdminWorkspaceLayout>
  );
}
