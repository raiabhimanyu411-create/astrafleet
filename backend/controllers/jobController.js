const db = require("../db/connection");

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

// GET /api/jobs/form-data
exports.getFormData = async (req, res) => {
  try {
    await ensureDriverOpsSchema();

    const [customers] = await db.query(
      `SELECT id, company_name, contact_name, phone, email FROM customers WHERE account_status='active' ORDER BY company_name ASC`
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

    const { status, priority, customer_id, search } = req.query;

    const [[counts]] = await db.query(
      `SELECT COUNT(*) as total,
        SUM(dispatch_status='active')    as active,
        SUM(dispatch_status='planned')   as planned,
        SUM(dispatch_status='completed') as completed,
        SUM(dispatch_status='blocked')   as blocked,
        SUM(dispatch_status='loading')   as loading
       FROM trips`
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

    const [rows] = await db.query(
      `SELECT t.id, t.trip_code, t.client_name, t.dispatch_status, t.priority_level,
              t.planned_departure, t.eta, t.freight_amount_gbp, t.load_type, t.load_weight_kg,
              t.pod_status, t.pickup_address, t.drop_address, t.created_at,
              c.company_name as customer_name,
              r.origin_hub, r.destination_hub,
              d.full_name as driver_name,
              v.registration_number,
              tr.registration_number AS trailer_registration,
              COUNT(DISTINCT js.id) as stop_count
       FROM trips t
       LEFT JOIN customers c  ON t.customer_id = c.id
       LEFT JOIN routes    r  ON t.route_id    = r.id
       LEFT JOIN drivers   d  ON t.driver_id   = d.id
       LEFT JOIN vehicles  v  ON t.vehicle_id  = v.id
       LEFT JOIN trailers  tr ON t.trailer_id  = tr.id
       LEFT JOIN job_stops js ON js.trip_id    = t.id
       WHERE ${where.join(" AND ")}
       GROUP BY t.id
       ORDER BY t.created_at DESC`,
      params
    );

    res.json({
      stats: [
        { label: "Total jobs",  value: counts.total,     tone: "neutral" },
        { label: "Active",      value: counts.active,    tone: "success" },
        { label: "Planned",     value: counts.planned,   tone: "warning" },
        { label: "Completed",   value: counts.completed, tone: "neutral" }
      ],
      jobs: rows.map(r => ({
        id: r.id,
        code: r.trip_code,
        customer: r.customer_name || r.client_name || "—",
        lane: r.origin_hub && r.destination_hub ? `${r.origin_hub} → ${r.destination_hub}` : (r.pickup_address ? "Custom route" : "Route TBD"),
        driver: r.driver_name || "Unassigned",
        vehicle: r.registration_number || "Unassigned",
        trailer: r.trailer_registration || "Unassigned",
        departure: fmtDate(r.planned_departure),
        freight: fmtAmount(r.freight_amount_gbp),
        loadType: r.load_type || "general",
        status: r.dispatch_status,
        statusTone: dispatchTone[r.dispatch_status] || "neutral",
        priority: r.priority_level,
        priorityTone: priorityTone[r.priority_level] || "neutral",
        podStatus: r.pod_status,
        stopCount: r.stop_count
      }))
    });
  } catch (err) {
    res.status(500).json({ message: "Job list error", error: err.message });
  }
};

// GET /api/jobs/:id
exports.getJobById = async (req, res) => {
  try {
    await ensureDriverOpsSchema();

    const { id } = req.params;

    const [[t]] = await db.query(
      `SELECT t.*,
              c.company_name, c.contact_name as cust_contact, c.email as cust_email, c.phone as cust_phone,
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
       WHERE t.id = ?`,
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
        planned_departure: t.planned_departure ? new Date(t.planned_departure).toISOString().slice(0, 16) : ""
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
      } : { name: t.client_name || "—" },

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
        dockWindow: t.dock_window || "—"
      },

      load: {
        type: t.load_type || "general",
        weightKg: t.load_weight_kg ? `${t.load_weight_kg} kg` : "—",
        description: t.load_description || "—",
        freight: fmtAmount(t.freight_amount_gbp)
      },

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
    await conn.beginTransaction();

    const {
      customer_id, client_name,
      route_id, pickup_address, drop_address,
      planned_departure, dock_window,
      load_type, load_weight_kg, load_description,
      freight_amount, priority_level, special_instructions,
      driver_id, vehicle_id, trailer_id,
      stops = []
    } = req.body;

    let resolvedClientName = client_name || null;
    if (customer_id && !resolvedClientName) {
      const [[customer]] = await conn.query(`SELECT company_name FROM customers WHERE id = ?`, [customer_id]);
      resolvedClientName = customer?.company_name || null;
    }

    if (!customer_id && !resolvedClientName) {
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
         (trip_code, customer_id, client_name, route_id, vehicle_id, trailer_id, driver_id,
          pickup_address, drop_address, dispatch_status, priority_level,
          planned_departure, eta, dock_window, pod_status,
          load_type, load_weight_kg, load_description, freight_amount_gbp, special_instructions,
          driver_job_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'planned', ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)`,
      [
        jobCode,
        customer_id || null,
        resolvedClientName,
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
        load_description || null,
        freight_amount || null,
        special_instructions || null,
        driver_id ? "offered" : null
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
    await conn.beginTransaction();
    const { id } = req.params;

    const [[existing]] = await conn.query(`SELECT id, vehicle_id, trailer_id, driver_id FROM trips WHERE id = ?`, [id]);
    if (!existing) return res.status(404).json({ message: "Job not found." });

    const {
      customer_id, client_name,
      route_id, pickup_address, drop_address,
      planned_departure, dock_window,
      load_type, load_weight_kg, load_description,
      freight_amount, priority_level, special_instructions,
      driver_id, vehicle_id, trailer_id,
      stops = []
    } = req.body;

    let resolvedClientName = client_name || null;
    if (customer_id && !resolvedClientName) {
      const [[customer]] = await conn.query(`SELECT company_name FROM customers WHERE id = ?`, [customer_id]);
      resolvedClientName = customer?.company_name || null;
    }

    if (!customer_id && !resolvedClientName) {
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

    await conn.query(
      `UPDATE trips SET
         customer_id=?, client_name=?, route_id=?, vehicle_id=?, trailer_id=?, driver_id=?,
         pickup_address=?, drop_address=?, priority_level=?,
         planned_departure=?, eta=?, dock_window=?,
         load_type=?, load_weight_kg=?, load_description=?, freight_amount_gbp=?, special_instructions=?,
         driver_job_status=IF(? = 1, 'offered', driver_job_status)
       WHERE id=?`,
      [
        customer_id || null, resolvedClientName, route_id || null,
        vehicle_id || null, trailer_id || null, driver_id || null,
        pickup_address || null, drop_address || null,
        priority_level || "standard",
        planned_departure || null, eta, dock_window || null,
        load_type || "general", load_weight_kg || null,
        load_description || null, freight_amount || null,
        special_instructions || null,
        String(existing.driver_id || "") !== String(driver_id || "") && driver_id ? 1 : 0,
        id
      ]
    );

    // Replace stops
    await conn.query(`DELETE FROM job_stops WHERE trip_id = ?`, [id]);
    for (let i = 0; i < stops.length; i++) {
      const s = stops[i];
      if (!s.address) continue;
      await conn.query(
        `INSERT INTO job_stops (trip_id, stop_order, stop_type, address, contact_name, contact_phone, planned_arrival, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, i + 1, s.stop_type || "delivery", s.address, s.contact_name || null, s.contact_phone || null, s.planned_arrival || null, s.notes || null]
      );
    }

    await conn.commit();
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

    const { id } = req.params;
    const { status, reason } = req.body;

    const validStatuses = ["planned", "loading", "active", "blocked", "completed"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: "Invalid status value." });
    }

    const [[job]] = await db.query(`SELECT id, dispatch_status, vehicle_id, trailer_id FROM trips WHERE id = ?`, [id]);
    if (!job) return res.status(404).json({ message: "Job not found." });

    const updates = { dispatch_status: status };
    if (status === "active")    updates.actual_departure = new Date();
    if (status === "completed") { updates.actual_arrival = new Date(); updates.pod_status = "pending"; }
    if (status === "blocked")   updates.cancellation_reason = reason || null;

    const fields = Object.keys(updates).map(k => `${k}=?`).join(", ");
    await db.query(`UPDATE trips SET ${fields} WHERE id=?`, [...Object.values(updates), id]);

    // Update vehicle status accordingly
    if (job.vehicle_id) {
      const vStatus = status === "active" ? "in_transit" : status === "completed" ? "available" : status === "blocked" ? "available" : "planned";
      await db.query(`UPDATE vehicles SET status=? WHERE id=?`, [vStatus, job.vehicle_id]);
    }
    if (job.trailer_id) {
      await db.query(`UPDATE trailers SET status=? WHERE id=?`, [trailerStatusForJob(status), job.trailer_id]);
    }

    res.json({ message: "Job status updated.", status });
  } catch (err) {
    res.status(500).json({ message: "Status update error", error: err.message });
  }
};

// DELETE /api/jobs/:id  (cancel — sets blocked + reason)
exports.cancelJob = async (req, res) => {
  try {
    await ensureDriverOpsSchema();

    const { id } = req.params;
    const { reason } = req.body;

    const [[job]] = await db.query(`SELECT id, vehicle_id, trailer_id FROM trips WHERE id = ?`, [id]);
    if (!job) return res.status(404).json({ message: "Job not found." });

    await db.query(
      `UPDATE trips SET dispatch_status='blocked', cancellation_reason=? WHERE id=?`,
      [reason || "Cancelled by admin", id]
    );
    if (job.vehicle_id) {
      await db.query(`UPDATE vehicles SET status='available' WHERE id=?`, [job.vehicle_id]);
    }
    if (job.trailer_id) {
      await db.query(`UPDATE trailers SET status='available' WHERE id=?`, [job.trailer_id]);
    }

    res.json({ message: "Job cancelled." });
  } catch (err) {
    res.status(500).json({ message: "Cancel error", error: err.message });
  }
};
