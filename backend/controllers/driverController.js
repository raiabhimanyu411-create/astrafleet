const db = require("../db/connection");
const { verifySessionToken } = require("./authController");
const { emitDriverChatMessage, emitDriverLocationUpdate, emitJobUpdate } = require("../realtime");
const { buildChangeSet, logActivity } = require("../utils/auditLogger");

function fmtDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}
function rawDate(d) {
  if (!d) return "";
  const date = new Date(d);
  const offsetMs = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 10);
}
function fmtDateTime(d) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
function isoDateTime(d) {
  return d ? new Date(d).toISOString() : null;
}
function fmtAmount(n) {
  if (n == null) return "—";
  return `£${Number(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const diff = new Date(dateStr) - new Date();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function expiryTone(dateStr) {
  const days = daysUntil(dateStr);
  if (days === null) return "neutral";
  if (days < 0)   return "danger";
  if (days < 30)  return "danger";
  if (days < 90)  return "warning";
  return "success";
}

async function nextDriverCode(conn) {
  const [[row]] = await conn.query(`SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM drivers`);
  return `DRV-${String(row.next_id).padStart(3, "0")}`;
}

const driverStatusFlow = [
  "offered",
  "accepted",
  "arrived_pickup",
  "loaded",
  "in_transit",
  "arrived_drop",
  "delivered",
  "failed_delivery",
  "declined"
];

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

const tripColumnDefinitions = {
  driver_job_status: "VARCHAR(40) DEFAULT 'accepted'",
  delivery_notes: "TEXT DEFAULT NULL",
  pod_signature_data: "LONGTEXT DEFAULT NULL",
  pod_photo_data: "LONGTEXT DEFAULT NULL",
  failed_delivery_reason: "TEXT DEFAULT NULL",
  trailer_id: "INT DEFAULT NULL",
  customer_id: "INT DEFAULT NULL",
  pickup_address: "TEXT DEFAULT NULL",
  drop_address: "TEXT DEFAULT NULL",
  load_type: "VARCHAR(80) DEFAULT 'general'",
  load_weight_kg: "DECIMAL(10,2) DEFAULT NULL",
  load_description: "TEXT DEFAULT NULL",
  special_instructions: "TEXT DEFAULT NULL",
  actual_departure: "DATETIME DEFAULT NULL",
  actual_arrival: "DATETIME DEFAULT NULL",
  eta_updated_at: "DATETIME DEFAULT NULL",
  primary_drop_status: "VARCHAR(40) DEFAULT 'pending'",
  primary_drop_arrived_at: "DATETIME DEFAULT NULL",
  primary_drop_completed_at: "DATETIME DEFAULT NULL"
};

const statusTransitions = {
  offered: new Set(["accepted", "declined"]),
  accepted: new Set(["arrived_pickup", "failed_delivery", "declined"]),
  arrived_pickup: new Set(["loaded", "failed_delivery"]),
  loaded: new Set(["in_transit", "failed_delivery"]),
  in_transit: new Set(["arrived_drop", "failed_delivery"]),
  arrived_drop: new Set(["failed_delivery"]),
  delivered: new Set([]),
  failed_delivery: new Set([]),
  declined: new Set([])
};

let driverOpsSchemaReady = false;

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
  await addColumnIfMissing("drivers", "assigned_vehicle_id", "INT DEFAULT NULL");
  await addColumnIfMissing("drivers", "address", "TEXT DEFAULT NULL");
  await addColumnIfMissing("drivers", "postcode", "VARCHAR(20) DEFAULT NULL");
  await addColumnIfMissing("drivers", "date_of_birth", "DATE DEFAULT NULL");
  await addColumnIfMissing("drivers", "national_insurance", "VARCHAR(40) DEFAULT NULL");
  await addColumnIfMissing("drivers", "cpc_number", "VARCHAR(80) DEFAULT NULL");
  await addColumnIfMissing("drivers", "cpc_expiry", "DATE DEFAULT NULL");
  await addColumnIfMissing("drivers", "tacho_card_number", "VARCHAR(80) DEFAULT NULL");
  await addColumnIfMissing("drivers", "tacho_card_expiry", "DATE DEFAULT NULL");
  await addColumnIfMissing("drivers", "emergency_contact_name", "VARCHAR(120) DEFAULT NULL");
  await addColumnIfMissing("drivers", "emergency_contact_phone", "VARCHAR(30) DEFAULT NULL");
  await addColumnIfMissing("drivers", "bank_sort_code", "VARCHAR(20) DEFAULT NULL");
  await addColumnIfMissing("drivers", "bank_account_number", "VARCHAR(30) DEFAULT NULL");
  await addColumnIfMissing("drivers", "salary_gbp", "DECIMAL(10,2) DEFAULT NULL");
  await addColumnIfMissing("drivers", "commission_rate", "DECIMAL(5,2) DEFAULT NULL");
  await addColumnIfMissing("drivers", "internal_score", "INT DEFAULT NULL");
  await addColumnIfMissing("drivers", "accident_incident_record", "TEXT DEFAULT NULL");
  await addColumnIfMissing("drivers", "penalty_deduction_record", "TEXT DEFAULT NULL");

  for (const [column, definition] of Object.entries(tripColumnDefinitions)) {
    await addColumnIfMissing("trips", column, definition);
  }
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
    `CREATE TABLE IF NOT EXISTS driver_shifts (
      id INT AUTO_INCREMENT PRIMARY KEY,
      driver_id INT NOT NULL,
      shift_start DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      shift_end DATETIME DEFAULT NULL,
      total_hours DECIMAL(6,2) DEFAULT NULL,
      status ENUM('active','completed') NOT NULL DEFAULT 'active',
      start_note VARCHAR(255) DEFAULT NULL,
      end_note VARCHAR(255) DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_driver_shifts_driver FOREIGN KEY (driver_id) REFERENCES drivers (id) ON DELETE CASCADE
    ) ENGINE=InnoDB`
  );
  await addColumnIfMissing("driver_shifts", "start_note", "VARCHAR(255) DEFAULT NULL");
  await addColumnIfMissing("driver_shifts", "end_note", "VARCHAR(255) DEFAULT NULL");

  await db.query(
    `CREATE TABLE IF NOT EXISTS driver_expenses (
      id INT AUTO_INCREMENT PRIMARY KEY,
      driver_id INT NOT NULL,
      trip_id INT DEFAULT NULL,
      expense_type ENUM('fuel','toll','parking','repair','meal','other') NOT NULL DEFAULT 'fuel',
      amount_gbp DECIMAL(10,2) NOT NULL DEFAULT 0,
      notes VARCHAR(255) DEFAULT NULL,
      receipt_data LONGTEXT DEFAULT NULL,
      expense_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_driver_expenses_driver FOREIGN KEY (driver_id) REFERENCES drivers (id) ON DELETE CASCADE,
      CONSTRAINT fk_driver_expenses_trip FOREIGN KEY (trip_id) REFERENCES trips (id) ON DELETE SET NULL
    ) ENGINE=InnoDB`
  );

  await db.query(
    `CREATE TABLE IF NOT EXISTS defect_reports (
      id INT AUTO_INCREMENT PRIMARY KEY,
      vehicle_id INT NOT NULL,
      defect_type VARCHAR(80) NOT NULL DEFAULT 'Driver report',
      description TEXT DEFAULT NULL,
      severity ENUM('low','medium','high','critical') NOT NULL DEFAULT 'medium',
      reported_by VARCHAR(120) DEFAULT NULL,
      status VARCHAR(40) NOT NULL DEFAULT 'open',
      reported_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      resolved_at DATETIME DEFAULT NULL
    ) ENGINE=InnoDB`
  );
  await addColumnIfMissing("defect_reports", "defect_type", "VARCHAR(80) NOT NULL DEFAULT 'Driver report'");
  await addColumnIfMissing("defect_reports", "reported_by", "VARCHAR(120) DEFAULT NULL");
  await addColumnIfMissing("defect_reports", "driver_id", "INT DEFAULT NULL");
  await addColumnIfMissing("defect_reports", "trip_id", "INT DEFAULT NULL");

  await addColumnIfMissing("driver_expenses", "expense_type", "VARCHAR(40) NOT NULL DEFAULT 'fuel'");
  await addColumnIfMissing("driver_expenses", "amount_gbp", "DECIMAL(10,2) NOT NULL DEFAULT 0");
  await addColumnIfMissing("driver_expenses", "notes", "VARCHAR(255) DEFAULT NULL");
  await addColumnIfMissing("driver_expenses", "receipt_data", "LONGTEXT DEFAULT NULL");
  await addColumnIfMissing("driver_expenses", "expense_at", "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP");

  await db.query(
    `CREATE TABLE IF NOT EXISTS driver_walkarounds (
      id INT AUTO_INCREMENT PRIMARY KEY,
      driver_id INT NOT NULL,
      trip_id INT DEFAULT NULL,
      checks JSON NOT NULL,
      all_clear TINYINT(1) NOT NULL DEFAULT 0,
      issues TEXT DEFAULT NULL,
      checked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_walkaround_driver FOREIGN KEY (driver_id) REFERENCES drivers (id) ON DELETE CASCADE
    ) ENGINE=InnoDB`
  );

  await db.query(
    `CREATE TABLE IF NOT EXISTS driver_odometer_logs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      driver_id INT NOT NULL,
      trip_id INT DEFAULT NULL,
      vehicle_id INT DEFAULT NULL,
      reading_km DECIMAL(10,1) NOT NULL,
      log_type ENUM('start','end') NOT NULL DEFAULT 'start',
      logged_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_odometer_driver FOREIGN KEY (driver_id) REFERENCES drivers (id) ON DELETE CASCADE
    ) ENGINE=InnoDB`
  );

  await db.query(
    `CREATE TABLE IF NOT EXISTS driver_messages (
      id INT AUTO_INCREMENT PRIMARY KEY,
      driver_id INT NOT NULL,
      sender_role ENUM('driver','admin','dispatch') NOT NULL DEFAULT 'driver',
      sender_name VARCHAR(120) DEFAULT NULL,
      body TEXT NOT NULL,
      trip_id INT DEFAULT NULL,
      is_read TINYINT(1) NOT NULL DEFAULT 0,
      sent_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_msg_driver FOREIGN KEY (driver_id) REFERENCES drivers (id) ON DELETE CASCADE
    ) ENGINE=InnoDB`
  );

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
      planned_departure DATETIME DEFAULT NULL,
      actual_arrival DATETIME DEFAULT NULL,
      actual_departure DATETIME DEFAULT NULL,
      status ENUM('pending','arrived','completed','skipped') NOT NULL DEFAULT 'pending',
      notes TEXT DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_job_stops_trip (trip_id),
      CONSTRAINT fk_driver_job_stops_trip FOREIGN KEY (trip_id) REFERENCES trips (id) ON DELETE CASCADE
    ) ENGINE=InnoDB`
  );
  await addColumnIfMissing("job_stops", "planned_departure", "DATETIME DEFAULT NULL");
  await addColumnIfMissing("job_stops", "actual_departure", "DATETIME DEFAULT NULL");

  driverOpsSchemaReady = true;
}

