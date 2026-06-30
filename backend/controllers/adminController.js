const db = require("../db/connection");
const { ensureEmployeeAuthSchema, employeeModules, parseAccessModules } = require("./authController");
const { emitDriverChatMessage, emitDriverLocationUpdate, emitJobUpdate } = require("../realtime");
const { buildChangeSet, ensureActivitySchema, ensureSessionSchema, getActor, logActivity, requireDeleteReason } = require("../utils/auditLogger");

function severityTone(s) {
  return s === "critical" || s === "high" ? "danger" : s === "medium" ? "warning" : "neutral";
}

function fmtDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function fmtDateTime(d) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function isoDateTime(d) {
  return d ? new Date(d).toISOString() : null;
}

function rawDate(d) {
  if (!d) return "";
  const date = new Date(d);
  const offsetMs = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 10);
}

function rawDateTime(d) {
  if (!d) return "";
  const date = new Date(d);
  const offsetMs = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function fmtAmount(n) {
  return n != null
    ? `£${Number(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : "—";
}

function parseJsonValue(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function cleanAlertCopy(text) {
  if (!text) return "No description added.";
  if (text.includes("Rest-rule breach") && text.includes("Leeds to London")) {
    return "A new driver must be confirmed for the Leeds to London trip after a rest-rule breach.";
  }
  if (text.includes("LON-MAN lane") && text.includes("ETA review")) {
    return "ETA review is required because of traffic load on the LON-MAN lane.";
  }
  if (text.includes("Driver CPC renewal")) {
    return "Release approval is on hold because Driver CPC renewal is pending.";
  }
  if (text.includes("Billing release") && text.includes("POD scan")) {
    return "Billing release is blocked because the POD scan is missing.";
  }
  return text;
}

function vehicleStatusForTrip(status) {
  if (status === "active" || status === "loading") return "in_transit";
  if (status === "planned") return "planned";
  return "available";
}

function trailerStatusForTrip(status) {
  if (status === "active" || status === "loading") return "in_use";
  if (status === "planned") return "planned";
  return "available";
}

let driverOpsSchemaReady = false;
let vehicleGpsSchemaReady = false;
let trailerSchemaReady = false;
let driverChatSchemaReady = false;
let softDeleteSchemaReady = false;
let notificationAckSchemaReady = false;

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
  await addColumnIfMissing("trips", "customer_id", "INT DEFAULT NULL");
  await addColumnIfMissing("trips", "pickup_address", "TEXT DEFAULT NULL");
  await addColumnIfMissing("trips", "drop_address", "TEXT DEFAULT NULL");
  await addColumnIfMissing("trips", "load_type", "VARCHAR(80) DEFAULT 'general'");
  await addColumnIfMissing("trips", "load_weight_kg", "DECIMAL(10,2) DEFAULT NULL");
  await addColumnIfMissing("trips", "load_volume_cbm", "DECIMAL(10,2) DEFAULT NULL");
  await addColumnIfMissing("trips", "vehicle_type_requirement", "VARCHAR(80) DEFAULT NULL");
  await addColumnIfMissing("trips", "delivery_deadline", "DATETIME DEFAULT NULL");
  await addColumnIfMissing("trips", "dispatcher_notes", "TEXT DEFAULT NULL");
  await addColumnIfMissing("trips", "load_description", "TEXT DEFAULT NULL");
  await addColumnIfMissing("trips", "special_instructions", "TEXT DEFAULT NULL");
  await addColumnIfMissing("trips", "actual_departure", "DATETIME DEFAULT NULL");
  await addColumnIfMissing("trips", "actual_arrival", "DATETIME DEFAULT NULL");
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
  await addColumnIfMissing("defect_reports", "defect_type", "VARCHAR(80) NOT NULL DEFAULT 'Driver report'");
  await addColumnIfMissing("defect_reports", "reported_by", "VARCHAR(120) DEFAULT NULL");
  driverOpsSchemaReady = true;
}

async function ensureVehicleGpsSchema() {
  if (vehicleGpsSchemaReady) return;
  await addColumnIfMissing("vehicles", "current_location", "VARCHAR(160) DEFAULT NULL");
  await addColumnIfMissing("vehicles", "speed_kph", "DECIMAL(5,1) DEFAULT 0");
  await addColumnIfMissing("vehicles", "last_ping_at", "DATETIME DEFAULT NULL");
  await addColumnIfMissing("vehicles", "gps_latitude", "DECIMAL(10,7) DEFAULT NULL");
  await addColumnIfMissing("vehicles", "gps_longitude", "DECIMAL(10,7) DEFAULT NULL");
  await addColumnIfMissing("vehicles", "gps_accuracy_m", "DECIMAL(8,2) DEFAULT NULL");
  vehicleGpsSchemaReady = true;
}

async function ensureTrailerSchema() {
  if (trailerSchemaReady) return;
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
  await addColumnIfMissing("trips", "trailer_id", "INT DEFAULT NULL");
  trailerSchemaReady = true;
}

async function ensureDriverChatSchema() {
  if (driverChatSchemaReady) return;
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
  driverChatSchemaReady = true;
}

async function ensureSoftDeleteSchema() {
  if (softDeleteSchemaReady) return;
  for (const table of ["invoices", "vendor_payouts", "trips"]) {
    await addColumnIfMissing(table, "deleted_at", "DATETIME DEFAULT NULL");
    await addColumnIfMissing(table, "deleted_by", "INT DEFAULT NULL");
    await addColumnIfMissing(table, "delete_reason", "TEXT DEFAULT NULL");
  }
  softDeleteSchemaReady = true;
}

async function ensureNotificationAckSchema() {
  if (notificationAckSchemaReady) return;
  await db.query(
    `CREATE TABLE IF NOT EXISTS notification_acknowledgements (
      id INT AUTO_INCREMENT PRIMARY KEY,
      notification_id VARCHAR(120) NOT NULL,
      user_id INT DEFAULT NULL,
      acknowledged_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_notification_user (notification_id, user_id)
    ) ENGINE=InnoDB`
  );
  notificationAckSchemaReady = true;
}

function mapChatMessage(row, driverName = "Driver") {
  return {
    id: row.id,
    driverId: row.driver_id,
    driverName,
    senderRole: row.sender_role,
    senderName: row.sender_name || (row.sender_role === "driver" ? driverName : "Admin"),
    body: row.body,
    tripId: row.trip_id,
    isRead: Boolean(row.is_read),
    at: fmtDateTime(row.sent_at),
    sentAt: isoDateTime(row.sent_at)
  };
}

function driverStatusDisplay(status) {
  const labels = {
    offered: "Offered",
    accepted: "Accepted",
    arrived_pickup: "Arrived pickup",
    loaded: "Loaded",
    in_transit: "In transit",
    arrived_drop: "Arrived drop",
    delivered: "Delivered",
    failed_delivery: "Failed delivery",
    declined: "Declined"
  };
  return labels[status] || status || "Accepted";
}

exports.getDrivers = async (req, res) => {
  try {
    const [[counts]] = await db.query(
      `SELECT COUNT(*) as total,
        SUM(onboarding_status IN ('new','docs_pending')) as pending,
        SUM(shift_status='ready') as ready,
        SUM(compliance_status='review') as review
       FROM drivers`
    );
    const [onboardingRows] = await db.query(
      `SELECT full_name, employee_code, phone, onboarding_status, shift_status, compliance_status
       FROM drivers WHERE onboarding_status IN ('new','docs_pending') OR compliance_status='review' LIMIT 10`
    );
    const [docRows] = await db.query(
      `SELECT d.full_name, dd.document_type, dd.document_number, dd.expiry_date, dd.verification_status
       FROM driver_documents dd JOIN drivers d ON dd.driver_id = d.id
       WHERE dd.verification_status IN ('expiring','expired','pending') LIMIT 10`
    );
    const [assignRows] = await db.query(
      `SELECT t.trip_code, d.full_name, v.registration_number, t.dispatch_status, t.priority_level
       FROM trips t
       JOIN drivers d ON t.driver_id = d.id
       JOIN vehicles v ON t.vehicle_id = v.id
       LIMIT 10`
    );

    const complianceTone = { clear: "success", review: "warning", blocked: "danger" };

    res.json({
      header: {
        badge: "Driver management",
        title: "Driver onboarding and compliance",
        description: "Handle onboarding, document expiry, shift readiness, and trip allocation approvals in one place."
      },
      highlights: [
        "The onboarding queue shows new drivers and pending documents.",
        "The document expiry watchlist proactively tracks compliance risk.",
        "Trip allocation approvals are wired into fleet sync."
      ],
      stats: [
        { label: "Total drivers", value: counts.total, description: "Registered drivers in system.", change: "Live from database", tone: "neutral" },
        { label: "Ready for dispatch", value: counts.ready, description: "Shift-ready, cleared drivers.", change: "Live from database", tone: "success" },
        { label: "Onboarding pending", value: counts.pending, description: "Docs or onboarding incomplete.", change: "Live from database", tone: "warning" },
        { label: "Compliance review", value: counts.review, description: "Drivers flagged for review.", change: "Live from database", tone: "danger" }
      ],
      onboarding: onboardingRows.map(r => ({
        name: r.full_name,
        identity: `${r.employee_code} · ${r.phone}`,
        stage: r.onboarding_status.replace("_", " "),
        note: `Compliance: ${r.compliance_status}`,
        status: r.shift_status.replace("_", " "),
        tone: complianceTone[r.compliance_status] || "neutral"
      })),
      documents: docRows.map(r => {
        const vt = { valid: "success", expiring: "warning", expired: "danger", pending: "neutral" };
        return {
          name: r.full_name,
          document: r.document_type,
          expiry: fmtDate(r.expiry_date),
          note: r.document_number,
          status: r.verification_status,
          tone: vt[r.verification_status] || "neutral"
        };
      }),
      assignments: assignRows.map(r => {
        const dt = { active: "success", loading: "warning", blocked: "danger", planned: "neutral", completed: "neutral" };
        return {
          trip: r.trip_code,
          driver: r.full_name,
          vehicle: r.registration_number,
          note: `Priority: ${r.priority_level}`,
          status: r.dispatch_status,
          tone: dt[r.dispatch_status] || "neutral"
        };
      })
    });
  } catch (error) {
    res.status(500).json({ message: "Drivers data error", error: error.message });
  }
};

exports.getDriverChats = async (_req, res) => {
  try {
    await ensureDriverChatSchema();
    const [rows] = await db.query(
      `SELECT d.id, d.employee_code, d.full_name, d.phone, d.shift_status, d.compliance_status,
              last_msg.id AS last_message_id,
              last_msg.sender_role AS last_sender_role,
              last_msg.sender_name AS last_sender_name,
              last_msg.body AS last_body,
              last_msg.sent_at AS last_sent_at,
              COALESCE(unread.unread_count, 0) AS unread_count
       FROM drivers d
       LEFT JOIN (
         SELECT m.*
         FROM driver_messages m
         JOIN (
           SELECT driver_id, MAX(id) AS id
           FROM driver_messages
           GROUP BY driver_id
         ) latest ON latest.id = m.id
       ) last_msg ON last_msg.driver_id = d.id
       LEFT JOIN (
         SELECT driver_id, COUNT(*) AS unread_count
         FROM driver_messages
         WHERE sender_role='driver' AND is_read=0
         GROUP BY driver_id
       ) unread ON unread.driver_id = d.id
       ORDER BY COALESCE(last_msg.sent_at, d.created_at) DESC, d.full_name ASC`
    );

    res.json({
      drivers: rows.map(r => ({
        id: r.id,
        employeeCode: r.employee_code,
        fullName: r.full_name,
        phone: r.phone || "—",
        shiftStatus: r.shift_status,
        complianceStatus: r.compliance_status,
        unreadCount: Number(r.unread_count) || 0,
        lastMessage: r.last_message_id ? {
          id: r.last_message_id,
          senderRole: r.last_sender_role,
          senderName: r.last_sender_name || (r.last_sender_role === "driver" ? r.full_name : "Admin"),
          body: r.last_body,
          at: fmtDateTime(r.last_sent_at),
          sentAt: isoDateTime(r.last_sent_at)
        } : null
      }))
    });
  } catch (error) {
    res.status(500).json({ message: "Driver chats error", error: error.message });
  }
};

exports.getDriverChatMessages = async (req, res) => {
  try {
    await ensureDriverChatSchema();
    const { id } = req.params;
    const [[driver]] = await db.query(`SELECT id, full_name FROM drivers WHERE id=?`, [id]);
    if (!driver) return res.status(404).json({ message: "Driver not found." });

    const [messages] = await db.query(
      `SELECT * FROM driver_messages WHERE driver_id=? ORDER BY sent_at DESC LIMIT 60`,
      [id]
    );
    await db.query(
      `UPDATE driver_messages SET is_read=1 WHERE driver_id=? AND sender_role='driver' AND is_read=0`,
      [id]
    );

    res.json({
      driver: { id: driver.id, name: driver.full_name },
      messages: messages.reverse().map(m => mapChatMessage(m, driver.full_name))
    });
  } catch (error) {
    res.status(500).json({ message: "Driver chat fetch error", error: error.message });
  }
};

exports.sendDriverChatMessage = async (req, res) => {
  try {
    await ensureDriverChatSchema();
    const { id } = req.params;
    const { body, senderName } = req.body;
    if (!body?.trim()) return res.status(400).json({ message: "Message body required." });

    const [[driver]] = await db.query(`SELECT id, full_name FROM drivers WHERE id=?`, [id]);
    if (!driver) return res.status(404).json({ message: "Driver not found." });

    const [result] = await db.query(
      `INSERT INTO driver_messages (driver_id, sender_role, sender_name, body, is_read) VALUES (?, 'admin', ?, ?, 0)`,
      [id, senderName || "Admin", body.trim().slice(0, 1000)]
    );
    const [[created]] = await db.query(`SELECT * FROM driver_messages WHERE id=?`, [result.insertId]);
    const message = mapChatMessage(created, driver.full_name);
    emitDriverChatMessage(message);

    res.status(201).json({ message: "Message sent to driver.", chatMessage: message });
  } catch (error) {
    res.status(500).json({ message: "Driver chat send error", error: error.message });
  }
};

exports.getFinance = async (req, res) => {
  try {
    await ensureSoftDeleteSchema();
    const [[counts]] = await db.query(
      `SELECT COUNT(*) as total,
        COALESCE(SUM(payment_status='overdue'), 0) as overdue,
        COALESCE(SUM(payment_status IN ('pending','sent')), 0) as pending,
        COALESCE(SUM(payment_status='paid'), 0) as paid
       FROM invoices
       WHERE deleted_at IS NULL`
    );
    const [[position]] = await db.query(
      `SELECT
        COALESCE(SUM(CASE WHEN payment_status != 'paid' THEN amount_gbp ELSE 0 END), 0) as receivable,
        COALESCE(SUM(CASE WHEN payment_status = 'overdue' THEN amount_gbp ELSE 0 END), 0) as overdue_amount,
        COALESCE((SELECT SUM(amount_gbp) FROM vendor_payouts WHERE payout_status != 'paid' AND deleted_at IS NULL), 0) as payable,
        COALESCE((SELECT SUM(amount_gbp) FROM vendor_payouts WHERE payout_status = 'hold' AND deleted_at IS NULL), 0) as held_payouts
       FROM invoices
       WHERE deleted_at IS NULL`
    );
    const [collectionRows] = await db.query(
      `SELECT id, invoice_no, client_name, amount_gbp, due_date, payment_status
       FROM invoices WHERE payment_status != 'paid' AND deleted_at IS NULL ORDER BY due_date ASC LIMIT 8`
    );
    const [payoutRows] = await db.query(
      `SELECT id, payout_reference, vendor_name, lane_code, amount_gbp, due_date, payout_status, notes
       FROM vendor_payouts WHERE deleted_at IS NULL ORDER BY due_date ASC LIMIT 8`
    );
    const [noteRows] = await db.query(
      `SELECT title, description, severity FROM control_room_alerts
       WHERE module_name='finance' AND alert_status='open' LIMIT 4`
    );

    const payTone = { overdue: "danger", pending: "warning", sent: "warning", hold: "neutral", draft: "neutral", paid: "success" };
    const outTone = { hold: "warning", processing: "warning", scheduled: "neutral", paid: "success" };

    res.json({
      header: {
        badge: "Finance management",
        title: "Collections, payouts and cash position",
        description: "Track collections follow-up, vendor payouts, cash flow, and overdue controls in one place."
      },
      highlights: [
        "Overdue invoices and near-due collections are visible in one place.",
        "The vendor payout queue is sorted by settlement date.",
        "Finance alerts receive a live feed from the control room."
      ],
      stats: [
        { label: "Total invoices", value: counts.total, description: "All invoices in system.", change: "Live from database", tone: "neutral" },
        { label: "Overdue", value: counts.overdue, description: "Invoices past due date.", change: "Live from database", tone: "danger" },
        { label: "Pending collection", value: counts.pending, description: "Sent or pending payment.", change: "Live from database", tone: "warning" },
        { label: "Settled", value: counts.paid, description: "Paid invoices this period.", change: "Live from database", tone: "success" }
      ],
      cashPosition: [
        { label: "Receivable open", value: fmtAmount(position.receivable), description: "Unpaid customer invoices.", tone: "warning" },
        { label: "Payable open", value: fmtAmount(position.payable), description: "Vendor payouts not yet paid.", tone: "neutral" },
        { label: "Net cash position", value: fmtAmount(Number(position.receivable) - Number(position.payable)), description: "Open receivables minus open payouts.", tone: Number(position.receivable) >= Number(position.payable) ? "success" : "danger" },
        { label: "Overdue exposure", value: fmtAmount(position.overdue_amount), description: "Past-due customer balance.", tone: "danger" }
      ],
      collections: collectionRows.map(r => ({
        id: r.id,
        reference: r.invoice_no,
        counterparty: r.client_name,
        amountValue: Number(r.amount_gbp || 0),
        amount: fmtAmount(r.amount_gbp),
        dueDate: rawDate(r.due_date),
        due: `Due ${fmtDate(r.due_date)}`,
        status: r.payment_status,
        tone: payTone[r.payment_status] || "neutral"
      })),
      payouts: payoutRows.map(r => ({
        id: r.id,
        reference: r.payout_reference,
        vendorName: r.vendor_name,
        laneCode: r.lane_code || "",
        counterparty: `${r.vendor_name}${r.lane_code ? ` · ${r.lane_code}` : ""}`,
        amountValue: Number(r.amount_gbp || 0),
        amount: fmtAmount(r.amount_gbp),
        dueDate: rawDate(r.due_date),
        due: `Due ${fmtDate(r.due_date)}`,
        status: r.payout_status,
        notes: r.notes || "",
        tone: outTone[r.payout_status] || "neutral"
      })),
      cashNotes: noteRows.map(r => ({
        title: r.title,
        description: r.description,
        tone: severityTone(r.severity)
      }))
    });
  } catch (error) {
    res.status(500).json({ message: "Finance data error", error: error.message });
  }
};

exports.createPayout = async (req, res) => {
  try {
    await ensureSoftDeleteSchema();
    const { payout_reference, vendor_name, lane_code, amount_gbp, due_date, payout_status, notes } = req.body;
    if (!payout_reference || !vendor_name || !amount_gbp || !due_date) {
      return res.status(400).json({ message: "payout_reference, vendor_name, amount_gbp, and due_date are required." });
    }

    const valid = ["scheduled", "processing", "paid", "hold"];
    const status = payout_status || "scheduled";
    if (!valid.includes(status)) return res.status(400).json({ message: "Invalid payout status." });

    const [result] = await db.query(
      `INSERT INTO vendor_payouts
        (payout_reference, vendor_name, lane_code, amount_gbp, due_date, payout_status, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [payout_reference, vendor_name, lane_code || null, amount_gbp, due_date, status, notes || null]
    );

    await logActivity(req, {
      module: "finance",
      action: "create",
      entityType: "payout",
      entityId: result.insertId,
      entityLabel: payout_reference,
      details: { vendor_name, amount_gbp, due_date, payout_status: status }
    });

    res.status(201).json({ message: "Payout created.", id: result.insertId });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: "Payout reference already exists. If it was deleted, restore it from the activity report instead of creating a duplicate." });
    }
    res.status(500).json({ message: "Payout create error", error: error.message });
  }
};

