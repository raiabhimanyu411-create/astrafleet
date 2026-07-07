const db = require("../db/connection");

const INSPECTION_INTERVAL_DAYS = 42;
const TRAILER_INSPECTION_INTERVAL_DAYS = 70;
const MAINTENANCE_RULES = {
  "Roller brake test": { days: 42 },
  "Safety inspection": { days: 42 },
  MOT: { months: 12 },
  "Tacho Calibration": { months: 24 },
  "Road Tax": { months: 12 },
  Insurance: { months: 12 },
  "Full Service": { months: 6, mileageKm: 85000 }
};
let schemaSyncPromise;

async function addColumnIfMissing(table, column, definition) {
  const [rows] = await db.query(`SHOW COLUMNS FROM ${table} LIKE ?`, [column]);
  if (rows.length === 0) {
    await db.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

async function modifyColumnBestEffort(table, column, definition) {
  try {
    await db.query(`ALTER TABLE ${table} MODIFY COLUMN ${column} ${definition}`);
  } catch (_err) {
    // Some MySQL setups reject MODIFY when legacy constraints differ; existing installs can still use vehicle jobs.
  }
}

async function syncMaintenanceSchema() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS maintenance_records (
      id             INT AUTO_INCREMENT PRIMARY KEY,
      vehicle_id     INT NOT NULL,
      service_date   DATE NOT NULL,
      service_type   VARCHAR(100) NOT NULL,
      description    TEXT DEFAULT NULL,
      cost_gbp       DECIMAL(10,2) NOT NULL DEFAULT 0,
      mileage        INT DEFAULT NULL,
      next_due_date  DATE DEFAULT NULL,
      garage_name    VARCHAR(120) DEFAULT NULL,
      created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_maintenance_records_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles (id) ON DELETE CASCADE
    ) ENGINE=InnoDB
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS trailer_maintenance_records (
      id             INT AUTO_INCREMENT PRIMARY KEY,
      trailer_id     INT NOT NULL,
      service_date   DATE NOT NULL,
      service_type   VARCHAR(100) NOT NULL,
      description    TEXT DEFAULT NULL,
      cost_gbp       DECIMAL(10,2) NOT NULL DEFAULT 0,
      next_due_date  DATE DEFAULT NULL,
      garage_name    VARCHAR(120) DEFAULT NULL,
      created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_trailer_maintenance_records_trailer FOREIGN KEY (trailer_id) REFERENCES trailers (id) ON DELETE CASCADE
    ) ENGINE=InnoDB
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS vehicle_inspections (
      id              INT AUTO_INCREMENT PRIMARY KEY,
      vehicle_id      INT NOT NULL,
      inspection_date DATE NOT NULL,
      inspection_type VARCHAR(80) NOT NULL DEFAULT 'Routine',
      inspector_name  VARCHAR(120) DEFAULT NULL,
      result          ENUM('pass', 'advisory', 'fail') NOT NULL DEFAULT 'pass',
      notes           TEXT DEFAULT NULL,
      next_due        DATE DEFAULT NULL,
      created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_vehicle_inspections_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles (id) ON DELETE CASCADE
    ) ENGINE=InnoDB
  `);

  await addColumnIfMissing("maintenance_records", "cost_gbp", "DECIMAL(10,2) NOT NULL DEFAULT 0");
  await addColumnIfMissing("maintenance_records", "mileage", "INT DEFAULT NULL");
  await addColumnIfMissing("maintenance_records", "next_due_date", "DATE DEFAULT NULL");
  await addColumnIfMissing("maintenance_records", "garage_name", "VARCHAR(120) DEFAULT NULL");
  await modifyColumnBestEffort("maintenance_records", "service_type", "VARCHAR(100) NOT NULL");

  await addColumnIfMissing("vehicle_inspections", "inspection_type", "VARCHAR(80) NOT NULL DEFAULT 'Routine'");
  await addColumnIfMissing("vehicle_inspections", "inspector_name", "VARCHAR(120) DEFAULT NULL");
  await addColumnIfMissing("vehicle_inspections", "result", "ENUM('pass','advisory','fail') NOT NULL DEFAULT 'pass'");
  await addColumnIfMissing("vehicle_inspections", "notes", "TEXT DEFAULT NULL");
  await addColumnIfMissing("vehicle_inspections", "next_due", "DATE DEFAULT NULL");
  await modifyColumnBestEffort("vehicle_inspections", "driver_id", "INT DEFAULT NULL");
  await modifyColumnBestEffort("vehicle_inspections", "inspection_type", "VARCHAR(80) NOT NULL DEFAULT 'Routine'");

  await addColumnIfMissing("vehicles", "company_name", "VARCHAR(160) DEFAULT NULL");
  await addColumnIfMissing("vehicles", "inspection_frequency_weeks", "INT DEFAULT 6");

  await db.query(`
    CREATE TABLE IF NOT EXISTS defect_reports (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      vehicle_id  INT NOT NULL,
      driver_id   INT DEFAULT NULL,
      trip_id     INT DEFAULT NULL,
      defect_type VARCHAR(80) NOT NULL,
      description TEXT DEFAULT NULL,
      severity    ENUM('low', 'medium', 'high', 'critical') NOT NULL DEFAULT 'medium',
      reported_by VARCHAR(120) DEFAULT NULL,
      status      ENUM('open', 'in_progress', 'resolved') NOT NULL DEFAULT 'open',
      reported_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      resolved_at DATETIME DEFAULT NULL,
      CONSTRAINT fk_defect_reports_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles (id) ON DELETE CASCADE,
      CONSTRAINT fk_defect_reports_driver FOREIGN KEY (driver_id) REFERENCES drivers (id) ON DELETE SET NULL,
      CONSTRAINT fk_defect_reports_trip FOREIGN KEY (trip_id) REFERENCES trips (id) ON DELETE SET NULL
    ) ENGINE=InnoDB
  `);

  await addColumnIfMissing("defect_reports", "driver_id", "INT DEFAULT NULL");
  await addColumnIfMissing("defect_reports", "trip_id", "INT DEFAULT NULL");
  await addColumnIfMissing("defect_reports", "reported_by", "VARCHAR(120) DEFAULT NULL");
  await addColumnIfMissing("defect_reports", "resolved_at", "DATETIME DEFAULT NULL");

  await db.query(`
    CREATE TABLE IF NOT EXISTS maintenance_jobs (
      id                 INT AUTO_INCREMENT PRIMARY KEY,
      job_number         VARCHAR(40) NOT NULL UNIQUE,
      vehicle_id         INT DEFAULT NULL,
      trailer_id         INT DEFAULT NULL,
      asset_type         ENUM('vehicle','trailer') NOT NULL DEFAULT 'vehicle',
      defect_id          INT DEFAULT NULL,
      service_type       VARCHAR(100) NOT NULL,
      due_date           DATE NOT NULL,
      garage_name        VARCHAR(120) DEFAULT NULL,
      assigned_mechanic  VARCHAR(120) DEFAULT NULL,
      estimated_cost_gbp DECIMAL(10,2) NOT NULL DEFAULT 0,
      labour_cost_gbp    DECIMAL(10,2) NOT NULL DEFAULT 0,
      parts_cost_gbp     DECIMAL(10,2) NOT NULL DEFAULT 0,
      final_cost_gbp     DECIMAL(10,2) DEFAULT NULL,
      priority           ENUM('low','normal','high','critical') NOT NULL DEFAULT 'normal',
      status             ENUM('planned','booked','in_progress','completed','cancelled') NOT NULL DEFAULT 'planned',
      notes              TEXT DEFAULT NULL,
      parts_required     TEXT DEFAULT NULL,
      completion_notes   TEXT DEFAULT NULL,
      completed_at       DATETIME DEFAULT NULL,
      created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_maintenance_jobs_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles (id) ON DELETE CASCADE,
      CONSTRAINT fk_maintenance_jobs_defect FOREIGN KEY (defect_id) REFERENCES defect_reports (id) ON DELETE SET NULL
    ) ENGINE=InnoDB
  `);

  await modifyColumnBestEffort("maintenance_jobs", "vehicle_id", "INT DEFAULT NULL");
  await addColumnIfMissing("maintenance_jobs", "trailer_id", "INT DEFAULT NULL");
  await addColumnIfMissing("maintenance_jobs", "asset_type", "ENUM('vehicle','trailer') NOT NULL DEFAULT 'vehicle'");
  await addColumnIfMissing("maintenance_jobs", "defect_id", "INT DEFAULT NULL");
  await addColumnIfMissing("maintenance_jobs", "assigned_mechanic", "VARCHAR(120) DEFAULT NULL");
  await addColumnIfMissing("maintenance_jobs", "labour_cost_gbp", "DECIMAL(10,2) NOT NULL DEFAULT 0");
  await addColumnIfMissing("maintenance_jobs", "parts_cost_gbp", "DECIMAL(10,2) NOT NULL DEFAULT 0");
  await addColumnIfMissing("maintenance_jobs", "final_cost_gbp", "DECIMAL(10,2) DEFAULT NULL");
  await addColumnIfMissing("maintenance_jobs", "parts_required", "TEXT DEFAULT NULL");
  await addColumnIfMissing("maintenance_jobs", "completion_notes", "TEXT DEFAULT NULL");
  await addColumnIfMissing("maintenance_jobs", "completed_at", "DATETIME DEFAULT NULL");
  await addColumnIfMissing("maintenance_jobs", "service_date", "DATE DEFAULT NULL");
  await addColumnIfMissing("maintenance_jobs", "road_tax_interval_months", "INT DEFAULT NULL");
  await addColumnIfMissing("maintenance_jobs", "completed_mileage_km", "INT DEFAULT NULL");
  await addColumnIfMissing("maintenance_jobs", "next_due_mileage_km", "INT DEFAULT NULL");
  await addColumnIfMissing("maintenance_jobs", "bill_number", "VARCHAR(80) DEFAULT NULL");
  await addColumnIfMissing("maintenance_jobs", "bill_date", "DATE DEFAULT NULL");
  await addColumnIfMissing("maintenance_jobs", "bill_amount_gbp", "DECIMAL(10,2) DEFAULT NULL");
  await addColumnIfMissing("maintenance_jobs", "bill_notes", "TEXT DEFAULT NULL");
  await addColumnIfMissing("maintenance_jobs", "bill_attachment_data", "LONGTEXT DEFAULT NULL");
  await addColumnIfMissing("maintenance_jobs", "bill_status", "ENUM('pending','approved','rejected','paid') NOT NULL DEFAULT 'pending'");
  await addColumnIfMissing("maintenance_jobs", "bill_approved_by", "VARCHAR(120) DEFAULT NULL");
  await addColumnIfMissing("maintenance_jobs", "bill_approved_at", "DATETIME DEFAULT NULL");
  await addColumnIfMissing("maintenance_jobs", "bill_payment_status", "ENUM('unpaid','scheduled','paid') NOT NULL DEFAULT 'unpaid'");
  await addColumnIfMissing("maintenance_jobs", "vendor_invoice_ref", "VARCHAR(100) DEFAULT NULL");

  await db.query(`
    CREATE TABLE IF NOT EXISTS maintenance_inventory (
      id              INT AUTO_INCREMENT PRIMARY KEY,
      part_name       VARCHAR(120) NOT NULL,
      category        VARCHAR(80) NOT NULL DEFAULT 'General',
      stock_qty       INT NOT NULL DEFAULT 0,
      reorder_level   INT NOT NULL DEFAULT 0,
      unit_cost_gbp   DECIMAL(10,2) NOT NULL DEFAULT 0,
      supplier        VARCHAR(120) DEFAULT NULL,
      updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_inventory_part (part_name)
    ) ENGINE=InnoDB
  `);

  await db.query(`
    INSERT INTO maintenance_inventory (part_name, category, stock_qty, reorder_level, unit_cost_gbp, supplier)
    VALUES
      ('Tyre 315/70 R22.5', 'Tyres', 8, 4, 245.00, 'Fleet Tyres UK'),
      ('Brake pads axle set', 'Brakes', 5, 3, 180.00, 'BrakeLine Parts'),
      ('Engine oil 20L', 'Service', 12, 6, 72.00, 'Workshop Supplies'),
      ('Oil filter', 'Service', 10, 5, 22.00, 'Workshop Supplies'),
      ('Headlamp bulb', 'Electrical', 14, 6, 9.50, 'Parts Desk')
    ON DUPLICATE KEY UPDATE part_name = VALUES(part_name)
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS vehicle_tyres (
      id                 INT AUTO_INCREMENT PRIMARY KEY,
      vehicle_id         INT NOT NULL,
      position_label     VARCHAR(80) NOT NULL,
      tyre_brand         VARCHAR(80) DEFAULT NULL,
      tread_depth_mm     DECIMAL(4,1) DEFAULT NULL,
      pressure_psi       DECIMAL(5,1) DEFAULT NULL,
      fitted_date        DATE DEFAULT NULL,
      replacement_due    DATE DEFAULT NULL,
      cost_gbp           DECIMAL(10,2) DEFAULT NULL,
      supplier           VARCHAR(120) DEFAULT NULL,
      status             ENUM('ok','monitor','replace') NOT NULL DEFAULT 'ok',
      updated_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_vehicle_tyres_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles (id) ON DELETE CASCADE
    ) ENGINE=InnoDB
  `);

  await db.query(`
    INSERT INTO vehicle_tyres (vehicle_id, position_label, tyre_brand, tread_depth_mm, pressure_psi, status)
    SELECT v.id, positions.position_label, 'Fleet standard', 8.0, 110.0, 'ok'
    FROM vehicles v
    JOIN (
      SELECT 'Front left' AS position_label
      UNION ALL SELECT 'Front right'
      UNION ALL SELECT 'Axle 2 left'
      UNION ALL SELECT 'Axle 2 right'
      UNION ALL SELECT 'Rear left'
      UNION ALL SELECT 'Rear right'
    ) positions
    WHERE NOT EXISTS (
      SELECT 1 FROM vehicle_tyres existing
      WHERE existing.vehicle_id = v.id AND existing.position_label = positions.position_label
    )
  `);

  await addColumnIfMissing("defect_reports", "workflow_status", "ENUM('reported','reviewed','booked','fixed','verified') NOT NULL DEFAULT 'reported'");

  await db.query(`
    CREATE TABLE IF NOT EXISTS driver_odometer_logs (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      driver_id  INT DEFAULT NULL,
      trip_id    INT DEFAULT NULL,
      vehicle_id INT DEFAULT NULL,
      reading_km DECIMAL(10,1) NOT NULL,
      log_type   VARCHAR(20) NOT NULL DEFAULT 'start',
      logged_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB
  `);

  await modifyColumnBestEffort(
    "maintenance_jobs",
    "status",
    "ENUM('planned','booked','in_progress','completed','cancelled','failed') NOT NULL DEFAULT 'planned'"
  );

  await db.query(`
    CREATE TABLE IF NOT EXISTS maintenance_job_notes (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      job_id      INT NOT NULL,
      note_text   TEXT NOT NULL,
      author_name VARCHAR(120) NOT NULL DEFAULT 'Admin',
      created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_job_notes_job FOREIGN KEY (job_id) REFERENCES maintenance_jobs (id) ON DELETE CASCADE
    ) ENGINE=InnoDB
  `);

  // Trailer compliance columns (trailers don't have Road Tax or Tacho in UK)
  await addColumnIfMissing("trailers", "mot_expiry", "DATE DEFAULT NULL");
  await addColumnIfMissing("trailers", "insurance_expiry", "DATE DEFAULT NULL");
  await addColumnIfMissing("trailers", "next_service_due", "DATE DEFAULT NULL");
  await addColumnIfMissing("trailers", "next_inspection_due", "DATE DEFAULT NULL");
  await addColumnIfMissing("trailers", "inspection_frequency_weeks", "INT DEFAULT 10");
  await addColumnIfMissing("trailers", "company_name", "VARCHAR(160) DEFAULT NULL");

  await db.query(`
    CREATE TABLE IF NOT EXISTS trailer_inspections (
      id              INT AUTO_INCREMENT PRIMARY KEY,
      trailer_id      INT NOT NULL,
      inspection_date DATE NOT NULL,
      inspection_type VARCHAR(80) NOT NULL DEFAULT 'Routine',
      inspector_name  VARCHAR(120) DEFAULT NULL,
      result          ENUM('pass', 'advisory', 'fail') NOT NULL DEFAULT 'pass',
      notes           TEXT DEFAULT NULL,
      next_due        DATE DEFAULT NULL,
      created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_trailer_inspections_trailer FOREIGN KEY (trailer_id) REFERENCES trailers (id) ON DELETE CASCADE
    ) ENGINE=InnoDB
  `);

  // Allow trailer defects in defect_reports
  await modifyColumnBestEffort("defect_reports", "vehicle_id", "INT DEFAULT NULL");
  await addColumnIfMissing("defect_reports", "trailer_id", "INT DEFAULT NULL");
  await addColumnIfMissing("defect_reports", "asset_type", "ENUM('vehicle','trailer') NOT NULL DEFAULT 'vehicle'");
}

exports.ensureMaintenanceSchema = async (_req, res, next) => {
  try {
    if (!schemaSyncPromise) schemaSyncPromise = syncMaintenanceSchema();
    await schemaSyncPromise;
    next();
  } catch (err) {
    schemaSyncPromise = null;
    res.status(500).json({ message: "Maintenance schema sync error", error: err.message });
  }
};

function rawDate(d) {
  if (!d) return "";
  if (typeof d === "string") return d.slice(0, 10);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fmtDate(d) {
  if (!d) return "-";
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const date = new Date(dateStr);
  date.setHours(0, 0, 0, 0);
  return Math.ceil((date - today) / (1000 * 60 * 60 * 24));
}

function dueTone(days, openDefects, status) {
  if (status === "stopped" || Number(openDefects || 0) > 0) return "danger";
  if (days === null) return "neutral";
  if (days < 0) return "danger";
  if (days <= 14) return "warning";
  return "success";
}

function dueLabel(days) {
  if (days === null) return "Not scheduled";
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return "Due today";
  return `${days}d left`;
}

function statusFromDays(days) {
  if (days === null) return { label: "Not scheduled", tone: "neutral" };
  if (days < 0) return { label: "Overdue", tone: "danger" };
  if (days <= 7) return { label: "Due now", tone: "danger" };
  if (days <= 30) return { label: "Due soon", tone: "warning" };
  return { label: "OK", tone: "success" };
}

function inspectionStatus(days) {
  if (days === null) return { label: "Not planned", tone: "neutral" };
  if (days < 0) return { label: "Inspection overdue", tone: "danger" };
  if (days <= 7) return { label: "Inspection due", tone: "warning" };
  return { label: "Inspection OK", tone: "success" };
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function addMonths(date, months) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

function startOfWeek(date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  const day = next.getDay() || 7;
  next.setDate(next.getDate() - day + 1);
  return next;
}

function firstPlanMondayForYear(year) {
  const jan1 = new Date(year, 0, 1);
  const firstWeekStart = startOfWeek(jan1);
  return firstWeekStart.getFullYear() < year ? addDays(firstWeekStart, 7) : firstWeekStart;
}

function maintenanceWeekNumber(date) {
  const weekStart = startOfWeek(date);
  const firstMonday = firstPlanMondayForYear(weekStart.getFullYear());
  if (weekStart < firstMonday) {
    const previousFirstMonday = firstPlanMondayForYear(weekStart.getFullYear() - 1);
    return Math.floor((weekStart - previousFirstMonday) / (7 * 24 * 60 * 60 * 1000)) + 1;
  }
  return Math.floor((weekStart - firstMonday) / (7 * 24 * 60 * 60 * 1000)) + 1;
}

function planCodeForType(type) {
  return {
    "Safety inspection": "IB",
    "Roller brake test": "RBT",
    MOT: "MOT",
    "Road Tax": "TAX",
    Insurance: "INS",
    "Tacho Calibration": "T",
    "Full Service": "SRV"
  }[type] || null;
}

function addIntervalForPlan(date, type, roadTaxIntervalMonths = 12, inspectionIntervalDays = INSPECTION_INTERVAL_DAYS) {
  if (["Safety inspection", "Roller brake test"].includes(type)) return addDays(date, inspectionIntervalDays);
  if (type === "Road Tax") return addMonths(date, Number(roadTaxIntervalMonths || 12));
  if (type === "Tacho Calibration") return addMonths(date, 24);
  if (["MOT", "Insurance"].includes(type)) return addMonths(date, 12);
  if (type === "Full Service") return addMonths(date, 6);
  return null;
}

function buildFuturePlanDates(seedDateRaw, type, horizonStart, horizonEnd, roadTaxIntervalMonths, inspectionIntervalDays = INSPECTION_INTERVAL_DAYS) {
  if (!seedDateRaw) return [];
  let cursor = new Date(`${seedDateRaw}T00:00:00`);
  if (Number.isNaN(cursor.getTime())) return [];
  let guard = 0;
  while (cursor < horizonStart && guard < 80) {
    const next = addIntervalForPlan(cursor, type, roadTaxIntervalMonths, inspectionIntervalDays);
    if (!next) break;
    cursor = next;
    guard += 1;
  }
  const dates = [];
  while (cursor <= horizonEnd && guard < 120) {
    dates.push(rawDate(cursor));
    const next = addIntervalForPlan(cursor, type, roadTaxIntervalMonths, inspectionIntervalDays);
    if (!next) break;
    cursor = next;
    guard += 1;
  }
  return dates;
}

function calculateNextDueDate(serviceType, serviceDate, roadTaxIntervalMonths, inspectionIntervalDays = INSPECTION_INTERVAL_DAYS) {
  if (!serviceType || !serviceDate) return "";
  if (serviceType === "Road Tax") {
    return rawDate(addMonths(serviceDate, Number(roadTaxIntervalMonths || 12)));
  }
  const rule = MAINTENANCE_RULES[serviceType];
  if (rule?.days) return rawDate(addDays(serviceDate, inspectionIntervalDays));
  if (rule?.months) return rawDate(addMonths(serviceDate, rule.months));
  return "";
}

function fmtAmount(value) {
  return `£${Number(value || 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function jobTone(status, daysLeft, priority) {
  if (status === "completed") return "success";
  if (status === "cancelled") return "neutral";
  if (status === "failed") return "danger";
  if (priority === "critical" || daysLeft < 0) return "danger";
  if (priority === "high" || daysLeft <= 14) return "warning";
  return "neutral";
}

function priorityTone(priority) {
  return { low: "success", normal: "neutral", high: "warning", critical: "danger" }[priority] || "neutral";
}

async function nextJobNumber() {
  const year = new Date().getFullYear();
  const [[row]] = await db.query(
    `SELECT COALESCE(MAX(CAST(SUBSTRING_INDEX(job_number, '-', -1) AS UNSIGNED)), 0) AS maxNum
     FROM maintenance_jobs WHERE job_number LIKE ?`,
    [`MJ-${year}-%`]
  );
  return `MJ-${year}-${String(Number(row.maxNum || 0) + 1).padStart(4, "0")}`;
}

function cleanJobPayload(body) {
  const encodedAsset = String(body.asset_id || body.assetId || body.vehicle_id || body.vehicleId || "");
  const [encodedType, encodedId] = encodedAsset.includes(":") ? encodedAsset.split(":") : [body.asset_type || body.assetType || "vehicle", encodedAsset];
  const assetType = encodedType === "trailer" ? "trailer" : "vehicle";
  const numericAssetId = Number(encodedId || 0);
  return {
    asset_type: assetType,
    vehicle_id: assetType === "vehicle" ? numericAssetId : null,
    trailer_id: assetType === "trailer" ? numericAssetId : null,
    defect_id: body.defect_id || body.defectId || null,
    service_type: String(body.service_type || body.serviceType || "").trim(),
    due_date: body.due_date || body.dueDate || "",
    garage_name: String(body.garage_name || body.garageName || "").trim() || null,
    assigned_mechanic: String(body.assigned_mechanic || body.assignedMechanic || "").trim() || null,
    estimated_cost_gbp: Number(body.estimated_cost_gbp || body.estimatedCostGbp || 0),
    labour_cost_gbp: Number(body.labour_cost_gbp || body.labourCostGbp || 0),
    parts_cost_gbp: Number(body.parts_cost_gbp || body.partsCostGbp || 0),
    final_cost_gbp: body.final_cost_gbp || body.finalCostGbp || null,
    service_date: body.service_date || body.serviceDate || null,
    road_tax_interval_months: body.road_tax_interval_months || body.roadTaxIntervalMonths || null,
    completed_mileage_km: body.completed_mileage_km || body.completedMileageKm || null,
    next_due_mileage_km: body.next_due_mileage_km || body.nextDueMileageKm || null,
    bill_number: String(body.bill_number || body.billNumber || "").trim() || null,
    bill_date: body.bill_date || body.billDate || null,
    bill_amount_gbp: body.bill_amount_gbp || body.billAmountGbp || null,
    bill_notes: String(body.bill_notes || body.billNotes || "").trim() || null,
    bill_attachment_data: body.bill_attachment_data || body.billAttachmentData || null,
    bill_status: body.bill_status || body.billStatus || "pending",
    bill_payment_status: body.bill_payment_status || body.billPaymentStatus || "unpaid",
    vendor_invoice_ref: String(body.vendor_invoice_ref || body.vendorInvoiceRef || "").trim() || null,
    priority: body.priority || "normal",
    status: body.status || "planned",
    notes: String(body.notes || "").trim() || null,
    parts_required: String(body.parts_required || body.partsRequired || "").trim() || null,
    completion_notes: String(body.completion_notes || body.completionNotes || "").trim() || null
  };
}

async function setAssetWorkshopStatus(assetType, assetId, jobStatus) {
  if (["booked", "in_progress"].includes(jobStatus)) {
    if (assetType === "trailer") {
      await db.query(`UPDATE trailers SET status='maintenance' WHERE id=?`, [assetId]);
    } else {
      await db.query(`UPDATE vehicles SET status='maintenance' WHERE id=?`, [assetId]);
    }
  }
}

function recurringPriority(daysLeft) {
  if (daysLeft !== null && daysLeft < 0) return "critical";
  if (daysLeft !== null && daysLeft <= 7) return "high";
  if (daysLeft !== null && daysLeft <= 30) return "normal";
  return "low";
}

async function ensureRecurringJob(vehicleId, serviceType, dueDate, sourceJobId = null) {
  if (!vehicleId || !serviceType || !dueDate) return null;
  const [[existing]] = await db.query(
    `SELECT id FROM maintenance_jobs
     WHERE vehicle_id=? AND service_type=? AND due_date=? AND status IN ('planned','booked','in_progress')
     LIMIT 1`,
    [vehicleId, serviceType, dueDate]
  );
  if (existing) return existing.id;
  const jobNumber = await nextJobNumber();
  const daysLeft = daysUntil(dueDate);
  const [result] = await db.query(
    `INSERT INTO maintenance_jobs
      (job_number, vehicle_id, service_type, due_date, priority, status)
     VALUES (?, ?, ?, ?, ?, 'planned')`,
    [jobNumber, vehicleId, serviceType, dueDate, recurringPriority(daysLeft)]
  );
  return result.insertId;
}

function isGeneratedMaintenanceNote(note) {
  return /^auto-created/i.test(String(note || "").trim());
}

function isTrailerMaintenanceTypeAllowed(serviceType) {
  return ["Safety inspection", "MOT"].includes(serviceType);
}

async function ensureDefectRepairJob(defect, defaults = {}) {
  const [[existing]] = await db.query(
    `SELECT id FROM maintenance_jobs WHERE defect_id=? AND status != 'cancelled' LIMIT 1`,
    [defect.id]
  );
  if (existing) return { id: existing.id, created: false };

  const due = defaults.dueDate || rawDate(addDays(new Date(), defect.severity === "critical" ? 1 : defect.severity === "high" ? 3 : 7));
  const jobNumber = await nextJobNumber();
  const [result] = await db.query(
    `INSERT INTO maintenance_jobs
      (job_number, vehicle_id, defect_id, service_type, due_date, garage_name, assigned_mechanic,
       estimated_cost_gbp, priority, status, notes, parts_required)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      jobNumber,
      defect.vehicle_id,
      defect.id,
      defaults.serviceType || defect.defect_type,
      due,
      defaults.garageName || null,
      defaults.assignedMechanic || null,
      Number(defaults.estimatedCostGbp || 0),
      defect.severity === "critical" ? "critical" : defect.severity === "high" ? "high" : "normal",
      "booked",
      defect.description || null,
      defaults.partsRequired || null
    ]
  );
  await db.query(`UPDATE defect_reports SET status='in_progress', workflow_status='booked' WHERE id=?`, [defect.id]);
  await db.query(`UPDATE vehicles SET status='maintenance' WHERE id=?`, [defect.vehicle_id]);
  return { id: result.insertId, created: true, jobNumber };
}

async function decrementInventoryFromText(partsText) {
  const text = String(partsText || "").toLowerCase();
  if (!text) return;
  const [parts] = await db.query(`SELECT id, part_name, stock_qty FROM maintenance_inventory`);
  for (const part of parts) {
    if (text.includes(String(part.part_name).toLowerCase())) {
      await db.query(
        `UPDATE maintenance_inventory SET stock_qty=GREATEST(stock_qty - 1, 0) WHERE id=?`,
        [part.id]
      );
    }
  }
}

async function applyCompletedMaintenance(job, completion = {}) {
  const finalCost = Number(completion.finalCost ?? job.final_cost_gbp ?? job.estimated_cost_gbp ?? 0);
  const fallbackNotes = isGeneratedMaintenanceNote(job.completion_notes)
    ? null
    : job.completion_notes || (isGeneratedMaintenanceNote(job.notes) ? null : job.notes);
  const completionNotes = completion.completionNotes ?? fallbackNotes ?? null;
  const serviceDate = completion.serviceDate || job.service_date || rawDate(new Date());
  const nextDueDate = completion.nextDueDate || calculateNextDueDate(job.service_type, serviceDate, job.road_tax_interval_months) || null;
  const completedMileageKm = completion.completedMileageKm || job.completed_mileage_km || null;
  const nextDueMileageKm = completion.nextDueMileageKm || job.next_due_mileage_km || null;
  const billAmountGbp = completion.billAmountGbp || job.bill_amount_gbp || null;

  await db.query(
    `UPDATE maintenance_jobs
     SET status='completed', final_cost_gbp=?, completion_notes=?, service_date=?, completed_mileage_km=?, next_due_mileage_km=?,
         bill_amount_gbp=COALESCE(?, bill_amount_gbp), completed_at=COALESCE(completed_at, NOW())
     WHERE id=?`,
    [finalCost, completionNotes, serviceDate, completedMileageKm, nextDueMileageKm, billAmountGbp, job.id]
  );
  if (job.trailer_id || job.asset_type === "trailer") {
    await db.query(
      `INSERT INTO trailer_maintenance_records (trailer_id, service_date, service_type, description, cost_gbp, next_due_date, garage_name)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [job.trailer_id, serviceDate, job.service_type, completionNotes || job.notes, finalCost, nextDueDate, job.garage_name]
    );
  } else {
    await db.query(
      `INSERT INTO maintenance_records (vehicle_id, service_date, service_type, description, cost_gbp, mileage, next_due_date, garage_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [job.vehicle_id, serviceDate, job.service_type, completionNotes || job.notes, finalCost, completedMileageKm, nextDueDate, job.garage_name]
    );
  }
  await decrementInventoryFromText(job.parts_required);
  if (job.trailer_id || job.asset_type === "trailer") {
    // Trailer maintenance is tracked in job/history records; trailer compliance date columns can be added later if needed.
  } else if (nextDueDate && job.service_type === "MOT") {
    await db.query(`UPDATE vehicles SET mot_expiry=? WHERE id=?`, [nextDueDate, job.vehicle_id]);
  } else if (nextDueDate && job.service_type === "Road Tax") {
    await db.query(`UPDATE vehicles SET road_tax_expiry=? WHERE id=?`, [nextDueDate, job.vehicle_id]);
  } else if (nextDueDate && job.service_type === "Insurance") {
    await db.query(`UPDATE vehicles SET insurance_expiry=? WHERE id=?`, [nextDueDate, job.vehicle_id]);
  } else if (job.service_type === "Full Service") {
    await db.query(`UPDATE vehicles SET next_service_due=? WHERE id=?`, [nextDueDate || null, job.vehicle_id]);
  }
  if (job.trailer_id || job.asset_type === "trailer") {
    if (nextDueDate && job.service_type === "MOT") {
      await db.query(`UPDATE trailers SET mot_expiry=? WHERE id=?`, [nextDueDate, job.trailer_id]);
    } else if (nextDueDate && job.service_type === "Insurance") {
      await db.query(`UPDATE trailers SET insurance_expiry=? WHERE id=?`, [nextDueDate, job.trailer_id]);
    } else if (job.service_type === "Full Service") {
      await db.query(`UPDATE trailers SET next_service_due=? WHERE id=?`, [nextDueDate || null, job.trailer_id]);
    } else if (nextDueDate && ["Safety inspection", "Roller brake test"].includes(job.service_type)) {
      await db.query(`UPDATE trailers SET next_inspection_due=? WHERE id=?`, [nextDueDate, job.trailer_id]);
    }
  }
  if (!job.trailer_id && job.asset_type !== "trailer") {
    await ensureRecurringJob(job.vehicle_id, job.service_type, nextDueDate, job.id);
  }
  if (!job.trailer_id && job.asset_type !== "trailer" && ["Safety inspection", "Roller brake test"].includes(job.service_type)) {
    await db.query(
      `INSERT INTO vehicle_inspections
        (vehicle_id, inspection_date, inspection_type, inspector_name, result, notes, next_due)
       VALUES (?, ?, ?, ?, 'pass', ?, ?)`,
      [job.vehicle_id, serviceDate, job.service_type, job.assigned_mechanic || job.garage_name, completionNotes || job.notes, nextDueDate]
    );
  }
  if (job.trailer_id || job.asset_type === "trailer") {
    await db.query(`UPDATE trailers SET status='available' WHERE id=? AND status='maintenance'`, [job.trailer_id]);
  } else {
    await db.query(`UPDATE vehicles SET status='available' WHERE id=? AND status='maintenance'`, [job.vehicle_id]);
  }
  return { finalCost, completionNotes, serviceDate, nextDueDate, completedMileageKm, nextDueMileageKm, billAmountGbp };
}

exports.getMaintenancePortal = async (_req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT
        v.id,
        v.registration_number,
        v.fleet_code,
        v.model_name,
        v.truck_type,
        v.status,
        v.next_service_due,
        v.mot_expiry,
        v.insurance_expiry,
        v.road_tax_expiry,
        v.current_location,
        v.company_name,
        COALESCE(v.inspection_frequency_weeks, 6) AS inspection_frequency_weeks,
        last_m.service_date AS last_service_date,
        last_m.service_type AS last_service_type,
        last_m.garage_name AS last_garage_name,
        last_m.mileage AS last_mileage,
        last_i.inspection_date AS last_inspection_date,
        last_i.inspection_type AS last_inspection_type,
        last_i.result AS last_inspection_result,
        last_i.next_due AS next_inspection_due,
        COALESCE(def.open_defects, 0) AS open_defects,
        COALESCE(def.critical_defects, 0) AS critical_defects
      FROM vehicles v
      LEFT JOIN maintenance_records last_m
        ON last_m.id = (
          SELECT mr.id
          FROM maintenance_records mr
          WHERE mr.vehicle_id = v.id
          ORDER BY mr.service_date DESC, mr.id DESC
          LIMIT 1
        )
      LEFT JOIN vehicle_inspections last_i
        ON last_i.id = (
          SELECT vi.id
          FROM vehicle_inspections vi
          WHERE vi.vehicle_id = v.id
          ORDER BY vi.inspection_date DESC, vi.id DESC
          LIMIT 1
        )
      LEFT JOIN (
        SELECT vehicle_id,
               COUNT(*) AS open_defects,
               SUM(severity IN ('high','critical')) AS critical_defects
        FROM defect_reports
        WHERE status != 'resolved'
        GROUP BY vehicle_id
      ) def ON def.vehicle_id = v.id
      ORDER BY
        v.next_service_due IS NULL,
        v.next_service_due ASC,
        v.registration_number ASC
    `);

    const [trailerRows] = await db.query(`
      SELECT
        t.id,
        t.trailer_code AS fleet_code,
        t.registration_number,
        t.trailer_type,
        t.status,
        t.current_location,
        COALESCE(t.company_name, '') AS company_name,
        t.mot_expiry,
        t.insurance_expiry,
        t.next_service_due,
        COALESCE(
          (SELECT ti.next_due FROM trailer_inspections ti WHERE ti.trailer_id = t.id ORDER BY ti.inspection_date DESC LIMIT 1),
          t.next_inspection_due
        ) AS next_inspection_due,
        COALESCE(t.inspection_frequency_weeks, 6) AS inspection_frequency_weeks,
        (SELECT ti.inspection_date FROM trailer_inspections ti WHERE ti.trailer_id = t.id ORDER BY ti.inspection_date DESC LIMIT 1) AS last_inspection_date,
        COALESCE(def.open_defects, 0) AS open_defects,
        COALESCE(def.critical_defects, 0) AS critical_defects
      FROM trailers t
      LEFT JOIN (
        SELECT trailer_id, COUNT(*) AS open_defects, SUM(severity IN ('high','critical')) AS critical_defects
        FROM defect_reports
        WHERE status != 'resolved' AND trailer_id IS NOT NULL
        GROUP BY trailer_id
      ) def ON def.trailer_id = t.id
      ORDER BY t.registration_number ASC
    `);

    const plannerRows = rows.map((v) => {
      const serviceDays = daysUntil(v.next_service_due);
      const inspectionDays = daysUntil(v.next_inspection_due);
      const priorityDays = [serviceDays, inspectionDays].filter((value) => value !== null).sort((a, b) => a - b)[0] ?? null;
      const tone = dueTone(priorityDays, v.open_defects, v.status);

      return {
        id: v.id,
        registrationNumber: v.registration_number,
        fleetCode: v.fleet_code,
        make: v.model_name,
        truckType: v.truck_type,
        status: v.status,
        statusLabel: (v.status || "").replace("_", " "),
        currentLocation: v.current_location || "-",
        inspectionFrequency: "6-week safety inspection",
        lastService: fmtDate(v.last_service_date),
        lastServiceRaw: rawDate(v.last_service_date),
        lastServiceType: v.last_service_type || "No service record",
        lastGarage: v.last_garage_name || "-",
        lastMileage: v.last_mileage ? `${Number(v.last_mileage).toLocaleString("en-GB")} mi` : "-",
        nextService: fmtDate(v.next_service_due),
        nextServiceRaw: rawDate(v.next_service_due),
        serviceDaysLeft: serviceDays,
        serviceDueLabel: dueLabel(serviceDays),
        lastInspection: fmtDate(v.last_inspection_date),
        lastInspectionType: v.last_inspection_type || "No inspection record",
        lastInspectionResult: v.last_inspection_result || "-",
        nextInspection: fmtDate(v.next_inspection_due),
        nextInspectionRaw: rawDate(v.next_inspection_due),
        inspectionDaysLeft: inspectionDays,
        inspectionDueLabel: dueLabel(inspectionDays),
        inspectionStatus: inspectionStatus(inspectionDays).label,
        inspectionTone: inspectionStatus(inspectionDays).tone,
        openDefects: Number(v.open_defects || 0),
        criticalDefects: Number(v.critical_defects || 0),
        priorityDays,
        dueTone: tone,
        action: Number(v.open_defects || 0) > 0
          ? "Defect review"
          : priorityDays === null
            ? "Plan service"
            : priorityDays < 0
              ? "Book immediately"
              : priorityDays <= 14
                ? "Book workshop"
                : "Monitor"
      };
    });

    const trailerPlannerRows = trailerRows.map((t) => {
      const serviceDays = null;
      const inspectionDays = daysUntil(t.next_inspection_due);
      const priorityDays = [serviceDays, inspectionDays].filter((v) => v !== null).sort((a, b) => a - b)[0] ?? null;
      const tone = dueTone(priorityDays, t.open_defects, t.status);
      return {
        id: t.id,
        assetType: "trailer",
        registrationNumber: t.registration_number,
        fleetCode: t.fleet_code,
        make: t.trailer_type,
        truckType: t.trailer_type,
        status: t.status,
        statusLabel: (t.status || "").replace("_", " "),
        currentLocation: t.current_location || "-",
        inspectionFrequency: "10-week safety inspection",
        lastService: "-",
        lastServiceRaw: "",
        lastServiceType: "No service record",
        lastGarage: "-",
        lastMileage: "-",
        nextService: "-",
        nextServiceRaw: "",
        serviceDaysLeft: serviceDays,
        serviceDueLabel: dueLabel(serviceDays),
        lastInspection: fmtDate(t.last_inspection_date),
        lastInspectionType: "10-week safety inspection",
        lastInspectionResult: "-",
        nextInspection: fmtDate(t.next_inspection_due),
        nextInspectionRaw: rawDate(t.next_inspection_due),
        inspectionDaysLeft: inspectionDays,
        inspectionDueLabel: dueLabel(inspectionDays),
        inspectionStatus: inspectionStatus(inspectionDays).label,
        inspectionTone: inspectionStatus(inspectionDays).tone,
        openDefects: Number(t.open_defects || 0),
        criticalDefects: Number(t.critical_defects || 0),
        priorityDays,
        dueTone: tone,
        action: Number(t.open_defects || 0) > 0
          ? "Defect review"
          : priorityDays === null ? "Plan service"
          : priorityDays < 0 ? "Book immediately"
          : priorityDays <= 14 ? "Book workshop"
          : "Monitor"
      };
    });
    const allPlannerRows = [...plannerRows, ...trailerPlannerRows];

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weeklyBoard = Array.from({ length: 8 }, (_, index) => {
      const start = addDays(today, index * 7);
      const end = addDays(start, 6);
      const dueItems = allPlannerRows.filter((row) => {
        const candidates = [row.nextServiceRaw, row.nextInspectionRaw].filter(Boolean).map((value) => new Date(value));
        return candidates.some((date) => date >= start && date <= end);
      });
      return {
        label: `Week ${index + 1}`,
        range: `${fmtDate(start)} - ${fmtDate(end)}`,
        count: dueItems.length,
        urgent: dueItems.filter((item) => item.dueTone !== "success").length
      };
    });

    const overdue = allPlannerRows.filter((row) => row.priorityDays !== null && row.priorityDays < 0).length;
    const openDefects = allPlannerRows.reduce((sum, row) => sum + row.openDefects, 0);
    const available = allPlannerRows.filter((row) => row.status === "available" && row.dueTone === "success").length;

    const [jobRows] = await db.query(`
      SELECT j.*,
             COALESCE(v.registration_number, tr.registration_number) AS asset_registration,
             COALESCE(v.fleet_code, tr.trailer_code) AS asset_code,
             COALESCE(v.model_name, tr.trailer_type) AS asset_model,
             COALESCE(v.truck_type, tr.trailer_type) AS asset_type_label,
             COALESCE(v.status, tr.status) AS asset_status,
             d.defect_type, d.severity AS defect_severity, d.description AS defect_description
      FROM maintenance_jobs j
      LEFT JOIN vehicles v ON v.id = j.vehicle_id
      LEFT JOIN trailers tr ON tr.id = j.trailer_id
      LEFT JOIN defect_reports d ON d.id = j.defect_id
      WHERE (
        (COALESCE(j.asset_type, 'vehicle') = 'vehicle' AND j.vehicle_id IS NOT NULL)
        OR
        (j.asset_type = 'trailer' AND j.trailer_id IS NOT NULL)
      )
      ORDER BY
        FIELD(j.status, 'in_progress','booked','planned','completed','cancelled'),
        j.due_date ASC,
        j.created_at DESC
    `);

    const jobs = jobRows.map((j) => {
      const daysLeft = daysUntil(j.due_date);
      const totalCost = j.final_cost_gbp != null
        ? Number(j.final_cost_gbp)
        : j.bill_amount_gbp != null
          ? Number(j.bill_amount_gbp)
          : Number(j.estimated_cost_gbp || 0) + Number(j.labour_cost_gbp || 0) + Number(j.parts_cost_gbp || 0);
      return {
        id: j.id,
        jobNumber: j.job_number,
        vehicleId: j.vehicle_id,
        trailerId: j.trailer_id,
        assetType: j.asset_type || (j.trailer_id ? "trailer" : "vehicle"),
        vehicle: j.asset_registration,
        fleetCode: j.asset_code,
        make: j.asset_model,
        truckType: j.asset_type_label,
        vehicleStatus: j.asset_status,
        defectId: j.defect_id,
        defectType: j.defect_type,
        defectSeverity: j.defect_severity,
        defectDescription: j.defect_description,
        serviceType: j.service_type,
        dueDate: fmtDate(j.due_date),
        dueDateRaw: rawDate(j.due_date),
        dueLabel: dueLabel(daysLeft),
        daysLeft,
        garageName: j.garage_name || "-",
        assignedMechanic: j.assigned_mechanic || "-",
        estimatedCostGbp: Number(j.estimated_cost_gbp || 0),
        labourCostGbp: Number(j.labour_cost_gbp || 0),
        partsCostGbp: Number(j.parts_cost_gbp || 0),
        finalCostGbp: j.final_cost_gbp == null ? null : Number(j.final_cost_gbp),
        serviceDate: fmtDate(j.service_date),
        serviceDateRaw: rawDate(j.service_date),
        roadTaxIntervalMonths: j.road_tax_interval_months,
        completedMileageKm: j.completed_mileage_km,
        nextDueMileageKm: j.next_due_mileage_km,
        billNumber: j.bill_number || "",
        billDate: fmtDate(j.bill_date),
        billDateRaw: rawDate(j.bill_date),
        billAmountGbp: j.bill_amount_gbp == null ? "" : Number(j.bill_amount_gbp),
        billAmountLabel: j.bill_amount_gbp == null ? "-" : fmtAmount(j.bill_amount_gbp),
        billNotes: j.bill_notes || "-",
        billAttachmentData: j.bill_attachment_data || "",
        billStatus: j.bill_status || "pending",
        billStatusTone: { approved: "success", paid: "success", rejected: "danger", pending: "warning" }[j.bill_status || "pending"] || "neutral",
        billPaymentStatus: j.bill_payment_status || "unpaid",
        billApprovedBy: j.bill_approved_by || "-",
        billApprovedAt: fmtDate(j.bill_approved_at),
        vendorInvoiceRef: j.vendor_invoice_ref || "-",
        mileageLabel: j.next_due_mileage_km
          ? `${Number(j.next_due_mileage_km).toLocaleString("en-GB")} km next`
          : j.completed_mileage_km
            ? `${Number(j.completed_mileage_km).toLocaleString("en-GB")} km done`
            : "-",
        costLabel: fmtAmount(totalCost),
        priority: j.priority,
        priorityTone: priorityTone(j.priority),
        status: j.status,
        statusLabel: (j.status || "").replace("_", " "),
        statusTone: jobTone(j.status, daysLeft, j.priority),
        notes: j.notes || "-",
        partsRequired: j.parts_required || "-",
        completionNotes: j.completion_notes || "-",
        completedAt: fmtDate(j.completed_at),
        completedAtRaw: rawDate(j.completed_at),
        createdAt: fmtDate(j.created_at)
      };
    });

    const [defectRows] = await db.query(`
      SELECT d.*,
             COALESCE(v.registration_number, tr.registration_number) AS registration_number,
             COALESCE(v.fleet_code, tr.trailer_code) AS fleet_code,
             COALESCE(v.model_name, tr.trailer_type) AS model_name,
             existing.id AS job_id, existing.job_number
      FROM defect_reports d
      LEFT JOIN vehicles v ON v.id = d.vehicle_id
      LEFT JOIN trailers tr ON tr.id = d.trailer_id
      LEFT JOIN maintenance_jobs existing ON existing.defect_id = d.id AND existing.status != 'cancelled'
      WHERE d.status != 'resolved'
        AND (d.vehicle_id IS NOT NULL OR d.trailer_id IS NOT NULL)
      ORDER BY FIELD(d.severity, 'critical','high','medium','low'), d.reported_at DESC
      LIMIT 40
    `);

    const defects = defectRows.map((d) => ({
      id: d.id,
      assetType: d.asset_type || (d.trailer_id ? "trailer" : "vehicle"),
      vehicleId: d.vehicle_id,
      trailerId: d.trailer_id,
      vehicle: d.registration_number,
      fleetCode: d.fleet_code,
      make: d.model_name,
      defectType: d.defect_type,
      description: d.description || "-",
      severity: d.severity,
      severityTone: { critical: "danger", high: "danger", medium: "warning", low: "neutral" }[d.severity] || "neutral",
      status: d.status,
      workflowStatus: d.workflow_status || (d.job_id ? "booked" : "reported"),
      reportedBy: d.reported_by || "-",
      reportedAt: fmtDate(d.reported_at),
      jobId: d.job_id,
      jobNumber: d.job_number
    }));

    const [odometerRows] = await db.query(`
      SELECT l.vehicle_id, l.reading_km
      FROM driver_odometer_logs l
      JOIN (
        SELECT vehicle_id, MAX(logged_at) AS max_logged_at
        FROM driver_odometer_logs
        WHERE vehicle_id IS NOT NULL
        GROUP BY vehicle_id
      ) latest ON latest.vehicle_id = l.vehicle_id AND latest.max_logged_at = l.logged_at
    `);
    const odometerByVehicle = new Map(odometerRows.map((row) => [Number(row.vehicle_id), Number(row.reading_km || 0)]));

    const latestServiceByVehicleAndType = new Map();
    for (const job of jobs) {
      const prefix = job.assetType === "trailer" ? `trailer:${job.trailerId}` : `${job.vehicleId}`;
      const key = `${prefix}:${job.serviceType}`;
      const current = latestServiceByVehicleAndType.get(key);
      if (job.serviceDateRaw && (!current || job.serviceDateRaw > current.serviceDateRaw)) {
        latestServiceByVehicleAndType.set(key, job);
      }
    }

    const trailerComplianceItems = trailerRows.flatMap((t) => [
      { vehicleId: t.id, assetType: "trailer", vehicle: t.registration_number, itemType: "MOT", dueDateRaw: rawDate(t.mot_expiry), dueDate: fmtDate(t.mot_expiry), daysLeft: daysUntil(t.mot_expiry) },
      { vehicleId: t.id, assetType: "trailer", vehicle: t.registration_number, itemType: "Safety inspection", dueDateRaw: rawDate(t.next_inspection_due), dueDate: fmtDate(t.next_inspection_due), daysLeft: daysUntil(t.next_inspection_due) }
    ]).filter((item) => item.dueDateRaw).map((item) => ({
      ...item,
      dueLabel: dueLabel(item.daysLeft),
      tone: item.daysLeft < 0 ? "danger" : item.daysLeft <= 30 ? "warning" : "success",
      reminder: item.daysLeft <= 30 ? "Reminder due" : "Scheduled"
    })).sort((a, b) => (a.daysLeft ?? 9999) - (b.daysLeft ?? 9999));

    const fullServiceDueRaw = (v) => {
      const lastFullService = latestServiceByVehicleAndType.get(`${v.id}:Full Service`);
      const raw = rawDate(v.next_service_due);
      const calculated = lastFullService?.serviceDateRaw ? rawDate(addMonths(lastFullService.serviceDateRaw, 6)) : "";
      if (!raw) return calculated;
      if (lastFullService?.serviceDateRaw && raw <= lastFullService.serviceDateRaw) return calculated;
      return raw;
    };

    const complianceItems = rows.flatMap((v) => [
      { vehicleId: v.id, vehicle: v.registration_number, itemType: "MOT", dueDateRaw: rawDate(v.mot_expiry), dueDate: fmtDate(v.mot_expiry), daysLeft: daysUntil(v.mot_expiry) },
      { vehicleId: v.id, vehicle: v.registration_number, itemType: "Insurance", dueDateRaw: rawDate(v.insurance_expiry), dueDate: fmtDate(v.insurance_expiry), daysLeft: daysUntil(v.insurance_expiry) },
      { vehicleId: v.id, vehicle: v.registration_number, itemType: "Road Tax", dueDateRaw: rawDate(v.road_tax_expiry), dueDate: fmtDate(v.road_tax_expiry), daysLeft: daysUntil(v.road_tax_expiry) },
      { vehicleId: v.id, vehicle: v.registration_number, itemType: "Full Service", dueDateRaw: fullServiceDueRaw(v), dueDate: fmtDate(fullServiceDueRaw(v)), daysLeft: daysUntil(fullServiceDueRaw(v)) },
      { vehicleId: v.id, vehicle: v.registration_number, itemType: "Roller brake test", dueDateRaw: rawDate(v.next_inspection_due), dueDate: fmtDate(v.next_inspection_due), daysLeft: daysUntil(v.next_inspection_due) },
      { vehicleId: v.id, vehicle: v.registration_number, itemType: "Safety inspection", dueDateRaw: rawDate(v.next_inspection_due), dueDate: fmtDate(v.next_inspection_due), daysLeft: daysUntil(v.next_inspection_due) },
      {
        vehicleId: v.id,
        vehicle: v.registration_number,
        itemType: "Tacho Calibration",
        dueDateRaw: latestServiceByVehicleAndType.get(`${v.id}:Tacho Calibration`)?.dueDateRaw || "",
        dueDate: fmtDate(latestServiceByVehicleAndType.get(`${v.id}:Tacho Calibration`)?.dueDateRaw),
        daysLeft: daysUntil(latestServiceByVehicleAndType.get(`${v.id}:Tacho Calibration`)?.dueDateRaw)
      }
    ]).filter((item) => item.dueDateRaw).map((item) => ({
      ...item,
      assetType: "vehicle",
      dueLabel: dueLabel(item.daysLeft),
      tone: item.daysLeft < 0 ? "danger" : item.daysLeft <= 30 ? "warning" : "success",
      reminder: item.daysLeft <= 30 ? "Reminder due" : "Scheduled"
    })).sort((a, b) => (a.daysLeft ?? 9999) - (b.daysLeft ?? 9999));

    const allComplianceItems = [...complianceItems, ...trailerComplianceItems]
      .sort((a, b) => (a.daysLeft ?? 9999) - (b.daysLeft ?? 9999));

    const profileItemTypes = ["MOT", "Road Tax", "Insurance", "Tacho Calibration", "Safety inspection", "Roller brake test", "Full Service"];
    const trailerProfileItemTypes = ["MOT", "Safety inspection"];
    const vehicleProfiles = rows.map((v) => {
      const currentKm = odometerByVehicle.get(Number(v.id)) || null;
      return {
        vehicleId: v.id,
        vehicle: v.registration_number,
        fleetCode: v.fleet_code,
        make: v.model_name,
        currentKm,
        currentKmLabel: currentKm ? `${currentKm.toLocaleString("en-GB")} km` : "-",
        items: profileItemTypes.map((type) => {
          const latest = latestServiceByVehicleAndType.get(`${v.id}:${type}`);
          const dueDateRaw = type === "MOT"
            ? rawDate(v.mot_expiry)
            : type === "Road Tax"
              ? rawDate(v.road_tax_expiry)
              : type === "Insurance"
                ? rawDate(v.insurance_expiry)
                : type === "Tacho Calibration"
                  ? latest?.dueDateRaw || ""
                  : type === "Full Service"
                    ? fullServiceDueRaw(v)
                    : rawDate(v.next_inspection_due) || latest?.dueDateRaw || "";
          const daysLeft = daysUntil(dueDateRaw);
          const serviceStatus = statusFromDays(daysLeft);
          const kmRemaining = type === "Full Service" && latest?.nextDueMileageKm && currentKm
            ? Number(latest.nextDueMileageKm) - currentKm
            : null;
          return {
            type,
            lastDone: latest?.serviceDateRaw ? latest.serviceDate : "-",
            lastDoneRaw: latest?.serviceDateRaw || "",
            lastDoneKm: latest?.completedMileageKm || null,
            nextDue: fmtDate(dueDateRaw),
            nextDueRaw: dueDateRaw,
            daysLeft,
            dueLabel: dueLabel(daysLeft),
            status: type === "Full Service" && kmRemaining !== null && kmRemaining <= 5000 ? "Due by km" : serviceStatus.label,
            tone: type === "Full Service" && kmRemaining !== null && kmRemaining <= 0
              ? "danger"
              : type === "Full Service" && kmRemaining !== null && kmRemaining <= 5000
                ? "warning"
                : serviceStatus.tone,
            nextDueMileageKm: latest?.nextDueMileageKm || "",
            kmRemaining,
            kmRemainingLabel: kmRemaining === null ? "-" : `${Number(kmRemaining).toLocaleString("en-GB")} km`,
            hasAttachment: Boolean(latest?.billAttachmentData),
            attachmentData: latest?.billAttachmentData || "",
            billNumber: latest?.billNumber || "",
            billAmountGbp: latest?.billAmountGbp || "",
            billNotes: latest?.billNotes && latest.billNotes !== "-" ? latest.billNotes : ""
          };
        })
      };
    });

    const trailerProfiles = trailerRows.map((t) => ({
      vehicleId: t.id,
      assetType: "trailer",
      vehicle: t.registration_number,
      fleetCode: t.fleet_code,
      make: t.trailer_type,
      currentKm: null,
      currentKmLabel: "-",
      items: trailerProfileItemTypes.map((type) => {
        const latest = latestServiceByVehicleAndType.get(`trailer:${t.id}:${type}`);
        const dueDateRaw = type === "MOT" ? rawDate(t.mot_expiry)
          : rawDate(t.next_inspection_due);
        const daysLeft = daysUntil(dueDateRaw);
        const serviceStatus = statusFromDays(daysLeft);
        return {
          type,
          lastDone: latest?.serviceDateRaw ? latest.serviceDate : "-",
          lastDoneRaw: latest?.serviceDateRaw || "",
          lastDoneKm: null,
          nextDue: fmtDate(dueDateRaw),
          nextDueRaw: dueDateRaw,
          daysLeft,
          dueLabel: dueLabel(daysLeft),
          status: serviceStatus.label,
          tone: serviceStatus.tone,
          nextDueMileageKm: "",
          kmRemaining: null,
          kmRemainingLabel: "-",
          hasAttachment: Boolean(latest?.billAttachmentData),
          attachmentData: latest?.billAttachmentData || "",
          billNumber: latest?.billNumber || "",
          billAmountGbp: latest?.billAmountGbp || "",
          billNotes: latest?.billNotes && latest.billNotes !== "-" ? latest.billNotes : ""
        };
      })
    }));
    const allVehicleProfiles = [...vehicleProfiles, ...trailerProfiles];

    const planStart = addDays(startOfWeek(new Date()), -7);
    const planWeeks = Array.from({ length: 53 }, (_, index) => {
      const start = addDays(planStart, index * 7);
      const end = addDays(start, 6);
      const weekNumber = maintenanceWeekNumber(start);
      const month = start.toLocaleDateString("en-GB", { month: "short" });
      return {
        key: rawDate(start),
        weekNumber,
        label: `WK${weekNumber}`,
        month,
        startRaw: rawDate(start),
        endRaw: rawDate(end),
        range: `${fmtDate(start)} - ${fmtDate(end)}`
      };
    });
    const planEnd = addDays(planStart, (53 * 7) - 1);
    const yearPlanRows = rows.map((v) => {
      const profile = vehicleProfiles.find((item) => Number(item.vehicleId) === Number(v.id));
      const events = [];
      const seeds = [
        { type: "Safety inspection", dueDateRaw: rawDate(v.next_inspection_due), roadTaxIntervalMonths: 12 },
        { type: "MOT", dueDateRaw: rawDate(v.mot_expiry), roadTaxIntervalMonths: 12 },
        { type: "Road Tax", dueDateRaw: rawDate(v.road_tax_expiry), roadTaxIntervalMonths: latestServiceByVehicleAndType.get(`${v.id}:Road Tax`)?.roadTaxIntervalMonths || 12 },
        { type: "Insurance", dueDateRaw: rawDate(v.insurance_expiry), roadTaxIntervalMonths: 12 },
        { type: "Tacho Calibration", dueDateRaw: latestServiceByVehicleAndType.get(`${v.id}:Tacho Calibration`)?.dueDateRaw || "", roadTaxIntervalMonths: 12 },
        { type: "Full Service", dueDateRaw: fullServiceDueRaw(v), roadTaxIntervalMonths: 12 }
      ];
      for (const seed of seeds) {
        const dates = buildFuturePlanDates(seed.dueDateRaw, seed.type, planStart, planEnd, seed.roadTaxIntervalMonths);
        for (const dueDateRaw of dates) {
          const daysLeft = daysUntil(dueDateRaw);
          const displayDateRaw = dueDateRaw < rawDate(planStart) ? rawDate(planStart) : dueDateRaw;
          const tone = daysLeft < 0 ? "danger" : daysLeft <= 30 ? "warning" : "success";
          const week = planWeeks.find((item) => displayDateRaw >= item.startRaw && displayDateRaw <= item.endRaw);
          if (!week) continue;
          events.push({
            id: `${v.id}-${seed.type}-${dueDateRaw}`,
            vehicleId: v.id,
            vehicle: v.registration_number,
            fleetCode: v.fleet_code,
            make: v.model_name,
            type: seed.type,
            code: planCodeForType(seed.type),
            dueDateRaw,
            displayDateRaw,
            dueDate: fmtDate(dueDateRaw),
            dueLabel: dueLabel(daysLeft),
            daysLeft,
            tone,
            weekKey: week.key,
            weekLabel: week.label
          });
        }
      }
      // Add completed events within the plan window (RBT excluded — IB covers both)
      for (const job of jobs) {
        if (job.trailerId || Number(job.vehicleId) !== Number(v.id)) continue;
        if (job.status !== "completed" || !job.serviceDateRaw) continue;
        if (job.serviceType === "Roller brake test") continue;
        const displayDateRaw = job.dueDateRaw || job.serviceDateRaw;
        if (displayDateRaw < rawDate(planStart) || displayDateRaw > rawDate(planEnd)) continue;
        const week = planWeeks.find((w) => displayDateRaw >= w.startRaw && displayDateRaw <= w.endRaw);
        if (!week) continue;
        const code = planCodeForType(job.serviceType);
        if (!code) continue;
        events.push({
          id: `done-${job.id}`,
          vehicleId: v.id,
          vehicle: v.registration_number,
          fleetCode: v.fleet_code,
          make: v.model_name,
          type: job.serviceType,
          code,
          dueDateRaw: displayDateRaw,
          displayDateRaw,
          dueDate: fmtDate(displayDateRaw),
          dueLabel: "Completed",
          daysLeft: -999,
          tone: "success",
          weekKey: week.key,
          weekLabel: week.label,
          kind: "completed",
          completedDateRaw: job.serviceDateRaw,
          completedDate: job.serviceDate,
          completionNotes: job.completionNotes && job.completionNotes !== "-" && !isGeneratedMaintenanceNote(job.completionNotes) ? job.completionNotes : ""
        });
      }
      return {
        vehicleId: v.id,
        vehicle: v.registration_number,
        fleetCode: v.fleet_code,
        make: v.model_name,
        inspectionFrequency: `${v.inspection_frequency_weeks || 6} WEEKS`,
        companyName: v.company_name || "",
        status: v.status,
        currentKmLabel: profile?.currentKmLabel || "-",
        searchText: `${v.registration_number} ${v.fleet_code} ${v.model_name} ${v.truck_type}`.toLowerCase(),
        events: events.sort((a, b) => a.dueDateRaw.localeCompare(b.dueDateRaw))
      };
    });

    const trailerYearPlanRows = trailerRows.map((t) => {
      const events = [];
      const seeds = [
        { type: "Safety inspection", dueDateRaw: rawDate(t.next_inspection_due), roadTaxIntervalMonths: 12 },
        { type: "MOT", dueDateRaw: rawDate(t.mot_expiry), roadTaxIntervalMonths: 12 }
      ];
      for (const seed of seeds) {
        const dates = buildFuturePlanDates(
          seed.dueDateRaw,
          seed.type,
          planStart,
          planEnd,
          seed.roadTaxIntervalMonths,
          seed.type === "Safety inspection" ? TRAILER_INSPECTION_INTERVAL_DAYS : INSPECTION_INTERVAL_DAYS
        );
        for (const dueDateRaw of dates) {
          const daysLeft = daysUntil(dueDateRaw);
          const displayDateRaw = dueDateRaw < rawDate(planStart) ? rawDate(planStart) : dueDateRaw;
          const tone = daysLeft < 0 ? "danger" : daysLeft <= 30 ? "warning" : "success";
          const week = planWeeks.find((w) => displayDateRaw >= w.startRaw && displayDateRaw <= w.endRaw);
          if (!week) continue;
          events.push({
            id: `trailer-${t.id}-${seed.type}-${dueDateRaw}`,
            vehicleId: t.id,
            assetType: "trailer",
            vehicle: t.registration_number,
            fleetCode: t.fleet_code,
            make: t.trailer_type,
            type: seed.type,
            code: planCodeForType(seed.type),
            dueDateRaw,
            displayDateRaw,
            dueDate: fmtDate(dueDateRaw),
            dueLabel: dueLabel(daysLeft),
            daysLeft,
            tone,
            weekKey: week.key,
            weekLabel: week.label
          });
        }
      }
      // Add completed trailer events within the plan window (RBT excluded — IB covers both)
      for (const job of jobs) {
        if (!job.trailerId || Number(job.trailerId) !== Number(t.id)) continue;
        if (job.status !== "completed" || !job.serviceDateRaw) continue;
        if (!["Safety inspection", "MOT"].includes(job.serviceType)) continue;
        const displayDateRaw = job.dueDateRaw || job.serviceDateRaw;
        if (displayDateRaw < rawDate(planStart) || displayDateRaw > rawDate(planEnd)) continue;
        const week = planWeeks.find((w) => displayDateRaw >= w.startRaw && displayDateRaw <= w.endRaw);
        if (!week) continue;
        const code = planCodeForType(job.serviceType);
        if (!code) continue;
        events.push({
          id: `done-trailer-${job.id}`,
          vehicleId: t.id,
          assetType: "trailer",
          vehicle: t.registration_number,
          fleetCode: t.fleet_code,
          make: t.trailer_type,
          type: job.serviceType,
          code,
          dueDateRaw: displayDateRaw,
          displayDateRaw,
          dueDate: fmtDate(displayDateRaw),
          dueLabel: "Completed",
          daysLeft: -999,
          tone: "success",
          weekKey: week.key,
          weekLabel: week.label,
          kind: "completed",
          completedDateRaw: job.serviceDateRaw,
          completedDate: job.serviceDate,
          completionNotes: job.completionNotes && job.completionNotes !== "-" && !isGeneratedMaintenanceNote(job.completionNotes) ? job.completionNotes : ""
        });
      }
      return {
        vehicleId: t.id,
        assetType: "trailer",
        vehicle: t.registration_number,
        fleetCode: t.fleet_code,
        make: t.trailer_type,
        inspectionFrequency: "10 WEEKS",
        companyName: t.company_name || "",
        status: t.status,
        currentKmLabel: "-",
        searchText: `${t.registration_number} ${t.fleet_code} ${t.trailer_type}`.toLowerCase(),
        events: events.sort((a, b) => a.dueDateRaw.localeCompare(b.dueDateRaw))
      };
    });
    const allYearPlanRows = [...yearPlanRows, ...trailerYearPlanRows];

    const calendarEvents = [
      ...complianceItems.map((item) => ({
        id: `compliance-${item.vehicleId}-${item.itemType}`,
        vehicleId: item.vehicleId,
        date: item.dueDateRaw,
        label: `${item.vehicle} ${item.itemType}`,
        type: item.itemType,
        tone: item.tone,
        status: item.reminder
      })),
      ...yearPlanRows.flatMap((row) => row.events.map((event) => ({
        id: `year-${event.id}`,
        vehicleId: event.vehicleId,
        date: event.dueDateRaw,
        label: `${event.vehicle} ${event.code}`,
        type: event.type,
        tone: event.tone,
        status: event.dueLabel
      }))),
      ...jobs.map((job) => ({
        id: `job-${job.id}`,
        vehicleId: job.vehicleId,
        date: job.dueDateRaw,
        label: `${job.vehicle} ${job.serviceType}`,
        type: "Workshop job",
        tone: job.statusTone,
        status: job.statusLabel
      }))
    ].filter((event) => event.date);

    const [historyRows] = await db.query(`
      SELECT vehicle_id, NULL AS trailer_id, service_date AS event_date,
             CONVERT(service_type USING utf8mb4) AS title,
             CONVERT(description USING utf8mb4) AS description,
             cost_gbp,
             CONVERT(garage_name USING utf8mb4) AS garage_name,
             CONVERT('service' USING utf8mb4) AS source
      FROM maintenance_records
      UNION ALL
      SELECT NULL AS vehicle_id, trailer_id, service_date AS event_date,
             CONVERT(service_type USING utf8mb4) AS title,
             CONVERT(description USING utf8mb4) AS description,
             cost_gbp,
             CONVERT(garage_name USING utf8mb4) AS garage_name,
             CONVERT('trailer_service' USING utf8mb4) AS source
      FROM trailer_maintenance_records
      UNION ALL
      SELECT vehicle_id, NULL AS trailer_id, inspection_date AS event_date,
             CONVERT(inspection_type USING utf8mb4) AS title,
             CONVERT(notes USING utf8mb4) AS description,
             0 AS cost_gbp,
             CONVERT(inspector_name USING utf8mb4) AS garage_name,
             CONVERT('inspection' USING utf8mb4) AS source
      FROM vehicle_inspections
      UNION ALL
      SELECT NULL AS vehicle_id, trailer_id, inspection_date AS event_date,
             CONVERT(inspection_type USING utf8mb4) AS title,
             CONVERT(notes USING utf8mb4) AS description,
             0 AS cost_gbp,
             CONVERT(inspector_name USING utf8mb4) AS garage_name,
             CONVERT('trailer_inspection' USING utf8mb4) AS source
      FROM trailer_inspections
      UNION ALL
      SELECT vehicle_id, trailer_id, reported_at AS event_date,
             CONVERT(defect_type USING utf8mb4) AS title,
             CONVERT(description USING utf8mb4) AS description,
             0 AS cost_gbp,
             CONVERT(reported_by USING utf8mb4) AS garage_name,
             CONVERT('defect' USING utf8mb4) AS source
      FROM defect_reports
      ORDER BY event_date DESC
      LIMIT 100
    `);

    const history = historyRows.map((h) => ({
      vehicleId: h.vehicle_id,
      trailerId: h.trailer_id,
      assetType: h.trailer_id ? "trailer" : "vehicle",
      date: fmtDate(h.event_date),
      dateRaw: rawDate(h.event_date),
      title: h.title,
      description: h.description || "-",
      cost: fmtAmount(h.cost_gbp),
      garageName: h.garage_name || "-",
      source: h.source,
      tone: h.source === "defect" ? "danger" : ["inspection", "trailer_inspection"].includes(h.source) ? "warning" : "success"
    }));

    const thisMonth = new Date();
    const thisMonthKey = `${thisMonth.getFullYear()}-${String(thisMonth.getMonth() + 1).padStart(2, "0")}`;
    const monthlySpend = jobs
      .filter((job) => (job.completedAtRaw || job.dueDateRaw || "").startsWith(thisMonthKey))
      .reduce((sum, job) => sum + Number(job.finalCostGbp ?? job.billAmountGbp ?? job.estimatedCostGbp), 0);
    const completedActual = jobs
      .filter((job) => job.status === "completed")
      .reduce((sum, job) => sum + Number(job.finalCostGbp ?? job.billAmountGbp ?? job.estimatedCostGbp), 0);
    const openEstimated = jobs
      .filter((job) => !["completed", "cancelled"].includes(job.status))
      .reduce((sum, job) => sum + Number(job.estimatedCostGbp), 0);
    const costByVehicle = jobs.reduce((acc, job) => {
      acc[job.vehicle] = (acc[job.vehicle] || 0) + Number(job.finalCostGbp ?? job.billAmountGbp ?? job.estimatedCostGbp);
      return acc;
    }, {});
    const highestCost = Object.entries(costByVehicle).sort((a, b) => b[1] - a[1])[0];
    const costByVehicleRows = Object.entries(costByVehicle)
      .sort((a, b) => b[1] - a[1])
      .map(([vehicle, amount]) => ({
        vehicle,
        amount,
        amountLabel: fmtAmount(amount),
        jobs: jobs.filter((job) => job.vehicle === vehicle).length
      }));

    const [inventoryRows] = await db.query(`
      SELECT *
      FROM maintenance_inventory
      ORDER BY stock_qty <= reorder_level DESC, category ASC, part_name ASC
    `);
    const inventory = inventoryRows.map((part) => ({
      id: part.id,
      partName: part.part_name,
      category: part.category,
      stockQty: Number(part.stock_qty || 0),
      reorderLevel: Number(part.reorder_level || 0),
      unitCost: fmtAmount(part.unit_cost_gbp),
      supplier: part.supplier || "-",
      status: Number(part.stock_qty || 0) <= Number(part.reorder_level || 0) ? "Reorder" : "In stock",
      tone: Number(part.stock_qty || 0) <= Number(part.reorder_level || 0) ? "warning" : "success"
    }));

    const [tyreRows] = await db.query(`
      SELECT t.*, v.registration_number
      FROM vehicle_tyres t
      JOIN vehicles v ON v.id = t.vehicle_id
      ORDER BY FIELD(t.status, 'replace','monitor','ok'), v.registration_number ASC, t.position_label ASC
      LIMIT 80
    `);
    const tyres = tyreRows.map((tyre) => ({
      id: tyre.id,
      vehicleId: tyre.vehicle_id,
      vehicle: tyre.registration_number,
      position: tyre.position_label,
      brand: tyre.tyre_brand || "-",
      treadDepth: tyre.tread_depth_mm == null ? "-" : `${Number(tyre.tread_depth_mm).toFixed(1)} mm`,
      pressure: tyre.pressure_psi == null ? "-" : `${Number(tyre.pressure_psi).toFixed(1)} psi`,
      replacementDue: fmtDate(tyre.replacement_due),
      supplier: tyre.supplier || "-",
      cost: tyre.cost_gbp == null ? "-" : fmtAmount(tyre.cost_gbp),
      status: tyre.status,
      tone: { replace: "danger", monitor: "warning", ok: "success" }[tyre.status] || "neutral"
    }));

    const documentsVault = jobs
      .filter((job) => job.billAttachmentData || job.billNumber || job.billNotes !== "-")
      .slice(0, 12)
      .map((job) => ({
        id: job.id,
        jobNumber: job.jobNumber,
        vehicle: job.vehicle,
        serviceType: job.serviceType,
        billNumber: job.billNumber || "-",
        billDate: job.billDateRaw ? job.billDate : "-",
        billAmount: job.billAmountLabel,
        hasAttachment: Boolean(job.billAttachmentData),
        billStatus: job.billStatus,
        billStatusTone: job.billStatusTone
      }));

    const repeatedDefects = Object.entries(defects.reduce((acc, defect) => {
      acc[defect.defectType] = (acc[defect.defectType] || 0) + 1;
      return acc;
    }, {})).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([type, count]) => ({ type, count }));
    const vendorSpend = Object.entries(jobs.reduce((acc, job) => {
      if (job.garageName && job.garageName !== "-") {
        acc[job.garageName] = (acc[job.garageName] || 0) + Number(job.finalCostGbp ?? job.billAmountGbp ?? job.estimatedCostGbp);
      }
      return acc;
    }, {})).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([vendor, amount]) => ({ vendor, amountLabel: fmtAmount(amount) }));
    const analytics = {
      costByVehicle: costByVehicleRows,
      repeatedDefects,
      vendorSpend,
      costPerKm: vehicleProfiles.map((profile) => {
        const total = costByVehicle[profile.vehicle] || 0;
        return {
          vehicle: profile.vehicle,
          currentKm: profile.currentKmLabel,
          costPerKm: profile.currentKm ? `£${(total / profile.currentKm).toFixed(3)}/km` : "-"
        };
      })
    };

    const maintenanceAlerts = [
      ...complianceItems
        .filter((item) => item.itemType === "MOT" && item.daysLeft <= 30)
        .map((item) => ({ title: `${item.vehicle} MOT due`, detail: item.dueLabel, tone: item.tone })),
      ...complianceItems
        .filter((item) => item.itemType === "Safety inspection" && item.daysLeft <= 7)
        .map((item) => ({ title: `${item.vehicle} safety inspection due`, detail: item.dueLabel, tone: item.tone })),
      ...vehicleProfiles.flatMap((profile) => profile.items
        .filter((item) => item.type === "Full Service" && item.kmRemaining !== null && item.kmRemaining <= 5000)
        .map((item) => ({ title: `${profile.vehicle} full service by odometer`, detail: item.kmRemainingLabel, tone: item.tone }))),
      ...jobs
        .filter((job) => job.billStatus === "pending" && (job.billAmountGbp || job.billAttachmentData))
        .map((job) => ({ title: `${job.jobNumber} bill pending approval`, detail: `${job.vehicle} · ${job.billAmountLabel}`, tone: "warning" }))
    ].slice(0, 12);

    const openJobKeys = new Set(
      jobs
        .filter((job) => !["completed", "cancelled"].includes(job.status))
        .map((job) => `${job.vehicleId}:${job.serviceType}:${job.dueDateRaw}`)
    );
    const automationQueue = [
      ...complianceItems
        .filter((item) => item.daysLeft !== null && item.daysLeft <= 30)
        .slice(0, 12)
        .map((item) => {
          const key = `${item.vehicleId}:${item.itemType}:${item.dueDateRaw}`;
          return {
            id: `due-${item.vehicleId}-${item.itemType}`,
            kind: "compliance",
            vehicleId: item.vehicleId,
            vehicle: item.vehicle,
            title: item.itemType,
            detail: `${item.dueDate} · ${item.dueLabel}`,
            action: openJobKeys.has(key) ? "Already planned" : "Auto-plan job",
            canAutoPlan: !openJobKeys.has(key),
            tone: item.tone,
            dueDateRaw: item.dueDateRaw,
            serviceType: item.itemType
          };
        }),
      ...defects
        .filter((defect) => !defect.jobId)
        .slice(0, 8)
        .map((defect) => ({
          id: `defect-${defect.id}`,
          kind: "defect",
          defectId: defect.id,
          vehicleId: defect.vehicleId,
          vehicle: defect.vehicle,
          title: defect.defectType,
          detail: defect.description,
          action: "Auto-book repair",
          canAutoPlan: true,
          tone: defect.severityTone,
          serviceType: defect.defectType
        })),
      ...jobs
        .filter((job) => job.billStatus === "pending" && (job.billAmountGbp || job.billAttachmentData))
        .slice(0, 6)
        .map((job) => ({
          id: `bill-${job.id}`,
          kind: "bill",
          jobId: job.id,
          vehicleId: job.vehicleId,
          vehicle: job.vehicle,
          title: `${job.jobNumber} bill`,
          detail: `${job.billAmountLabel} · ${job.serviceType}`,
          action: "Needs approval",
          canAutoPlan: false,
          tone: "warning"
        }))
    ].slice(0, 18);

    const vehicles = [
      ...rows.map((v) => ({
        id: v.id,
        assetId: `vehicle:${v.id}`,
        assetType: "vehicle",
        label: `${v.registration_number} · ${v.fleet_code} · ${v.model_name}`,
        registrationNumber: v.registration_number,
        fleetCode: v.fleet_code,
        make: v.model_name,
        truckType: v.truck_type
      })),
      ...trailerRows.map((t) => ({
        id: t.id,
        assetId: `trailer:${t.id}`,
        assetType: "trailer",
        label: `[Trailer] ${t.registration_number} · ${t.fleet_code} · ${t.trailer_type}`,
        registrationNumber: t.registration_number,
        fleetCode: t.fleet_code,
        make: t.trailer_type,
        truckType: t.trailer_type
      }))
    ];

    res.json({
      header: {
        badge: "Maintenance planner",
        title: "Fleet maintenance portal",
        description: "Plan services, 6-week inspections, defects, and workshop readiness from live fleet data."
      },
      highlights: [
        "Planner rows are generated from vehicles, maintenance logs, inspections, and defects.",
        "Use due filters to separate overdue work, upcoming workshop bookings, and healthy assets.",
        "UK intervals are supported for roller brake tests, 6-week inspections, MOT, tacho calibration, road tax, and 85,000 km full service."
      ],
      stats: [
        { label: "Overdue", value: overdue + jobs.filter((job) => job.daysLeft < 0 && !["completed", "cancelled"].includes(job.status)).length, description: "Service, inspection, or job past due.", change: "Immediate action", tone: overdue ? "danger" : "success" },
        { label: "Booked this week", value: jobs.filter((job) => job.status === "booked" && job.daysLeft >= 0 && job.daysLeft <= 7).length, description: "Confirmed workshop bookings.", change: "Workshop", tone: "warning" },
        { label: "Vehicles off road", value: plannerRows.filter((row) => ["maintenance", "stopped"].includes(row.status)).length, description: "Maintenance or stopped status.", change: "Availability", tone: "danger" },
        { label: "Monthly spend", value: fmtAmount(monthlySpend), description: "Estimated and actual this month.", change: "Cost control", tone: "neutral" }
      ],
      health: [
        { label: "Open estimated cost", value: fmtAmount(openEstimated), description: "Open planned/booked/in-progress job estimates.", change: "Forecast", tone: "warning" },
        { label: "Bills pending approval", value: jobs.filter((job) => job.billStatus === "pending" && (job.billAmountGbp || job.billAttachmentData)).length, description: "Uploaded bills waiting admin approval.", change: "Finance check", tone: "warning" },
        { label: "Tyres to replace", value: tyres.filter((tyre) => tyre.status === "replace").length, description: "Tyres marked for replacement.", change: "Tyre bay", tone: tyres.some((tyre) => tyre.status === "replace") ? "danger" : "success" },
        { label: "Ready after checks", value: available, description: "Available and clear beyond 14 days.", change: "Assignable", tone: "success" }
      ],
      weeklyBoard,
      plannerRows: allPlannerRows,
      vehicleProfiles: allVehicleProfiles,
      yearPlan: {
        generatedAt: rawDate(new Date()),
        startDate: rawDate(planStart),
        endDate: rawDate(planEnd),
        weeks: planWeeks,
        rows: allYearPlanRows
      },
      vehicles,
      jobs,
      defects,
      inventory,
      tyres,
      documentsVault,
      automationQueue,
      maintenanceAlerts,
      analytics,
      complianceItems: allComplianceItems,
      calendarEvents,
      history,
      costByVehicle: costByVehicleRows,
      workshopQueue: allPlannerRows
        .filter((row) => row.dueTone !== "success" || row.openDefects > 0 || ["maintenance", "stopped"].includes(row.status))
        .sort((a, b) => (a.priorityDays ?? 9999) - (b.priorityDays ?? 9999))
        .slice(0, 8),
      filterOptions: {
        vendors: Array.from(new Set(jobs.map((job) => job.garageName).filter((value) => value && value !== "-"))),
        vehicleTypes: Array.from(new Set(vehicles.map((vehicle) => vehicle.truckType).filter(Boolean)))
      }
    });
  } catch (err) {
    console.error("[MaintenancePortal] Error:", err.message, err.stack);
    res.status(500).json({ message: "Maintenance portal error", error: err.message, detail: err.stack?.split("\n").slice(0, 4).join(" | ") });
  }
};

exports.markVehicleInspectionDone = async (req, res) => {
  try {
    const vehicleId = Number(req.params.vehicleId);
    const result = req.body.result || "pass";
    const inspectorName = String(req.body.inspector_name || req.body.inspectorName || "").trim() || req.sessionUser?.name || null;
    const notes = String(req.body.notes || "").trim() || null;
    const inspectionDate = req.body.inspection_date || req.body.inspectionDate || rawDate(new Date());
    const nextDue = rawDate(addDays(inspectionDate, INSPECTION_INTERVAL_DAYS));

    if (!vehicleId) {
      return res.status(400).json({ message: "Valid vehicle id is required." });
    }
    if (!["pass", "advisory", "fail"].includes(result)) {
      return res.status(400).json({ message: "Inspection result must be pass, advisory, or fail." });
    }

    const [[vehicle]] = await db.query(`SELECT id FROM vehicles WHERE id=?`, [vehicleId]);
    if (!vehicle) return res.status(404).json({ message: "Vehicle not found." });

    const [inserted] = await db.query(
      `INSERT INTO vehicle_inspections
        (vehicle_id, inspection_date, inspection_type, inspector_name, result, notes, next_due)
       VALUES (?, ?, '6-week safety inspection', ?, ?, ?, ?)`,
      [vehicleId, inspectionDate, inspectorName, result, notes, nextDue]
    );

    if (result === "fail") {
      await db.query(`UPDATE vehicles SET status='maintenance' WHERE id=?`, [vehicleId]);
    } else {
      await db.query(
        `UPDATE maintenance_jobs
         SET status='completed',
             service_date=?,
             completion_notes=COALESCE(completion_notes, ?),
             completed_at=COALESCE(completed_at, NOW())
         WHERE vehicle_id=? AND status IN ('planned','booked','in_progress') AND LOWER(service_type) LIKE '%inspection%'`,
        [inspectionDate, notes || "6-week safety inspection completed.", vehicleId]
      );
      const [[open]] = await db.query(
        `SELECT
          (SELECT COUNT(*) FROM defect_reports WHERE vehicle_id=? AND status != 'resolved') AS defects,
          (SELECT COUNT(*) FROM maintenance_jobs WHERE vehicle_id=? AND status IN ('booked','in_progress')) AS jobs`,
        [vehicleId, vehicleId]
      );
      if (Number(open.defects || 0) === 0 && Number(open.jobs || 0) === 0) {
        await db.query(`UPDATE vehicles SET status='available' WHERE id=? AND status IN ('maintenance','stopped')`, [vehicleId]);
      }
    }

    res.status(201).json({
      message: result === "fail" ? "Inspection recorded and vehicle kept in maintenance." : "Inspection done. Next 6-week inspection scheduled.",
      id: inserted.insertId,
      nextDue
    });
  } catch (err) {
    res.status(500).json({ message: "Inspection completion error", error: err.message });
  }
};

exports.autoPlanDueWork = async (_req, res) => {
  try {
    const [vehicleRows] = await db.query(`
      SELECT
        v.id,
        v.registration_number,
        v.next_service_due,
        v.mot_expiry,
        v.insurance_expiry,
        v.road_tax_expiry,
        last_i.next_due AS next_inspection_due
      FROM vehicles v
      LEFT JOIN vehicle_inspections last_i
        ON last_i.id = (
          SELECT vi.id
          FROM vehicle_inspections vi
          WHERE vi.vehicle_id = v.id
          ORDER BY vi.inspection_date DESC, vi.id DESC
          LIMIT 1
        )
    `);

    const dueItems = vehicleRows.flatMap((vehicle) => [
      { vehicleId: vehicle.id, vehicle: vehicle.registration_number, serviceType: "MOT", dueDate: rawDate(vehicle.mot_expiry) },
      { vehicleId: vehicle.id, vehicle: vehicle.registration_number, serviceType: "Insurance", dueDate: rawDate(vehicle.insurance_expiry) },
      { vehicleId: vehicle.id, vehicle: vehicle.registration_number, serviceType: "Road Tax", dueDate: rawDate(vehicle.road_tax_expiry) },
      // Full Service is mileage-governed (see MAINTENANCE_RULES), not date-recurring — excluded from date-based auto-planning.
      { vehicleId: vehicle.id, vehicle: vehicle.registration_number, serviceType: "Safety inspection", dueDate: rawDate(vehicle.next_inspection_due) },
      { vehicleId: vehicle.id, vehicle: vehicle.registration_number, serviceType: "Roller brake test", dueDate: rawDate(vehicle.next_inspection_due) }
    ]).filter((item) => item.dueDate && daysUntil(item.dueDate) <= 30);

    const created = [];
    const existing = [];
    for (const item of dueItems) {
      const jobId = await ensureRecurringJob(item.vehicleId, item.serviceType, item.dueDate);
      const [[job]] = await db.query(`SELECT job_number, created_at FROM maintenance_jobs WHERE id=?`, [jobId]);
      const wasCreatedRecently = job?.created_at && Date.now() - new Date(job.created_at).getTime() < 10000;
      (wasCreatedRecently ? created : existing).push({
        jobId,
        jobNumber: job?.job_number,
        vehicle: item.vehicle,
        serviceType: item.serviceType,
        dueDate: item.dueDate
      });
    }

    const [defectRows] = await db.query(`
      SELECT d.*, v.registration_number
      FROM defect_reports d
      JOIN vehicles v ON v.id = d.vehicle_id
      LEFT JOIN maintenance_jobs j ON j.defect_id = d.id AND j.status != 'cancelled'
      WHERE d.status != 'resolved' AND j.id IS NULL
      ORDER BY FIELD(d.severity, 'critical','high','medium','low'), d.reported_at DESC
      LIMIT 25
    `);

    const defectJobs = [];
    for (const defect of defectRows) {
      const planned = await ensureDefectRepairJob(defect);
      if (planned.created) {
        defectJobs.push({
          jobId: planned.id,
          jobNumber: planned.jobNumber,
          vehicle: defect.registration_number,
          serviceType: defect.defect_type
        });
      } else {
        existing.push({
          jobId: planned.id,
          vehicle: defect.registration_number,
          serviceType: defect.defect_type
        });
      }
    }

    res.json({
      message: "Automation completed.",
      createdCount: created.length + defectJobs.length,
      existingCount: existing.length,
      created,
      defectJobs,
      existing
    });
  } catch (err) {
    res.status(500).json({ message: "Maintenance automation error", error: err.message });
  }
};

exports.createJob = async (req, res) => {
  try {
    const job = cleanJobPayload(req.body);
    if (!job.due_date && job.service_date) {
      job.due_date = calculateNextDueDate(
        job.service_type,
        job.service_date,
        job.road_tax_interval_months,
        job.asset_type === "trailer" && job.service_type === "Safety inspection" ? TRAILER_INSPECTION_INTERVAL_DAYS : INSPECTION_INTERVAL_DAYS
      );
    }
    const assetId = job.trailer_id || job.vehicle_id;
    if (job.asset_type === "trailer" && !isTrailerMaintenanceTypeAllowed(job.service_type)) {
      return res.status(400).json({ message: "Trailers only support MOT and safety inspection." });
    }
    if (!assetId || !job.service_type || !job.due_date) {
      return res.status(400).json({ message: "Asset, service type, and due date are required." });
    }
    const jobNumber = await nextJobNumber();
    const [result] = await db.query(
      `INSERT INTO maintenance_jobs
        (job_number, asset_type, vehicle_id, trailer_id, defect_id, service_type, due_date, garage_name, assigned_mechanic,
         estimated_cost_gbp, labour_cost_gbp, parts_cost_gbp, final_cost_gbp, service_date, road_tax_interval_months,
         completed_mileage_km, next_due_mileage_km, bill_number, bill_date, bill_amount_gbp, bill_notes, bill_attachment_data,
         bill_status, bill_payment_status, vendor_invoice_ref,
         priority, status, notes, parts_required, completion_notes)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        jobNumber, job.asset_type, job.vehicle_id, job.trailer_id, job.defect_id, job.service_type, job.due_date, job.garage_name, job.assigned_mechanic,
        job.estimated_cost_gbp, job.labour_cost_gbp, job.parts_cost_gbp, job.final_cost_gbp,
        job.service_date, job.road_tax_interval_months, job.completed_mileage_km, job.next_due_mileage_km,
        job.bill_number, job.bill_date, job.bill_amount_gbp, job.bill_notes, job.bill_attachment_data,
        job.bill_status, job.bill_payment_status, job.vendor_invoice_ref,
        job.priority, job.status, job.notes, job.parts_required, job.completion_notes
      ]
    );
    if (job.defect_id) {
      await db.query(`UPDATE defect_reports SET status='in_progress', workflow_status='booked' WHERE id=?`, [job.defect_id]);
    }
    if (job.status === "completed") {
      await applyCompletedMaintenance({ id: result.insertId, ...job });
      if (job.defect_id) {
        await db.query(`UPDATE defect_reports SET status='resolved', resolved_at=NOW() WHERE id=?`, [job.defect_id]);
      }
    }
    await setAssetWorkshopStatus(job.asset_type, assetId, job.status);
    res.status(201).json({ message: "Maintenance job created.", id: result.insertId, jobNumber });
  } catch (err) {
    res.status(500).json({ message: "Maintenance job create error", error: err.message });
  }
};

exports.createBulkJobs = async (req, res) => {
  try {
    const base = cleanJobPayload(req.body);
    const items = Array.isArray(req.body.items) ? req.body.items : [];
    const assetId = base.trailer_id || base.vehicle_id;
    if (!assetId || items.length === 0) {
      return res.status(400).json({ message: "Asset and at least one maintenance item are required." });
    }

    const created = [];
    for (const rawItem of items) {
      const serviceType = String(rawItem.service_type || rawItem.serviceType || "").trim();
      const dueDate = rawItem.due_date || rawItem.dueDate || "";
      if (!serviceType || !dueDate) continue;
      if (base.asset_type === "trailer" && !isTrailerMaintenanceTypeAllowed(serviceType)) {
        return res.status(400).json({ message: "Trailers only support MOT and safety inspection." });
      }

      const jobNumber = await nextJobNumber();
      const status = rawItem.status || base.status || "planned";
      const priority = rawItem.priority || base.priority || recurringPriority(daysUntil(dueDate));
      const completedMileageKm = rawItem.completed_mileage_km || rawItem.completedMileageKm || base.completed_mileage_km;
      const nextDueMileageKm = rawItem.next_due_mileage_km || rawItem.nextDueMileageKm || base.next_due_mileage_km;

      const [result] = await db.query(
        `INSERT INTO maintenance_jobs
          (job_number, asset_type, vehicle_id, trailer_id, defect_id, service_type, due_date, garage_name, assigned_mechanic,
           estimated_cost_gbp, labour_cost_gbp, parts_cost_gbp, final_cost_gbp, service_date, road_tax_interval_months,
           completed_mileage_km, next_due_mileage_km, bill_number, bill_date, bill_amount_gbp, bill_notes, bill_attachment_data,
           bill_status, bill_payment_status, vendor_invoice_ref,
           priority, status, notes, parts_required, completion_notes)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          jobNumber, base.asset_type, base.vehicle_id, base.trailer_id, null, serviceType, dueDate, base.garage_name, base.assigned_mechanic,
          base.estimated_cost_gbp, base.labour_cost_gbp, base.parts_cost_gbp, base.final_cost_gbp,
          base.service_date, base.road_tax_interval_months, completedMileageKm, nextDueMileageKm,
          base.bill_number, base.bill_date, base.bill_amount_gbp, base.bill_notes, base.bill_attachment_data,
          base.bill_status, base.bill_payment_status, base.vendor_invoice_ref,
          priority, status, base.notes, base.parts_required, base.completion_notes
        ]
      );

      const job = {
        ...base,
        id: result.insertId,
        service_type: serviceType,
        due_date: dueDate,
        priority,
        status,
        completed_mileage_km: completedMileageKm,
        next_due_mileage_km: nextDueMileageKm
      };
      if (status === "completed") {
        await applyCompletedMaintenance(job);
      }
      created.push({ id: result.insertId, jobNumber, serviceType, dueDate, status });
    }

    await setAssetWorkshopStatus(base.asset_type, assetId, base.status || "planned");
    res.status(201).json({ message: "Maintenance items saved.", count: created.length, created });
  } catch (err) {
    res.status(500).json({ message: "Bulk maintenance create error", error: err.message });
  }
};