async function createControlRoomAlert({ title, description, severity = "medium", driverId = null, tripId = null, vehicleId = null }) {
  const code = `DRV-${Date.now().toString().slice(-8)}-${Math.floor(Math.random() * 90 + 10)}`;
  await db.query(
    `INSERT INTO control_room_alerts
       (alert_code, module_name, severity, title, description, trip_id, driver_id, vehicle_id, alert_status, owner_name)
     VALUES (?, 'alerts', ?, ?, ?, ?, ?, ?, 'open', 'Control room')`,
    [
      code,
      severity,
      title.slice(0, 160),
      description.slice(0, 255),
      tripId,
      driverId,
      vehicleId
    ]
  );
}

function getSessionUserId(req) {
  const token = req.headers["x-session-token"];
  const userId = req.headers["x-session-user-id"] || req.query.userId || req.body?.userId;
  const role = req.headers["x-session-role"];
  const verified = verifySessionToken(token);
  if (verified?.id && verified.role === "driver") return verified.id;
  if (process.env.ALLOW_LEGACY_DRIVER_USER_ID === "true" && role === "driver") return userId;
  return null;
}

async function hasActiveShift(driverId) {
  const [[active]] = await db.query(
    `SELECT id FROM driver_shifts WHERE driver_id=? AND status='active' LIMIT 1`,
    [driverId]
  );
  return Boolean(active);
}

async function hasClearWalkaround(driverId, tripId) {
  const [[walkaround]] = await db.query(
    `SELECT id FROM driver_walkarounds
     WHERE driver_id=? AND all_clear=1 AND (trip_id=? OR trip_id IS NULL)
     ORDER BY checked_at DESC LIMIT 1`,
    [driverId, tripId || null]
  );
  return Boolean(walkaround);
}

async function getDriverFromSession(req) {
  const userId = getSessionUserId(req);
  if (!userId) return null;

  const [[driver]] = await db.query(
    `SELECT d.*, u.name as user_name, u.email
     FROM drivers d
     LEFT JOIN users u ON d.user_id = u.id
     WHERE d.user_id = ?`,
    [userId]
  );
  return driver || null;
}

function mapDriverJob(row, stops = []) {
  const status = row.driver_job_status || "accepted";
  const primaryDropStatus = row.primary_drop_status || (status === "delivered" ? "completed" : "pending");
  const pickup = row.pickup_address || row.origin_hub || "Pickup TBD";
  const drop = row.drop_address || row.destination_hub || "Drop TBD";
  const navStops = [pickup, drop, ...stops.map(stop => stop.address).filter(Boolean)];
  const navQuery = encodeURIComponent(navStops.filter(Boolean).join(" to "));
  const customerName = row.customer_name || row.client_name || "Customer TBD";
  const customerPhone = row.cust_phone || row.client_phone || "—";
  const pickupPostcode = extractPostcode(pickup);
  const lastStopId = stops.length ? stops[stops.length - 1].id : null;
  const jobIsPastPickup = ["loaded", "in_transit", "arrived_drop", "delivered"].includes(status);
  const jobIsAtDrop = ["arrived_drop", "delivered"].includes(status);
  const primaryDropDone = primaryDropStatus === "completed" || status === "delivered";
  const nextDeliveryStopIndex = stops.findIndex(stop => !isReturnStop(stop, pickupPostcode, lastStopId) && !["completed", "skipped"].includes(stop.status));
  const displayStatusLabel = status === "arrived_drop" && primaryDropDone && nextDeliveryStopIndex >= 0
    ? `Going to Drop ${nextDeliveryStopIndex + 2}`
    : driverStatusLabel[status] || status;
  const routePoints = [
    {
      id: "pickup",
      type: "pickup",
      label: "Pickup",
      address: pickup,
      arrival: fmtDateTime(row.planned_departure),
      departure: fmtDateTime(row.loading_done_time || row.planned_departure),
      status: jobIsPastPickup ? "completed" : ["arrived_pickup", "loaded"].includes(status) ? "arrived" : "pending",
      statusLabel: jobIsPastPickup ? "Completed" : ["arrived_pickup", "loaded"].includes(status) ? "At pickup" : "Pending",
      contactName: row.cust_contact || "—",
      contactPhone: customerPhone,
      notes: row.special_instructions || "—"
    },
    {
      id: "drop-1",
      type: "drop",
      label: "Drop 1",
      address: drop,
      arrival: fmtDateTime(row.primary_drop_arrived_at || row.calculated_arrival || row.eta),
      departure: primaryDropDone ? fmtDateTime(row.primary_drop_completed_at || row.calculated_unload_end) : fmtDateTime(row.calculated_unload_end),
      status: primaryDropDone ? "completed" : jobIsAtDrop ? "arrived" : "pending",
      statusLabel: primaryDropDone ? "Completed" : jobIsAtDrop ? "At drop" : "Pending",
      isPrimaryDrop: true,
      contactName: row.cust_contact || "—",
      contactPhone: customerPhone,
      notes: row.dispatcher_notes || row.special_instructions || "—"
    },
    ...stops.map((stop, index) => ({
      id: stop.id,
      stopId: stop.id,
      type: isReturnStop(stop, pickupPostcode, lastStopId) ? "return" : "drop",
      label: isReturnStop(stop, pickupPostcode, lastStopId) ? "Return point" : `Drop ${index + 2}`,
      address: stop.address || "—",
      arrival: fmtDateTime(stop.actual_arrival || stop.planned_arrival),
      departure: fmtDateTime(stop.actual_departure || stop.planned_departure),
      status: stop.status || "pending",
      statusLabel: stopStatusLabel[stop.status] || "Pending",
      isReturnPoint: isReturnStop(stop, pickupPostcode, lastStopId),
      contactName: stop.contact_name || "—",
      contactPhone: stop.contact_phone || "—",
      notes: stop.notes || "—"
    }))
  ];

  return {
    id: row.id,
    code: row.trip_code,
    reference: row.reference || "—",
    loadId: row.load_id || "—",
    status,
    statusLabel: displayStatusLabel,
    statusTone: driverStatusTone[status] || "neutral",
    dispatchStatus: row.dispatch_status,
    priority: row.priority_level,
    customer: {
      name: customerName,
      contact: row.cust_contact || "—",
      phone: customerPhone,
      email: row.cust_email || "—"
    },
    route: {
      from: row.origin_hub || pickup,
      to: row.destination_hub || drop,
      pickupAddress: pickup,
      dropAddress: drop,
      navigationUrl: `https://www.google.com/maps/dir/?api=1&travelmode=driving&query=${navQuery}`
    },
    schedule: {
      plannedDate: row.planned_departure ? new Date(row.planned_departure).toISOString().slice(0, 10) : null,
      plannedDeparture: fmtDateTime(row.planned_departure),
      eta: fmtDateTime(row.eta),
      dockWindow: row.dock_window || "—",
      actualDeparture: fmtDateTime(row.actual_departure),
      actualArrival: fmtDateTime(row.actual_arrival)
    },
    vehicle: row.registration_number ? `${row.registration_number} · ${row.model_name || row.truck_type || "Vehicle"}` : "Unassigned",
    trailer: row.trailer_code ? `${row.trailer_code} · ${row.trailer_type || "Trailer"}` : "No trailer assigned",
    load: {
      type: row.load_type || "general",
      weight: row.load_weight_kg ? `${row.load_weight_kg} kg` : "—",
      description: row.load_description || "—"
    },
    podStatus: row.pod_status,
    deliveryNotes: row.delivery_notes || "",
    routePoints,
    stops: stops.map((stop, index) => ({
      id: stop.id,
      order: stop.stop_order || index + 1,
      type: stop.stop_type || "stop",
      label: `${(stop.stop_type || "Stop").replace("_", " ")} ${stop.stop_order || index + 1}`,
      address: stop.address || "—",
      contactName: stop.contact_name || "—",
      contactPhone: stop.contact_phone || "—",
      plannedArrival: fmtDateTime(stop.planned_arrival),
      plannedDeparture: fmtDateTime(stop.planned_departure),
      actualArrival: fmtDateTime(stop.actual_arrival),
      actualDeparture: fmtDateTime(stop.actual_departure),
      notes: stop.notes || "—",
      status: stop.status || "pending",
      statusLabel: stopStatusLabel[stop.status] || "Pending",
      isReturnPoint: isReturnStop(stop, pickupPostcode, lastStopId)
    }))
  };
}

const stopStatusLabel = {
  pending: "Pending",
  arrived: "Arrived",
  completed: "Completed",
  skipped: "Skipped"
};

function extractPostcode(value) {
  const text = String(value || "").toUpperCase().replace(/\s+/g, " ");
  const match = text.match(/\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/);
  return match ? match[1].replace(/\s+/g, "") : "";
}

function isReturnStop(stop, pickupPostcode, lastStopId) {
  if (!stop || !pickupPostcode || stop.id !== lastStopId) return false;
  return extractPostcode(stop.address) === pickupPostcode;
}

function combineEtaDateAndTime(value, job) {
  const raw = String(value || "").trim();
  const timeOnlyMatch = raw.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!timeOnlyMatch) return new Date(raw);

  const base = new Date(job.eta || job.planned_departure || Date.now());
  if (Number.isNaN(base.getTime())) return new Date(raw);
  base.setHours(Number(timeOnlyMatch[1]), Number(timeOnlyMatch[2]), 0, 0);
  return base;
}

async function getDriverJobs(driverId) {
  const [rows] = await db.query(
    `SELECT t.*,
            c.company_name as customer_name, c.contact_name as cust_contact, c.phone as cust_phone, c.email as cust_email,
            r.origin_hub, r.destination_hub,
            v.registration_number, v.model_name, v.truck_type,
            tr.trailer_code, tr.registration_number AS trailer_registration, tr.trailer_type
     FROM trips t
     LEFT JOIN customers c ON t.customer_id = c.id
     LEFT JOIN routes r ON t.route_id = r.id
     LEFT JOIN vehicles v ON t.vehicle_id = v.id
     LEFT JOIN trailers tr ON t.trailer_id = tr.id
     WHERE t.driver_id = ?
     ORDER BY COALESCE(t.planned_departure, t.created_at) ASC`,
    [driverId]
  );
  if (!rows.length) return [];

  const tripIds = rows.map((row) => row.id);
  const [stops] = await db.query(
    `SELECT * FROM job_stops WHERE trip_id IN (?) ORDER BY trip_id ASC, stop_order ASC`,
    [tripIds]
  );
  const stopsByTrip = new Map();
  for (const stop of stops) {
    const list = stopsByTrip.get(stop.trip_id) || [];
    list.push(stop);
    stopsByTrip.set(stop.trip_id, list);
  }

  return rows.map((row) => mapDriverJob(row, stopsByTrip.get(row.id) || []));
}

