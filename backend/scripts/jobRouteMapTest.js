const assert = require("node:assert/strict");
const dbPath = require.resolve("../db/connection");
let missing = false;
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  query: async sql => {
    if (sql.includes("SELECT t.pickup_address")) return [missing ? [] : [{ pickup_address: "London SW1A 1AA", drop_address: "Manchester M2 4AA" }]];
    if (sql.includes("SELECT address, stop_type")) return [[{ address: "Liverpool L2 2DH", stop_type: "delivery" }, { address: "Unknown address", stop_type: "waypoint" }]];
    if (sql.startsWith("SHOW COLUMNS")) return [[{ Field: "existing" }]];
    return [[]];
  }
} };
let routingFails = false;
global.fetch = async url => {
  if (url.includes("postcodes.io")) return { ok: true, json: async () => ({ status: 200, result: { postcode: "TEST", latitude: 52, longitude: -1 } }) };
  if (routingFails) throw new Error("Routing unavailable");
  return { ok: true, json: async () => ({ routes: [{ distance: 16093.44, duration: 1800, geometry: { coordinates: [[-1, 52], [-2, 53]] } }] }) };
};
const { getRouteMap } = require("../controllers/jobController");
async function request() {
  let status = 200, body;
  const res = { status(value) { status = value; return this; }, json(value) { body = value; } };
  await getRouteMap({ params: { id: "1" } }, res);
  return { status, body };
}
(async () => {
  const result = await request();
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.points.map(p => p.label), ["Collection", "Drop 1", "Drop 2", "Waypoint 3"]);
  assert.deepEqual(result.body.legs.map(l => [l.from, l.to]), [[0, 1], [1, 2], [2, 3]]);
  assert.equal(result.body.legs[0].distanceMiles, 10);
  assert.equal(result.body.legs[0].durationMins, 30);
  assert.equal(result.body.points[3].resolved, false);
  assert.equal(result.body.legs[2].source, "unavailable");
  assert.deepEqual(result.body.legs[2].coordinates, []);
  routingFails = true;
  const fallback = await request();
  assert.equal(fallback.body.legs[0].source, "straight-line");
  assert.equal(fallback.body.legs[0].distanceMiles, null);
  missing = true;
  assert.equal((await request()).status, 404);
  console.log("Route map checks passed: stop order, legs, units, missing postcode, routing fallback, missing job.");
})().catch(error => { console.error(error); process.exitCode = 1; });
