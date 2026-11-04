import { statusTone } from "./StatusChip";

// Known status words always get their fixed colour (see StatusChip); anything else keeps the tone passed in.
export function StatusPill({ tone = "neutral", children }) {
  const fallback = tone === "primary" ? "info" : tone;
  const resolved = typeof children === "string" ? statusTone(children, fallback) : fallback;
  return <span className={`status-pill ${resolved}`}>{children}</span>;
}
