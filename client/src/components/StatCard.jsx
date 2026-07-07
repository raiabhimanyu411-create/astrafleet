import { StatusPill } from "./StatusPill";

export function StatCard({ item, active = false, onClick }) {
  const Element = onClick ? "button" : "article";

  return (
    <Element
      className={`stat-card tone-${item.tone || "neutral"}${onClick ? " clickable" : ""}${active ? " active" : ""}`}
      type={onClick ? "button" : undefined}
      onClick={onClick}
    >
      <div className="stat-card-head">
        <span className="card-label">{item.label}</span>
        <StatusPill tone={item.tone}>{item.change}</StatusPill>
      </div>
      <strong>{item.value}</strong>
      <p>{item.description}</p>
    </Element>
  );
}