exports.updateJob = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const job = cleanJobPayload(req.body);
    if (!job.due_date && job.service_date) {
      job.due_date = calculateNextDueDate(
        job.service_type,
        job.service_date,
        job.road_tax_interval_months,
        job.asset_type === "trailer" && job.service_type === "Safety inspection" ? TRAILER_INSPECTION_INTERVAL_DAYS : INSPECTION_INTERVAL_DAYS
      );
    }
    const assetId = job.trailer_id || job.vehicle_id;
    if (job.asset_type === "trailer" && !isTrailerMaintenanceTypeAllowed(job.service_type)) {
      return res.status(400).json({ message: "Trailers only support MOT and safety inspection." });
    }
    if (!id || !assetId || !job.service_type || !job.due_date) {
      return res.status(400).json({ message: "Valid job, asset, service type, and due date are required." });
    }
    await db.query(
      `UPDATE maintenance_jobs SET
        asset_type=?, vehicle_id=?, trailer_id=?, defect_id=?, service_type=?, due_date=?, garage_name=?, assigned_mechanic=?,
        estimated_cost_gbp=?, labour_cost_gbp=?, parts_cost_gbp=?, final_cost_gbp=?,
        service_date=?, road_tax_interval_months=?, completed_mileage_km=?, next_due_mileage_km=?,
        bill_number=?, bill_date=?, bill_amount_gbp=?, bill_notes=?, bill_attachment_data=?,
        bill_status=?, bill_payment_status=?, vendor_invoice_ref=?,
        priority=?, status=?, notes=?, parts_required=?, completion_notes=?
      WHERE id=?`,
      [
        job.asset_type, job.vehicle_id, job.trailer_id, job.defect_id, job.service_type, job.due_date, job.garage_name, job.assigned_mechanic,
        job.estimated_cost_gbp, job.labour_cost_gbp, job.parts_cost_gbp, job.final_cost_gbp,
        job.service_date, job.road_tax_interval_months, job.completed_mileage_km, job.next_due_mileage_km,
        job.bill_number, job.bill_date, job.bill_amount_gbp, job.bill_notes, job.bill_attachment_data,
        job.bill_status, job.bill_payment_status, job.vendor_invoice_ref,
        job.priority, job.status, job.notes, job.parts_required, job.completion_notes, id
      ]
    );
    await setAssetWorkshopStatus(job.asset_type, assetId, job.status);
    res.json({ message: "Maintenance job updated." });
  } catch (err) {
    res.status(500).json({ message: "Maintenance job update error", error: err.message });
  }
};

