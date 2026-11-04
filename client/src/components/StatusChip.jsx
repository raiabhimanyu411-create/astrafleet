// One status → one colour, everywhere (chips, tables, map pins, charts).
// Tones match the CSS tokens: success, warning, danger, info, neutral.

const EXACT = {
  // success: done, free, clear
  available: "success", completed: "success", delivered: "success", paid: "success",
  clear: "success", compliant: "success", approved: "success", ready: "success",
  verified: "success", active: "success", cleared: "success", closed: "success",
  resolved: "success", settled: "success", valid: "success",

  // info: work in progress
  "in transit": "info", "on a job": "info", "on the road": "info", planned: "info",
  loading: "info", assigned: "info", dispatched: "info", "in progress": "info",
  "en route": "info", started: "info", "on duty": "info", moving: "info",

  // warning: needs a look
  review: "warning", "pending review": "warning", pending: "warning", delayed: "warning",
  late: "warning", onboarding: "warning", sent: "warning", due: "warning",
  "due soon": "warning", watch: "warning", hold: "warning", "on hold": "warning",
  medium: "warning", stale: "warning", unassigned: "warning", missing: "warning",

  // danger: failed or blocked
  failed: "danger", blocked: "danger", overdue: "danger", expired: "danger",
  rejected: "danger", critical: "danger", high: "danger", breakdown: "danger",
  maintenance: "danger", stopped: "danger", "off road": "danger", suspended: "danger",
  missed: "danger", offline: "danger",

  // neutral: not started or no longer relevant
  draft: "neutral", cancelled: "neutral", canceled: "neutral", archived: "neutral",
  inactive: "neutral", low: "neutral", scheduled: "neutral", "not scheduled": "neutral"
};

// Words that decide the tone even inside a longer label ("Licence expired").
const CONTAINS = [
  ["overdue", "danger"], ["expired", "danger"], ["failed", "danger"], ["blocked", "danger"],
  ["review", "warning"], ["missing", "warning"], ["delayed", "warning"], ["due soon", "warning"],
  ["in transit", "info"]
];

const TONES = new Set(["success", "warning", "danger", "info", "neutral"]);

export function statusTone(status, fallback = "neutral") {
  const text = String(status ?? "").toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (EXACT[text]) return EXACT[text];
  const hit = CONTAINS.find(([word]) => text.includes(word));
  if (hit) return hit[1];
  return TONES.has(fallback) ? fallback : "neutral";
}

export function StatusChip({ status, tone, className = "status-pill", children }) {
  const label = children ?? status;
  const resolved = statusTone(typeof label === "string" ? label : status, tone);
  return <span className={`${className} ${resolved}`}>{label}</span>;
}