// GET /api/drivers/me/panel?userId=:userId
exports.getMyDriverPanel = async (req, res) => {
  try {
    await ensureDriverOpsSchema();

    const driver = await getDriverFromSession(req);
    if (!driver) {
      return res.status(404).json({ message: "Driver profile not linked to this login." });
    }

    const jobs = await getDriverJobs(driver.id);
    const todayKey = new Date().toISOString().slice(0, 10);
    const todayJobs = jobs.filter((job) => job.schedule.plannedDate === todayKey);
    const upcomingJobs = jobs.filter((job) => {
      if (!job.schedule.plannedDate) return false;
      return job.schedule.plannedDate > todayKey;
    });
    const activeJob = jobs.find((job) => !["delivered", "failed_delivery", "declined"].includes(job.status)) || jobs[0] || null;

    const [[activeShift]] = await db.query(
      `SELECT * FROM driver_shifts WHERE driver_id = ? AND status='active' ORDER BY shift_start DESC LIMIT 1`,
      [driver.id]
    );

    const [expenses] = await db.query(
      `SELECT e.*, t.trip_code
       FROM driver_expenses e
       LEFT JOIN trips t ON e.trip_id = t.id
       WHERE e.driver_id = ?
       ORDER BY e.expense_at DESC LIMIT 8`,
      [driver.id]
    );

    const [defectHistory] = await db.query(
      `SELECT dr.id, dr.defect_type, dr.severity, dr.status, dr.reported_at, v.registration_number
       FROM defect_reports dr
       LEFT JOIN vehicles v ON dr.vehicle_id = v.id
       WHERE dr.driver_id = ?
       ORDER BY dr.reported_at DESC LIMIT 5`,
      [driver.id]
    );

    const [shiftHistory] = await db.query(
      `SELECT id, shift_start, shift_end, total_hours, status
       FROM driver_shifts WHERE driver_id=? ORDER BY shift_start DESC LIMIT 6`,
      [driver.id]
    );

    const [[latestWalkaround]] = await db.query(
      `SELECT id, all_clear, issues, checked_at FROM driver_walkarounds WHERE driver_id=? ORDER BY checked_at DESC LIMIT 1`,
      [driver.id]
    );

    const docWarnings = [];
    function pushWarn(label, dateStr) {
      const days = daysUntil(dateStr);
      if (days !== null && days < 90) {
        docWarnings.push({ label, days, tone: days < 30 ? "danger" : "warning", expiry: fmtDate(dateStr) });
      }
    }
    pushWarn("Driving Licence", driver.license_expiry);
    pushWarn("Medical Certificate", driver.medical_expiry);
    pushWarn("CPC Card", driver.cpc_expiry);
    pushWarn("Tacho Card", driver.tacho_card_expiry);

    const [driverDocRows] = await db.query(
      `SELECT document_type, expiry_date FROM driver_documents WHERE driver_id=?`,
      [driver.id]
    );
    for (const doc of driverDocRows) pushWarn(doc.document_type, doc.expiry_date);

    const podHistory = jobs
      .filter(j => j.status === "delivered")
      .slice(0, 5)
      .map(j => ({ id: j.id, code: j.code, to: j.route.to, podStatus: j.podStatus, notes: j.deliveryNotes }));

    res.json({
      header: {
        badge: "Driver Panel",
        title: `Welcome, ${driver.full_name || driver.user_name || "Driver"}`,
        description: "Today duties, assigned jobs, route details, status updates, POD, shifts, expenses, and defect reports."
      },
      highlights: [
        "Drivers see only their assigned jobs and contact details.",
        "Job status updates sync back to dispatch and tracking.",
        "POD, shift, fuel expense, and defect reports are ready from the browser."
      ],
      stats: [
        { label: "Today's duties", value: todayJobs.length, description: "Jobs planned for the current date.", change: activeShift ? "Shift active" : "Shift not started", tone: activeShift ? "success" : "warning" },
        { label: "Upcoming jobs", value: upcomingJobs.length, description: "Future assigned work in the queue.", change: "Driver assignment view", tone: "neutral" },
        { label: "Active job", value: activeJob ? activeJob.code : "—", description: activeJob ? `${activeJob.route.from} to ${activeJob.route.to}` : "No active job assigned.", change: activeJob ? activeJob.statusLabel : "Waiting dispatch", tone: activeJob?.statusTone || "neutral" },
        { label: "Pending POD", value: jobs.filter(j => j.podStatus !== "verified" && j.status === "delivered").length, description: "Delivered jobs awaiting proof verification.", change: "Signature/photo supported", tone: "warning" }
      ],
      driver: {
        id: driver.id,
        name: driver.full_name,
        phone: driver.phone,
        email: driver.email,
        employeeCode: driver.employee_code,
        homeDepot: driver.home_depot,
        shiftStatus: driver.shift_status,
        complianceStatus: driver.compliance_status
      },
      shift: activeShift ? {
        id: activeShift.id,
        status: activeShift.status,
        startedAt: fmtDateTime(activeShift.shift_start)
      } : null,
      activeJob,
      jobs,
      todayJobs,
      upcomingJobs,
      statusFlow: driverStatusFlow.map((value) => ({ value, label: driverStatusLabel[value] })),
      expenses: expenses.map((e) => ({
        id: e.id,
        type: e.expense_type,
        amount: fmtAmount(e.amount_gbp),
        note: e.notes || "—",
        jobCode: e.trip_code || "No job linked",
        at: fmtDateTime(e.expense_at)
      })),
      docWarnings,
      defectHistory: defectHistory.map(d => ({
        id: d.id,
        type: d.defect_type,
        severity: d.severity,
        status: d.status,
        vehicle: d.registration_number || "—",
        at: fmtDateTime(d.reported_at)
      })),
      shiftHistory: shiftHistory.slice(1, 6).map(s => ({
        id: s.id,
        start: fmtDateTime(s.shift_start),
        end: fmtDateTime(s.shift_end),
        hours: s.total_hours ? `${parseFloat(s.total_hours).toFixed(1)}h` : "—",
        status: s.status
      })),
      latestWalkaround: latestWalkaround ? {
        allClear: Boolean(latestWalkaround.all_clear),
        issues: latestWalkaround.issues,
        at: fmtDateTime(latestWalkaround.checked_at)
      } : null,
      podHistory
    });
  } catch (err) {
    res.status(500).json({ message: "Driver panel error", error: err.message });
  }
};

// PATCH /api/drivers/me/jobs/:jobId/status
exports.updateMyJobStatus = async (req, res) => {
  try {
    await ensureDriverOpsSchema();
    const driver = await getDriverFromSession(req);
    if (!driver) return res.status(404).json({ message: "Driver profile not linked to this login." });

    const { jobId } = req.params;
    const { status, reason } = req.body;
    if (!driverStatusFlow.includes(status)) {
      return res.status(400).json({ message: "Invalid driver job status." });
    }

    const [[job]] = await db.query(
      `SELECT t.id, t.vehicle_id, t.driver_job_status, t.primary_drop_status, t.pickup_address, r.origin_hub
       FROM trips t
       LEFT JOIN routes r ON r.id = t.route_id
       WHERE t.id = ? AND t.driver_id = ?`,
      [jobId, driver.id]
    );
    if (!job) return res.status(404).json({ message: "Assigned job not found." });

    const currentStatus = job.driver_job_status || "accepted";
    if (status === "delivered") {
      return res.status(400).json({ message: "Submit POD with signature/photo to mark the job delivered." });
    }
    if (!statusTransitions[currentStatus]?.has(status) && status !== currentStatus) {
      return res.status(409).json({ message: `Cannot move job from ${driverStatusLabel[currentStatus] || currentStatus} to ${driverStatusLabel[status] || status}.` });
    }
    if (!["accepted", "declined", currentStatus].includes(status) && !(await hasActiveShift(driver.id))) {
      return res.status(400).json({ message: "Start your shift before updating job progress." });
    }
    const changedStatus = status !== currentStatus;
    const updates = ["driver_job_status=?"];
    const values = [status];
    let dispatchStatus = null;

    if (status === "offered") dispatchStatus = "planned";
    if (["accepted", "arrived_pickup"].includes(status)) dispatchStatus = "planned";
    if (status === "loaded") dispatchStatus = "loading";
    if (["in_transit", "arrived_drop"].includes(status)) dispatchStatus = "active";
    if (status === "delivered") dispatchStatus = "completed";
    if (status === "failed_delivery") dispatchStatus = "blocked";
    if (status === "declined") dispatchStatus = "blocked";

    if (dispatchStatus) {
      updates.push("dispatch_status=?");
      values.push(dispatchStatus);
    }
    if (status === "in_transit") {
      updates.push("actual_departure=COALESCE(actual_departure, ?)");
      values.push(new Date());
    }
    if (status === "arrived_drop") {
      updates.push("primary_drop_arrived_at=COALESCE(primary_drop_arrived_at, ?)");
      values.push(new Date());
    }
    if (status === "delivered") {
      updates.push("actual_arrival=COALESCE(actual_arrival, ?)", "pod_status='uploaded'");
      values.push(new Date());
    }
    if (status === "failed_delivery") {
      updates.push("failed_delivery_reason=?");
      values.push(reason || null);
    }
    if (status === "declined") {
      updates.push("failed_delivery_reason=?");
      values.push(reason || "Driver declined the job.");
    }

    values.push(jobId, driver.id);
    await db.query(`UPDATE trips SET ${updates.join(", ")} WHERE id=? AND driver_id=?`, values);

    if (changedStatus) {
      await db.query(
        `INSERT INTO driver_job_status_events (trip_id, driver_id, status, reason, source)
         VALUES (?, ?, ?, ?, 'driver')`,
        [jobId, driver.id, status, reason || null]
      );
    }

    if (job.vehicle_id && dispatchStatus) {
      const vehicleStatus = dispatchStatus === "active" ? "in_transit" : dispatchStatus === "completed" || dispatchStatus === "blocked" ? "available" : "planned";
      await db.query(`UPDATE vehicles SET status=? WHERE id=?`, [vehicleStatus, job.vehicle_id]);
    }

    if (status === "failed_delivery" || status === "declined") {
      await createControlRoomAlert({
        title: status === "declined" ? "Job declined by driver" : "Failed delivery reported",
        description: reason || (status === "declined" ? "Driver declined an assigned job from the driver panel." : "Driver marked a delivery as failed from the driver panel."),
        severity: "high",
        driverId: driver.id,
        tripId: jobId,
        vehicleId: job.vehicle_id || null
      });
    }

    emitJobUpdate({ jobId: Number(jobId), source: "driver-status", status, dispatchStatus });

    res.json({ message: "Driver job status updated.", status });
  } catch (err) {
    res.status(500).json({ message: "Driver status update error", error: err.message });
  }
};

