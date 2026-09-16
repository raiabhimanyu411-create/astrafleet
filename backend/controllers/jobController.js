const db = require("../db/connection");
const { validateSchedule, normalisePlan, mergeJobUpdate } = require('../utils/jobPlanning');
const { emitDriverChatMessage, emitDriverJobAssigned, emitJobUpdate } = require("../realtime");
const { logActivity, requireDeleteReason } = require("../utils/auditLogger");
const { getSettingsMap } = require("./settingsController");
const maintenanceController = require("./maintenanceController");
const {
  addWallMinutes,
  dateTimeKey,
  fmtUkDateTime,
  fmtUkTime,
  isDateTimeKey,
  ukNowDateTimeKey,
  wallMinutesBetween
} = require("../utils/jobDateTimes");

function fmtDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}
function fmtDateTime(d) {
  return fmtUkDateTime(d);
}
function fmtAmount(n) {
  if (n == null) return "—";
  return `£${Number(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function rawDateTime(d) {
  return dateTimeKey(d);
}
function fmtTime(d) {
  return fmtUkTime(d);
}
const dispatchTone = { active: "success", loading: "warning", blocked: "danger", planned: "neutral", completed: "neutral" };
const priorityTone = { standard: "neutral", priority: "warning", critical: "danger" };
const driverStatusLabel = {
  offered: "Offered",
  accepted: "Accepted",
  arrived_pickup: "Arrived at pickup",
  loaded: "Loaded",
  in_transit: "In transit",
  arrived_drop: "Arrived at drop",
  delivered: "Delivered",
  failed_delivery: "Failed delivery",
  declined: "Declined"
};
const driverStatusTone = {
  offered: "warning",
  accepted: "neutral",
  arrived_pickup: "warning",
  loaded: "warning",
  in_transit: "success",
  arrived_drop: "warning",
  delivered: "success",
  failed_delivery: "danger",
  declined: "danger"
};
const stopStatusLabel = {
  pending: "Pending",
  arrived: "Arrived",
  completed: "Completed",
  skipped: "Skipped"
};

let driverOpsSchemaReady = false;
let softDeleteSchemaReady = false;
let jobCostSchemaReady = false;
let referenceSchemaReady = false;
const DEFAULT_LOADING_MINS = 90;
const DEFAULT_UNLOADING_MINS = 90;
const FLEET_COST_PER_HOUR_GBP = 12.05;

function effectiveLoadingMins(rowOrValue) {
  const value = typeof rowOrValue === "object" ? rowOrValue?.loading_duration_mins : rowOrValue;
  return Number(value ?? DEFAULT_LOADING_MINS);
}

function effectiveUnloadingMins(rowOrValue) {
  if (typeof rowOrValue === "object") return Number(rowOrValue?.unloading_duration_mins ?? DEFAULT_UNLOADING_MINS);
  return Number(rowOrValue ?? DEFAULT_UNLOADING_MINS);
}

function optionalNonNegativeNumber(value) {
  if (value === "" || value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function validateJobTiming(body) {
  const fields = [
    ["Collection arrival", body.planned_departure],
    ["Collection departure", body.loading_done_time],
    ["Delivery arrival", body.calculated_arrival],
    ["Delivery departure", body.calculated_unload_end],
    ["Delivery deadline", body.delivery_deadline]
  ];
  for (const [label, value] of fields) {
    if (value && !isDateTimeKey(value)) return `${label} must contain a valid UK date and time.`;
  }
  const ordered = [
    ["Collection departure cannot be before collection arrival.", body.planned_departure, body.loading_done_time],
    ["Delivery arrival cannot be before collection departure.", body.loading_done_time, body.calculated_arrival],
    ["Delivery departure cannot be before delivery arrival.", body.calculated_arrival, body.calculated_unload_end]
  ];
  for (const [message, start, end] of ordered) {
    if (start && end && wallMinutesBetween(start, end) < 0) return message;
  }
  for (const [index, stop] of (Array.isArray(body.stops) ? body.stops : []).entries()) {
    if (stop.planned_arrival && !isDateTimeKey(stop.planned_arrival)) return `Stop ${index + 2} arrival must contain a valid UK date and time.`;
    if (stop.planned_departure && !isDateTimeKey(stop.planned_departure)) return `Stop ${index + 2} departure must contain a valid UK date and time.`;
    if (stop.planned_arrival && stop.planned_departure && wallMinutesBetween(stop.planned_arrival, stop.planned_departure) < 0) {
      return `Stop ${index + 2} departure cannot be before its arrival.`;
    }
  }
  const loading = optionalNonNegativeNumber(body.loading_duration_mins);
  const unloading = optionalNonNegativeNumber(body.unloading_duration_mins);
  if (body.loading_duration_mins != null && (loading == null || !Number.isInteger(loading))) return "Loading duration must be a whole number of zero or more minutes.";
  if (body.unloading_duration_mins != null && (unloading == null || !Number.isInteger(unloading))) return "Unloading duration must be a whole number of zero or more minutes.";
  if (body.freight_amount != null && optionalNonNegativeNumber(body.freight_amount) == null) return "Freight amount must be zero or more.";
  return validateSchedule(body);
}

function trailerStatusForJob(status) {
  if (status === "active" || status === "loading") return "in_use";
  if (status === "planned") return "planned";
  return "available";
}

async function addColumnIfMissing(table, column, definition) {
  const [rows] = await db.query(`SHOW COLUMNS FROM ${table} LIKE ?`, [column]);
  if (rows.length === 0) {
    try {
      await db.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    } catch (error) {
      if (error.code !== "ER_DUP_FIELDNAME") throw error;
    }
  }
}

async function ensureDriverOpsSchema() {
  if (driverOpsSchemaReady) return;

  await addColumnIfMissing("trips", "driver_job_status", "VARCHAR(40) DEFAULT 'accepted'");
  await addColumnIfMissing("trips", "delivery_notes", "TEXT DEFAULT NULL");
  await addColumnIfMissing("trips", "pod_signature_data", "LONGTEXT DEFAULT NULL");
  await addColumnIfMissing("trips", "pod_photo_data", "LONGTEXT DEFAULT NULL");
  await addColumnIfMissing("trips", "failed_delivery_reason", "TEXT DEFAULT NULL");
  await addColumnIfMissing("trips", "trailer_id", "INT DEFAULT NULL");
  await addColumnIfMissing("trips", "customer_id", "INT DEFAULT NULL");
  await addColumnIfMissing("trips", "client_phone", "VARCHAR(30) DEFAULT NULL");
  await addColumnIfMissing("trips", "pickup_address", "TEXT DEFAULT NULL");
  await addColumnIfMissing("trips", "drop_address", "TEXT DEFAULT NULL");
  await addColumnIfMissing("trips", "load_type", "VARCHAR(80) DEFAULT 'general'");
  await addColumnIfMissing("trips", "load_weight_kg", "DECIMAL(10,2) DEFAULT NULL");
  await addColumnIfMissing("trips", "load_volume_cbm", "DECIMAL(10,2) DEFAULT NULL");
  await addColumnIfMissing("trips", "vehicle_type_requirement", "VARCHAR(80) DEFAULT NULL");
  await addColumnIfMissing("trips", "delivery_deadline", "DATETIME DEFAULT NULL");
  await addColumnIfMissing("trips", "dispatcher_notes", "TEXT DEFAULT NULL");

  await db.query(
    `CREATE TABLE IF NOT EXISTS driver_job_status_events (
      id INT AUTO_INCREMENT PRIMARY KEY,
      trip_id INT NOT NULL,
      driver_id INT DEFAULT NULL,
      status VARCHAR(40) NOT NULL,
      reason TEXT DEFAULT NULL,
      source ENUM('driver','dispatch','admin','system') NOT NULL DEFAULT 'driver',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_driver_job_status_trip (trip_id, created_at),
      CONSTRAINT fk_driver_job_status_trip FOREIGN KEY (trip_id) REFERENCES trips (id) ON DELETE CASCADE,
      CONSTRAINT fk_driver_job_status_driver FOREIGN KEY (driver_id) REFERENCES drivers (id) ON DELETE SET NULL
    ) ENGINE=InnoDB`
  );

  // Ensure dispatch_status ENUM includes all possible statuses
  try {
    await db.query(
      `ALTER TABLE trips MODIFY COLUMN dispatch_status
       ENUM('planned','loading','active','blocked','completed','failed','cancelled')
       NOT NULL DEFAULT 'planned'`
    );
  } catch (e) {
    if (e.code !== "ER_DUP_FIELDNAME") { /* ignore no-op or already-correct */ }
  }
  await addColumnIfMissing("trips", "load_description", "TEXT DEFAULT NULL");
  await addColumnIfMissing("trips", "special_instructions", "TEXT DEFAULT NULL");
  await addColumnIfMissing("trips", "actual_departure", "DATETIME DEFAULT NULL");
  await addColumnIfMissing("trips", "actual_arrival", "DATETIME DEFAULT NULL");
  await addColumnIfMissing("trips", "eta_updated_at", "DATETIME DEFAULT NULL");
  await addColumnIfMissing("trips", "primary_drop_status", "VARCHAR(40) DEFAULT 'pending'");
  await addColumnIfMissing("trips", "primary_drop_arrived_at", "DATETIME DEFAULT NULL");
  await addColumnIfMissing("trips", "primary_drop_completed_at", "DATETIME DEFAULT NULL");
  await addColumnIfMissing("vehicles", "current_location", "VARCHAR(160) DEFAULT NULL");
  await addColumnIfMissing("vehicles", "speed_kph", "DECIMAL(5,1) DEFAULT 0");
  await addColumnIfMissing("vehicles", "last_ping_at", "DATETIME DEFAULT NULL");
  await addColumnIfMissing("vehicles", "gps_latitude", "DECIMAL(10,7) DEFAULT NULL");
  await addColumnIfMissing("vehicles", "gps_longitude", "DECIMAL(10,7) DEFAULT NULL");
  await addColumnIfMissing("vehicles", "gps_accuracy_m", "DECIMAL(8,2) DEFAULT NULL");
  await db.query(
    `CREATE TABLE IF NOT EXISTS trailers (
      id INT AUTO_INCREMENT PRIMARY KEY,
      trailer_code VARCHAR(40) NOT NULL UNIQUE,
      registration_number VARCHAR(40) NOT NULL UNIQUE,
      trailer_type VARCHAR(80) NOT NULL,
      capacity_tonnes DECIMAL(6,2) DEFAULT NULL,
      status ENUM('available','planned','in_use','maintenance') NOT NULL DEFAULT 'available',
      current_location VARCHAR(160) DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB`
  );

  await db.query(
    `CREATE TABLE IF NOT EXISTS driver_expenses (
      id INT AUTO_INCREMENT PRIMARY KEY,
      driver_id INT NOT NULL,
      trip_id INT DEFAULT NULL,
      expense_type VARCHAR(40) NOT NULL DEFAULT 'fuel',
      amount_gbp DECIMAL(10,2) NOT NULL DEFAULT 0,
      notes VARCHAR(255) DEFAULT NULL,
      receipt_data LONGTEXT DEFAULT NULL,
      expense_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB`
  );
  await db.query(
    `CREATE TABLE IF NOT EXISTS job_stops (
      id INT AUTO_INCREMENT PRIMARY KEY,
      trip_id INT NOT NULL,
      stop_order INT NOT NULL DEFAULT 1,
      stop_type ENUM('pickup','delivery','waypoint') NOT NULL DEFAULT 'delivery',
      address TEXT NOT NULL,
      contact_name VARCHAR(120) DEFAULT NULL,
      contact_phone VARCHAR(30) DEFAULT NULL,
      planned_arrival DATETIME DEFAULT NULL,
      actual_arrival DATETIME DEFAULT NULL,
      status ENUM('pending','arrived','completed','skipped') NOT NULL DEFAULT 'pending',
      notes TEXT DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_job_stops_trip (trip_id),
      CONSTRAINT fk_job_stops_trip FOREIGN KEY (trip_id) REFERENCES trips (id) ON DELETE CASCADE
    ) ENGINE=InnoDB`
  );
  await addColumnIfMissing("job_stops", "planned_departure", "DATETIME DEFAULT NULL");
  await addColumnIfMissing("job_stops", "actual_departure", "DATETIME DEFAULT NULL");
  await db.query(
    `CREATE TABLE IF NOT EXISTS defect_reports (
      id INT AUTO_INCREMENT PRIMARY KEY,
      vehicle_id INT NOT NULL,
      defect_type VARCHAR(80) NOT NULL,
      description TEXT DEFAULT NULL,
      severity ENUM('low','medium','high','critical') NOT NULL DEFAULT 'medium',
      reported_by VARCHAR(120) DEFAULT NULL,
      status ENUM('open','in_progress','resolved') NOT NULL DEFAULT 'open',
      reported_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      resolved_at DATETIME DEFAULT NULL
    ) ENGINE=InnoDB`
  );
  await addColumnIfMissing("defect_reports", "defect_type", "VARCHAR(80) NOT NULL DEFAULT 'Driver report'");
  await addColumnIfMissing("defect_reports", "reported_by", "VARCHAR(120) DEFAULT NULL");

  driverOpsSchemaReady = true;
}

async function ensureSoftDeleteSchema() {
  if (softDeleteSchemaReady) return;
  await addColumnIfMissing("trips", "deleted_at", "DATETIME DEFAULT NULL");
  await addColumnIfMissing("trips", "deleted_by", "INT DEFAULT NULL");
  await addColumnIfMissing("trips", "delete_reason", "TEXT DEFAULT NULL");
  softDeleteSchemaReady = true;
}

async function ensureJobCostSchema() {
  if (jobCostSchemaReady) return;
  const [freightColumns] = await db.query("SHOW COLUMNS FROM trips LIKE 'freight_amount_gbp'");
  if (freightColumns[0]?.Null === 'NO') await db.query('ALTER TABLE trips MODIFY freight_amount_gbp DECIMAL(10,2) NULL DEFAULT NULL');
  await addColumnIfMissing("trips", "loading_done_time", "DATETIME DEFAULT NULL");
  await addColumnIfMissing("trips", "loading_duration_mins", "INT DEFAULT 90");
  await addColumnIfMissing("trips", "unloading_duration_mins", "INT DEFAULT 90");
  await addColumnIfMissing("trips", "calculated_arrival", "DATETIME DEFAULT NULL");
  await addColumnIfMissing("trips", "calculated_unload_end", "DATETIME DEFAULT NULL");
  await addColumnIfMissing("trips", "total_job_duration_mins", "INT DEFAULT NULL");
  await addColumnIfMissing("trips", "estimated_distance_km", "DECIMAL(10,2) DEFAULT NULL");
  await addColumnIfMissing("trips", "estimated_eta_mins", "INT DEFAULT NULL");
  await addColumnIfMissing("trips", "delay_reason", "TEXT DEFAULT NULL");
  jobCostSchemaReady = true;
}

async function ensureReferenceSchema() {
  if (referenceSchemaReady) return;
  await addColumnIfMissing("trips", "reference", "VARCHAR(120) DEFAULT NULL");
  await addColumnIfMissing("trips", "load_id", "VARCHAR(80) DEFAULT NULL");
  referenceSchemaReady = true;
}

async function generateJobCode(conn) {
  const day = ukNowDateTimeKey().slice(0, 10).replaceAll('-', '');
  return `${day}-${require('node:crypto').randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`;
}

function extractUkPostcode(value) {
  const text = String(value || "").toUpperCase().replace(/\s+/g, " ");
  const match = text.match(/\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/);
  return match ? match[1].replace(/\s+/g, "") : "";
}

function isReturnStop(stop, pickupPostcode, lastStopId) {
  if (!stop || !pickupPostcode || stop.id !== lastStopId) return false;
  return extractUkPostcode(stop.address) === pickupPostcode;
}

async function fetchJson(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function lookupPostcode(postcode) {
  const clean = String(postcode || "").replace(/\s+/g, "");
  if (!clean) return null;
  const data = await fetchJson(`https://api.postcodes.io/postcodes/${encodeURIComponent(clean)}`);
  if (data?.status !== 200 || !data?.result) return null;
  return {
    postcode: data.result.postcode,
    latitude: Number(data.result.latitude),
    longitude: Number(data.result.longitude)
  };
}

function haversineKm(a, b) {
  const radiusKm = 6371;
  const toRad = deg => deg * Math.PI / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * radiusKm * Math.asin(Math.sqrt(h));
}

async function estimateDrivingPath(points) {
  if (!points || points.length < 2) throw new Error("At least two route points are required.");
  const coords = points.map(point => `${point.longitude},${point.latitude}`).join(";");
  const data = await fetchJson(`https://router.project-osrm.org/route/v1/driving/${coords}?overview=false&alternatives=false&steps=false`, 10000);
  const route = data?.routes?.[0];
  if (!route || !Number.isFinite(route.distance) || !Number.isFinite(route.duration)) throw new Error("Road estimate unavailable. Please retry; no distance has been assumed.");
  return {
    distanceKm: Math.round(route.distance / 1000 * 10) / 10,
    durationMins: Math.round(route.duration / 60),
    firstLegMins: Math.round((route.legs?.[0]?.duration ?? route.duration) / 60),
    source: points.length > 2 ? "postcode-driving-multistop" : "postcode-driving"
  };
}

function calcJobEconomics(distanceKm, totalJobMins, settings, fallbackTravelMins = 0, loadingMins = DEFAULT_LOADING_MINS, unloadingMins = DEFAULT_UNLOADING_MINS, tollCost = 0) {
  if (distanceKm == null || !Number.isFinite(Number(distanceKm)) || Number(distanceKm) < 0 || !settings) return null;
  if (![settings.mpg, settings.fuel_price_per_litre, settings.driver_rate_per_hour, settings.margin_pct].every(value => Number.isFinite(Number(value)) && Number(value) >= 0) || Number(settings.mpg) <= 0) return null;
  const distanceMiles = distanceKm * 0.621371;
  const fuelCostPerMile = (4.546 / settings.mpg) * settings.fuel_price_per_litre;
  const fuelCost = distanceMiles * fuelCostPerMile;
  if (totalJobMins == null || !Number.isFinite(Number(totalJobMins)) || Number(totalJobMins) < 0) return null;
  const totalMinutes = Number(totalJobMins);
  const totalHours = totalMinutes / 60;
  const driverCost = totalHours * settings.driver_rate_per_hour;
  const fleetCost = totalHours * FLEET_COST_PER_HOUR_GBP;
  const safeTollCost = Number(tollCost || 0);
  const totalCost = fuelCost + driverCost + fleetCost + safeTollCost;
  const suggestedPrice = totalCost * (1 + settings.margin_pct / 100);
  return {
    distanceMiles: Math.round(distanceMiles * 10) / 10,
    fuelCostPerMile: Math.round(fuelCostPerMile * 100) / 100,
    fuelCost: Math.round(fuelCost * 100) / 100,
    driverCost: Math.round(driverCost * 100) / 100,
    fleetCost: Math.round(fleetCost * 100) / 100,
    tollCost: Math.round(safeTollCost * 100) / 100,
    fleetCostPerHour: FLEET_COST_PER_HOUR_GBP,
    totalCost: Math.round(totalCost * 100) / 100,
    suggestedPrice: Math.round(suggestedPrice * 100) / 100,
    totalHours: Math.round(totalHours * 100) / 100,
    totalMins: totalMinutes
  };
}

async function ensureJobNotesSchema() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS job_notes (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      job_id      INT NOT NULL,
      note_text   TEXT NOT NULL,
      author_name VARCHAR(120) NOT NULL DEFAULT 'Admin',
      created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_job_notes_trip FOREIGN KEY (job_id) REFERENCES trips (id) ON DELETE CASCADE
    ) ENGINE=InnoDB
  `);
}

// GET /api/jobs/form-data
exports.getFormData = async (req, res) => {
  try {
    await ensureDriverOpsSchema();
    await ensureSoftDeleteSchema();

    const [customers] = await db.query(
      `SELECT id, company_name, contact_name, phone, email,
              address, billing_address, saved_pickup_addresses, saved_drop_addresses
       FROM customers
       WHERE account_status='active'
       ORDER BY company_name ASC`
    );
    const [drivers] = await db.query(
      `SELECT id, full_name, employee_code, phone, shift_status, compliance_status
       FROM drivers
       WHERE compliance_status != 'blocked'
         AND NOT EXISTS (
           SELECT 1 FROM trips t WHERE t.driver_id = drivers.id
             AND t.deleted_at IS NULL AND t.dispatch_status IN ('planned','loading','active')
         )
       ORDER BY shift_status='ready' DESC, full_name ASC`
    );
    const [vehicles] = await db.query(
      `SELECT id, registration_number, fleet_code, model_name, truck_type, status, capacity_tonnes
       FROM vehicles
       WHERE status IN ('available','planned')
         AND NOT EXISTS (
           SELECT 1 FROM trips t WHERE t.vehicle_id = vehicles.id
             AND t.deleted_at IS NULL AND t.dispatch_status IN ('planned','loading','active')
         )
       ORDER BY status='available' DESC, registration_number ASC`
    );
    const [routes] = await db.query(
      `SELECT id, route_code, origin_hub, destination_hub, distance_km, standard_eta_hours, toll_estimate_gbp
       FROM routes WHERE status IN ('approved','active') ORDER BY origin_hub ASC`
    );
    const [trailers] = await db.query(
      `SELECT id, trailer_code, registration_number, trailer_type, capacity_tonnes, status
       FROM trailers
       WHERE status IN ('available','planned')
         AND NOT EXISTS (
           SELECT 1 FROM trips t WHERE t.trailer_id = trailers.id
             AND t.deleted_at IS NULL AND t.dispatch_status IN ('planned','loading','active')
         )
       ORDER BY status='available' DESC, trailer_code ASC`
    );

    res.json({ customers, drivers, vehicles, trailers, routes });
  } catch (err) {
    res.status(500).json({ message: "Form data error", error: err.message });
  }
};

// POST /api/jobs/estimate-route
exports.estimateRouteFromAddresses = async (req, res) => {
  try {
    const { pickup_address, drop_address, stops = [] } = req.body;
    const pickupPostcode = extractUkPostcode(pickup_address);
    const dropPostcode = extractUkPostcode(drop_address);
    const stopPostcodes = stops
      .map(stop => extractUkPostcode(stop?.address || stop))
      .filter(Boolean);

    if (!pickupPostcode || !dropPostcode) {
      return res.status(400).json({ message: "Pickup and delivery addresses need valid UK postcodes." });
    }

    const settingsMap = await getSettingsMap();
    const settings = { avg_speed_mph: parseFloat(settingsMap.avg_speed_mph) };
    // Drop 1 is followed by the additional stops shown in the job planner.
    const postcodes = [pickupPostcode, dropPostcode, ...stopPostcodes];
    const points = await Promise.all(postcodes.map(postcode => lookupPostcode(postcode)));

    if (points.some(point => !point)) {
      return res.status(404).json({ message: "Could not find one of the route postcodes." });
    }

    const estimate = await estimateDrivingPath(points, settings);
    const distanceMiles = Math.round(estimate.distanceKm * 0.621371 * 10) / 10;

    res.json({
      pickupPostcode: points[0].postcode,
      dropPostcode: points[1].postcode,
      stopPostcodes: points.slice(2).map(point => point.postcode),
      stopCount: points.length - 2,
      distanceKm: estimate.distanceKm,
      distanceMiles,
      durationMins: estimate.durationMins,
      firstLegMins: estimate.firstLegMins,
      standardEtaHours: Math.round((estimate.durationMins / 60) * 10) / 10,
      source: estimate.source
    });
  } catch (err) {
    res.status(500).json({ message: "Route estimate error", error: err.message });
  }
};

// GET /api/jobs
exports.listJobs = async (req, res) => {
  try {
    await ensureDriverOpsSchema();
    await ensureJobCostSchema();
    await ensureReferenceSchema();

    const { status, priority, customer_id, search } = req.query;

    const [[counts]] = await db.query(
      `SELECT COUNT(*) as total,
        COALESCE(SUM(dispatch_status='active'), 0)    as active,
        COALESCE(SUM(dispatch_status='planned'), 0)   as planned,
        COALESCE(SUM(dispatch_status='completed'), 0) as completed,
        COALESCE(SUM(dispatch_status='blocked'), 0)   as blocked,
        COALESCE(SUM(dispatch_status='loading'), 0)   as loading,
        COALESCE(SUM(priority_level='critical'), 0)   as critical,
        COALESCE(SUM(driver_id IS NULL OR vehicle_id IS NULL), 0) as assignment_gaps,
        COALESCE(SUM(eta IS NOT NULL AND eta < ? AND dispatch_status IN ('planned','loading','active') AND COALESCE(driver_job_status, '') NOT IN ('arrived_drop','delivered')), 0) as eta_risk,
        COALESCE(SUM(freight_amount_gbp), 0) as booked_value
       FROM trips
       WHERE deleted_at IS NULL`,
      [ukNowDateTimeKey()]
    );

    let where = ["1=1"];
    let params = [];

    if (status)      { where.push("t.dispatch_status = ?");  params.push(status); }
    if (priority)    { where.push("t.priority_level = ?");   params.push(priority); }
    if (customer_id) { where.push("t.customer_id = ?");      params.push(customer_id); }
    if (search) {
      where.push("(t.trip_code LIKE ? OR t.client_name LIKE ? OR c.company_name LIKE ?)");
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    const settingsMap = await getSettingsMap();
    const settings = {
      fuel_price_per_litre: parseFloat(settingsMap.fuel_price_per_litre),
      mpg: parseFloat(settingsMap.mpg),
      driver_rate_per_hour: parseFloat(settingsMap.driver_rate_per_hour),
      margin_pct: parseFloat(settingsMap.margin_pct),
      avg_speed_mph: parseFloat(settingsMap.avg_speed_mph)
    };

    const [rows] = await db.query(
      `SELECT t.id, t.trip_code, t.customer_id, t.client_name, t.route_id, t.vehicle_id, t.trailer_id, t.driver_id,
              t.dispatch_status, t.priority_level, t.driver_job_status,
              t.planned_departure, t.eta, t.eta_updated_at, t.primary_drop_status, t.primary_drop_arrived_at, t.primary_drop_completed_at,
              t.delivery_deadline, t.actual_departure, t.actual_arrival,
              t.dock_window, t.freight_amount_gbp, t.load_type, t.load_weight_kg, t.load_volume_cbm,
              t.vehicle_type_requirement, t.load_description, t.special_instructions, t.dispatcher_notes,
              t.pod_status, t.pickup_address, t.drop_address, t.client_phone, t.created_at, t.cancellation_reason, t.delay_reason,
              t.loading_done_time, t.loading_duration_mins, t.unloading_duration_mins, t.calculated_arrival,
              t.calculated_unload_end, t.total_job_duration_mins, t.reference, t.load_id,
              c.company_name as customer_name, c.contact_name as customer_contact, c.phone as customer_phone,
              r.route_code, r.origin_hub, r.destination_hub,
              r.toll_estimate_gbp,
              COALESCE(t.estimated_distance_km, r.distance_km) AS distance_km,
              COALESCE(t.estimated_eta_mins / 60, r.standard_eta_hours) AS standard_eta_hours,
              d.full_name as driver_name, d.phone as driver_phone, d.employee_code,
              v.registration_number, v.fleet_code, v.model_name, v.truck_type,
              tr.trailer_code, tr.registration_number AS trailer_registration, tr.trailer_type,
              COUNT(DISTINCT js.id) as stop_count
       FROM trips t
       LEFT JOIN customers c  ON t.customer_id = c.id
       LEFT JOIN routes    r  ON t.route_id    = r.id
       LEFT JOIN drivers   d  ON t.driver_id   = d.id
       LEFT JOIN vehicles  v  ON t.vehicle_id  = v.id
       LEFT JOIN trailers  tr ON t.trailer_id  = tr.id
       LEFT JOIN job_stops js ON js.trip_id    = t.id
       WHERE ${where.join(" AND ")} AND t.deleted_at IS NULL
       GROUP BY t.id
       ORDER BY t.created_at DESC`,
      params
    );

    const [drivers] = await db.query(
      `SELECT id, full_name, employee_code, phone, shift_status, compliance_status,
              (SELECT t.id FROM trips t WHERE t.driver_id = drivers.id
                 AND t.deleted_at IS NULL AND t.dispatch_status IN ('planned','loading','active')
               ORDER BY t.id DESC LIMIT 1) AS busy_trip_id,
              (SELECT t.trip_code FROM trips t WHERE t.driver_id = drivers.id
                 AND t.deleted_at IS NULL AND t.dispatch_status IN ('planned','loading','active')
               ORDER BY t.id DESC LIMIT 1) AS busy_trip_code
       FROM drivers
       WHERE compliance_status != 'blocked'
       ORDER BY shift_status='ready' DESC, full_name ASC`
    );
    const [vehicles] = await db.query(
      `SELECT id, registration_number, fleet_code, model_name, truck_type, status, capacity_tonnes,
              (SELECT t.id FROM trips t WHERE t.vehicle_id = vehicles.id
                 AND t.deleted_at IS NULL AND t.dispatch_status IN ('planned','loading','active')
               ORDER BY t.id DESC LIMIT 1) AS busy_trip_id,
              (SELECT t.trip_code FROM trips t WHERE t.vehicle_id = vehicles.id
                 AND t.deleted_at IS NULL AND t.dispatch_status IN ('planned','loading','active')
               ORDER BY t.id DESC LIMIT 1) AS busy_trip_code
       FROM vehicles
       WHERE status != 'stopped'
       ORDER BY registration_number ASC`
    );
    const [trailers] = await db.query(
      `SELECT id, trailer_code, registration_number, trailer_type, capacity_tonnes, status,
              (SELECT t.id FROM trips t WHERE t.trailer_id = trailers.id
                 AND t.deleted_at IS NULL AND t.dispatch_status IN ('planned','loading','active')
               ORDER BY t.id DESC LIMIT 1) AS busy_trip_id,
              (SELECT t.trip_code FROM trips t WHERE t.trailer_id = trailers.id
                 AND t.deleted_at IS NULL AND t.dispatch_status IN ('planned','loading','active')
               ORDER BY t.id DESC LIMIT 1) AS busy_trip_code
       FROM trailers
       WHERE status != 'maintenance'
       ORDER BY trailer_code ASC`
    );

    // Listing jobs must never rewrite schedules or call external routing services.
    const hydratedRows = rows;
    const jobIds = hydratedRows.map(row => row.id);
    const stopsByTrip = new Map();
    const driverStatusEventsByTrip = new Map();
    if (jobIds.length > 0) {
      const [stopRows] = await db.query(
        `SELECT id, trip_id, stop_order, stop_type, address, contact_name, contact_phone,
                planned_arrival, planned_departure, actual_arrival, actual_departure, status, notes
         FROM job_stops
         WHERE trip_id IN (?)
         ORDER BY trip_id ASC, stop_order ASC`,
        [jobIds]
      );
      for (const stop of stopRows) {
        const list = stopsByTrip.get(stop.trip_id) || [];
        list.push(stop);
        stopsByTrip.set(stop.trip_id, list);
      }

      const [eventRows] = await db.query(
        `SELECT e.id, e.trip_id, e.driver_id, e.status, e.reason, e.source, e.created_at,
                d.full_name AS driver_name
         FROM driver_job_status_events e
         LEFT JOIN drivers d ON d.id = e.driver_id
         WHERE e.trip_id IN (?)
         ORDER BY e.trip_id ASC, e.created_at ASC, e.id ASC`,
        [jobIds]
      );
      for (const event of eventRows) {
        const list = driverStatusEventsByTrip.get(event.trip_id) || [];
        list.push(event);
        driverStatusEventsByTrip.set(event.trip_id, list);
      }
    }

    res.json({
      stats: [
        { label: "Total jobs",  value: counts.total,     description: "All freight bookings.", change: "Live from database", tone: "neutral" },
        { label: "Active",      value: counts.active,    description: "Currently moving.", change: "On road", tone: "success" },
        { label: "Planned",     value: counts.planned,   description: "Scheduled but not dispatched.", change: "Ready queue", tone: "warning" },
        { label: "Completed",   value: counts.completed, description: "Delivered jobs.", change: "Closed loop", tone: "neutral" }
      ],
      opsHealth: [
        { label: "Booked value", value: fmtAmount(counts.booked_value), description: "Total freight value.", change: "GBP", tone: "neutral" },
        { label: "Assignment gaps", value: counts.assignment_gaps, description: "Missing driver or vehicle.", change: "Needs dispatch", tone: counts.assignment_gaps ? "danger" : "success" },
        { label: "ETA risk", value: counts.eta_risk, description: "ETA passed on open jobs.", change: "Ops review", tone: counts.eta_risk ? "danger" : "success" },
        { label: "Critical jobs", value: counts.critical, description: "Critical priority bookings.", change: "Priority desk", tone: counts.critical ? "danger" : "neutral" }
      ],
      drivers,
      vehicles,
      trailers,
      jobs: hydratedRows.map(r => {
        const stopsForTrip = stopsByTrip.get(r.id) || [];
        r = { ...r, ...normalisePlan({ ...r, stops: stopsForTrip }) };
        const statusEventsForTrip = driverStatusEventsByTrip.get(r.id) || [];
        const pickupArrivalEvent = statusEventsForTrip.find(event => event.status === "arrived_pickup");
        const hasDepartureEvidence = statusEventsForTrip.some(event => ["in_transit", "arrived_drop", "delivered"].includes(event.status));
        const hasArrivalEvidence = statusEventsForTrip.some(event => event.status === "delivered") || ["uploaded", "verified"].includes(r.pod_status);
        const pickupPostcode = extractUkPostcode(r.pickup_address || r.origin_hub);
        const lastStopId = stopsForTrip.length ? stopsForTrip[stopsForTrip.length - 1].id : null;
        const fallbackTravelMins = r.standard_eta_hours ? Math.round(Number(r.standard_eta_hours) * 60) : 0;
        const loadingMins = effectiveLoadingMins(r);
        const unloadingMins = effectiveUnloadingMins(r);
        const econ = calcJobEconomics(r.distance_km, r.total_job_duration_mins, settings, fallbackTravelMins, loadingMins, unloadingMins, r.toll_estimate_gbp);
        const totalJobDurationMins = r.total_job_duration_mins || econ?.totalMins || null;
        const freightValue = r.freight_amount_gbp == null ? null : Number(r.freight_amount_gbp);
        const profitLossValue = econ && freightValue !== null ? Math.round((freightValue - econ.totalCost) * 100) / 100 : null;
        const driverTimeline = statusEventsForTrip.map(event => ({
          id: event.id,
          status: event.status,
          label: driverStatusLabel[event.status] || event.status,
          tone: driverStatusTone[event.status] || "neutral",
          reason: event.reason || "",
          source: event.source,
          driverName: event.driver_name || r.driver_name || "Driver",
          at: fmtDateTime(event.created_at),
          atRaw: rawDateTime(event.created_at)
        }));
        if (driverTimeline.length === 0 && r.driver_job_status) {
          driverTimeline.push({
            id: `current-${r.id}`,
            status: r.driver_job_status,
            label: driverStatusLabel[r.driver_job_status] || r.driver_job_status,
            tone: driverStatusTone[r.driver_job_status] || "neutral",
            reason: "",
            source: "system",
            driverName: r.driver_name || "Driver",
            at: "Time not recorded",
            atRaw: ""
          });
        }
        return {
          id: r.id,
          code: r.trip_code,
          customerId: r.customer_id,
          routeId: r.route_id,
          driverId: r.driver_id,
          vehicleId: r.vehicle_id,
          trailerId: r.trailer_id,
          customer: r.customer_name || r.client_name || "—",
          customerContact: r.customer_contact || "—",
          customerPhone: r.customer_phone || r.client_phone || "—",
          lane: r.origin_hub && r.destination_hub ? `${r.origin_hub} → ${r.destination_hub}` : (r.pickup_address ? "Custom route" : "Route TBD"),
          routeCode: r.route_code || "—",
          pickupAddress: r.pickup_address || r.origin_hub || "—",
          dropAddress: r.drop_address || r.destination_hub || "—",
          dockWindow: r.dock_window || "—",
          distanceKm: r.distance_km,
          distanceMiles: r.distance_km ? Math.round(r.distance_km * 0.621371 * 10) / 10 : null,
          etaHours: r.standard_eta_hours,
          driver: r.driver_name || "Unassigned",
          driverPhone: r.driver_phone || "—",
          driverEmployeeCode: r.employee_code || "—",
          driverAssigned: Boolean(r.driver_name),
          driverJobStatus: r.driver_job_status || "—",
          driverStatusTimeline: driverTimeline,
          vehicle: r.registration_number || "Unassigned",
          vehicleFleetCode: r.fleet_code || "—",
          vehicleModel: r.model_name || "—",
          vehicleType: r.truck_type || "—",
          vehicleAssigned: Boolean(r.registration_number),
          trailer: r.trailer_code || "Unassigned",
          trailerCode: r.trailer_code || "—",
          trailerType: r.trailer_type || "—",
          trailerAssigned: Boolean(r.trailer_registration),
          departure: fmtDateTime(r.planned_departure),
          departureRaw: rawDateTime(r.planned_departure),
          collectionArrivedAt: pickupArrivalEvent ? fmtDateTime(pickupArrivalEvent.created_at) : "—",
          collectionArrivedAtRaw: pickupArrivalEvent ? rawDateTime(pickupArrivalEvent.created_at) : "",
          eta: fmtDateTime(r.eta),
          etaRaw: rawDateTime(r.eta),
          etaTime: fmtTime(r.eta),
          driverEtaUpdatedAt: fmtDateTime(r.eta_updated_at),
          driverEtaUpdatedAtRaw: rawDateTime(r.eta_updated_at),
          hasDriverEtaUpdate: Boolean(r.eta_updated_at),
          deadline: fmtDateTime(r.delivery_deadline),
          deadlineRaw: rawDateTime(r.delivery_deadline),
          actualDeparture: fmtDateTime(r.actual_departure),
          actualDepartureRaw: rawDateTime(r.actual_departure),
          actualArrival: fmtDateTime(r.actual_arrival),
          actualArrivalRaw: rawDateTime(r.actual_arrival),
          etaRisk: Boolean(r.eta) && dateTimeKey(r.eta) < ukNowDateTimeKey() && ["planned", "loading", "active"].includes(r.dispatch_status) && !["arrived_drop", "delivered"].includes(r.driver_job_status),
          primaryDropStatus: r.primary_drop_status || "pending",
          primaryDropStatusLabel: stopStatusLabel[r.primary_drop_status] || "Pending",
          primaryDropArrivedAt: fmtDateTime(r.primary_drop_arrived_at),
          primaryDropArrivedAtRaw: rawDateTime(r.primary_drop_arrived_at),
          primaryDropCompletedAt: fmtDateTime(r.primary_drop_completed_at),
          primaryDropCompletedAtRaw: rawDateTime(r.primary_drop_completed_at),
          freight: fmtAmount(r.freight_amount_gbp),
          freightValue,
          loadType: r.load_type || "general",
          loadWeightKg: r.load_weight_kg,
          loadVolumeCbm: r.load_volume_cbm,
          vehicleRequirement: r.vehicle_type_requirement || "—",
          loadDescription: r.load_description || "—",
          specialInstructions: r.special_instructions || "—",
          dispatcherNotes: r.dispatcher_notes || "—",
          status: r.dispatch_status,
          statusTone: dispatchTone[r.dispatch_status] || "neutral",
          priority: r.priority_level,
          priorityTone: priorityTone[r.priority_level] || "neutral",
          podStatus: r.pod_status,
          stopCount: r.stop_count,
          stops: stopsForTrip.map((s, i) => {
            const isReturnPoint = isReturnStop(s, pickupPostcode, lastStopId);
            return ({
            id: s.id,
            order: i + 1,
            type: s.stop_type,
            label: isReturnPoint ? "Return point" : `${(s.stop_type || "stop").toUpperCase()} ${i + 1}`,
            address: s.address || "—",
            contactName: s.contact_name || "—",
            contactPhone: s.contact_phone || "—",
            plannedArrival: fmtDateTime(s.planned_arrival),
            plannedArrivalRaw: rawDateTime(s.planned_arrival),
            plannedDeparture: fmtDateTime(s.planned_departure),
            plannedDepartureRaw: rawDateTime(s.planned_departure),
            actualArrival: fmtDateTime(s.actual_arrival),
            actualArrivalRaw: rawDateTime(s.actual_arrival),
            actualDeparture: fmtDateTime(s.actual_departure),
            actualDepartureRaw: rawDateTime(s.actual_departure),
            status: s.status || "pending",
            statusLabel: stopStatusLabel[s.status] || "Pending",
            isReturnPoint,
            notes: s.notes || "—"
          });
          }),
          reference: r.reference || "",
          loadId: r.load_id || "",
          cancellationReason: r.cancellation_reason || "",
          delayReason: r.delay_reason || "",
          loadingDoneTime: rawDateTime(r.loading_done_time),
          loadingDurationMins: loadingMins,
          unloadingDurationMins: unloadingMins,
          calculatedArrival: rawDateTime(r.calculated_arrival),
          calculatedUnloadEnd: rawDateTime(r.calculated_unload_end),
          totalJobDurationMins,
          economics: econ,
          profitLossValue,
          profitLoss: profitLossValue !== null ? fmtAmount(Math.abs(profitLossValue)) : null,
          isProfitable: profitLossValue !== null ? profitLossValue >= 0 : null,
          settings: { avgSpeedMph: settings.avg_speed_mph }
        };
      })
    });
  } catch (err) {
    res.status(500).json({ message: "Job list error", error: err.message });
  }
};

// PATCH /api/jobs/:id/assignment
exports.updateJobAssignment = async (req, res) => {
  try {
    await ensureDriverOpsSchema();
    await ensureSoftDeleteSchema();
    await ensureJobCostSchema();

    const { id } = req.params;
    const driverId = req.body.driver_id || req.body.driverId || null;
    const vehicleId = req.body.vehicle_id || req.body.vehicleId || null;
    const trailerId = req.body.trailer_id || req.body.trailerId || null;
    const hasFreight = Object.prototype.hasOwnProperty.call(req.body, "freight_amount") || Object.prototype.hasOwnProperty.call(req.body, "freightAmount");
    const freightAmount = hasFreight ? (req.body.freight_amount ?? req.body.freightAmount) : undefined;
    const priorityLevel = req.body.priority_level || req.body.priorityLevel || null;

    const [[job]] = await db.query(
      `SELECT id, trip_code, driver_id, vehicle_id, trailer_id, freight_amount_gbp, priority_level, dispatch_status
       FROM trips WHERE id = ? AND deleted_at IS NULL`,
      [id]
    );
    if (!job) return res.status(404).json({ message: "Job not found." });

    if (driverId) {
      const [[driver]] = await db.query(
        `SELECT id FROM drivers WHERE id = ? AND compliance_status != 'blocked'`,
        [driverId]
      );
      if (!driver) return res.status(400).json({ message: "Selected driver is not available for assignment." });
      const [[busyDriver]] = await db.query(
        `SELECT trip_code FROM trips WHERE driver_id = ? AND id != ? AND deleted_at IS NULL AND dispatch_status IN ('planned','loading','active')`,
        [driverId, id]
      );
      if (busyDriver) return res.status(400).json({ message: `Driver is already assigned to job ${busyDriver.trip_code} and won't be free until that job is finished.` });
    }
    if (vehicleId) {
      const [[vehicle]] = await db.query(`SELECT id FROM vehicles WHERE id = ? AND status != 'stopped'`, [vehicleId]);
      if (!vehicle) return res.status(400).json({ message: "Selected truck is not available for assignment." });
      const [[busyVehicle]] = await db.query(
        `SELECT trip_code FROM trips WHERE vehicle_id = ? AND id != ? AND deleted_at IS NULL AND dispatch_status IN ('planned','loading','active')`,
        [vehicleId, id]
      );
      if (busyVehicle) return res.status(400).json({ message: `Truck is already assigned to job ${busyVehicle.trip_code} and won't be free until that job is finished.` });
    }
    if (trailerId) {
      const [[trailer]] = await db.query(`SELECT id FROM trailers WHERE id = ? AND status != 'maintenance'`, [trailerId]);
      if (!trailer) return res.status(400).json({ message: "Selected trailer is not available for assignment." });
      const [[busyTrailer]] = await db.query(
        `SELECT trip_code FROM trips WHERE trailer_id = ? AND id != ? AND deleted_at IS NULL AND dispatch_status IN ('planned','loading','active')`,
        [trailerId, id]
      );
      if (busyTrailer) return res.status(400).json({ message: `Trailer is already assigned to job ${busyTrailer.trip_code} and won't be free until that job is finished.` });
    }

    const driverChanged = Object.prototype.hasOwnProperty.call(req.body, "driver_id") || Object.prototype.hasOwnProperty.call(req.body, "driverId")
      ? String(job.driver_id || "") !== String(driverId || "")
      : false;
    const updates = [];
    const values = [];

    if (Object.prototype.hasOwnProperty.call(req.body, "driver_id") || Object.prototype.hasOwnProperty.call(req.body, "driverId")) {
      updates.push("driver_id = ?");
      values.push(driverId || null);
      updates.push("driver_job_status = IF(? = 1 AND ? IS NOT NULL, 'offered', driver_job_status)");
      values.push(driverChanged ? 1 : 0, driverId || null);
    }
    if (Object.prototype.hasOwnProperty.call(req.body, "vehicle_id") || Object.prototype.hasOwnProperty.call(req.body, "vehicleId")) {
      updates.push("vehicle_id = ?");
      values.push(vehicleId || null);
    }
    if (Object.prototype.hasOwnProperty.call(req.body, "trailer_id") || Object.prototype.hasOwnProperty.call(req.body, "trailerId")) {
      updates.push("trailer_id = ?");
      values.push(trailerId || null);
    }
    if (hasFreight && freightAmount !== '' && freightAmount != null && optionalNonNegativeNumber(freightAmount) == null) return res.status(400).json({ message: 'Freight must be a finite amount of zero or more.' });
    if (priorityLevel && !['standard','priority','critical'].includes(priorityLevel)) return res.status(400).json({ message: 'Invalid priority.' });
    if (hasFreight) {
      updates.push("freight_amount_gbp = ?");
      values.push(freightAmount === "" || freightAmount == null ? null : Number(freightAmount));
    }
    if (priorityLevel) {
      updates.push("priority_level = ?");
      values.push(priorityLevel);
    }

    if (updates.length === 0) {
      return res.status(400).json({ message: "No editable job fields supplied." });
    }

    await db.query(
      `UPDATE trips SET ${updates.join(", ")} WHERE id = ? AND deleted_at IS NULL`,
      [...values, id]
    );
    if (Object.hasOwn(req.body, 'vehicle_id') || Object.hasOwn(req.body, 'vehicleId')) {
      if (job.vehicle_id && String(job.vehicle_id) !== String(vehicleId || '')) await db.query("UPDATE vehicles SET status='available' WHERE id=?", [job.vehicle_id]);
      if (vehicleId) await db.query('UPDATE vehicles SET status=? WHERE id=?', [job.dispatch_status === 'active' ? 'in_transit' : ['planned','loading'].includes(job.dispatch_status) ? 'planned' : 'available', vehicleId]);
    }
    if (Object.hasOwn(req.body, 'trailer_id') || Object.hasOwn(req.body, 'trailerId')) {
      if (job.trailer_id && String(job.trailer_id) !== String(trailerId || '')) await db.query("UPDATE trailers SET status='available' WHERE id=?", [job.trailer_id]);
      if (trailerId) await db.query('UPDATE trailers SET status=? WHERE id=?', [trailerStatusForJob(job.dispatch_status), trailerId]);
    }

    if (driverChanged && driverId) {
      await db.query(
        `INSERT INTO driver_job_status_events (trip_id, driver_id, status, reason, source, created_at)
         VALUES (?, ?, 'offered', 'Job offered by dispatch', 'dispatch', ?)`,
        [id, driverId, ukNowDateTimeKey()]
      );

      const [[assignedJob]] = await db.query(
        `SELECT t.trip_code, t.planned_departure,
                COALESCE(c.company_name, t.client_name, 'Customer TBD') AS customer_name,
                COALESCE(r.origin_hub, t.pickup_address, 'Pickup TBD') AS pickup_label,
                COALESCE(r.destination_hub, t.drop_address, 'Drop TBD') AS drop_label,
                d.full_name AS driver_name
         FROM trips t
         LEFT JOIN customers c ON c.id = t.customer_id
         LEFT JOIN routes r ON r.id = t.route_id
         LEFT JOIN drivers d ON d.id = t.driver_id
         WHERE t.id = ?`,
        [id]
      );
      const body = `New job assigned: ${assignedJob?.trip_code || job.trip_code}. ${assignedJob?.customer_name || "Customer TBD"} · ${assignedJob?.pickup_label || "Pickup TBD"} to ${assignedJob?.drop_label || "Drop TBD"}. Please open Driver Panel and accept/start the job.`;
      const [messageResult] = await db.query(
        `INSERT INTO driver_messages (driver_id, sender_role, sender_name, body, trip_id)
         VALUES (?, 'dispatch', 'Dispatch', ?, ?)`,
        [driverId, body, id]
      );
      const [[createdMessage]] = await db.query(`SELECT * FROM driver_messages WHERE id=?`, [messageResult.insertId]);
      const message = {
        id: createdMessage.id,
        driverId: Number(driverId),
        driverName: assignedJob?.driver_name || "Driver",
        senderRole: createdMessage.sender_role,
        senderName: createdMessage.sender_name || "Dispatch",
        body: createdMessage.body,
        tripId: createdMessage.trip_id,
        isRead: Boolean(createdMessage.is_read),
        at: fmtDateTime(createdMessage.sent_at),
        sentAt: createdMessage.sent_at ? new Date(createdMessage.sent_at).toISOString() : null
      };
      emitDriverChatMessage(message);
      emitDriverJobAssigned({
        driverId: Number(driverId),
        jobId: Number(id),
        jobCode: assignedJob?.trip_code || job.trip_code,
        message: body
      });
    }

    await logActivity(req, {
      module: "jobs",
      action: "inline_update",
      entityType: "job",
      entityId: id,
      entityLabel: job.trip_code,
      details: {
        previous_driver_id: job.driver_id,
        driver_id: Object.prototype.hasOwnProperty.call(req.body, "driver_id") || Object.prototype.hasOwnProperty.call(req.body, "driverId") ? driverId || null : job.driver_id,
        vehicle_id: Object.prototype.hasOwnProperty.call(req.body, "vehicle_id") || Object.prototype.hasOwnProperty.call(req.body, "vehicleId") ? vehicleId || null : job.vehicle_id,
        trailer_id: Object.prototype.hasOwnProperty.call(req.body, "trailer_id") || Object.prototype.hasOwnProperty.call(req.body, "trailerId") ? trailerId || null : job.trailer_id,
        freight_amount_gbp: hasFreight ? freightAmount : job.freight_amount_gbp,
        priority_level: priorityLevel || job.priority_level
      }
    });

    emitJobUpdate({ jobId: Number(id), source: "admin-planner", previousDriverId: job.driver_id });

    res.json({ message: "Job updated from planner." });
  } catch (err) {
    res.status(500).json({ message: "Planner update error", error: err.message });
  }
};

