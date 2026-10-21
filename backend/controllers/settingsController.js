const db = require("../db/connection");
const { logActivity } = require("../utils/auditLogger");

// Every admin-editable setting lives here. `default` is the value the app used before
// the Settings page existed, so a fresh install (or "Reset to default") behaves exactly as before.
// Fields: group, label, help, unit, default, min, max, positive (must be > 0), integer, options.
const SETTINGS = [
  // ── Job costing ──
  { key: "fuel_price_per_litre", group: "costing", label: "Fuel price", unit: "£ per litre", default: 1.40, min: 0, max: 10, positive: true,
    help: "Diesel price used to estimate fuel cost on a job." },
  { key: "mpg", group: "costing", label: "Fuel economy", unit: "miles per gallon", default: 11.5, min: 0, max: 100, positive: true,
    help: "Average miles per gallon for your trucks." },
  { key: "driver_rate_per_hour", group: "costing", label: "Driver cost", unit: "£ per hour", default: 20, min: 0, max: 1000,
    help: "What one driver hour costs the business." },
  { key: "fleet_cost_per_hour", group: "costing", label: "Truck running cost", unit: "£ per hour", default: 12.05, min: 0, max: 1000,
    help: "Truck cost per hour (lease, tyres, wear) on top of fuel." },
  { key: "margin_pct", group: "costing", label: "Profit margin", unit: "%", default: 29, min: 0, max: 500,
    help: "Added on top of cost to suggest a job price." },
  { key: "avg_speed_mph", group: "costing", label: "Average speed", unit: "mph", default: 40, min: 0, max: 90, positive: true,
    help: "Used to estimate driving time when a route has no time." },

  // ── Invoices ──
  { key: "invoice_vat_rate", group: "invoices", label: "Default VAT rate", unit: "%", default: 20, options: [20, 5, 0],
    help: "VAT rate filled in on a new invoice. You can still change it per invoice." },
  { key: "invoice_payment_terms_days", group: "invoices", label: "Default payment terms", unit: "days", default: 30, min: 1, max: 365, integer: true,
    help: "Used for the due date when the customer has no payment terms of their own." },

  // ── Reminders ──
  { key: "due_soon_days", group: "reminders", label: "\"Due soon\" warning", unit: "days before", default: 30, min: 1, max: 180, integer: true,
    help: "MOT, insurance, road tax and service dates turn amber this many days before they are due." },

  // ── Maintenance intervals ──
  { key: "new_vehicle_inspection_weeks", group: "maintenance", label: "Safety inspection – new trucks", unit: "weeks", default: 6, options: [6, 10, 12],
    help: "Starting inspection frequency for trucks added from now on. Existing trucks keep their own frequency." },
  { key: "trailer_inspection_weeks", group: "maintenance", label: "Safety inspection – trailers", unit: "weeks", default: 10, min: 4, max: 26, integer: true,
    help: "How often trailers are inspected." },
  { key: "mot_interval_months", group: "maintenance", label: "MOT", unit: "months", default: 12, min: 1, max: 24, integer: true,
    help: "UK law requires an annual MOT for HGVs and trailers. Change only if your operator licence says otherwise." },
  { key: "tacho_interval_months", group: "maintenance", label: "Tachograph calibration", unit: "months", default: 24, min: 1, max: 72, integer: true,
    help: "UK rule is every 2 years." },
  { key: "insurance_interval_months", group: "maintenance", label: "Insurance renewal", unit: "months", default: 12, min: 1, max: 24, integer: true,
    help: "How long a policy runs before renewal." },
  { key: "service_interval_months", group: "maintenance", label: "Full service – time", unit: "months", default: 6, min: 1, max: 36, integer: true,
    help: "A full service is due after this many months…" },
  { key: "service_interval_km", group: "maintenance", label: "Full service – distance", unit: "km", default: 85000, min: 1000, max: 500000, integer: true,
    help: "…or after this many kilometres, whichever comes first." }
];

const GROUPS = [
  { key: "costing", title: "Job costing", description: "Used to estimate cost and suggest a price on new jobs. Finished jobs keep the rates they were completed with." },
  { key: "invoices", title: "Invoices", description: "Starting values on a new invoice." },
  { key: "reminders", title: "Reminders", description: "When dates start showing as due soon." },
  { key: "maintenance", title: "Maintenance intervals", description: "Saving a change here recalculates the next due date of every truck and trailer from its last completed check.", caution: true }
];

const BY_KEY = Object.fromEntries(SETTINGS.map((s) => [s.key, s]));
const MAINTENANCE_KEYS = new Set(SETTINGS.filter((s) => s.group === "maintenance" && s.key !== "new_vehicle_inspection_weeks").map((s) => s.key));
const DEFAULTS = Object.fromEntries(SETTINGS.map((s) => [s.key, String(s.default)]));

// In-memory copy so synchronous code (maintenance date maths) can read settings.
// Starts at the defaults, refreshed on every read and right after every save.
let cache = { ...DEFAULTS };
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
  cache = map;
  return map;
}