exports.updatePayout = async (req, res) => {
  try {
    await ensureSoftDeleteSchema();
    const { id } = req.params;
    const { payout_reference, vendor_name, lane_code, amount_gbp, due_date, payout_status, notes } = req.body;
    if (!payout_reference || !vendor_name || !amount_gbp || !due_date) {
      return res.status(400).json({ message: "payout_reference, vendor_name, amount_gbp, and due_date are required." });
    }

    const valid = ["scheduled", "processing", "paid", "hold"];
    const status = payout_status || "scheduled";
    if (!valid.includes(status)) return res.status(400).json({ message: "Invalid payout status." });

    const [[before]] = await db.query("SELECT * FROM vendor_payouts WHERE id=? AND deleted_at IS NULL", [id]);
    if (!before) return res.status(404).json({ message: "Payout not found." });

    const [result] = await db.query(
      `UPDATE vendor_payouts SET
        payout_reference=?, vendor_name=?, lane_code=?, amount_gbp=?, due_date=?, payout_status=?, notes=?
       WHERE id=? AND deleted_at IS NULL`,
      [payout_reference, vendor_name, lane_code || null, amount_gbp, due_date, status, notes || null, id]
    );

    if (result.affectedRows === 0) return res.status(404).json({ message: "Payout not found." });
    const after = { ...before, payout_reference, vendor_name, lane_code: lane_code || null, amount_gbp, due_date, payout_status: status, notes: notes || null };
    await logActivity(req, {
      module: "finance",
      action: "update",
      entityType: "payout",
      entityId: id,
      entityLabel: payout_reference,
      details: {
        vendor_name,
        amount_gbp,
        due_date,
        payout_status: status,
        changes: buildChangeSet(before, after, ["payout_reference", "vendor_name", "lane_code", "amount_gbp", "due_date", "payout_status", "notes"])
      }
    });
    res.json({ message: "Payout updated." });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: "Payout reference already exists." });
    }
    res.status(500).json({ message: "Payout update error", error: error.message });
  }
};

exports.updatePayoutStatus = async (req, res) => {
  try {
    await ensureSoftDeleteSchema();
    const { id } = req.params;
    const { payout_status } = req.body;
    const valid = ["scheduled", "processing", "paid", "hold"];
    if (!valid.includes(payout_status)) return res.status(400).json({ message: "Invalid payout status." });

    const [[before]] = await db.query("SELECT id, payout_status FROM vendor_payouts WHERE id=? AND deleted_at IS NULL", [id]);
    if (!before) return res.status(404).json({ message: "Payout not found." });
    const [result] = await db.query("UPDATE vendor_payouts SET payout_status=? WHERE id=? AND deleted_at IS NULL", [payout_status, id]);
    if (result.affectedRows === 0) return res.status(404).json({ message: "Payout not found." });

    await logActivity(req, {
      module: "finance",
      action: "status_update",
      entityType: "payout",
      entityId: id,
      details: { payout_status, changes: buildChangeSet(before, { ...before, payout_status }, ["payout_status"]) }
    });

    res.json({ message: "Payout status updated." });
  } catch (error) {
    res.status(500).json({ message: "Payout status update error", error: error.message });
  }
};

exports.deletePayout = async (req, res) => {
  try {
    await ensureSoftDeleteSchema();
    const { id } = req.params;
    const reasonCheck = requireDeleteReason(req);
    if (!reasonCheck.ok) return res.status(400).json({ message: reasonCheck.message });

    const [[payout]] = await db.query("SELECT id, payout_reference, vendor_name, amount_gbp FROM vendor_payouts WHERE id=? AND deleted_at IS NULL", [id]);
    if (!payout) return res.status(404).json({ message: "Payout not found." });

    const actor = await getActor(req);
    const [result] = await db.query(
      "UPDATE vendor_payouts SET deleted_at=NOW(), deleted_by=?, delete_reason=? WHERE id=? AND deleted_at IS NULL",
      [actor.id, reasonCheck.reason, id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ message: "Payout not found." });
    await logActivity(req, {
      module: "finance",
      action: "delete",
      entityType: "payout",
      entityId: id,
      entityLabel: payout.payout_reference,
      reason: reasonCheck.reason,
      reasonCategory: reasonCheck.reasonCategory,
      details: { vendor_name: payout.vendor_name, amount_gbp: payout.amount_gbp }
    });
    res.json({ message: "Payout deleted." });
  } catch (error) {
    res.status(500).json({ message: "Payout delete error", error: error.message });
  }
};

exports.getBilling = async (req, res) => {
  try {
    await ensureSoftDeleteSchema();
    const [[counts]] = await db.query(
      `SELECT COUNT(*) as total,
        COALESCE(SUM(pod_verified=1), 0) as pod_ok,
        COALESCE(SUM(pod_verified=0), 0) as pod_pending,
        COALESCE(SUM(payment_status='overdue'), 0) as overdue
       FROM invoices
       WHERE deleted_at IS NULL`
    );
    const [[totals]] = await db.query(
      `SELECT
        COALESCE(SUM(amount_gbp), 0) as billed,
        COALESCE(SUM(CASE WHEN payment_status='paid' THEN amount_gbp ELSE 0 END), 0) as collected,
        COALESCE(SUM(CASE WHEN payment_status!='paid' THEN amount_gbp ELSE 0 END), 0) as outstanding,
        COALESCE(SUM(CASE WHEN pod_verified=0 THEN amount_gbp ELSE 0 END), 0) as pod_risk
       FROM invoices
       WHERE deleted_at IS NULL`
    );
    const [invoiceRows] = await db.query(
      `SELECT i.id, i.invoice_no, i.client_name, i.amount_gbp, i.issued_at, i.due_date,
              i.payment_status, i.pod_verified, i.notes, i.currency,
              t.trip_code, t.pod_status,
              r.origin_hub, r.destination_hub
       FROM invoices i
       LEFT JOIN trips t ON t.id = i.trip_id
       LEFT JOIN routes r ON r.id = t.route_id
       WHERE i.deleted_at IS NULL
       ORDER BY i.created_at DESC LIMIT 25`
    );
    const [blockerRows] = await db.query(
      `SELECT title, description, severity FROM control_room_alerts
       WHERE module_name='billing' AND alert_status='open' LIMIT 6`
    );

    const payTone = { overdue: "danger", pending: "warning", sent: "warning", hold: "neutral", draft: "neutral", paid: "success" };

    res.json({
      header: {
        badge: "Invoicing & billing",
        title: "Freight invoices and POD billing",
        description: "Manage invoice generation, POD-linked billing, and payment status tracking in one place."
      },
      highlights: [
        "All freight invoices are listed with POD verification status.",
        "Billing blockers, including missing POD and payment exceptions, are visible in real time.",
        "The invoice register is synced with dispatch and settlement cycles."
      ],
      stats: [
        { label: "Total invoices", value: counts.total, description: "All invoices on record.", change: "Live from database", tone: "neutral" },
        { label: "POD verified", value: counts.pod_ok, description: "Invoices with POD confirmed.", change: "Live from database", tone: "success" },
        { label: "POD pending", value: counts.pod_pending, description: "Waiting for POD upload.", change: "Live from database", tone: "warning" },
        { label: "Overdue", value: counts.overdue, description: "Past due date, unpaid.", change: "Live from database", tone: "danger" }
      ],
      amountSummary: [
        { label: "Total billed", value: fmtAmount(totals.billed), description: "Gross invoice value.", change: "Calculated live", tone: "neutral" },
        { label: "Collected", value: fmtAmount(totals.collected), description: "Invoices marked paid.", change: "Calculated live", tone: "success" },
        { label: "Outstanding", value: fmtAmount(totals.outstanding), description: "Open customer balance.", change: "Calculated live", tone: "warning" },
        { label: "POD risk", value: fmtAmount(totals.pod_risk), description: "Value waiting for POD.", change: "Calculated live", tone: "danger" }
      ],
      invoices: invoiceRows.map(r => ({
        id: r.id,
        invoice: r.invoice_no,
        client: r.client_name,
        amountValue: Number(r.amount_gbp || 0),
        amount: fmtAmount(r.amount_gbp),
        issuedAt: rawDate(r.issued_at),
        issued: fmtDate(r.issued_at),
        dueDate: rawDate(r.due_date),
        dueLabel: fmtDate(r.due_date),
        note: r.pod_verified ? `POD verified · Due ${fmtDate(r.due_date)}` : `POD pending · Due ${fmtDate(r.due_date)}`,
        status: r.payment_status,
        tone: payTone[r.payment_status] || "neutral",
        podVerified: Boolean(r.pod_verified),
        tripCode: r.trip_code || "",
        tripPodStatus: r.pod_status || "",
        lane: r.origin_hub && r.destination_hub ? `${r.origin_hub} → ${r.destination_hub}` : "No linked trip",
        notes: r.notes || "",
        currency: r.currency || "GBP"
      })),
      blockers: blockerRows.map(r => ({
        title: r.title,
        description: r.description,
        tone: severityTone(r.severity)
      }))
    });
  } catch (error) {
    res.status(500).json({ message: "Billing data error", error: error.message });
  }
};

