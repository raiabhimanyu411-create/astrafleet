const db = require("../db/connection");
const { buildChangeSet, logActivity } = require("../utils/auditLogger");

const vehicleColumns = [
  ["make", "make VARCHAR(80) DEFAULT NULL"],
  ["model", "model VARCHAR(80) DEFAULT NULL"],
  ["fuel_type", "fuel_type VARCHAR(30) DEFAULT NULL"],
  ["capacity_tonnes", "capacity_tonnes DECIMAL(6,2) DEFAULT NULL"],
  ["year_of_manufacture", "year_of_manufacture INT DEFAULT NULL"],
  ["colour", "colour VARCHAR(40) DEFAULT NULL"],
  ["mot_expiry", "mot_expiry DATE DEFAULT NULL"],
  ["insurance_expiry", "insurance_expiry DATE DEFAULT NULL"],
  ["road_tax_expiry", "road_tax_expiry DATE DEFAULT NULL"],
  ["permit_expiry", "permit_expiry DATE DEFAULT NULL"],
  ["pollution_expiry", "pollution_expiry DATE DEFAULT NULL"],
  ["fitness_expiry", "fitness_expiry DATE DEFAULT NULL"],
  ["odometer_reading", "odometer_reading DECIMAL(12,1) DEFAULT NULL"]
];

let schemaSyncPromise;

