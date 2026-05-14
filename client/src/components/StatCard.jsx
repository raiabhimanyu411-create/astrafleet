import { StatusPill } from "./StatusPill";

export function StatCard({ item }) {
  return (
    <article className="stat-card">
      <span className="card-label">{item.label}</span>
      <strong>{item.value}</strong>
      <p>{item.description}</p>
      <StatusPill tone={item.tone}>{item.change}</StatusPill>
    </article>
  );
}