// Read-only route preview. Keep every stop in order, including unresolved stops.
exports.getRouteMap = async (req, res) => {
  try {
    await ensureDriverOpsSchema();
    await ensureSoftDeleteSchema();
    const [[job]] = await db.query(
      `SELECT t.pickup_address, t.drop_address, r.origin_hub, r.destination_hub
       FROM trips t LEFT JOIN routes r ON r.id=t.route_id WHERE t.id=? AND t.deleted_at IS NULL`, [req.params.id]
    );
    if (!job) return res.status(404).json({ message: "Job not found." });
    const [stops] = await db.query(`SELECT address, stop_type FROM job_stops WHERE trip_id=? ORDER BY stop_order, id`, [req.params.id]);
    const locations = [
      { address: job.pickup_address || job.origin_hub || "", label: "Collection" },
      { address: job.drop_address || job.destination_hub || "", label: "Drop 1" },
      ...stops.map((s, i) => ({ address: s.address, label: `${s.stop_type === "pickup" ? "Pickup" : s.stop_type === "waypoint" ? "Waypoint" : "Drop"} ${i + 2}` }))
    ];
    const lookups = new Map();
    const points = await Promise.all(locations.map(async (location, index) => {
      const postcode = extractUkPostcode(location.address);
      if (postcode && !lookups.has(postcode)) lookups.set(postcode, lookupPostcode(postcode).catch(() => null));
      const point = postcode ? await lookups.get(postcode) : null;
      return { ...location, index, ...(point || {}), resolved: Boolean(point) };
    }));
    const legs = await Promise.all(points.slice(1).map(async (to, index) => {
      const from = points[index];
      const base = { from: index, to: index + 1, coordinates: [], distanceMiles: null, durationMins: null, source: "unavailable" };
      if (!from.resolved || !to.resolved) return base;
      try {
        const coords = `${from.longitude},${from.latitude};${to.longitude},${to.latitude}`;
        const data = await fetchJson(`https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=false`, 10000);
        const route = data.routes?.[0];
        if (route?.geometry?.coordinates?.length) return { ...base, coordinates: route.geometry.coordinates, distanceMiles: Math.round(route.distance / 1609.344 * 10) / 10, durationMins: Math.round(route.duration / 60), source: "road" };
      } catch { /* Preserve the sequence when the routing service is unavailable. */ }
      return { ...base, coordinates: [[from.longitude, from.latitude], [to.longitude, to.latitude]], source: "straight-line" };
    }));
    res.json({ points, legs });
  } catch (err) {
    res.status(500).json({ message: "Could not load route map. Please retry." });
  }
};

