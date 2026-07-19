import { Link } from "react-router-dom";
import { StatusPill } from "./StatusPill";

export function StatCard({ item, active = false, onClick, to }) {
  const Element = to ? Link : onClick ? "button" : "article";
  const tone = item.tone || "neutral";
  const interactive = Boolean(to || onClick);

  return (
    <Element
      className={`stat-card tone-${tone}${interactive ? " clickable" : ""}${active ? " active" : ""}`}
      type={onClick ? "button" : undefined}
      onClick={onClick}
      to={to}
    >
      <div className="stat-card-head">
        <span className="stat-card-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none">
            <path d="M5 16.5 9.25 12l3.25 3 6.5-7" />
            <path d="M14.5 8H19v4.5" />
          </svg>
        </span>
        {item.change && <StatusPill tone={tone}>{item.change}</StatusPill>}
      </div>
      <div className="stat-card-body">
        <span className="card-label">{item.label}</span>
        <strong>{item.value}</strong>
      </div>
      <p className="stat-card-description">
        <span>{item.description}</span>
        {interactive && (
          <span className="stat-card-link-arrow" aria-hidden="true">
            →
          </span>
        )}
      </p>
    </Element>
  );
}