async function syncVehicleSchema() {
  const [columns] = await db.query(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'vehicles'`
  );
  const existingColumns = new Set(columns.map(col => col.COLUMN_NAME));

  for (const [name, definition] of vehicleColumns) {
    if (!existingColumns.has(name)) {
      await db.query(`ALTER TABLE vehicles ADD COLUMN ${definition}`);
    }
  }

  await db.query(`
    CREATE TABLE IF NOT EXISTS vehicle_documents (
      id                  INT AUTO_INCREMENT PRIMARY KEY,
      vehicle_id          INT NOT NULL,
      document_type       VARCHAR(80) NOT NULL,
      document_number     VARCHAR(80) DEFAULT NULL,
      expiry_date         DATE NOT NULL,
      verification_status ENUM('valid', 'expiring', 'expired', 'pending') NOT NULL DEFAULT 'pending',
      created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_vehicle_documents_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles (id) ON DELETE CASCADE
    ) ENGINE=InnoDB
  `);

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

  await db.query(`
    CREATE TABLE IF NOT EXISTS defect_reports (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      vehicle_id  INT NOT NULL,
      defect_type VARCHAR(80) NOT NULL,
      description TEXT DEFAULT NULL,
      severity    ENUM('low', 'medium', 'high', 'critical') NOT NULL DEFAULT 'medium',
      reported_by VARCHAR(120) DEFAULT NULL,
      status      ENUM('open', 'in_progress', 'resolved') NOT NULL DEFAULT 'open',
      reported_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      resolved_at DATETIME DEFAULT NULL,
      CONSTRAINT fk_defect_reports_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles (id) ON DELETE CASCADE
    ) ENGINE=InnoDB
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS driver_expenses (
      id INT AUTO_INCREMENT PRIMARY KEY,
      driver_id INT NOT NULL,
      trip_id INT DEFAULT NULL,
      expense_type VARCHAR(40) NOT NULL DEFAULT 'fuel',
      amount_gbp DECIMAL(10,2) NOT NULL DEFAULT 0,
      notes VARCHAR(255) DEFAULT NULL,
      receipt_data LONGTEXT DEFAULT NULL,
      expense_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB
  `);
}

exports.ensureVehicleSchema = async (_req, res, next) => {
  try {
    if (!schemaSyncPromise) schemaSyncPromise = syncVehicleSchema();
    await schemaSyncPromise;
    next();
  } catch (err) {
    schemaSyncPromise = null;
    res.status(500).json({ message: "Vehicle schema sync error", error: err.message });
  }
};

function fmtDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}
function rawDate(d) {
  if (!d) return "";
  return new Date(d).toISOString().slice(0, 10);
}
function fmtDateTime(d) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
function daysUntil(dateStr) {
  if (!dateStr) return null;
  const diff = new Date(dateStr) - new Date();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}
function expiryTone(dateStr) {
  const days = daysUntil(dateStr);
  if (days === null) return "neutral";
  if (days < 30)  return "danger";
  if (days < 90)  return "warning";
  return "success";
}

function splitVehicleModelName(modelName = "") {
  const [make = "", ...modelParts] = String(modelName || "").trim().split(/\s+/);
  return { make, model: modelParts.join(" ") };
}

function vehicleMake(row) {
  return row.make || splitVehicleModelName(row.model_name).make || "—";
}

function vehicleModel(row) {
  return row.model || splitVehicleModelName(row.model_name).model || row.model_name || "—";
}

function combinedModelName(make, model, modelName) {
  return String(modelName || [make, model].filter(Boolean).join(" ")).trim();
}

// GET /api/vehicles
exports.listVehicles = async (req, res) => {
  try {
    const [[counts]] = await db.query(
      `SELECT COUNT(*) as total,
        COALESCE(SUM(status='available'), 0)   as available,
        COALESCE(SUM(status='in_transit'), 0)  as in_transit,
        COALESCE(SUM(status='maintenance'), 0) as maintenance,
        COALESCE(SUM(status='planned'), 0)     as planned,
        COALESCE(SUM(status='stopped'), 0)     as stopped,
        COALESCE(SUM(
          mot_expiry < CURDATE()
          OR insurance_expiry < CURDATE()
          OR road_tax_expiry < CURDATE()
          OR permit_expiry < CURDATE()
          OR pollution_expiry < CURDATE()
          OR fitness_expiry < CURDATE()
          OR next_service_due < CURDATE()
        ), 0) as expired_items,
        COALESCE(SUM(
          mot_expiry BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 90 DAY)
          OR insurance_expiry BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 90 DAY)
          OR road_tax_expiry BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 90 DAY)
          OR permit_expiry BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 90 DAY)
          OR pollution_expiry BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 90 DAY)
          OR fitness_expiry BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 90 DAY)
          OR next_service_due BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 90 DAY)
        ), 0) as expiring_items
       FROM vehicles`
    );

    const [rows] = await db.query(
      `SELECT v.*,
              COALESCE(trip.total_trips, 0) AS total_trips,
              COALESCE(trip.open_trips, 0) AS open_trips,
              COALESCE(def.open_defects, 0) AS open_defects,
              COALESCE(def.critical_defects, 0) AS critical_defects,
              trip.last_trip_at
       FROM vehicles v
       LEFT JOIN (
          SELECT vehicle_id,
                 COUNT(*) AS total_trips,
                 SUM(dispatch_status IN ('planned','loading','active')) AS open_trips,
                 MAX(created_at) AS last_trip_at
          FROM trips
          WHERE vehicle_id IS NOT NULL
          GROUP BY vehicle_id
       ) trip ON trip.vehicle_id = v.id
       LEFT JOIN (
          SELECT vehicle_id,
                 COUNT(*) AS open_defects,
                 SUM(severity IN ('critical','high')) AS critical_defects
          FROM defect_reports
          WHERE status != 'resolved'
          GROUP BY vehicle_id
       ) def ON def.vehicle_id = v.id
       ORDER BY v.created_at DESC`
    );

    const statusTone = {
      available: "success", planned: "neutral",
      in_transit: "warning", maintenance: "danger", stopped: "danger"
    };

    res.json({
      stats: [
        { label: "Total vehicles", value: counts.total, description: "All fleet assets.", change: "Live from database", tone: "neutral" },
        { label: "Available", value: counts.available, description: "Ready for assignment.", change: "Fleet ready", tone: "success" },
        { label: "In transit", value: counts.in_transit, description: "Currently on road.", change: "Live fleet", tone: "warning" },
        { label: "Maintenance", value: Number(counts.maintenance) + Number(counts.stopped), description: "Unavailable or stopped.", change: "Workshop queue", tone: "danger" }
      ],
      fleetHealth: [
        { label: "Expired items", value: counts.expired_items, description: "Compliance or service overdue.", change: "Stop dispatch", tone: counts.expired_items ? "danger" : "success" },
        { label: "Expiring soon", value: counts.expiring_items, description: "Due within 90 days.", change: "Renewal queue", tone: counts.expiring_items ? "warning" : "success" },
        { label: "Open defects", value: rows.reduce((sum, v) => sum + Number(v.open_defects || 0), 0), description: "Unresolved defect reports.", change: "Workshop", tone: rows.some(v => Number(v.open_defects || 0) > 0) ? "danger" : "success" },
        { label: "Open trips", value: rows.reduce((sum, v) => sum + Number(v.open_trips || 0), 0), description: "Planned, loading, or active trips.", change: "Dispatch", tone: "neutral" }
      ],
      vehicles: rows.map(v => ({
        id: v.id,
        registrationNumber: v.registration_number,
        fleetCode: v.fleet_code,
        make: vehicleMake(v),
        model: vehicleModel(v),
        modelName: v.model_name,
        truckType: v.truck_type,
        status: v.status,
        statusTone: statusTone[v.status] || "neutral",
        fuelType: v.fuel_type || "—",
        capacityTonnes: v.capacity_tonnes || "—",
        yearOfManufacture: v.year_of_manufacture || "—",
        colour: v.colour || "—",
        currentLocation: v.current_location || "—",
        motExpiry: fmtDate(v.mot_expiry),
        motExpiryRaw: rawDate(v.mot_expiry),
        motDaysLeft: daysUntil(v.mot_expiry),
        motExpiryTone: expiryTone(v.mot_expiry),
        insuranceExpiry: fmtDate(v.insurance_expiry),
        insuranceExpiryRaw: rawDate(v.insurance_expiry),
        insuranceDaysLeft: daysUntil(v.insurance_expiry),
        insuranceExpiryTone: expiryTone(v.insurance_expiry),
        roadTaxExpiry: fmtDate(v.road_tax_expiry),
        roadTaxExpiryRaw: rawDate(v.road_tax_expiry),
        roadTaxDaysLeft: daysUntil(v.road_tax_expiry),
        roadTaxExpiryTone: expiryTone(v.road_tax_expiry),
        permitExpiry: fmtDate(v.permit_expiry),
        permitExpiryRaw: rawDate(v.permit_expiry),
        permitExpiryTone: expiryTone(v.permit_expiry),
        pollutionExpiry: fmtDate(v.pollution_expiry),
        pollutionExpiryRaw: rawDate(v.pollution_expiry),
        pollutionExpiryTone: expiryTone(v.pollution_expiry),
        fitnessExpiry: fmtDate(v.fitness_expiry),
        fitnessExpiryRaw: rawDate(v.fitness_expiry),
        fitnessExpiryTone: expiryTone(v.fitness_expiry),
        odometerReading: v.odometer_reading ? `${Number(v.odometer_reading).toLocaleString("en-GB")} km` : "—",
        odometerReadingRaw: v.odometer_reading ?? "",
        nextServiceDue: fmtDate(v.next_service_due),
        nextServiceDueRaw: rawDate(v.next_service_due),
        nextServiceDaysLeft: daysUntil(v.next_service_due),
        nextServiceTone: expiryTone(v.next_service_due),
        totalTrips: v.total_trips,
        openTrips: v.open_trips,
        openDefects: Number(v.open_defects || 0),
        criticalDefects: Number(v.critical_defects || 0),
        lastActivity: fmtDate(v.last_trip_at || v.created_at),
        complianceRisk: [v.mot_expiry, v.insurance_expiry, v.road_tax_expiry, v.permit_expiry, v.pollution_expiry, v.fitness_expiry, v.next_service_due].some(date => {
          const days = daysUntil(date);
          return days !== null && days < 90;
        }) || Number(v.open_defects || 0) > 0,
        since: fmtDate(v.created_at)
      }))
    });
  } catch (err) {
    res.status(500).json({ message: "Vehicle list error", error: err.message });
  }
};

// GET /api/vehicles/:id
exports.getVehicleById = async (req, res) => {
  try {
    const { id } = req.params;
    const [[v]] = await db.query(`SELECT * FROM vehicles WHERE id = ?`, [id]);
    if (!v) return res.status(404).json({ message: "Vehicle not found." });

    const [docs] = await db.query(
      `SELECT * FROM vehicle_documents WHERE vehicle_id = ? ORDER BY expiry_date ASC`, [id]
    );
    const [maintenance] = await db.query(
      `SELECT * FROM maintenance_records WHERE vehicle_id = ? ORDER BY service_date DESC LIMIT 20`, [id]
    );
    const [inspections] = await db.query(
      `SELECT * FROM vehicle_inspections WHERE vehicle_id = ? ORDER BY inspection_date DESC LIMIT 20`, [id]
    );
    const [defects] = await db.query(
      `SELECT * FROM defect_reports WHERE vehicle_id = ? ORDER BY reported_at DESC LIMIT 20`, [id]
    );
    const [trips] = await db.query(
      `SELECT t.id, t.trip_code, t.dispatch_status, t.planned_departure, t.freight_amount_gbp,
              r.origin_hub, r.destination_hub, d.full_name AS driver_name
       FROM trips t
       LEFT JOIN routes  r ON t.route_id  = r.id
       LEFT JOIN drivers d ON t.driver_id = d.id
       WHERE t.vehicle_id = ?
       ORDER BY t.created_at DESC LIMIT 20`, [id]
    );
    const [fuelHistory] = await db.query(
      `SELECT e.id, e.amount_gbp, e.notes, e.expense_at, d.full_name, t.trip_code
       FROM driver_expenses e
       LEFT JOIN trips t ON t.id = e.trip_id
       LEFT JOIN drivers d ON d.id = e.driver_id
       WHERE t.vehicle_id = ? AND e.expense_type = 'fuel'
       ORDER BY e.expense_at DESC LIMIT 20`,
      [id]
    );

    const statusTone       = { available: "success", planned: "neutral", in_transit: "warning", maintenance: "danger", stopped: "danger" };
    const verifyTone       = { valid: "success", expiring: "warning", expired: "danger", pending: "neutral" };
    const dispatchTone     = { active: "success", loading: "warning", blocked: "danger", planned: "neutral", completed: "neutral" };
    const severityTone     = { low: "neutral", medium: "warning", high: "danger", critical: "danger" };
    const defectStatusTone = { open: "danger", in_progress: "warning", resolved: "success" };
    const resultTone       = { pass: "success", advisory: "warning", fail: "danger" };

    const tones = [expiryTone(v.mot_expiry), expiryTone(v.insurance_expiry), expiryTone(v.road_tax_expiry), expiryTone(v.permit_expiry), expiryTone(v.pollution_expiry), expiryTone(v.fitness_expiry)];
    const complianceTone = tones.includes("danger") ? "danger" : tones.includes("warning") || tones.includes("neutral") ? "warning" : "success";

    res.json({
      id: v.id,
      registrationNumber: v.registration_number,
      fleetCode: v.fleet_code,
      make: vehicleMake(v),
      model: vehicleModel(v),
      modelName: v.model_name,
      truckType: v.truck_type,
      status: v.status,
      statusTone: statusTone[v.status] || "neutral",
      fuelType: v.fuel_type,
      capacityTonnes: v.capacity_tonnes,
      yearOfManufacture: v.year_of_manufacture,
      colour: v.colour,
      odometerReading: v.odometer_reading,
      currentLocation: v.current_location,
      nextServiceDue: fmtDate(v.next_service_due),
      nextServiceDueRaw: rawDate(v.next_service_due),
      nextServiceTone: expiryTone(v.next_service_due),
      since: fmtDate(v.created_at),
      complianceTone,

      mot:       { expiry: fmtDate(v.mot_expiry),       raw: rawDate(v.mot_expiry),       tone: expiryTone(v.mot_expiry),       daysLeft: daysUntil(v.mot_expiry) },
      insurance: { expiry: fmtDate(v.insurance_expiry), raw: rawDate(v.insurance_expiry), tone: expiryTone(v.insurance_expiry), daysLeft: daysUntil(v.insurance_expiry) },
      roadTax:   { expiry: fmtDate(v.road_tax_expiry),  raw: rawDate(v.road_tax_expiry),  tone: expiryTone(v.road_tax_expiry),  daysLeft: daysUntil(v.road_tax_expiry) },
      permit:    { expiry: fmtDate(v.permit_expiry),    raw: rawDate(v.permit_expiry),    tone: expiryTone(v.permit_expiry),    daysLeft: daysUntil(v.permit_expiry) },
      pollution: { expiry: fmtDate(v.pollution_expiry), raw: rawDate(v.pollution_expiry), tone: expiryTone(v.pollution_expiry), daysLeft: daysUntil(v.pollution_expiry) },
      fitness:   { expiry: fmtDate(v.fitness_expiry),   raw: rawDate(v.fitness_expiry),   tone: expiryTone(v.fitness_expiry),   daysLeft: daysUntil(v.fitness_expiry) },

      documents: docs.map(doc => ({
        id: doc.id,
        type: doc.document_type,
        number: doc.document_number,
        expiry: fmtDate(doc.expiry_date),
        expiryRaw: rawDate(doc.expiry_date),
        expiryTone: expiryTone(doc.expiry_date),
        daysLeft: daysUntil(doc.expiry_date),
        status: doc.verification_status,
        statusTone: verifyTone[doc.verification_status] || "neutral"
      })),

      maintenance: maintenance.map(m => ({
        id: m.id,
        serviceDate: fmtDate(m.service_date),
        serviceType: m.service_type,
        description: m.description || "—",
        costGbp: m.cost_gbp ? `£${Number(m.cost_gbp).toLocaleString("en-GB", { minimumFractionDigits: 2 })}` : "—",
        mileage: m.mileage ? `${Number(m.mileage).toLocaleString()} mi` : "—",
        nextDue: fmtDate(m.next_due_date),
        garageName: m.garage_name || "—"
      })),

      inspections: inspections.map(i => ({
        id: i.id,
        inspectionDate: fmtDate(i.inspection_date),
        inspectionType: i.inspection_type,
        inspectorName: i.inspector_name || "—",
        result: i.result,
        resultTone: resultTone[i.result] || "neutral",
        notes: i.notes || "—",
        nextDue: fmtDate(i.next_due)
      })),

      defects: defects.map(d => ({
        id: d.id,
        defectType: d.defect_type,
        description: d.description || "—",
        severity: d.severity,
        severityTone: severityTone[d.severity] || "neutral",
        status: d.status,
        statusTone: defectStatusTone[d.status] || "neutral",
        reportedBy: d.reported_by || "—",
        reportedAt: fmtDateTime(d.reported_at),
        resolvedAt: d.resolved_at ? fmtDateTime(d.resolved_at) : null
      })),

      trips: trips.map(t => ({
        id: t.id,
        code: t.trip_code,
        lane: t.origin_hub && t.destination_hub ? `${t.origin_hub} → ${t.destination_hub}` : "Custom route",
        driver: t.driver_name || "—",
        departure: fmtDate(t.planned_departure),
        status: t.dispatch_status,
        statusTone: dispatchTone[t.dispatch_status] || "neutral",
        freight: t.freight_amount_gbp ? `£${Number(t.freight_amount_gbp).toLocaleString("en-GB", { minimumFractionDigits: 2 })}` : "—"
      })),

      fuelHistory: fuelHistory.map(f => ({
        id: f.id,
        tripCode: f.trip_code || "—",
        driver: f.full_name || "—",
        amount: f.amount_gbp ? `£${Number(f.amount_gbp).toLocaleString("en-GB", { minimumFractionDigits: 2 })}` : "—",
        notes: f.notes || "—",
        at: fmtDateTime(f.expense_at)
      }))
    });
  } catch (err) {
    res.status(500).json({ message: "Vehicle detail error", error: err.message });
  }
};

// POST /api/vehicles
exports.createVehicle = async (req, res) => {
  try {
    const {
      registration_number, fleet_code, make, model, model_name, truck_type, status,
      fuel_type, capacity_tonnes, year_of_manufacture, colour,
      mot_expiry, insurance_expiry, road_tax_expiry, permit_expiry, pollution_expiry, fitness_expiry,
      odometer_reading, next_service_due
    } = req.body;
    const finalModelName = combinedModelName(make, model, model_name);

    if (!registration_number || !fleet_code || !make || !model || !truck_type) {
      return res.status(400).json({ message: "registration_number, fleet_code, make, model, and truck_type are required." });
    }

    const [result] = await db.query(
      `INSERT INTO vehicles
         (registration_number, fleet_code, make, model, model_name, truck_type, status,
          fuel_type, capacity_tonnes, year_of_manufacture, colour,
          mot_expiry, insurance_expiry, road_tax_expiry, permit_expiry, pollution_expiry, fitness_expiry,
          odometer_reading, next_service_due)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        registration_number, fleet_code, make, model, finalModelName, truck_type,
        status || "available",
        fuel_type || null, capacity_tonnes || null, year_of_manufacture || null, colour || null,
        mot_expiry || null, insurance_expiry || null, road_tax_expiry || null,
        permit_expiry || null, pollution_expiry || null, fitness_expiry || null,
        odometer_reading || null, next_service_due || null
      ]
    );

    await logActivity(req, {
      module: "vehicles",
      action: "create",
      entityType: "vehicle",
      entityId: result.insertId,
      entityLabel: registration_number,
      details: { registration_number, fleet_code, make, model, model_name: finalModelName, truck_type, status: status || "available" }
    });
    res.status(201).json({ message: "Vehicle created.", id: result.insertId });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: "Registration number or fleet code already exists." });
    }
    res.status(500).json({ message: "Vehicle create error", error: err.message });
  }
};