// GET /api/jobs/:id
exports.getJobById = async (req, res) => {
  try {
    await ensureDriverOpsSchema();
    await ensureSoftDeleteSchema();
    await ensureJobCostSchema();
    await ensureReferenceSchema();

    const { id } = req.params;

    const settingsMap = await getSettingsMap();
    const settings = {
      fuel_price_per_litre: parseFloat(settingsMap.fuel_price_per_litre),
      mpg: parseFloat(settingsMap.mpg),
      driver_rate_per_hour: parseFloat(settingsMap.driver_rate_per_hour),
      margin_pct: parseFloat(settingsMap.margin_pct),
      avg_speed_mph: parseFloat(settingsMap.avg_speed_mph)
    };

    const [[t]] = await db.query(
      `SELECT t.*,
              c.company_name, c.contact_name as cust_contact, c.email as cust_email, c.phone as cust_phone,
              t.client_phone,
              r.route_code, r.origin_hub, r.destination_hub,
              COALESCE(t.estimated_distance_km, r.distance_km) AS distance_km,
              COALESCE(t.estimated_eta_mins / 60, r.standard_eta_hours) AS standard_eta_hours,
              r.toll_estimate_gbp,
              d.full_name as driver_name, d.phone as driver_phone, d.employee_code, d.license_number, d.compliance_status,
              v.registration_number, v.model_name, v.truck_type, v.fleet_code, v.capacity_tonnes,
              tr.trailer_code, tr.registration_number AS trailer_registration, tr.trailer_type,
              tr.capacity_tonnes AS trailer_capacity_tonnes
       FROM trips t
       LEFT JOIN customers c ON t.customer_id = c.id
       LEFT JOIN routes    r ON t.route_id    = r.id
       LEFT JOIN drivers   d ON t.driver_id   = d.id
       LEFT JOIN vehicles  v ON t.vehicle_id  = v.id
       LEFT JOIN trailers  tr ON t.trailer_id  = tr.id
       WHERE t.id = ? AND t.deleted_at IS NULL`,
      [id]
    );
    if (!t) return res.status(404).json({ message: "Job not found." });
    const hydratedJob = t;
    const j = hydratedJob;

    const [stops] = await db.query(
      `SELECT * FROM job_stops WHERE trip_id = ? ORDER BY stop_order ASC`, [id]
    );
    Object.assign(j, normalisePlan({ ...j, stops }));
    const [expenses] = await db.query(
      `SELECT e.*, d.full_name
       FROM driver_expenses e
       LEFT JOIN drivers d ON d.id = e.driver_id
       WHERE e.trip_id = ?
       ORDER BY e.expense_at DESC`,
      [id]
    );
    const [[actualEvidence]] = await db.query(
      `SELECT
         COALESCE(SUM(status IN ('in_transit','arrived_drop','delivered')), 0) AS departure_events,
         COALESCE(SUM(status='delivered'), 0) AS arrival_events,
         MIN(CASE WHEN status='arrived_pickup' THEN created_at END) AS collection_arrived_at
       FROM driver_job_status_events WHERE trip_id=?`,
      [id]
    );
    const [defects] = j.vehicle_id ? await db.query(
      `SELECT * FROM defect_reports
       WHERE vehicle_id = ?
       ORDER BY reported_at DESC LIMIT 8`,
      [j.vehicle_id]
    ) : [[]];

    const stopStatusTone = { pending: "neutral", arrived: "warning", completed: "success", skipped: "danger" };
    const driverStatus = hydratedJob.driver_job_status || "accepted";

    res.json({
      id: hydratedJob.id,
      code: hydratedJob.trip_code,
      status: hydratedJob.dispatch_status,
      statusTone: dispatchTone[hydratedJob.dispatch_status] || "neutral",
      priority: hydratedJob.priority_level,
      priorityTone: priorityTone[hydratedJob.priority_level] || "neutral",
      podStatus: hydratedJob.pod_status,
      delayReason: hydratedJob.delay_reason,
      cancellationReason: hydratedJob.cancellation_reason,
      failedDeliveryReason: hydratedJob.failed_delivery_reason,
      specialInstructions: hydratedJob.special_instructions,
      form: {
        customer_id: j.customer_id,
        route_id: j.route_id,
        driver_id: j.driver_id,
        vehicle_id: j.vehicle_id,
        trailer_id: j.trailer_id,
        planned_departure: rawDateTime(j.planned_departure),
        delivery_deadline: rawDateTime(j.delivery_deadline)
      },
      driverExecution: {
        status: driverStatus,
        statusLabel: driverStatusLabel[driverStatus] || driverStatus,
        statusTone: driverStatusTone[driverStatus] || "neutral",
        deliveryNotes: j.delivery_notes || "—",
        failedDeliveryReason: j.failed_delivery_reason || "—"
      },
      proofOfDelivery: {
        status: j.pod_status,
        signatureData: j.pod_signature_data || "",
        photoData: j.pod_photo_data || "",
        deliveryNotes: j.delivery_notes || ""
      },

      customer: j.company_name ? {
        name: j.company_name,
        contact: j.cust_contact,
        email: j.cust_email,
        phone: j.cust_phone
      } : { name: j.client_name || "—", phone: j.client_phone || "—" },

      route: {
        code: j.route_code,
        from: j.origin_hub || j.pickup_address,
        to: j.destination_hub || j.drop_address,
        pickupAddress: j.pickup_address,
        dropAddress: j.drop_address,
        distanceKm: j.distance_km,
        distanceMiles: j.distance_km ? Math.round(j.distance_km * 0.621371 * 10) / 10 : null,
        etaHours: j.standard_eta_hours,
        tollEstimate: fmtAmount(j.toll_estimate_gbp)
      },

      schedule: {
        collectionArrival: fmtDateTime(j.planned_departure),
        actualCollectionArrival: fmtDateTime(actualEvidence.collection_arrived_at),
        collectionDeparture: fmtDateTime(j.loading_done_time),
        plannedDeliveryArrival: fmtDateTime(j.calculated_arrival || j.eta),
        plannedDeliveryDeparture: fmtDateTime(j.calculated_unload_end),
        eta: fmtDateTime(j.eta),
        actualDeparture: fmtDateTime(j.actual_departure),
        actualArrival: fmtDateTime(j.actual_arrival),
        deliveryDeadline: fmtDateTime(j.delivery_deadline),
        dockWindow: j.dock_window || "—"
      },

      load: {
        type: j.load_type || "general",
        weightKg: j.load_weight_kg ? `${j.load_weight_kg} kg` : "—",
        volumeCbm: j.load_volume_cbm ? `${j.load_volume_cbm} cbm` : "—",
        vehicleRequirement: j.vehicle_type_requirement || "—",
        description: j.load_description || "—",
        freight: fmtAmount(j.freight_amount_gbp),
        freightValue: Number(j.freight_amount_gbp || 0),
        reference: j.reference || "—",
        loadId: j.load_id || "—"
      },
      dispatcherNotes: j.dispatcher_notes || "—",

      timing: {
        loadingDoneTime: rawDateTime(j.loading_done_time),
        loadingDurationMins: effectiveLoadingMins(j),
        unloadingDurationMins: effectiveUnloadingMins(j),
        calculatedArrival: rawDateTime(j.calculated_arrival),
        calculatedUnloadEnd: rawDateTime(j.calculated_unload_end),
        totalJobDurationMins: j.total_job_duration_mins
      },

      economics: (() => {
        const fallbackTravelMins = j.standard_eta_hours ? Math.round(Number(j.standard_eta_hours) * 60) : 0;
        const econ = calcJobEconomics(j.distance_km, j.total_job_duration_mins, settings, fallbackTravelMins, effectiveLoadingMins(j), effectiveUnloadingMins(j), j.toll_estimate_gbp);
        if (!econ) return null;
        const freightValue = j.freight_amount_gbp == null ? null : Number(j.freight_amount_gbp);
        const profitLossValue = freightValue !== null ? Math.round((freightValue - econ.totalCost) * 100) / 100 : null;
        return {
          ...econ,
          freightValue,
          profitLossValue,
          profitLoss: profitLossValue == null ? null : fmtAmount(Math.abs(profitLossValue)),
          isProfitable: profitLossValue == null ? null : profitLossValue >= 0,
          settings: {
            fuelPricePerLitre: settings.fuel_price_per_litre,
            mpg: settings.mpg,
            driverRatePerHour: settings.driver_rate_per_hour,
            marginPct: settings.margin_pct,
            avgSpeedMph: settings.avg_speed_mph
          }
        };
      })(),

      driver: t.driver_name ? {
        name: t.driver_name,
        phone: t.driver_phone,
        employeeCode: t.employee_code,
        license: t.license_number,
        compliance: t.compliance_status
      } : null,

      vehicle: t.registration_number ? {
        registration: t.registration_number,
        model: t.model_name,
        type: t.truck_type,
        fleetCode: t.fleet_code,
        capacity: t.capacity_tonnes ? `${t.capacity_tonnes}t` : "—"
      } : null,

      trailer: t.trailer_registration ? {
        code: t.trailer_code,
        registration: t.trailer_registration,
        type: t.trailer_type,
        capacity: t.trailer_capacity_tonnes ? `${t.trailer_capacity_tonnes}t` : "—"
      } : null,

      stops: stops.map((s, i) => ({
        id: s.id,
        order: s.stop_order,
        type: s.stop_type,
        address: s.address,
        contactName: s.contact_name || "—",
        contactPhone: s.contact_phone || "—",
        plannedArrival: fmtDateTime(s.planned_arrival),
        plannedArrivalRaw: rawDateTime(s.planned_arrival),
        plannedDeparture: fmtDateTime(s.planned_departure),
        plannedDepartureRaw: rawDateTime(s.planned_departure),
        actualArrival: fmtDateTime(s.actual_arrival),
        actualArrivalRaw: rawDateTime(s.actual_arrival),
        actualDeparture: fmtDateTime(s.actual_departure),
        actualDepartureRaw: rawDateTime(s.actual_departure),
        status: s.status,
        tone: stopStatusTone[s.status] || "neutral",
        notes: s.notes || "—"
      })),

      driverExpenses: expenses.map(e => ({
        id: e.id,
        type: e.expense_type,
        amount: fmtAmount(e.amount_gbp),
        notes: e.notes || "—",
        driver: e.full_name || "Driver",
        at: fmtDateTime(e.expense_at)
      })),

      vehicleDefects: defects.map(d => ({
        id: d.id,
        type: d.defect_type,
        description: d.description || "—",
        severity: d.severity,
        tone: d.severity === "critical" || d.severity === "high" ? "danger" : d.severity === "medium" ? "warning" : "neutral",
        reportedBy: d.reported_by || "—",
        status: d.status,
        at: fmtDateTime(d.reported_at)
      }))
    });
  } catch (err) {
    res.status(500).json({ message: "Job detail error", error: err.message });
  }
};