// POST /api/drivers/me/jobs/:jobId/pod
exports.submitMyProofOfDelivery = async (req, res) => {
  try {
    await ensureDriverOpsSchema();
    const driver = await getDriverFromSession(req);
    if (!driver) return res.status(404).json({ message: "Driver profile not linked to this login." });

    const { jobId } = req.params;
    const { signatureData, photoData, deliveryNotes } = req.body;
    if (!signatureData && !photoData) {
      return res.status(400).json({ message: "POD signature or delivery photo is required." });
    }
    const [[job]] = await db.query(
      `SELECT t.id, t.vehicle_id, t.driver_job_status, t.primary_drop_status, t.pickup_address, r.origin_hub
       FROM trips t
       LEFT JOIN routes r ON r.id = t.route_id
       WHERE t.id = ? AND t.driver_id = ?`,
      [jobId, driver.id]
    );
    if (!job) return res.status(404).json({ message: "Assigned job not found." });
    if (["failed_delivery", "declined"].includes(job.driver_job_status)) {
      return res.status(409).json({ message: "POD cannot be submitted for a failed or declined job." });
    }
    const pickupPostcode = extractPostcode(job.pickup_address || job.origin_hub);
    const [[lastStop]] = await db.query(
      `SELECT id, address FROM job_stops WHERE trip_id=? ORDER BY stop_order DESC LIMIT 1`,
      [jobId]
    );
    const [openStops] = await db.query(
      `SELECT id, address FROM job_stops
       WHERE trip_id=? AND status NOT IN ('completed','skipped')
       ORDER BY stop_order ASC`,
      [jobId]
    );
    const incompleteDeliveryStops = openStops.filter(stop => !isReturnStop(stop, pickupPostcode, lastStop?.id || null));
    if (incompleteDeliveryStops.length > 0) {
      return res.status(400).json({ message: `Complete ${incompleteDeliveryStops.length} delivery stop(s) before submitting POD.` });
    }
    if ((job.primary_drop_status || "pending") !== "completed") {
      await db.query(
        `UPDATE trips
         SET primary_drop_status='completed',
             primary_drop_arrived_at=COALESCE(primary_drop_arrived_at, NOW()),
             primary_drop_completed_at=COALESCE(primary_drop_completed_at, NOW())
         WHERE id=? AND driver_id=?`,
        [jobId, driver.id]
      );
    }
    if (!(await hasActiveShift(driver.id))) {
      await db.query(
        `INSERT INTO driver_shifts (driver_id, shift_start, status, start_note) VALUES (?, NOW(), 'active', ?)`,
        [driver.id, `Auto-started when POD was submitted for job ${jobId}.`]
      );
      await db.query(`UPDATE drivers SET shift_status='ready' WHERE id=?`, [driver.id]);
    }

    await db.query(
      `UPDATE trips
       SET pod_signature_data=?, pod_photo_data=?, delivery_notes=?, pod_status='uploaded', driver_job_status='delivered', dispatch_status='completed', actual_arrival=COALESCE(actual_arrival, ?)
       WHERE id=? AND driver_id=?`,
      [signatureData || null, photoData || null, deliveryNotes || null, new Date(), jobId, driver.id]
    );
    if (job.driver_job_status !== "delivered") {
      await db.query(
        `INSERT INTO driver_job_status_events (trip_id, driver_id, status, reason, source)
         VALUES (?, ?, 'delivered', ?, 'driver')`,
        [jobId, driver.id, deliveryNotes || null]
      );
    }
    if (job.vehicle_id) {
      await db.query(`UPDATE vehicles SET status='available' WHERE id=?`, [job.vehicle_id]);
    }

    emitJobUpdate({ jobId: Number(jobId), source: "driver-pod", status: "delivered", dispatchStatus: "completed" });

    res.json({ message: "Proof of delivery submitted." });
  } catch (err) {
    res.status(500).json({ message: "POD submit error", error: err.message });
  }
};

// POST /api/drivers/me/shift/start
exports.startMyShift = async (req, res) => {
  try {
    await ensureDriverOpsSchema();
    const driver = await getDriverFromSession(req);
    if (!driver) return res.status(404).json({ message: "Driver profile not linked to this login." });

    const [[active]] = await db.query(`SELECT id FROM driver_shifts WHERE driver_id=? AND status='active' LIMIT 1`, [driver.id]);
    if (active) return res.json({ message: "Shift already active.", id: active.id });

    const [result] = await db.query(
      `INSERT INTO driver_shifts (driver_id, shift_start, status, start_note) VALUES (?, NOW(), 'active', ?)`,
      [driver.id, req.body.note || null]
    );
    await db.query(`UPDATE drivers SET shift_status='ready' WHERE id=?`, [driver.id]);
    res.status(201).json({ message: "Shift started.", id: result.insertId });
  } catch (err) {
    res.status(500).json({ message: "Shift start error", error: err.message });
  }
};

// POST /api/drivers/me/shift/end
exports.endMyShift = async (req, res) => {
  try {
    await ensureDriverOpsSchema();
    const driver = await getDriverFromSession(req);
    if (!driver) return res.status(404).json({ message: "Driver profile not linked to this login." });

    const [[active]] = await db.query(`SELECT id, shift_start FROM driver_shifts WHERE driver_id=? AND status='active' ORDER BY shift_start DESC LIMIT 1`, [driver.id]);
    if (!active) return res.status(400).json({ message: "No active shift found." });

    await db.query(
      `UPDATE driver_shifts
       SET shift_end=NOW(), total_hours=TIMESTAMPDIFF(MINUTE, shift_start, NOW()) / 60, status='completed', end_note=?
       WHERE id=? AND driver_id=?`,
      [req.body.note || null, active.id, driver.id]
    );
    await db.query(`UPDATE drivers SET shift_status='rest' WHERE id=?`, [driver.id]);
    res.json({ message: "Shift ended." });
  } catch (err) {
    res.status(500).json({ message: "Shift end error", error: err.message });
  }
};