// PUT /api/vehicles/:id
exports.updateVehicle = async (req, res) => {
  try {
    const { id } = req.params;
    const [[existing]] = await db.query(`SELECT * FROM vehicles WHERE id = ?`, [id]);
    if (!existing) return res.status(404).json({ message: "Vehicle not found." });

    const {
      registration_number, fleet_code, make, model, model_name, truck_type, status,
      fuel_type, capacity_tonnes, year_of_manufacture, colour,
      mot_expiry, insurance_expiry, road_tax_expiry, permit_expiry, pollution_expiry, fitness_expiry,
      odometer_reading, next_service_due, current_location
    } = req.body;
    const finalModelName = combinedModelName(make, model, model_name);

    await db.query(
      `UPDATE vehicles SET
         registration_number=?, fleet_code=?, make=?, model=?, model_name=?, truck_type=?, status=?,
         fuel_type=?, capacity_tonnes=?, year_of_manufacture=?, colour=?,
         mot_expiry=?, insurance_expiry=?, road_tax_expiry=?,
         permit_expiry=?, pollution_expiry=?, fitness_expiry=?, odometer_reading=?,
         next_service_due=?, current_location=?
       WHERE id=?`,
      [
        registration_number, fleet_code, make || null, model || null, finalModelName, truck_type,
        status || "available",
        fuel_type || null, capacity_tonnes || null, year_of_manufacture || null, colour || null,
        mot_expiry || null, insurance_expiry || null, road_tax_expiry || null,
        permit_expiry || null, pollution_expiry || null, fitness_expiry || null, odometer_reading || null,
        next_service_due || null, current_location || null,
        id
      ]
    );

    const [[updated]] = await db.query(`SELECT * FROM vehicles WHERE id = ?`, [id]);
    await logActivity(req, {
      module: "vehicles",
      action: "update",
      entityType: "vehicle",
      entityId: id,
      entityLabel: updated.registration_number,
      details: { changes: buildChangeSet(existing, updated, ["registration_number", "fleet_code", "make", "model", "model_name", "truck_type", "status", "fuel_type", "capacity_tonnes", "mot_expiry", "insurance_expiry", "road_tax_expiry", "permit_expiry", "pollution_expiry", "fitness_expiry", "odometer_reading", "next_service_due", "current_location"]) }
    });
    res.json({ message: "Vehicle updated." });
  } catch (err) {
    res.status(500).json({ message: "Vehicle update error", error: err.message });
  }
};

