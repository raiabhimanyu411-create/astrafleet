const db = require("../db/connection");
const { emitDriverChatMessage, emitDriverJobAssigned, emitJobUpdate } = require("../realtime");
const { logActivity, requireDeleteReason } = require("../utils/auditLogger");
const { getSettingsMap } = require("./settingsController");

function fmtDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}
function fmtDateTime(d) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
function fmtAmount(n) {
  if (n == null) return "—";
  return `£${Number(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function rawDateTime(d) {
  if (!d) return "";
  const date = new Date(d);
  const offsetMs = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
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

let driverOpsSchemaReady = false;
let softDeleteSchemaReady = false;
let jobCostSchemaReady = false;

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
  await addColumnIfMissing("trips", "loading_done_time", "DATETIME DEFAULT NULL");
  await addColumnIfMissing("trips", "unloading_duration_mins", "INT DEFAULT 120");
  await addColumnIfMissing("trips", "calculated_arrival", "DATETIME DEFAULT NULL");
  await addColumnIfMissing("trips", "calculated_unload_end", "DATETIME DEFAULT NULL");
  await addColumnIfMissing("trips", "total_job_duration_mins", "INT DEFAULT NULL");
  jobCostSchemaReady = true;
}

function calcJobEconomics(distanceKm, totalJobMins, settings) {
  if (!distanceKm || !settings) return null;
  const distanceMiles = distanceKm * 0.621371;
  const fuelCostPerMile = (4.546 / settings.mpg) * settings.fuel_price_per_litre;
  const fuelCost = distanceMiles * fuelCostPerMile;
  const totalHours = (totalJobMins || 0) / 60;
  const driverCost = totalHours * settings.driver_rate_per_hour;
  const totalCost = fuelCost + driverCost;
  const suggestedPrice = totalCost * (1 + settings.margin_pct / 100);
  return {
    distanceMiles: Math.round(distanceMiles * 10) / 10,
    fuelCostPerMile: Math.round(fuelCostPerMile * 100) / 100,
    fuelCost: Math.round(fuelCost * 100) / 100,
    driverCost: Math.round(driverCost * 100) / 100,
    totalCost: Math.round(totalCost * 100) / 100,
    suggestedPrice: Math.round(suggestedPrice * 100) / 100,
    totalHours: Math.round(totalHours * 100) / 100
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
       FROM drivers WHERE compliance_status != 'blocked' ORDER BY shift_status='ready' DESC, full_name ASC`
    );
    const [vehicles] = await db.query(
      `SELECT id, registration_number, fleet_code, model_name, truck_type, status, capacity_tonnes
       FROM vehicles WHERE status IN ('available','planned') ORDER BY status='available' DESC, registration_number ASC`
    );
    const [routes] = await db.query(
      `SELECT id, route_code, origin_hub, destination_hub, distance_km, standard_eta_hours, toll_estimate_gbp
       FROM routes WHERE status IN ('approved','active') ORDER BY origin_hub ASC`
    );
    const [trailers] = await db.query(
      `SELECT id, trailer_code, registration_number, trailer_type, capacity_tonnes, status
       FROM trailers WHERE status IN ('available','planned') ORDER BY status='available' DESC, trailer_code ASC`
    );

    res.json({ customers, drivers, vehicles, trailers, routes });
  } catch (err) {
    res.status(500).json({ message: "Form data error", error: err.message });
  }
};

