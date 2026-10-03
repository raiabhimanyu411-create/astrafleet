// Planned vs actual arrival/departure for every point of a job (Pickup, Drop 1, further stops), for the
// admin job detail page. Each actual time is tagged "GPS" when it came from a driver-app geofence event,
// otherwise "Driver" (recorded by a tap). Never throws: on any failure the page simply gets empty lists.
const db = require("../db/connection");
const { dateTimeKey, fmtUkDateTime } = require("./jobDateTimes");
const { extractUkPostcode } = require("./postcodeGeo");

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

function pickupStatus(driverStatus, trip) {
  if (["in_transit", "arrived_drop", "delivered"].includes(driverStatus)) return "completed";
  if (["arrived_pickup", "loaded"].includes(driverStatus)) return "arrived";
  return trip.actual_departure ? "completed" : "pending";
}

async function buildRouteProgress(trip, stops, firstPickupArrivalEvent) {
  try {
    const events = await loadGeofenceEvents(trip.id);
    const source = (pointKey, eventType, value) => {
      if (!value) return null;
      const key = dateTimeKey(value);
      const fromGps = events.some(e => Number(e.applied) && e.point_key === pointKey && e.event_type === eventType && dateTimeKey(e.occurred_at) === key);
      return fromGps ? "GPS" : "Driver";
    };
    const point = (pointKey, label, address, status, planned, actual) => ({
      key: pointKey,
      label,
      address: address || "—",
      status,
      statusLabel: STATUS_LABEL[status] || status,
      tone: STOP_TONE[status] || "neutral",
      plannedArrival: fmtUkDateTime(planned.arrival),
      plannedDeparture: fmtUkDateTime(planned.departure),
      actualArrival: fmtUkDateTime(actual.arrival),
      actualDeparture: fmtUkDateTime(actual.departure),
      arrivalSource: source(pointKey, "enter", actual.arrival),
      departureSource: source(pointKey, "exit", actual.departure)
    });

    const driverStatus = trip.driver_job_status || "accepted";
    const pickupAddress = trip.pickup_address || trip.origin_hub;
    const drop1Status = trip.primary_drop_status === "completed" || driverStatus === "delivered"
      ? "completed"
      : trip.primary_drop_status === "arrived" || driverStatus === "arrived_drop" ? "arrived" : "pending";
    const pickupPostcode = extractUkPostcode(pickupAddress);
    const lastStopId = stops.length ? stops[stops.length - 1].id : null;

    const routeProgress = [
      point("pickup", "Pickup", pickupAddress, pickupStatus(driverStatus, trip),
        { arrival: trip.planned_departure, departure: trip.loading_done_time },
        { arrival: trip.pickup_arrived_at || firstPickupArrivalEvent, departure: trip.actual_departure }),
      point("drop-1", "Drop 1", trip.drop_address || trip.destination_hub, drop1Status,
        { arrival: trip.calculated_arrival || trip.eta, departure: trip.calculated_unload_end },
        { arrival: trip.primary_drop_arrived_at, departure: trip.primary_drop_departed_at || trip.primary_drop_completed_at }),
      ...stops.map((stop, index) => {
        const isReturn = stop.id === lastStopId && pickupPostcode && extractUkPostcode(stop.address) === pickupPostcode;
        return point(String(stop.id), isReturn ? "Return point" : `Drop ${index + 2}`, stop.address, stop.status || "pending",
          { arrival: stop.planned_arrival, departure: stop.planned_departure },
          { arrival: stop.actual_arrival, departure: stop.actual_departure });
      })
    ];

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