// PATCH /api/vehicles/:id/inline
exports.updateVehicleInline = async (req, res) => {
  try {
    const { id } = req.params;
    const [[existing]] = await db.query(`SELECT * FROM vehicles WHERE id = ?`, [id]);
    if (!existing) return res.status(404).json({ message: "Vehicle not found." });

    const fieldMap = {
      registrationNumber: "registration_number",
      fleetCode: "fleet_code",
      make: "make",
      model: "model",
      modelName: "model_name",
      truckType: "truck_type",
      status: "status",
      fuelType: "fuel_type",
      capacityTonnes: "capacity_tonnes",
      yearOfManufacture: "year_of_manufacture",
      colour: "colour",
      currentLocation: "current_location",
      motExpiry: "mot_expiry",
      insuranceExpiry: "insurance_expiry",
      roadTaxExpiry: "road_tax_expiry",
      permitExpiry: "permit_expiry",
      pollutionExpiry: "pollution_expiry",
      fitnessExpiry: "fitness_expiry",
      odometerReading: "odometer_reading",
      nextServiceDue: "next_service_due"
    };
    const validStatus = ["available", "planned", "in_transit", "maintenance", "stopped"];
    const updates = [];
    const values = [];

    Object.entries(req.body || {}).forEach(([field, value]) => {
      const column = fieldMap[field];
      if (!column) return;
      if (field === "status" && !validStatus.includes(value)) return;
      updates.push(`${column} = ?`);
      values.push(value === "" ? null : value);
    });

    if (!updates.length) {
      return res.status(400).json({ message: "No valid vehicle fields supplied." });
    }

    await db.query(`UPDATE vehicles SET ${updates.join(", ")} WHERE id = ?`, [...values, id]);
    const [[updated]] = await db.query(`SELECT * FROM vehicles WHERE id = ?`, [id]);

    await logActivity(req, {
      module: "vehicles",
      action: "inline_update",
      entityType: "vehicle",
      entityId: id,
      entityLabel: updated.registration_number,
      details: {
        changes: buildChangeSet(existing, updated, Object.values(fieldMap))
      }
    });

    res.json({ message: "Vehicle updated." });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: "Registration number or fleet code already exists." });
    }
    res.status(500).json({ message: "Vehicle inline update error", error: err.message });
  }
};