// POST /api/drivers/me/expenses
exports.createMyExpense = async (req, res) => {
  try {
    await ensureDriverOpsSchema();
    const driver = await getDriverFromSession(req);
    if (!driver) return res.status(404).json({ message: "Driver profile not linked to this login." });

    const { tripId, expenseType, amount, fuelLitres, notes, receiptData } = req.body;
    const allowedCategory = ["fuel", "toll", "parking", "repair", "meal", "other"].includes(expenseType) ? expenseType : "other";
    const fuelLitresValue = Number(fuelLitres);
    const amountValue = allowedCategory === "fuel" ? 0 : Number(amount);
    if (allowedCategory === "fuel" && (!Number.isFinite(fuelLitresValue) || fuelLitresValue <= 0)) {
      return res.status(400).json({ message: "Fuel litres are required." });
    }
    if (allowedCategory !== "fuel" && (!Number.isFinite(amountValue) || amountValue <= 0)) {
      return res.status(400).json({ message: "A valid expense amount is required." });
    }
    if (tripId) {
      const [[trip]] = await db.query(`SELECT id FROM trips WHERE id=? AND driver_id=?`, [tripId, driver.id]);
      if (!trip) return res.status(404).json({ message: "Assigned trip not found for this expense." });
    }

    const finalNotes = allowedCategory === "fuel"
      ? [`Fuel litres: ${fuelLitresValue}`, notes || ""].filter(Boolean).join(". ")
      : notes || null;

    const [result] = await db.query(
      `INSERT INTO driver_expenses
         (driver_id, trip_id, expense_type, amount_gbp, notes, receipt_data)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [driver.id, tripId || null, allowedCategory, amountValue, finalNotes, receiptData || null]
    );
    await createControlRoomAlert({
      title: `Driver expense submitted`,
      description: allowedCategory === "fuel"
        ? `${driver.full_name} submitted fuel entry for ${fuelLitresValue} litres.`
        : `${driver.full_name} submitted ${allowedCategory} expense for £${amountValue.toFixed(2)}.`,
      severity: "medium",
      driverId: driver.id,
      tripId: tripId || null
    });
    res.status(201).json({ message: "Expense saved and sent to admin.", id: result.insertId });
  } catch (err) {
    res.status(500).json({ message: "Expense create error", error: err.message });
  }
};

// POST /api/drivers/me/defects
exports.createMyDefectReport = async (req, res) => {
  try {
    await ensureDriverOpsSchema();
    const driver = await getDriverFromSession(req);
    if (!driver) return res.status(404).json({ message: "Driver profile not linked to this login." });

    const { vehicleId, defectType, severity, description } = req.body;
    const allowedSeverity = ["low", "medium", "high", "critical"].includes(severity) ? severity : "medium";
    let targetVehicleId = vehicleId || null;
    let targetTripId = null;
    if (!targetVehicleId) {
      const [[activeJob]] = await db.query(
        `SELECT id, vehicle_id FROM trips
         WHERE driver_id=? AND vehicle_id IS NOT NULL AND driver_job_status IN ('accepted','arrived_pickup','loaded','in_transit','arrived_drop')
         ORDER BY COALESCE(planned_departure, created_at) ASC LIMIT 1`,
        [driver.id]
      );
      targetVehicleId = activeJob?.vehicle_id || null;
      targetTripId = activeJob?.id || null;
    }
    let defectId = null;
    if (targetVehicleId) {
      const [result] = await db.query(
        `INSERT INTO defect_reports (vehicle_id, driver_id, trip_id, defect_type, description, severity, reported_by, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'open')`,
        [targetVehicleId, driver.id, targetTripId, defectType || "Driver report", description || "Driver submitted a vehicle defect report.", allowedSeverity, driver.full_name]
      );
      defectId = result.insertId;
    }

    await createControlRoomAlert({
      title: `Driver defect report`,
      description: `${driver.full_name}: ${description || defectType || "Vehicle defect reported."}`,
      severity: allowedSeverity,
      driverId: driver.id,
      tripId: targetTripId,
      vehicleId: targetVehicleId
    });

    res.status(201).json({
      message: targetVehicleId ? "Defect report submitted and admin alerted." : "Alert sent to admin. No vehicle is assigned to this driver yet.",
      id: defectId
    });
  } catch (err) {
    res.status(500).json({ message: "Defect report error", error: err.message });
  }
};

// POST /api/drivers/me/walkaround
exports.submitWalkaround = async (req, res) => {
  try {
    await ensureDriverOpsSchema();
    const driver = await getDriverFromSession(req);
    if (!driver) return res.status(404).json({ message: "Driver profile not linked." });

    const { tripId, checks, allClear, issues } = req.body;
    if (!checks) return res.status(400).json({ message: "Checklist data required." });

    const [result] = await db.query(
      `INSERT INTO driver_walkarounds (driver_id, trip_id, checks, all_clear, issues) VALUES (?, ?, ?, ?, ?)`,
      [driver.id, tripId || null, JSON.stringify(checks), allClear ? 1 : 0, issues || null]
    );

    if (!allClear) {
      await createControlRoomAlert({
        title: "Pre-trip walkaround issue reported",
        description: `${driver.full_name}: ${issues || "Check failed on walkaround checklist."}`,
        severity: "high",
        driverId: driver.id,
        tripId: tripId || null
      });
    }

    res.status(201).json({ message: allClear ? "Walkaround passed — all clear." : "Walkaround submitted with issues. Admin alerted.", id: result.insertId });
  } catch (err) {
    res.status(500).json({ message: "Walkaround submit error", error: err.message });
  }
};

// POST /api/drivers/me/odometer
exports.logOdometer = async (req, res) => {
  try {
    await ensureDriverOpsSchema();
    const driver = await getDriverFromSession(req);
    if (!driver) return res.status(404).json({ message: "Driver profile not linked." });

    const { tripId, readingKm, logType } = req.body;
    const readingValue = Number(readingKm);
    if (!Number.isFinite(readingValue) || readingValue <= 0) return res.status(400).json({ message: "A valid odometer reading is required." });
    const cleanLogType = ["start", "end"].includes(logType) ? logType : "start";

    let vehicleId = null;
    if (tripId) {
      const [[t]] = await db.query(`SELECT vehicle_id FROM trips WHERE id=? AND driver_id=?`, [tripId, driver.id]);
      vehicleId = t?.vehicle_id || null;
    }

    const [result] = await db.query(
      `INSERT INTO driver_odometer_logs (driver_id, trip_id, vehicle_id, reading_km, log_type) VALUES (?, ?, ?, ?, ?)`,
      [driver.id, tripId || null, vehicleId, readingValue, cleanLogType]
    );

    res.status(201).json({ message: "Odometer reading logged.", id: result.insertId });
  } catch (err) {
    res.status(500).json({ message: "Odometer log error", error: err.message });
  }
};

// PATCH /api/drivers/me/jobs/:jobId/eta
exports.updateJobEta = async (req, res) => {
  try {
    await ensureDriverOpsSchema();
    const driver = await getDriverFromSession(req);
    if (!driver) return res.status(404).json({ message: "Driver profile not linked." });

    const { jobId } = req.params;
    const { eta } = req.body;
    if (!eta) return res.status(400).json({ message: "A valid ETA is required." });

    const [[job]] = await db.query(
      `SELECT id, trip_code, vehicle_id, eta, planned_departure FROM trips WHERE id=? AND driver_id=?`,
      [jobId, driver.id]
    );
    if (!job) return res.status(404).json({ message: "Assigned job not found." });

    const etaDate = combineEtaDateAndTime(eta, job);
    if (Number.isNaN(etaDate.getTime())) return res.status(400).json({ message: "A valid ETA is required." });

    await db.query(`UPDATE trips SET eta=?, eta_updated_at=NOW() WHERE id=? AND driver_id=?`, [etaDate, jobId, driver.id]);

    const etaTime = etaDate.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    await createControlRoomAlert({
      title: `Driver ETA updated: ${job.trip_code}`,
      description: `${driver.full_name || "Driver"} set ETA to ${etaTime}.`,
      severity: "medium",
      driverId: driver.id,
      tripId: jobId,
      vehicleId: job.vehicle_id || null
    });
    emitJobUpdate({ jobId: Number(jobId), source: "driver-eta", eta: etaDate.toISOString(), etaTime });

    res.json({ message: `ETA updated successfully for ${etaTime}.`, eta: etaDate.toISOString(), etaTime });
  } catch (err) {
    res.status(500).json({ message: "ETA update error", error: err.message });
  }
};

// PATCH /api/drivers/me/jobs/:jobId/primary-drop/status
exports.updatePrimaryDropStatus = async (req, res) => {
  try {
    await ensureDriverOpsSchema();
    const driver = await getDriverFromSession(req);
    if (!driver) return res.status(404).json({ message: "Driver profile not linked." });

    const { jobId } = req.params;
    const { status } = req.body;
    const allowedStatuses = new Set(["arrived", "completed"]);
    if (!allowedStatuses.has(status)) return res.status(400).json({ message: "Invalid Drop 1 status." });

    const [[job]] = await db.query(
      `SELECT t.id, t.driver_job_status, t.pickup_address, r.origin_hub
       FROM trips t
       LEFT JOIN routes r ON r.id = t.route_id
       WHERE t.id=? AND t.driver_id=?`,
      [jobId, driver.id]
    );
    if (!job) return res.status(404).json({ message: "Assigned job not found." });

    const pickupPostcode = extractPostcode(job.pickup_address || job.origin_hub);
    const [[lastStop]] = await db.query(
      `SELECT id, address FROM job_stops WHERE trip_id=? ORDER BY stop_order DESC LIMIT 1`,
      [jobId]
    );
    const [openStops] = await db.query(
      `SELECT id, address FROM job_stops
       WHERE trip_id=? AND status NOT IN ('completed','skipped')
       ORDER BY stop_order ASC`,
      [jobId]
    );
    const remainingDeliveryStops = openStops.filter(stop => !isReturnStop(stop, pickupPostcode, lastStop?.id || null));
    const nextDriverStatus = status === "completed" && remainingDeliveryStops.length > 0 ? "in_transit" : "arrived_drop";

    await db.query(
      `UPDATE trips
       SET primary_drop_status=?,
           primary_drop_arrived_at=IF(? IN ('arrived','completed'), COALESCE(primary_drop_arrived_at, NOW()), primary_drop_arrived_at),
           primary_drop_completed_at=IF(?='completed', COALESCE(primary_drop_completed_at, NOW()), primary_drop_completed_at),
           driver_job_status=?,
           dispatch_status='active'
       WHERE id=? AND driver_id=?`,
      [status, status, status, nextDriverStatus, jobId, driver.id]
    );

    if (job.driver_job_status !== nextDriverStatus) {
      await db.query(
        `INSERT INTO driver_job_status_events (trip_id, driver_id, status, reason, source)
         VALUES (?, ?, ?, ?, 'driver')`,
        [jobId, driver.id, nextDriverStatus, status === "completed" ? "Drop 1 completed; moving to next drop." : "Driver arrived at Drop 1."]
      );
    }

    emitJobUpdate({ jobId: Number(jobId), source: "driver-primary-drop", primaryDropStatus: status, status: nextDriverStatus });

    res.json({
      message: status === "completed"
        ? remainingDeliveryStops.length > 0
          ? "Drop 1 completed. Continue to the next drop."
          : "Drop 1 completed. Submit POD to finish the job."
        : "Drop 1 marked arrived.",
      status,
      driverJobStatus: nextDriverStatus
    });
  } catch (err) {
    res.status(500).json({ message: "Drop 1 status update error", error: err.message });
  }
};

// PATCH /api/drivers/me/jobs/:jobId/stops/:stopId/status
exports.updateJobStopStatus = async (req, res) => {
  try {
    await ensureDriverOpsSchema();
    const driver = await getDriverFromSession(req);
    if (!driver) return res.status(404).json({ message: "Driver profile not linked." });

    const { jobId, stopId } = req.params;
    const { status } = req.body;
    const allowedStatuses = new Set(["pending", "arrived", "completed", "skipped"]);
    if (!allowedStatuses.has(status)) return res.status(400).json({ message: "Invalid stop status." });

    const [[stop]] = await db.query(
      `SELECT js.id, js.status, js.address, js.trip_id, t.trip_code, t.vehicle_id
       FROM job_stops js
       INNER JOIN trips t ON t.id = js.trip_id
       WHERE js.id=? AND js.trip_id=? AND t.driver_id=?`,
      [stopId, jobId, driver.id]
    );
    if (!stop) return res.status(404).json({ message: "Assigned stop not found." });

    await db.query(
      `UPDATE job_stops
       SET status=?,
           actual_arrival=IF(? IN ('arrived','completed'), COALESCE(actual_arrival, NOW()), actual_arrival),
           actual_departure=IF(? IN ('completed','skipped'), COALESCE(actual_departure, NOW()), actual_departure)
       WHERE id=? AND trip_id=?`,
      [status, status, status, stopId, jobId]
    );

    if (status === "completed" || status === "skipped") {
      const [[trip]] = await db.query(
        `SELECT t.primary_drop_status, t.pickup_address, r.origin_hub
         FROM trips t
         LEFT JOIN routes r ON r.id = t.route_id
         WHERE t.id=? AND t.driver_id=?`,
        [jobId, driver.id]
      );
      const pickupPostcode = extractPostcode(trip?.pickup_address || trip?.origin_hub);
      const [[lastStop]] = await db.query(
        `SELECT id, address FROM job_stops WHERE trip_id=? ORDER BY stop_order DESC LIMIT 1`,
        [jobId]
      );
      const [openStops] = await db.query(
        `SELECT id, address FROM job_stops
         WHERE trip_id=? AND status NOT IN ('completed','skipped')
         ORDER BY stop_order ASC`,
        [jobId]
      );
      const remainingDeliveryStops = openStops.filter(row => !isReturnStop(row, pickupPostcode, lastStop?.id || null));
      if ((trip?.primary_drop_status || "pending") === "completed") {
        await db.query(
          `UPDATE trips SET driver_job_status=? WHERE id=? AND driver_id=?`,
          [remainingDeliveryStops.length > 0 ? "in_transit" : "arrived_drop", jobId, driver.id]
        );
      }
    }

    emitJobUpdate({ jobId: Number(jobId), stopId: Number(stopId), source: "driver-stop", stopStatus: status });

    res.json({ message: `${stop.address || "Stop"} marked ${stopStatusLabel[status] || status}.`, status });
  } catch (err) {
    res.status(500).json({ message: "Stop status update error", error: err.message });
  }
};

// GET /api/drivers/me/messages
exports.getMyMessages = async (req, res) => {
  try {
    await ensureDriverOpsSchema();
    const driver = await getDriverFromSession(req);
    if (!driver) return res.status(404).json({ message: "Driver profile not linked." });

    const [messages] = await db.query(
      `SELECT * FROM driver_messages WHERE driver_id=? ORDER BY sent_at DESC LIMIT 30`,
      [driver.id]
    );
    await db.query(
      `UPDATE driver_messages SET is_read=1 WHERE driver_id=? AND sender_role <> 'driver' AND is_read=0`,
      [driver.id]
    );

    const unreadCount = messages.filter(m => m.sender_role !== "driver" && !m.is_read).length;
    res.json({
      unreadCount,
      messages: messages.reverse().map(m => ({
        id: m.id,
        driverId: driver.id,
        senderRole: m.sender_role,
        senderName: m.sender_name || (m.sender_role === "driver" ? driver.full_name : "Dispatch"),
        body: m.body,
        tripId: m.trip_id,
        isRead: Boolean(m.is_read),
        at: fmtDateTime(m.sent_at),
        sentAt: isoDateTime(m.sent_at)
      }))
    });
  } catch (err) {
    res.status(500).json({ message: "Messages fetch error", error: err.message });
  }
};

// POST /api/drivers/me/messages
exports.sendMyMessage = async (req, res) => {
  try {
    await ensureDriverOpsSchema();
    const driver = await getDriverFromSession(req);
    if (!driver) return res.status(404).json({ message: "Driver profile not linked." });

    const { body, tripId } = req.body;
    if (!body?.trim()) return res.status(400).json({ message: "Message body required." });

    const [result] = await db.query(
      `INSERT INTO driver_messages (driver_id, sender_role, sender_name, body, trip_id) VALUES (?, 'driver', ?, ?, ?)`,
      [driver.id, driver.full_name, body.trim().slice(0, 1000), tripId || null]
    );

    await createControlRoomAlert({
      title: `Driver message: ${driver.full_name}`,
      description: body.trim().slice(0, 200),
      severity: "medium",
      driverId: driver.id,
      tripId: tripId || null
    });

    const [[created]] = await db.query(`SELECT * FROM driver_messages WHERE id=?`, [result.insertId]);
    const message = {
      id: created.id,
      driverId: driver.id,
      driverName: driver.full_name,
      senderRole: created.sender_role,
      senderName: created.sender_name || driver.full_name,
      body: created.body,
      tripId: created.trip_id,
      isRead: Boolean(created.is_read),
      at: fmtDateTime(created.sent_at),
      sentAt: isoDateTime(created.sent_at)
    };
    emitDriverChatMessage(message);

    res.status(201).json({ message: "Message sent to dispatch.", id: result.insertId, chatMessage: message });
  } catch (err) {
    res.status(500).json({ message: "Message send error", error: err.message });
  }
};

// POST /api/drivers/me/jobs/:jobId/reschedule
exports.rescheduleJob = async (req, res) => {
  try {
    await ensureDriverOpsSchema();
    const driver = await getDriverFromSession(req);
    if (!driver) return res.status(404).json({ message: "Driver profile not linked." });

    const { jobId } = req.params;
    const { newDate, reason } = req.body;
    const nextDate = new Date(newDate);
    if (!newDate || Number.isNaN(nextDate.getTime())) return res.status(400).json({ message: "A valid new delivery date is required." });
    if (nextDate.getTime() < Date.now() - 60000) return res.status(400).json({ message: "New delivery date cannot be in the past." });

    const [[job]] = await db.query(
      `SELECT id, vehicle_id FROM trips WHERE id=? AND driver_id=? AND driver_job_status='failed_delivery'`,
      [jobId, driver.id]
    );
    if (!job) return res.status(404).json({ message: "Failed delivery job not found." });

    await db.query(
      `UPDATE trips SET planned_departure=?, driver_job_status='accepted', dispatch_status='planned',
       failed_delivery_reason=CONCAT(COALESCE(failed_delivery_reason,''), ' | Rescheduled: ', ?)
       WHERE id=? AND driver_id=?`,
      [nextDate, reason || "Driver rescheduled", jobId, driver.id]
    );

    await createControlRoomAlert({
      title: "Failed delivery rescheduled",
      description: `${driver.full_name} rescheduled delivery. Reason: ${reason || "Not provided"}.`,
      severity: "medium",
      driverId: driver.id,
      tripId: jobId,
      vehicleId: job.vehicle_id || null
    });

    res.json({ message: "Delivery rescheduled successfully." });
  } catch (err) {
    res.status(500).json({ message: "Reschedule error", error: err.message });
  }
};

// POST /api/drivers/me/location
exports.updateMyLocation = async (req, res) => {
  try {
    await ensureDriverOpsSchema();
    const driver = await getDriverFromSession(req);
    if (!driver) return res.status(404).json({ message: "Driver profile not linked to this login." });

    const latitude = Number(req.body.latitude);
    const longitude = Number(req.body.longitude);
    const accuracy = req.body.accuracy != null ? Number(req.body.accuracy) : null;
    const speedKph = req.body.speedKph != null ? Number(req.body.speedKph) : null;

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return res.status(400).json({ message: "Valid GPS latitude and longitude are required." });
    }

    const [[trackingJob]] = await db.query(
      `SELECT id, vehicle_id FROM trips
       WHERE driver_id=? AND vehicle_id IS NOT NULL
         AND COALESCE(driver_job_status, 'accepted') IN ('accepted','arrived_pickup','loaded','in_transit','arrived_drop')
       ORDER BY
         CASE COALESCE(driver_job_status, 'accepted')
           WHEN 'in_transit' THEN 1
           WHEN 'loaded' THEN 2
           WHEN 'arrived_pickup' THEN 3
           WHEN 'arrived_drop' THEN 4
           WHEN 'accepted' THEN 5
           ELSE 6
         END,
         COALESCE(planned_departure, created_at) DESC
       LIMIT 1`,
      [driver.id]
    );

    if (!trackingJob?.vehicle_id) {
      return res.json({ message: "GPS received, but no vehicle is assigned to this driver yet.", tracked: false });
    }

    const locationLabel = `GPS ${latitude.toFixed(5)}, ${longitude.toFixed(5)}${Number.isFinite(accuracy) ? ` · ±${Math.round(accuracy)}m` : ""}`;
    await db.query(
      `UPDATE vehicles
       SET current_location=?,
           speed_kph=?,
           gps_latitude=?,
           gps_longitude=?,
           gps_accuracy_m=?,
           last_ping_at=NOW()
       WHERE id=?`,
      [
        locationLabel,
        Number.isFinite(speedKph) ? Math.round(speedKph) : 0,
        latitude,
        longitude,
        Number.isFinite(accuracy) ? accuracy : null,
        trackingJob.vehicle_id
      ]
    );

    emitDriverLocationUpdate({
      driverId: driver.id,
      driverName: driver.full_name,
      tripId: trackingJob.id,
      vehicleId: trackingJob.vehicle_id,
      latitude,
      longitude,
      accuracy: Number.isFinite(accuracy) ? accuracy : null,
      speedKph: Number.isFinite(speedKph) ? Math.round(speedKph) : 0,
      location: locationLabel
    });

    res.json({ message: "Driver GPS ping updated.", tracked: true, tripId: trackingJob.id, vehicleId: trackingJob.vehicle_id });
  } catch (err) {
    res.status(500).json({ message: "Driver GPS update error", error: err.message });
  }
};

// GET /api/drivers/me/notifications?userId=:userId
exports.getMyNotifications = async (req, res) => {
  try {
    await ensureDriverOpsSchema();
    const driver = await getDriverFromSession(req);
    if (!driver) return res.status(404).json({ message: "Driver profile not linked." });

    const todayKey = new Date().toISOString().slice(0, 10);

    const [newJobs] = await db.query(
      `SELECT t.id, t.trip_code, r.origin_hub, r.destination_hub
       FROM trips t
       LEFT JOIN routes r ON t.route_id = r.id
       WHERE t.driver_id = ? AND DATE(t.planned_departure) = ? AND t.driver_job_status IN ('offered', 'accepted')
       ORDER BY t.planned_departure ASC LIMIT 5`,
      [driver.id, todayKey]
    );
    const [podPending] = await db.query(
      `SELECT id, trip_code FROM trips
       WHERE driver_id = ? AND driver_job_status = 'delivered' AND pod_status != 'verified'
       LIMIT 5`,
      [driver.id]
    );
    const [[shiftCheck]] = await db.query(
      `SELECT id FROM driver_shifts WHERE driver_id = ? AND status = 'active' LIMIT 1`,
      [driver.id]
    );
    const [[todayJobCount]] = await db.query(
      `SELECT COUNT(*) AS total FROM trips
       WHERE driver_id = ? AND DATE(planned_departure) = ?`,
      [driver.id, todayKey]
    );

    const notifications = [
      ...newJobs.map(j => ({
        id: `job-${j.id}`,
        type: "info",
        title: `Job today: ${j.trip_code}`,
        body: j.origin_hub && j.destination_hub ? `${j.origin_hub} → ${j.destination_hub}` : "Check job details."
      })),
      ...podPending.map(j => ({
        id: `pod-${j.id}`,
        type: "warning",
        title: `POD pending: ${j.trip_code}`,
        body: "Delivery done but proof of delivery not yet submitted."
      })),
      ...(todayJobCount.total > 0 && !shiftCheck ? [{
        id: "shift-not-started",
        type: "warning",
        title: "Shift not started",
        body: `You have ${todayJobCount.total} job(s) today but your shift hasn't begun.`
      }] : [])
    ];

    res.json({ count: notifications.length, notifications });
  } catch (err) {
    res.status(500).json({ message: "Driver notifications error", error: err.message });
  }
};

