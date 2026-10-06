const UK_DATE_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

function ukDateKey(value = new Date()) {
  const parts = Object.fromEntries(
    UK_DATE_FORMATTER.formatToParts(value)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function isDateKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
  const [year, month, day] = String(value).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function dateFieldError(value, label, { required = false, future = true, today = ukDateKey() } = {}) {
  if (!value) return required ? `${label} is required.` : "";
  if (!isDateKey(value)) return `${label} must be a valid date.`;
  if (!future && value > today) return `${label} cannot be after today in the UK.`;
  return "";
}

// Whole UK calendar days from today to `value` (negative = past). Counted on dates, not hours, so the
// 23/25-hour days at the BST/GMT change and the time of day never shift the result.
function ukDaysUntil(value) {
  if (!value) return null;
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  const key = match ? match[0] : (value instanceof Date && !Number.isNaN(value.getTime()) ? ukDateKey(value) : null);
  if (!key) return null;
  const toUtc = dateKey => {
    const [year, month, day] = dateKey.split("-").map(Number);
    return Date.UTC(year, month - 1, day);
  };
  return Math.round((toUtc(key) - toUtc(ukDateKey())) / 86400000);
}

function optionalMoney(value) {
  if (value === "" || value == null) return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

module.exports = { ukDateKey, ukDaysUntil, isDateKey, dateFieldError, optionalMoney };