// PATCH /api/vehicles/:id/status
exports.updateVehicleStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const valid = ["available", "planned", "in_transit", "maintenance", "stopped"];
    if (!valid.includes(status)) {
      return res.status(400).json({ message: "Invalid status." });
    }
    const [[before]] = await db.query(`SELECT id, registration_number, status FROM vehicles WHERE id=?`, [id]);
    await db.query(`UPDATE vehicles SET status=? WHERE id=?`, [status, id]);
    await logActivity(req, {
      module: "vehicles",
      action: "status_update",
      entityType: "vehicle",
      entityId: id,
      entityLabel: before?.registration_number,
      details: { changes: buildChangeSet(before || {}, { ...(before || {}), status }, ["status"]) }
    });
    res.json({ message: "Status updated." });
  } catch (err) {
    res.status(500).json({ message: "Status update error", error: err.message });
  }
};

// POST /api/vehicles/:id/documents
exports.addDocument = async (req, res) => {
  try {
    const { id } = req.params;
    const { document_type, document_number, expiry_date } = req.body;
    if (!document_type || !expiry_date) {
      return res.status(400).json({ message: "document_type and expiry_date are required." });
    }
    const days = daysUntil(expiry_date);
    const autoStatus = days < 0 ? "expired" : days < 30 ? "expiring" : "pending";
    const [result] = await db.query(
      `INSERT INTO vehicle_documents (vehicle_id, document_type, document_number, expiry_date, verification_status)
       VALUES (?,?,?,?,?)`,
      [id, document_type, document_number || "", expiry_date, autoStatus]
    );
    await logActivity(req, { module: "vehicles", action: "create", entityType: "vehicle_document", entityId: result.insertId, entityLabel: document_type, details: { vehicle_id: id, expiry_date } });
    res.status(201).json({ message: "Document added.", id: result.insertId });
  } catch (err) {
    res.status(500).json({ message: "Document add error", error: err.message });
  }
};

