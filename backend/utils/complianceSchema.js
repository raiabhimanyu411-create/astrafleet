// Columns the shared compliance rules (utils/dispatchCompliance.js) rely on. Safe to run on every start:
// each step only acts when something is missing.
//   - drivers.dvla_check_date / penalty_points: DVLA licence check and endorsements.
//   - drivers.license_expiry / medical_expiry may be NULL ("not recorded"), and the old 2099-12-31
//     placeholder is turned back into NULL, so a missing date is treated as blocked instead of "safe".
//   - trips.compliance_override_*: the written override an admin gave for this job, so the driver can
//     still start it later.
//   - trips.planned_charges_gbp / vehicles.fuel_mpg: tolls & charges per job, a truck's own mpg.
const db = require("../db/connection");

const PLACEHOLDER_FROM = "2090-01-01";

async function columnInfo(table, column) {
  const [[row]] = await db.query(
    `SELECT IS_NULLABLE, COLUMN_TYPE FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return row || null;
}

async function addColumnIfMissing(table, column, definition) {
  if (!(await columnInfo(table, column))) await db.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

let ready = null;

async function run() {
  await addColumnIfMissing("drivers", "dvla_check_date", "DATE DEFAULT NULL");
  await addColumnIfMissing("drivers", "penalty_points", "INT DEFAULT NULL");
  for (const column of ["license_expiry", "medical_expiry"]) {
    const info = await columnInfo("drivers", column);
    if (info && info.IS_NULLABLE === "NO") await db.query(`ALTER TABLE drivers MODIFY ${column} DATE NULL DEFAULT NULL`);
  }
  const cleared = {};
  for (const column of ["license_expiry", "medical_expiry", "cpc_expiry", "tacho_card_expiry"]) {
    if (!(await columnInfo("drivers", column))) continue;
    const [result] = await db.query(`UPDATE drivers SET ${column} = NULL WHERE ${column} >= ?`, [PLACEHOLDER_FROM]);
    if (result.affectedRows) cleared[column] = result.affectedRows;
  }
  await addColumnIfMissing("trips", "compliance_override_reason", "VARCHAR(500) DEFAULT NULL");
  await addColumnIfMissing("trips", "compliance_override_at", "DATETIME DEFAULT NULL");
  // Costing: planned tolls / charges per job and a truck's own fuel economy.
  await addColumnIfMissing("trips", "planned_charges_gbp", "DECIMAL(10,2) DEFAULT NULL");
  await addColumnIfMissing("vehicles", "fuel_mpg", "DECIMAL(5,2) DEFAULT NULL");
  // A job without a driver has no driver status (the column used to default to "accepted").
  if (await columnInfo("trips", "driver_job_status")) {
    await db.query("ALTER TABLE trips ALTER COLUMN driver_job_status SET DEFAULT NULL");
    const [result] = await db.query(
      "UPDATE trips SET driver_job_status = NULL WHERE driver_id IS NULL AND driver_job_status = 'accepted'"
    );
    if (result.affectedRows) cleared.driver_job_status = result.affectedRows;
  }
  if (Object.keys(cleared).length) console.log("[Compliance] Placeholder expiry dates cleared:", cleared);
}

function ensureComplianceSchema() {
  if (!ready) ready = run().catch((error) => { ready = null; throw error; });
  return ready;
}

module.exports = { ensureComplianceSchema };
