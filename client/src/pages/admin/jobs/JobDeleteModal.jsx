import { useEffect, useState } from "react";
import { getJobDeletePreview } from "../../../api/jobApi";
import { DeleteReasonModal } from "../../../components/DeleteReasonModal";

const gbp = value => `£${Number(value || 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Delete a job and everything linked to it from one dialog. The preview comes from the same backend
// function that performs the delete, so what is listed here is exactly what happens.
export function JobDeleteModal({ job, loading, onCancel, onConfirm }) {
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState("");

  const jobId = job?.id;

  useEffect(() => {
    if (!jobId) return undefined;
    let alive = true;
    setPreview(null);
    setError("");
    getJobDeletePreview(jobId)
      .then(res => { if (alive) setPreview(res.data); })
      .catch(err => { if (alive) setError(err?.response?.data?.message || "Linked records could not be loaded."); });
    return () => { alive = false; };
  }, [jobId]);

  const invoices = preview?.invoices || [];
  const paidInvoices = invoices.filter(inv => inv.status === "paid" || inv.paid > 0);

  const details = (
    <div className="job-delete-impact">
      {!preview && !error && <p className="job-delete-muted">Checking linked records…</p>}
      {error && <p className="job-delete-blocker">{error}</p>}
      {preview?.blocker && <p className="job-delete-blocker">{preview.blocker}</p>}

      {preview && !preview.blocker && (
        <>
          {invoices.length > 0 && (
            <section className="job-delete-group danger">
              <strong>Deleted with this job</strong>
              {invoices.map(inv => (
                <div className="job-delete-row" key={inv.id}>
                  <span>Invoice {inv.invoiceNo} <em>{inv.status}</em></span>
                  <span>{gbp(inv.amount)}{inv.paid > 0 ? ` · ${gbp(inv.paid)} received` : ""}</span>
                </div>
              ))}
              {paidInvoices.length > 0 && (
                <small className="job-delete-warning">
                  {paidInvoices.length === 1 ? "This invoice has" : "These invoices have"} payments recorded. Deleting removes that revenue from Billing and Finance.
                </small>
              )}
            </section>
          )}

          {preview.alerts.length > 0 && (
            <section className="job-delete-group">
              <strong>Resolved automatically</strong>
              {preview.alerts.map(alert => (
                <div className="job-delete-row" key={alert.id}><span>{alert.code}</span><span>{alert.title}</span></div>
              ))}
            </section>
          )}

          {preview.hidden.length > 0 && (
            <section className="job-delete-group">
              <strong>Hidden with the job (recoverable)</strong>
              {preview.hidden.map(item => (
                <div className="job-delete-row" key={item.label}><span>{item.label}</span><span>{item.count}</span></div>
              ))}
            </section>
          )}

          {preview.kept.length > 0 && (
            <section className="job-delete-group kept">
              <strong>Kept, not deleted</strong>
              {preview.kept.map(item => (
                <div className="job-delete-row" key={item.label}>
                  <span>{item.label} · {item.count}{item.amount ? ` · ${gbp(item.amount)}` : ""}</span>
                  <span>{item.note}</span>
                </div>
              ))}
            </section>
          )}

          {!invoices.length && !preview.alerts.length && !preview.hidden.length && !preview.kept.length && (
            <p className="job-delete-muted">No other records are linked to this job.</p>
          )}
        </>
      )}
    </div>
  );

  return (
    <DeleteReasonModal
      open={Boolean(job)}
      title="Delete Job"
      recordLabel={job ? [job.code, job.customer].filter(Boolean).join(" · ") : ""}
      body="The job is removed from the jobs list, planner and driver app. A planned job's truck and trailer are released. Everything is soft-deleted and logged with this reason, so it can be recovered."
      details={details}
      confirmDisabled={!preview || Boolean(preview.blocker)}
      confirmLabel={invoices.length ? `Delete Job + ${invoices.length} Invoice${invoices.length > 1 ? "s" : ""}` : "Delete Job"}
      loading={loading}
      onCancel={onCancel}
      onConfirm={payload => onConfirm({ ...payload, includeRelated: true })}
    />
  );
}