exports.getBillingFormData = async (_req, res) => {
  try {
    await ensureSoftDeleteSchema();
    const [trips] = await db.query(
      `SELECT t.id, t.trip_code, t.client_name, t.freight_amount_gbp, t.pod_status,
              r.origin_hub, r.destination_hub
       FROM trips t
       LEFT JOIN routes r ON r.id = t.route_id
       WHERE t.deleted_at IS NULL
       ORDER BY t.created_at DESC`
    );

    res.json({
      trips: trips.map(t => ({
        id: t.id,
        tripCode: t.trip_code,
        clientName: t.client_name,
        freightAmountGbp: t.freight_amount_gbp,
        podStatus: t.pod_status,
        lane: t.origin_hub && t.destination_hub ? `${t.origin_hub} → ${t.destination_hub}` : "Custom route"
      }))
    });
  } catch (error) {
    res.status(500).json({ message: "Billing form data error", error: error.message });
  }
};

exports.getInvoiceById = async (req, res) => {
  try {
    await ensureSoftDeleteSchema();
    const { id } = req.params;
    const [[invoice]] = await db.query(
      `SELECT i.*, t.trip_code, t.dispatch_status, t.pod_status,
              r.origin_hub, r.destination_hub
       FROM invoices i
       LEFT JOIN trips t ON t.id = i.trip_id
       LEFT JOIN routes r ON r.id = t.route_id
       WHERE i.id = ? AND i.deleted_at IS NULL`,
      [id]
    );

    if (!invoice) return res.status(404).json({ message: "Invoice not found." });

    const payTone = { overdue: "danger", pending: "warning", sent: "warning", hold: "danger", draft: "neutral", paid: "success" };

    res.json({
      id: invoice.id,
      invoiceNo: invoice.invoice_no,
      tripId: invoice.trip_id,
      tripCode: invoice.trip_code,
      lane: invoice.origin_hub && invoice.destination_hub ? `${invoice.origin_hub} → ${invoice.destination_hub}` : "No linked trip",
      clientName: invoice.client_name,
      amountGbp: invoice.amount_gbp,
      amountFormatted: fmtAmount(invoice.amount_gbp),
      issuedAt: fmtDate(invoice.issued_at),
      issuedAtRaw: rawDate(invoice.issued_at),
      dueDate: fmtDate(invoice.due_date),
      dueDateRaw: rawDate(invoice.due_date),
      paymentStatus: invoice.payment_status,
      tone: payTone[invoice.payment_status] || "neutral",
      podVerified: Boolean(invoice.pod_verified),
      tripPodStatus: invoice.pod_status,
      notes: invoice.notes || "",
      currency: invoice.currency || "GBP",
      form: {
        invoice_no: invoice.invoice_no,
        trip_id: invoice.trip_id || "",
        client_name: invoice.client_name || "",
        amount_gbp: invoice.amount_gbp || "",
        issued_at: rawDate(invoice.issued_at),
        due_date: rawDate(invoice.due_date),
        payment_status: invoice.payment_status || "draft",
        pod_verified: Boolean(invoice.pod_verified),
        notes: invoice.notes || ""
      }
    });
  } catch (error) {
    res.status(500).json({ message: "Invoice detail error", error: error.message });
  }
};

exports.createInvoice = async (req, res) => {
  try {
    await ensureSoftDeleteSchema();
    const {
      invoice_no,
      trip_id,
      client_name,
      amount_gbp,
      issued_at,
      due_date,
      payment_status,
      pod_verified,
      notes
    } = req.body;

    if (!invoice_no || !client_name || !amount_gbp || !issued_at || !due_date) {
      return res.status(400).json({ message: "invoice_no, client_name, amount_gbp, issued_at, and due_date are required." });
    }

    const [result] = await db.query(
      `INSERT INTO invoices
         (invoice_no, trip_id, client_name, amount_gbp, issued_at, due_date, payment_status, pod_verified, notes, currency)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'GBP')`,
      [
        invoice_no,
        trip_id || null,
        client_name,
        amount_gbp,
        issued_at,
        due_date,
        payment_status || "draft",
        pod_verified ? 1 : 0,
        notes || null
      ]
    );

    if (trip_id && pod_verified) {
      await db.query("UPDATE trips SET pod_status='verified' WHERE id=?", [trip_id]);
    }

    await logActivity(req, {
      module: "billing",
      action: "create",
      entityType: "invoice",
      entityId: result.insertId,
      entityLabel: invoice_no,
      details: { client_name, amount_gbp, due_date, payment_status: payment_status || "draft" }
    });

    res.status(201).json({ message: "Invoice created.", id: result.insertId });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: "Invoice number already exists. If it was deleted, restore it from the activity report instead of creating a duplicate." });
    }
    res.status(500).json({ message: "Invoice create error", error: error.message });
  }
};

exports.updateInvoice = async (req, res) => {
  try {
    await ensureSoftDeleteSchema();
    const { id } = req.params;
    const {
      invoice_no,
      trip_id,
      client_name,
      amount_gbp,
      issued_at,
      due_date,
      payment_status,
      pod_verified,
      notes
    } = req.body;

    const [[existing]] = await db.query("SELECT * FROM invoices WHERE id = ? AND deleted_at IS NULL", [id]);
    if (!existing) return res.status(404).json({ message: "Invoice not found." });

    if (!invoice_no || !client_name || !amount_gbp || !issued_at || !due_date) {
      return res.status(400).json({ message: "invoice_no, client_name, amount_gbp, issued_at, and due_date are required." });
    }

    await db.query(
      `UPDATE invoices SET
         invoice_no=?, trip_id=?, client_name=?, amount_gbp=?, issued_at=?, due_date=?,
         payment_status=?, pod_verified=?, notes=?
       WHERE id=? AND deleted_at IS NULL`,
      [
        invoice_no,
        trip_id || null,
        client_name,
        amount_gbp,
        issued_at,
        due_date,
        payment_status || "draft",
        pod_verified ? 1 : 0,
        notes || null,
        id
      ]
    );

    if (trip_id && pod_verified) {
      await db.query("UPDATE trips SET pod_status='verified' WHERE id=?", [trip_id]);
    }

    const after = {
      ...existing,
      invoice_no,
      trip_id: trip_id || null,
      client_name,
      amount_gbp,
      issued_at,
      due_date,
      payment_status: payment_status || "draft",
      pod_verified: pod_verified ? 1 : 0,
      notes: notes || null
    };
    await logActivity(req, {
      module: "billing",
      action: "update",
      entityType: "invoice",
      entityId: id,
      entityLabel: invoice_no,
      details: {
        client_name,
        amount_gbp,
        due_date,
        payment_status: payment_status || "draft",
        changes: buildChangeSet(existing, after, ["invoice_no", "trip_id", "client_name", "amount_gbp", "issued_at", "due_date", "payment_status", "pod_verified", "notes"])
      }
    });

    res.json({ message: "Invoice updated." });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: "Invoice number already exists." });
    }
    res.status(500).json({ message: "Invoice update error", error: error.message });
  }
};

exports.updateInvoiceStatus = async (req, res) => {
  try {
    await ensureSoftDeleteSchema();
    const { id } = req.params;
    const { payment_status, pod_verified } = req.body;
    const valid = ["draft", "sent", "pending", "overdue", "paid", "hold"];
    if (payment_status && !valid.includes(payment_status)) {
      return res.status(400).json({ message: "Invalid payment status." });
    }

    const [[invoice]] = await db.query("SELECT id, trip_id, payment_status, pod_verified FROM invoices WHERE id = ? AND deleted_at IS NULL", [id]);
    if (!invoice) return res.status(404).json({ message: "Invoice not found." });

    const nextStatus = payment_status || invoice.payment_status;
    const nextPod = typeof pod_verified === "boolean" ? pod_verified : Boolean(invoice.pod_verified);

    await db.query(
      "UPDATE invoices SET payment_status=?, pod_verified=? WHERE id=? AND deleted_at IS NULL",
      [nextStatus, nextPod ? 1 : 0, id]
    );

    if (invoice.trip_id && nextPod) {
      await db.query("UPDATE trips SET pod_status='verified' WHERE id=?", [invoice.trip_id]);
    }

    await logActivity(req, {
      module: "billing",
      action: "status_update",
      entityType: "invoice",
      entityId: id,
      details: { payment_status: nextStatus, pod_verified: nextPod, changes: buildChangeSet(invoice, { ...invoice, payment_status: nextStatus, pod_verified: nextPod ? 1 : 0 }, ["payment_status", "pod_verified"]) }
    });

    res.json({ message: "Invoice status updated." });
  } catch (error) {
    res.status(500).json({ message: "Invoice status update error", error: error.message });
  }
};

exports.deleteInvoice = async (req, res) => {
  try {
    await ensureSoftDeleteSchema();
    const { id } = req.params;
    const reasonCheck = requireDeleteReason(req);
    if (!reasonCheck.ok) return res.status(400).json({ message: reasonCheck.message });

    const [[invoice]] = await db.query(
      "SELECT id, invoice_no, client_name, amount_gbp, payment_status FROM invoices WHERE id = ? AND deleted_at IS NULL",
      [id]
    );
    if (!invoice) return res.status(404).json({ message: "Invoice not found." });

    const actor = await getActor(req);
    await db.query(
      "UPDATE invoices SET deleted_at=NOW(), deleted_by=?, delete_reason=? WHERE id = ? AND deleted_at IS NULL",
      [actor.id, reasonCheck.reason, id]
    );
    await logActivity(req, {
      module: "billing",
      action: "delete",
      entityType: "invoice",
      entityId: id,
      entityLabel: invoice.invoice_no,
      reason: reasonCheck.reason,
      reasonCategory: reasonCheck.reasonCategory,
      details: { client_name: invoice.client_name, amount_gbp: invoice.amount_gbp, payment_status: invoice.payment_status }
    });
    res.json({ message: "Invoice deleted." });
  } catch (error) {
    res.status(500).json({ message: "Invoice delete error", error: error.message });
  }
};

