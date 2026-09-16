const UK_TIME_ZONE = "Europe/London";

const UK_NOW_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  timeZone: UK_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23"
});

const UK_WALL_DISPLAY = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23"
});

const UK_WALL_TIME = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23"
});

function partsToMap(parts) {
  return Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
}

function dateTimeKey(value) {
  if (!value) return "";
  if (typeof value === "string") {
    const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::[0-5]\d(?:\.\d{1,6})?)?$/);
    if (match) return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}`;
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    const hour = String(value.getHours()).padStart(2, "0");
    const minute = String(value.getMinutes()).padStart(2, "0");
    return `${year}-${month}-${day}T${hour}:${minute}`;
  }
  return "";
}

function wallDate(value) {
  const key = dateTimeKey(value);
  if (!key) return null;
  const [year, month, day, hour, minute] = key.match(/\d+/g).map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day, hour, minute));
  if (
    parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day || parsed.getUTCHours() !== hour || parsed.getUTCMinutes() !== minute
  ) return null;
  return parsed;
}

function isDateTimeKey(value) {
  return londonInstants(value).length === 1;
}

// UK switches between GMT and BST. Reject nonexistent or repeated local input
// rather than silently selecting an hour at a clock-change boundary.
function londonInstants(value) {
  const parsed = wallDate(value);
  if (!parsed) return [];
  const key = dateTimeKey(value);
  return [0, 60].map(offset => new Date(parsed.getTime() - offset * 60000))
    .filter(instant => ukNowDateTimeKey(instant) === key);
}

function ukNowDateTimeKey(value = new Date()) {
  const parts = partsToMap(UK_NOW_FORMATTER.formatToParts(value));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function addWallMinutes(value, minutes) {
  const instants = londonInstants(value);
  if (instants.length !== 1 || !Number.isFinite(Number(minutes))) return "";
  return ukNowDateTimeKey(new Date(instants[0].getTime() + Number(minutes) * 60000));
}

function wallMinutesBetween(start, end) {
  const starts = londonInstants(start), ends = londonInstants(end);
  if (starts.length !== 1 || ends.length !== 1) return null;
  return Math.round((ends[0].getTime() - starts[0].getTime()) / 60000);
}

function fmtUkDateTime(value) {
  const parsed = wallDate(value);
  return parsed ? UK_WALL_DISPLAY.format(parsed) : "—";
}

function fmtUkTime(value) {
  const parsed = wallDate(value);
  return parsed ? UK_WALL_TIME.format(parsed) : "—";
}

module.exports = {
  UK_TIME_ZONE,
  addWallMinutes,
  dateTimeKey,
  fmtUkDateTime,
  fmtUkTime,
  isDateTimeKey,
  ukNowDateTimeKey,
  wallMinutesBetween
};
