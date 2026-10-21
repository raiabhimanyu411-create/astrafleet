// Freeing a truck or trailer when a job ends must not wipe an off-road status set by
// maintenance (VOR), and must not mark it free while another open job still holds it.
// Any status other than "available" is written exactly as before.

const OPEN_JOB = `deleted_at IS NULL AND dispatch_status IN ('planned','loading','active')`;
const BUSY_FIRST = `ORDER BY dispatch_status='active' DESC, dispatch_status='loading' DESC LIMIT 1`;

async function releaseVehicle(conn, vehicleId, tripId) {
  if (!vehicleId) return;
  const [[other]] = await conn.query(
    `SELECT dispatch_status FROM trips WHERE vehicle_id=? AND id<>? AND ${OPEN_JOB} ${BUSY_FIRST}`,
    [vehicleId, tripId || 0]
  );
  const next = !other ? "available" : other.dispatch_status === "active" ? "in_transit" : "planned";
  await conn.query(
    `UPDATE vehicles SET status=? WHERE id=? AND status NOT IN ('maintenance','stopped')`,
    [next, vehicleId]
  );
}

async function releaseTrailer(conn, trailerId, tripId) {
  if (!trailerId) return;
  const [[other]] = await conn.query(
    `SELECT dispatch_status FROM trips WHERE trailer_id=? AND id<>? AND ${OPEN_JOB} ${BUSY_FIRST}`,
    [trailerId, tripId || 0]
  );
  const next = !other ? "available" : ["active", "loading"].includes(other.dispatch_status) ? "in_use" : "planned";
  await conn.query(
    `UPDATE trailers SET status=? WHERE id=? AND status <> 'maintenance'`,
    [next, trailerId]
  );
}

async function setVehicleStatus(conn, vehicleId, status, tripId) {
  if (!vehicleId) return;
  if (status === "available") return releaseVehicle(conn, vehicleId, tripId);
  await conn.query("UPDATE vehicles SET status=? WHERE id=?", [status, vehicleId]);
}

async function setTrailerStatus(conn, trailerId, status, tripId) {
  if (!trailerId) return;
  if (status === "available") return releaseTrailer(conn, trailerId, tripId);
  await conn.query("UPDATE trailers SET status=? WHERE id=?", [status, trailerId]);
}

module.exports = { releaseTrailer, releaseVehicle, setTrailerStatus, setVehicleStatus };