// POST /api/jobs
exports.createJob = async (req, res) => {
  const conn = await db.getConnection();
  try {
    await ensureDriverOpsSchema();
    await ensureSoftDeleteSchema();
    await ensureJobCostSchema();
    await ensureReferenceSchema();
    await conn.beginTransaction();

    if (!Array.isArray(req.body.stops || [])) { await conn.rollback(); return res.status(400).json({ message: 'Stops must be a list.' }); }
    const inputError = validateJobTiming(req.body);
    if (inputError) { await conn.rollback(); return res.status(400).json({ message: inputError }); }
    req.body = normalisePlan(req.body);
    const {
      customer_id, client_name, client_phone,
      route_id, pickup_address, drop_address,
      planned_departure, dock_window,
      load_type, load_weight_kg, load_volume_cbm, vehicle_type_requirement, delivery_deadline, load_description,
      freight_amount, priority_level, special_instructions,
      driver_id, vehicle_id, trailer_id, dispatcher_notes,
      loading_done_time, loading_duration_mins, unloading_duration_mins,
      estimated_distance_km, estimated_eta_mins,
      calculated_arrival, calculated_unload_end, total_job_duration_mins,
      reference, load_id,
      stops = []
    } = req.body;

    const timingError = validateJobTiming(req.body);
    if (timingError) {
      await conn.rollback();
      return res.status(400).json({ message: timingError });
    }

    let resolvedClientName = client_name || null;
    if (customer_id && !resolvedClientName) {
      const [[customer]] = await conn.query(`SELECT company_name FROM customers WHERE id = ?`, [customer_id]);
      resolvedClientName = customer?.company_name || null;
    }

    if (!customer_id && !resolvedClientName) {
      await conn.rollback();
      return res.status(400).json({ message: "Select a customer or enter a client name." });
    }

    if (driver_id) {
      const [[busyDriver]] = await conn.query(
        `SELECT trip_code FROM trips WHERE driver_id = ? AND deleted_at IS NULL AND dispatch_status IN ('planned','loading','active')`,
        [driver_id]
      );
      if (busyDriver) {
        await conn.rollback();
        return res.status(400).json({ message: `Driver is already assigned to job ${busyDriver.trip_code} and won't be free until that job is finished.` });
      }
    }
    if (vehicle_id) {
      const [[busyVehicle]] = await conn.query(
        `SELECT trip_code FROM trips WHERE vehicle_id = ? AND deleted_at IS NULL AND dispatch_status IN ('planned','loading','active')`,
        [vehicle_id]
      );
      if (busyVehicle) {
        await conn.rollback();
        return res.status(400).json({ message: `Truck is already assigned to job ${busyVehicle.trip_code} and won't be free until that job is finished.` });
      }
    }
    if (trailer_id) {
      const [[busyTrailer]] = await conn.query(
        `SELECT trip_code FROM trips WHERE trailer_id = ? AND deleted_at IS NULL AND dispatch_status IN ('planned','loading','active')`,
        [trailer_id]
      );
      if (busyTrailer) {
        await conn.rollback();
        return res.status(400).json({ message: `Trailer is already assigned to job ${busyTrailer.trip_code} and won't be free until that job is finished.` });
      }
    }

    const routeStartTime = loading_done_time || planned_departure;
    let eta = null;
    if (estimated_eta_mins && routeStartTime) {
      eta = addWallMinutes(routeStartTime, Number(estimated_eta_mins));
    } else if (route_id && routeStartTime) {
      const [[route]] = await conn.query(`SELECT standard_eta_hours FROM routes WHERE id = ?`, [route_id]);
      if (route) {
        eta = addWallMinutes(routeStartTime, Number(route.standard_eta_hours) * 60);
      }
    }

    const jobCode = await generateJobCode(conn);

    const [result] = await conn.query(
      `INSERT INTO trips
         (trip_code, customer_id, client_name, client_phone, route_id, vehicle_id, trailer_id, driver_id,
          pickup_address, drop_address, dispatch_status, priority_level,
          planned_departure, eta, dock_window, pod_status,
          load_type, load_weight_kg, load_volume_cbm, vehicle_type_requirement, delivery_deadline,
          load_description, freight_amount_gbp, special_instructions, dispatcher_notes,
          driver_job_status,
          loading_done_time, loading_duration_mins, unloading_duration_mins, estimated_distance_km, estimated_eta_mins,
          calculated_arrival, calculated_unload_end, total_job_duration_mins,
          reference, load_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'planned', ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        jobCode,
        customer_id || null,
        resolvedClientName,
        client_phone || null,
        route_id || null,
        vehicle_id || null,
        trailer_id || null,
        driver_id || null,
        pickup_address || null,
        drop_address || null,
        priority_level || "standard",
        planned_departure || null,
        calculated_arrival || eta,
        dock_window || null,
        load_type || "general",
        load_weight_kg || null,
        load_volume_cbm || null,
        vehicle_type_requirement || null,
        delivery_deadline || null,
        load_description || null,
        optionalNonNegativeNumber(freight_amount),
        special_instructions || null,
        dispatcher_notes || null,
        driver_id ? "offered" : null,
        loading_done_time || null,
        loading_duration_mins != null ? Number(loading_duration_mins) : DEFAULT_LOADING_MINS,
        unloading_duration_mins != null ? Number(unloading_duration_mins) : DEFAULT_UNLOADING_MINS,
        estimated_distance_km ? Number(estimated_distance_km) : null,
        estimated_eta_mins ? Number(estimated_eta_mins) : null,
        calculated_arrival || null,
        calculated_unload_end || null,
        optionalNonNegativeNumber(total_job_duration_mins),
        reference || null,
        load_id || null
      ]
    );

    const jobId = result.insertId;

    if (vehicle_id) {
      await conn.query(
        `UPDATE vehicles
         SET status='planned', current_location=NULL, speed_kph=0,
             gps_latitude=NULL, gps_longitude=NULL, gps_accuracy_m=NULL, last_ping_at=NULL
         WHERE id=?`,
        [vehicle_id]
      );
    }
    if (trailer_id) {
      await conn.query(`UPDATE trailers SET status='planned' WHERE id=?`, [trailer_id]);
    }

    // Insert stops
    for (let i = 0; i < stops.length; i++) {
      const s = stops[i];
      if (!s.address) continue;
      await conn.query(
        `INSERT INTO job_stops (trip_id, stop_order, stop_type, address, contact_name, contact_phone, planned_arrival, planned_departure, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [jobId, i + 1, s.stop_type || "delivery", s.address, s.contact_name || null, s.contact_phone || null, s.planned_arrival || null, s.planned_departure || null, s.notes || null]
      );
    }

    await conn.commit();

    const [[newJob]] = await db.query(`SELECT id, trip_code FROM trips WHERE id = ?`, [jobId]);
    await logActivity(req, {
      module: "jobs",
      action: "create",
      entityType: "job",
      entityId: jobId,
      entityLabel: newJob?.trip_code || jobCode,
      details: { customer_id, client_name: resolvedClientName, client_phone, vehicle_id, trailer_id, driver_id }
    });
    emitJobUpdate({ jobId, source: "admin-create" });
    res.status(201).json({ message: "Job created.", job: newJob });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ message: "Job create error", error: err.message });
  } finally {
    conn.release();
  }
};

