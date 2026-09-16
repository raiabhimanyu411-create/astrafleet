const HEADER_ALIASES = {
  client_name: ["client_name", "client", "customer", "customer_name"], client_phone: ["client_phone", "phone", "customer_phone"],
  reference: ["reference", "ref", "job_reference"], load_id: ["load_id", "load", "load_number"],
  pickup_address: ["pickup_address", "pickup", "collection_address", "collection"], drop_address: ["drop_address", "drop", "delivery_address", "delivery"],
  planned_departure: ["planned_departure", "collection_arrival", "pickup_datetime", "job_date"], loading_done_time: ["loading_done_time", "collection_departure", "pickup_departure"],
  load_description: ["load_description", "description", "goods", "load_details"], freight_amount: ["freight_amount", "freight", "price", "amount"],
  driver: ["driver", "driver_name", "driver_code"], vehicle: ["vehicle", "registration", "vehicle_registration", "fleet_code"],
  trailer: ["trailer", "trailer_code", "trailer_registration"], priority_level: ["priority_level", "priority"],
  loading_duration_mins: ["loading_duration_mins", "loading_minutes"], unloading_duration_mins: ["unloading_duration_mins", "unloading_minutes"]
};

export const JOB_CSV_HEADERS = ["client_name", "client_phone", "reference", "load_id", "pickup_address", "drop_address", "planned_departure", "loading_done_time", "load_description", "freight_amount", "driver", "vehicle", "trailer", "priority_level", "loading_duration_mins", "unloading_duration_mins"];
const normaliseHeader = value => String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

export function parseCsv(text) {
  const rows = []; let row = [], value = "", quoted = false;
  const source = String(text || "").replace(/^\uFEFF/, "");
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted && char === '"' && source[i + 1] === '"') { value += '"'; i += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { row.push(value.trim()); value = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) { if (char === "\r" && source[i + 1] === "\n") i += 1; row.push(value.trim()); if (row.some(cell => cell)) rows.push(row); row = []; value = ""; }
    else value += char;
  }
  row.push(value.trim()); if (row.some(cell => cell)) rows.push(row);
  return rows;
}

export function toLocalDateTime(value) {
  const raw = String(value || "").trim(); if (!raw) return "";
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})$/);
  const uk = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})\s+(\d{1,2}):(\d{2})$/);
  const parts = iso ? { year: iso[1], month: iso[2], day: iso[3], hour: iso[4], minute: iso[5] }
    : uk ? { year: uk[3], month: uk[2], day: uk[1], hour: uk[4], minute: uk[5] } : null;
  if (!parts) return "";
  const year = Number(parts.year), month = Number(parts.month), day = Number(parts.day), hour = Number(parts.hour), minute = Number(parts.minute);
  const test = new Date(year, month - 1, day, hour, minute);
  if (test.getFullYear() !== year || test.getMonth() !== month - 1 || test.getDate() !== day || hour > 23 || minute > 59) return "";
  return `${parts.year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function csvRowsToJobs(text) {
  const matrix = parseCsv(text); if (matrix.length < 2) throw new Error("CSV must contain a header row and at least one job row.");
  const headers = matrix[0].map(normaliseHeader), positions = {};
  Object.entries(HEADER_ALIASES).forEach(([field, aliases]) => { positions[field] = headers.findIndex(header => aliases.includes(header)); });
  if (Object.values(positions).filter(index => index >= 0).length < 3) throw new Error("CSV headings were not recognised. Download the template and use its headings.");
  return matrix.slice(1).map((cells, index) => {
    const get = field => positions[field] >= 0 ? String(cells[positions[field]] || "").trim() : "";
    return { _key: `${Date.now()}-${index}`, _sourceRow: index + 2, client_name: get("client_name"), client_phone: get("client_phone"), reference: get("reference"), load_id: get("load_id"), pickup_address: get("pickup_address"), drop_address: get("drop_address"), planned_departure: toLocalDateTime(get("planned_departure")), loading_done_time: toLocalDateTime(get("loading_done_time")), load_description: get("load_description"), freight_amount: get("freight_amount").replace(/[£,]/g, ""), driver: get("driver"), vehicle: get("vehicle"), trailer: get("trailer"), priority_level: get("priority_level").toLowerCase() || "standard", loading_duration_mins: get("loading_duration_mins") || "90", unloading_duration_mins: get("unloading_duration_mins") || "90", _rawPlanned: get("planned_departure"), _rawLoadingDone: get("loading_done_time"), _status: "pending", _serverError: "" };
  });
}

export function downloadJobCsvTemplate() {
  const example = ["Acme Ltd", "07123456789", "REF-1001", "LOAD-1001", "1 High Street, London SW1A 1AA", "10 King Street, Manchester M2 4AA", "17/09/2026 08:00", "17/09/2026 09:30", "Palletised goods", "850", "", "", "", "standard", "90", "90"];
  const csv = [JOB_CSV_HEADERS, example].map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); const link = document.createElement("a"); link.href = url; link.download = "jobs-import-template.csv"; link.click(); URL.revokeObjectURL(url);
}
