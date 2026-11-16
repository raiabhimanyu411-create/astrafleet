// One-time tidy-ups that keep numbers consistent across pages. Safe to run on every start: each only
// touches rows that still need it.
//   1. Jobs with a typed client name but no customer account are linked to one (created if new), so the
//      Customers page counts their jobs and invoices.
//   2. Completed jobs without a cost-rate snapshot are frozen on today's rates, so their profit stops
//      changing whenever Settings change.
const db = require("../db/connection");
const { backfillCompletedSnapshots } = require("./jobCostSettings");

async function linkJobCustomers(conn = db) {
  const { matchCustomerByName } = require("../controllers/jobController");
  const [rows] = await conn.query(
    `SELECT id, client_name, client_phone FROM trips
     WHERE customer_id IS NULL AND client_name IS NOT NULL AND TRIM(client_name) <> '' AND deleted_at IS NULL`
  );
  let linked = 0;
  for (const row of rows) {
    const customerId = await matchCustomerByName(conn, row.client_name, { phone: row.client_phone });
    if (customerId) {
      await conn.query("UPDATE trips SET customer_id=? WHERE id=? AND customer_id IS NULL", [customerId, row.id]);
      linked += 1;
    }
  }
  return linked;
}

async function runDataConsistency() {
  const linked = await linkJobCustomers();
  const frozen = await backfillCompletedSnapshots(db);
  if (linked || frozen) console.log(`[Data] Linked ${linked} job(s) to customer accounts; froze cost rates on ${frozen} completed job(s).`);
  return { linked, frozen };
}

module.exports = { runDataConsistency, linkJobCustomers };
