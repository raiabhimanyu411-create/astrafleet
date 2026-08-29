import React, { useEffect, useMemo, useState } from "react";
import {
  createComplianceDailyCheck,
  createComplianceInspection,
  createComplianceMotTest,
  createComplianceProvider,
  createComplianceRecall,
  getMaintenanceAuditPack,
  getMaintenanceCompliance,
  getMaintenanceComplianceBackup,
  recordMissedComplianceInspection,
  repairComplianceInspectionItem,
  reviewComplianceInspection,
  updateComplianceFrequency,
  verifyComplianceRecall
} from "../../api/maintenanceApi";
import { getAuthSession } from "../../utils/authSession";
import { StateNotice } from "../../components/StateNotice";
import { StatusPill } from "../../components/StatusPill";
import "./MaintenanceCompliancePanel.css";

const UK_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit"
});

function todayUk() {
  return UK_DATE.format(new Date());
}

function readFile(file) {
  if (!file) return Promise.resolve("");
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read the selected file."));
    reader.readAsDataURL(file);
  });
}

function errorMessage(error, fallback) {
  const response = error?.response?.data;
  const details = Array.isArray(response?.errors) ? response.errors.join(" ") : response?.error;
  return [response?.message || fallback, details].filter(Boolean).join(" ");
}

function Field({ label, children, wide = false }) {
  return <label className={`compliance-field${wide ? " wide" : ""}`}><span>{label}</span>{children}</label>;
}

function Empty({ children }) {
  return <p className="compliance-empty">{children}</p>;
}

function resultTone(value) {
  if (["fail", "rejected", "open"].includes(value)) return "danger";
  if (["advisory", "submitted", "actioned"].includes(value)) return "warning";
  return "success";
}

function assetLabel(asset) {
  return `${asset.registrationNumber} · ${asset.fleetCode} · ${asset.assetType}`;
}

function initialInspection(userName = "") {
  return {
    asset_id: "",
    inspection_kind: "safety",
    inspection_date: todayUk(),
    scheduled_date: "",
    operator_name: "",
    provider_name: "",
    inspector_name: userName,
    inspector_signature: "",
    odometer_km: "",
    brake_method: "laden_roller",
    brake_result: "pass",
    brake_reference: "",
    notes: "",
    roadworthy_declared: false,
    inspection_document: "",
    brake_document: "",
    wheel_retorque_document: "",
    items: []
  };
}

