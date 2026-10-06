// Planned vs actual for every point of a job (Pickup, Drop 1, further stops), with how late each one is.
// All values are UK wall-clock keys ("YYYY-MM-DDTHH:mm"), the same format the trips table stores.
const { dateTimeKey, ukNowDateTimeKey, wallMinutesBetween } = require("./jobDateTimes");
const { extractUkPostcode } = require("./postcodeGeo");

// Up to this many minutes behind plan still counts as on time.
const LATE_GRACE_MINS = 15;
// A leg driven in under this share of its planned time is flagged as an implausible recording.
const MIN_PLAUSIBLE_TRAVEL_SHARE = 0.25;
const OPEN_STATUSES = new Set(["planned", "loading", "active"]);

const key = value => (value ? dateTimeKey(value) || null : null);

function firstEventAt(events, status) {
  const match = (events || []).find(event => event.status === status);
  return match ? key(match.created_at) : null;
}

function pickupStatus(trip) {
  const status = trip.driver_job_status || "accepted";
  if (["in_transit", "arrived_drop", "delivered"].includes(status) || trip.actual_departure) return "completed";
  if (["arrived_pickup", "loaded"].includes(status)) return "arrived";
  return "pending";
}

function drop1Status(trip) {
  if (trip.primary_drop_status === "completed" || trip.driver_job_status === "delivered") return "completed";
  if (trip.primary_drop_status === "arrived" || trip.driver_job_status === "arrived_drop") return "arrived";
  return "pending";
}

function isReturnPoint(stop, pickupPostcode, lastStopId) {
  return Boolean(pickupPostcode) && stop.id === lastStopId && extractUkPostcode(stop.address) === pickupPostcode;
}

// One entry per point, in route order. `events` are driver_job_status_events rows for the trip; they back up
// the pickup and Drop 1 arrival when the dedicated column was never written.
function buildJobPoints(trip, stops = [], events = []) {
  const pickupPostcode = extractUkPostcode(trip.pickup_address || trip.origin_hub);
  const lastStopId = stops.length ? stops[stops.length - 1].id : null;
  let dropNumber = 1;

  return [
    {
      key: "pickup",
      label: "Collection",
      kind: "pickup",
      status: pickupStatus(trip),
      plannedArrival: key(trip.planned_departure),
      plannedDeparture: key(trip.loading_done_time),
      actualArrival: key(trip.pickup_arrived_at) || firstEventAt(events, "arrived_pickup"),
      actualDeparture: key(trip.actual_departure)
    },
    {
      key: "drop-1",
      label: "Drop 1",
      kind: "drop",
      status: drop1Status(trip),
      plannedArrival: key(trip.calculated_arrival) || key(trip.eta),
      plannedDeparture: key(trip.calculated_unload_end),
      actualArrival: key(trip.primary_drop_arrived_at) || firstEventAt(events, "arrived_drop"),
      actualDeparture: key(trip.primary_drop_departed_at) || key(trip.primary_drop_completed_at)
    },
    ...stops.map(stop => {
      const isReturn = isReturnPoint(stop, pickupPostcode, lastStopId);
      if (!isReturn && stop.stop_type !== "waypoint") dropNumber += 1;
      return {
        key: String(stop.id),
        label: isReturn ? "Return point" : stop.stop_type === "waypoint" ? "Waypoint" : `Drop ${dropNumber}`,
        kind: isReturn ? "return" : stop.stop_type === "waypoint" ? "waypoint" : "drop",
        status: stop.status || "pending",
        plannedArrival: key(stop.planned_arrival),
        plannedDeparture: key(stop.planned_departure),
        actualArrival: key(stop.actual_arrival),
        actualDeparture: key(stop.actual_departure)
      };
    })
  ];
}

function delay(planned, actual) {
  if (!planned || !actual) return null;
  return wallMinutesBetween(planned, actual);
}

// Adds lateness to every point and a job-level summary naming the worst point.
//   arrivalDelayMins / departureDelayMins: actual minus planned (negative = early)
//   overdueMins: no actual yet and the planned time has already passed (open jobs only)
function assessPunctuality(points, { dispatchStatus, now = ukNowDateTimeKey() } = {}) {
  const jobOpen = OPEN_STATUSES.has(dispatchStatus);
  let previous = null;

  const assessed = points.map(point => {
    const arrivalDelayMins = delay(point.plannedArrival, point.actualArrival);
    const departureDelayMins = delay(point.plannedDeparture, point.actualDeparture);
    const finished = ["completed", "skipped"].includes(point.status);
    let overdue = null;
    if (jobOpen && !finished) {
      if (!point.actualArrival && point.plannedArrival) {
        const mins = wallMinutesBetween(point.plannedArrival, now);
        if (mins > LATE_GRACE_MINS) overdue = { type: "arrival", mins };
      } else if (point.actualArrival && !point.actualDeparture && point.plannedDeparture) {
        const mins = wallMinutesBetween(point.plannedDeparture, now);
        if (mins > LATE_GRACE_MINS) overdue = { type: "departure", mins };
      }
    }

    const warnings = [];
    if (previous?.actualDeparture && point.actualArrival) {
      const actualLeg = wallMinutesBetween(previous.actualDeparture, point.actualArrival);
      const plannedLeg = wallMinutesBetween(previous.plannedDeparture, point.plannedArrival);
      if (actualLeg != null && actualLeg < 0) {
        warnings.push(`Arrival recorded before leaving ${previous.label}.`);
      } else if (actualLeg != null && plannedLeg >= 20 && actualLeg < plannedLeg * MIN_PLAUSIBLE_TRAVEL_SHARE) {
        warnings.push(`Arrived ${actualLeg} min after leaving ${previous.label}; planned ${plannedLeg} min.`);
      }
    }
    if (point.status === "skipped") warnings.push("Stop was skipped.");

    const lateMins = Math.max(
      arrivalDelayMins ?? -Infinity,
      departureDelayMins ?? -Infinity,
      overdue?.mins ?? -Infinity
    );
    const state = overdue ? "overdue"
      : Number.isFinite(lateMins) && lateMins > LATE_GRACE_MINS ? "late"
      : point.actualArrival || point.actualDeparture ? "on_time"
      : "pending";

    previous = point;
    return { ...point, arrivalDelayMins, departureDelayMins, overdue, warnings, state, lateMins: Number.isFinite(lateMins) ? lateMins : null };
  });

  const problems = assessed.filter(point => point.state === "late" || point.state === "overdue");
  const worst = problems.reduce((acc, point) => (!acc || point.lateMins > acc.lateMins ? point : acc), null);
  return {
    graceMins: LATE_GRACE_MINS,
    points: assessed,
    summary: {
      state: worst ? worst.state : assessed.some(point => point.state === "on_time") ? "on_time" : "pending",
      lateCount: problems.length,
      worstPoint: worst ? { key: worst.key, label: worst.label, mins: worst.lateMins, state: worst.state } : null,
      warningCount: assessed.reduce((sum, point) => sum + point.warnings.length, 0)
    }
  };
}

// Minutes between the first and last recorded actual time on the job, or null when not available.
function actualDurationMins(points) {
  const times = points.flatMap(point => [point.actualArrival, point.actualDeparture]).filter(Boolean).sort();
  if (times.length < 2) return null;
  const mins = wallMinutesBetween(times[0], times[times.length - 1]);
  return mins != null && mins > 0 ? mins : null;
}

module.exports = { LATE_GRACE_MINS, actualDurationMins, assessPunctuality, buildJobPoints };
