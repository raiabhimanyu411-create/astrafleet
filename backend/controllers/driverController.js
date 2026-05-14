const db = require("../db/connection");
const { emitDriverLocationUpdate } = require("../realtime");

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

  await addColumnIfMissing("trips", "driver_job_status", "VARCHAR(40) DEFAULT 'accepted'");
  await addColumnIfMissing("trips", "delivery_notes", "TEXT DEFAULT NULL");
  await addColumnIfMissing("trips", "pod_signature_data", "LONGTEXT DEFAULT NULL");
  await addColumnIfMissing("trips", "pod_photo_data", "LONGTEXT DEFAULT NULL");
  await addColumnIfMissing("trips", "failed_delivery_reason", "TEXT DEFAULT NULL");
  await addColumnIfMissing("trips", "trailer_id", "INT DEFAULT NULL");
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
  return req.query.userId || req.headers["x-user-id"] || req.body?.userId;
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

function mapDriverJob(row) {
  const status = row.driver_job_status || "accepted";
  const pickup = row.pickup_address || row.origin_hub || "Pickup TBD";
  const drop = row.drop_address || row.destination_hub || "Drop TBD";
  const navQuery = encodeURIComponent(`${pickup} to ${drop}`);

  return {
    id: row.id,
    code: row.trip_code,
    status,
    statusLabel: driverStatusLabel[status] || status,
    statusTone: driverStatusTone[status] || "neutral",
    dispatchStatus: row.dispatch_status,
    priority: row.priority_level,
    customer: {
      name: row.customer_name || "Customer TBD",
      contact: row.cust_contact || "—",
      phone: row.cust_phone || "—",
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
      dockWindow: row.dock_window || "—"
    },
    vehicle: row.registration_number ? `${row.registration_number} · ${row.model_name || row.truck_type || "Vehicle"}` : "Unassigned",
    trailer: row.trailer_registration ? `${row.trailer_registration} · ${row.trailer_type || row.trailer_code || "Trolley"}` : "No trolley assigned",
    load: {
      type: row.load_type || "general",
      weight: row.load_weight_kg ? `${row.load_weight_kg} kg` : "—",
      description: row.load_description || "—"
    },
    podStatus: row.pod_status,
    deliveryNotes: row.delivery_notes || "",
    specialInstructions: row.special_instructions || "—"
  };
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
  return rows.map(mapDriverJob);
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

    const [[job]] = await db.query(`SELECT id, vehicle_id FROM trips WHERE id = ? AND driver_id = ?`, [jobId, driver.id]);
    if (!job) return res.status(404).json({ message: "Assigned job not found." });

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
    const [[job]] = await db.query(`SELECT id FROM trips WHERE id = ? AND driver_id = ?`, [jobId, driver.id]);
    if (!job) return res.status(404).json({ message: "Assigned job not found." });

    await db.query(
      `UPDATE trips
       SET pod_signature_data=?, pod_photo_data=?, delivery_notes=?, pod_status='uploaded', driver_job_status='delivered', dispatch_status='completed', actual_arrival=COALESCE(actual_arrival, ?)
       WHERE id=? AND driver_id=?`,
      [signatureData || null, photoData || null, deliveryNotes || null, new Date(), jobId, driver.id]
    );

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

    const { tripId, expenseType, amount, notes, receiptData } = req.body;
    if (!amount) return res.status(400).json({ message: "Expense amount is required." });
    const allowedCategory = ["fuel", "toll", "parking", "repair", "meal", "other"].includes(expenseType) ? expenseType : "other";

    const [result] = await db.query(
      `INSERT INTO driver_expenses
         (driver_id, trip_id, expense_type, amount_gbp, notes, receipt_data)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [driver.id, tripId || null, allowedCategory, amount, notes || null, receiptData || null]
    );
    await createControlRoomAlert({
      title: `Driver expense submitted`,
      description: `${driver.full_name} submitted ${expenseType || "fuel"} expense for £${amount}.`,
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
        [targetVehicleId, driver.id, targetTripId, defectType || "Driver report", description || "Driver submitted a vehicle defect report.", severity || "medium", driver.full_name]
      );
      defectId = result.insertId;
    }

    await createControlRoomAlert({
      title: `Driver defect report`,
      description: `${driver.full_name}: ${description || defectType || "Vehicle defect reported."}`,
      severity: severity || "medium",
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
    if (!readingKm) return res.status(400).json({ message: "Odometer reading is required." });

    let vehicleId = null;
    if (tripId) {
      const [[t]] = await db.query(`SELECT vehicle_id FROM trips WHERE id=? AND driver_id=?`, [tripId, driver.id]);
      vehicleId = t?.vehicle_id || null;
    }

    const [result] = await db.query(
      `INSERT INTO driver_odometer_logs (driver_id, trip_id, vehicle_id, reading_km, log_type) VALUES (?, ?, ?, ?, ?)`,
      [driver.id, tripId || null, vehicleId, readingKm, logType || "start"]
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
    if (!eta) return res.status(400).json({ message: "ETA is required." });

    const [[job]] = await db.query(`SELECT id FROM trips WHERE id=? AND driver_id=?`, [jobId, driver.id]);
    if (!job) return res.status(404).json({ message: "Assigned job not found." });

    await db.query(`UPDATE trips SET eta=? WHERE id=? AND driver_id=?`, [new Date(eta), jobId, driver.id]);
    res.json({ message: "ETA updated successfully." });
  } catch (err) {
    res.status(500).json({ message: "ETA update error", error: err.message });
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
    await db.query(`UPDATE driver_messages SET is_read=1 WHERE driver_id=? AND is_read=0`, [driver.id]);

    const unreadCount = messages.filter(m => !m.is_read).length;
    res.json({
      unreadCount,
      messages: messages.map(m => ({
        id: m.id,
        senderRole: m.sender_role,
        senderName: m.sender_name || (m.sender_role === "driver" ? driver.full_name : "Dispatch"),
        body: m.body,
        tripId: m.trip_id,
        isRead: Boolean(m.is_read),
        at: fmtDateTime(m.sent_at)
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

    res.status(201).json({ message: "Message sent to dispatch.", id: result.insertId });
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
    if (!newDate) return res.status(400).json({ message: "New delivery date is required." });

    const [[job]] = await db.query(
      `SELECT id, vehicle_id FROM trips WHERE id=? AND driver_id=? AND driver_job_status='failed_delivery'`,
      [jobId, driver.id]
    );
    if (!job) return res.status(404).json({ message: "Failed delivery job not found." });

    await db.query(
      `UPDATE trips SET planned_departure=?, driver_job_status='accepted', dispatch_status='planned',
       failed_delivery_reason=CONCAT(COALESCE(failed_delivery_reason,''), ' | Rescheduled: ', ?)
       WHERE id=? AND driver_id=?`,
      [new Date(newDate), reason || "Driver rescheduled", jobId, driver.id]
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
       WHERE t.driver_id = ? AND DATE(t.planned_departure) = ? AND t.driver_job_status = 'accepted'
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
    const [[counts]] = await db.query(
      `SELECT COUNT(*) as total,
        SUM(shift_status='ready')           as ready,
        SUM(shift_status='on_trip')         as on_trip,
        SUM(compliance_status='blocked')    as blocked,
        SUM(compliance_status='review')     as review,
        SUM(onboarding_status IN ('new','docs_pending')) as onboarding
       FROM drivers`
    );

    const [rows] = await db.query(
      `SELECT d.id, d.employee_code, d.full_name, d.phone, d.home_depot,
              d.license_number, d.license_expiry, d.medical_expiry,
              d.cpc_number, d.cpc_expiry, d.tacho_card_number, d.tacho_card_expiry,
              d.onboarding_status, d.shift_status, d.compliance_status,
              d.created_at,
              u.email,
              COUNT(DISTINCT t.id)  AS total_trips,
              COUNT(DISTINCT dd.id) AS total_docs
       FROM drivers d
       LEFT JOIN users         u  ON d.user_id  = u.id
       LEFT JOIN trips         t  ON t.driver_id = d.id
       LEFT JOIN driver_documents dd ON dd.driver_id = d.id
       GROUP BY d.id
       ORDER BY d.created_at DESC`
    );

    const complianceTone = { clear: "success", review: "warning", blocked: "danger" };
    const shiftTone      = { ready: "success", on_trip: "warning", rest: "neutral", review: "danger" };

    res.json({
      stats: [
        { label: "Total drivers",    value: counts.total,      tone: "neutral" },
        { label: "Ready for dispatch", value: counts.ready,    tone: "success" },
        { label: "On trip",          value: counts.on_trip,    tone: "warning" },
        { label: "Blocked / review", value: Number(counts.blocked) + Number(counts.review), tone: "danger" }
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
        licenceExpiryTone: expiryTone(r.license_expiry),
        medicalExpiry: fmtDate(r.medical_expiry),
        medicalExpiryTone: expiryTone(r.medical_expiry),
        cpcExpiry: fmtDate(r.cpc_expiry),
        cpcExpiryTone: expiryTone(r.cpc_expiry),
        onboardingStatus: r.onboarding_status,
        shiftStatus: r.shift_status,
        shiftTone: shiftTone[r.shift_status] || "neutral",
        complianceStatus: r.compliance_status,
        complianceTone: complianceTone[r.compliance_status] || "neutral",
        totalTrips: r.total_trips,
        totalDocs: r.total_docs,
        since: fmtDate(r.created_at)
      }))
    });
  } catch (err) {
    res.status(500).json({ message: "Driver list error", error: err.message });
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
    await conn.beginTransaction();

    const {
      full_name, employee_code, phone, home_depot, address, postcode,
      date_of_birth, national_insurance,
      license_number, license_expiry,
      medical_expiry,
      cpc_number, cpc_expiry,
      tacho_card_number, tacho_card_expiry,
      emergency_contact_name, emergency_contact_phone,
      bank_sort_code, bank_account_number,
      onboarding_status, compliance_status,
      email, password
    } = req.body;

    if (!full_name || !employee_code || !license_number || !license_expiry || !medical_expiry) {
      return res.status(400).json({ message: "full_name, employee_code, license_number, license_expiry, and medical_expiry are required." });
    }

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
          onboarding_status, shift_status, compliance_status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
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
        onboarding_status || "new",
        "review",
        compliance_status || "review"
      ]
    );

    await conn.commit();
    res.status(201).json({ message: "Driver created.", id: result.insertId });
  } catch (err) {
    await conn.rollback();
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: "Employee code or email already exists." });
    }
    res.status(500).json({ message: "Driver create error", error: err.message });
  } finally {
    conn.release();
  }
};

// PUT /api/drivers/:id
exports.updateDriver = async (req, res) => {
  try {
    const { id } = req.params;
    const [[existing]] = await db.query(`SELECT id FROM drivers WHERE id = ?`, [id]);
    if (!existing) return res.status(404).json({ message: "Driver not found." });

    const {
      full_name, employee_code, phone, home_depot, address, postcode,
      date_of_birth, national_insurance,
      license_number, license_expiry, medical_expiry,
      cpc_number, cpc_expiry, tacho_card_number, tacho_card_expiry,
      emergency_contact_name, emergency_contact_phone,
      bank_sort_code, bank_account_number,
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
         onboarding_status=?, shift_status=?, compliance_status=?
       WHERE id=?`,
      [
        full_name, employee_code, phone || null, home_depot || null,
        address || null, postcode || null,
        date_of_birth || null, national_insurance || null,
        license_number, license_expiry, medical_expiry,
        cpc_number || null, cpc_expiry || null,
        tacho_card_number || null, tacho_card_expiry || null,
        emergency_contact_name || null, emergency_contact_phone || null,
        bank_sort_code || null, bank_account_number || null,
        onboarding_status || "new",
        shift_status || "review",
        compliance_status || "review",
        id
      ]
    );

    res.json({ message: "Driver updated." });
  } catch (err) {
    res.status(500).json({ message: "Driver update error", error: err.message });
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
    res.json({ message: "Document removed." });
  } catch (err) {
    res.status(500).json({ message: "Document delete error", error: err.message });
  }
};
