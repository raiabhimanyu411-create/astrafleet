const db = require("../db/connection");

const DEFAULTS = {
  fuel_price_per_litre: "1.40",
  mpg: "11.5",
  driver_rate_per_hour: "30.00",
  margin_pct: "29",
  avg_speed_mph: "50"
};

let tableReady = false;

async function ensureSettingsTable() {
  if (tableReady) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS system_settings (
      id            INT AUTO_INCREMENT PRIMARY KEY,
      setting_key   VARCHAR(80) NOT NULL UNIQUE,
      setting_value VARCHAR(255) NOT NULL,
      updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB
  `);
  for (const [key, value] of Object.entries(DEFAULTS)) {
    await db.query(
      `INSERT IGNORE INTO system_settings (setting_key, setting_value) VALUES (?, ?)`,
      [key, value]
    );
  }
  tableReady = true;
}

async function getSettingsMap() {
  await ensureSettingsTable();
  const [rows] = await db.query(`SELECT setting_key, setting_value FROM system_settings`);
  const map = { ...DEFAULTS };
  for (const row of rows) map[row.setting_key] = row.setting_value;
  return map;
}

// GET /api/settings
exports.getSettings = async (req, res) => {
  try {
    const map = await getSettingsMap();
    const fuelPrice = parseFloat(map.fuel_price_per_litre);
    const mpg = parseFloat(map.mpg);
    const costPerMile = ((4.546 / mpg) * fuelPrice).toFixed(4);
    res.json({
      fuel_price_per_litre: parseFloat(map.fuel_price_per_litre),
      mpg: parseFloat(map.mpg),
      driver_rate_per_hour: parseFloat(map.driver_rate_per_hour),
      margin_pct: parseFloat(map.margin_pct),
      avg_speed_mph: parseFloat(map.avg_speed_mph),
      cost_per_mile: parseFloat(costPerMile)
    });
  } catch (err) {
    res.status(500).json({ message: "Could not load settings.", error: err.message });
  }
};

// PUT /api/settings
exports.updateSettings = async (req, res) => {
  try {
    await ensureSettingsTable();
    const allowed = ["fuel_price_per_litre", "mpg", "driver_rate_per_hour", "margin_pct", "avg_speed_mph"];
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(req.body, key)) {
        const val = String(req.body[key]);
        await db.query(
          `INSERT INTO system_settings (setting_key, setting_value) VALUES (?, ?)
           ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
          [key, val]
        );
      }
    }
    const map = await getSettingsMap();
    const fuelPrice = parseFloat(map.fuel_price_per_litre);
    const mpg = parseFloat(map.mpg);
    const costPerMile = ((4.546 / mpg) * fuelPrice).toFixed(4);
    res.json({
      message: "Settings updated.",
      fuel_price_per_litre: parseFloat(map.fuel_price_per_litre),
      mpg: parseFloat(map.mpg),
      driver_rate_per_hour: parseFloat(map.driver_rate_per_hour),
      margin_pct: parseFloat(map.margin_pct),
      avg_speed_mph: parseFloat(map.avg_speed_mph),
      cost_per_mile: parseFloat(costPerMile)
    });
  } catch (err) {
    res.status(500).json({ message: "Could not update settings.", error: err.message });
  }
};

exports.getSettingsMap = getSettingsMap;
