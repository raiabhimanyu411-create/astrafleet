import { StatusPill } from "./StatusPill";

export function StatCard({ item, active = false, onClick }) {
  const Element = onClick ? "button" : "article";

  return (
    <Element
      className={`stat-card${onClick ? " clickable" : ""}${active ? " active" : ""}`}
      type={onClick ? "button" : undefined}
      onClick={onClick}
    >
      <span className="card-label">{item.label}</span>
      <strong>{item.value}</strong>
      <p>{item.description}</p>
      <StatusPill tone={item.tone}>{item.change}</StatusPill>
    </Element>
  );
}