// GET /api/drivers
exports.listDrivers = async (req, res) => {
  try {
    await ensureDriverOpsSchema();

    const [[counts]] = await db.query(
      `SELECT COUNT(*) as total,
        COALESCE(SUM(shift_status='ready'), 0)           as ready,
        COALESCE(SUM(shift_status='on_trip'), 0)         as on_trip,
        COALESCE(SUM(compliance_status='blocked'), 0)    as blocked,
        COALESCE(SUM(compliance_status='review'), 0)     as review,
        COALESCE(SUM(onboarding_status IN ('new','docs_pending')), 0) as onboarding,
        COALESCE(SUM(
          license_expiry < CURDATE()
          OR medical_expiry < CURDATE()
          OR cpc_expiry < CURDATE()
          OR tacho_card_expiry < CURDATE()
        ), 0) as expired_docs,
        COALESCE(SUM(
          license_expiry BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 90 DAY)
          OR medical_expiry BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 90 DAY)
          OR cpc_expiry BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 90 DAY)
          OR tacho_card_expiry BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 90 DAY)
        ), 0) as expiring_docs
       FROM drivers`
    );

    const [rows] = await db.query(
      `SELECT d.id, d.employee_code, d.full_name, d.phone, d.home_depot,
              d.license_number, d.license_expiry, d.medical_expiry,
              d.cpc_number, d.cpc_expiry, d.tacho_card_number, d.tacho_card_expiry,
              d.onboarding_status, d.shift_status, d.compliance_status,
              d.assigned_vehicle_id, d.salary_gbp, d.commission_rate, d.internal_score,
              d.created_at,
              u.email,
              av.registration_number AS assigned_vehicle,
              COALESCE(t.total_trips, 0) AS total_trips,
              COALESCE(t.open_trips, 0) AS open_trips,
              COALESCE(dd.total_docs, 0) AS total_docs,
              dm.last_message_at,
              COALESCE(dm.unread_messages, 0) AS unread_messages
       FROM drivers d
       LEFT JOIN users         u  ON d.user_id  = u.id
       LEFT JOIN vehicles      av ON av.id = d.assigned_vehicle_id
       LEFT JOIN (
          SELECT driver_id,
                 COUNT(*) AS total_trips,
                 SUM(dispatch_status IN ('planned','loading','active')) AS open_trips
          FROM trips GROUP BY driver_id
       ) t ON t.driver_id = d.id
       LEFT JOIN (
          SELECT driver_id, COUNT(*) AS total_docs
          FROM driver_documents GROUP BY driver_id
       ) dd ON dd.driver_id = d.id
       LEFT JOIN (
          SELECT driver_id,
                 MAX(sent_at) AS last_message_at,
                 SUM(sender_role='driver' AND is_read=0) AS unread_messages
          FROM driver_messages GROUP BY driver_id
       ) dm ON dm.driver_id = d.id
       ORDER BY d.created_at DESC`
    );

    const complianceTone = { clear: "success", review: "warning", blocked: "danger" };
    const shiftTone      = { ready: "success", on_trip: "warning", rest: "neutral", review: "danger" };

    res.json({
      stats: [
        { label: "Total drivers", value: counts.total, description: "All registered drivers.", change: "Live from database", tone: "neutral" },
        { label: "Ready for dispatch", value: counts.ready, description: "Available for new jobs.", change: "Dispatch ready", tone: "success" },
        { label: "On trip", value: counts.on_trip, description: "Currently assigned on road.", change: "Live fleet", tone: "warning" },
        { label: "Blocked / review", value: Number(counts.blocked) + Number(counts.review), description: "Compliance needs attention.", change: "Ops review", tone: "danger" }
      ],
      driverHealth: [
        { label: "Expired docs", value: counts.expired_docs, description: "Licence, medical, CPC, or tacho expired.", change: "Stop dispatch", tone: counts.expired_docs ? "danger" : "success" },
        { label: "Expiring docs", value: counts.expiring_docs, description: "Documents expiring within 90 days.", change: "Renewal queue", tone: counts.expiring_docs ? "warning" : "success" },
        { label: "Onboarding queue", value: counts.onboarding, description: "New or docs-pending drivers.", change: "Admin check", tone: counts.onboarding ? "warning" : "success" },
        { label: "Unread messages", value: rows.reduce((sum, r) => sum + Number(r.unread_messages || 0), 0), description: "Driver messages needing reply.", change: "Support desk", tone: rows.some(r => Number(r.unread_messages || 0) > 0) ? "danger" : "success" }
      ],
      drivers: rows.map(r => ({
        id: r.id,
        employeeCode: r.employee_code,
        fullName: r.full_name,
        phone: r.phone || "—",
        email: r.email || "—",
        homeDepot: r.home_depot || "—",
        licenceNumber: r.license_number,
        licenceExpiry: fmtDate(r.license_expiry),
        licenceExpiryRaw: rawDate(r.license_expiry),
        licenceExpiryTone: expiryTone(r.license_expiry),
        medicalExpiry: fmtDate(r.medical_expiry),
        medicalExpiryRaw: rawDate(r.medical_expiry),
        medicalExpiryTone: expiryTone(r.medical_expiry),
        cpcExpiry: fmtDate(r.cpc_expiry),
        cpcExpiryRaw: rawDate(r.cpc_expiry),
        cpcExpiryTone: expiryTone(r.cpc_expiry),
        tachoExpiry: fmtDate(r.tacho_card_expiry),
        tachoExpiryRaw: rawDate(r.tacho_card_expiry),
        tachoExpiryTone: expiryTone(r.tacho_card_expiry),
        onboardingStatus: r.onboarding_status,
        shiftStatus: r.shift_status,
        shiftTone: shiftTone[r.shift_status] || "neutral",
        complianceStatus: r.compliance_status,
        complianceTone: complianceTone[r.compliance_status] || "neutral",
        assignedVehicle: r.assigned_vehicle || "—",
        salary: fmtAmount(r.salary_gbp),
        commissionRate: r.commission_rate != null ? `${Number(r.commission_rate)}%` : "—",
        internalScore: r.internal_score ?? "—",
        totalTrips: r.total_trips,
        openTrips: r.open_trips,
        totalDocs: r.total_docs,
        unreadMessages: Number(r.unread_messages || 0),
        lastMessageAt: fmtDateTime(r.last_message_at),
        docRisk: [r.license_expiry, r.medical_expiry, r.cpc_expiry, r.tacho_card_expiry].some(date => {
          const days = daysUntil(date);
          return days !== null && days < 90;
        }),
        since: fmtDate(r.created_at)
      }))
    });
  } catch (err) {
    res.status(500).json({ message: "Driver list error", error: err.message });
  }
};

