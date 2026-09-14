const timeZone = "Europe/London";

export function documentSubmission(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(date).map((part) => [part.type, part.value]));
  const thursday = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)));
  thursday.setUTCDate(thursday.getUTCDate() + 4 - (thursday.getUTCDay() || 7));
  const year = thursday.getUTCFullYear();
  const week = Math.ceil(((thursday - Date.UTC(year, 0, 1)) / 86400000 + 1) / 7);
  const suffix = week % 100 >= 11 && week % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" }[week % 10] || "th");
  return {
    dateTime: new Intl.DateTimeFormat("en-GB", {
      timeZone, day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "short"
    }).format(date),
    weekLabel: `${week}${suffix} week · ${year}`
  };
}

export function formatUkDateTime(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone, day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "short"
  }).format(date);
}

export function filterMaintenanceDocuments(documents, type, assetType, search) {
  const query = search.trim().toLowerCase();
  return documents.filter((doc) => (!type || doc.serviceType === type)
    && (!assetType || doc.assetType === assetType)
    && (!query || [doc.vehicle, doc.fleetCode, doc.jobNumber, doc.billNumber, doc.serviceType]
      .some((value) => String(value || "").toLowerCase().includes(query))));
}
