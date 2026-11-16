// Cost rates used for a job's profit/loss. A job keeps the rates that applied when it was BOOKED
// (snapshot taken on create; older jobs get one when they complete), so later changes to fuel price or
// hourly rates in Settings never rewrite the profit of jobs already booked.
const { getSettingsMap } = require("../controllers/settingsController");

const COST_KEYS = ["fuel_price_per_litre", "mpg", "driver_rate_per_hour", "fleet_cost_per_hour", "margin_pct", "avg_speed_mph",
  "adblue_cost_per_mile", "empty_running_pct", "overhead_pct"];

function parseCostSettings(source) {
  return Object.fromEntries(COST_KEYS.map(key => [key, parseFloat(source?.[key])]));
}

async function currentCostSettings() {
  return parseCostSettings(await getSettingsMap());
}

// Snapshot wins over current settings, key by key, so an older snapshot missing a newer key still works.
function resolveCostSettings(current, snapshotJson) {
  if (!snapshotJson) return { settings: current, fromSnapshot: false };
  try {
    const snapshot = parseCostSettings(JSON.parse(snapshotJson));
    // Keys added after the snapshot was taken (AdBlue, empty running, overheads) count as 0, so an old
    // job's profit does not change because a new cost was switched on later.
    const ADDED_LATER = new Set(["adblue_cost_per_mile", "empty_running_pct", "overhead_pct"]);
    const merged = Object.fromEntries(COST_KEYS.map(key => [key, Number.isFinite(snapshot[key]) ? snapshot[key] : ADDED_LATER.has(key) ? 0 : current[key]]));
    return { settings: merged, fromSnapshot: true };
  } catch {
    return { settings: current, fromSnapshot: false };
  }
}

// Called when a job is booked and again when it completes. Never overwrites an existing snapshot.
async function snapshotCostSettings(conn, tripId) {
  const settings = await currentCostSettings();
  await conn.query("UPDATE trips SET cost_settings_json=COALESCE(cost_settings_json, ?) WHERE id=?", [JSON.stringify(settings), tripId]);
}

// Completed jobs from before snapshots existed: freeze them on today's rates so their profit stops
// moving with every Settings change. Returns the number of jobs updated.
async function backfillCompletedSnapshots(conn) {
  const settings = await currentCostSettings();
  const [result] = await conn.query(
    "UPDATE trips SET cost_settings_json=? WHERE dispatch_status='completed' AND cost_settings_json IS NULL",
    [JSON.stringify(settings)]
  );
  return result.affectedRows || 0;
}

module.exports = { currentCostSettings, resolveCostSettings, snapshotCostSettings, backfillCompletedSnapshots };