exports.getTracking = async (req, res) => {
  try {
    await ensureDriverOpsSchema();
    await ensureVehicleGpsSchema();

    const [[counts]] = await db.query(
      `SELECT COUNT(*) as total,
        COALESCE(SUM(status='in_transit'), 0) as in_transit,
        COALESCE(SUM(status='available'), 0) as available,
        COALESCE(SUM(status IN ('maintenance','stopped')), 0) as offline
       FROM vehicles`
    );
    const [truckRows] = await db.query(
      `SELECT v.id, v.registration_number, v.fleet_code, v.model_name, v.current_location, v.speed_kph, v.status, v.last_ping_at,
              v.gps_latitude, v.gps_longitude, v.gps_accuracy_m,
              t.id AS trip_id, t.trip_code, t.eta, t.dispatch_status, t.driver_job_status, t.failed_delivery_reason,
              d.full_name as driver_name,
              tr.trailer_code, tr.registration_number AS trailer_reg
       FROM vehicles v
       LEFT JOIN trips t ON t.vehicle_id = v.id AND t.dispatch_status IN ('planned','loading','active','blocked')
       LEFT JOIN drivers d ON t.driver_id = d.id
       LEFT JOIN trailers tr ON t.trailer_id = tr.id
       ORDER BY v.last_ping_at DESC LIMIT 50`
    );
    const [exceptionRows] = await db.query(
      `SELECT title, description, severity FROM control_room_alerts
       WHERE module_name='tracking' AND alert_status='open' LIMIT 6`
    );

    const vTone = { in_transit: "success", available: "success", planned: "neutral", maintenance: "danger", stopped: "danger" };
    const trackingRows = truckRows.map(r => {
      const mins = r.last_ping_at
        ? Math.round((Date.now() - new Date(r.last_ping_at)) / 60000)
        : null;
      const etaRisk = r.eta && ["active", "loading"].includes(r.dispatch_status)
        ? new Date(r.eta).getTime() < Date.now()
        : false;
      const hasGps = r.gps_latitude != null && r.gps_longitude != null;

      return {
        ...r,
        ping_minutes: mins,
        stale_ping: mins == null || mins > 15,
        eta_risk: etaRisk,
        has_gps: hasGps,
        overspeed: Number(r.speed_kph || 0) > 90
      };
    });

    res.json({
      header: {
        badge: "GPS / live tracking",
        title: "Truck positions, ETA and last ping",
        description: "Give admins visibility into every active truck's location, speed, ETA, and last ping."
      },
      highlights: [
        "Live status for all vehicles, including location, speed, and last ping, is shown on one board.",
        "Stale ping and ETA risk exceptions instantly alert the tracking desk.",
        "Stopped and maintenance trucks are tracked in the offline count."
      ],
      stats: [
        { label: "Total fleet", value: counts.total, description: "All registered vehicles.", change: "Live from database", tone: "neutral" },
        { label: "In transit", value: counts.in_transit, description: "Currently on road.", change: "Live from database", tone: "success" },
        { label: "Available", value: counts.available, description: "Ready for next dispatch.", change: "Live from database", tone: "neutral" },
        { label: "Offline", value: counts.offline, description: "Maintenance or stopped.", change: "Live from database", tone: "danger" }
      ],
      gpsHealth: [
        { label: "GPS online", value: trackingRows.filter(r => r.has_gps && !r.stale_ping).length, description: "Fresh location markers.", change: "15 min window", tone: "success" },
        { label: "Stale pings", value: trackingRows.filter(r => r.stale_ping).length, description: "No fresh driver update.", change: "Needs check", tone: "warning" },
        { label: "No GPS marker", value: trackingRows.filter(r => !r.has_gps).length, description: "Location permission or device missing.", change: "GPS gap", tone: "danger" },
        { label: "ETA / speed risk", value: trackingRows.filter(r => r.eta_risk || r.overspeed).length, description: "Late ETA or speed above 90 km/h.", change: "Ops review", tone: "danger" }
      ],
      trucks: trackingRows.map(r => {
        return {
          id: r.id,
          truck: r.registration_number,
          fleetCode: r.fleet_code,
          model: r.model_name,
          trailerCode: r.trailer_code || null,
          trailerReg: r.trailer_reg || null,
          driver: r.driver_name || "Unassigned",
          location: r.current_location || "Location unknown",
          latitude: r.gps_latitude != null ? Number(r.gps_latitude) : null,
          longitude: r.gps_longitude != null ? Number(r.gps_longitude) : null,
          accuracy: r.gps_accuracy_m != null ? Number(r.gps_accuracy_m) : null,
          accuracyLabel: r.gps_accuracy_m != null ? `±${Math.round(Number(r.gps_accuracy_m))} m` : "Accuracy unknown",
          speedValue: Number(r.speed_kph || 0),
          speed: r.speed_kph != null ? `${r.speed_kph} km/h` : "—",
          note: r.ping_minutes != null ? `Last ping ${r.ping_minutes} min ago` : "No ping data",
          lastPingMinutes: r.ping_minutes,
          stale: r.stale_ping,
          hasGps: r.has_gps,
          overspeed: r.overspeed,
          tripId: r.trip_id,
          tripCode: r.trip_code,
          eta: r.eta ? fmtDate(r.eta) : "—",
          etaRaw: rawDateTime(r.eta),
          etaRisk: r.eta_risk,
          driverJobStatus: driverStatusDisplay(r.driver_job_status),
          failedDeliveryReason: r.failed_delivery_reason || "",
          status: r.status.replace("_", " "),
          rawStatus: r.status,
          tone: vTone[r.status] || "neutral"
        };
      }),
      exceptions: [
        ...trackingRows
          .filter(r => r.driver_job_status === "failed_delivery" || r.driver_job_status === "declined")
          .slice(0, 4)
          .map(r => ({
            title: r.driver_job_status === "declined"
              ? `${r.trip_code || r.registration_number} declined by driver`
              : `${r.trip_code || r.registration_number} failed delivery`,
            description: r.failed_delivery_reason || (r.driver_job_status === "declined"
              ? "Driver declined the assigned job from the driver panel."
              : "Driver marked the delivery as failed from the driver panel."),
            tone: "danger",
            vehicleId: r.id
          })),
        ...trackingRows
          .filter(r => r.eta_risk || r.overspeed)
          .slice(0, 4)
          .map(r => ({
            title: r.eta_risk ? `${r.trip_code || r.registration_number} ETA risk` : `${r.registration_number} speed risk`,
            description: r.eta_risk
              ? `ETA has passed for an active trip. Current vehicle status is ${r.status.replace("_", " ")}.`
              : `Current speed is ${r.speed_kph || 0} km/h, above the 90 km/h review threshold.`,
            tone: "danger",
            vehicleId: r.id
          })),
        ...trackingRows
          .filter(r => r.stale_ping)
          .slice(0, 4)
          .map(r => ({
            title: `${r.registration_number} stale ping`,
            description: r.last_ping_at
              ? `Last GPS ping was ${r.ping_minutes} minutes ago.`
              : "No GPS ping has been recorded for this vehicle.",
            tone: "warning",
            vehicleId: r.id
          })),
        ...exceptionRows.map(r => ({
        title: r.title,
        description: r.description,
        tone: severityTone(r.severity)
        }))
      ]
    });
  } catch (error) {
    res.status(500).json({ message: "Tracking data error", error: error.message });
  }
};

exports.getTrackingVehicleById = async (req, res) => {
  try {
    await ensureVehicleGpsSchema();

    const { id } = req.params;
    const [[vehicle]] = await db.query(
      `SELECT v.*,
              t.id AS trip_id, t.trip_code, t.dispatch_status, t.planned_departure, t.eta, t.dock_window,
              r.origin_hub, r.destination_hub,
              d.full_name AS driver_name, d.phone AS driver_phone
       FROM vehicles v
       LEFT JOIN trips t ON t.vehicle_id = v.id AND t.dispatch_status IN ('loading','active','planned')
       LEFT JOIN routes r ON r.id = t.route_id
       LEFT JOIN drivers d ON d.id = t.driver_id
       WHERE v.id = ?
       ORDER BY FIELD(t.dispatch_status, 'active', 'loading', 'planned')`,
      [id]
    );

    if (!vehicle) return res.status(404).json({ message: "Vehicle not found." });

    const mins = vehicle.last_ping_at
      ? Math.round((Date.now() - new Date(vehicle.last_ping_at)) / 60000)
      : null;
    const tone = { available: "success", planned: "neutral", in_transit: "success", maintenance: "danger", stopped: "danger" };

    res.json({
      id: vehicle.id,
      registrationNumber: vehicle.registration_number,
      fleetCode: vehicle.fleet_code,
      modelName: vehicle.model_name,
      truckType: vehicle.truck_type,
      status: vehicle.status,
      statusLabel: vehicle.status.replace("_", " "),
      tone: tone[vehicle.status] || "neutral",
      currentLocation: vehicle.current_location || "",
      latitude: vehicle.gps_latitude != null ? Number(vehicle.gps_latitude) : null,
      longitude: vehicle.gps_longitude != null ? Number(vehicle.gps_longitude) : null,
      accuracy: vehicle.gps_accuracy_m != null ? Number(vehicle.gps_accuracy_m) : null,
      accuracyLabel: vehicle.gps_accuracy_m != null ? `±${Math.round(Number(vehicle.gps_accuracy_m))} m` : "Accuracy unknown",
      speedKph: vehicle.speed_kph,
      lastPingAt: fmtDate(vehicle.last_ping_at),
      lastPingAtRaw: rawDateTime(vehicle.last_ping_at),
      lastPingMinutes: mins,
      stale: mins == null || mins > 15,
      trip: vehicle.trip_id ? {
        id: vehicle.trip_id,
        code: vehicle.trip_code,
        status: vehicle.dispatch_status,
        lane: vehicle.origin_hub && vehicle.destination_hub ? `${vehicle.origin_hub} → ${vehicle.destination_hub}` : "Route TBD",
        departure: fmtDate(vehicle.planned_departure),
        eta: fmtDate(vehicle.eta),
        dockWindow: vehicle.dock_window || "—"
      } : null,
      driver: vehicle.driver_name ? {
        name: vehicle.driver_name,
        phone: vehicle.driver_phone
      } : null,
      form: {
        current_location: vehicle.current_location || "",
        speed_kph: vehicle.speed_kph || 0,
        status: vehicle.status,
        gps_latitude: vehicle.gps_latitude || "",
        gps_longitude: vehicle.gps_longitude || "",
        gps_accuracy_m: vehicle.gps_accuracy_m || ""
      }
    });
  } catch (error) {
    res.status(500).json({ message: "Tracking vehicle detail error", error: error.message });
  }
};

exports.updateTrackingVehicle = async (req, res) => {
  try {
    const { id } = req.params;
    const { current_location, speed_kph, status, mark_ping_now, gps_latitude, gps_longitude, gps_accuracy_m } = req.body;
    const valid = ["available", "planned", "in_transit", "maintenance", "stopped"];
    if (status && !valid.includes(status)) {
      return res.status(400).json({ message: "Invalid vehicle status." });
    }

    const [[vehicle]] = await db.query("SELECT id, last_ping_at FROM vehicles WHERE id = ?", [id]);
    if (!vehicle) return res.status(404).json({ message: "Vehicle not found." });

    await db.query(
      `UPDATE vehicles SET
         current_location=?,
         speed_kph=?,
         status=?,
         gps_latitude=?,
         gps_longitude=?,
         gps_accuracy_m=?,
         last_ping_at=?
       WHERE id=?`,
      [
        current_location || null,
        speed_kph != null ? speed_kph : 0,
        status || "available",
        gps_latitude !== "" && gps_latitude != null ? gps_latitude : null,
        gps_longitude !== "" && gps_longitude != null ? gps_longitude : null,
        gps_accuracy_m !== "" && gps_accuracy_m != null ? gps_accuracy_m : null,
        mark_ping_now ? new Date() : vehicle.last_ping_at,
        id
      ]
    );

    emitDriverLocationUpdate({ vehicleId: Number(id), source: "admin-manual-update" });
    res.json({ message: "Tracking updated." });
  } catch (error) {
    res.status(500).json({ message: "Tracking update error", error: error.message });
  }
};

exports.getAlerts = async (req, res) => {
  try {
    await ensureDriverOpsSchema();

    const [[counts]] = await db.query(
      `SELECT COUNT(*) as total,
        COALESCE(SUM(severity='critical'), 0) as critical,
        COALESCE(SUM(severity='high'), 0) as high,
        COALESCE(SUM(alert_status='open'), 0) as open,
        COALESCE(SUM(alert_status='watch'), 0) as watch,
        COALESCE(SUM(alert_status='resolved'), 0) as resolved
       FROM control_room_alerts`
    );
    const [alertRows] = await db.query(
      `SELECT id, alert_code, module_name, title, description, severity, alert_status,
              owner_name, trip_id, driver_id, vehicle_id, created_at
       FROM control_room_alerts
       ORDER BY alert_status='resolved' ASC,
                FIELD(severity,'critical','high','medium','low'),
                created_at DESC
       LIMIT 40`
    );
    const [failedRows] = await db.query(
      `SELECT t.id, t.trip_code, t.failed_delivery_reason, d.full_name
       FROM trips t
       LEFT JOIN drivers d ON d.id = t.driver_id
       WHERE t.driver_job_status='failed_delivery'
       ORDER BY t.actual_arrival DESC, t.created_at DESC LIMIT 6`
    );
    const [defectRows] = await db.query(
      `SELECT dr.id, dr.vehicle_id, dr.defect_type, dr.description, dr.severity, dr.reported_by, dr.status,
              v.registration_number
       FROM defect_reports dr
       LEFT JOIN vehicles v ON v.id = dr.vehicle_id
       WHERE dr.status != 'resolved'
       ORDER BY FIELD(dr.severity,'critical','high','medium','low'), dr.reported_at DESC LIMIT 8`
    );

    const persistedAlerts = alertRows.map(r => ({
      id: r.id,
      code: r.alert_code,
      module: r.module_name,
      title: r.title,
      description: cleanAlertCopy(r.description),
      status: r.alert_status,
      owner: r.owner_name || "Unassigned",
      tone: severityTone(r.severity),
      severity: r.severity,
      tripId: r.trip_id,
      driverId: r.driver_id,
      vehicleId: r.vehicle_id,
      created: fmtDateTime(r.created_at),
      source: "Control room"
    }));
    const liveAlerts = [
      ...failedRows.map(r => ({
        id: null,
        code: `FAILED-${r.id}`,
        module: "trips",
        title: `${r.trip_code} failed delivery`,
        description: `${r.full_name || "Driver"} reported: ${r.failed_delivery_reason || "No reason added."}`,
        tone: "danger",
        severity: "critical",
        status: "open",
        owner: "Dispatch desk",
        tripId: r.id,
        created: "Live driver feed",
        source: "Driver panel"
      })),
      ...defectRows.map(r => ({
        id: null,
        code: `DEFECT-${r.id}`,
        module: "vehicles",
        title: `${r.registration_number || "Vehicle"} defect: ${r.defect_type}`,
        description: `${r.description || "No description."} Reported by ${r.reported_by || "driver"}.`,
        tone: severityTone(r.severity),
        severity: r.severity,
        status: "open",
        owner: "Workshop desk",
        vehicleId: r.vehicle_id,
        created: "Live defect feed",
        source: "Driver panel"
      }))
    ];
    const allAlerts = [...liveAlerts, ...persistedAlerts];
    const openAlerts = allAlerts.filter(item => item.status === "open");
    const resolutionRows = persistedAlerts.filter(item => item.status === "watch");
    const resolvedRows = persistedAlerts.filter(item => item.status === "resolved").slice(0, 6);
    const openCritical = openAlerts.filter(item => item.severity === "critical").length;

    res.json({
      header: {
        badge: "Control room alerts",
        title: "Delay, breakdown and compliance escalations",
        description: "Monitor live exceptions, assign ownership, and close the loop on operational escalations."
      },
      highlights: [
        "Critical driver, vehicle, billing, finance, and tracking exceptions are prioritized automatically.",
        "Watch items stay assigned to an owner until the desk marks them resolved.",
        "Every alert keeps context links so admins can jump back to the affected job or vehicle."
      ],
      stats: [
        { label: "Total alerts", value: Number(counts.total) + liveAlerts.length, description: "Database alerts plus live driver feeds.", change: "Live control room", tone: "neutral" },
        { label: "Critical open", value: openCritical, description: "Immediate action required.", change: "Prioritise now", tone: openCritical ? "danger" : "success" },
        { label: "Watch queue", value: counts.watch, description: "Assigned items under active resolution.", change: "Owned work", tone: counts.watch ? "warning" : "success" },
        { label: "Resolved", value: counts.resolved, description: "Closed-loop alerts.", change: "Audit trail", tone: "success" }
      ],
      operations: [
        { label: "Open queue", value: openAlerts.length, description: "Unresolved live and database alerts.", change: "Desk load", tone: openAlerts.length ? "warning" : "success" },
        { label: "High severity", value: Number(counts.high), description: "High priority database alerts.", change: "Escalated", tone: counts.high ? "warning" : "success" },
        { label: "Assigned owners", value: persistedAlerts.filter(item => item.owner !== "Unassigned").length, description: "Alerts with named ownership.", change: "Accountable", tone: "success" },
        { label: "Closure rate", value: `${Number(counts.total) ? Math.round((Number(counts.resolved) / Number(counts.total)) * 100) : 0}%`, description: "Resolved share of database alerts.", change: "KPI", tone: Number(counts.resolved) ? "success" : "neutral" }
      ],
      alerts: openAlerts.slice(0, 14),
      resolutions: resolutionRows.map(r => ({
        id: r.id,
        reference: r.code,
        owner: r.owner,
        action: r.title,
        note: r.description,
        status: r.status,
        module: r.module,
        severity: r.severity,
        tripId: r.tripId,
        vehicleId: r.vehicleId,
        tone: r.tone
      })),
      resolved: resolvedRows,
      allAlerts
    });
  } catch (error) {
    res.status(500).json({ message: "Alerts data error", error: error.message });
  }
};

