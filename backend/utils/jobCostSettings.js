// Cost rates used for a job's profit/loss. A completed job keeps the rates that applied when it finished,
// so later changes to fuel price or hourly rates in Settings never rewrite historical profit.
const { getSettingsMap } = require("../controllers/settingsController");

const COST_KEYS = ["fuel_price_per_litre", "mpg", "driver_rate_per_hour", "fleet_cost_per_hour", "margin_pct", "avg_speed_mph"];

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
    const merged = Object.fromEntries(COST_KEYS.map(key => [key, Number.isFinite(snapshot[key]) ? snapshot[key] : current[key]]));
    return { settings: merged, fromSnapshot: true };
  } catch {
    return { settings: current, fromSnapshot: false };
  }
}

// Called when a job completes. Never overwrites an existing snapshot.
async function snapshotCostSettings(conn, tripId) {
  const settings = await currentCostSettings();
  await conn.query("UPDATE trips SET cost_settings_json=COALESCE(cost_settings_json, ?) WHERE id=?", [JSON.stringify(settings), tripId]);
}

module.exports = { currentCostSettings, resolveCostSettings, snapshotCostSettings };
