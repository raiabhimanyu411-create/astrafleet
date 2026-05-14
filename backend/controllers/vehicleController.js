const db = require("../db/connection");

const vehicleColumns = [
  ["fuel_type", "fuel_type VARCHAR(30) DEFAULT NULL"],
  ["capacity_tonnes", "capacity_tonnes DECIMAL(6,2) DEFAULT NULL"],
  ["year_of_manufacture", "year_of_manufacture INT DEFAULT NULL"],
  ["colour", "colour VARCHAR(40) DEFAULT NULL"],
  ["mot_expiry", "mot_expiry DATE DEFAULT NULL"],
  ["insurance_expiry", "insurance_expiry DATE DEFAULT NULL"],
  ["road_tax_expiry", "road_tax_expiry DATE DEFAULT NULL"]
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

// GET /api/vehicles
exports.listVehicles = async (req, res) => {
  try {
    const [[counts]] = await db.query(
      `SELECT COUNT(*) as total,
        COALESCE(SUM(status='available'), 0)   as available,
        COALESCE(SUM(status='in_transit'), 0)  as in_transit,
        COALESCE(SUM(status='maintenance'), 0) as maintenance,
        COALESCE(SUM(status='planned'), 0)     as planned,
        COALESCE(SUM(status='stopped'), 0)     as stopped
       FROM vehicles`
    );

    const [rows] = await db.query(
      `SELECT v.*, COUNT(DISTINCT t.id) AS total_trips
       FROM vehicles v
       LEFT JOIN trips t ON t.vehicle_id = v.id
       GROUP BY v.id
       ORDER BY v.created_at DESC`
    );

    const statusTone = {
      available: "success", planned: "neutral",
      in_transit: "warning", maintenance: "danger", stopped: "danger"
    };

    res.json({
      stats: [
        { label: "Total vehicles",  value: counts.total,       tone: "neutral" },
        { label: "Available",       value: counts.available,   tone: "success" },
        { label: "In transit",      value: counts.in_transit,  tone: "warning" },
        { label: "Maintenance",     value: Number(counts.maintenance) + Number(counts.stopped), tone: "danger" }
      ],
      vehicles: rows.map(v => ({
        id: v.id,
        registrationNumber: v.registration_number,
        fleetCode: v.fleet_code,
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
        motExpiryTone: expiryTone(v.mot_expiry),
        insuranceExpiry: fmtDate(v.insurance_expiry),
        insuranceExpiryTone: expiryTone(v.insurance_expiry),
        roadTaxExpiry: fmtDate(v.road_tax_expiry),
        roadTaxExpiryTone: expiryTone(v.road_tax_expiry),
        nextServiceDue: fmtDate(v.next_service_due),
        nextServiceTone: expiryTone(v.next_service_due),
        totalTrips: v.total_trips,
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

    const statusTone       = { available: "success", planned: "neutral", in_transit: "warning", maintenance: "danger", stopped: "danger" };
    const verifyTone       = { valid: "success", expiring: "warning", expired: "danger", pending: "neutral" };
    const dispatchTone     = { active: "success", loading: "warning", blocked: "danger", planned: "neutral", completed: "neutral" };
    const severityTone     = { low: "neutral", medium: "warning", high: "danger", critical: "danger" };
    const defectStatusTone = { open: "danger", in_progress: "warning", resolved: "success" };
    const resultTone       = { pass: "success", advisory: "warning", fail: "danger" };

    const tones = [expiryTone(v.mot_expiry), expiryTone(v.insurance_expiry), expiryTone(v.road_tax_expiry)];
    const complianceTone = tones.includes("danger") ? "danger" : tones.includes("warning") || tones.includes("neutral") ? "warning" : "success";

    res.json({
      id: v.id,
      registrationNumber: v.registration_number,
      fleetCode: v.fleet_code,
      modelName: v.model_name,
      truckType: v.truck_type,
      status: v.status,
      statusTone: statusTone[v.status] || "neutral",
      fuelType: v.fuel_type,
      capacityTonnes: v.capacity_tonnes,
      yearOfManufacture: v.year_of_manufacture,
      colour: v.colour,
      currentLocation: v.current_location,
      nextServiceDue: fmtDate(v.next_service_due),
      nextServiceDueRaw: rawDate(v.next_service_due),
      nextServiceTone: expiryTone(v.next_service_due),
      since: fmtDate(v.created_at),
      complianceTone,

      mot:       { expiry: fmtDate(v.mot_expiry),       raw: rawDate(v.mot_expiry),       tone: expiryTone(v.mot_expiry),       daysLeft: daysUntil(v.mot_expiry) },
      insurance: { expiry: fmtDate(v.insurance_expiry), raw: rawDate(v.insurance_expiry), tone: expiryTone(v.insurance_expiry), daysLeft: daysUntil(v.insurance_expiry) },
      roadTax:   { expiry: fmtDate(v.road_tax_expiry),  raw: rawDate(v.road_tax_expiry),  tone: expiryTone(v.road_tax_expiry),  daysLeft: daysUntil(v.road_tax_expiry) },

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
      registration_number, fleet_code, model_name, truck_type, status,
      fuel_type, capacity_tonnes, year_of_manufacture, colour,
      mot_expiry, insurance_expiry, road_tax_expiry, next_service_due
    } = req.body;

    if (!registration_number || !fleet_code || !model_name || !truck_type) {
      return res.status(400).json({ message: "registration_number, fleet_code, model_name, and truck_type are required." });
    }

    const [result] = await db.query(
      `INSERT INTO vehicles
         (registration_number, fleet_code, model_name, truck_type, status,
          fuel_type, capacity_tonnes, year_of_manufacture, colour,
          mot_expiry, insurance_expiry, road_tax_expiry, next_service_due)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        registration_number, fleet_code, model_name, truck_type,
        status || "available",
        fuel_type || null, capacity_tonnes || null, year_of_manufacture || null, colour || null,
        mot_expiry || null, insurance_expiry || null, road_tax_expiry || null, next_service_due || null
      ]
    );

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
    const [[existing]] = await db.query(`SELECT id FROM vehicles WHERE id = ?`, [id]);
    if (!existing) return res.status(404).json({ message: "Vehicle not found." });

    const {
      registration_number, fleet_code, model_name, truck_type, status,
      fuel_type, capacity_tonnes, year_of_manufacture, colour,
      mot_expiry, insurance_expiry, road_tax_expiry, next_service_due, current_location
    } = req.body;

    await db.query(
      `UPDATE vehicles SET
         registration_number=?, fleet_code=?, model_name=?, truck_type=?, status=?,
         fuel_type=?, capacity_tonnes=?, year_of_manufacture=?, colour=?,
         mot_expiry=?, insurance_expiry=?, road_tax_expiry=?,
         next_service_due=?, current_location=?
       WHERE id=?`,
      [
        registration_number, fleet_code, model_name, truck_type,
        status || "available",
        fuel_type || null, capacity_tonnes || null, year_of_manufacture || null, colour || null,
        mot_expiry || null, insurance_expiry || null, road_tax_expiry || null,
        next_service_due || null, current_location || null,
        id
      ]
    );

    res.json({ message: "Vehicle updated." });
  } catch (err) {
    res.status(500).json({ message: "Vehicle update error", error: err.message });
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
    await db.query(`UPDATE vehicles SET status=? WHERE id=?`, [status, id]);
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
    res.json({ message: "Defect status updated." });
  } catch (err) {
    res.status(500).json({ message: "Defect update error", error: err.message });
  }
};