exports.updateAlertStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { alert_status, owner_name } = req.body;
    const validStatuses = ["open", "watch", "resolved"];
    if (!validStatuses.includes(alert_status)) {
      return res.status(400).json({ message: "Invalid alert status." });
    }

    const [result] = await db.query(
      `UPDATE control_room_alerts
       SET alert_status = ?, owner_name = COALESCE(NULLIF(?, ''), owner_name)
       WHERE id = ?`,
      [alert_status, owner_name || null, id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ message: "Alert not found." });

    res.json({ message: "Alert status updated.", alert_status });
  } catch (error) {
    res.status(500).json({ message: "Alert update error", error: error.message });
  }
};

exports.getTrips = async (req, res) => {
  try {
    await ensureDriverOpsSchema();
    await ensureTrailerSchema();
    await ensureSoftDeleteSchema();

    const [[counts]] = await db.query(
      `SELECT COUNT(*) as total,
        COALESCE(SUM(dispatch_status IN ('loading','active')), 0) as active,
        COALESCE(SUM(dispatch_status='planned'), 0) as planned,
        COALESCE(SUM(dispatch_status='blocked'), 0) as blocked,
        COALESCE(SUM(driver_id IS NULL OR vehicle_id IS NULL OR trailer_id IS NULL), 0) as assignment_gaps,
        COALESCE(SUM(eta IS NOT NULL AND eta < NOW() AND dispatch_status IN ('planned','loading','active')), 0) as eta_risk,
        COALESCE(SUM(freight_amount_gbp), 0) as freight_value
       FROM trips
       WHERE deleted_at IS NULL`
    );
    const [tripRows] = await db.query(
      `SELECT t.id, t.trip_code, t.client_name, t.dispatch_status, t.dock_window, t.eta, t.planned_departure,
              t.freight_amount_gbp, t.priority_level, t.driver_job_status,
              r.origin_hub, r.destination_hub, r.distance_km, r.standard_eta_hours,
              v.registration_number,
              tr.trailer_code, tr.registration_number AS trailer_registration,
              d.full_name as driver_name
       FROM trips t
       LEFT JOIN routes r ON t.route_id = r.id
       LEFT JOIN vehicles v ON t.vehicle_id = v.id
       LEFT JOIN trailers tr ON t.trailer_id = tr.id
       LEFT JOIN drivers d ON t.driver_id = d.id
       WHERE t.deleted_at IS NULL
       ORDER BY t.created_at DESC LIMIT 20`
    );

    const dispatchTone = { active: "success", loading: "warning", blocked: "danger", planned: "neutral", completed: "neutral" };

    const routes = tripRows.map(r => ({
      id: r.id,
      trip: r.trip_code,
      clientName: r.client_name || "Internal dispatch",
      lane: r.origin_hub && r.destination_hub ? `${r.origin_hub} → ${r.destination_hub}` : "Route TBD",
      schedule: r.planned_departure ? `Departure ${fmtDate(r.planned_departure)}` : "Schedule pending",
      departureRaw: rawDateTime(r.planned_departure),
      eta: r.eta ? fmtDate(r.eta) : "—",
      etaRaw: rawDateTime(r.eta),
      etaRisk: r.eta && new Date(r.eta).getTime() < Date.now() && ["planned", "loading", "active"].includes(r.dispatch_status),
      vehicle: r.registration_number || "Unassigned",
      trailer: r.trailer_registration || r.trailer_code || "No trailer assigned",
      driver: r.driver_name || "Unassigned",
      assignmentGap: !r.driver_name || !r.registration_number || !(r.trailer_registration || r.trailer_code),
      freight: fmtAmount(r.freight_amount_gbp),
      freightValue: Number(r.freight_amount_gbp || 0),
      priority: r.priority_level || "standard",
      driverJobStatus: driverStatusDisplay(r.driver_job_status),
      status: r.dispatch_status,
      tone: dispatchTone[r.dispatch_status] || "neutral"
    }));

    const docks = tripRows.filter(r => r.dock_window).map(r => ({
      id: r.id,
      trip: r.trip_code,
      warehouse: r.destination_hub || "TBD",
      window: r.dock_window,
      note: r.eta ? `ETA ${fmtDate(r.eta)}` : "ETA pending",
      etaRisk: r.eta && new Date(r.eta).getTime() < Date.now() && ["planned", "loading", "active"].includes(r.dispatch_status),
      status: r.dispatch_status === "active" ? "Slot confirmed" : r.dispatch_status === "blocked" ? "On hold" : "Pre-booked",
      tone: dispatchTone[r.dispatch_status] || "neutral"
    }));

    const allocations = tripRows.map(r => ({
      id: r.id,
      vehicle: r.registration_number || "Unassigned",
      trailer: r.trailer_registration || r.trailer_code || "No trailer assigned",
      trip: r.trip_code,
      driver: r.driver_name || "Unassigned",
      note: r.standard_eta_hours ? `${r.trailer_registration || r.trailer_code || "No trailer"} · Est. ${r.standard_eta_hours}h · ${r.distance_km || "—"} km` : r.trailer_registration || r.trailer_code || "Details TBD",
      assignmentGap: !r.driver_name || !r.registration_number || !(r.trailer_registration || r.trailer_code),
      etaRisk: r.eta && new Date(r.eta).getTime() < Date.now() && ["planned", "loading", "active"].includes(r.dispatch_status),
      status: r.dispatch_status,
      tone: dispatchTone[r.dispatch_status] || "neutral"
    }));

    res.json({
      header: {
        badge: "Trip / route planning",
        title: "Dispatch routes and dock scheduling",
        description: "Run lane planning, dispatch scheduling, dock windows, and vehicle assignments from one workspace."
      },
      highlights: [
        "A full lane-wise view of active and planned trips is available in one place.",
        "Dock windows and warehouse slot conflicts are visible in real time.",
        "The vehicle allocation queue auto-updates with fleet sync."
      ],
      stats: [
        { label: "Total trips", value: counts.total, description: "All trips in system.", change: "Live from database", tone: "neutral" },
        { label: "Active", value: counts.active, description: "Currently on road.", change: "Live from database", tone: "success" },
        { label: "Planned", value: counts.planned, description: "Scheduled, not dispatched.", change: "Live from database", tone: "warning" },
        { label: "Blocked", value: counts.blocked, description: "Trips needing resolution.", change: "Live from database", tone: "danger" }
      ],
      dispatchHealth: [
        { label: "Freight value", value: fmtAmount(counts.freight_value), description: "Total trip value.", change: "GBP", tone: "neutral" },
        { label: "Assignment gaps", value: counts.assignment_gaps, description: "Missing driver, truck, or trailer.", change: "Fleet desk", tone: counts.assignment_gaps ? "danger" : "success" },
        { label: "ETA risk", value: counts.eta_risk, description: "ETA passed on open trips.", change: "Timing watch", tone: counts.eta_risk ? "danger" : "success" },
        { label: "Blocked queue", value: counts.blocked, description: "Trips needing resolution.", change: "Dispatch action", tone: counts.blocked ? "danger" : "success" }
      ],
      routes,
      docks,
      allocations
    });
  } catch (error) {
    res.status(500).json({ message: "Trips data error", error: error.message });
  }
};

exports.getTripFormData = async (req, res) => {
  try {
    await ensureTrailerSchema();
    await ensureSoftDeleteSchema();

    const [drivers] = await db.query(
      `SELECT id, full_name, employee_code, phone, shift_status, compliance_status
       FROM drivers
       WHERE compliance_status != 'blocked'
       ORDER BY shift_status='ready' DESC, full_name ASC`
    );
    const [vehicles] = await db.query(
      `SELECT id, registration_number, fleet_code, model_name, truck_type, status
       FROM vehicles
       ORDER BY status='available' DESC, registration_number ASC`
    );
    const [routes] = await db.query(
      `SELECT id, route_code, origin_hub, destination_hub, distance_km, standard_eta_hours, toll_estimate_gbp
       FROM routes
       WHERE status IN ('planned','approved','active','blocked')
       ORDER BY origin_hub ASC`
    );
    const [trailers] = await db.query(
      `SELECT id, trailer_code, registration_number, trailer_type, capacity_tonnes, status
       FROM trailers
       ORDER BY status='available' DESC, trailer_code ASC`
    );

    res.json({ drivers, vehicles, routes, trailers });
  } catch (error) {
    res.status(500).json({ message: "Form data error", error: error.message });
  }
};

exports.listRoutes = async (_req, res) => {
  try {
    await ensureSoftDeleteSchema();
    const [[counts]] = await db.query(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(status='active'), 0) AS active,
              COALESCE(SUM(status='planned'), 0) AS planned,
              COALESCE(SUM(status='blocked'), 0) AS blocked
       FROM routes`
    );
    const [rows] = await db.query(
      `SELECT r.*, COUNT(t.id) AS trip_count
       FROM routes r
       LEFT JOIN trips t ON t.route_id = r.id AND t.deleted_at IS NULL
       GROUP BY r.id
       ORDER BY r.created_at DESC`
    );

    const statusTone = { draft: "neutral", planned: "warning", approved: "success", active: "success", blocked: "danger" };

    res.json({
      stats: [
        { label: "Total routes", value: counts.total, tone: "neutral" },
        { label: "Active", value: counts.active, tone: "success" },
        { label: "Planned", value: counts.planned, tone: "warning" },
        { label: "Blocked", value: counts.blocked, tone: "danger" }
      ],
      routes: rows.map(r => ({
        id: r.id,
        routeCode: r.route_code,
        originHub: r.origin_hub,
        destinationHub: r.destination_hub,
        distanceKm: r.distance_km,
        tollEstimateGbp: r.toll_estimate_gbp,
        standardEtaHours: r.standard_eta_hours,
        status: r.status,
        tone: statusTone[r.status] || "neutral",
        tripCount: r.trip_count
      }))
    });
  } catch (error) {
    res.status(500).json({ message: "Routes data error", error: error.message });
  }
};

exports.createRoute = async (req, res) => {
  try {
    const {
      route_code,
      origin_hub,
      destination_hub,
      distance_km,
      toll_estimate_gbp,
      standard_eta_hours,
      status
    } = req.body;

    if (!route_code || !origin_hub || !destination_hub || !distance_km) {
      return res.status(400).json({ message: "route_code, origin_hub, destination_hub, and distance_km are required." });
    }

    const [result] = await db.query(
      `INSERT INTO routes
         (route_code, origin_hub, destination_hub, distance_km, toll_estimate_gbp, standard_eta_hours, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        route_code,
        origin_hub,
        destination_hub,
        distance_km,
        toll_estimate_gbp || 0,
        standard_eta_hours || 0,
        status || "planned"
      ]
    );

    res.status(201).json({ message: "Route created.", id: result.insertId });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: "Route code already exists." });
    }
    res.status(500).json({ message: "Route create error", error: error.message });
  }
};

exports.updateRoute = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      route_code,
      origin_hub,
      destination_hub,
      distance_km,
      toll_estimate_gbp,
      standard_eta_hours,
      status
    } = req.body;

    const [[existing]] = await db.query("SELECT id FROM routes WHERE id = ?", [id]);
    if (!existing) return res.status(404).json({ message: "Route not found." });

    await db.query(
      `UPDATE routes SET
         route_code=?, origin_hub=?, destination_hub=?, distance_km=?,
         toll_estimate_gbp=?, standard_eta_hours=?, status=?
       WHERE id=?`,
      [
        route_code,
        origin_hub,
        destination_hub,
        distance_km,
        toll_estimate_gbp || 0,
        standard_eta_hours || 0,
        status || "planned",
        id
      ]
    );

    res.json({ message: "Route updated." });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: "Route code already exists." });
    }
    res.status(500).json({ message: "Route update error", error: error.message });
  }
};