function InspectionForm({ data, onSaved }) {
  const userName = getAuthSession()?.name || "";
  const [form, setForm] = useState(() => initialInspection(userName));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const assets = data?.assets || [];
  const selectedAsset = assets.find((asset) => asset.assetId === form.asset_id);
  const definitions = selectedAsset ? data?.checklist?.[selectedAsset.assetType] || [] : [];

  useEffect(() => {
    if (!selectedAsset) return;
    setForm((current) => ({
      ...current,
      operator_name: selectedAsset.operatorName || current.operator_name,
      items: definitions.map((item) => {
        const saved = current.items.find((entry) => entry.key === item.key);
        return saved || { ...item, status: "", notes: "", severity: "medium" };
      })
    }));
  }, [selectedAsset?.assetId]);

  function set(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  function setItem(key, name, value) {
    setForm((current) => ({
      ...current,
      items: current.items.map((item) => item.key === key ? { ...item, [name]: value } : item)
    }));
  }

  async function chooseFile(event, name) {
    try {
      set(name, await readFile(event.target.files?.[0]));
    } catch (fileError) {
      setError(fileError.message);
    }
  }

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await createComplianceInspection(form);
      setForm(initialInspection(userName));
      await onSaved("Inspection submitted for QA review.");
    } catch (requestError) {
      setError(errorMessage(requestError, "Could not save inspection."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="compliance-card" onSubmit={submit}>
      <div className="compliance-card-head">
        <div><span>DVSA inspection</span><h3>Complete PMI / Roadworthiness Record</h3></div>
        <StatusPill tone="warning">Evidence required</StatusPill>
      </div>
      <div className="compliance-form-grid">
        <Field label="Vehicle / Trailer">
          <select value={form.asset_id} onChange={(event) => set("asset_id", event.target.value)} required>
            <option value="">Select asset</option>
            {assets.map((asset) => <option key={asset.assetId} value={asset.assetId}>{assetLabel(asset)}</option>)}
          </select>
        </Field>
        <Field label="Inspection type">
          <select value={form.inspection_kind} onChange={(event) => set("inspection_kind", event.target.value)}>
            <option value="safety">Periodic safety inspection</option>
            <option value="first_use">First-use inspection</option>
            <option value="return_to_service">Return-to-service after VOR</option>
          </select>
        </Field>
        <Field label="Inspection date"><input type="date" value={form.inspection_date} onChange={(event) => set("inspection_date", event.target.value)} required /></Field>
        <Field label="Original scheduled date"><input type="date" value={form.scheduled_date} onChange={(event) => set("scheduled_date", event.target.value)} /></Field>
        <Field label="Operator name"><input value={form.operator_name} onChange={(event) => set("operator_name", event.target.value)} required /></Field>
        <Field label="Workshop / Provider"><input list="compliance-providers" value={form.provider_name} onChange={(event) => set("provider_name", event.target.value)} required /></Field>
        <datalist id="compliance-providers">{(data?.providers || []).filter((provider) => provider.active).map((provider) => <option key={provider.id} value={provider.providerName} />)}</datalist>
        <Field label="Inspector name"><input value={form.inspector_name} onChange={(event) => set("inspector_name", event.target.value)} required /></Field>
        <Field label="Inspector signature"><input value={form.inspector_signature} onChange={(event) => set("inspector_signature", event.target.value)} placeholder="Type full name as signature" required /></Field>
        {selectedAsset?.assetType !== "trailer" && <Field label="Odometer (km)"><input type="number" min="0" value={form.odometer_km} onChange={(event) => set("odometer_km", event.target.value)} required /></Field>}
      </div>

      {selectedAsset && (
        <div className="compliance-checklist">
          <div className="compliance-section-title"><h4>Inspection checklist</h4><span>Every item must be assessed deliberately</span></div>
          <div className="compliance-checklist-head" aria-hidden="true">
            <span>Inspection area</span><span>Result</span><span>Risk</span><span>Finding / note</span>
          </div>
          {form.items.map((item) => (
            <div className="compliance-check-row" key={item.key}>
              <strong>{item.label}</strong>
              <select value={item.status} onChange={(event) => setItem(item.key, "status", event.target.value)} required>
                <option value="">Select result</option>
                <option value="pass">Pass</option>
                <option value="advisory">Advisory</option>
                <option value="fail">Fail</option>
                <option value="not_applicable">Not applicable</option>
              </select>
              <select value={item.severity} onChange={(event) => setItem(item.key, "severity", event.target.value)} disabled={!['advisory', 'fail'].includes(item.status)}>
                <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option>
              </select>
              <input value={item.notes} onChange={(event) => setItem(item.key, "notes", event.target.value)} placeholder={['advisory', 'fail'].includes(item.status) ? "Defect details required" : "Notes (optional)"} required={['advisory', 'fail'].includes(item.status)} />
            </div>
          ))}
        </div>
      )}

      <div className="compliance-section-title"><h4>Brake-performance assessment</h4><span>Required at every safety inspection</span></div>
      <div className="compliance-form-grid">
        <Field label="Assessment method">
          <select value={form.brake_method} onChange={(event) => set("brake_method", event.target.value)}>
            <option value="laden_roller">Laden roller brake test</option>
            <option value="decelerometer_temperature">Decelerometer + brake temperature</option>
            <option value="ebpms">EBPMS assessment</option>
          </select>
        </Field>
        <Field label="Brake result"><select value={form.brake_result} onChange={(event) => set("brake_result", event.target.value)}><option value="pass">Pass</option><option value="fail">Fail</option></select></Field>
        <Field label="Brake report reference"><input value={form.brake_reference} onChange={(event) => set("brake_reference", event.target.value)} required /></Field>
        <Field label="Brake report"><input type="file" accept="image/*,.pdf" onChange={(event) => chooseFile(event, "brake_document")} required={!form.brake_document} /></Field>
        <Field label="Completed inspection sheet"><input type="file" accept="image/*,.pdf,.doc,.docx" onChange={(event) => chooseFile(event, "inspection_document")} required={!form.inspection_document} /></Field>
        <Field label="Wheel retorque evidence (if applicable)"><input type="file" accept="image/*,.pdf" onChange={(event) => chooseFile(event, "wheel_retorque_document")} /></Field>
        <Field label="Inspection notes" wide><textarea value={form.notes} onChange={(event) => set("notes", event.target.value)} rows={3} /></Field>
      </div>
      <label className="compliance-declaration"><input type="checkbox" checked={form.roadworthy_declared} onChange={(event) => set("roadworthy_declared", event.target.checked)} required /><span>I confirm this record is complete and accurate. Any failed item keeps the asset off road until repair and independent verification.</span></label>
      {error && <p className="compliance-error">{error}</p>}
      <div className="compliance-actions"><button className="af-submit-btn" disabled={saving || !selectedAsset} type="submit">{saving ? "Submitting…" : "Submit inspection for QA"}</button></div>
    </form>
  );
}

function RepairForm({ item, onClose, onSaved }) {
  const userName = getAuthSession()?.name || "";
  const [form, setForm] = useState({ repair_description: "", repaired_by: "", repaired_at: todayUk(), verifier_name: userName, verifier_signature: "", repair_document: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  async function submit(event) {
    event.preventDefault(); setSaving(true); setError("");
    try {
      await repairComplianceInspectionItem(item.id, form);
      await onSaved("Repair and independent verification saved.");
      onClose();
    } catch (requestError) { setError(errorMessage(requestError, "Could not verify repair.")); }
    finally { setSaving(false); }
  }
  return (
    <form className="compliance-inline-form" onSubmit={submit}>
      <h4>Repair and verify: {item.label}</h4>
      <div className="compliance-form-grid">
        <Field label="Repair details" wide><textarea value={form.repair_description} onChange={(event) => setForm({ ...form, repair_description: event.target.value })} required /></Field>
        <Field label="Repaired by"><input value={form.repaired_by} onChange={(event) => setForm({ ...form, repaired_by: event.target.value })} required /></Field>
        <Field label="Repair date"><input type="date" value={form.repaired_at} onChange={(event) => setForm({ ...form, repaired_at: event.target.value })} required /></Field>
        <Field label="Independent verifier"><input value={form.verifier_name} onChange={(event) => setForm({ ...form, verifier_name: event.target.value })} required /></Field>
        <Field label="Verifier signature"><input value={form.verifier_signature} onChange={(event) => setForm({ ...form, verifier_signature: event.target.value })} required /></Field>
        <Field label="Repair evidence"><input type="file" accept="image/*,.pdf" onChange={async (event) => setForm({ ...form, repair_document: await readFile(event.target.files?.[0]) })} required={!form.repair_document} /></Field>
      </div>
      {error && <p className="compliance-error">{error}</p>}
      <div className="compliance-actions"><button type="button" onClick={onClose}>Cancel</button><button className="af-submit-btn" disabled={saving} type="submit">{saving ? "Saving…" : "Save verified repair"}</button></div>
    </form>
  );
}

function InspectionRecords({ records, onSaved }) {
  const userName = getAuthSession()?.name || "";
  const [selectedId, setSelectedId] = useState(null);
  const [repairItem, setRepairItem] = useState(null);
  const [review, setReview] = useState({ qa_by: userName, qa_signature: "", qa_notes: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const selected = records.find((record) => record.id === selectedId);
  async function submitReview(action) {
    setSaving(true); setError("");
    try {
      await reviewComplianceInspection(selected.id, { ...review, action });
      setSelectedId(null);
      await onSaved(action === "approve" ? "Inspection approved and locked." : "Inspection rejected.");
    } catch (requestError) { setError(errorMessage(requestError, "Could not review inspection.")); }
    finally { setSaving(false); }
  }
  return (
    <section className="compliance-card">
      <div className="compliance-card-head"><div><span>15-month register</span><h3>Inspection Records and QA</h3></div><StatusPill tone="neutral">{records.length} records</StatusPill></div>
      <div className="compliance-record-list">
        {records.map((record) => (
          <button type="button" className={`compliance-record${selectedId === record.id ? " active" : ""}`} key={record.id} onClick={() => { setSelectedId(record.id); setRepairItem(null); setError(""); }}>
            <strong>{record.registrationNumber}</strong><span>{record.inspectionDateLabel} · {record.inspectionKind.replaceAll("_", " ")}</span>
            <StatusPill tone={resultTone(record.overallResult)}>{record.overallResult}</StatusPill><StatusPill tone={resultTone(record.qaStatus)}>{record.qaStatus}</StatusPill>
          </button>
        ))}
        {!records.length && <Empty>No compliance inspections recorded yet.</Empty>}
      </div>
      {selected && (
        <div className="compliance-record-detail">
          <div className="compliance-section-title"><h4>{selected.registrationNumber} · inspection #{selected.id}</h4><span>Next due {selected.nextDueLabel}</span></div>
          <p>Inspector: <strong>{selected.inspectorName}</strong> · Provider: <strong>{selected.providerName}</strong> · Brake: <strong>{selected.brakeResult}</strong></p>
          <div className="compliance-item-results">
            {selected.items.map((item) => (
              <div key={item.id} className={`compliance-item-result ${item.status}`}>
                <div><strong>{item.label}</strong><p>{item.notes || "No finding recorded"}</p></div>
                <StatusPill tone={resultTone(item.status)}>{item.status.replace("_", " ")}</StatusPill>
                {['advisory', 'fail'].includes(item.status) && (
                  item.repairedAndVerified
                    ? <StatusPill tone="success">Repair verified</StatusPill>
                    : <button type="button" onClick={() => setRepairItem(item)}>Add repair evidence</button>
                )}
              </div>
            ))}
          </div>
          {repairItem && <RepairForm item={repairItem} onClose={() => setRepairItem(null)} onSaved={onSaved} />}
          {selected.qaStatus !== "approved" && !repairItem && (
            <div className="compliance-inline-form">
              <h4>Transport manager / QA review</h4>
              <div className="compliance-form-grid">
                <Field label="Reviewer"><input value={review.qa_by} onChange={(event) => setReview({ ...review, qa_by: event.target.value })} required /></Field>
                <Field label="Reviewer signature"><input value={review.qa_signature} onChange={(event) => setReview({ ...review, qa_signature: event.target.value })} required /></Field>
                <Field label="Review notes" wide><textarea value={review.qa_notes} onChange={(event) => setReview({ ...review, qa_notes: event.target.value })} /></Field>
              </div>
              {error && <p className="compliance-error">{error}</p>}
              <div className="compliance-actions"><button disabled={saving} type="button" onClick={() => submitReview("reject")}>Reject</button><button disabled={saving} className="af-submit-btn" type="button" onClick={() => submitReview("approve")}>Approve and lock</button></div>
            </div>
          )}
          {selected.qaStatus === "approved" && <p className="compliance-success">Approved records are permanently locked. Approved by {selected.qaBy}.</p>}
        </div>
      )}
    </section>
  );
}

function MotForm({ data, onSaved }) {
  const [form, setForm] = useState({ asset_id: "", test_date: todayUk(), result: "pass", certificate_number: "", expiry_date: "", failure_reason: "", tester_name: "", provider_name: "", odometer_km: "", retest_of: "", document: "" });
  const [error, setError] = useState(""); const [saving, setSaving] = useState(false);
  const failedTests = (data?.motTests || []).filter((test) => test.result === "fail" && (!form.asset_id || `${test.assetType}:${test.assetId}` === form.asset_id));
  async function submit(event) {
    event.preventDefault(); setSaving(true); setError("");
    try { await createComplianceMotTest(form); setForm({ ...form, certificate_number: "", expiry_date: "", failure_reason: "", retest_of: "", document: "" }); await onSaved("MOT result and evidence saved."); }
    catch (requestError) { setError(errorMessage(requestError, "Could not save MOT result.")); }
    finally { setSaving(false); }
  }
  return (
    <div className="compliance-two-column">
      <form className="compliance-card" onSubmit={submit}>
        <div className="compliance-card-head"><div><span>Annual test</span><h3>Record MOT Result</h3></div></div>
        <div className="compliance-form-grid">
          <Field label="Vehicle / Trailer"><select value={form.asset_id} onChange={(event) => setForm({ ...form, asset_id: event.target.value })} required><option value="">Select asset</option>{data.assets.map((asset) => <option key={asset.assetId} value={asset.assetId}>{assetLabel(asset)}</option>)}</select></Field>
          <Field label="Test date"><input type="date" value={form.test_date} onChange={(event) => setForm({ ...form, test_date: event.target.value })} required /></Field>
          <Field label="Result"><select value={form.result} onChange={(event) => setForm({ ...form, result: event.target.value })}><option value="pass">Pass</option><option value="fail">Fail</option></select></Field>
          <Field label="Tester"><input value={form.tester_name} onChange={(event) => setForm({ ...form, tester_name: event.target.value })} required /></Field>
          <Field label="Test centre / Provider"><input value={form.provider_name} onChange={(event) => setForm({ ...form, provider_name: event.target.value })} required /></Field>
          <Field label="Odometer (km)"><input type="number" min="0" value={form.odometer_km} onChange={(event) => setForm({ ...form, odometer_km: event.target.value })} /></Field>
          {form.result === "pass" ? <><Field label="Certificate number"><input value={form.certificate_number} onChange={(event) => setForm({ ...form, certificate_number: event.target.value })} required /></Field><Field label="Expiry date"><input type="date" value={form.expiry_date} onChange={(event) => setForm({ ...form, expiry_date: event.target.value })} required /></Field></> : <Field label="Failure reasons" wide><textarea value={form.failure_reason} onChange={(event) => setForm({ ...form, failure_reason: event.target.value })} required /></Field>}
          <Field label="Retest of failed MOT"><select value={form.retest_of} onChange={(event) => setForm({ ...form, retest_of: event.target.value })}><option value="">Not a retest</option>{failedTests.map((test) => <option key={test.id} value={test.id}>#{test.id} · {test.testDate} · {test.registrationNumber}</option>)}</select></Field>
          <Field label="Certificate / failure notice"><input type="file" accept="image/*,.pdf" onChange={async (event) => setForm({ ...form, document: await readFile(event.target.files?.[0]) })} required={!form.document} /></Field>
        </div>
        {error && <p className="compliance-error">{error}</p>}<div className="compliance-actions"><button className="af-submit-btn" disabled={saving} type="submit">Save MOT result</button></div>
      </form>
      <section className="compliance-card"><div className="compliance-card-head"><div><span>24-month history</span><h3>MOT Results</h3></div></div>{data.motTests.map((test) => <div className="compliance-list-row" key={test.id}><div><strong>{test.registrationNumber}</strong><p>{test.testDate} · {test.providerName}</p></div><StatusPill tone={resultTone(test.result)}>{test.result}</StatusPill><span>{test.certificateNumber || test.failureReason}</span></div>)}{!data.motTests.length && <Empty>No MOT results recorded.</Empty>}</section>
    </div>
  );
}

function Controls({ data, onSaved }) {
  const userName = getAuthSession()?.name || "";
  const [error, setError] = useState("");
  const [provider, setProvider] = useState({ provider_name: "", contract_reference: "", contract_start: todayUk(), contract_end: "", vol_declared: false, last_quality_audit: todayUk(), next_quality_audit: "", contact_details: "" });
  const [frequency, setFrequency] = useState({ asset_id: "", weeks: "6", source_name: "VOL", licence_reference: "", change_reason: "", effective_from: todayUk() });
  const [recall, setRecall] = useState({ asset_id: "", recall_reference: "", description: "", issued_date: todayUk(), due_date: "" });
  const [daily, setDaily] = useState({ asset_id: "", check_date: todayUk(), driver_name: userName, result: "nil_defect", defect_details: "", declaration: false, signature: "" });
  const [missed, setMissed] = useState({ asset_id: "", due_date: todayUk(), reason: "", corrective_action: "" });
  const [recallAction, setRecallAction] = useState({ id: "", action_details: "", actioned_at: todayUk(), verified_by: userName, verifier_signature: "", evidence: "" });
  async function act(request, message, reset) {
    setError("");
    try { await request(); reset?.(); await onSaved(message); }
    catch (requestError) { setError(errorMessage(requestError, message)); }
  }
  const assetOptions = <>{data.assets.map((asset) => <option key={asset.assetId} value={asset.assetId}>{assetLabel(asset)}</option>)}</>;
  return (
    <div className="compliance-controls">
      {error && <p className="compliance-error">{error}</p>}
      <details className="compliance-card" open><summary>Inspection Frequency and VOL Evidence</summary><form className="compliance-form-grid" onSubmit={(event) => { event.preventDefault(); act(() => updateComplianceFrequency(frequency), "Inspection frequency updated."); }}><Field label="Asset"><select value={frequency.asset_id} onChange={(event) => setFrequency({ ...frequency, asset_id: event.target.value })} required><option value="">Select asset</option>{assetOptions}</select></Field><Field label="Frequency (weeks)"><input type="number" min="2" max="13" value={frequency.weeks} onChange={(event) => setFrequency({ ...frequency, weeks: event.target.value })} required /></Field><Field label="Source"><input value={frequency.source_name} onChange={(event) => setFrequency({ ...frequency, source_name: event.target.value })} required /></Field><Field label="Operator Licence / VOL reference"><input value={frequency.licence_reference} onChange={(event) => setFrequency({ ...frequency, licence_reference: event.target.value })} required /></Field><Field label="Effective from"><input type="date" value={frequency.effective_from} onChange={(event) => setFrequency({ ...frequency, effective_from: event.target.value })} required /></Field><Field label="Reason"><textarea value={frequency.change_reason} onChange={(event) => setFrequency({ ...frequency, change_reason: event.target.value })} required /></Field><div className="compliance-actions wide"><button className="af-submit-btn">Save frequency evidence</button></div></form></details>

      <details className="compliance-card"><summary>Maintenance Provider Contract</summary><form className="compliance-form-grid" onSubmit={(event) => { event.preventDefault(); act(() => createComplianceProvider(provider), "Provider contract saved.", () => setProvider({ ...provider, provider_name: "", contract_reference: "" })); }}><Field label="Provider name"><input value={provider.provider_name} onChange={(event) => setProvider({ ...provider, provider_name: event.target.value })} required /></Field><Field label="Contract reference"><input value={provider.contract_reference} onChange={(event) => setProvider({ ...provider, contract_reference: event.target.value })} required /></Field><Field label="Contract start"><input type="date" value={provider.contract_start} onChange={(event) => setProvider({ ...provider, contract_start: event.target.value })} required /></Field><Field label="Contract end"><input type="date" value={provider.contract_end} onChange={(event) => setProvider({ ...provider, contract_end: event.target.value })} /></Field><Field label="Last quality audit"><input type="date" value={provider.last_quality_audit} onChange={(event) => setProvider({ ...provider, last_quality_audit: event.target.value })} required /></Field><Field label="Next quality audit"><input type="date" value={provider.next_quality_audit} onChange={(event) => setProvider({ ...provider, next_quality_audit: event.target.value })} required /></Field><Field label="Contact"><input value={provider.contact_details} onChange={(event) => setProvider({ ...provider, contact_details: event.target.value })} /></Field><label className="compliance-declaration"><input type="checkbox" checked={provider.vol_declared} onChange={(event) => setProvider({ ...provider, vol_declared: event.target.checked })} /><span>Provider matches the Operator Licence / VOL record</span></label><div className="compliance-actions wide"><button className="af-submit-btn">Save provider</button></div></form></details>

      <details className="compliance-card"><summary>Safety Recall Register</summary><form className="compliance-form-grid" onSubmit={(event) => { event.preventDefault(); act(() => createComplianceRecall(recall), "Safety recall recorded.", () => setRecall({ ...recall, recall_reference: "", description: "" })); }}><Field label="Asset"><select value={recall.asset_id} onChange={(event) => setRecall({ ...recall, asset_id: event.target.value })} required><option value="">Select asset</option>{assetOptions}</select></Field><Field label="Recall reference"><input value={recall.recall_reference} onChange={(event) => setRecall({ ...recall, recall_reference: event.target.value })} required /></Field><Field label="Issued date"><input type="date" value={recall.issued_date} onChange={(event) => setRecall({ ...recall, issued_date: event.target.value })} required /></Field><Field label="Due date"><input type="date" value={recall.due_date} onChange={(event) => setRecall({ ...recall, due_date: event.target.value })} required /></Field><Field label="Description" wide><textarea value={recall.description} onChange={(event) => setRecall({ ...recall, description: event.target.value })} required /></Field><div className="compliance-actions wide"><button className="af-submit-btn">Add recall</button></div></form>
      {(data.recalls || []).filter((entry) => entry.status !== "verified").map((entry) => <button className="compliance-record" type="button" key={entry.id} onClick={() => setRecallAction({ ...recallAction, id: entry.id })}><strong>{entry.recallReference}</strong><span>{entry.description}</span><StatusPill tone={resultTone(entry.status)}>{entry.status}</StatusPill></button>)}
      {recallAction.id && <form className="compliance-inline-form" onSubmit={(event) => { event.preventDefault(); act(() => verifyComplianceRecall(recallAction.id, recallAction), "Recall action verified.", () => setRecallAction({ ...recallAction, id: "", action_details: "", evidence: "" })); }}><h4>Verify recall action #{recallAction.id}</h4><div className="compliance-form-grid"><Field label="Action completed" wide><textarea value={recallAction.action_details} onChange={(event) => setRecallAction({ ...recallAction, action_details: event.target.value })} required /></Field><Field label="Action date"><input type="date" value={recallAction.actioned_at} onChange={(event) => setRecallAction({ ...recallAction, actioned_at: event.target.value })} required /></Field><Field label="Verifier"><input value={recallAction.verified_by} onChange={(event) => setRecallAction({ ...recallAction, verified_by: event.target.value })} required /></Field><Field label="Verifier signature"><input value={recallAction.verifier_signature} onChange={(event) => setRecallAction({ ...recallAction, verifier_signature: event.target.value })} required /></Field><Field label="Evidence"><input type="file" accept="image/*,.pdf" onChange={async (event) => setRecallAction({ ...recallAction, evidence: await readFile(event.target.files?.[0]) })} required={!recallAction.evidence} /></Field></div><div className="compliance-actions"><button className="af-submit-btn">Verify recall</button></div></form>}</details>

      <details className="compliance-card"><summary>Daily Walkaround / Nil-Defect Check</summary><form className="compliance-form-grid" onSubmit={(event) => { event.preventDefault(); act(() => createComplianceDailyCheck(daily), "Daily check recorded.", () => setDaily({ ...daily, defect_details: "", signature: "", declaration: false })); }}><Field label="Asset"><select value={daily.asset_id} onChange={(event) => setDaily({ ...daily, asset_id: event.target.value })} required><option value="">Select asset</option>{assetOptions}</select></Field><Field label="Check date"><input type="date" value={daily.check_date} onChange={(event) => setDaily({ ...daily, check_date: event.target.value })} required /></Field><Field label="Driver"><input value={daily.driver_name} onChange={(event) => setDaily({ ...daily, driver_name: event.target.value })} required /></Field><Field label="Result"><select value={daily.result} onChange={(event) => setDaily({ ...daily, result: event.target.value })}><option value="nil_defect">Nil defect</option><option value="defect">Defect found</option></select></Field>{daily.result === "defect" && <Field label="Defect details" wide><textarea value={daily.defect_details} onChange={(event) => setDaily({ ...daily, defect_details: event.target.value })} required /></Field>}<Field label="Driver signature"><input value={daily.signature} onChange={(event) => setDaily({ ...daily, signature: event.target.value })} required /></Field><label className="compliance-declaration"><input type="checkbox" checked={daily.declaration} onChange={(event) => setDaily({ ...daily, declaration: event.target.checked })} /><span>I completed the walkaround check and this record is accurate.</span></label><div className="compliance-actions wide"><button className="af-submit-btn">Save daily check</button></div></form></details>

      <details className="compliance-card"><summary>Late / Missed Inspection</summary><form className="compliance-form-grid" onSubmit={(event) => { event.preventDefault(); act(() => recordMissedComplianceInspection(missed), "Missed inspection recorded.", () => setMissed({ ...missed, reason: "", corrective_action: "" })); }}><Field label="Asset"><select value={missed.asset_id} onChange={(event) => setMissed({ ...missed, asset_id: event.target.value })} required><option value="">Select asset</option>{assetOptions}</select></Field><Field label="Missed due date"><input type="date" value={missed.due_date} onChange={(event) => setMissed({ ...missed, due_date: event.target.value })} required /></Field><Field label="Reason" wide><textarea value={missed.reason} onChange={(event) => setMissed({ ...missed, reason: event.target.value })} required /></Field><Field label="Corrective action" wide><textarea value={missed.corrective_action} onChange={(event) => setMissed({ ...missed, corrective_action: event.target.value })} required /></Field><div className="compliance-actions wide"><button className="af-submit-btn">Record and place off road</button></div></form></details>
    </div>
  );
}

function AuditPacks({ data }) {
  const [downloading, setDownloading] = useState(""); const [error, setError] = useState("");
  async function download(asset) {
    setDownloading(asset.assetId); setError("");
    try {
      const response = await getMaintenanceAuditPack(asset.assetType, asset.id);
      const url = URL.createObjectURL(response.data);
      const link = document.createElement("a"); link.href = url; link.download = `maintenance-audit-${asset.registrationNumber}-${todayUk()}.html`; link.click(); URL.revokeObjectURL(url);
    } catch (requestError) { setError(errorMessage(requestError, "Could not create audit pack.")); }
    finally { setDownloading(""); }
  }
  async function downloadBackup() {
    setDownloading("backup"); setError("");
    try {
      const response = await getMaintenanceComplianceBackup();
      const url = URL.createObjectURL(response.data);
      const link = document.createElement("a"); link.href = url; link.download = `fleet-compliance-backup-${todayUk()}.json`; link.click(); URL.revokeObjectURL(url);
    } catch (requestError) { setError(errorMessage(requestError, "Could not create compliance backup.")); }
    finally { setDownloading(""); }
  }
  return <section className="compliance-card"><div className="compliance-card-head"><div><span>Auditor hand-off</span><h3>15-Month Maintenance Audit Packs</h3></div><button className="af-submit-btn" type="button" onClick={downloadBackup} disabled={downloading === "backup"}>{downloading === "backup" ? "Preparing backup…" : "Download fleet recovery backup"}</button></div><p>Each pack includes inspections, item results, repairs, MOT history, VOR periods, defects, recalls, frequency changes and a SHA-256 evidence manifest.</p>{error && <p className="compliance-error">{error}</p>}<div className="compliance-audit-grid">{data.assets.map((asset) => <button type="button" key={asset.assetId} onClick={() => download(asset)} disabled={downloading === asset.assetId}><strong>{asset.registrationNumber}</strong><span>{asset.fleetCode} · {asset.assetType}</span><small>{downloading === asset.assetId ? "Preparing…" : "Download printable audit pack"}</small></button>)}</div></section>;
}

export function MaintenanceCompliancePanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [view, setView] = useState("inspection");
  async function load(message = "") {
    setLoading(true);
    try { const response = await getMaintenanceCompliance(); setData(response.data); setError(""); if (message) setSuccess(message); }
    catch (requestError) { setError(errorMessage(requestError, "Could not load compliance centre.")); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);
  const summary = data?.summary || {};
  const tabs = useMemo(() => [
    ["inspection", "New inspection"], ["records", "Inspection QA"], ["mot", "MOT"], ["controls", "Compliance controls"], ["audit", "Audit packs"]
  ], []);
  return (
    <div className="compliance-shell">
      <StateNotice loading={loading && !data} error={error} />
      {success && <p className="compliance-success" role="status">{success}<button type="button" onClick={() => setSuccess("")}>Dismiss</button></p>}
      {data && <>
        <section className="compliance-intro">
          <div>
            <span className="compliance-eyebrow">Vehicle standards · UK operations</span>
            <h2>DVSA Compliance Centre</h2>
            <p>Complete inspections, verify repairs and prepare audit-ready evidence from one controlled workspace.</p>
          </div>
          <div className="compliance-intro-meta">
            <span><i className="compliance-live-dot" /> Live compliance register</span>
            <span>15-month evidence retention</span>
          </div>
        </section>
        <div className="compliance-summary">
          <article><span>Awaiting QA</span><strong>{summary.submittedAwaitingQa || 0}</strong></article>
          <article className={summary.openSafetyDefects ? "danger" : ""}><span>Open inspection defects</span><strong>{summary.openSafetyDefects || 0}</strong></article>
          <article className={summary.missingFrequencyEvidence ? "warning" : ""}><span>Missing VOL evidence</span><strong>{summary.missingFrequencyEvidence || 0}</strong></article>
          <article className={summary.openRecalls ? "danger" : ""}><span>Open recalls</span><strong>{summary.openRecalls || 0}</strong></article>
          <article className={summary.motFailures ? "danger" : ""}><span>MOT failures (24m)</span><strong>{summary.motFailures || 0}</strong></article>
        </div>
        <nav className="compliance-tabs" aria-label="DVSA compliance workflows">{tabs.map(([id, label]) => <button type="button" className={view === id ? "active" : ""} key={id} onClick={() => setView(id)}>{label}</button>)}</nav>
        {view === "inspection" && <InspectionForm data={data} onSaved={load} />}
        {view === "records" && <InspectionRecords records={data.inspections} onSaved={load} />}
        {view === "mot" && <MotForm data={data} onSaved={load} />}
        {view === "controls" && <Controls data={data} onSaved={load} />}
        {view === "audit" && <AuditPacks data={data} />}
      </>}
    </div>
  );
}