exports.updateBillStatus = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const billStatus = req.body.bill_status || req.body.billStatus;
    const paymentStatus = req.body.bill_payment_status || req.body.billPaymentStatus;
    const validBill = ["pending", "approved", "rejected", "paid"];
    const validPayment = ["unpaid", "scheduled", "paid"];
    if (!id || (billStatus && !validBill.includes(billStatus)) || (paymentStatus && !validPayment.includes(paymentStatus))) {
      return res.status(400).json({ message: "Valid bill status or payment status is required." });
    }
    await db.query(
      `UPDATE maintenance_jobs
       SET bill_status=COALESCE(?, bill_status),
           bill_payment_status=COALESCE(?, bill_payment_status),
           bill_approved_by=CASE WHEN ? IN ('approved','paid') THEN ? ELSE bill_approved_by END,
           bill_approved_at=CASE WHEN ? IN ('approved','paid') THEN NOW() ELSE bill_approved_at END
       WHERE id=?`,
      [
        billStatus || null,
        paymentStatus || null,
        billStatus || null,
        req.sessionUser?.name || "Admin",
        billStatus || null,
        id
      ]
    );
    res.json({ message: "Bill status updated." });
  } catch (err) {
    res.status(500).json({ message: "Bill status update error", error: err.message });
  }
};