exports.deleteRoute = async (req, res) => {
  try {
    const { id } = req.params;
    await ensureSoftDeleteSchema();
    const [[usage]] = await db.query("SELECT COUNT(*) AS total FROM trips WHERE route_id = ? AND deleted_at IS NULL", [id]);
    if (usage.total > 0) {
      return res.status(409).json({ message: "Route is assigned to trips. Block it instead of deleting." });
    }

    await db.query("DELETE FROM routes WHERE id = ?", [id]);
    res.json({ message: "Route deleted." });
  } catch (error) {
    res.status(500).json({ message: "Route delete error", error: error.message });
  }
};

exports.createTrip = async (req, res) => {
  try {
    await ensureDriverOpsSchema();
    await ensureTrailerSchema();
    await ensureSoftDeleteSchema();
    const {
      route_id,
      vehicle_id,
      trailer_id,
      driver_id,
      client_name,
      planned_departure,
      dock_window,
      freight_amount,
      priority_level,
      dispatcher_notes
    } = req.body;

    if (!route_id || !vehicle_id || !trailer_id || !driver_id || !planned_departure) {
      return res.status(400).json({ message: "route_id, vehicle_id, trailer_id, driver_id, and planned_departure are required." });
    }

    const [[route]] = await db.query("SELECT * FROM routes WHERE id = ?", [route_id]);
    if (!route) return res.status(404).json({ message: "Route not found." });
    const [[trailer]] = await db.query("SELECT id FROM trailers WHERE id = ?", [trailer_id]);
    if (!trailer) return res.status(404).json({ message: "Trailer not found." });

    const etaMs = new Date(planned_departure).getTime() + route.standard_eta_hours * 3600 * 1000;
    const eta = new Date(etaMs);

    const tripCode = `${route.route_code}-${Date.now().toString().slice(-5)}`;

    const [result] = await db.query(
      `INSERT INTO trips
         (trip_code, route_id, vehicle_id, trailer_id, driver_id, client_name, dispatch_status,
          priority_level, planned_departure, eta, dock_window, pod_status, freight_amount_gbp, dispatcher_notes, driver_job_status)
       VALUES (?, ?, ?, ?, ?, ?, 'planned', ?, ?, ?, ?, 'pending', ?, ?, 'offered')`,
      [
        tripCode, route_id, vehicle_id, trailer_id, driver_id,
        client_name || "Internal dispatch",
        priority_level || "standard",
        planned_departure,
        eta,
        dock_window || null,
        freight_amount || null,
        dispatcher_notes || null
      ]
    );

    await db.query(
      `UPDATE vehicles
       SET status='planned', current_location=NULL, speed_kph=0,
           gps_latitude=NULL, gps_longitude=NULL, gps_accuracy_m=NULL, last_ping_at=NULL
       WHERE id=?`,
      [vehicle_id]
    );
    await db.query("UPDATE trailers SET status='planned' WHERE id=?", [trailer_id]);

    const [[newTrip]] = await db.query(
      `SELECT t.*, r.origin_hub, r.destination_hub, r.distance_km, r.standard_eta_hours,
              v.registration_number, d.full_name as driver_name
       FROM trips t
       JOIN routes r ON t.route_id = r.id
       JOIN vehicles v ON t.vehicle_id = v.id
       JOIN drivers d ON t.driver_id = d.id
       WHERE t.id = ?`,
      [result.insertId]
    );

    await logActivity(req, {
      module: "trips",
      action: "create",
      entityType: "trip",
      entityId: result.insertId,
      entityLabel: tripCode,
      details: { client_name: client_name || "Internal dispatch", route_id, vehicle_id, trailer_id, driver_id }
    });

    res.status(201).json({ message: "Trip assigned successfully.", trip: newTrip });
  } catch (error) {
    res.status(500).json({ message: "Trip create error", error: error.message });
  }
};

exports.updateTrip = async (req, res) => {
  const conn = await db.getConnection();
  try {
    await ensureDriverOpsSchema();
    await ensureTrailerSchema();
    await ensureSoftDeleteSchema();
    const { id } = req.params;
    const {
      route_id,
      vehicle_id,
      trailer_id,
      driver_id,
      client_name,
      planned_departure,
      dock_window,
      freight_amount,
      priority_level,
      dispatcher_notes
    } = req.body;

    if (!route_id || !vehicle_id || !trailer_id || !driver_id || !planned_departure) {
      return res.status(400).json({ message: "route_id, vehicle_id, trailer_id, driver_id, and planned_departure are required." });
    }

    const [[existing]] = await conn.query("SELECT * FROM trips WHERE id = ? AND deleted_at IS NULL", [id]);
    if (!existing) return res.status(404).json({ message: "Trip not found." });

    const [[route]] = await conn.query("SELECT * FROM routes WHERE id = ?", [route_id]);
    if (!route) return res.status(404).json({ message: "Route not found." });
    const [[trailer]] = await conn.query("SELECT id FROM trailers WHERE id = ?", [trailer_id]);
    if (!trailer) return res.status(404).json({ message: "Trailer not found." });

    const etaMs = new Date(planned_departure).getTime() + route.standard_eta_hours * 3600 * 1000;
    const eta = new Date(etaMs);

    await conn.beginTransaction();

    if (existing.vehicle_id && String(existing.vehicle_id) !== String(vehicle_id)) {
      await conn.query("UPDATE vehicles SET status='available' WHERE id=?", [existing.vehicle_id]);
    }
    if (existing.trailer_id && String(existing.trailer_id) !== String(trailer_id)) {
      await conn.query("UPDATE trailers SET status='available' WHERE id=?", [existing.trailer_id]);
    }

    await conn.query(
      `UPDATE trips SET
         route_id=?, vehicle_id=?, trailer_id=?, driver_id=?, client_name=?, priority_level=?,
         planned_departure=?, eta=?, dock_window=?, freight_amount_gbp=?, dispatcher_notes=?,
         driver_job_status=IF(? = 1, 'offered', driver_job_status)
       WHERE id=? AND deleted_at IS NULL`,
      [
        route_id,
        vehicle_id,
        trailer_id,
        driver_id,
        client_name || "Internal dispatch",
        priority_level || "standard",
        planned_departure,
        eta,
        dock_window || null,
        freight_amount || 0,
        dispatcher_notes || null,
        String(existing.driver_id || "") !== String(driver_id || "") && driver_id ? 1 : 0,
        id
      ]
    );

    const assignmentChanged = String(existing.vehicle_id || "") !== String(vehicle_id || "") || String(existing.trailer_id || "") !== String(trailer_id || "") || String(existing.driver_id || "") !== String(driver_id || "");
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
      [
        vehicleStatusForTrip(existing.dispatch_status),
        assignmentChanged ? 1 : 0,
        assignmentChanged ? 1 : 0,
        assignmentChanged ? 1 : 0,
        assignmentChanged ? 1 : 0,
        assignmentChanged ? 1 : 0,
        assignmentChanged ? 1 : 0,
        vehicle_id
      ]
    );
    await conn.query("UPDATE trailers SET status=? WHERE id=?", [trailerStatusForTrip(existing.dispatch_status), trailer_id]);

    await conn.commit();
    const after = {
      ...existing,
      route_id,
      vehicle_id,
      trailer_id,
      driver_id,
      client_name: client_name || "Internal dispatch",
      priority_level: priority_level || "standard",
      planned_departure,
      dock_window: dock_window || null,
      freight_amount_gbp: freight_amount || 0,
      dispatcher_notes: dispatcher_notes || null
    };
    await logActivity(req, {
      module: "trips",
      action: "update",
      entityType: "trip",
      entityId: id,
      details: {
        route_id,
        vehicle_id,
        trailer_id,
        driver_id,
        client_name: client_name || "Internal dispatch",
        changes: buildChangeSet(existing, after, ["route_id", "vehicle_id", "trailer_id", "driver_id", "client_name", "priority_level", "planned_departure", "dock_window", "freight_amount_gbp"])
      }
    });
    res.json({ message: "Trip updated." });
  } catch (error) {
    await conn.rollback();
    res.status(500).json({ message: "Trip update error", error: error.message });
  } finally {
    conn.release();
  }
};

exports.updateTripStatus = async (req, res) => {
  try {
    await ensureTrailerSchema();
    await ensureSoftDeleteSchema();

    const { id } = req.params;
    const { status } = req.body;
    const valid = ["planned", "loading", "active", "blocked", "completed"];
    if (!valid.includes(status)) {
      return res.status(400).json({ message: "Invalid trip status." });
    }

    const [[trip]] = await db.query("SELECT id, vehicle_id, trailer_id, dispatch_status FROM trips WHERE id = ? AND deleted_at IS NULL", [id]);
    if (!trip) return res.status(404).json({ message: "Trip not found." });

    await db.query("UPDATE trips SET dispatch_status=? WHERE id=? AND deleted_at IS NULL", [status, id]);
    if (trip.vehicle_id) {
      await db.query("UPDATE vehicles SET status=? WHERE id=?", [vehicleStatusForTrip(status), trip.vehicle_id]);
    }
    if (trip.trailer_id) {
      await db.query("UPDATE trailers SET status=? WHERE id=?", [trailerStatusForTrip(status), trip.trailer_id]);
    }

    await logActivity(req, {
      module: "trips",
      action: "status_update",
      entityType: "trip",
      entityId: id,
      details: { status, changes: buildChangeSet(trip, { ...trip, dispatch_status: status }, ["dispatch_status"]) }
    });

    emitJobUpdate({ jobId: Number(id), source: "dispatch-status", status });

    res.json({ message: "Trip status updated." });
  } catch (error) {
    res.status(500).json({ message: "Trip status update error", error: error.message });
  }
};

exports.deleteTrip = async (req, res) => {
  const conn = await db.getConnection();
  try {
    await ensureTrailerSchema();
    await ensureSoftDeleteSchema();

    const { id } = req.params;
    const reasonCheck = requireDeleteReason(req);
    if (!reasonCheck.ok) return res.status(400).json({ message: reasonCheck.message });

    const [[trip]] = await conn.query("SELECT id, trip_code, vehicle_id, trailer_id, client_name FROM trips WHERE id = ? AND deleted_at IS NULL", [id]);
    if (!trip) return res.status(404).json({ message: "Trip not found." });

    await conn.beginTransaction();
    const actor = await getActor(req);
    await conn.query(
      "UPDATE trips SET deleted_at=NOW(), deleted_by=?, delete_reason=? WHERE id = ? AND deleted_at IS NULL",
      [actor.id, reasonCheck.reason, id]
    );
    if (trip.vehicle_id) {
      await conn.query("UPDATE vehicles SET status='available' WHERE id = ?", [trip.vehicle_id]);
    }
    if (trip.trailer_id) {
      await conn.query("UPDATE trailers SET status='available' WHERE id = ?", [trip.trailer_id]);
    }
    await conn.commit();

    await logActivity(req, {
      module: "trips",
      action: "delete",
      entityType: "trip",
      entityId: id,
      entityLabel: trip.trip_code,
      reason: reasonCheck.reason,
      reasonCategory: reasonCheck.reasonCategory,
      details: { client_name: trip.client_name, vehicle_id: trip.vehicle_id, trailer_id: trip.trailer_id }
    });

    res.json({ message: "Trip deleted." });
  } catch (error) {
    await conn.rollback();
    res.status(500).json({ message: "Trip delete error", error: error.message });
  } finally {
    conn.release();
  }
};

exports.getTripById = async (req, res) => {
  try {
    await ensureTrailerSchema();
    await ensureSoftDeleteSchema();

    const { id } = req.params;
    const [[trip]] = await db.query(
      `SELECT t.*, r.origin_hub, r.destination_hub, r.distance_km, r.standard_eta_hours,
              r.toll_estimate_gbp, r.route_code,
              v.registration_number, v.model_name, v.truck_type, v.fleet_code,
              tr.trailer_code, tr.registration_number AS trailer_registration,
              tr.trailer_type, tr.capacity_tonnes AS trailer_capacity_tonnes,
              d.full_name as driver_name, d.phone as driver_phone,
              d.employee_code, d.license_number, d.compliance_status
       FROM trips t
       LEFT JOIN routes r ON t.route_id = r.id
       LEFT JOIN vehicles v ON t.vehicle_id = v.id
       LEFT JOIN trailers tr ON t.trailer_id = tr.id
       LEFT JOIN drivers d ON t.driver_id = d.id
       WHERE t.id = ? AND t.deleted_at IS NULL`,
      [id]
    );

    if (!trip) return res.status(404).json({ message: "Trip not found." });

    const dispatchTone = { active: "success", loading: "warning", blocked: "danger", planned: "neutral", completed: "neutral" };

    res.json({
      id: trip.id,
      tripCode: trip.trip_code,
      status: trip.dispatch_status,
      tone: dispatchTone[trip.dispatch_status] || "neutral",
      priority: trip.priority_level,
      clientName: trip.client_name,
      form: {
        route_id: trip.route_id,
        vehicle_id: trip.vehicle_id,
        trailer_id: trip.trailer_id,
        driver_id: trip.driver_id,
        planned_departure: rawDateTime(trip.planned_departure),
        dock_window: trip.dock_window || "",
        freight_amount: trip.freight_amount_gbp,
        priority_level: trip.priority_level,
        client_name: trip.client_name || ""
      },
      dispatcherNotes: trip.dispatcher_notes || "—",
      route: {
        code: trip.route_code,
        from: trip.origin_hub,
        to: trip.destination_hub,
        distanceKm: trip.distance_km,
        etaHours: trip.standard_eta_hours,
        tollEstimate: fmtAmount(trip.toll_estimate_gbp)
      },
      vehicle: {
        registration: trip.registration_number,
        model: trip.model_name,
        type: trip.truck_type,
        fleetCode: trip.fleet_code
      },
      trailer: {
        code: trip.trailer_code,
        registration: trip.trailer_registration,
        type: trip.trailer_type,
        capacityTonnes: trip.trailer_capacity_tonnes
      },
      driver: {
        name: trip.driver_name,
        phone: trip.driver_phone,
        employeeCode: trip.employee_code,
        license: trip.license_number,
        compliance: trip.compliance_status
      },
      schedule: {
        departure: fmtDate(trip.planned_departure),
        eta: fmtDate(trip.eta),
        dockWindow: trip.dock_window || "—"
      },
      freight: {
        amount: fmtAmount(trip.freight_amount_gbp),
        podStatus: trip.pod_status
      }
    });
  } catch (error) {
    res.status(500).json({ message: "Trip detail error", error: error.message });
  }
};

