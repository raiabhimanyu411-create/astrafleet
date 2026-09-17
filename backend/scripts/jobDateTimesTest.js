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

test("profit inputs include toll and do not invent revenue", () => {
  const economics = __test.calcJobEconomics(160.934, 300, {
    mpg: 10,
    fuel_price_per_litre: 1.5,
    driver_rate_per_hour: 15,
    fleet_cost_per_hour: 12.05,
    margin_pct: 20
  }, 0, 90, 90, 25);
  assert.equal(economics.tollCost, 25);
  assert.equal(economics.totalCost, 228.44);
});
