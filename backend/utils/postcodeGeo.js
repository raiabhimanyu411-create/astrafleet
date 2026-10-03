// UK postcode → coordinates for driver-app geofences, via postcodes.io (the same service the
// route map uses). Results are cached in their own table, so core job tables are never altered.
// Every failure degrades to "no coordinates": the panel still loads, only geofencing is skipped.
// Set POSTCODE_GEOCODING_ENABLED=false to stop all lookups.
const db = require("../db/connection");

const RETRY_FAILED_AFTER_DAYS = 7;
const LOOKUP_TIMEOUT_MS = 3000;
let schemaReady = null;

function ensureGeoSchema() {
  schemaReady ||= db.query(
    `CREATE TABLE IF NOT EXISTS postcode_coordinates (
      postcode VARCHAR(10) NOT NULL PRIMARY KEY,
      latitude DECIMAL(10,7) DEFAULT NULL,
      longitude DECIMAL(10,7) DEFAULT NULL,
      fetched_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB`
  ).catch(error => {
    schemaReady = null;
    throw error;
  });
  return schemaReady;
}

function extractUkPostcode(value) {
  const text = String(value || "").toUpperCase().replace(/\s+/g, " ");
  const match = text.match(/\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/);
  return match ? match[1].replace(/\s+/g, "") : "";
}

async function fetchFromPostcodesIo(postcodes) {
  const response = await fetch("https://api.postcodes.io/postcodes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ postcodes }),
    signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS)
  });
  if (!response.ok) throw new Error(`postcodes.io HTTP ${response.status}`);
  const data = await response.json();
  const found = new Map();
  for (const item of data?.result || []) {
    const key = String(item?.query || "").toUpperCase().replace(/\s+/g, "");
    const lat = Number(item?.result?.latitude);
    const lng = Number(item?.result?.longitude);
    found.set(key, Number.isFinite(lat) && Number.isFinite(lng) ? { latitude: lat, longitude: lng } : null);
  }
  return found;
}

// Returns Map<postcode, {latitude, longitude}> for every postcode that could be resolved.
async function coordinatesForPostcodes(postcodes) {
  const wanted = [...new Set(postcodes.filter(Boolean))];
  const resolved = new Map();
  if (!wanted.length || process.env.POSTCODE_GEOCODING_ENABLED === "false") return resolved;
  await ensureGeoSchema();

  const [rows] = await db.query(
    `SELECT postcode, latitude, longitude, fetched_at < DATE_SUB(NOW(), INTERVAL ? DAY) AS stale
     FROM postcode_coordinates WHERE postcode IN (?)`,
    [RETRY_FAILED_AFTER_DAYS, wanted]
  );
  const cached = new Set();
  for (const row of rows) {
    if (row.latitude != null && row.longitude != null) {
      resolved.set(row.postcode, { latitude: Number(row.latitude), longitude: Number(row.longitude) });
      cached.add(row.postcode);
    } else if (!Number(row.stale)) {
      cached.add(row.postcode); // recently confirmed unknown; don't ask again yet
    }
  }

  const missing = wanted.filter(postcode => !cached.has(postcode)).slice(0, 100);
  if (!missing.length) return resolved;
  const fetched = await fetchFromPostcodesIo(missing);
  for (const postcode of missing) {
    if (!fetched.has(postcode)) continue;
    const coordinate = fetched.get(postcode);
    if (coordinate) resolved.set(postcode, coordinate);
    await db.query(
      `INSERT INTO postcode_coordinates (postcode, latitude, longitude, fetched_at) VALUES (?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE latitude=VALUES(latitude), longitude=VALUES(longitude), fetched_at=NOW()`,
      [postcode, coordinate?.latitude ?? null, coordinate?.longitude ?? null]
    );
  }
  return resolved;
}

// Adds `coordinate` to each driver route point (and pickup/drop coordinates to the route) in place.
// Never throws: on any failure the jobs are returned exactly as they were.
async function attachJobCoordinates(jobs) {
  try {
    const points = jobs.flatMap(job => job.routePoints || []);
    const coordinates = await coordinatesForPostcodes(points.map(point => extractUkPostcode(point.address)));
    for (const job of jobs) {
      for (const point of job.routePoints || []) {
        const coordinate = coordinates.get(extractUkPostcode(point.address));
        if (coordinate) point.coordinate = coordinate;
      }
      const pickup = job.routePoints?.find(point => point.id === "pickup");
      const drop = job.routePoints?.find(point => point.isPrimaryDrop);
      if (pickup?.coordinate) job.route.pickupCoordinate = pickup.coordinate;
      if (drop?.coordinate) job.route.dropCoordinate = drop.coordinate;
    }
  } catch (error) {
    console.error("[Geo] Coordinates skipped:", error.message);
  }
  return jobs;
}

module.exports = { attachJobCoordinates, coordinatesForPostcodes, extractUkPostcode };