exports.getNotifications = async (req, res) => {
  try {
    await ensureDriverOpsSchema();
    await ensureEmployeeAuthSchema();
    await ensureActivitySchema();
    await ensureSessionSchema();
    await ensureSoftDeleteSchema();
    await ensureNotificationAckSchema();

    const [employeeRows] = await db.query(
      `SELECT id, name, department, job_title
       FROM users
       WHERE role='employee' AND approval_status='pending'
       ORDER BY created_at DESC LIMIT 5`
    );
    const [failedRows] = await db.query(
      `SELECT t.id, t.trip_code, t.failed_delivery_reason, d.full_name
       FROM trips t
       LEFT JOIN drivers d ON d.id = t.driver_id
       WHERE t.driver_job_status = 'failed_delivery'
         AND t.deleted_at IS NULL
       ORDER BY t.created_at DESC LIMIT 5`
    );
    const [defectRows] = await db.query(
      `SELECT dr.id, dr.defect_type, dr.severity, dr.reported_by,
              v.registration_number
       FROM defect_reports dr
       LEFT JOIN vehicles v ON v.id = dr.vehicle_id
       WHERE dr.status != 'resolved'
       ORDER BY FIELD(dr.severity,'critical','high','medium','low'), dr.reported_at DESC LIMIT 5`
    );
    const [overdueRows] = await db.query(
      `SELECT id, invoice_no, client_name, amount_gbp
       FROM invoices WHERE payment_status = 'overdue' AND deleted_at IS NULL
       ORDER BY due_date ASC LIMIT 4`
    );
    const [staleRows] = await db.query(
      `SELECT v.id, v.registration_number
       FROM vehicles v
       WHERE v.status = 'in_transit'
         AND (v.last_ping_at IS NULL OR v.last_ping_at < NOW() - INTERVAL 15 MINUTE)
       LIMIT 4`
    );
    const [auditRows] = await db.query(
      `SELECT id, actor_name, module_key, entity_type, entity_label, reason, created_at
       FROM activity_logs
       WHERE action_key='delete'
       ORDER BY created_at DESC LIMIT 6`
    );

    const notifications = [
      ...employeeRows.map(r => ({
        id: `employee-${r.id}`,
        type: "info",
        title: `Employee access request: ${r.name}`,
        body: `${r.job_title || "Employee"} requested ${r.department || "TMS"} access.`,
        link: "/admin/employees"
      })),
      ...failedRows.map(r => ({
        id: `failed-${r.id}`,
        type: "danger",
        title: `Failed delivery: ${r.trip_code}`,
        body: r.failed_delivery_reason || `Driver ${r.full_name || ""} reported a failed delivery.`,
        link: `/admin/trips/${r.id}`
      })),
      ...defectRows.map(r => ({
        id: `defect-${r.id}`,
        type: r.severity === "critical" || r.severity === "high" ? "danger" : "warning",
        title: `Defect report: ${r.registration_number || "Vehicle"}`,
        body: `${r.defect_type} — ${r.severity} severity. Reported by ${r.reported_by || "driver"}.`,
        link: `/admin/tracking`
      })),
      ...overdueRows.map(r => ({
        id: `inv-${r.id}`,
        type: "warning",
        title: `Overdue invoice: ${r.invoice_no}`,
        body: `${r.client_name} owes £${Number(r.amount_gbp).toLocaleString("en-GB", { minimumFractionDigits: 2 })}`,
        link: `/admin/billing/${r.id}`
      })),
      ...staleRows.map(r => ({
        id: `stale-${r.id}`,
        type: "warning",
        title: `Stale GPS: ${r.registration_number}`,
        body: "No GPS ping for over 15 minutes while in transit.",
        link: `/admin/tracking/vehicles/${r.id}`
      })),
      ...auditRows.map(r => ({
        id: `audit-${r.id}`,
        type: "danger",
        title: `${r.actor_name || "Employee"} deleted ${r.entity_type || "record"}`,
        body: `${r.entity_label || r.module_key} removed from ${r.module_key}. Reason: ${r.reason || "No reason recorded"}.`,
        link: "/admin/activity"
      }))
    ];

    const actor = await getActor(req);
    const ids = notifications.map(item => item.id);
    let acknowledged = new Set();
    if (ids.length) {
      const [ackRows] = await db.query(
        `SELECT notification_id FROM notification_acknowledgements
         WHERE user_id <=> ? AND notification_id IN (${ids.map(() => "?").join(",")})`,
        [actor.id, ...ids]
      );
      acknowledged = new Set(ackRows.map(row => row.notification_id));
    }
    const enriched = notifications.map(item => ({ ...item, acknowledged: acknowledged.has(item.id) }));

    res.json({ count: enriched.filter(item => !item.acknowledged).length, notifications: enriched });
  } catch (error) {
    res.status(500).json({ message: "Notifications error", error: error.message });
  }
};

exports.acknowledgeNotification = async (req, res) => {
  try {
    await ensureNotificationAckSchema();
    const notificationId = String(req.params.id || "").trim();
    if (!notificationId) return res.status(400).json({ message: "Notification id is required." });
    const actor = await getActor(req);
    await db.query(
      `INSERT IGNORE INTO notification_acknowledgements (notification_id, user_id) VALUES (?, ?)`,
      [notificationId, actor.id]
    );
    res.json({ message: "Notification acknowledged." });
  } catch (error) {
    res.status(500).json({ message: "Notification acknowledge error", error: error.message });
  }
};

exports.getActivityReport = async (req, res) => {
  try {
    await ensureActivitySchema();
    await ensureSessionSchema();
    const { employeeId, module, action, from, to } = req.query;
    const where = [];
    const params = [];

    if (employeeId) {
      where.push("actor_user_id = ?");
      params.push(employeeId);
    }
    if (module) {
      where.push("module_key = ?");
      params.push(module);
    }
    if (action) {
      where.push("action_key = ?");
      params.push(action);
    }
    if (from) {
      where.push("created_at >= ?");
      params.push(`${from} 00:00:00`);
    }
    if (to) {
      where.push("created_at <= ?");
      params.push(`${to} 23:59:59`);
    }

    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const [rows] = await db.query(
      `SELECT id, actor_user_id, actor_name, actor_role, module_key, action_key,
              entity_type, entity_id, entity_label, reason, reason_category, details,
              previous_hash, entry_hash, ip_address, created_at
       FROM activity_logs
       ${clause}
       ORDER BY created_at DESC
       LIMIT 300`,
      params
    );
    const [employees] = await db.query(
      `SELECT id, name, email FROM users WHERE role='employee' ORDER BY name ASC`
    );
    const [[summary]] = await db.query(
      `SELECT
        COUNT(*) AS total,
        COALESCE(SUM(action_key='login'), 0) AS logins,
        COALESCE(SUM(action_key='create'), 0) AS created,
        COALESCE(SUM(action_key='delete'), 0) AS deleted
       FROM activity_logs`
    );
    const [sessions] = await db.query(
      `SELECT s.id, s.user_id, u.name, u.email, s.role, s.login_at, s.logout_at, s.last_activity_at,
              TIMESTAMPDIFF(MINUTE, s.login_at, COALESCE(s.logout_at, s.last_activity_at, NOW())) AS duration_minutes
       FROM user_sessions s
       LEFT JOIN users u ON u.id = s.user_id
       ORDER BY s.login_at DESC LIMIT 80`
    );

    res.json({
      summary: [
        { label: "Total events", value: summary.total, description: "All tracked portal activity.", change: "Audit trail", tone: "neutral" },
        { label: "Logins", value: summary.logins, description: "Successful portal login events.", change: "Session trail", tone: "success" },
        { label: "Records added", value: summary.created, description: "Create actions across panels.", change: "Additions", tone: "neutral" },
        { label: "Records deleted", value: summary.deleted, description: "Delete actions with reasons.", change: "Reason required", tone: summary.deleted ? "danger" : "success" }
      ],
      employees,
      modules: ["employee_portal", "jobs", "trips", "finance", "billing", "employees"],
      actions: ["login", "logout", "view", "create", "update", "status_update", "delete", "restore", "access_update"],
      reasonCategories: ["duplicate", "client_request", "incorrect_amount", "wrong_assignment", "compliance_issue", "data_correction", "other"],
      sessions: sessions.map(s => ({
        id: s.id,
        userId: s.user_id,
        name: s.name || "Unknown user",
        email: s.email || "",
        role: s.role || "user",
        loginAt: fmtDateTime(s.login_at),
        logoutAt: fmtDateTime(s.logout_at),
        lastActivityAt: fmtDateTime(s.last_activity_at),
        durationMinutes: Number(s.duration_minutes || 0),
        active: !s.logout_at
      })),
      logs: rows.map(row => ({
        id: row.id,
        employeeId: row.actor_user_id,
        actorName: row.actor_name || "System",
        actorRole: row.actor_role || "system",
        module: row.module_key,
        action: row.action_key,
        entityType: row.entity_type || "record",
        entityId: row.entity_id,
        entityLabel: row.entity_label || row.entity_id || "—",
        reason: row.reason || "",
        reasonCategory: row.reason_category || "",
        details: parseJsonValue(row.details),
        hashVerified: Boolean(row.entry_hash),
        entryHash: row.entry_hash || "",
        previousHash: row.previous_hash || "",
        canRestore: row.action_key === "delete" && ["invoice", "payout", "trip"].includes(row.entity_type),
        ipAddress: row.ip_address || "—",
        at: fmtDateTime(row.created_at),
        atRaw: row.created_at
      }))
    });
  } catch (error) {
    res.status(500).json({ message: "Activity report error", error: error.message });
  }
};

exports.restoreActivityRecord = async (req, res) => {
  try {
    await ensureActivitySchema();
    await ensureSoftDeleteSchema();
    const { id } = req.params;
    const [[log]] = await db.query(
      `SELECT id, action_key, entity_type, entity_id, entity_label
       FROM activity_logs WHERE id = ?`,
      [id]
    );

    if (!log || log.action_key !== "delete") {
      return res.status(404).json({ message: "Restorable delete event not found." });
    }

    const tableByType = {
      invoice: "invoices",
      payout: "vendor_payouts",
      trip: "trips"
    };
    const table = tableByType[log.entity_type];
    if (!table) return res.status(400).json({ message: "This record type cannot be restored." });

    if (log.entity_type === "trip") {
      const [[trip]] = await db.query(
        "SELECT id, vehicle_id, trailer_id FROM trips WHERE id=? AND deleted_at IS NOT NULL",
        [log.entity_id]
      );
      if (!trip) return res.status(409).json({ message: "Trip is already active or no longer exists." });
      if (trip.vehicle_id) {
        const [[vehicleConflict]] = await db.query(
          `SELECT id, trip_code FROM trips
           WHERE id<>? AND vehicle_id=? AND deleted_at IS NULL AND dispatch_status IN ('planned','loading','active')
           LIMIT 1`,
          [log.entity_id, trip.vehicle_id]
        );
        if (vehicleConflict) return res.status(409).json({ message: `Vehicle is already assigned to ${vehicleConflict.trip_code}.` });
      }
      if (trip.trailer_id) {
        const [[trailerConflict]] = await db.query(
          `SELECT id, trip_code FROM trips
           WHERE id<>? AND trailer_id=? AND deleted_at IS NULL AND dispatch_status IN ('planned','loading','active')
           LIMIT 1`,
          [log.entity_id, trip.trailer_id]
        );
        if (trailerConflict) return res.status(409).json({ message: `Trailer is already assigned to ${trailerConflict.trip_code}.` });
      }
    }

    const [result] = await db.query(
      `UPDATE ${table}
       SET deleted_at=NULL, deleted_by=NULL, delete_reason=NULL
       WHERE id=? AND deleted_at IS NOT NULL`,
      [log.entity_id]
    );

    if (result.affectedRows === 0) {
      return res.status(409).json({ message: "Record is already active or no longer exists." });
    }

    await logActivity(req, {
      module: "activity",
      action: "restore",
      entityType: log.entity_type,
      entityId: log.entity_id,
      entityLabel: log.entity_label,
      details: { restoredFromLogId: log.id }
    });

    res.json({ message: "Record restored." });
  } catch (error) {
    res.status(500).json({ message: "Restore error", error: error.message });
  }
};