exports.updateDefectWorkflow = async (req, res) => {
  try {
    const defectId = Number(req.params.defectId);
    const workflowStatus = req.body.workflow_status || req.body.workflowStatus;
    const valid = ["reported", "reviewed", "booked", "fixed", "verified"];
    if (!defectId || !valid.includes(workflowStatus)) {
      return res.status(400).json({ message: "Valid defect workflow status is required." });
    }
    await db.query(
      `UPDATE defect_reports
       SET workflow_status=?, status=CASE WHEN ? IN ('fixed','verified') THEN 'resolved' ELSE status END,
           resolved_at=CASE WHEN ? IN ('fixed','verified') THEN COALESCE(resolved_at, NOW()) ELSE resolved_at END
       WHERE id=?`,
      [workflowStatus, workflowStatus, workflowStatus, defectId]
    );
    res.json({ message: "Defect workflow updated." });
  } catch (err) {
    res.status(500).json({ message: "Defect workflow update error", error: err.message });
  }
};

exports.completeJob = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [[job]] = await db.query(`SELECT * FROM maintenance_jobs WHERE id=?`, [id]);
    if (!job) return res.status(404).json({ message: "Maintenance job not found." });

    await applyCompletedMaintenance(job, {
      finalCost: Number(req.body.final_cost_gbp || req.body.finalCostGbp || job.final_cost_gbp || job.estimated_cost_gbp || 0),
      completionNotes: String(req.body.completion_notes || req.body.completionNotes || job.completion_notes || "").trim() || null,
      serviceDate: req.body.service_date || req.body.serviceDate || job.service_date || rawDate(new Date()),
      nextDueDate: req.body.next_due_date || req.body.nextDueDate || null,
      completedMileageKm: req.body.completed_mileage_km || req.body.completedMileageKm || job.completed_mileage_km || null,
      nextDueMileageKm: req.body.next_due_mileage_km || req.body.nextDueMileageKm || job.next_due_mileage_km || null,
      billAmountGbp: req.body.bill_amount_gbp || req.body.billAmountGbp || job.bill_amount_gbp || null
    });
    if (job.defect_id) {
      await db.query(`UPDATE defect_reports SET status='resolved', workflow_status='verified', resolved_at=NOW() WHERE id=?`, [job.defect_id]);
    }
    const [[open]] = await db.query(
      `SELECT COUNT(*) AS count FROM maintenance_jobs
       WHERE asset_type=? AND COALESCE(vehicle_id, trailer_id)=? AND status IN ('booked','in_progress')`,
      [job.asset_type || (job.trailer_id ? "trailer" : "vehicle"), job.trailer_id || job.vehicle_id]
    );
    if (Number(open.count || 0) === 0) {
      if (job.trailer_id || job.asset_type === "trailer") {
        await db.query(`UPDATE trailers SET status='available' WHERE id=? AND status='maintenance'`, [job.trailer_id]);
      } else {
        await db.query(`UPDATE vehicles SET status='available' WHERE id=? AND status='maintenance'`, [job.vehicle_id]);
      }
    }
    res.json({ message: "Maintenance job completed." });
  } catch (err) {
    res.status(500).json({ message: "Maintenance job completion error", error: err.message });
  }
};