// PATCH /api/drivers/:id/inline
exports.updateDriverInline = async (req, res) => {
  try {
    await ensureDriverOpsSchema();
    const { id } = req.params;
    const [[existing]] = await db.query(`SELECT * FROM drivers WHERE id = ?`, [id]);
    if (!existing) return res.status(404).json({ message: "Driver not found." });

    const fieldMap = {
      fullName: "full_name",
      employeeCode: "employee_code",
      phone: "phone",
      homeDepot: "home_depot",
      licenceExpiry: "license_expiry",
      medicalExpiry: "medical_expiry",
      cpcExpiry: "cpc_expiry",
      tachoExpiry: "tacho_card_expiry",
      onboardingStatus: "onboarding_status",
      shiftStatus: "shift_status",
      complianceStatus: "compliance_status",
      internalScore: "internal_score"
    };
    const allowedValues = {
      onboarding_status: new Set(["new", "docs_pending", "approved", "rejected"]),
      shift_status: new Set(["ready", "on_trip", "rest", "review"]),
      compliance_status: new Set(["clear", "review", "blocked"])
    };

    const updates = [];
    const values = [];
    for (const [clientField, column] of Object.entries(fieldMap)) {
      if (!Object.prototype.hasOwnProperty.call(req.body, clientField)) continue;
      let value = req.body[clientField];
      if (allowedValues[column] && !allowedValues[column].has(value)) {
        return res.status(400).json({ message: `Invalid ${clientField} value.` });
      }
      if (column === "internal_score") value = value === "" || value == null ? null : Number(value);
      if (["license_expiry", "medical_expiry", "cpc_expiry", "tacho_card_expiry"].includes(column)) value = value || null;
      if (["phone", "home_depot"].includes(column)) value = value || null;
      updates.push(`${column}=?`);
      values.push(value);
    }

    if (updates.length === 0) {
      return res.status(400).json({ message: "No editable driver fields supplied." });
    }

    await db.query(`UPDATE drivers SET ${updates.join(", ")} WHERE id=?`, [...values, id]);
    const [[updated]] = await db.query(`SELECT * FROM drivers WHERE id = ?`, [id]);
    await logActivity(req, {
      module: "drivers",
      action: "inline_update",
      entityType: "driver",
      entityId: id,
      entityLabel: updated.full_name,
      details: { changes: buildChangeSet(existing, updated, Object.values(fieldMap)) }
    });
    res.json({ message: "Driver table updated." });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: "Driver name/code conflicts with an existing record." });
    }
    res.status(500).json({ message: "Driver inline update error", error: err.message });
  }
};

// GET /api/drivers/:id
exports.getDriverById = async (req, res) => {
  try {
    const { id } = req.params;

    const [[d]] = await db.query(
      `SELECT d.*, u.email, u.role FROM drivers d LEFT JOIN users u ON d.user_id = u.id WHERE d.id = ?`, [id]
    );
    if (!d) return res.status(404).json({ message: "Driver not found." });

    const [docs] = await db.query(
      `SELECT * FROM driver_documents WHERE driver_id = ? ORDER BY expiry_date ASC`, [id]
    );

    const [trips] = await db.query(
      `SELECT t.id, t.trip_code, t.dispatch_status, t.priority_level,
              t.planned_departure, t.actual_departure, t.actual_arrival, t.freight_amount_gbp,
              r.origin_hub, r.destination_hub,
              v.registration_number
       FROM trips t
       LEFT JOIN routes   r ON t.route_id  = r.id
       LEFT JOIN vehicles v ON t.vehicle_id = v.id
       WHERE t.driver_id = ?
       ORDER BY t.created_at DESC LIMIT 20`, [id]
    );

    const [shifts] = await db.query(
      `SELECT * FROM driver_shifts WHERE driver_id = ? ORDER BY shift_start DESC LIMIT 10`, [id]
    );

    const complianceTone = { clear: "success", review: "warning", blocked: "danger" };
    const dispatchTone   = { active: "success", loading: "warning", blocked: "danger", planned: "neutral", completed: "neutral" };
    const verifyTone     = { valid: "success", expiring: "warning", expired: "danger", pending: "neutral" };

    res.json({
      id: d.id,
      employeeCode: d.employee_code,
      fullName: d.full_name,
      phone: d.phone,
      email: d.email,
      address: d.address,
      postcode: d.postcode,
      dateOfBirth: fmtDate(d.date_of_birth),
      nationalInsurance: d.national_insurance,
      homeDepot: d.home_depot,
      onboardingStatus: d.onboarding_status,
      shiftStatus: d.shift_status,
      complianceStatus: d.compliance_status,
      complianceTone: complianceTone[d.compliance_status] || "neutral",
      assignedVehicleId: d.assigned_vehicle_id,
      salaryGbp: d.salary_gbp,
      commissionRate: d.commission_rate,
      internalScore: d.internal_score,
      accidentIncidentRecord: d.accident_incident_record,
      penaltyDeductionRecord: d.penalty_deduction_record,
      since: fmtDate(d.created_at),

      licence: {
        number: d.license_number,
        expiry: fmtDate(d.license_expiry),
        expiryTone: expiryTone(d.license_expiry),
        daysLeft: daysUntil(d.license_expiry)
      },
      medical: {
        expiry: fmtDate(d.medical_expiry),
        expiryTone: expiryTone(d.medical_expiry),
        daysLeft: daysUntil(d.medical_expiry)
      },
      cpc: {
        number: d.cpc_number,
        expiry: fmtDate(d.cpc_expiry),
        expiryTone: expiryTone(d.cpc_expiry),
        daysLeft: daysUntil(d.cpc_expiry)
      },
      tacho: {
        cardNumber: d.tacho_card_number,
        expiry: fmtDate(d.tacho_card_expiry),
        expiryTone: expiryTone(d.tacho_card_expiry),
        daysLeft: daysUntil(d.tacho_card_expiry)
      },
      emergency: {
        name: d.emergency_contact_name,
        phone: d.emergency_contact_phone
      },
      bank: {
        sortCode: d.bank_sort_code,
        accountNumber: d.bank_account_number
      },

      documents: docs.map(doc => ({
        id: doc.id,
        type: doc.document_type,
        number: doc.document_number,
        expiry: fmtDate(doc.expiry_date),
        expiryTone: expiryTone(doc.expiry_date),
        daysLeft: daysUntil(doc.expiry_date),
        status: doc.verification_status,
        statusTone: verifyTone[doc.verification_status] || "neutral"
      })),

      trips: trips.map(t => ({
        id: t.id,
        code: t.trip_code,
        lane: t.origin_hub && t.destination_hub ? `${t.origin_hub} → ${t.destination_hub}` : "Custom route",
        vehicle: t.registration_number || "—",
        departure: fmtDate(t.planned_departure),
        status: t.dispatch_status,
        statusTone: dispatchTone[t.dispatch_status] || "neutral",
        freight: t.freight_amount_gbp ? `£${Number(t.freight_amount_gbp).toLocaleString("en-GB", { minimumFractionDigits: 2 })}` : "—"
      })),

      shifts: shifts.map(s => ({
        id: s.id,
        start: fmtDateTime(s.shift_start),
        end: fmtDateTime(s.shift_end),
        totalHours: s.total_hours ? `${s.total_hours}h` : "—",
        status: s.status
      }))
    });
  } catch (err) {
    res.status(500).json({ message: "Driver detail error", error: err.message });
  }
};

