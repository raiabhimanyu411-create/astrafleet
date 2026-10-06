// Planned vs actual arrival/departure for every point of a job (Pickup, Drop 1, further stops), for the
// admin job detail page. Each actual time is tagged "GPS" when it came from a driver-app geofence event,
// otherwise "Driver" (recorded by a tap). Never throws: on any failure the page simply gets empty lists.
const db = require("../db/connection");
const { dateTimeKey, fmtUkDateTime } = require("./jobDateTimes");
const { buildJobPoints } = require("./jobPunctuality");

const STOP_TONE = { pending: "neutral", arrived: "warning", completed: "success", skipped: "danger" };
const STATUS_LABEL = { pending: "Pending", arrived: "Arrived", completed: "Completed", skipped: "Skipped" };

async function loadGeofenceEvents(tripId) {
  try {
    const [rows] = await db.query(
      `SELECT point_key, event_type, occurred_at, applied, note FROM job_geofence_events WHERE trip_id=? ORDER BY occurred_at DESC, id DESC LIMIT 100`,
      [tripId]
    );
    return rows;
  } catch (error) {
    if (error.code === "ER_NO_SUCH_TABLE") return []; // no driver-app geofence event has been received yet
    throw error;
  }
}

async function buildRouteProgress(trip, stops, statusEvents = [], punctuality = null) {
  try {
    const events = await loadGeofenceEvents(trip.id);
    const source = (pointKey, eventType, value) => {
      if (!value) return null;
      const key = dateTimeKey(value);
      const fromGps = events.some(e => Number(e.applied) && e.point_key === pointKey && e.event_type === eventType && dateTimeKey(e.occurred_at) === key);
      return fromGps ? "GPS" : "Driver";
    };
    const assessed = punctuality?.points || buildJobPoints(trip, stops, statusEvents);
    const routeProgress = assessed.map(point => ({
      key: point.key,
      label: point.label,
      kind: point.kind,
      address: point.key === "pickup" ? trip.pickup_address || trip.origin_hub || "—"
        : point.key === "drop-1" ? trip.drop_address || trip.destination_hub || "—"
        : stops.find(stop => String(stop.id) === point.key)?.address || "—",
      status: point.status,
      statusLabel: STATUS_LABEL[point.status] || point.status,
      tone: STOP_TONE[point.status] || "neutral",
      plannedArrival: fmtUkDateTime(point.plannedArrival),
      plannedDeparture: fmtUkDateTime(point.plannedDeparture),
      actualArrival: fmtUkDateTime(point.actualArrival),
      actualDeparture: fmtUkDateTime(point.actualDeparture),
      arrivalSource: source(point.key, "enter", point.actualArrival),
      departureSource: source(point.key, "exit", point.actualDeparture),
      arrivalDelayMins: point.arrivalDelayMins ?? null,
      departureDelayMins: point.departureDelayMins ?? null,
      overdue: point.overdue ?? null,
      state: point.state ?? null,
      lateMins: point.lateMins ?? null,
      warnings: point.warnings || []
    }));

    const labels = new Map(routeProgress.map(p => [p.key, p.label]));
    const geofenceEvents = events.map(e => ({
      at: fmtUkDateTime(e.occurred_at),
      point: labels.get(e.point_key) || `Point ${e.point_key}`,
      event: e.event_type === "enter" ? "Arrived" : "Left",
      applied: Boolean(Number(e.applied)),
      note: e.note || ""
    }));
    return { routeProgress, geofenceEvents };
  } catch (error) {
    console.error("[Route progress] Skipped:", error.message);
    return { routeProgress: [], geofenceEvents: [] };
  }
}

module.exports = { buildRouteProgress };
