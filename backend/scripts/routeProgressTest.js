const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

let events = [];
let failWith = null;
require.cache[path.resolve(__dirname, "../db/connection.js")] = {
  exports: {
    async query(sql) {
      if (failWith) { const error = new Error(failWith); error.code = failWith; throw error; }
      if (/FROM job_geofence_events/.test(sql)) return [events];
      throw new Error(`Unexpected query: ${sql}`);
    }
  }
};
const { buildRouteProgress } = require("../utils/routeProgress");

const trip = {
  id: 7, driver_job_status: "in_transit", pickup_address: "12 Trafford Park Road, Manchester M17 1HG", drop_address: "8 Atlantic Way, Liverpool L3 4BE",
  planned_departure: "2026-07-15 06:00:00", loading_done_time: "2026-07-15 06:30:00", calculated_arrival: "2026-07-15 07:30:00", calculated_unload_end: "2026-07-15 08:00:00",
  pickup_arrived_at: "2026-07-15 06:05:00", actual_departure: "2026-07-15 06:40:00",
  primary_drop_status: "completed", primary_drop_arrived_at: "2026-07-15 07:31:00", primary_drop_completed_at: "2026-07-15 07:50:00", primary_drop_departed_at: null
};
const stops = [
  { id: 71, stop_order: 1, address: "5 Wall Street, Liverpool L1 8JQ", status: "arrived", actual_arrival: "2026-07-15 08:10:00", actual_departure: null },
  { id: 72, stop_order: 2, address: "Yard, Manchester M17 1HG", status: "pending", actual_arrival: null, actual_departure: null }
];

test.beforeEach(() => { failWith = null; events = []; });

test("every point in order with planned and actual times, GPS vs driver source", async () => {
  events = [
    { point_key: "pickup", event_type: "enter", occurred_at: "2026-07-15 06:05:00", applied: 1, note: "Pickup arrival" },
    { point_key: "pickup", event_type: "exit", occurred_at: "2026-07-15 06:40:00", applied: 1, note: "Pickup departure" },
    { point_key: "71", event_type: "enter", occurred_at: "2026-07-15 08:10:00", applied: 1, note: "Stop arrival" },
    { point_key: "72", event_type: "enter", occurred_at: "2026-07-15 07:20:00", applied: 0, note: "Stop not next" }
  ];
  const { routeProgress, geofenceEvents } = await buildRouteProgress(trip, stops, null);
  assert.deepEqual(routeProgress.map(p => p.label), ["Pickup", "Drop 1", "Drop 2", "Return point"]);
  assert.deepEqual(routeProgress.map(p => p.status), ["completed", "completed", "arrived", "pending"]);
  const [pickup, drop1, drop2, back] = routeProgress;
  assert.equal(pickup.actualArrival, "15 Jul 2026, 06:05");
  assert.equal(pickup.arrivalSource, "GPS");
  assert.equal(pickup.departureSource, "GPS");
  assert.equal(pickup.plannedDeparture, "15 Jul 2026, 06:30");
  assert.equal(drop1.actualArrival, "15 Jul 2026, 07:31");
  assert.equal(drop1.arrivalSource, "Driver", "no geofence event, so it was a tap");
  assert.equal(drop1.actualDeparture, "15 Jul 2026, 07:50");
  assert.equal(drop2.arrivalSource, "GPS");
  assert.equal(drop2.actualDeparture, "—");
  assert.equal(drop2.departureSource, null);
  assert.equal(back.arrivalSource, null, "ignored events never count as a source");
  assert.equal(geofenceEvents.length, 4);
  assert.deepEqual(geofenceEvents[3], { at: "15 Jul 2026, 07:20", point: "Return point", event: "Arrived", applied: false, note: "Stop not next" });
});

test("geofence departure from Drop 1 wins over the completion tap", async () => {
  const { routeProgress } = await buildRouteProgress({ ...trip, primary_drop_departed_at: "2026-07-15 07:55:00" }, stops, null);
  assert.equal(routeProgress[1].actualDeparture, "15 Jul 2026, 07:55");
});

test("jobs from before the driver app still show, using the status-event pickup arrival", async () => {
  failWith = "ER_NO_SUCH_TABLE";
  const { routeProgress, geofenceEvents } = await buildRouteProgress({ ...trip, pickup_arrived_at: undefined }, [], "2026-07-15 06:07:00");
  assert.equal(routeProgress.length, 2);
  assert.equal(routeProgress[0].actualArrival, "15 Jul 2026, 06:07");
  assert.equal(routeProgress[0].arrivalSource, "Driver");
  assert.deepEqual(geofenceEvents, []);
});

test("an unexpected database error never breaks the job page", async () => {
  failWith = "ER_LOCK_WAIT_TIMEOUT";
  const original = console.error;
  console.error = () => {};
  try {
    assert.deepEqual(await buildRouteProgress(trip, stops, null), { routeProgress: [], geofenceEvents: [] });
  } finally {
    console.error = original;
  }
});