// POST /api/drivers
exports.createDriver = async (req, res) => {
  const conn = await db.getConnection();
  try {
    await ensureDriverOpsSchema();
    await conn.beginTransaction();

    let {
      full_name, employee_code, phone, home_depot, address, postcode,
      date_of_birth, national_insurance,
      license_number, license_expiry,
      medical_expiry,
      cpc_number, cpc_expiry,
      tacho_card_number, tacho_card_expiry,
      emergency_contact_name, emergency_contact_phone,
      bank_sort_code, bank_account_number,
      assigned_vehicle_id, salary_gbp, commission_rate, internal_score,
      accident_incident_record, penalty_deduction_record,
      onboarding_status, compliance_status,
      email, password
    } = req.body;

    if (!full_name) {
      return res.status(400).json({ message: "Driver name is required." });
    }

    employee_code = employee_code || await nextDriverCode(conn);
    license_number = license_number || "Pending";
    license_expiry = license_expiry || "2099-12-31";
    medical_expiry = medical_expiry || "2099-12-31";

    let userId = null;

    // Create user account if email + password provided
    if (email && password) {
      const bcrypt = require("bcrypt");
      const hash = await bcrypt.hash(password, 10);
      const [uRes] = await conn.query(
        `INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, 'driver')`,
        [full_name, email, hash]
      );
      userId = uRes.insertId;
    }

    const [result] = await conn.query(
      `INSERT INTO drivers
         (user_id, employee_code, full_name, phone, home_depot, address, postcode,
          date_of_birth, national_insurance,
          license_number, license_expiry, medical_expiry,
          cpc_number, cpc_expiry, tacho_card_number, tacho_card_expiry,
          emergency_contact_name, emergency_contact_phone,
          bank_sort_code, bank_account_number,
          assigned_vehicle_id, salary_gbp, commission_rate, internal_score,
          accident_incident_record, penalty_deduction_record,
          onboarding_status, shift_status, compliance_status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        userId,
        employee_code, full_name, phone || null, home_depot || null,
        address || null, postcode || null,
        date_of_birth || null, national_insurance || null,
        license_number, license_expiry, medical_expiry,
        cpc_number || null, cpc_expiry || null,
        tacho_card_number || null, tacho_card_expiry || null,
        emergency_contact_name || null, emergency_contact_phone || null,
        bank_sort_code || null, bank_account_number || null,
        assigned_vehicle_id || null, salary_gbp || null, commission_rate || null, internal_score || null,
        accident_incident_record || null, penalty_deduction_record || null,
        onboarding_status || "new",
        "review",
        compliance_status || "review"
      ]
    );

    await conn.commit();
    await logActivity(req, {
      module: "drivers",
      action: "create",
      entityType: "driver",
      entityId: result.insertId,
      entityLabel: full_name,
      details: { employee_code, compliance_status: compliance_status || "review" }
    });
    res.status(201).json({ message: "Driver created.", id: result.insertId });
  } catch (err) {
    await conn.rollback();
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: "Employee code or email already exists." });
    }
    console.error("Driver create error:", err);
    res.status(500).json({ message: "Driver create error", error: err.message });
  } finally {
    conn.release();
  }
};

// PUT /api/drivers/:id
exports.updateDriver = async (req, res) => {
  try {
    await ensureDriverOpsSchema();
    const { id } = req.params;
    const [[existing]] = await db.query(`SELECT * FROM drivers WHERE id = ?`, [id]);
    if (!existing) return res.status(404).json({ message: "Driver not found." });

    const {
      full_name, employee_code, phone, home_depot, address, postcode,
      date_of_birth, national_insurance,
      license_number, license_expiry, medical_expiry,
      cpc_number, cpc_expiry, tacho_card_number, tacho_card_expiry,
      emergency_contact_name, emergency_contact_phone,
      bank_sort_code, bank_account_number,
      assigned_vehicle_id, salary_gbp, commission_rate, internal_score,
      accident_incident_record, penalty_deduction_record,
      onboarding_status, shift_status, compliance_status
    } = req.body;

    await db.query(
      `UPDATE drivers SET
         full_name=?, employee_code=?, phone=?, home_depot=?, address=?, postcode=?,
         date_of_birth=?, national_insurance=?,
         license_number=?, license_expiry=?, medical_expiry=?,
         cpc_number=?, cpc_expiry=?, tacho_card_number=?, tacho_card_expiry=?,
         emergency_contact_name=?, emergency_contact_phone=?,
         bank_sort_code=?, bank_account_number=?,
         assigned_vehicle_id=?, salary_gbp=?, commission_rate=?, internal_score=?,
         accident_incident_record=?, penalty_deduction_record=?,
         onboarding_status=?, shift_status=?, compliance_status=?
       WHERE id=?`,
      [
        full_name || existing.full_name,
        employee_code || existing.employee_code,
        phone || null,
        home_depot ?? existing.home_depot ?? null,
        address ?? existing.address ?? null,
        postcode ?? existing.postcode ?? null,
        date_of_birth || existing.date_of_birth || null,
        national_insurance ?? existing.national_insurance ?? null,
        license_number || existing.license_number,
        license_expiry || existing.license_expiry,
        medical_expiry || existing.medical_expiry,
        cpc_number || existing.cpc_number || null,
        cpc_expiry || existing.cpc_expiry || null,
        tacho_card_number || existing.tacho_card_number || null,
        tacho_card_expiry || existing.tacho_card_expiry || null,
        emergency_contact_name ?? existing.emergency_contact_name ?? null,
        emergency_contact_phone ?? existing.emergency_contact_phone ?? null,
        bank_sort_code ?? existing.bank_sort_code ?? null,
        bank_account_number ?? existing.bank_account_number ?? null,
        assigned_vehicle_id ?? existing.assigned_vehicle_id ?? null,
        salary_gbp ?? existing.salary_gbp ?? null,
        commission_rate ?? existing.commission_rate ?? null,
        internal_score ?? existing.internal_score ?? null,
        accident_incident_record ?? existing.accident_incident_record ?? null,
        penalty_deduction_record ?? existing.penalty_deduction_record ?? null,
        onboarding_status || existing.onboarding_status || "new",
        shift_status || existing.shift_status || "review",
        compliance_status || existing.compliance_status || "review",
        id
      ]
    );

    const [[updated]] = await db.query(`SELECT * FROM drivers WHERE id = ?`, [id]);
    await logActivity(req, {
      module: "drivers",
      action: "update",
      entityType: "driver",
      entityId: id,
      entityLabel: updated.full_name,
      details: { changes: buildChangeSet(existing, updated, ["full_name", "employee_code", "phone", "home_depot", "license_number", "license_expiry", "medical_expiry", "assigned_vehicle_id", "salary_gbp", "commission_rate", "internal_score", "accident_incident_record", "penalty_deduction_record", "onboarding_status", "shift_status", "compliance_status"]) }
    });
    res.json({ message: "Driver updated." });
  } catch (err) {
    console.error("Driver update error:", err);
    res.status(500).json({ message: "Driver update error", error: err.message });
  }
};

// DELETE /api/drivers/:id
exports.deleteDriver = async (req, res) => {
  const conn = await db.getConnection();
  try {
    const { id } = req.params;

    const [[driver]] = await conn.query(`SELECT id, user_id, full_name, employee_code FROM drivers WHERE id = ?`, [id]);
    if (!driver) return res.status(404).json({ message: "Driver not found." });

    await conn.beginTransaction();
    await conn.query(`UPDATE trips SET driver_id = NULL WHERE driver_id = ?`, [id]);
    await conn.query(`DELETE FROM drivers WHERE id = ?`, [id]);
    await conn.commit();

    await logActivity(req, { module: "drivers", action: "delete", entityType: "driver", entityId: id, entityLabel: driver.full_name, details: { employee_code: driver.employee_code } });
    res.json({ message: "Driver deleted." });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ message: "Driver delete error", error: err.message });
  } finally {
    conn.release();
  }
};

// POST /api/drivers/:id/documents
exports.addDocument = async (req, res) => {
  try {
    const { id } = req.params;
    const { document_type, document_number, expiry_date, verification_status } = req.body;

    if (!document_type || !expiry_date) {
      return res.status(400).json({ message: "document_type and expiry_date are required." });
    }

    const days = daysUntil(expiry_date);
    const autoStatus = days < 0 ? "expired" : days < 30 ? "expiring" : verification_status || "pending";

    const [result] = await db.query(
      `INSERT INTO driver_documents (driver_id, document_type, document_number, expiry_date, verification_status)
       VALUES (?, ?, ?, ?, ?)`,
      [id, document_type, document_number || "", expiry_date, autoStatus]
    );

    await logActivity(req, { module: "drivers", action: "create", entityType: "driver_document", entityId: result.insertId, entityLabel: document_type, details: { driver_id: id, expiry_date } });
    res.status(201).json({ message: "Document added.", id: result.insertId });
  } catch (err) {
    res.status(500).json({ message: "Document add error", error: err.message });
  }
};

// PUT /api/drivers/:id/documents/:docId
exports.updateDocument = async (req, res) => {
  try {
    const { id, docId } = req.params;
    const { document_type, document_number, expiry_date, verification_status } = req.body;

    const days = daysUntil(expiry_date);
    const autoStatus = days !== null && days < 0 ? "expired" : days < 30 ? "expiring" : verification_status || "pending";

    await db.query(
      `UPDATE driver_documents SET document_type=?, document_number=?, expiry_date=?, verification_status=?
       WHERE id=? AND driver_id=?`,
      [document_type, document_number || "", expiry_date, autoStatus, docId, id]
    );

    await logActivity(req, { module: "drivers", action: "update", entityType: "driver_document", entityId: docId, entityLabel: document_type, details: { driver_id: id, expiry_date } });
    res.json({ message: "Document updated." });
  } catch (err) {
    res.status(500).json({ message: "Document update error", error: err.message });
  }
};

// DELETE /api/drivers/:id/documents/:docId
exports.deleteDocument = async (req, res) => {
  try {
    const { id, docId } = req.params;
    await db.query(`DELETE FROM driver_documents WHERE id=? AND driver_id=?`, [docId, id]);
    await logActivity(req, { module: "drivers", action: "delete", entityType: "driver_document", entityId: docId, details: { driver_id: id } });
    res.json({ message: "Document removed." });
  } catch (err) {
    res.status(500).json({ message: "Document delete error", error: err.message });
  }
};
