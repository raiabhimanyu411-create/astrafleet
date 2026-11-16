// The job form preview (client/src/utils/jobCost.js) and the saved job / list / detail
// (calcJobEconomics) must give the same numbers for the same plan.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { __test } = require("../controllers/jobController");

const clientCost = () => import(pathToFileURL(path.join(__dirname, "../../client/src/utils/jobCost.js")).href);

const SETTINGS = { mpg: 11.5, fuel_price_per_litre: 1.4, driver_rate_per_hour: 20, fleet_cost_per_hour: 12.05, margin_pct: 29 };

const CASES = [
  { name: "audit route Trafford Park -> Hams Hall", distanceKm: 146.5, plannedMins: 286 },
  { name: "schedule not complete, falls back", distanceKm: 23.5, plannedMins: null, fallbackMins: 255 },
  { name: "zero distance", distanceKm: 0, plannedMins: 60 },
  { name: "long multi-stop", distanceKm: 612.3, plannedMins: 655 }
];

for (const item of CASES) {
  test(`preview and saved job agree: ${item.name}`, async () => {
    const { estimateJobCost } = await clientCost();
    const server = __test.calcJobEconomics({ ...item, settings: SETTINGS });
    const preview = estimateJobCost({ ...item, settings: SETTINGS });
    for (const key of ["fuelCost", "driverCost", "fleetCost", "totalCost", "suggestedPrice", "totalMins", "fuelCostPerMile"]) {
      assert.equal(preview[key], server[key], key);
    }
  });
}

test("audit figures: 91 miles, 4h46m job", async () => {
  const { estimateJobCost } = await clientCost();
  const preview = estimateJobCost({ distanceKm: 91 / 0.621371, plannedMins: 286, settings: SETTINGS });
  assert.equal(preview.driverCost, 95.33);
  assert.equal(preview.fleetCost, 57.44);
  assert.equal(preview.totalCost, 203.13);
  assert.equal(preview.suggestedPrice, 262.04);
});

test("drivers' hours: 45 min break after each 4.5 h of driving", () => {
  assert.equal(__test.breakMinsFor(106), 0);
  assert.equal(__test.breakMinsFor(270), 0);
  assert.equal(__test.breakMinsFor(271), 45);
  assert.equal(__test.breakMinsFor(540), 45);
  assert.equal(__test.breakMinsFor(541), 90);
});

test("preview and saved job agree with AdBlue, empty running, overheads, tolls and truck mpg", async () => {
  const { estimateJobCost } = await clientCost();
  const settings = { ...SETTINGS, avg_speed_mph: 40, adblue_cost_per_mile: 0.03, empty_running_pct: 50, overhead_pct: 10 };
  const input = { distanceKm: 300, plannedMins: 420, settings, vehicleMpg: 8, plannedCharges: 19.5 };
  const server = __test.calcJobEconomics(input);
  const preview = estimateJobCost(input);
  for (const key of ["fuelCost", "adblueCost", "chargesCost", "overheadCost", "driverCost", "fleetCost", "totalCost", "suggestedPrice", "totalMins"]) {
    assert.equal(preview[key], server[key], key);
  }
  assert.equal(server.mpgUsed, 8);
  assert.ok(server.emptyMiles > 90 && server.emptyMiles < 94);
});

test("P&L ignores recorded time over 3x the plan (job closed weeks later)", () => {
  const e = __test.calcJobEconomics({ distanceKm: 23.5, plannedMins: 120, actualMins: 26724, settings: SETTINGS });
  assert.equal(e.durationSource, "planned");
  assert.equal(e.actualTimeRejected, true);
  assert.equal(e.totalMins, 120);
});

test("HGV route time is never faster than the average speed", () => {
  // 100 km a car does in 60 min; at 40 mph an HGV needs about 93 min.
  assert.equal(__test.hgvMins(3600, 100000, 40), 93);
  assert.equal(__test.hgvMins(7200, 100000, 40), 120);
});