// PUT /api/jobs/:id
exports.updateJob = async (req, res) => {
  const conn = await db.getConnection();
  try {
    await ensureDriverOpsSchema();
    await ensureSoftDeleteSchema();
    await ensureJobCostSchema();
    await ensureReferenceSchema();
    await conn.beginTransaction();
    const { id } = req.params;

    const [[existing]] = await conn.query(`SELECT * FROM trips WHERE id = ? AND deleted_at IS NULL FOR UPDATE`, [id]);
    if (!existing) {
      await conn.rollback();
      return res.status(404).json({ message: "Job not found." });
    }

    const [savedStops] = await conn.query(`SELECT * FROM job_stops WHERE trip_id = ? ORDER BY stop_order, id FOR UPDATE`, [id]);
    const patch = req.body;
    if (patch.require_planned && existing.dispatch_status !== 'planned') { await conn.rollback(); return res.status(409).json({ message: 'Driver progress changed this job. Reload before editing.' }); }
    req.body = mergeJobUpdate(existing, patch, savedStops);
    const pathChanged = ['pickup_address', 'drop_address'].some(key => Object.hasOwn(patch, key) && patch[key] !== existing[key]) ||
      (Array.isArray(patch.stops) && (patch.stops.length !== savedStops.length || patch.stops.some((s, i) => s.address !== savedStops[i]?.address)));
    if (pathChanged && !Object.hasOwn(patch, 'estimated_distance_km')) {
      req.body.estimated_distance_km = null; req.body.estimated_eta_mins = null; req.body.route_id = null;
    }
    if (!Array.isArray(req.body.stops)) { await conn.rollback(); return res.status(400).json({ message: 'Stops must be a list.' }); }
    const inputError = validateJobTiming(req.body);
    if (inputError) { await conn.rollback(); return res.status(400).json({ message: inputError }); }
    req.body = normalisePlan(req.body);
    const {
      customer_id, client_name, client_phone,
      route_id, pickup_address, drop_address,
      planned_departure, dock_window,
      load_type, load_weight_kg, load_volume_cbm, vehicle_type_requirement, delivery_deadline, load_description,
      freight_amount, priority_level, special_instructions,
      driver_id, vehicle_id, trailer_id, dispatcher_notes,
      loading_done_time, loading_duration_mins, unloading_duration_mins,
      estimated_distance_km, estimated_eta_mins,
      calculated_arrival, calculated_unload_end, total_job_duration_mins,
      reference, load_id,
      stops = []
    } = req.body;

    const timingError = validateJobTiming(req.body);
    if (timingError) {
      await conn.rollback();
      return res.status(400).json({ message: timingError });
    }

    let resolvedClientName = client_name || null;
    if (customer_id && !resolvedClientName) {
      const [[customer]] = await conn.query(`SELECT company_name FROM customers WHERE id = ?`, [customer_id]);
      resolvedClientName = customer?.company_name || null;
    }

    if (!customer_id && !resolvedClientName) {
      await conn.rollback();
      return res.status(400).json({ message: "Select a customer or enter a client name." });
    }

    if (driver_id) {
      const [[busyDriver]] = await conn.query(
        `SELECT trip_code FROM trips WHERE driver_id = ? AND id != ? AND deleted_at IS NULL AND dispatch_status IN ('planned','loading','active')`,
        [driver_id, id]
      );
      if (busyDriver) {
        await conn.rollback();
        return res.status(400).json({ message: `Driver is already assigned to job ${busyDriver.trip_code} and won't be free until that job is finished.` });
      }
    }
    if (vehicle_id) {
      const [[busyVehicle]] = await conn.query(
        `SELECT trip_code FROM trips WHERE vehicle_id = ? AND id != ? AND deleted_at IS NULL AND dispatch_status IN ('planned','loading','active')`,
        [vehicle_id, id]
      );
      if (busyVehicle) {
        await conn.rollback();
        return res.status(400).json({ message: `Truck is already assigned to job ${busyVehicle.trip_code} and won't be free until that job is finished.` });
      }
    }
    if (trailer_id) {
      const [[busyTrailer]] = await conn.query(
        `SELECT trip_code FROM trips WHERE trailer_id = ? AND id != ? AND deleted_at IS NULL AND dispatch_status IN ('planned','loading','active')`,
        [trailer_id, id]
      );
      if (busyTrailer) {
        await conn.rollback();
        return res.status(400).json({ message: `Trailer is already assigned to job ${busyTrailer.trip_code} and won't be free until that job is finished.` });
      }
    }

    const routeStartTime = loading_done_time || planned_departure;
    let eta = null;
    if (estimated_eta_mins && routeStartTime) {
      eta = addWallMinutes(routeStartTime, Number(estimated_eta_mins));
    } else if (route_id && routeStartTime) {
      const [[route]] = await conn.query(`SELECT standard_eta_hours FROM routes WHERE id = ?`, [route_id]);
      if (route) eta = addWallMinutes(routeStartTime, Number(route.standard_eta_hours) * 60);
    }

    // Reset old vehicle if changed
    if (existing.vehicle_id && String(existing.vehicle_id) !== String(vehicle_id || "")) {
      await conn.query(`UPDATE vehicles SET status='available' WHERE id=?`, [existing.vehicle_id]);
    }
    if (existing.trailer_id && String(existing.trailer_id) !== String(trailer_id || "")) {
      await conn.query(`UPDATE trailers SET status='available' WHERE id=?`, [existing.trailer_id]);
    }
    if (vehicle_id) {
      const vehicleChanged = String(existing.vehicle_id || "") !== String(vehicle_id || "") ? 1 : 0;
      await conn.query(
        `UPDATE vehicles
         SET status=?,
             current_location=IF(? = 1, NULL, current_location),
             speed_kph=IF(? = 1, 0, speed_kph),
             gps_latitude=IF(? = 1, NULL, gps_latitude),
             gps_longitude=IF(? = 1, NULL, gps_longitude),
             gps_accuracy_m=IF(? = 1, NULL, gps_accuracy_m),
             last_ping_at=IF(? = 1, NULL, last_ping_at)
         WHERE id=?`,
        [existing.dispatch_status === 'active' ? 'in_transit' : ['planned','loading'].includes(existing.dispatch_status) ? 'planned' : 'available', vehicleChanged, vehicleChanged, vehicleChanged, vehicleChanged, vehicleChanged, vehicleChanged, vehicle_id]
      );
    }
    if (trailer_id) {
      await conn.query(`UPDATE trailers SET status=? WHERE id=?`, [trailerStatusForJob(existing.dispatch_status), trailer_id]);
    }

    const valueOrExisting = (key, currentValue, fallback = null) =>
      Object.prototype.hasOwnProperty.call(req.body, key) ? (req.body[key] ?? fallback) : currentValue;

    await conn.query(
      `UPDATE trips SET
         customer_id=?, client_name=?, client_phone=?, route_id=?, vehicle_id=?, trailer_id=?, driver_id=?,
         pickup_address=?, drop_address=?, priority_level=?,
         planned_departure=?, eta=?, dock_window=?,
         load_type=?, load_weight_kg=?, load_volume_cbm=?, vehicle_type_requirement=?, delivery_deadline=?,
         load_description=?, freight_amount_gbp=?, special_instructions=?, dispatcher_notes=?,
         driver_job_status=IF(? = 1, 'offered', driver_job_status),
         loading_done_time=?, loading_duration_mins=?, unloading_duration_mins=?, estimated_distance_km=?, estimated_eta_mins=?,
         calculated_arrival=?, calculated_unload_end=?, total_job_duration_mins=?,
         reference=?, load_id=?
       WHERE id=? AND deleted_at IS NULL`,
      [
        customer_id || null, resolvedClientName, client_phone || null, route_id || null,
        vehicle_id || null, trailer_id || null, driver_id || null,
        pickup_address || null, drop_address || null,
        priority_level || "standard",
        planned_departure || null, existing.eta_updated_at ? existing.eta : (calculated_arrival || eta), dock_window || null,
        valueOrExisting("load_type", "general", "general"),
        valueOrExisting("load_weight_kg", null),
        valueOrExisting("load_volume_cbm", null),
        valueOrExisting("vehicle_type_requirement", null),
        delivery_deadline || null,
        load_description || null,
        optionalNonNegativeNumber(freight_amount),
        valueOrExisting("special_instructions", null),
        valueOrExisting("dispatcher_notes", null),
        String(existing.driver_id || "") !== String(driver_id || "") && driver_id ? 1 : 0,
        loading_done_time || null,
        loading_duration_mins != null ? Number(loading_duration_mins) : DEFAULT_LOADING_MINS,
        unloading_duration_mins != null ? Number(unloading_duration_mins) : DEFAULT_UNLOADING_MINS,
        estimated_distance_km ? Number(estimated_distance_km) : null,
        estimated_eta_mins ? Number(estimated_eta_mins) : null,
        calculated_arrival || null,
        calculated_unload_end || null,
        optionalNonNegativeNumber(total_job_duration_mins),
        reference || null,
        load_id || null,
        id
      ]
    );

    // Preserve stop identifiers and actual execution history on every edit.
    const oldStops = savedStops;
    const validStops = stops.filter(s => s.address);
    const retainedIds = new Set();
    for (let i = 0; i < validStops.length; i++) {
      const s = validStops[i];
      const saved = s.id ? savedStops.find(old => Number(old.id) === Number(s.id)) : savedStops[i];
      if (s.id && !saved) { await conn.rollback(); return res.status(409).json({ message: 'A stop changed. Reload the job before saving.' }); }
      if (saved) {
        retainedIds.add(saved.id);
        await conn.query(`UPDATE job_stops SET stop_order=?, stop_type=?, address=?, contact_name=?, contact_phone=?, planned_arrival=?, planned_departure=?, notes=? WHERE id=? AND trip_id=?`,
          [i + 1, s.stop_type || 'delivery', s.address, s.contact_name || null, s.contact_phone || null, s.planned_arrival || null, s.planned_departure || null, s.notes || null, saved.id, id]);
      } else await conn.query(
        `INSERT INTO job_stops (trip_id, stop_order, stop_type, address, contact_name, contact_phone, planned_arrival, planned_departure, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, i + 1, s.stop_type || "delivery", s.address, s.contact_name || null, s.contact_phone || null, s.planned_arrival || null, s.planned_departure || null, s.notes || null]
      );
    }

    for (const removed of savedStops.filter(s => !retainedIds.has(s.id))) {
      if (removed.status !== 'pending' || removed.actual_arrival || removed.actual_departure) {
        await conn.rollback(); return res.status(409).json({ message: 'A progressed stop cannot be removed; its actual history must be preserved.' });
      }
      await conn.query(`DELETE FROM job_stops WHERE id=? AND trip_id=?`, [removed.id, id]);
    }

    // Notify driver if stops changed and driver is assigned
    const stopsChanged = oldStops.length !== validStops.length || validStops.some((s, i) => {
      const old = oldStops[i];
      return !old || old.address !== s.address || (old.stop_type || "delivery") !== (s.stop_type || "delivery");
    });
    if (driver_id && stopsChanged && validStops.length > 0) {
      const [[jobRow]] = await conn.query(
        `SELECT t.trip_code, d.full_name as driver_name
         FROM trips t LEFT JOIN drivers d ON d.id = t.driver_id
         WHERE t.id = ?`, [id]
      );
      const body = `Route update for ${jobRow?.trip_code || "your job"}: ${validStops.length} stop(s) have been set on your route. Please check your updated route details.`;
      const [msgResult] = await conn.query(
        `INSERT INTO driver_messages (driver_id, sender_role, sender_name, body, trip_id) VALUES (?, 'dispatch', 'Dispatch', ?, ?)`,
        [driver_id, body, id]
      );
      const [[createdMsg]] = await conn.query(`SELECT * FROM driver_messages WHERE id = ?`, [msgResult.insertId]);
      emitDriverChatMessage({
        id: createdMsg.id,
        driverId: Number(driver_id),
        driverName: jobRow?.driver_name || "Driver",
        senderRole: "dispatch",
        senderName: "Dispatch",
        body: createdMsg.body,
        tripId: Number(id),
        isRead: false,
        at: fmtDateTime(createdMsg.sent_at),
        sentAt: createdMsg.sent_at ? new Date(createdMsg.sent_at).toISOString() : null
      });
    }

    await conn.commit();
    await logActivity(req, {
      module: "jobs",
      action: "update",
      entityType: "job",
      entityId: id,
      details: { customer_id, client_name: resolvedClientName, client_phone, vehicle_id, trailer_id, driver_id }
    });
    emitJobUpdate({ jobId: Number(id), source: 'admin-edit', driverId: driver_id, previousDriverId: existing.driver_id });
    res.json({ message: "Job updated." });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ message: "Job update error", error: err.message });
  } finally {
    conn.release();
  }
};

// PATCH /api/jobs/:id/status
exports.updateJobStatus = async (req, res) => {
  try {
    await ensureDriverOpsSchema();
    await ensureSoftDeleteSchema();

    const { id } = req.params;
    const { status, reason, actual_departure, actual_arrival } = req.body;

    const validStatuses = ["planned", "loading", "active", "blocked", "completed", "failed", "cancelled"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: "Invalid status value." });
    }

    const [[job]] = await db.query(`SELECT id, dispatch_status, vehicle_id, trailer_id, actual_departure FROM trips WHERE id = ? AND deleted_at IS NULL`, [id]);
    if (!job) return res.status(404).json({ message: "Job not found." });

    const updates = { dispatch_status: status };
    // Admin status changes do not invent operational timestamps. Actual times
    // come from driver actions, or may be supplied explicitly as UK time.
    if (actual_departure) {
      if (!isDateTimeKey(actual_departure)) return res.status(400).json({ message: "Actual departure must contain a valid UK date and time." });
      updates.actual_departure = dateTimeKey(actual_departure);
    }
    if (actual_arrival) {
      if (!isDateTimeKey(actual_arrival)) return res.status(400).json({ message: "Actual arrival must contain a valid UK date and time." });
      const departure = actual_departure || job.actual_departure;
      if (departure && wallMinutesBetween(departure, actual_arrival) < 0) {
        return res.status(400).json({ message: "Actual arrival cannot be before actual departure." });
      }
      updates.actual_arrival = dateTimeKey(actual_arrival);
    }
    if (status === "blocked")   updates.cancellation_reason = reason || null;
    if (status === "failed")    updates.cancellation_reason = reason || null;
    if (status === "cancelled") updates.cancellation_reason = reason || null;
    if (req.body.delay_reason)  updates.delay_reason = req.body.delay_reason;

    const fields = Object.keys(updates).map(k => `${k}=?`).join(", ");
    await db.query(`UPDATE trips SET ${fields} WHERE id=? AND deleted_at IS NULL`, [...Object.values(updates), id]);

    // Update vehicle status accordingly
    const terminalStatuses = ["completed", "blocked", "failed", "cancelled"];
    if (job.vehicle_id) {
      const vStatus = status === "active" ? "in_transit" : terminalStatuses.includes(status) ? "available" : "planned";
      await db.query(`UPDATE vehicles SET status=? WHERE id=?`, [vStatus, job.vehicle_id]);
    }
    if (job.trailer_id) {
      await db.query(`UPDATE trailers SET status=? WHERE id=?`, [trailerStatusForJob(status), job.trailer_id]);
    }

    await logActivity(req, {
      module: "jobs",
      action: "status_update",
      entityType: "job",
      entityId: id,
      reason: status === "blocked" ? reason : undefined,
      details: { status }
    });

    emitJobUpdate({ jobId: Number(id), source: "admin-status", status });

    res.json({ message: "Job status updated.", status });
  } catch (err) {
    res.status(500).json({ message: "Status update error", error: err.message });
  }
};

// DELETE /api/jobs/:id  (cancel — sets blocked + reason)
exports.cancelJob = async (req, res) => {
  try {
    await ensureDriverOpsSchema();
    await ensureSoftDeleteSchema();

    const { id } = req.params;
    const reasonCheck = requireDeleteReason(req);
    if (!reasonCheck.ok) return res.status(400).json({ message: reasonCheck.message });

    const [[job]] = await db.query(`SELECT id, trip_code, vehicle_id, trailer_id FROM trips WHERE id = ? AND deleted_at IS NULL`, [id]);
    if (!job) return res.status(404).json({ message: "Job not found." });

    await db.query(
      `UPDATE trips SET dispatch_status='blocked', cancellation_reason=? WHERE id=? AND deleted_at IS NULL`,
      [reasonCheck.reason, id]
    );
    if (job.vehicle_id) {
      await db.query(`UPDATE vehicles SET status='available' WHERE id=?`, [job.vehicle_id]);
    }
    if (job.trailer_id) {
      await db.query(`UPDATE trailers SET status='available' WHERE id=?`, [job.trailer_id]);
    }

    await logActivity(req, {
      module: "jobs",
      action: "delete",
      entityType: "job",
      entityId: id,
      entityLabel: job.trip_code,
      reason: reasonCheck.reason,
      reasonCategory: reasonCheck.reasonCategory,
      details: { vehicle_id: job.vehicle_id, trailer_id: job.trailer_id }
    });

    emitJobUpdate({ jobId: Number(id), source: "admin-cancel", status: "blocked" });

    res.json({ message: "Job cancelled." });
  } catch (err) {
    res.status(500).json({ message: "Cancel error", error: err.message });
  }
};

// POST /api/jobs/:id/stops  — append a stop, recalc ETA, notify driver
exports.addJobStop = async (req, res) => {
  try {
    await ensureDriverOpsSchema();
    const { id } = req.params;
    const { address, stop_type, contact_name, contact_phone, planned_arrival, planned_departure, notes } = req.body;

    if (!address?.trim()) return res.status(400).json({ message: "Stop address is required." });
    if (planned_arrival && !isDateTimeKey(planned_arrival)) return res.status(400).json({ message: "Stop arrival must contain a valid UK date and time." });
    if (planned_departure && !isDateTimeKey(planned_departure)) return res.status(400).json({ message: "Stop departure must contain a valid UK date and time." });
    if (planned_arrival && planned_departure && wallMinutesBetween(planned_arrival, planned_departure) < 0) {
      return res.status(400).json({ message: "Stop departure cannot be before its arrival." });
    }

    const [[job]] = await db.query(
      `SELECT t.id, t.trip_code, t.driver_id, t.route_id, t.planned_departure, t.loading_done_time,
              t.estimated_eta_mins,
              d.full_name as driver_name, r.standard_eta_hours
       FROM trips t
       LEFT JOIN drivers d ON d.id = t.driver_id
       LEFT JOIN routes r ON r.id = t.route_id
       WHERE t.id = ? AND t.deleted_at IS NULL`,
      [id]
    );
    if (!job) return res.status(404).json({ message: "Job not found." });

    const [[{ maxOrder }]] = await db.query(
      `SELECT COALESCE(MAX(stop_order), 0) as maxOrder FROM job_stops WHERE trip_id = ?`,
      [id]
    );

    await db.query(
      `INSERT INTO job_stops (trip_id, stop_order, stop_type, address, contact_name, contact_phone, planned_arrival, planned_departure, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, maxOrder + 1, stop_type || "delivery", address.trim(), contact_name || null, contact_phone || null, planned_arrival || null, planned_departure || null, notes || null]
    );

    // Route changed: invalidate stale costing inputs; preserve the driver's ETA.
    await db.query('UPDATE trips SET route_id=NULL, estimated_distance_km=NULL, estimated_eta_mins=NULL, total_job_duration_mins=NULL WHERE id=?', [id]);

    // Notify driver via chat + socket
    if (job.driver_id) {
      const typeLabel = { pickup: "a pickup", delivery: "a delivery", waypoint: "a waypoint" }[stop_type] || "a";
      const body = `Route update for ${job.trip_code}: ${typeLabel} stop has been added at "${address.trim()}". Please check your updated route.`;
      const [msgResult] = await db.query(
        `INSERT INTO driver_messages (driver_id, sender_role, sender_name, body, trip_id) VALUES (?, 'dispatch', 'Dispatch', ?, ?)`,
        [job.driver_id, body, id]
      );
      const [[createdMsg]] = await db.query(`SELECT * FROM driver_messages WHERE id = ?`, [msgResult.insertId]);
      emitDriverChatMessage({
        id: createdMsg.id,
        driverId: Number(job.driver_id),
        driverName: job.driver_name || "Driver",
        senderRole: "dispatch",
        senderName: "Dispatch",
        body: createdMsg.body,
        tripId: Number(id),
        isRead: false,
        at: fmtDateTime(createdMsg.sent_at),
        sentAt: createdMsg.sent_at ? new Date(createdMsg.sent_at).toISOString() : null
      });
    }

    emitJobUpdate({ jobId: Number(id), source: "admin-add-stop" });
    res.status(201).json({ message: "Stop added." });
  } catch (err) {
    res.status(500).json({ message: "Add stop error", error: err.message });
  }
};

// DELETE /api/jobs/:id/stops/:stopId  — remove stop, reorder, recalc ETA, notify driver
exports.deleteJobStop = async (req, res) => {
  try {
    await ensureDriverOpsSchema();
    const { id, stopId } = req.params;

    const [[stop]] = await db.query(`SELECT * FROM job_stops WHERE id = ? AND trip_id = ?`, [stopId, id]);
    if (!stop) return res.status(404).json({ message: "Stop not found." });
    if (stop.status !== 'pending' || stop.actual_arrival || stop.actual_departure) return res.status(409).json({ message: 'A progressed stop cannot be deleted.' });

    const [[job]] = await db.query(
      `SELECT t.id, t.trip_code, t.driver_id, t.route_id, t.planned_departure, t.loading_done_time,
              t.estimated_eta_mins,
              d.full_name as driver_name, r.standard_eta_hours
       FROM trips t
       LEFT JOIN drivers d ON d.id = t.driver_id
       LEFT JOIN routes r ON r.id = t.route_id
       WHERE t.id = ? AND t.deleted_at IS NULL`,
      [id]
    );
    if (!job) return res.status(404).json({ message: "Job not found." });

    await db.query(`DELETE FROM job_stops WHERE id = ?`, [stopId]);

    // Reorder remaining stops
    const [remaining] = await db.query(
      `SELECT id FROM job_stops WHERE trip_id = ? ORDER BY stop_order ASC`, [id]
    );
    for (let i = 0; i < remaining.length; i++) {
      await db.query(`UPDATE job_stops SET stop_order = ? WHERE id = ?`, [i + 1, remaining[i].id]);
    }

    // Route changed: invalidate stale costing inputs; preserve the driver's ETA.
    await db.query('UPDATE trips SET route_id=NULL, estimated_distance_km=NULL, estimated_eta_mins=NULL, total_job_duration_mins=NULL WHERE id=?', [id]);

    // Notify driver
    if (job.driver_id) {
      const body = `Route update for ${job.trip_code}: a stop at "${stop.address}" has been removed. Please check your updated route.`;
      const [msgResult] = await db.query(
        `INSERT INTO driver_messages (driver_id, sender_role, sender_name, body, trip_id) VALUES (?, 'dispatch', 'Dispatch', ?, ?)`,
        [job.driver_id, body, id]
      );
      const [[createdMsg]] = await db.query(`SELECT * FROM driver_messages WHERE id = ?`, [msgResult.insertId]);
      emitDriverChatMessage({
        id: createdMsg.id,
        driverId: Number(job.driver_id),
        driverName: job.driver_name || "Driver",
        senderRole: "dispatch",
        senderName: "Dispatch",
        body: createdMsg.body,
        tripId: Number(id),
        isRead: false,
        at: fmtDateTime(createdMsg.sent_at),
        sentAt: createdMsg.sent_at ? new Date(createdMsg.sent_at).toISOString() : null
      });
    }

    emitJobUpdate({ jobId: Number(id), source: "admin-remove-stop" });
    res.json({ message: "Stop removed." });
  } catch (err) {
    res.status(500).json({ message: "Remove stop error", error: err.message });
  }
};

exports.getJobNotes = async (req, res) => {
  try {
    await ensureJobNotesSchema();
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ message: "Valid job id required." });
    const [notes] = await db.query(
      `SELECT id, note_text, author_name, created_at FROM job_notes WHERE job_id=? ORDER BY created_at ASC`,
      [id]
    );
    res.json({ notes: notes.map(note => ({
      ...note,
      createdAtRaw: rawDateTime(note.created_at),
      createdAtLabel: fmtDateTime(note.created_at)
    })) });
  } catch (err) {
    res.status(500).json({ message: "Could not load job notes.", error: err.message });
  }
};

