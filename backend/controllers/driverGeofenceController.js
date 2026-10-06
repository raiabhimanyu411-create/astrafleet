// Automatic arrival/departure times from the driver app's geofences.
// Rules: an event only ever fills or refines a *time*; job and stop *statuses* still change only when the
// driver confirms in the app. An "enter" is applied only to the point the driver is due at next, so driving
// past a later drop never stamps it. Every event is kept in job_geofence_events for audit, applied or not.
const db = require("../db/connection");
const { getDriverFromSession } = require("./driverController");
const { emitJobUpdate } = require("../realtime");
const { dateTimeKey, isDateTimeKey, ukNowDateTimeKey, wallMinutesBetween } = require("../utils/jobDateTimes");

let schemaReady = null;

async function addColumnIfMissing(table, column, definition) {
  const [rows] = await db.query(`SHOW COLUMNS FROM ${table} LIKE ?`, [column]);
  if (rows.length) return;
  try {
    await db.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  } catch (error) {
    if (error.code !== "ER_DUP_FIELDNAME") throw error;
  }
}

function ensureGeofenceSchema() {
  schemaReady ||= (async () => {
    await db.query(
      `CREATE TABLE IF NOT EXISTS job_geofence_events (
        id INT AUTO_INCREMENT PRIMARY KEY,
        trip_id INT NOT NULL,
        driver_id INT NOT NULL,
        point_key VARCHAR(40) NOT NULL,
        event_type ENUM('enter','exit') NOT NULL,
        occurred_at DATETIME NOT NULL,
        latitude DECIMAL(10,7) DEFAULT NULL,
        longitude DECIMAL(10,7) DEFAULT NULL,
        accuracy_m DECIMAL(8,2) DEFAULT NULL,
        applied TINYINT(1) NOT NULL DEFAULT 0,
        note VARCHAR(160) DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_geofence_trip (trip_id, occurred_at)
      ) ENGINE=InnoDB`
    );
    // Nullable additions: pickup has no arrival column and Drop 1 only records "completed", not "left".
    await addColumnIfMissing("trips", "pickup_arrived_at", "DATETIME DEFAULT NULL");
    await addColumnIfMissing("trips", "primary_drop_departed_at", "DATETIME DEFAULT NULL");
  })().catch(error => {
    schemaReady = null;
    throw error;
  });
  return schemaReady;
}

// Phones often send ISO instants ("2026-07-01T20:59:00.000Z" or "+01:00"); convert those to UK wall time
// instead of falling back to the upload time, which would mis-stamp events recorded offline.
function instantToUkKey(value) {
  if (typeof value !== "string" || !/(Z|[+-]\d{2}:?\d{2})$/i.test(value.trim())) return null;
  const instant = new Date(value);
  return Number.isNaN(instant.getTime()) ? null : ukNowDateTimeKey(instant);
}

const notBefore = (later, earlier) => !earlier || (wallMinutesBetween(earlier, later) ?? -1) >= 0;