// Synchronous read of one setting as a number; falls back to the default if unusable.
function settingNumber(key) {
  const def = BY_KEY[key];
  const value = Number(cache[key]);
  if (!def) return value;
  return validationError(def, value) ? Number(def.default) : value;
}

function validationError(def, value) {
  if (!Number.isFinite(value)) return `${def.label} must be a number.`;
  if (def.options) return def.options.includes(value) ? null : `${def.label} must be one of ${def.options.join(", ")}.`;
  if (def.integer && !Number.isInteger(value)) return `${def.label} must be a whole number.`;
  if (value < def.min || value > def.max || (def.positive && value <= 0)) {
    return `${def.label} must be ${def.positive ? "above" : "from"} ${def.min} up to ${def.max}${def.unit ? ` ${def.unit}` : ""}.`;
  }
  return null;
}

function flatValues(map) {
  const values = Object.fromEntries(SETTINGS.map((s) => [s.key, Number(map[s.key])]));
  values.cost_per_mile = Number(((4.546 / values.mpg) * values.fuel_price_per_litre).toFixed(4));
  return values;
}

// GET /api/settings — flat values (the job form reads the costing ones).
exports.getSettings = async (req, res) => {
  try {
    res.json(flatValues(await getSettingsMap()));
  } catch (err) {
    res.status(500).json({ message: "Could not load settings.", error: err.message });
  }
};

// GET /api/settings/schema — everything the admin Settings page needs.
exports.getSettingsSchema = async (req, res) => {
  try {
    const map = await getSettingsMap();
    res.json({
      groups: GROUPS,
      settings: SETTINGS.map((s) => ({ ...s, value: Number(map[s.key]) }))
    });
  } catch (err) {
    res.status(500).json({ message: "Could not load settings.", error: err.message });
  }
};

// GET /api/settings/defaults — the non-financial defaults other screens need
// (invoice form, vehicle form, maintenance date maths). No costing figures.
exports.getFormDefaults = async (req, res) => {
  try {
    await getSettingsMap();
    res.json({
      ...maintenanceIntervals(),
      invoiceVatRate: settingNumber("invoice_vat_rate"),
      invoicePaymentTermsDays: settingNumber("invoice_payment_terms_days")
    });
  } catch (err) {
    res.status(500).json({ message: "Could not load settings.", error: err.message });
  }
};

function maintenanceIntervals() {
  return {
    trailerInspectionWeeks: settingNumber("trailer_inspection_weeks"),
    motMonths: settingNumber("mot_interval_months"),
    tachoMonths: settingNumber("tacho_interval_months"),
    insuranceMonths: settingNumber("insurance_interval_months"),
    serviceMonths: settingNumber("service_interval_months"),
    serviceKm: settingNumber("service_interval_km"),
    newVehicleInspectionWeeks: settingNumber("new_vehicle_inspection_weeks"),
    dueSoonDays: settingNumber("due_soon_days")
  };
}

// PUT /api/settings — admin only. Accepts any subset of keys; all-or-nothing.
exports.updateSettings = async (req, res) => {
  try {
    const before = await getSettingsMap();
    const updates = {};
    for (const [key, raw] of Object.entries(req.body || {})) {
      const def = BY_KEY[key];
      if (!def) continue;
      const value = raw === "" || raw === null ? NaN : Number(raw);
      const error = validationError(def, value);
      if (error) return res.status(400).json({ message: error, key });
      updates[key] = String(value);
    }

    const changed = Object.keys(updates).filter((key) => Number(before[key]) !== Number(updates[key]));
    for (const key of changed) {
      await db.query(
        `INSERT INTO system_settings (setting_key, setting_value) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
        [key, updates[key]]
      );
    }
    const map = await getSettingsMap();

    if (changed.length) {
      await logActivity(req, {
        module: "settings",
        action: "update",
        entityType: "system_settings",
        entityId: "all",
        entityLabel: "System settings",
        details: { changes: changed.map((key) => ({ field: BY_KEY[key].label, from: before[key], to: map[key] })) }
      });
    }

    // New intervals only matter once due dates are recalculated; do it now, in the background.
    const maintenanceChanged = changed.some((key) => MAINTENANCE_KEYS.has(key));
    if (maintenanceChanged) {
      require("./maintenanceController").refreshFleetMaintenance()
        .then((result) => console.log("[Settings] maintenance due dates recalculated", result))
        .catch((error) => console.error("[Settings] maintenance recalculation failed:", error.message));
    }

    res.json({
      message: changed.length ? "Settings saved." : "Nothing changed.",
      changed,
      maintenanceRecalculated: maintenanceChanged,
      ...flatValues(map)
    });
  } catch (err) {
    res.status(500).json({ message: "Could not update settings.", error: err.message });
  }
};

exports.getSettingsMap = getSettingsMap;
exports.settingNumber = settingNumber;
exports.maintenanceIntervals = maintenanceIntervals;
exports.SETTINGS = SETTINGS;
