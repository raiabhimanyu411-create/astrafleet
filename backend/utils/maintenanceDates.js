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

function optionalMoney(value) {
  if (value === "" || value == null) return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

module.exports = { ukDateKey, isDateKey, dateFieldError, optionalMoney };