// Decides what an event changes. Returns { sql, params, note } or { note } when nothing is applied.
// An "exit" only refines a departure while the driver hasn't reached the next point yet, so coming back
// near an earlier point later (e.g. the return-to-yard stop shares the pickup postcode) never rewrites it.
async function planUpdate(trip, pointKey, eventType, at) {
  const status = trip.driver_job_status || "accepted";
  const [stops] = await db.query(`SELECT id, stop_order, status, actual_arrival FROM job_stops WHERE trip_id=? ORDER BY stop_order ASC`, [trip.id]);
  const anyStopReached = stops.some(row => row.actual_arrival || row.status !== "pending");

  if (pointKey === "pickup") {
    if (eventType === "enter") {
      if (!["offered", "accepted", "arrived_pickup"].includes(status)) return { note: "Pickup already left" };
      return { sql: `UPDATE trips SET pickup_arrived_at=COALESCE(pickup_arrived_at, ?) WHERE id=?`, params: [at, trip.id], note: "Pickup arrival" };
    }
    if (!["loaded", "in_transit"].includes(status) || trip.primary_drop_arrived_at) return { note: "Not leaving pickup" };
    if (!notBefore(at, trip.pickup_arrived_at)) return { note: "Exit before arrival" };
    return { sql: `UPDATE trips SET actual_departure=? WHERE id=?`, params: [at, trip.id], note: "Pickup departure" };
  }

  if (pointKey === "drop-1") {
    if (eventType === "enter") {
      if (!["loaded", "in_transit", "arrived_drop"].includes(status) || trip.primary_drop_status === "completed") return { note: "Drop 1 not next" };
      return { sql: `UPDATE trips SET primary_drop_arrived_at=COALESCE(primary_drop_arrived_at, ?) WHERE id=?`, params: [at, trip.id], note: "Drop 1 arrival" };
    }
    if (!trip.primary_drop_arrived_at || !notBefore(at, trip.primary_drop_arrived_at)) return { note: "Drop 1 not arrived" };
    if (anyStopReached) return { note: "Already past Drop 1" };
    return { sql: `UPDATE trips SET primary_drop_departed_at=? WHERE id=?`, params: [at, trip.id], note: "Drop 1 departure" };
  }

  const stopId = Number(pointKey);
  if (!Number.isInteger(stopId)) return { note: "Unknown point" };
  const stop = stops.find(row => Number(row.id) === stopId);
  if (!stop) return { note: "Stop not on this job" };

  if (eventType === "enter") {
    // The driver must have finished the previous point; passing near a later drop while still unloading
    // at an earlier one must not stamp it.
    const drop1Done = trip.primary_drop_status === "completed";
    const earlierOpen = stops.some(row => row.stop_order < stop.stop_order && !["completed", "skipped"].includes(row.status));
    if (stop.status !== "pending" || !drop1Done || earlierOpen) return { note: "Stop not next" };
    return { sql: `UPDATE job_stops SET actual_arrival=COALESCE(actual_arrival, ?) WHERE id=? AND trip_id=?`, params: [at, stopId, trip.id], note: "Stop arrival" };
  }
  if (!stop.actual_arrival || !notBefore(at, stop.actual_arrival)) return { note: "Stop not arrived" };
  if (stops.some(row => row.stop_order > stop.stop_order && (row.actual_arrival || row.status !== "pending"))) return { note: "Already past this stop" };
  return { sql: `UPDATE job_stops SET actual_departure=? WHERE id=? AND trip_id=?`, params: [at, stopId, trip.id], note: "Stop departure" };
}

// POST /api/drivers/me/jobs/:jobId/geofence-events
exports.recordGeofenceEvent = async (req, res) => {
  try {
    await ensureGeofenceSchema();
    const driver = await getDriverFromSession(req);
    if (!driver) return res.status(404).json({ message: "Driver profile not linked to this login." });

    const { pointId, event, occurredAt, latitude, longitude, accuracy } = req.body || {};
    const pointKey = String(pointId ?? "").slice(0, 40);
    if (!pointKey || !["enter", "exit"].includes(event)) return res.status(400).json({ message: "pointId and event (enter/exit) are required." });
    // Offline events arrive late, so the phone's UK time is used — but never from the future or over a day old.
    const now = ukNowDateTimeKey();
    const at = isDateTimeKey(occurredAt) ? dateTimeKey(occurredAt) : instantToUkKey(occurredAt) || now;
    const age = wallMinutesBetween(at, now);
    if (age == null || age < -2 || age > 24 * 60) return res.status(400).json({ message: "occurredAt must be a UK date-time within the last 24 hours." });

    const [[trip]] = await db.query(
      `SELECT id, driver_job_status, dispatch_status, primary_drop_status, primary_drop_arrived_at, pickup_arrived_at
       FROM trips WHERE id=? AND driver_id=? AND deleted_at IS NULL`,
      [req.params.jobId, driver.id]
    );
    if (!trip) return res.status(404).json({ message: "Assigned job not found." });

    const closed = ["completed", "cancelled", "blocked", "failed"].includes(trip.dispatch_status);
    const plan = closed ? { note: "Job closed" } : await planUpdate(trip, pointKey, event, at);
    // changedRows is 0 when the time was already recorded (e.g. a repeated "enter"), so it isn't reported as new.
    const applied = plan.sql ? Number((await db.query(plan.sql, plan.params))[0]?.changedRows) > 0 : false;

    const num = value => (Number.isFinite(Number(value)) ? Number(value) : null);
    await db.query(
      `INSERT INTO job_geofence_events (trip_id, driver_id, point_key, event_type, occurred_at, latitude, longitude, accuracy_m, applied, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [trip.id, driver.id, pointKey, event, at, num(latitude), num(longitude), num(accuracy), applied ? 1 : 0, plan.note]
    );
    if (applied) emitJobUpdate({ jobId: Number(trip.id), source: "driver-geofence", pointId: pointKey, event });

    res.status(201).json({ applied, message: plan.note });
  } catch (err) {
    res.status(500).json({ message: "Geofence event error", error: err.message });
  }
};

exports.ensureGeofenceSchema = ensureGeofenceSchema;
exports.__test = { planUpdate, instantToUkKey };
