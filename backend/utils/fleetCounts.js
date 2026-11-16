// Truck counts shown on Overview, Vehicles and Live tracking. One definition, so the pages always agree:
//   free       status "available", road-legal (utils/dispatchCompliance.js) and no open job
//   onJob      has an open job (planned, loading or on the road)
//   onRoad     its job is loading or on the road
//   booked     its job is planned but not started yet
//   offRoad    VOR (maintenance / stopped)
//   notLegal   not VOR, but fails a legal check (MOT, insurance, road tax, PMI, serious defect)
// Deleted jobs never count.
const { assetBlockers } = require("./dispatchCompliance");

async function fleetCounts(conn) {
  const [rows] = await conn.query(
    `SELECT v.id, v.status,
            EXISTS (SELECT 1 FROM trips t WHERE t.vehicle_id = v.id AND t.deleted_at IS NULL
                      AND t.dispatch_status IN ('planned','loading','active')) AS on_job,
            EXISTS (SELECT 1 FROM trips t WHERE t.vehicle_id = v.id AND t.deleted_at IS NULL
                      AND t.dispatch_status IN ('loading','active')) AS on_road
     FROM vehicles v`
  );
  const blockers = await assetBlockers(conn, "vehicle", rows.map(row => row.id));
  const isVor = row => ["maintenance", "stopped"].includes(row.status);
  const freeIds = new Set();
  const counts = { total: rows.length, free: 0, onJob: 0, onRoad: 0, booked: 0, offRoad: 0, notLegal: 0 };
  for (const row of rows) {
    const onJob = Boolean(Number(row.on_job));
    const onRoad = Boolean(Number(row.on_road));
    const blocked = blockers.has(Number(row.id));
    if (onJob) counts.onJob += 1;
    if (onRoad) counts.onRoad += 1;
    else if (onJob) counts.booked += 1;
    if (isVor(row)) counts.offRoad += 1;
    else if (blocked) counts.notLegal += 1;
    if (row.status === "available" && !onJob && !blocked) {
      counts.free += 1;
      freeIds.add(Number(row.id));
    }
  }
  return { ...counts, freeIds };
}

module.exports = { fleetCounts };
