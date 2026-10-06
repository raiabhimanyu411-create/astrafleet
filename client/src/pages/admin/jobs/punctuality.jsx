// Lateness display shared by the jobs list, the stops grid and the job detail page.
// The backend computes everything (UK time, 15 min grace); these helpers only format it.

export function fmtDelay(mins) {
  const total = Math.abs(Math.round(Number(mins) || 0));
  const days = Math.floor(total / 1440);
  const hours = Math.floor((total % 1440) / 60);
  const minutes = total % 60;
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  return `${minutes}m`;
}

export function punctualityPoint(job, key) {
  return job?.punctuality?.points?.find(point => point.key === String(key)) || null;
}

// "late" / "early" / "ontime" / "" for one actual time against its plan.
export function delayTone(delayMins, graceMins = 15) {
  if (delayMins == null) return "";
  if (delayMins > graceMins) return "late";
  if (delayMins < -5) return "early";
  return "ontime";
}

export function DelayTag({ mins, overdue, graceMins = 15 }) {
  if (overdue) return <span className="af-delay-tag overdue">Overdue {fmtDelay(overdue.mins)}</span>;
  const tone = delayTone(mins, graceMins);
  if (tone === "late") return <span className="af-delay-tag late">+{fmtDelay(mins)} late</span>;
  if (tone === "early") return <span className="af-delay-tag early">{fmtDelay(mins)} early</span>;
  if (tone === "ontime") return <span className="af-delay-tag ontime">On time</span>;
  return null;
}

export function PunctualityPill({ summary }) {
  const worst = summary?.worstPoint;
  if (!worst) return null;
  const text = worst.state === "overdue" ? `Overdue at ${worst.label} · ${fmtDelay(worst.mins)}` : `Late at ${worst.label} · +${fmtDelay(worst.mins)}`;
  return <span className={`af-punctuality-pill ${worst.state}`} title={summary.lateCount > 1 ? `${summary.lateCount} points behind plan` : undefined}>{text}</span>;
}

export function PointWarnings({ point }) {
  if (!point?.warnings?.length) return null;
  return point.warnings.map(text => <small className="af-point-warning" key={text}>⚠ {text}</small>);
}