// PUT /api/vehicles/:id/documents/:docId
exports.updateDocument = async (req, res) => {
  try {
    const { id, docId } = req.params;
    const { document_type, document_number, expiry_date } = req.body;
    const days = daysUntil(expiry_date);
    const autoStatus = days !== null && days < 0 ? "expired" : days !== null && days < 30 ? "expiring" : "pending";
    await db.query(
      `UPDATE vehicle_documents SET document_type=?, document_number=?, expiry_date=?, verification_status=?
       WHERE id=? AND vehicle_id=?`,
      [document_type, document_number || "", expiry_date, autoStatus, docId, id]
    );
    await logActivity(req, { module: "vehicles", action: "update", entityType: "vehicle_document", entityId: docId, entityLabel: document_type, details: { vehicle_id: id, expiry_date } });
    res.json({ message: "Document updated." });
  } catch (err) {
    res.status(500).json({ message: "Document update error", error: err.message });
  }
};

// DELETE /api/vehicles/:id/documents/:docId
exports.deleteDocument = async (req, res) => {
  try {
    const { id, docId } = req.params;
    await db.query(`DELETE FROM vehicle_documents WHERE id=? AND vehicle_id=?`, [docId, id]);
    await logActivity(req, { module: "vehicles", action: "delete", entityType: "vehicle_document", entityId: docId, details: { vehicle_id: id } });
    res.json({ message: "Document removed." });
  } catch (err) {
    res.status(500).json({ message: "Document delete error", error: err.message });
  }
};