exports.addJobNote = async (req, res) => {
  try {
    await ensureJobNotesSchema();
    const id = Number(req.params.id);
    const noteText = String(req.body.note_text || "").trim();
    const authorName = String(req.body.author_name || "Admin").trim();
    if (!id || !noteText) return res.status(400).json({ message: "Job id and note text are required." });
    const [[job]] = await db.query(`SELECT id FROM trips WHERE id=? AND deleted_at IS NULL`, [id]);
    if (!job) return res.status(404).json({ message: "Job not found." });
    const [result] = await db.query(
      `INSERT INTO job_notes (job_id, note_text, author_name, created_at) VALUES (?, ?, ?, ?)`,
      [id, noteText, authorName, ukNowDateTimeKey()]
    );
    res.status(201).json({ message: "Note added.", id: result.insertId });
  } catch (err) {
    res.status(500).json({ message: "Could not add job note.", error: err.message });
  }
};

// PATCH /api/jobs/:id/replace-vehicle
// Swaps the assigned vehicle on an active job (e.g. after a breakdown), sends the old
// vehicle to maintenance with a defect + repair job, and logs the reason on the job.
exports.replaceJobVehicle = async (req, res) => {
  const conn = await db.getConnection();
  try {
    await ensureDriverOpsSchema();
    await ensureSoftDeleteSchema();
    await ensureJobNotesSchema();
    await new Promise((resolve, reject) => {
      maintenanceController.ensureMaintenanceSchema({}, { status: () => ({ json: (body) => reject(new Error(body?.message || "Maintenance schema sync error")) }) }, resolve);
    });

    const { id } = req.params;
    const newVehicleId = req.body.vehicle_id || req.body.vehicleId || null;
    const reason = String(req.body.reason || "").trim();

    await conn.beginTransaction();

    const [[job]] = await conn.query(
      `SELECT id, trip_code, vehicle_id, driver_id, dispatch_status FROM trips WHERE id = ? AND deleted_at IS NULL`,
      [id]
    );
    if (!job) {
      await conn.rollback();
      return res.status(404).json({ message: "Job not found." });
    }
    if (!job.vehicle_id) {
      await conn.rollback();
      return res.status(400).json({ message: "This job has no vehicle assigned to replace." });
    }
    if (!job.driver_id) {
      await conn.rollback();
      return res.status(400).json({ message: "This job has no driver assigned — assign a driver before reporting a breakdown." });
    }
    if (["completed", "cancelled"].includes(job.dispatch_status)) {
      await conn.rollback();
      return res.status(400).json({ message: "Vehicle cannot be replaced on a completed or cancelled job." });
    }
    if (!newVehicleId || String(newVehicleId) === String(job.vehicle_id)) {
      await conn.rollback();
      return res.status(400).json({ message: "Select a different vehicle to replace it with." });
    }
    if (!reason) {
      await conn.rollback();
      return res.status(400).json({ message: "Enter a reason for replacing the vehicle." });
    }

    const [[newVehicle]] = await conn.query(
      `SELECT id, registration_number FROM vehicles WHERE id = ? AND status = 'available'`,
      [newVehicleId]
    );
    if (!newVehicle) {
      await conn.rollback();
      return res.status(400).json({ message: "Selected truck is not available for assignment." });
    }
    const [[busyVehicle]] = await conn.query(
      `SELECT trip_code FROM trips WHERE vehicle_id = ? AND id != ? AND deleted_at IS NULL AND dispatch_status IN ('planned','loading','active')`,
      [newVehicleId, id]
    );
    if (busyVehicle) {
      await conn.rollback();
      return res.status(400).json({ message: `Truck is already assigned to job ${busyVehicle.trip_code} and won't be free until that job is finished.` });
    }

    const [[oldVehicle]] = await conn.query(`SELECT registration_number FROM vehicles WHERE id = ?`, [job.vehicle_id]);

    await conn.query(`UPDATE trips SET vehicle_id = ? WHERE id = ? AND deleted_at IS NULL`, [newVehicleId, id]);
    await conn.query(`UPDATE vehicles SET status = 'planned' WHERE id = ?`, [newVehicleId]);
    await conn.query(`UPDATE vehicles SET status = 'maintenance' WHERE id = ?`, [job.vehicle_id]);

    const reportedBy = req.sessionUser?.name || "Dispatch";
    const [defectResult] = await conn.query(
      `INSERT INTO defect_reports (vehicle_id, driver_id, trip_id, asset_type, defect_type, description, severity, reported_by, status, workflow_status)
       VALUES (?, ?, ?, 'vehicle', 'Breakdown', ?, 'high', ?, 'open', 'booked')`,
      [job.vehicle_id, job.driver_id, id, reason, reportedBy]
    );

    const year = new Date().getFullYear();
    const [[jobNumRow]] = await conn.query(
      `SELECT COALESCE(MAX(CAST(SUBSTRING_INDEX(job_number, '-', -1) AS UNSIGNED)), 0) AS maxNum
       FROM maintenance_jobs WHERE job_number LIKE ?`,
      [`MJ-${year}-%`]
    );
    const maintenanceJobNumber = `MJ-${year}-${String(Number(jobNumRow.maxNum || 0) + 1).padStart(4, "0")}`;
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 3);

    await conn.query(
      `INSERT INTO maintenance_jobs (job_number, asset_type, vehicle_id, defect_id, service_type, due_date, priority, status, notes)
       VALUES (?, 'vehicle', ?, ?, 'Breakdown', ?, 'high', 'booked', ?)`,
      [maintenanceJobNumber, job.vehicle_id, defectResult.insertId, dueDate.toISOString().slice(0, 10), reason]
    );

    const noteText = `Vehicle replaced: ${oldVehicle?.registration_number || "previous truck"} -> ${newVehicle.registration_number}. Reason: ${reason}. ${oldVehicle?.registration_number || "Previous truck"} sent to maintenance (Job ${maintenanceJobNumber}).`;
    await conn.query(
      `INSERT INTO job_notes (job_id, note_text, author_name) VALUES (?, ?, ?)`,
      [id, noteText, "Dispatch"]
    );

    await conn.commit();

    emitJobUpdate({ jobId: Number(id), source: "vehicle-replacement" });

    res.json({ message: "Vehicle replaced. Old truck sent to maintenance.", maintenanceJobNumber });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ message: "Could not replace vehicle.", error: err.message });
  } finally {
    conn.release();
  }
};

// Pure rules exposed for regression tests; no route uses this property.
exports.__test = { calcJobEconomics, validateJobTiming };