exports.createJobFromDefect = async (req, res) => {
  try {
    const defectId = Number(req.params.defectId);
    const [[defect]] = await db.query(`SELECT * FROM defect_reports WHERE id=?`, [defectId]);
    if (!defect) return res.status(404).json({ message: "Defect not found." });
    const planned = await ensureDefectRepairJob(defect, {
      dueDate: req.body.due_date,
      serviceType: req.body.service_type,
      garageName: req.body.garage_name,
      assignedMechanic: req.body.assigned_mechanic,
      estimatedCostGbp: req.body.estimated_cost_gbp,
      partsRequired: req.body.parts_required
    });
    res.status(planned.created ? 201 : 200).json({
      message: planned.created ? "Repair job created from defect." : "Repair job already exists for this defect.",
      id: planned.id,
      jobNumber: planned.jobNumber
    });
  } catch (err) {
    res.status(500).json({ message: "Defect repair job error", error: err.message });
  }
};

exports.getJobNotes = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ message: "Valid job id required." });
    const [notes] = await db.query(
      `SELECT id, note_text, author_name, created_at FROM maintenance_job_notes WHERE job_id=? ORDER BY created_at ASC`,
      [id]
    );
    res.json({ notes });
  } catch (err) {
    res.status(500).json({ message: "Could not load job notes.", error: err.message });
  }
};

