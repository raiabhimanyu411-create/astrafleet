const db = require("../db/connection");

let schemaSyncPromise;

async function addColumnIfMissing(table, column, definition) {
  const [rows] = await db.query(`SHOW COLUMNS FROM ${table} LIKE ?`, [column]);
  if (rows.length === 0) {
    await db.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
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

  await addColumnIfMissing("vehicle_inspections", "inspection_type", "VARCHAR(80) NOT NULL DEFAULT 'Routine'");
  await addColumnIfMissing("vehicle_inspections", "inspector_name", "VARCHAR(120) DEFAULT NULL");
  await addColumnIfMissing("vehicle_inspections", "result", "ENUM('pass','advisory','fail') NOT NULL DEFAULT 'pass'");
  await addColumnIfMissing("vehicle_inspections", "notes", "TEXT DEFAULT NULL");
  await addColumnIfMissing("vehicle_inspections", "next_due", "DATE DEFAULT NULL");

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
      vehicle_id         INT NOT NULL,
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

  await addColumnIfMissing("maintenance_jobs", "defect_id", "INT DEFAULT NULL");
  await addColumnIfMissing("maintenance_jobs", "assigned_mechanic", "VARCHAR(120) DEFAULT NULL");
  await addColumnIfMissing("maintenance_jobs", "labour_cost_gbp", "DECIMAL(10,2) NOT NULL DEFAULT 0");
  await addColumnIfMissing("maintenance_jobs", "parts_cost_gbp", "DECIMAL(10,2) NOT NULL DEFAULT 0");
  await addColumnIfMissing("maintenance_jobs", "final_cost_gbp", "DECIMAL(10,2) DEFAULT NULL");
  await addColumnIfMissing("maintenance_jobs", "parts_required", "TEXT DEFAULT NULL");
  await addColumnIfMissing("maintenance_jobs", "completion_notes", "TEXT DEFAULT NULL");
  await addColumnIfMissing("maintenance_jobs", "completed_at", "DATETIME DEFAULT NULL");
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
  return new Date(d).toISOString().slice(0, 10);
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

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function fmtAmount(value) {
  return `£${Number(value || 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function jobTone(status, daysLeft, priority) {
  if (status === "completed") return "success";
  if (status === "cancelled") return "neutral";
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
    `SELECT COUNT(*) AS count FROM maintenance_jobs WHERE job_number LIKE ?`,
    [`MJ-${year}-%`]
  );
  return `MJ-${year}-${String(Number(row.count || 0) + 1).padStart(4, "0")}`;
}

function cleanJobPayload(body) {
  return {
    vehicle_id: Number(body.vehicle_id || body.vehicleId || 0),
    defect_id: body.defect_id || body.defectId || null,
    service_type: String(body.service_type || body.serviceType || "").trim(),
    due_date: body.due_date || body.dueDate || "",
    garage_name: String(body.garage_name || body.garageName || "").trim() || null,
    assigned_mechanic: String(body.assigned_mechanic || body.assignedMechanic || "").trim() || null,
    estimated_cost_gbp: Number(body.estimated_cost_gbp || body.estimatedCostGbp || 0),
    labour_cost_gbp: Number(body.labour_cost_gbp || body.labourCostGbp || 0),
    parts_cost_gbp: Number(body.parts_cost_gbp || body.partsCostGbp || 0),
    final_cost_gbp: body.final_cost_gbp || body.finalCostGbp || null,
    priority: body.priority || "normal",
    status: body.status || "planned",
    notes: String(body.notes || "").trim() || null,
    parts_required: String(body.parts_required || body.partsRequired || "").trim() || null,
    completion_notes: String(body.completion_notes || body.completionNotes || "").trim() || null
  };
}

async function setVehicleWorkshopStatus(vehicleId, jobStatus) {
  if (["booked", "in_progress"].includes(jobStatus)) {
    await db.query(`UPDATE vehicles SET status='maintenance' WHERE id=?`, [vehicleId]);
  }
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
        statusLabel: v.status.replace("_", " "),
        currentLocation: v.current_location || "-",
        inspectionFrequency: "6-week safety check",
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

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weeklyBoard = Array.from({ length: 8 }, (_, index) => {
      const start = addDays(today, index * 7);
      const end = addDays(start, 6);
      const dueItems = plannerRows.filter((row) => {
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

    const overdue = plannerRows.filter((row) => row.priorityDays !== null && row.priorityDays < 0).length;
    const dueSoon = plannerRows.filter((row) => row.priorityDays !== null && row.priorityDays >= 0 && row.priorityDays <= 14).length;
    const openDefects = plannerRows.reduce((sum, row) => sum + row.openDefects, 0);
    const available = plannerRows.filter((row) => row.status === "available" && row.dueTone === "success").length;

    const [jobRows] = await db.query(`
      SELECT j.*, v.registration_number, v.fleet_code, v.model_name, v.truck_type, v.status AS vehicle_status,
             d.defect_type, d.severity AS defect_severity, d.description AS defect_description
      FROM maintenance_jobs j
      JOIN vehicles v ON v.id = j.vehicle_id
      LEFT JOIN defect_reports d ON d.id = j.defect_id
      ORDER BY
        FIELD(j.status, 'in_progress','booked','planned','completed','cancelled'),
        j.due_date ASC,
        j.created_at DESC
    `);

    const jobs = jobRows.map((j) => {
      const daysLeft = daysUntil(j.due_date);
      const totalCost = j.final_cost_gbp != null
        ? Number(j.final_cost_gbp)
        : Number(j.estimated_cost_gbp || 0) + Number(j.labour_cost_gbp || 0) + Number(j.parts_cost_gbp || 0);
      return {
        id: j.id,
        jobNumber: j.job_number,
        vehicleId: j.vehicle_id,
        vehicle: j.registration_number,
        fleetCode: j.fleet_code,
        make: j.model_name,
        truckType: j.truck_type,
        vehicleStatus: j.vehicle_status,
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
        costLabel: fmtAmount(totalCost),
        priority: j.priority,
        priorityTone: priorityTone(j.priority),
        status: j.status,
        statusLabel: j.status.replace("_", " "),
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
      SELECT d.*, v.registration_number, v.fleet_code, v.model_name,
             existing.id AS job_id, existing.job_number
      FROM defect_reports d
      JOIN vehicles v ON v.id = d.vehicle_id
      LEFT JOIN maintenance_jobs existing ON existing.defect_id = d.id AND existing.status != 'cancelled'
      WHERE d.status != 'resolved'
      ORDER BY FIELD(d.severity, 'critical','high','medium','low'), d.reported_at DESC
      LIMIT 40
    `);

    const defects = defectRows.map((d) => ({
      id: d.id,
      vehicleId: d.vehicle_id,
      vehicle: d.registration_number,
      fleetCode: d.fleet_code,
      make: d.model_name,
      defectType: d.defect_type,
      description: d.description || "-",
      severity: d.severity,
      severityTone: { critical: "danger", high: "danger", medium: "warning", low: "neutral" }[d.severity] || "neutral",
      status: d.status,
      reportedBy: d.reported_by || "-",
      reportedAt: fmtDate(d.reported_at),
      jobId: d.job_id,
      jobNumber: d.job_number
    }));

    const complianceItems = rows.flatMap((v) => [
      { vehicleId: v.id, vehicle: v.registration_number, itemType: "MOT", dueDateRaw: rawDate(v.mot_expiry), dueDate: fmtDate(v.mot_expiry), daysLeft: daysUntil(v.mot_expiry) },
      { vehicleId: v.id, vehicle: v.registration_number, itemType: "Insurance", dueDateRaw: rawDate(v.insurance_expiry), dueDate: fmtDate(v.insurance_expiry), daysLeft: daysUntil(v.insurance_expiry) },
      { vehicleId: v.id, vehicle: v.registration_number, itemType: "Road tax", dueDateRaw: rawDate(v.road_tax_expiry), dueDate: fmtDate(v.road_tax_expiry), daysLeft: daysUntil(v.road_tax_expiry) },
      { vehicleId: v.id, vehicle: v.registration_number, itemType: "Service", dueDateRaw: rawDate(v.next_service_due), dueDate: fmtDate(v.next_service_due), daysLeft: daysUntil(v.next_service_due) }
    ]).filter((item) => item.dueDateRaw).map((item) => ({
      ...item,
      dueLabel: dueLabel(item.daysLeft),
      tone: item.daysLeft < 0 ? "danger" : item.daysLeft <= 30 ? "warning" : "success",
      reminder: item.daysLeft <= 30 ? "Reminder due" : "Scheduled"
    })).sort((a, b) => (a.daysLeft ?? 9999) - (b.daysLeft ?? 9999));

    const calendarEvents = [
      ...complianceItems.map((item) => ({
        id: `compliance-${item.vehicleId}-${item.itemType}`,
        date: item.dueDateRaw,
        label: `${item.vehicle} ${item.itemType}`,
        type: item.itemType,
        tone: item.tone,
        status: item.reminder
      })),
      ...jobs.map((job) => ({
        id: `job-${job.id}`,
        date: job.dueDateRaw,
        label: `${job.vehicle} ${job.serviceType}`,
        type: "Workshop job",
        tone: job.statusTone,
        status: job.statusLabel
      }))
    ].filter((event) => event.date);

    const [historyRows] = await db.query(`
      SELECT vehicle_id, service_date AS event_date, service_type AS title, description, cost_gbp, garage_name, 'service' AS source
      FROM maintenance_records
      UNION ALL
      SELECT vehicle_id, inspection_date AS event_date, inspection_type AS title, notes AS description, 0 AS cost_gbp, inspector_name AS garage_name, 'inspection' AS source
      FROM vehicle_inspections
      UNION ALL
      SELECT vehicle_id, reported_at AS event_date, defect_type AS title, description, 0 AS cost_gbp, reported_by AS garage_name, 'defect' AS source
      FROM defect_reports
      ORDER BY event_date DESC
      LIMIT 80
    `);

    const history = historyRows.map((h) => ({
      vehicleId: h.vehicle_id,
      date: fmtDate(h.event_date),
      dateRaw: rawDate(h.event_date),
      title: h.title,
      description: h.description || "-",
      cost: fmtAmount(h.cost_gbp),
      garageName: h.garage_name || "-",
      source: h.source,
      tone: h.source === "defect" ? "danger" : h.source === "inspection" ? "warning" : "success"
    }));

    const thisMonth = new Date();
    const thisMonthKey = `${thisMonth.getFullYear()}-${String(thisMonth.getMonth() + 1).padStart(2, "0")}`;
    const monthlySpend = jobs
      .filter((job) => (job.completedAtRaw || job.dueDateRaw || "").startsWith(thisMonthKey))
      .reduce((sum, job) => sum + Number(job.finalCostGbp ?? job.estimatedCostGbp), 0);
    const completedActual = jobs
      .filter((job) => job.status === "completed")
      .reduce((sum, job) => sum + Number(job.finalCostGbp ?? job.estimatedCostGbp), 0);
    const openEstimated = jobs
      .filter((job) => !["completed", "cancelled"].includes(job.status))
      .reduce((sum, job) => sum + Number(job.estimatedCostGbp), 0);
    const costByVehicle = jobs.reduce((acc, job) => {
      acc[job.vehicle] = (acc[job.vehicle] || 0) + Number(job.finalCostGbp ?? job.estimatedCostGbp);
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

    const vehicles = rows.map((v) => ({
      id: v.id,
      label: `${v.registration_number} · ${v.fleet_code} · ${v.model_name}`,
      registrationNumber: v.registration_number,
      fleetCode: v.fleet_code,
      make: v.model_name,
      truckType: v.truck_type
    }));

    res.json({
      header: {
        badge: "Maintenance planner",
        title: "Fleet maintenance portal",
        description: "Plan services, 6-week inspections, defects, and workshop readiness from live fleet data."
      },
      highlights: [
        "Planner rows are generated from vehicles, maintenance logs, inspections, and defects.",
        "Use due filters to separate overdue work, upcoming workshop bookings, and healthy assets.",
        "Vehicle profile remains the record entry point for adding maintenance, inspections, and defects."
      ],
      stats: [
        { label: "Overdue", value: overdue + jobs.filter((job) => job.daysLeft < 0 && !["completed", "cancelled"].includes(job.status)).length, description: "Service, inspection, or job past due.", change: "Immediate action", tone: overdue ? "danger" : "success" },
        { label: "Booked this week", value: jobs.filter((job) => job.status === "booked" && job.daysLeft >= 0 && job.daysLeft <= 7).length, description: "Confirmed workshop bookings.", change: "Workshop", tone: "warning" },
        { label: "Vehicles off road", value: plannerRows.filter((row) => ["maintenance", "stopped"].includes(row.status)).length, description: "Maintenance or stopped status.", change: "Availability", tone: "danger" },
        { label: "Monthly spend", value: fmtAmount(monthlySpend), description: "Estimated and actual this month.", change: "Cost control", tone: "neutral" }
      ],
      health: [
        { label: "Open estimated cost", value: fmtAmount(openEstimated), description: "Open planned/booked/in-progress job estimates.", change: "Forecast", tone: "warning" },
        { label: "Completed actual cost", value: fmtAmount(completedActual), description: "Final cost on completed jobs.", change: "History", tone: "success" },
        { label: "Highest cost vehicle", value: highestCost ? highestCost[0] : "-", description: highestCost ? fmtAmount(highestCost[1]) : "No job costs yet.", change: "Cost trend", tone: "neutral" },
        { label: "Ready after checks", value: available, description: "Available and clear beyond 14 days.", change: "Assignable", tone: "success" }
      ],
      weeklyBoard,
      plannerRows,
      vehicles,
      jobs,
      defects,
      complianceItems,
      calendarEvents,
      history,
      costByVehicle: costByVehicleRows,
      workshopQueue: plannerRows
        .filter((row) => row.dueTone !== "success" || row.openDefects > 0 || ["maintenance", "stopped"].includes(row.status))
        .sort((a, b) => (a.priorityDays ?? 9999) - (b.priorityDays ?? 9999))
        .slice(0, 8),
      filterOptions: {
        vendors: Array.from(new Set(jobs.map((job) => job.garageName).filter((value) => value && value !== "-"))),
        vehicleTypes: Array.from(new Set(vehicles.map((vehicle) => vehicle.truckType).filter(Boolean)))
      }
    });
  } catch (err) {
    res.status(500).json({ message: "Maintenance portal error", error: err.message });
  }
};

exports.createJob = async (req, res) => {
  try {
    const job = cleanJobPayload(req.body);
    if (!job.vehicle_id || !job.service_type || !job.due_date) {
      return res.status(400).json({ message: "Vehicle, service type, and due date are required." });
    }
    const jobNumber = await nextJobNumber();
    const [result] = await db.query(
      `INSERT INTO maintenance_jobs
        (job_number, vehicle_id, defect_id, service_type, due_date, garage_name, assigned_mechanic,
         estimated_cost_gbp, labour_cost_gbp, parts_cost_gbp, final_cost_gbp, priority, status, notes, parts_required, completion_notes)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        jobNumber, job.vehicle_id, job.defect_id, job.service_type, job.due_date, job.garage_name, job.assigned_mechanic,
        job.estimated_cost_gbp, job.labour_cost_gbp, job.parts_cost_gbp, job.final_cost_gbp,
        job.priority, job.status, job.notes, job.parts_required, job.completion_notes
      ]
    );
    if (job.defect_id) {
      await db.query(`UPDATE defect_reports SET status='in_progress' WHERE id=?`, [job.defect_id]);
    }
    await setVehicleWorkshopStatus(job.vehicle_id, job.status);
    res.status(201).json({ message: "Maintenance job created.", id: result.insertId, jobNumber });
  } catch (err) {
    res.status(500).json({ message: "Maintenance job create error", error: err.message });
  }
};

exports.updateJob = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const job = cleanJobPayload(req.body);
    if (!id || !job.vehicle_id || !job.service_type || !job.due_date) {
      return res.status(400).json({ message: "Valid job, vehicle, service type, and due date are required." });
    }
    await db.query(
      `UPDATE maintenance_jobs SET
        vehicle_id=?, defect_id=?, service_type=?, due_date=?, garage_name=?, assigned_mechanic=?,
        estimated_cost_gbp=?, labour_cost_gbp=?, parts_cost_gbp=?, final_cost_gbp=?,
        priority=?, status=?, notes=?, parts_required=?, completion_notes=?
       WHERE id=?`,
      [
        job.vehicle_id, job.defect_id, job.service_type, job.due_date, job.garage_name, job.assigned_mechanic,
        job.estimated_cost_gbp, job.labour_cost_gbp, job.parts_cost_gbp, job.final_cost_gbp,
        job.priority, job.status, job.notes, job.parts_required, job.completion_notes, id
      ]
    );
    await setVehicleWorkshopStatus(job.vehicle_id, job.status);
    res.json({ message: "Maintenance job updated." });
  } catch (err) {
    res.status(500).json({ message: "Maintenance job update error", error: err.message });
  }
};

exports.completeJob = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [[job]] = await db.query(`SELECT * FROM maintenance_jobs WHERE id=?`, [id]);
    if (!job) return res.status(404).json({ message: "Maintenance job not found." });

    const finalCost = Number(req.body.final_cost_gbp || req.body.finalCostGbp || job.final_cost_gbp || job.estimated_cost_gbp || 0);
    const completionNotes = String(req.body.completion_notes || req.body.completionNotes || job.completion_notes || "").trim() || null;
    const nextDueDate = req.body.next_due_date || req.body.nextDueDate || null;

    await db.query(
      `UPDATE maintenance_jobs
       SET status='completed', final_cost_gbp=?, completion_notes=?, completed_at=NOW()
       WHERE id=?`,
      [finalCost, completionNotes, id]
    );
    await db.query(
      `INSERT INTO maintenance_records (vehicle_id, service_date, service_type, description, cost_gbp, next_due_date, garage_name)
       VALUES (?, CURDATE(), ?, ?, ?, ?, ?)`,
      [job.vehicle_id, job.service_type, completionNotes || job.notes, finalCost, nextDueDate, job.garage_name]
    );
    if (nextDueDate) {
      await db.query(`UPDATE vehicles SET next_service_due=? WHERE id=?`, [nextDueDate, job.vehicle_id]);
    }
    if (job.defect_id) {
      await db.query(`UPDATE defect_reports SET status='resolved', resolved_at=NOW() WHERE id=?`, [job.defect_id]);
    }
    const [[open]] = await db.query(
      `SELECT COUNT(*) AS count FROM maintenance_jobs WHERE vehicle_id=? AND status IN ('booked','in_progress')`,
      [job.vehicle_id]
    );
    if (Number(open.count || 0) === 0) {
      await db.query(`UPDATE vehicles SET status='available' WHERE id=? AND status='maintenance'`, [job.vehicle_id]);
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
    const due = req.body.due_date || rawDate(addDays(new Date(), defect.severity === "critical" ? 1 : defect.severity === "high" ? 3 : 7));
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
        req.body.service_type || defect.defect_type,
        due,
        req.body.garage_name || null,
        req.body.assigned_mechanic || null,
        Number(req.body.estimated_cost_gbp || 0),
        defect.severity === "critical" ? "critical" : defect.severity === "high" ? "high" : "normal",
        "booked",
        defect.description || null,
        req.body.parts_required || null
      ]
    );
    await db.query(`UPDATE defect_reports SET status='in_progress' WHERE id=?`, [defect.id]);
    await db.query(`UPDATE vehicles SET status='maintenance' WHERE id=?`, [defect.vehicle_id]);
    res.status(201).json({ message: "Repair job created from defect.", id: result.insertId, jobNumber });
  } catch (err) {
    res.status(500).json({ message: "Defect repair job error", error: err.message });
  }
};