// POST /api/vehicles/:id/maintenance
exports.addMaintenance = async (req, res) => {
  try {
    const { id } = req.params;
    const { service_date, service_type, description, cost_gbp, mileage, next_due_date, garage_name } = req.body;
    if (!service_date || !service_type) {
      return res.status(400).json({ message: "service_date and service_type are required." });
    }
    if (next_due_date) {
      await db.query(`UPDATE vehicles SET next_service_due=? WHERE id=?`, [next_due_date, id]);
    }
    const [result] = await db.query(
      `INSERT INTO maintenance_records (vehicle_id, service_date, service_type, description, cost_gbp, mileage, next_due_date, garage_name)
       VALUES (?,?,?,?,?,?,?,?)`,
      [id, service_date, service_type, description || null, cost_gbp || 0, mileage || null, next_due_date || null, garage_name || null]
    );
    await logActivity(req, { module: "vehicles", action: "create", entityType: "maintenance_record", entityId: result.insertId, entityLabel: service_type, details: { vehicle_id: id, service_date, cost_gbp } });
    res.status(201).json({ message: "Maintenance record added.", id: result.insertId });
  } catch (err) {
    res.status(500).json({ message: "Maintenance add error", error: err.message });
  }
};

// DELETE /api/vehicles/:id/maintenance/:recId
exports.deleteMaintenance = async (req, res) => {
  try {
    const { id, recId } = req.params;
    await db.query(`DELETE FROM maintenance_records WHERE id=? AND vehicle_id=?`, [recId, id]);
    await logActivity(req, { module: "vehicles", action: "delete", entityType: "maintenance_record", entityId: recId, details: { vehicle_id: id } });
    res.json({ message: "Record removed." });
  } catch (err) {
    res.status(500).json({ message: "Maintenance delete error", error: err.message });
  }
};