exports.addJobNote = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const noteText = String(req.body.note_text || "").trim();
    const authorName = String(req.body.author_name || "Admin").trim();
    if (!id || !noteText) return res.status(400).json({ message: "Job id and note text are required." });
    const [result] = await db.query(
      `INSERT INTO maintenance_job_notes (job_id, note_text, author_name) VALUES (?, ?, ?)`,
      [id, noteText, authorName]
    );
    res.status(201).json({ message: "Note added.", id: result.insertId });
  } catch (err) {
    res.status(500).json({ message: "Could not add job note.", error: err.message });
  }
};

// Mark trailer inspection done (same flow as vehicle but uses trailer_inspections table)
exports.markTrailerInspectionDone = async (req, res) => {
  try {
    const trailerId = Number(req.params.trailerId);
    const result = req.body.result || "pass";
    const inspectorName = String(req.body.inspector_name || req.body.inspectorName || "").trim() || null;
    const notes = String(req.body.notes || "").trim() || null;
    const inspectionDate = req.body.inspection_date || req.body.inspectionDate || rawDate(new Date());
    const nextDue = rawDate(addDays(inspectionDate, TRAILER_INSPECTION_INTERVAL_DAYS));

    if (!trailerId) return res.status(400).json({ message: "Valid trailer id is required." });
    if (!["pass", "advisory", "fail"].includes(result)) {
      return res.status(400).json({ message: "Inspection result must be pass, advisory, or fail." });
    }

    const [[trailer]] = await db.query(`SELECT id FROM trailers WHERE id=?`, [trailerId]);
    if (!trailer) return res.status(404).json({ message: "Trailer not found." });

    const [inserted] = await db.query(
      `INSERT INTO trailer_inspections (trailer_id, inspection_date, inspection_type, inspector_name, result, notes, next_due)
       VALUES (?, ?, '10-week safety inspection', ?, ?, ?, ?)`,
      [trailerId, inspectionDate, inspectorName, result, notes, nextDue]
    );

    if (result === "fail") {
      await db.query(`UPDATE trailers SET status='maintenance' WHERE id=?`, [trailerId]);
    } else {
      await db.query(`UPDATE trailers SET next_inspection_due=?, status=CASE WHEN status='maintenance' THEN 'available' ELSE status END WHERE id=?`, [nextDue, trailerId]);
      await db.query(
        `UPDATE maintenance_jobs
         SET status='completed',
             service_date=?,
             completion_notes=COALESCE(completion_notes, ?),
             completed_at=COALESCE(completed_at, NOW())
         WHERE trailer_id=? AND status IN ('planned','booked','in_progress') AND LOWER(service_type) LIKE '%inspection%'`,
        [inspectionDate, notes || "10-week safety inspection completed.", trailerId]
      );
    }

    res.status(201).json({
      message: result === "fail" ? "Inspection recorded, trailer kept in maintenance." : "Inspection done. Next 10-week inspection scheduled.",
      id: inserted.insertId,
      nextDue
    });
  } catch (err) {
    res.status(500).json({ message: "Trailer inspection error", error: err.message });
  }
};

