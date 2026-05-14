const db = require("../db/connection");

function severityTone(s) {
  return s === "critical" || s === "high" ? "danger" : s === "medium" ? "warning" : "neutral";
}

function fmtDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
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

async function ensureVehicleGpsSchema() {
  if (vehicleGpsSchemaReady) return;
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

exports.getFinance = async (req, res) => {
  try {
    const [[counts]] = await db.query(
      `SELECT COUNT(*) as total,
        SUM(payment_status='overdue') as overdue,
        SUM(payment_status IN ('pending','sent')) as pending,
        SUM(payment_status='paid') as paid
       FROM invoices`
    );
    const [collectionRows] = await db.query(
      `SELECT invoice_no, client_name, amount_gbp, due_date, payment_status
       FROM invoices WHERE payment_status != 'paid' ORDER BY due_date ASC LIMIT 8`
    );
    const [payoutRows] = await db.query(
      `SELECT payout_reference, vendor_name, lane_code, amount_gbp, due_date, payout_status
       FROM vendor_payouts ORDER BY due_date ASC LIMIT 8`
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
      collections: collectionRows.map(r => ({
        reference: r.invoice_no,
        counterparty: r.client_name,
        amount: fmtAmount(r.amount_gbp),
        due: `Due ${fmtDate(r.due_date)}`,
        status: r.payment_status,
        tone: payTone[r.payment_status] || "neutral"
      })),
      payouts: payoutRows.map(r => ({
        reference: r.payout_reference,
        counterparty: `${r.vendor_name} · ${r.lane_code}`,
        amount: fmtAmount(r.amount_gbp),
        due: `Due ${fmtDate(r.due_date)}`,
        status: r.payout_status,
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

exports.getBilling = async (req, res) => {
  try {
    const [[counts]] = await db.query(
      `SELECT COUNT(*) as total,
        SUM(pod_verified=1) as pod_ok,
        SUM(pod_verified=0) as pod_pending,
        SUM(payment_status='overdue') as overdue
       FROM invoices`
    );
    const [invoiceRows] = await db.query(
      `SELECT id, invoice_no, client_name, amount_gbp, due_date, payment_status, pod_verified, notes
       FROM invoices ORDER BY created_at DESC LIMIT 10`
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
      invoices: invoiceRows.map(r => ({
        id: r.id,
        invoice: r.invoice_no,
        client: r.client_name,
        amount: fmtAmount(r.amount_gbp),
        note: r.pod_verified ? `POD verified · Due ${fmtDate(r.due_date)}` : `POD pending · Due ${fmtDate(r.due_date)}`,
        status: r.payment_status,
        tone: payTone[r.payment_status] || "neutral",
        podVerified: Boolean(r.pod_verified)
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
    const [trips] = await db.query(
      `SELECT t.id, t.trip_code, t.client_name, t.freight_amount_gbp, t.pod_status,
              r.origin_hub, r.destination_hub
       FROM trips t
       LEFT JOIN routes r ON r.id = t.route_id
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
    const { id } = req.params;
    const [[invoice]] = await db.query(
      `SELECT i.*, t.trip_code, t.dispatch_status, t.pod_status,
              r.origin_hub, r.destination_hub
       FROM invoices i
       LEFT JOIN trips t ON t.id = i.trip_id
       LEFT JOIN routes r ON r.id = t.route_id
       WHERE i.id = ?`,
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

    res.status(201).json({ message: "Invoice created.", id: result.insertId });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: "Invoice number already exists." });
    }
    res.status(500).json({ message: "Invoice create error", error: error.message });
  }
};

exports.updateInvoice = async (req, res) => {
  try {
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

    const [[existing]] = await db.query("SELECT id FROM invoices WHERE id = ?", [id]);
    if (!existing) return res.status(404).json({ message: "Invoice not found." });

    if (!invoice_no || !client_name || !amount_gbp || !issued_at || !due_date) {
      return res.status(400).json({ message: "invoice_no, client_name, amount_gbp, issued_at, and due_date are required." });
    }

    await db.query(
      `UPDATE invoices SET
         invoice_no=?, trip_id=?, client_name=?, amount_gbp=?, issued_at=?, due_date=?,
         payment_status=?, pod_verified=?, notes=?
       WHERE id=?`,
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
    const { id } = req.params;
    const { payment_status, pod_verified } = req.body;
    const valid = ["draft", "sent", "pending", "overdue", "paid", "hold"];
    if (payment_status && !valid.includes(payment_status)) {
      return res.status(400).json({ message: "Invalid payment status." });
    }

    const [[invoice]] = await db.query("SELECT id, trip_id, payment_status, pod_verified FROM invoices WHERE id = ?", [id]);
    if (!invoice) return res.status(404).json({ message: "Invoice not found." });

    const nextStatus = payment_status || invoice.payment_status;
    const nextPod = typeof pod_verified === "boolean" ? pod_verified : Boolean(invoice.pod_verified);

    await db.query(
      "UPDATE invoices SET payment_status=?, pod_verified=? WHERE id=?",
      [nextStatus, nextPod ? 1 : 0, id]
    );

    if (invoice.trip_id && nextPod) {
      await db.query("UPDATE trips SET pod_status='verified' WHERE id=?", [invoice.trip_id]);
    }

    res.json({ message: "Invoice status updated." });
  } catch (error) {
    res.status(500).json({ message: "Invoice status update error", error: error.message });
  }
};

exports.deleteInvoice = async (req, res) => {
  try {
    const { id } = req.params;
    await db.query("DELETE FROM invoices WHERE id = ?", [id]);
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
              d.full_name as driver_name
       FROM vehicles v
       LEFT JOIN trips t ON t.vehicle_id = v.id AND t.dispatch_status IN ('planned','loading','active','blocked')
       LEFT JOIN drivers d ON t.driver_id = d.id
       ORDER BY v.last_ping_at DESC LIMIT 50`
    );
    const [exceptionRows] = await db.query(
      `SELECT title, description, severity FROM control_room_alerts
       WHERE module_name='tracking' AND alert_status='open' LIMIT 6`
    );

    const vTone = { in_transit: "success", available: "success", planned: "neutral", maintenance: "danger", stopped: "danger" };

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
      trucks: truckRows.map(r => {
        const mins = r.last_ping_at
          ? Math.round((Date.now() - new Date(r.last_ping_at)) / 60000)
          : null;
        return {
          id: r.id,
          truck: r.registration_number,
          fleetCode: r.fleet_code,
          model: r.model_name,
          driver: r.driver_name || "Unassigned",
          location: r.current_location || "Location unknown",
          latitude: r.gps_latitude != null ? Number(r.gps_latitude) : null,
          longitude: r.gps_longitude != null ? Number(r.gps_longitude) : null,
          accuracy: r.gps_accuracy_m != null ? Number(r.gps_accuracy_m) : null,
          speed: r.speed_kph != null ? `${r.speed_kph} km/h` : "—",
          note: mins != null ? `Last ping ${mins} min ago` : "No ping data",
          stale: mins == null || mins > 15,
          tripId: r.trip_id,
          tripCode: r.trip_code,
          eta: r.eta ? fmtDate(r.eta) : "—",
          driverJobStatus: driverStatusDisplay(r.driver_job_status),
          failedDeliveryReason: r.failed_delivery_reason || "",
          status: r.status.replace("_", " "),
          rawStatus: r.status,
          tone: vTone[r.status] || "neutral"
        };
      }),
      exceptions: [
        ...truckRows
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
        ...truckRows
          .filter(r => !r.last_ping_at || Math.round((Date.now() - new Date(r.last_ping_at)) / 60000) > 15)
          .slice(0, 4)
          .map(r => ({
            title: `${r.registration_number} stale ping`,
            description: r.last_ping_at
              ? `Last GPS ping was ${Math.round((Date.now() - new Date(r.last_ping_at)) / 60000)} minutes ago.`
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
        status: vehicle.status
      }
    });
  } catch (error) {
    res.status(500).json({ message: "Tracking vehicle detail error", error: error.message });
  }
};

exports.updateTrackingVehicle = async (req, res) => {
  try {
    const { id } = req.params;
    const { current_location, speed_kph, status, mark_ping_now } = req.body;
    const valid = ["available", "planned", "in_transit", "maintenance", "stopped"];
    if (status && !valid.includes(status)) {
      return res.status(400).json({ message: "Invalid vehicle status." });
    }

    const [[vehicle]] = await db.query("SELECT id FROM vehicles WHERE id = ?", [id]);
    if (!vehicle) return res.status(404).json({ message: "Vehicle not found." });

    await db.query(
      `UPDATE vehicles SET
         current_location=?,
         speed_kph=?,
         status=?,
         last_ping_at=?
       WHERE id=?`,
      [
        current_location || null,
        speed_kph != null ? speed_kph : 0,
        status || "available",
        mark_ping_now ? new Date() : new Date(),
        id
      ]
    );

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
        SUM(severity='critical') as critical,
        SUM(severity='high') as high,
        SUM(alert_status='resolved') as resolved
       FROM control_room_alerts`
    );
    const [alertRows] = await db.query(
      `SELECT title, description, severity FROM control_room_alerts
       WHERE alert_status='open'
       ORDER BY FIELD(severity,'critical','high','medium','low') LIMIT 10`
    );
    const [resolutionRows] = await db.query(
      `SELECT alert_code, owner_name, title, description, severity, alert_status
       FROM control_room_alerts WHERE alert_status='watch' LIMIT 8`
    );
    const [failedRows] = await db.query(
      `SELECT t.id, t.trip_code, t.failed_delivery_reason, d.full_name
       FROM trips t
       LEFT JOIN drivers d ON d.id = t.driver_id
       WHERE t.driver_job_status='failed_delivery'
       ORDER BY t.actual_arrival DESC, t.created_at DESC LIMIT 6`
    );
    const [defectRows] = await db.query(
      `SELECT dr.id, dr.defect_type, dr.description, dr.severity, dr.reported_by, dr.status,
              v.registration_number
       FROM defect_reports dr
       LEFT JOIN vehicles v ON v.id = dr.vehicle_id
       WHERE dr.status != 'resolved'
       ORDER BY FIELD(dr.severity,'critical','high','medium','low'), dr.reported_at DESC LIMIT 8`
    );

    res.json({
      header: {
        badge: "Control room alerts",
        title: "Delay, breakdown and compliance escalations",
        description: "A dedicated admin view for delay, breakdown, compliance breach, and reassignment escalations."
      },
      highlights: [
        "Critical and high-severity alerts are listed first by priority.",
        "Watch queue items are assigned to owners for active resolution.",
        "Resolved alerts maintain closed-loop accountability."
      ],
      stats: [
        { label: "Total alerts", value: counts.total, description: "All alerts on record.", change: "Live from database", tone: "neutral" },
        { label: "Critical", value: counts.critical, description: "Immediate action required.", change: "Live from database", tone: "danger" },
        { label: "High priority", value: counts.high, description: "Escalated, needs resolution.", change: "Live from database", tone: "warning" },
        { label: "Resolved", value: counts.resolved, description: "Closed alerts.", change: "Live from database", tone: "success" }
      ],
      alerts: [
        ...failedRows.map(r => ({
          title: `${r.trip_code} failed delivery`,
          description: `${r.full_name || "Driver"} reported: ${r.failed_delivery_reason || "No reason added."}`,
          tone: "danger",
          tripId: r.id
        })),
        ...defectRows.map(r => ({
          title: `${r.registration_number || "Vehicle"} defect: ${r.defect_type}`,
          description: `${r.description || "No description."} Reported by ${r.reported_by || "driver"}.`,
          tone: severityTone(r.severity)
        })),
        ...alertRows.map(r => ({
          title: r.title,
          description: r.description,
          tone: severityTone(r.severity)
        }))
      ],
      resolutions: resolutionRows.map(r => ({
        reference: r.alert_code,
        owner: r.owner_name || "Unassigned",
        action: r.title,
        note: r.description,
        status: r.alert_status,
        tone: severityTone(r.severity)
      }))
    });
  } catch (error) {
    res.status(500).json({ message: "Alerts data error", error: error.message });
  }
};

exports.getTrips = async (req, res) => {
  try {
    await ensureTrailerSchema();

    const [[counts]] = await db.query(
      `SELECT COUNT(*) as total,
        COALESCE(SUM(dispatch_status IN ('loading','active')), 0) as active,
        COALESCE(SUM(dispatch_status='planned'), 0) as planned,
        COALESCE(SUM(dispatch_status='blocked'), 0) as blocked
       FROM trips`
    );
    const [tripRows] = await db.query(
      `SELECT t.id, t.trip_code, t.dispatch_status, t.dock_window, t.eta, t.planned_departure,
              r.origin_hub, r.destination_hub, r.distance_km, r.standard_eta_hours,
              v.registration_number,
              tr.trailer_code, tr.registration_number AS trailer_registration,
              d.full_name as driver_name
       FROM trips t
       LEFT JOIN routes r ON t.route_id = r.id
       LEFT JOIN vehicles v ON t.vehicle_id = v.id
       LEFT JOIN trailers tr ON t.trailer_id = tr.id
       LEFT JOIN drivers d ON t.driver_id = d.id
       ORDER BY t.created_at DESC LIMIT 20`
    );

    const dispatchTone = { active: "success", loading: "warning", blocked: "danger", planned: "neutral", completed: "neutral" };

    const routes = tripRows.map(r => ({
      id: r.id,
      trip: r.trip_code,
      lane: r.origin_hub && r.destination_hub ? `${r.origin_hub} → ${r.destination_hub}` : "Route TBD",
      schedule: r.planned_departure ? `Departure ${fmtDate(r.planned_departure)}` : "Schedule pending",
      vehicle: r.registration_number || "Unassigned",
      trailer: r.trailer_registration || r.trailer_code || "No trolley assigned",
      status: r.dispatch_status,
      tone: dispatchTone[r.dispatch_status] || "neutral"
    }));

    const docks = tripRows.filter(r => r.dock_window).map(r => ({
      id: r.id,
      trip: r.trip_code,
      warehouse: r.destination_hub || "TBD",
      window: r.dock_window,
      note: r.eta ? `ETA ${fmtDate(r.eta)}` : "ETA pending",
      status: r.dispatch_status === "active" ? "Slot confirmed" : r.dispatch_status === "blocked" ? "On hold" : "Pre-booked",
      tone: dispatchTone[r.dispatch_status] || "neutral"
    }));

    const allocations = tripRows.map(r => ({
      id: r.id,
      vehicle: r.registration_number || "Unassigned",
      trailer: r.trailer_registration || r.trailer_code || "No trolley assigned",
      trip: r.trip_code,
      driver: r.driver_name || "Unassigned",
      note: r.standard_eta_hours ? `${r.trailer_registration || r.trailer_code || "No trolley"} · Est. ${r.standard_eta_hours}h · ${r.distance_km || "—"} km` : r.trailer_registration || r.trailer_code || "Details TBD",
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
       LEFT JOIN trips t ON t.route_id = r.id
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
    const [[usage]] = await db.query("SELECT COUNT(*) AS total FROM trips WHERE route_id = ?", [id]);
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
    const {
      route_id,
      vehicle_id,
      trailer_id,
      driver_id,
      client_name,
      planned_departure,
      dock_window,
      freight_amount,
      priority_level
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
          priority_level, planned_departure, eta, dock_window, pod_status, freight_amount_gbp, driver_job_status)
       VALUES (?, ?, ?, ?, ?, ?, 'planned', ?, ?, ?, ?, 'pending', ?, 'offered')`,
      [
        tripCode, route_id, vehicle_id, trailer_id, driver_id,
        client_name || "Internal dispatch",
        priority_level || "standard",
        planned_departure,
        eta,
        dock_window || null,
        freight_amount || null
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
      priority_level
    } = req.body;

    if (!route_id || !vehicle_id || !trailer_id || !driver_id || !planned_departure) {
      return res.status(400).json({ message: "route_id, vehicle_id, trailer_id, driver_id, and planned_departure are required." });
    }

    const [[existing]] = await conn.query("SELECT id, vehicle_id, trailer_id, driver_id, dispatch_status FROM trips WHERE id = ?", [id]);
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
         planned_departure=?, eta=?, dock_window=?, freight_amount_gbp=?,
         driver_job_status=IF(? = 1, 'offered', driver_job_status)
       WHERE id=?`,
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

    const { id } = req.params;
    const { status } = req.body;
    const valid = ["planned", "loading", "active", "blocked", "completed"];
    if (!valid.includes(status)) {
      return res.status(400).json({ message: "Invalid trip status." });
    }

    const [[trip]] = await db.query("SELECT id, vehicle_id, trailer_id FROM trips WHERE id = ?", [id]);
    if (!trip) return res.status(404).json({ message: "Trip not found." });

    await db.query("UPDATE trips SET dispatch_status=? WHERE id=?", [status, id]);
    if (trip.vehicle_id) {
      await db.query("UPDATE vehicles SET status=? WHERE id=?", [vehicleStatusForTrip(status), trip.vehicle_id]);
    }
    if (trip.trailer_id) {
      await db.query("UPDATE trailers SET status=? WHERE id=?", [trailerStatusForTrip(status), trip.trailer_id]);
    }

    res.json({ message: "Trip status updated." });
  } catch (error) {
    res.status(500).json({ message: "Trip status update error", error: error.message });
  }
};

exports.deleteTrip = async (req, res) => {
  const conn = await db.getConnection();
  try {
    await ensureTrailerSchema();

    const { id } = req.params;
    const [[trip]] = await conn.query("SELECT id, vehicle_id, trailer_id FROM trips WHERE id = ?", [id]);
    if (!trip) return res.status(404).json({ message: "Trip not found." });

    await conn.beginTransaction();
    await conn.query("DELETE FROM trips WHERE id = ?", [id]);
    if (trip.vehicle_id) {
      await conn.query("UPDATE vehicles SET status='available' WHERE id = ?", [trip.vehicle_id]);
    }
    if (trip.trailer_id) {
      await conn.query("UPDATE trailers SET status='available' WHERE id = ?", [trip.trailer_id]);
    }
    await conn.commit();

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
       WHERE t.id = ?`,
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

    const [failedRows] = await db.query(
      `SELECT t.id, t.trip_code, t.failed_delivery_reason, d.full_name
       FROM trips t
       LEFT JOIN drivers d ON d.id = t.driver_id
       WHERE t.driver_job_status = 'failed_delivery'
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
       FROM invoices WHERE payment_status = 'overdue'
       ORDER BY due_date ASC LIMIT 4`
    );
    const [staleRows] = await db.query(
      `SELECT v.id, v.registration_number
       FROM vehicles v
       WHERE v.status = 'in_transit'
         AND (v.last_ping_at IS NULL OR v.last_ping_at < NOW() - INTERVAL 15 MINUTE)
       LIMIT 4`
    );

    const notifications = [
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
      }))
    ];

    res.json({ count: notifications.length, notifications });
  } catch (error) {
    res.status(500).json({ message: "Notifications error", error: error.message });
  }
};

exports.getOverview = async (req, res) => {
  try {
    await ensureTrailerSchema();

    const [[drivers]] = await db.query("SELECT COUNT(*) AS total FROM drivers");
    const [[vehicles]] = await db.query("SELECT COUNT(*) AS total FROM vehicles");
    const [[trips]] = await db.query("SELECT COUNT(*) AS total FROM trips");
    const [[invoices]] = await db.query("SELECT COUNT(*) AS total FROM invoices");
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
       WHERE t.dispatch_status != 'completed'
       ORDER BY FIELD(t.priority_level, 'critical', 'priority', 'standard'), t.planned_departure ASC
       LIMIT 6`
    );
    const [financeRows] = await db.query(
      `SELECT invoice_no, client_name, amount_gbp, due_date, payment_status
       FROM invoices
       WHERE payment_status != 'paid'
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
        {
          label: "Fleet available",
          value: vehicles.total,
          description: "Total registered vehicles.",
          change: "Live from database",
          tone: "success"
        },
        {
          label: "Drivers ready",
          value: drivers.total,
          description: "Total registered drivers.",
          change: "Live from database",
          tone: "warning"
        },
        {
          label: "Trips in motion",
          value: trips.total,
          description: "Total trips in system.",
          change: "Live from database",
          tone: "neutral"
        },
        {
          label: "Total invoices",
          value: invoices.total,
          description: "Total invoices generated.",
          change: "Live from database",
          tone: "danger"
        }
      ],
      modules: [
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
        vehicle: `${t.registration_number || "Unassigned truck"} · ${t.trailer_registration || t.trailer_code || "No trolley"} · ${t.driver_name || "No driver"}`,
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
