const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

// In-memory stand-in for MySQL so the geofence and postcode rules run without a database.
let stops = [];
const geoCache = new Map();
const fakeDb = {
  async query(sql, params = []) {
    if (/CREATE TABLE|SHOW COLUMNS|ALTER TABLE/.test(sql)) return [[{}]];
    if (/FROM job_stops WHERE trip_id/.test(sql)) return [stops];
    if (/FROM postcode_coordinates/.test(sql)) return [[...geoCache].filter(([pc]) => params[1].includes(pc)).map(([postcode, c]) => ({ postcode, ...c, stale: 0 }))];
    if (/INSERT INTO postcode_coordinates/.test(sql)) { geoCache.set(params[0], { latitude: params[1], longitude: params[2] }); return [{}]; }
    throw new Error(`Unexpected query: ${sql}`);
  }
};
require.cache[path.resolve(__dirname, "../db/connection.js")] = { exports: fakeDb };
require.cache[path.resolve(__dirname, "../controllers/driverController.js")] = { exports: { getDriverFromSession: async () => null } };

const { __test: { planUpdate } } = require("../controllers/driverGeofenceController");
const { attachJobCoordinates } = require("../utils/postcodeGeo");

const trip = overrides => ({ id: 7, driver_job_status: "accepted", primary_drop_status: "pending", primary_drop_arrived_at: null, pickup_arrived_at: null, ...overrides });
const at = "2026-07-15T10:30";
const applied = plan => Boolean(plan.sql);

test.beforeEach(() => {
  stops = [
    { id: 71, stop_order: 1, status: "pending", actual_arrival: null },
    { id: 72, stop_order: 2, status: "pending", actual_arrival: null }
  ];
});

test("pickup: arrival before loading, departure only while leaving with the load", async () => {
  assert.ok(applied(await planUpdate(trip(), "pickup", "enter", at)));
  assert.ok(applied(await planUpdate(trip({ driver_job_status: "loaded", pickup_arrived_at: "2026-07-15 10:00:00" }), "pickup", "exit", at)));
  assert.ok(!applied(await planUpdate(trip({ driver_job_status: "arrived_pickup" }), "pickup", "exit", at)), "not loaded yet");
  assert.ok(!applied(await planUpdate(trip({ driver_job_status: "loaded", pickup_arrived_at: "2026-07-15 11:00:00" }), "pickup", "exit", at)), "exit before arrival");
});

test("returning to the yard never rewrites the pickup departure", async () => {
  const back = trip({ driver_job_status: "arrived_drop", primary_drop_status: "completed", primary_drop_arrived_at: "2026-07-15 09:00:00" });
  assert.ok(!applied(await planUpdate(back, "pickup", "enter", at)));
  assert.ok(!applied(await planUpdate({ ...back, driver_job_status: "in_transit" }, "pickup", "exit", at)));
});

test("Drop 1: arrival once in transit, departure until the next stop is reached", async () => {
  assert.ok(!applied(await planUpdate(trip(), "drop-1", "enter", at)), "still before pickup");
  assert.ok(applied(await planUpdate(trip({ driver_job_status: "in_transit" }), "drop-1", "enter", at)));
  assert.ok(!applied(await planUpdate(trip({ driver_job_status: "in_transit", primary_drop_status: "completed" }), "drop-1", "enter", at)));
  const atDrop = trip({ driver_job_status: "arrived_drop", primary_drop_status: "arrived", primary_drop_arrived_at: "2026-07-15 10:00:00" });
  assert.ok(applied(await planUpdate(atDrop, "drop-1", "exit", at)));
  stops[0].actual_arrival = "2026-07-15 10:20:00";
  assert.ok(!applied(await planUpdate(atDrop, "drop-1", "exit", at)), "already at Drop 2");
});

test("further drops: only the next unvisited stop gets an arrival", async () => {
  const afterDrop1 = trip({ driver_job_status: "in_transit", primary_drop_status: "completed", primary_drop_arrived_at: "2026-07-15 10:00:00" });
  assert.ok(!applied(await planUpdate(afterDrop1, "72", "enter", at)), "driving past Drop 3 first");
  assert.ok(applied(await planUpdate(afterDrop1, "71", "enter", at)));
  assert.ok(!applied(await planUpdate(trip({ driver_job_status: "in_transit" }), "71", "enter", at)), "Drop 1 not reached yet");
  assert.ok(!applied(await planUpdate(afterDrop1, "999", "enter", at)), "stop from another job");
});

test("stop departure needs an arrival and stops once the next stop is reached", async () => {
  const afterDrop1 = trip({ driver_job_status: "in_transit", primary_drop_status: "completed" });
  assert.ok(!applied(await planUpdate(afterDrop1, "71", "exit", at)), "never arrived");
  stops[0] = { ...stops[0], status: "arrived", actual_arrival: "2026-07-15 10:10:00" };
  assert.ok(applied(await planUpdate(afterDrop1, "71", "exit", at)));
  stops[1] = { ...stops[1], status: "arrived", actual_arrival: "2026-07-15 10:40:00" };
  assert.ok(!applied(await planUpdate(afterDrop1, "71", "exit", at)), "already at Drop 3");
});

test("route points get coordinates from UK postcodes, cached after the first lookup", async () => {
  let calls = 0;
  global.fetch = async (_url, options) => {
    calls++;
    const { postcodes } = JSON.parse(options.body);
    return { ok: true, json: async () => ({ result: postcodes.map(query => ({ query, result: query === "ZZ99ZZ" ? null : { latitude: 53.4, longitude: -2.3 } })) }) };
  };
  const job = () => ({ route: {}, routePoints: [{ id: "pickup", address: "12 Trafford Park Road, Manchester M17 1HG" }, { id: "drop-1", isPrimaryDrop: true, address: "8 Atlantic Way, Liverpool l3 4be" }, { id: 71, address: "Unknown ZZ9 9ZZ" }, { id: 72, address: "No postcode here" }] });
  const [first] = await attachJobCoordinates([job()]);
  assert.deepEqual(first.routePoints[0].coordinate, { latitude: 53.4, longitude: -2.3 });
  assert.deepEqual(first.route.dropCoordinate, { latitude: 53.4, longitude: -2.3 });
  assert.equal(first.routePoints[2].coordinate, undefined);
  assert.equal(first.routePoints[3].coordinate, undefined);
  await attachJobCoordinates([job()]);
  assert.equal(calls, 1, "second panel load is served from the cache");
});

test("postcodes.io outages and the off switch leave jobs untouched", async () => {
  geoCache.clear();
  const original = console.error;
  console.error = () => {};
  try {
    global.fetch = async () => { throw new Error("network down"); };
    const [job] = await attachJobCoordinates([{ route: {}, routePoints: [{ id: "pickup", address: "BL3 6DG" }] }]);
    assert.equal(job.routePoints[0].coordinate, undefined);
  } finally {
    console.error = original;
  }
  process.env.POSTCODE_GEOCODING_ENABLED = "false";
  try {
    global.fetch = async () => { throw new Error("must not be called"); };
    const [job] = await attachJobCoordinates([{ route: {}, routePoints: [{ id: "pickup", address: "BL3 6DG" }] }]);
    assert.equal(job.routePoints[0].coordinate, undefined);
  } finally {
    delete process.env.POSTCODE_GEOCODING_ENABLED;
  }
});