// Quick breakdown report — creates defect + linked repair job in one shot
exports.reportBreakdown = async (req, res) => {
  try {
    const encodedAsset = String(req.body.asset_id || req.body.assetId || "");
    const [encodedType, encodedId] = encodedAsset.includes(":") ? encodedAsset.split(":") : ["vehicle", encodedAsset];
    const assetType = encodedType === "trailer" ? "trailer" : "vehicle";
    const assetNumericId = Number(encodedId || 0);
    if (!assetNumericId) return res.status(400).json({ message: "Asset is required." });

    const defectType = String(req.body.defect_type || req.body.defectType || "Breakdown").trim();
    const description = String(req.body.description || "").trim() || null;
    const severity = req.body.severity || "high";
    const garageName = String(req.body.garage_name || req.body.garageName || "").trim() || null;
    const estimatedCostGbp = Number(req.body.estimated_cost_gbp || req.body.estimatedCostGbp || 0);
    const billAttachmentData = req.body.bill_attachment_data || req.body.billAttachmentData || null;
    const billNotes = String(req.body.bill_notes || req.body.billNotes || "").trim() || null;
    const billNumber = String(req.body.bill_number || req.body.billNumber || "").trim() || null;
    const billAmountGbp = req.body.bill_amount_gbp || req.body.billAmountGbp || null;
    const reportedBy = String(req.body.reported_by || req.body.reportedBy || req.sessionUser?.name || "Admin").trim();

    // Create defect report
    const [defectResult] = await db.query(
      `INSERT INTO defect_reports
        (vehicle_id, trailer_id, asset_type, defect_type, description, severity, reported_by, status, workflow_status)
       VALUES (?,?,?,?,?,?,?,'open','reported')`,
      [
        assetType === "vehicle" ? assetNumericId : null,
        assetType === "trailer" ? assetNumericId : null,
        assetType,
        defectType, description, severity, reportedBy
      ]
    );
    const defectId = defectResult.insertId;

    // Create linked repair job immediately
    const dueDate = rawDate(addDays(new Date(), severity === "critical" ? 1 : severity === "high" ? 3 : 7));
    const jobNumber = await nextJobNumber();
    const [jobResult] = await db.query(
      `INSERT INTO maintenance_jobs
        (job_number, asset_type, vehicle_id, trailer_id, defect_id, service_type, due_date,
         garage_name, estimated_cost_gbp, bill_attachment_data, bill_notes, bill_number, bill_amount_gbp,
         priority, status, notes)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        jobNumber, assetType,
        assetType === "vehicle" ? assetNumericId : null,
        assetType === "trailer" ? assetNumericId : null,
        defectId, defectType, dueDate,
        garageName, estimatedCostGbp, billAttachmentData, billNotes, billNumber, billAmountGbp,
        severity === "critical" ? "critical" : severity === "high" ? "high" : "normal",
        "booked",
        description
      ]
    );

    await db.query(`UPDATE defect_reports SET status='in_progress', workflow_status='booked' WHERE id=?`, [defectId]);
    if (assetType === "trailer") {
      await db.query(`UPDATE trailers SET status='maintenance' WHERE id=?`, [assetNumericId]);
    } else {
      await db.query(`UPDATE vehicles SET status='maintenance' WHERE id=?`, [assetNumericId]);
    }

    res.status(201).json({ message: "Breakdown reported and repair job created.", defectId, jobId: jobResult.insertId, jobNumber });
  } catch (err) {
    res.status(500).json({ message: "Breakdown report error", error: err.message });
  }
};

// Mark an Excel schedule event as done — finds or creates job and completes it
exports.completeEventFromSchedule = async (req, res) => {
  try {
    const encodedAsset = String(req.body.asset_id || req.body.assetId || "");
    const [encodedType, encodedId] = encodedAsset.includes(":") ? encodedAsset.split(":") : ["vehicle", encodedAsset];
    const assetType = encodedType === "trailer" ? "trailer" : "vehicle";
    const assetNumericId = Number(encodedId || 0);
    const serviceType = String(req.body.service_type || req.body.serviceType || "").trim();
    const serviceDate = req.body.service_date || req.body.serviceDate || rawDate(new Date());
    const scheduledDueDate = req.body.due_date || req.body.dueDate || serviceDate;
    const garageName = String(req.body.garage_name || req.body.garageName || "").trim() || null;
    const finalCostGbp = Number(req.body.final_cost_gbp || req.body.finalCostGbp || 0);
    const billAttachmentData = req.body.bill_attachment_data || req.body.billAttachmentData || null;
    const billNotes = String(req.body.bill_notes || req.body.billNotes || "").trim() || null;
    const completionNotes = String(req.body.completion_notes || req.body.completionNotes || req.body.notes || "").trim() || billNotes;
    const billNumber = String(req.body.bill_number || req.body.billNumber || "").trim() || null;
    const billAmountGbp = req.body.bill_amount_gbp || req.body.billAmountGbp || null;
    const roadTaxIntervalMonths = req.body.road_tax_interval_months || 12;

    if (!assetNumericId || !serviceType) {
      return res.status(400).json({ message: "Asset and service type are required." });
    }
    if (assetType === "trailer" && !isTrailerMaintenanceTypeAllowed(serviceType)) {
      return res.status(400).json({ message: "Trailers only support MOT and safety inspection." });
    }

    const nextDueDate = calculateNextDueDate(
      serviceType,
      serviceDate,
      roadTaxIntervalMonths,
      assetType === "trailer" && serviceType === "Safety inspection" ? TRAILER_INSPECTION_INTERVAL_DAYS : INSPECTION_INTERVAL_DAYS
    );
    const idField = assetType === "trailer" ? "trailer_id" : "vehicle_id";

    const [[completedSameDay]] = await db.query(
      `SELECT id FROM maintenance_jobs
       WHERE ${idField}=?
         AND service_type=?
         AND status='completed'
         AND service_date=?
       LIMIT 1`,
      [assetNumericId, serviceType, serviceDate]
    );

    if (completedSameDay) {
      await db.query(
        `UPDATE maintenance_jobs
         SET garage_name=COALESCE(?,garage_name),
             due_date=COALESCE(?,due_date),
             final_cost_gbp=?,
             bill_attachment_data=COALESCE(?,bill_attachment_data),
             bill_notes=COALESCE(?,bill_notes),
             completion_notes=COALESCE(?,completion_notes),
             bill_number=COALESCE(?,bill_number),
             bill_amount_gbp=COALESCE(?,bill_amount_gbp)
         WHERE id=?`,
        [garageName, scheduledDueDate, finalCostGbp, billAttachmentData, billNotes, completionNotes, billNumber, billAmountGbp, completedSameDay.id]
      );
      return res.json({ message: "Event already marked as done.", jobId: completedSameDay.id, nextDueDate });
    }

    // Find existing open job or create one
    const [[existing]] = await db.query(
      `SELECT id FROM maintenance_jobs
       WHERE ${idField}=?
         AND service_type=?
         AND status NOT IN ('completed','cancelled')
         AND (due_date IS NULL OR due_date BETWEEN DATE_SUB(?, INTERVAL 7 DAY) AND DATE_ADD(?, INTERVAL 7 DAY))
       ORDER BY ABS(DATEDIFF(COALESCE(due_date, ?), ?)) ASC, id DESC
       LIMIT 1`,
      [assetNumericId, serviceType, scheduledDueDate, scheduledDueDate, scheduledDueDate, scheduledDueDate]
    );

    let jobId;
    if (existing) {
      jobId = existing.id;
      await db.query(
        `UPDATE maintenance_jobs SET garage_name=COALESCE(?,garage_name), final_cost_gbp=?, bill_attachment_data=COALESCE(?,bill_attachment_data),
         due_date=COALESCE(?,due_date), bill_notes=COALESCE(?,bill_notes), completion_notes=COALESCE(?,completion_notes), bill_number=COALESCE(?,bill_number), bill_amount_gbp=COALESCE(?,bill_amount_gbp)
         WHERE id=?`,
        [garageName, finalCostGbp, billAttachmentData, scheduledDueDate, billNotes, completionNotes, billNumber, billAmountGbp, jobId]
      );
    } else {
      const jobNumber = await nextJobNumber();
      const [newJob] = await db.query(
        `INSERT INTO maintenance_jobs
          (job_number, asset_type, ${idField}, service_type, due_date, garage_name, final_cost_gbp,
           bill_attachment_data, bill_notes, completion_notes, bill_number, bill_amount_gbp, status, priority, service_date)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'planned','normal',?)`,
        [jobNumber, assetType, assetNumericId, serviceType, scheduledDueDate, garageName, finalCostGbp,
         billAttachmentData, billNotes, completionNotes, billNumber, billAmountGbp, serviceDate]
      );
      jobId = newJob.insertId;
    }

    const [[job]] = await db.query(`SELECT * FROM maintenance_jobs WHERE id=?`, [jobId]);
    await applyCompletedMaintenance(job, {
      finalCost: finalCostGbp,
      serviceDate,
      nextDueDate: nextDueDate || null,
      completionNotes,
      billAmountGbp,
      completedMileageKm: req.body.completed_mileage_km || req.body.completedMileageKm || null
    });

    res.json({ message: "Event marked as done.", jobId, nextDueDate });
  } catch (err) {
    res.status(500).json({ message: "Event completion error", error: err.message });
  }
};