// GET /api/jobs
exports.listJobs = async (req, res) => {
  try {
    await ensureDriverOpsSchema();
    await ensureJobCostSchema();

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
        COALESCE(SUM(eta IS NOT NULL AND eta < NOW() AND dispatch_status IN ('planned','loading','active')), 0) as eta_risk,
        COALESCE(SUM(freight_amount_gbp), 0) as booked_value
       FROM trips
       WHERE deleted_at IS NULL`
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
              t.planned_departure, t.eta, t.delivery_deadline, t.actual_departure, t.actual_arrival,
              t.dock_window, t.freight_amount_gbp, t.load_type, t.load_weight_kg, t.load_volume_cbm,
              t.vehicle_type_requirement, t.load_description, t.special_instructions, t.dispatcher_notes,
              t.pod_status, t.pickup_address, t.drop_address, t.client_phone, t.created_at, t.cancellation_reason,
              t.loading_done_time, t.unloading_duration_mins, t.calculated_arrival,
              t.calculated_unload_end, t.total_job_duration_mins,
              c.company_name as customer_name, c.contact_name as customer_contact, c.phone as customer_phone,
              r.route_code, r.origin_hub, r.destination_hub, r.distance_km, r.standard_eta_hours,
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
      `SELECT id, full_name, employee_code, phone, shift_status, compliance_status
       FROM drivers
       WHERE compliance_status != 'blocked'
       ORDER BY shift_status='ready' DESC, full_name ASC`
    );
    const [vehicles] = await db.query(
      `SELECT id, registration_number, fleet_code, model_name, truck_type, status, capacity_tonnes
       FROM vehicles
       WHERE status != 'stopped'
       ORDER BY registration_number ASC`
    );
    const [trailers] = await db.query(
      `SELECT id, trailer_code, registration_number, trailer_type, capacity_tonnes, status
       FROM trailers
       WHERE status != 'maintenance'
       ORDER BY trailer_code ASC`
    );

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
      jobs: rows.map(r => {
        const econ = calcJobEconomics(r.distance_km, r.total_job_duration_mins, settings);
        const freightValue = Number(r.freight_amount_gbp || 0);
        const profitLossValue = econ ? freightValue - econ.totalCost : null;
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
          etaHours: r.standard_eta_hours,
          driver: r.driver_name || "Unassigned",
          driverPhone: r.driver_phone || "—",
          driverEmployeeCode: r.employee_code || "—",
          driverAssigned: Boolean(r.driver_name),
          driverJobStatus: r.driver_job_status || "—",
          vehicle: r.registration_number || "Unassigned",
          vehicleFleetCode: r.fleet_code || "—",
          vehicleModel: r.model_name || "—",
          vehicleType: r.truck_type || "—",
          vehicleAssigned: Boolean(r.registration_number),
          trailer: r.trailer_registration || "Unassigned",
          trailerCode: r.trailer_code || "—",
          trailerType: r.trailer_type || "—",
          trailerAssigned: Boolean(r.trailer_registration),
          departure: fmtDate(r.planned_departure),
          departureRaw: rawDateTime(r.planned_departure),
          eta: fmtDate(r.eta),
          etaRaw: rawDateTime(r.eta),
          deadline: fmtDateTime(r.delivery_deadline),
          deadlineRaw: rawDateTime(r.delivery_deadline),
          actualDeparture: fmtDateTime(r.actual_departure),
          actualArrival: fmtDateTime(r.actual_arrival),
          actualArrivalRaw: rawDateTime(r.actual_arrival),
          etaRisk: r.eta && new Date(r.eta).getTime() < Date.now() && ["planned", "loading", "active"].includes(r.dispatch_status),
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
          cancellationReason: r.cancellation_reason || "",
          loadingDoneTime: rawDateTime(r.loading_done_time),
          unloadingDurationMins: r.unloading_duration_mins || 120,
          calculatedArrival: rawDateTime(r.calculated_arrival),
          calculatedUnloadEnd: rawDateTime(r.calculated_unload_end),
          totalJobDurationMins: r.total_job_duration_mins,
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

    const { id } = req.params;
    const driverId = req.body.driver_id || req.body.driverId || null;
    const vehicleId = req.body.vehicle_id || req.body.vehicleId || null;
    const trailerId = req.body.trailer_id || req.body.trailerId || null;
    const hasFreight = Object.prototype.hasOwnProperty.call(req.body, "freight_amount") || Object.prototype.hasOwnProperty.call(req.body, "freightAmount");
    const freightAmount = hasFreight ? (req.body.freight_amount ?? req.body.freightAmount) : undefined;
    const priorityLevel = req.body.priority_level || req.body.priorityLevel || null;

    const [[job]] = await db.query(
      `SELECT id, trip_code, driver_id, vehicle_id, trailer_id, freight_amount_gbp, priority_level
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
    }
    if (vehicleId) {
      const [[vehicle]] = await db.query(`SELECT id FROM vehicles WHERE id = ? AND status != 'stopped'`, [vehicleId]);
      if (!vehicle) return res.status(400).json({ message: "Selected truck is not available for assignment." });
    }
    if (trailerId) {
      const [[trailer]] = await db.query(`SELECT id FROM trailers WHERE id = ? AND status != 'maintenance'`, [trailerId]);
      if (!trailer) return res.status(400).json({ message: "Selected trailer is not available for assignment." });
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

    if (driverChanged && driverId) {
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

    emitJobUpdate({ jobId: Number(id), source: "admin-planner" });

    res.json({ message: "Job updated from planner." });
  } catch (err) {
    res.status(500).json({ message: "Planner update error", error: err.message });
  }
};

// GET /api/jobs/:id
exports.getJobById = async (req, res) => {
  try {
    await ensureDriverOpsSchema();
    await ensureSoftDeleteSchema();
    await ensureJobCostSchema();

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
              r.route_code, r.origin_hub, r.destination_hub, r.distance_km, r.standard_eta_hours, r.toll_estimate_gbp,
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

    const [stops] = await db.query(
      `SELECT * FROM job_stops WHERE trip_id = ? ORDER BY stop_order ASC`, [id]
    );
    const [expenses] = await db.query(
      `SELECT e.*, d.full_name
       FROM driver_expenses e
       LEFT JOIN drivers d ON d.id = e.driver_id
       WHERE e.trip_id = ?
       ORDER BY e.expense_at DESC`,
      [id]
    );
    const [defects] = t.vehicle_id ? await db.query(
      `SELECT * FROM defect_reports
       WHERE vehicle_id = ?
       ORDER BY reported_at DESC LIMIT 8`,
      [t.vehicle_id]
    ) : [[]];

    const stopStatusTone = { pending: "neutral", arrived: "warning", completed: "success", skipped: "danger" };
    const driverStatus = t.driver_job_status || "accepted";

    res.json({
      id: t.id,
      code: t.trip_code,
      status: t.dispatch_status,
      statusTone: dispatchTone[t.dispatch_status] || "neutral",
      priority: t.priority_level,
      priorityTone: priorityTone[t.priority_level] || "neutral",
      podStatus: t.pod_status,
      delayReason: t.delay_reason,
      cancellationReason: t.cancellation_reason,
      failedDeliveryReason: t.failed_delivery_reason,
      specialInstructions: t.special_instructions,
      form: {
        customer_id: t.customer_id,
        route_id: t.route_id,
        driver_id: t.driver_id,
        vehicle_id: t.vehicle_id,
        trailer_id: t.trailer_id,
        planned_departure: t.planned_departure ? new Date(t.planned_departure).toISOString().slice(0, 16) : "",
        delivery_deadline: t.delivery_deadline ? new Date(t.delivery_deadline).toISOString().slice(0, 16) : ""
      },
      driverExecution: {
        status: driverStatus,
        statusLabel: driverStatusLabel[driverStatus] || driverStatus,
        statusTone: driverStatusTone[driverStatus] || "neutral",
        deliveryNotes: t.delivery_notes || "—",
        failedDeliveryReason: t.failed_delivery_reason || "—"
      },
      proofOfDelivery: {
        status: t.pod_status,
        signatureData: t.pod_signature_data || "",
        photoData: t.pod_photo_data || "",
        deliveryNotes: t.delivery_notes || ""
      },

      customer: t.company_name ? {
        name: t.company_name,
        contact: t.cust_contact,
        email: t.cust_email,
        phone: t.cust_phone
      } : { name: t.client_name || "—", phone: t.client_phone || "—" },

      route: {
        code: t.route_code,
        from: t.origin_hub || t.pickup_address,
        to: t.destination_hub || t.drop_address,
        pickupAddress: t.pickup_address,
        dropAddress: t.drop_address,
        distanceKm: t.distance_km,
        etaHours: t.standard_eta_hours,
        tollEstimate: fmtAmount(t.toll_estimate_gbp)
      },

      schedule: {
        plannedDeparture: fmtDateTime(t.planned_departure),
        eta: fmtDateTime(t.eta),
        actualDeparture: fmtDateTime(t.actual_departure),
        actualArrival: fmtDateTime(t.actual_arrival),
        deliveryDeadline: fmtDateTime(t.delivery_deadline),
        dockWindow: t.dock_window || "—"
      },

      load: {
        type: t.load_type || "general",
        weightKg: t.load_weight_kg ? `${t.load_weight_kg} kg` : "—",
        volumeCbm: t.load_volume_cbm ? `${t.load_volume_cbm} cbm` : "—",
        vehicleRequirement: t.vehicle_type_requirement || "—",
        description: t.load_description || "—",
        freight: fmtAmount(t.freight_amount_gbp),
        freightValue: Number(t.freight_amount_gbp || 0)
      },
      dispatcherNotes: t.dispatcher_notes || "—",

      timing: {
        loadingDoneTime: t.loading_done_time ? new Date(t.loading_done_time).toISOString().slice(0, 16) : "",
        unloadingDurationMins: t.unloading_duration_mins || 120,
        calculatedArrival: rawDateTime(t.calculated_arrival),
        calculatedUnloadEnd: rawDateTime(t.calculated_unload_end),
        totalJobDurationMins: t.total_job_duration_mins
      },

      economics: (() => {
        const econ = calcJobEconomics(t.distance_km, t.total_job_duration_mins, settings);
        if (!econ) return null;
        const freightValue = Number(t.freight_amount_gbp || 0);
        const profitLossValue = freightValue - econ.totalCost;
        return {
          ...econ,
          freightValue,
          profitLossValue,
          profitLoss: fmtAmount(Math.abs(profitLossValue)),
          isProfitable: profitLossValue >= 0,
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
        actualArrival: fmtDateTime(s.actual_arrival),
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
    await conn.beginTransaction();

    const {
      customer_id, client_name, client_phone,
      route_id, pickup_address, drop_address,
      planned_departure, dock_window,
      load_type, load_weight_kg, load_volume_cbm, vehicle_type_requirement, delivery_deadline, load_description,
      freight_amount, priority_level, special_instructions,
      driver_id, vehicle_id, trailer_id, dispatcher_notes,
      loading_done_time, unloading_duration_mins,
      calculated_arrival, calculated_unload_end, total_job_duration_mins,
      stops = []
    } = req.body;

    let resolvedClientName = client_name || null;
    if (customer_id && !resolvedClientName) {
      const [[customer]] = await conn.query(`SELECT company_name FROM customers WHERE id = ?`, [customer_id]);
      resolvedClientName = customer?.company_name || null;
    }

    if (!customer_id && !resolvedClientName) {
      await conn.rollback();
      return res.status(400).json({ message: "Select a customer or enter a client name." });
    }

    let eta = null;
    if (route_id && planned_departure) {
      const [[route]] = await conn.query(`SELECT standard_eta_hours FROM routes WHERE id = ?`, [route_id]);
      if (route) {
        eta = new Date(new Date(planned_departure).getTime() + route.standard_eta_hours * 3600 * 1000);
      }
    }

    const jobCode = `JOB-${Date.now().toString().slice(-7)}`;

    const [result] = await conn.query(
      `INSERT INTO trips
         (trip_code, customer_id, client_name, client_phone, route_id, vehicle_id, trailer_id, driver_id,
          pickup_address, drop_address, dispatch_status, priority_level,
          planned_departure, eta, dock_window, pod_status,
          load_type, load_weight_kg, load_volume_cbm, vehicle_type_requirement, delivery_deadline,
          load_description, freight_amount_gbp, special_instructions, dispatcher_notes,
          driver_job_status,
          loading_done_time, unloading_duration_mins, calculated_arrival, calculated_unload_end, total_job_duration_mins)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'planned', ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        eta,
        dock_window || null,
        load_type || "general",
        load_weight_kg || null,
        load_volume_cbm || null,
        vehicle_type_requirement || null,
        delivery_deadline || null,
        load_description || null,
        freight_amount || null,
        special_instructions || null,
        dispatcher_notes || null,
        driver_id ? "offered" : null,
        loading_done_time || null,
        unloading_duration_mins ? Number(unloading_duration_mins) : 120,
        calculated_arrival || null,
        calculated_unload_end || null,
        total_job_duration_mins ? Number(total_job_duration_mins) : null
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
        `INSERT INTO job_stops (trip_id, stop_order, stop_type, address, contact_name, contact_phone, planned_arrival, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [jobId, i + 1, s.stop_type || "delivery", s.address, s.contact_name || null, s.contact_phone || null, s.planned_arrival || null, s.notes || null]
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
    await conn.beginTransaction();
    const { id } = req.params;

    const [[existing]] = await conn.query(`SELECT id, vehicle_id, trailer_id, driver_id FROM trips WHERE id = ? AND deleted_at IS NULL`, [id]);
    if (!existing) {
      await conn.rollback();
      return res.status(404).json({ message: "Job not found." });
    }

    const {
      customer_id, client_name, client_phone,
      route_id, pickup_address, drop_address,
      planned_departure, dock_window,
      load_type, load_weight_kg, load_volume_cbm, vehicle_type_requirement, delivery_deadline, load_description,
      freight_amount, priority_level, special_instructions,
      driver_id, vehicle_id, trailer_id, dispatcher_notes,
      loading_done_time, unloading_duration_mins,
      calculated_arrival, calculated_unload_end, total_job_duration_mins,
      stops = []
    } = req.body;

    let resolvedClientName = client_name || null;
    if (customer_id && !resolvedClientName) {
      const [[customer]] = await conn.query(`SELECT company_name FROM customers WHERE id = ?`, [customer_id]);
      resolvedClientName = customer?.company_name || null;
    }

    if (!customer_id && !resolvedClientName) {
      await conn.rollback();
      return res.status(400).json({ message: "Select a customer or enter a client name." });
    }

    let eta = null;
    if (route_id && planned_departure) {
      const [[route]] = await conn.query(`SELECT standard_eta_hours FROM routes WHERE id = ?`, [route_id]);
      if (route) eta = new Date(new Date(planned_departure).getTime() + route.standard_eta_hours * 3600 * 1000);
    }

    // Reset old vehicle if changed
    if (existing.vehicle_id && vehicle_id && String(existing.vehicle_id) !== String(vehicle_id)) {
      await conn.query(`UPDATE vehicles SET status='available' WHERE id=?`, [existing.vehicle_id]);
    }
    if (existing.trailer_id && String(existing.trailer_id) !== String(trailer_id || "")) {
      await conn.query(`UPDATE trailers SET status='available' WHERE id=?`, [existing.trailer_id]);
    }
    if (vehicle_id) {
      await conn.query(
        `UPDATE vehicles
         SET status='planned',
             current_location=IF(? = 1, NULL, current_location),
             speed_kph=IF(? = 1, 0, speed_kph),
             gps_latitude=IF(? = 1, NULL, gps_latitude),
             gps_longitude=IF(? = 1, NULL, gps_longitude),
             gps_accuracy_m=IF(? = 1, NULL, gps_accuracy_m),
             last_ping_at=IF(? = 1, NULL, last_ping_at)
         WHERE id=?`,
        [
          String(existing.vehicle_id || "") !== String(vehicle_id || "") || String(existing.driver_id || "") !== String(driver_id || "") ? 1 : 0,
          String(existing.vehicle_id || "") !== String(vehicle_id || "") || String(existing.driver_id || "") !== String(driver_id || "") ? 1 : 0,
          String(existing.vehicle_id || "") !== String(vehicle_id || "") || String(existing.driver_id || "") !== String(driver_id || "") ? 1 : 0,
          String(existing.vehicle_id || "") !== String(vehicle_id || "") || String(existing.driver_id || "") !== String(driver_id || "") ? 1 : 0,
          String(existing.vehicle_id || "") !== String(vehicle_id || "") || String(existing.driver_id || "") !== String(driver_id || "") ? 1 : 0,
          String(existing.vehicle_id || "") !== String(vehicle_id || "") || String(existing.driver_id || "") !== String(driver_id || "") ? 1 : 0,
          vehicle_id
        ]
      );
    }
    if (trailer_id) {
      await conn.query(`UPDATE trailers SET status='planned' WHERE id=?`, [trailer_id]);
    }

    const valueOrExisting = (key, currentValue, fallback = null) =>
      Object.prototype.hasOwnProperty.call(req.body, key) ? (req.body[key] || fallback) : currentValue;

    await conn.query(
      `UPDATE trips SET
         customer_id=?, client_name=?, client_phone=?, route_id=?, vehicle_id=?, trailer_id=?, driver_id=?,
         pickup_address=?, drop_address=?, priority_level=?,
         planned_departure=?, eta=?, dock_window=?,
         load_type=?, load_weight_kg=?, load_volume_cbm=?, vehicle_type_requirement=?, delivery_deadline=?,
         load_description=?, freight_amount_gbp=?, special_instructions=?, dispatcher_notes=?,
         driver_job_status=IF(? = 1, 'offered', driver_job_status),
         loading_done_time=?, unloading_duration_mins=?,
         calculated_arrival=?, calculated_unload_end=?, total_job_duration_mins=?
       WHERE id=? AND deleted_at IS NULL`,
      [
        customer_id || null, resolvedClientName, client_phone || null, route_id || null,
        vehicle_id || null, trailer_id || null, driver_id || null,
        pickup_address || null, drop_address || null,
        priority_level || "standard",
        planned_departure || null, eta, dock_window || null,
        valueOrExisting("load_type", "general", "general"),
        valueOrExisting("load_weight_kg", null),
        valueOrExisting("load_volume_cbm", null),
        valueOrExisting("vehicle_type_requirement", null),
        delivery_deadline || null,
        load_description || null,
        freight_amount || null,
        valueOrExisting("special_instructions", null),
        valueOrExisting("dispatcher_notes", null),
        String(existing.driver_id || "") !== String(driver_id || "") && driver_id ? 1 : 0,
        loading_done_time || null,
        unloading_duration_mins ? Number(unloading_duration_mins) : 120,
        calculated_arrival || null,
        calculated_unload_end || null,
        total_job_duration_mins ? Number(total_job_duration_mins) : null,
        id
      ]
    );

    // Replace stops
    const [oldStops] = await conn.query(`SELECT id FROM job_stops WHERE trip_id = ?`, [id]);
    await conn.query(`DELETE FROM job_stops WHERE trip_id = ?`, [id]);
    const validStops = stops.filter(s => s.address);
    for (let i = 0; i < validStops.length; i++) {
      const s = validStops[i];
      await conn.query(
        `INSERT INTO job_stops (trip_id, stop_order, stop_type, address, contact_name, contact_phone, planned_arrival, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, i + 1, s.stop_type || "delivery", s.address, s.contact_name || null, s.contact_phone || null, s.planned_arrival || null, s.notes || null]
      );
    }

    // Recalc ETA with stop buffer when route is set
    if (route_id && planned_departure && validStops.length > 0) {
      const [[route]] = await conn.query(`SELECT standard_eta_hours FROM routes WHERE id = ?`, [route_id]);
      if (route) {
        eta = new Date(
          new Date(planned_departure).getTime()
          + route.standard_eta_hours * 3600 * 1000
          + validStops.length * 30 * 60 * 1000
        );
        await conn.query(`UPDATE trips SET eta = ? WHERE id = ? AND deleted_at IS NULL`, [eta, id]);
      }
    }

    // Notify driver if stops changed and driver is assigned
    const stopsChanged = oldStops.length !== validStops.length || validStops.length > 0;
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
      const [[createdMsg]] = await db.query(`SELECT * FROM driver_messages WHERE id = ?`, [msgResult.insertId]);
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
    const { status, reason } = req.body;

    const validStatuses = ["planned", "loading", "active", "blocked", "completed", "failed", "cancelled"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: "Invalid status value." });
    }

    const [[job]] = await db.query(`SELECT id, dispatch_status, vehicle_id, trailer_id FROM trips WHERE id = ? AND deleted_at IS NULL`, [id]);
    if (!job) return res.status(404).json({ message: "Job not found." });

    const updates = { dispatch_status: status };
    if (status === "active")    updates.actual_departure = new Date();
    if (status === "completed") { updates.actual_arrival = new Date(); updates.pod_status = "pending"; }
    if (status === "blocked")   updates.cancellation_reason = reason || null;
    if (status === "failed")    updates.cancellation_reason = reason || null;
    if (status === "cancelled") updates.cancellation_reason = reason || null;

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
    const { address, stop_type, contact_name, contact_phone, planned_arrival, notes } = req.body;

    if (!address?.trim()) return res.status(400).json({ message: "Stop address is required." });

    const [[job]] = await db.query(
      `SELECT t.id, t.trip_code, t.driver_id, t.route_id, t.planned_departure,
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
      `INSERT INTO job_stops (trip_id, stop_order, stop_type, address, contact_name, contact_phone, planned_arrival, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, maxOrder + 1, stop_type || "delivery", address.trim(), contact_name || null, contact_phone || null, planned_arrival || null, notes || null]
    );

    // Recalc ETA: base route ETA + 30 min per stop
    if (job.route_id && job.planned_departure && job.standard_eta_hours != null) {
      const [[{ stopCount }]] = await db.query(
        `SELECT COUNT(*) as stopCount FROM job_stops WHERE trip_id = ?`, [id]
      );
      const newEta = new Date(
        new Date(job.planned_departure).getTime()
        + job.standard_eta_hours * 3600 * 1000
        + stopCount * 30 * 60 * 1000
      );
      await db.query(`UPDATE trips SET eta = ? WHERE id = ?`, [newEta, id]);
    }

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

    const [[stop]] = await db.query(`SELECT id, address FROM job_stops WHERE id = ? AND trip_id = ?`, [stopId, id]);
    if (!stop) return res.status(404).json({ message: "Stop not found." });

    const [[job]] = await db.query(
      `SELECT t.id, t.trip_code, t.driver_id, t.route_id, t.planned_departure,
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

    // Recalc ETA
    if (job.route_id && job.planned_departure && job.standard_eta_hours != null) {
      const [[{ stopCount }]] = await db.query(
        `SELECT COUNT(*) as stopCount FROM job_stops WHERE trip_id = ?`, [id]
      );
      const newEta = new Date(
        new Date(job.planned_departure).getTime()
        + job.standard_eta_hours * 3600 * 1000
        + stopCount * 30 * 60 * 1000
      );
      await db.query(`UPDATE trips SET eta = ? WHERE id = ?`, [newEta, id]);
    }

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
    res.json({ notes });
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
      `INSERT INTO job_notes (job_id, note_text, author_name) VALUES (?, ?, ?)`,
      [id, noteText, authorName]
    );
    res.status(201).json({ message: "Note added.", id: result.insertId });
  } catch (err) {
    res.status(500).json({ message: "Could not add job note.", error: err.message });
  }
};
