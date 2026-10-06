const test = require("node:test");
const assert = require("node:assert/strict");
const {
  addWallMinutes,
  dateTimeKey,
  fmtUkDateTime,
  isDateTimeKey,
  ukNowDateTimeKey,
  wallMinutesBetween
} = require("../utils/jobDateTimes");
const { __test } = require("../controllers/jobController");

test("UK current time follows London DST and not the server timezone", () => {
  assert.equal(ukNowDateTimeKey(new Date("2026-01-15T12:30:00Z")), "2026-01-15T12:30");
  assert.equal(ukNowDateTimeKey(new Date("2026-07-15T12:30:00Z")), "2026-07-15T13:30");
});

test("job wall-clock values round-trip without a browser or server offset", () => {
  assert.equal(dateTimeKey("2026-09-14 08:05:59"), "2026-09-14T08:05");
  assert.equal(fmtUkDateTime("2026-09-14T08:05"), "14 Sept 2026, 08:05");
  assert.equal(addWallMinutes("2026-09-14T23:45", 30), "2026-09-15T00:15");
  assert.equal(wallMinutesBetween("2026-09-14T08:00", "2026-09-14T10:30"), 150);
});

test("invalid calendar and clock values are rejected", () => {
  assert.equal(isDateTimeKey("2026-02-30T10:00"), false);
  assert.equal(isDateTimeKey("2026-09-14T24:00"), false);
  assert.equal(isDateTimeKey("2026-09-14T09:15"), true);
  assert.equal(isDateTimeKey("2026-03-29T01:30"), false, "nonexistent BST spring-forward time");
  assert.equal(isDateTimeKey("2026-10-25T01:30"), false, "ambiguous GMT/BST fall-back time");
});

test("UK elapsed minutes follow GMT and BST transitions", () => {
  assert.equal(wallMinutesBetween("2026-03-29T00:30", "2026-03-29T02:30"), 60);
  assert.equal(addWallMinutes("2026-03-29T00:30", 60), "2026-03-29T02:30");
  assert.equal(wallMinutesBetween("2026-10-25T00:30", "2026-10-25T02:30"), 180);
});

test("job chronology rejects mismatched collection, delivery and stop times", () => {
  assert.equal(__test.validateJobTiming({
    planned_departure: "2026-09-14T10:00",
    loading_done_time: "2026-09-14T09:45"
  }), "Collection departure cannot be before collection arrival.");
  assert.equal(__test.validateJobTiming({
    calculated_arrival: "2026-09-14T12:00",
    calculated_unload_end: "2026-09-14T11:30"
  }), "Delivery departure cannot be before delivery arrival.");
  assert.match(__test.validateJobTiming({
    stops: [{ planned_arrival: "2026-09-14T14:00", planned_departure: "2026-09-14T13:00" }]
  }), /Stop 2 departure/);
});

const COST_SETTINGS = { mpg: 10, fuel_price_per_litre: 1.5, driver_rate_per_hour: 15, fleet_cost_per_hour: 12.05, margin_pct: 20 };

test("profit: fuel receipts replace the mileage estimate and tolls are never counted", () => {
  const estimate = __test.calcJobEconomics({ distanceKm: 160.934, plannedMins: 300, settings: COST_SETTINGS });
  assert.equal(estimate.fuelSource, "estimate");
  assert.equal(estimate.fuelCost, 68.19);
  assert.equal(estimate.totalCost, 203.44);
  assert.equal(estimate.tollCost, undefined);

  const withReceipt = __test.calcJobEconomics({ distanceKm: 160.934, plannedMins: 300, settings: COST_SETTINGS, fuelExpenses: 80 });
  assert.equal(withReceipt.fuelSource, "receipts");
  assert.equal(withReceipt.fuelCost, 80);
  assert.equal(withReceipt.totalCost, 215.25);
});

test("profit: completed jobs use actual time, no truck means no fleet cost, missing plan falls back", () => {
  const actual = __test.calcJobEconomics({ distanceKm: 100, plannedMins: 300, actualMins: 420, settings: COST_SETTINGS, hasVehicle: false });
  assert.equal(actual.basis, "actual");
  assert.equal(actual.driverCost, 105);
  assert.equal(actual.fleetCost, 0);

  const fallback = __test.calcJobEconomics({ distanceKm: 100, plannedMins: null, fallbackMins: 360, settings: COST_SETTINGS });
  assert.equal(fallback.durationSource, "fallback");
  assert.equal(fallback.totalMins, 360);
});

const { assessPunctuality, buildJobPoints } = require("../utils/jobPunctuality");

test("punctuality: names the late point and flags impossible travel", () => {
  const trip = {
    pickup_address: "DE74 2BB", planned_departure: "2026-06-30 04:00:00", loading_done_time: "2026-06-30 05:00:00",
    actual_departure: "2026-07-01 21:59:00", calculated_arrival: "2026-06-30 12:00:00", calculated_unload_end: "2026-06-30 13:30:00",
    primary_drop_status: "completed", primary_drop_completed_at: "2026-07-01 22:17:00", driver_job_status: "delivered"
  };
  const stops = [{ id: 9, stop_order: 1, stop_type: "delivery", address: "DE74 2BB", planned_arrival: "2026-06-30 17:30:00", status: "completed", actual_arrival: "2026-07-01 22:30:00" }];
  const events = [{ status: "arrived_pickup", created_at: "2026-07-01 21:59:00" }, { status: "arrived_drop", created_at: "2026-07-01 21:59:00" }];
  const result = assessPunctuality(buildJobPoints(trip, stops, events), { dispatchStatus: "completed" });
  const [pickup, drop1, back] = result.points;
  assert.equal(pickup.arrivalDelayMins, 2519);
  assert.equal(drop1.actualArrival, "2026-07-01T21:59");
  assert.equal(drop1.state, "late");
  assert.equal(back.label, "Return point");
  assert.match(drop1.warnings[0], /Arrived 0 min after leaving Collection/);
  assert.equal(result.summary.worstPoint.label, "Collection");
});

test("punctuality: open jobs past a planned arrival are overdue", () => {
  const trip = { planned_departure: "2026-06-30 04:00:00", loading_done_time: "2026-06-30 05:00:00", calculated_arrival: "2026-06-30 12:00:00" };
  const result = assessPunctuality(buildJobPoints(trip), { dispatchStatus: "planned", now: "2026-06-30T05:00" });
  assert.equal(result.points[0].overdue.mins, 60);
  assert.equal(result.summary.state, "overdue");
  assert.equal(result.summary.worstPoint.label, "Collection");
});
