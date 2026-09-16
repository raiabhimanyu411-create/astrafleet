const clock = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export function ukNow(value = new Date()) {
  const parts = Object.fromEntries(clock.formatToParts(value).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
export function ukInstant(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value || '')) return null;
  const wall = Date.parse(`${value}:00Z`);
  if (!Number.isFinite(wall)) return null;
  const matches = [0, 60].map(offset => new Date(wall - offset * 60000)).filter(date => ukNow(date) === value);
  return matches.length === 1 ? matches[0] : null;
}
export function ukMinutes(start, end) {
  const a = ukInstant(start), b = ukInstant(end);
  return a && b ? Math.round((b - a) / 60000) : null;
}
export function ukAddMinutes(value, minutes) {
  const date = ukInstant(value);
  return date && Number.isFinite(Number(minutes)) ? ukNow(new Date(date.getTime() + Number(minutes) * 60000)) : '';
}
export function formatUkWall(value) {
  if (!value) return '—';
  const date = new Date(`${String(value).slice(0, 16)}:00Z`);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('en-GB', { timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
}