exports.getOverview = async (req, res) => {
  try {
    await ensureTrailerSchema();
    await ensureDriverOpsSchema();
    await ensureEmployeeAuthSchema();
    await ensureSoftDeleteSchema();

    const [[drivers]] = await db.query("SELECT COUNT(*) AS total, COALESCE(SUM(shift_status='ready' AND compliance_status='clear'),0) AS available FROM drivers");
    const [[vehicles]] = await db.query("SELECT COUNT(*) AS total, COALESCE(SUM(status='available'),0) AS available FROM vehicles");
    const [[trips]] = await db.query(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(dispatch_status IN ('loading','active')),0) AS active,
              COALESCE(SUM(dispatch_status='planned'),0) AS pending,
              COALESCE(SUM(dispatch_status='completed'),0) AS completed,
              COALESCE(SUM(dispatch_status='blocked'),0) AS cancelled,
              COALESCE(SUM(eta IS NOT NULL AND eta < NOW() AND dispatch_status IN ('planned','loading','active')),0) AS delayed_count
       FROM trips WHERE deleted_at IS NULL`
    );
    const [[invoices]] = await db.query(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(payment_status!='paid'),0) AS pending,
              COALESCE(SUM(CASE WHEN DATE(created_at)=CURDATE() THEN amount_gbp ELSE 0 END),0) AS today_revenue,
              COALESCE(SUM(CASE WHEN payment_status='paid' THEN amount_gbp ELSE 0 END),0) AS paid_revenue
       FROM invoices WHERE deleted_at IS NULL`
    );
    const [[expenses]] = await db.query(
      `SELECT COALESCE(SUM(CASE WHEN expense_type='fuel' THEN amount_gbp ELSE 0 END),0) AS fuel_expense,
              COALESCE(SUM(amount_gbp),0) AS total_expense
       FROM driver_expenses`
    );
    const profitLoss = Number(invoices.paid_revenue || 0) - Number(expenses.total_expense || 0);
    const [employeeRows] = await db.query(
      `SELECT id, name, email, employee_code, department, job_title, approval_status, access_modules
       FROM users
       WHERE role='employee'
       ORDER BY approval_status='pending' DESC, created_at DESC
       LIMIT 6`
    );
    const [driverQueueRows] = await db.query(
      `SELECT full_name, employee_code, shift_status, compliance_status, onboarding_status
       FROM drivers
       WHERE compliance_status != 'clear' OR shift_status != 'ready' OR onboarding_status IN ('new','docs_pending')
       ORDER BY compliance_status='blocked' DESC, compliance_status='review' DESC, full_name ASC
       LIMIT 6`
    );
    const [tripPlanRows] = await db.query(
      `SELECT t.id, t.trip_code, t.dispatch_status, t.planned_departure, t.priority_level,
              r.origin_hub, r.destination_hub,
              v.registration_number,
              tr.trailer_code, tr.registration_number AS trailer_registration,
              d.full_name AS driver_name
       FROM trips t
       LEFT JOIN routes r ON t.route_id = r.id
       LEFT JOIN vehicles v ON t.vehicle_id = v.id
       LEFT JOIN trailers tr ON t.trailer_id = tr.id
       LEFT JOIN drivers d ON t.driver_id = d.id
       WHERE t.dispatch_status != 'completed' AND t.deleted_at IS NULL
       ORDER BY FIELD(t.priority_level, 'critical', 'priority', 'standard'), t.planned_departure ASC
       LIMIT 6`
    );
    const [financeRows] = await db.query(
      `SELECT invoice_no, client_name, amount_gbp, due_date, payment_status
       FROM invoices
       WHERE payment_status != 'paid' AND deleted_at IS NULL
       ORDER BY due_date ASC
       LIMIT 6`
    );
    const [trackingRows] = await db.query(
      `SELECT v.registration_number, v.current_location, v.speed_kph, v.last_ping_at, v.status,
              d.full_name AS driver_name,
              t.eta
       FROM vehicles v
       LEFT JOIN trips t ON t.vehicle_id = v.id AND t.dispatch_status IN ('planned','loading','active')
       LEFT JOIN drivers d ON d.id = t.driver_id
       ORDER BY v.status IN ('in_transit','planned') DESC, v.last_ping_at DESC
       LIMIT 12`
    );
    const [alertRows] = await db.query(
      `SELECT title, description, severity
       FROM control_room_alerts
       WHERE alert_status != 'resolved'
       ORDER BY FIELD(severity, 'critical', 'high', 'medium', 'low'), created_at DESC
       LIMIT 6`
    );

    const complianceTone = { clear: "success", review: "warning", blocked: "danger" };
    const dispatchTone = { active: "success", loading: "warning", blocked: "danger", planned: "neutral", completed: "neutral" };
    const invoiceTone = { paid: "success", overdue: "danger", pending: "warning", sent: "warning", hold: "danger", draft: "neutral" };
    const vehicleTone = { available: "success", planned: "neutral", in_transit: "success", maintenance: "danger", stopped: "danger" };

    res.json({
      header: {
        badge: "Admin control tower",
        title: "Transport management system admin panel",
        description: "Manage fleet, drivers, routes, billing, and live truck movement from one admin workspace."
      },
      highlights: [
        "Admins get a consolidated view of dispatch, compliance, finance, and live tracking.",
        "Driver approvals, trip planning, and truck availability are visible in one control layer.",
        "Live dashboard data is coming from the database."
      ],
      stats: [
        { label: "Total bookings / jobs", value: trips.total, description: "All transport jobs.", change: "Live from database", tone: "neutral" },
        { label: "Active trips", value: trips.active, description: "Loading or on road.", change: "Execution", tone: "success" },
        { label: "Pending trips", value: trips.pending, description: "Planned dispatch queue.", change: "Dispatch", tone: "warning" },
        { label: "Completed trips", value: trips.completed, description: "Delivered and closed.", change: "Closed loop", tone: "neutral" },
        { label: "Cancelled trips", value: trips.cancelled, description: "Blocked/cancelled trips.", change: "Needs review", tone: trips.cancelled ? "danger" : "success" },
        { label: "Available drivers", value: drivers.available, description: "Ready and compliant.", change: "Assignable", tone: "success" },
        { label: "Available vehicles", value: vehicles.available, description: "Fleet assets ready.", change: "Assignable", tone: "success" },
        { label: "Delayed deliveries", value: trips.delayed_count, description: "ETA passed on open trips.", change: "Timing watch", tone: trips.delayed_count ? "danger" : "success" },
        { label: "Today's revenue", value: fmtAmount(invoices.today_revenue), description: "Invoices raised today.", change: "Today", tone: "success" },
        { label: "Pending invoices", value: invoices.pending, description: "Invoices not marked paid.", change: "Collections", tone: invoices.pending ? "warning" : "success" },
        { label: "Fuel expense", value: fmtAmount(expenses.fuel_expense), description: "Driver fuel expense logs.", change: "Cost control", tone: "warning" },
        { label: "Profit / loss", value: fmtAmount(profitLoss), description: "Paid revenue minus expenses.", change: profitLoss >= 0 ? "Profit" : "Loss", tone: profitLoss >= 0 ? "success" : "danger" }
      ],
      modules: [
        {
          title: "Employee Access Control",
          description: "Approve employee registrations and assign finance, dispatch, jobs, tracking, or billing access.",
          path: "/admin/employees"
        },
        {
          title: "Driver Management",
          description: "Driver onboarding, document expiry, shift readiness, and trip allocation approvals.",
          path: "/admin/drivers"
        },
        {
          title: "Finance Management",
          description: "Collections follow-up, vendor payouts, cash flow view, and overdue control.",
          path: "/admin/finance"
        },
        {
          title: "Trip / Route Planning",
          description: "Lane planning, dispatch scheduling, dock windows, and vehicle assignment.",
          path: "/admin/trips"
        },
        {
          title: "Vehicle Management",
          description: "Fleet registration, compliance dates, maintenance logs, and defect reporting.",
          path: "/admin/vehicles"
        },
        {
          title: "Maintenance Planner",
          description: "Workshop schedule, 6-week inspections, service due dates, and open defects.",
          path: "/admin/maintenance"
        },
        {
          title: "Invoicing & Billing",
          description: "Freight invoice generation, POD-linked billing, and payment status tracking.",
          path: "/admin/billing"
        },
        {
          title: "GPS / Live Tracking",
          description: "Current location, speed, ETA, and last ping visibility for every active truck.",
          path: "/admin/tracking"
        },
        {
          title: "Control Room Alerts",
          description: "Delay, breakdown, compliance breach, and reassignment escalations.",
          path: "/admin/alerts"
        }
      ],
      employeeRequests: employeeRows.map(e => ({
        id: e.id,
        name: e.name,
        email: e.email,
        identity: `${e.employee_code || "No code"} · ${e.job_title || "Role pending"}`,
        department: e.department || "Not selected",
        status: e.approval_status,
        access: parseAccessModules(e.access_modules),
        tone: e.approval_status === "active" ? "success" : e.approval_status === "rejected" ? "danger" : "warning"
      })),
      driverQueue: driverQueueRows.map(d => ({
        name: d.full_name,
        assignment: `${d.employee_code} · ${d.shift_status.replace("_", " ")}`,
        compliance: d.compliance_status,
        status: d.onboarding_status.replace("_", " "),
        tone: complianceTone[d.compliance_status] || "neutral"
      })),
      tripPlans: tripPlanRows.map(t => ({
        id: t.id,
        route: t.origin_hub && t.destination_hub ? `${t.origin_hub} → ${t.destination_hub}` : t.trip_code,
        vehicle: `${t.registration_number || "Unassigned truck"} · ${t.trailer_registration || t.trailer_code || "No trailer"} · ${t.driver_name || "No driver"}`,
        schedule: t.planned_departure ? fmtDate(t.planned_departure) : "Not scheduled",
        status: t.dispatch_status,
        tone: dispatchTone[t.dispatch_status] || "neutral"
      })),
      finance: financeRows.map(i => ({
        invoice: i.invoice_no,
        client: i.client_name,
        amount: fmtAmount(i.amount_gbp),
        due: fmtDate(i.due_date),
        status: i.payment_status,
        tone: invoiceTone[i.payment_status] || "neutral"
      })),
      trackingBoard: trackingRows.map(v => ({
        truck: v.registration_number,
        driver: v.driver_name || "Unassigned",
        location: v.current_location || "No ping",
        status: v.status.replace("_", " "),
        note: v.speed_kph != null ? `${Number(v.speed_kph)} kph` : "Speed unavailable",
        eta: v.eta ? fmtDate(v.eta) : "—",
        tone: vehicleTone[v.status] || "neutral"
      })),
      alerts: alertRows.map(a => ({
        title: a.title,
        description: a.description,
        tone: severityTone(a.severity)
      }))
    });
  } catch (error) {
    res.status(500).json({
      message: "Dashboard data error",
      error: error.message
    });
  }
};

exports.getEmployees = async (_req, res) => {
  try {
    await ensureEmployeeAuthSchema();

    const [rows] = await db.query(
      `SELECT id, name, email, employee_code, phone, department, job_title,
              approval_status, access_modules, created_at
       FROM users
       WHERE role='employee'
       ORDER BY approval_status='pending' DESC, created_at DESC`
    );

    const employees = rows.map(e => ({
      id: e.id,
      name: e.name,
      email: e.email,
      employeeCode: e.employee_code,
      phone: e.phone,
      department: e.department,
      jobTitle: e.job_title,
      approvalStatus: e.approval_status,
      accessModules: parseAccessModules(e.access_modules),
      createdAt: fmtDate(e.created_at)
    }));

    const counts = employees.reduce((acc, item) => {
      acc.total += 1;
      acc[item.approvalStatus] = (acc[item.approvalStatus] || 0) + 1;
      return acc;
    }, { total: 0, pending: 0, active: 0, rejected: 0 });
    const moduleCoverage = Array.from(employeeModules).map(module => ({
      module,
      label: module.replace("_", " "),
      activeCount: employees.filter(employee => (
        employee.approvalStatus === "active" && employee.accessModules.includes(module)
      )).length
    }));
    const activeWithoutAccess = employees.filter(employee => (
      employee.approvalStatus === "active" && employee.accessModules.length === 0
    )).length;

    res.json({
      header: {
        badge: "Employee access control",
        title: "Admin-controlled employee permissions",
        description: "Approve employee registrations and decide which TMS workspaces each employee can handle."
      },
      highlights: [
        "Employees register themselves with login credentials and work details.",
        "Admin reviews every request before the employee can log in.",
        "Approved employees only see the pages assigned by admin."
      ],
      stats: [
        { label: "Employee requests", value: counts.total, description: "All employee accounts.", change: "Live from users", tone: "neutral" },
        { label: "Waiting approval", value: counts.pending, description: "New registrations needing admin action.", change: "Admin action", tone: "warning" },
        { label: "Active employees", value: counts.active, description: "Can log in to assigned pages.", change: "Access granted", tone: "success" },
        { label: "Rejected", value: counts.rejected, description: "Blocked from employee login.", change: "Access denied", tone: "danger" }
      ],
      accessHealth: [
        { label: "Configured active", value: counts.active - activeWithoutAccess, description: "Active users with at least one page.", change: "Access ready", tone: "success" },
        { label: "Access gaps", value: activeWithoutAccess, description: "Active users without assigned pages.", change: "Needs fix", tone: activeWithoutAccess ? "danger" : "success" },
        { label: "Pages covered", value: moduleCoverage.filter(item => item.activeCount > 0).length, description: "Modules with active users assigned.", change: "Coverage", tone: "neutral" },
        { label: "Pending queue", value: counts.pending, description: "Employees waiting for review.", change: "Admin review", tone: counts.pending ? "warning" : "success" }
      ],
      moduleCoverage,
      modules: Array.from(employeeModules),
      employees
    });
  } catch (error) {
    res.status(500).json({ message: "Employees data error", error: error.message });
  }
};

exports.updateEmployeeAccess = async (req, res) => {
  const id = Number(req.params.id);
  const { approvalStatus, accessModules } = req.body;

  if (!id) {
    return res.status(400).json({ message: "Valid employee id is required." });
  }

  if (!["pending", "active", "rejected"].includes(approvalStatus)) {
    return res.status(400).json({ message: "Valid approval status is required." });
  }

  const cleanModules = Array.isArray(accessModules)
    ? accessModules.filter((module) => employeeModules.has(module))
    : [];
  const savedModules = approvalStatus === "rejected" ? [] : Array.from(new Set(cleanModules));

  if (approvalStatus === "active" && savedModules.length === 0) {
    return res.status(400).json({ message: "Select at least one page before approving employee login." });
  }

  try {
    await ensureEmployeeAuthSchema();
    const [result] = await db.execute(
      `UPDATE users
       SET approval_status = ?, access_modules = ?
       WHERE id = ? AND role='employee'`,
      [approvalStatus, JSON.stringify(savedModules), id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Employee not found." });
    }

    await logActivity(req, {
      module: "employees",
      action: "access_update",
      entityType: "employee",
      entityId: id,
      details: { approvalStatus, accessModules: savedModules }
    });

    res.json({ message: "Employee access updated.", approvalStatus, accessModules: savedModules });
  } catch (error) {
    res.status(500).json({ message: "Employee access update error", error: error.message });
  }
};
