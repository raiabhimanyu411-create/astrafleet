import { useEffect, useState } from "react";

const reasonCategories = [
  { value: "duplicate", label: "Duplicate" },
  { value: "client_request", label: "Client request" },
  { value: "incorrect_amount", label: "Incorrect amount" },
  { value: "wrong_assignment", label: "Wrong assignment" },
  { value: "compliance_issue", label: "Compliance issue" },
  { value: "data_correction", label: "Data correction" },
  { value: "other", label: "Other" }
];

export function DeleteReasonModal({
  open,
  title,
  recordLabel,
  body,
  confirmLabel = "Confirm delete",
  loading = false,
  onCancel,
  onConfirm
}) {
  const [reason, setReason] = useState("");
  const [reasonCategory, setReasonCategory] = useState("");

  useEffect(() => {
    if (open) {
      setReason("");
      setReasonCategory("");
    }
  }, [open]);

  if (!open) return null;

  const cleanReason = reason.trim();
  const isValid = cleanReason.length >= 5 && reasonCategory;

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="reason-modal" role="dialog" aria-modal="true" aria-labelledby="delete-reason-title">
        <div className="section-head">
          <div>
            <span className="card-label">Reason required</span>
            <h2 id="delete-reason-title">{title}</h2>
          </div>
        </div>
        {recordLabel && <p className="reason-modal-record">{recordLabel}</p>}
        <p className="reason-modal-body">
          {body || "This action will be visible in the admin activity report with your name, time, and reason."}
        </p>
        <label className="af-field">
          <span className="af-label">Reason category</span>
          <select className="af-select" value={reasonCategory} onChange={e => setReasonCategory(e.target.value)}>
            <option value="">Select a category</option>
            {reasonCategories.map(category => (
              <option key={category.value} value={category.value}>{category.label}</option>
            ))}
          </select>
        </label>
        <label className="af-field">
          <span className="af-label">Deletion reason</span>
          <textarea
            autoFocus
            className="af-input reason-modal-input"
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="Write a clear reason for this action..."
          />
        </label>
        <div className="reason-modal-footer">
          <button className="header-action-button" type="button" onClick={onCancel} disabled={loading}>
            Cancel
          </button>
          <button
            className="header-action-button danger"
            type="button"
            disabled={!isValid || loading}
            onClick={() => onConfirm({ reason: cleanReason, reasonCategory })}
          >
            {loading ? "Working..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