// POST /api/vehicles/:id/inspections
exports.addInspection = async (req, res) => {
  try {
    const { id } = req.params;
    const { inspection_date, inspection_type, inspector_name, result, notes, next_due } = req.body;
    if (!inspection_date || !result) {
      return res.status(400).json({ message: "inspection_date and result are required." });
    }
    const [ins] = await db.query(
      `INSERT INTO vehicle_inspections (vehicle_id, inspection_date, inspection_type, inspector_name, result, notes, next_due)
       VALUES (?,?,?,?,?,?,?)`,
      [id, inspection_date, inspection_type || "Routine", inspector_name || null, result, notes || null, next_due || null]
    );
    await logActivity(req, { module: "vehicles", action: "create", entityType: "vehicle_inspection", entityId: ins.insertId, details: { vehicle_id: id, result } });
    res.status(201).json({ message: "Inspection added.", id: ins.insertId });
  } catch (err) {
    res.status(500).json({ message: "Inspection add error", error: err.message });
  }
};

// POST /api/vehicles/:id/defects
exports.addDefect = async (req, res) => {
  try {
    const { id } = req.params;
    const { defect_type, description, severity, reported_by } = req.body;
    if (!defect_type) {
      return res.status(400).json({ message: "defect_type is required." });
    }
    const [result] = await db.query(
      `INSERT INTO defect_reports (vehicle_id, defect_type, description, severity, reported_by, status)
       VALUES (?,?,?,?,?,'open')`,
      [id, defect_type, description || null, severity || "medium", reported_by || null]
    );
    await logActivity(req, { module: "vehicles", action: "create", entityType: "defect_report", entityId: result.insertId, entityLabel: defect_type, details: { vehicle_id: id, severity: severity || "medium" } });
    res.status(201).json({ message: "Defect reported.", id: result.insertId });
  } catch (err) {
    res.status(500).json({ message: "Defect add error", error: err.message });
  }
};

// PATCH /api/vehicles/:id/defects/:defId
exports.updateDefectStatus = async (req, res) => {
  try {
    const { id, defId } = req.params;
    const { status } = req.body;
    const resolvedAt = status === "resolved" ? new Date() : null;
    await db.query(
      `UPDATE defect_reports SET status=?, resolved_at=? WHERE id=? AND vehicle_id=?`,
      [status, resolvedAt, defId, id]
    );
    await logActivity(req, { module: "vehicles", action: "status_update", entityType: "defect_report", entityId: defId, details: { vehicle_id: id, status } });
    res.json({ message: "Defect status updated." });
  } catch (err) {
    res.status(500).json({ message: "Defect update error", error: err.message });
  }
};
