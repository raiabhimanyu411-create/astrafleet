const crypto = require("crypto");
const db = require("../db/connection");
const { logActivity } = require("../utils/auditLogger");
const {
  checklistFor,
  isDataUrl,
  normalizeAsset,
  validateInspection,
  validateMot,
  validateRepair,
  validDate
} = require("../utils/maintenanceComplianceRules");

let schemaReady = false;

async function addColumnIfMissing(table, column, definition) {
  const [rows] = await db.query(`SHOW COLUMNS FROM ${table} LIKE ?`, [column]);
  if (rows.length === 0) await db.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

async function addUniqueIndexIfMissing(table, indexName, columns) {
  const [rows] = await db.query(`SHOW INDEX FROM ${table} WHERE Key_name=?`, [indexName]);
  if (rows.length === 0) {
    await db.query(`ALTER TABLE ${table} ADD UNIQUE INDEX ${indexName} (${columns.join(",")})`);
  }
}

function clean(value) {
  return String(value || "").trim();
}

function rawDate(value) {
  if (!value) return null;
  if (typeof value === "string") return value.slice(0, 10);
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  return null;
}

function fmtDate(value) {
  const date = rawDate(value);
  if (!date) return "-";
  return new Date(`${date}T00:00:00`).toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", timeZone: "Europe/London"
  });
}

function ukDateKey() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function addDays(dateKey, days) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

function nextInspectionWeek(inspectionDate, frequencyWeeks) {
  const date = new Date(`${inspectionDate}T12:00:00Z`);
  const mondayOffset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - mondayOffset + (Math.max(2, Number(frequencyWeeks || 6)) - 1) * 7);
  return date.toISOString().slice(0, 10);
}

function documentHash(dataUrl) {
  return crypto.createHash("sha256").update(String(dataUrl || "")).digest("hex");
}

function assetMeta(assetType) {
  return assetType === "trailer"
    ? { table: "trailers", idField: "trailer_id", labelField: "registration_number", defaultFrequency: 10 }
    : { table: "vehicles", idField: "vehicle_id", labelField: "registration_number", defaultFrequency: 6 };
}

async function readAsset(connection, assetType, assetId) {
  const meta = assetMeta(assetType);
  const [[asset]] = await connection.query(
    `SELECT id, registration_number, ${assetType === "trailer" ? "trailer_code AS fleet_code" : "fleet_code"},
            ${assetType === "trailer" ? "trailer_type AS make_model" : "CONCAT_WS(' ', make, model_name) AS make_model"},
            company_name, inspection_frequency_weeks, status, vor_marked_at, vor_reason
     FROM ${meta.table} WHERE id=?`,
    [assetId]
  );
  return asset || null;
}

async function ensureComplianceSchema() {
  if (schemaReady) return;
  await addColumnIfMissing("vehicles", "inspection_frequency_source", "VARCHAR(120) DEFAULT NULL");
  await addColumnIfMissing("vehicles", "inspection_frequency_reference", "VARCHAR(120) DEFAULT NULL");
  await addColumnIfMissing("trailers", "inspection_frequency_source", "VARCHAR(120) DEFAULT NULL");
  await addColumnIfMissing("trailers", "inspection_frequency_reference", "VARCHAR(120) DEFAULT NULL");

  await db.query(`
    CREATE TABLE IF NOT EXISTS compliance_inspections (
      id INT AUTO_INCREMENT PRIMARY KEY,
      asset_type ENUM('vehicle','trailer') NOT NULL,
      asset_id INT NOT NULL,
      registration_snapshot VARCHAR(40) NOT NULL,
      make_model_snapshot VARCHAR(180) DEFAULT NULL,
      operator_name VARCHAR(180) NOT NULL,
      inspection_kind ENUM('safety','first_use','return_to_service') NOT NULL DEFAULT 'safety',
      inspection_date DATE NOT NULL,
      scheduled_date DATE DEFAULT NULL,
      odometer_km INT DEFAULT NULL,
      frequency_weeks INT NOT NULL,
      next_due DATE NOT NULL,
      provider_name VARCHAR(180) NOT NULL,
      inspector_name VARCHAR(160) NOT NULL,
      inspector_signature VARCHAR(180) NOT NULL,
      brake_method ENUM('laden_roller','decelerometer_temperature','ebpms') NOT NULL,
      brake_result ENUM('pass','fail') NOT NULL,
      brake_reference VARCHAR(160) NOT NULL,
      overall_result ENUM('pass','advisory','fail') NOT NULL,
      roadworthy_declared TINYINT(1) NOT NULL DEFAULT 0,
      notes TEXT DEFAULT NULL,
      qa_status ENUM('submitted','approved','rejected') NOT NULL DEFAULT 'submitted',
      qa_by VARCHAR(160) DEFAULT NULL,
      qa_signature VARCHAR(180) DEFAULT NULL,
      qa_notes TEXT DEFAULT NULL,
      qa_at DATETIME DEFAULT NULL,
      locked_at DATETIME DEFAULT NULL,
      created_by VARCHAR(160) DEFAULT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_compliance_asset (asset_type, asset_id, inspection_date),
      INDEX idx_compliance_qa (qa_status, inspection_date)
    ) ENGINE=InnoDB
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS compliance_inspection_items (
      id INT AUTO_INCREMENT PRIMARY KEY,
      inspection_id INT NOT NULL,
      item_key VARCHAR(80) NOT NULL,
      item_label VARCHAR(180) NOT NULL,
      item_status ENUM('pass','advisory','fail','not_applicable') NOT NULL,
      notes TEXT DEFAULT NULL,
      severity ENUM('low','medium','high','critical') NOT NULL DEFAULT 'medium',
      defect_id INT DEFAULT NULL,
      repair_description TEXT DEFAULT NULL,
      repaired_by VARCHAR(160) DEFAULT NULL,
      repaired_at DATE DEFAULT NULL,
      verifier_name VARCHAR(160) DEFAULT NULL,
      verifier_signature VARCHAR(180) DEFAULT NULL,
      verified_at DATETIME DEFAULT NULL,
      repair_document LONGTEXT DEFAULT NULL,
      repair_document_sha256 CHAR(64) DEFAULT NULL,
      UNIQUE KEY uniq_inspection_item (inspection_id, item_key),
      CONSTRAINT fk_compliance_item_inspection FOREIGN KEY (inspection_id) REFERENCES compliance_inspections(id)
    ) ENGINE=InnoDB
  `);
  await addUniqueIndexIfMissing(
    "compliance_inspections",
    "uniq_compliance_inspection_event",
    ["asset_type", "asset_id", "inspection_kind", "inspection_date"]
  );

  await db.query(`
    CREATE TABLE IF NOT EXISTS compliance_documents (
      id INT AUTO_INCREMENT PRIMARY KEY,
      inspection_id INT DEFAULT NULL,
      mot_test_id INT DEFAULT NULL,
      document_type ENUM('inspection_sheet','brake_report','wheel_retorque','mot_certificate','repair_evidence','recall_evidence','daily_check','other') NOT NULL,
      file_data LONGTEXT NOT NULL,
      file_sha256 CHAR(64) NOT NULL,
      uploaded_by VARCHAR(160) DEFAULT NULL,
      uploaded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_compliance_docs_inspection (inspection_id),
      INDEX idx_compliance_docs_mot (mot_test_id)
    ) ENGINE=InnoDB
  `);
  await addColumnIfMissing("compliance_documents", "uploaded_at_utc", "DATETIME DEFAULT NULL");
  await addColumnIfMissing("compliance_inspection_items", "repair_document_uploaded_at_utc", "DATETIME DEFAULT NULL");

  await db.query(`
    CREATE TABLE IF NOT EXISTS compliance_mot_tests (
      id INT AUTO_INCREMENT PRIMARY KEY,
      asset_type ENUM('vehicle','trailer') NOT NULL,
      asset_id INT NOT NULL,
      registration_snapshot VARCHAR(40) NOT NULL,
      test_date DATE NOT NULL,
      result ENUM('pass','fail') NOT NULL,
      certificate_number VARCHAR(120) DEFAULT NULL,
      expiry_date DATE DEFAULT NULL,
      failure_reason TEXT DEFAULT NULL,
      tester_name VARCHAR(160) NOT NULL,
      provider_name VARCHAR(180) NOT NULL,
      odometer_km INT DEFAULT NULL,
      retest_of INT DEFAULT NULL,
      created_by VARCHAR(160) DEFAULT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_mot_asset (asset_type, asset_id, test_date)
    ) ENGINE=InnoDB
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS compliance_frequency_history (
      id INT AUTO_INCREMENT PRIMARY KEY,
      asset_type ENUM('vehicle','trailer') NOT NULL,
      asset_id INT NOT NULL,
      previous_weeks INT DEFAULT NULL,
      new_weeks INT NOT NULL,
      source_name VARCHAR(120) NOT NULL,
      licence_reference VARCHAR(120) NOT NULL,
      change_reason TEXT NOT NULL,
      effective_from DATE NOT NULL,
      changed_by VARCHAR(160) DEFAULT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_frequency_asset (asset_type, asset_id, effective_from)
    ) ENGINE=InnoDB
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS compliance_providers (
      id INT AUTO_INCREMENT PRIMARY KEY,
      provider_name VARCHAR(180) NOT NULL,
      contract_reference VARCHAR(120) NOT NULL,
      contract_start DATE NOT NULL,
      contract_end DATE DEFAULT NULL,
      vol_declared TINYINT(1) NOT NULL DEFAULT 0,
      last_quality_audit DATE NOT NULL,
      next_quality_audit DATE NOT NULL,
      contact_details VARCHAR(255) DEFAULT NULL,
      active TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_provider_contract (provider_name, contract_reference)
    ) ENGINE=InnoDB
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS compliance_recalls (
      id INT AUTO_INCREMENT PRIMARY KEY,
      asset_type ENUM('vehicle','trailer') NOT NULL,
      asset_id INT NOT NULL,
      recall_reference VARCHAR(120) NOT NULL,
      description TEXT NOT NULL,
      issued_date DATE NOT NULL,
      due_date DATE NOT NULL,
      status ENUM('open','actioned','verified') NOT NULL DEFAULT 'open',
      action_details TEXT DEFAULT NULL,
      actioned_at DATE DEFAULT NULL,
      verified_by VARCHAR(160) DEFAULT NULL,
      verifier_signature VARCHAR(180) DEFAULT NULL,
      evidence_data LONGTEXT DEFAULT NULL,
      evidence_sha256 CHAR(64) DEFAULT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_recall_asset (asset_type, asset_id, recall_reference)
    ) ENGINE=InnoDB
  `);
  await addColumnIfMissing("compliance_recalls", "evidence_uploaded_at_utc", "DATETIME DEFAULT NULL");

  await db.query(`
    CREATE TABLE IF NOT EXISTS compliance_daily_checks (
      id INT AUTO_INCREMENT PRIMARY KEY,
      asset_type ENUM('vehicle','trailer') NOT NULL,
      asset_id INT NOT NULL,
      check_date DATE NOT NULL,
      driver_name VARCHAR(160) NOT NULL,
      result ENUM('nil_defect','defect') NOT NULL,
      defect_details TEXT DEFAULT NULL,
      declaration TINYINT(1) NOT NULL DEFAULT 0,
      signature VARCHAR(180) NOT NULL,
      defect_id INT DEFAULT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_daily_asset (asset_type, asset_id, check_date)
    ) ENGINE=InnoDB
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS compliance_missed_inspections (
      id INT AUTO_INCREMENT PRIMARY KEY,
      asset_type ENUM('vehicle','trailer') NOT NULL,
      asset_id INT NOT NULL,
      due_date DATE NOT NULL,
      reason TEXT NOT NULL,
      corrective_action TEXT NOT NULL,
      recorded_by VARCHAR(160) DEFAULT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_missed_asset (asset_type, asset_id, due_date)
    ) ENGINE=InnoDB
  `);
  schemaReady = true;
}

exports.ensureComplianceSchema = async (_req, res, next) => {
  try {
    await ensureComplianceSchema();
    next();
  } catch (error) {
    res.status(500).json({ message: "Compliance schema setup failed.", error: error.message });
  }
};

async function portalData() {
  const [vehicles, trailers, inspections, items, motTests, providers, recalls, dailyChecks, missed] = await Promise.all([
    db.query(`SELECT id, registration_number, fleet_code, CONCAT_WS(' ',make,model_name) AS make_model,
                     company_name, inspection_frequency_weeks, inspection_frequency_source,
                     inspection_frequency_reference, status, vor_marked_at, vor_reason
              FROM vehicles ORDER BY registration_number`),
    db.query(`SELECT id, registration_number, trailer_code AS fleet_code, trailer_type AS make_model,
                     company_name, inspection_frequency_weeks, inspection_frequency_source,
                     inspection_frequency_reference, status, vor_marked_at, vor_reason
              FROM trailers ORDER BY registration_number`),
    db.query(`SELECT * FROM compliance_inspections
              WHERE inspection_date >= DATE_SUB(CURDATE(), INTERVAL 15 MONTH)
              ORDER BY inspection_date DESC, id DESC LIMIT 500`),
    db.query(`SELECT * FROM compliance_inspection_items ORDER BY inspection_id, id`),
    db.query(`SELECT mt.*, EXISTS(SELECT 1 FROM compliance_documents d WHERE d.mot_test_id=mt.id) AS has_document
              FROM compliance_mot_tests mt WHERE mt.test_date >= DATE_SUB(CURDATE(), INTERVAL 24 MONTH)
              ORDER BY mt.test_date DESC, mt.id DESC LIMIT 500`),
    db.query(`SELECT * FROM compliance_providers ORDER BY active DESC, provider_name`),
    db.query(`SELECT * FROM compliance_recalls ORDER BY FIELD(status,'open','actioned','verified'), due_date`),
    db.query(`SELECT * FROM compliance_daily_checks WHERE check_date >= DATE_SUB(CURDATE(), INTERVAL 15 MONTH)
              ORDER BY check_date DESC, id DESC LIMIT 300`),
    db.query(`SELECT * FROM compliance_missed_inspections ORDER BY due_date DESC, id DESC LIMIT 200`)
  ]);
  const itemMap = new Map();
  items[0].forEach((item) => {
    if (!itemMap.has(item.inspection_id)) itemMap.set(item.inspection_id, []);
    itemMap.get(item.inspection_id).push({
      id: item.id,
      key: item.item_key,
      label: item.item_label,
      status: item.item_status,
      notes: item.notes || "",
      severity: item.severity,
      defectId: item.defect_id,
      repairDescription: item.repair_description || "",
      repairedBy: item.repaired_by || "",
      repairedAt: rawDate(item.repaired_at),
      verifierName: item.verifier_name || "",
      verifiedAt: item.verified_at,
      repairedAndVerified: Boolean(item.verified_at && item.repair_document_sha256)
    });
  });
  const mapAsset = (asset, assetType) => ({
    id: asset.id,
    assetType,
    assetId: `${assetType}:${asset.id}`,
    registrationNumber: asset.registration_number,
    fleetCode: asset.fleet_code || "-",
    makeModel: asset.make_model || "-",
    operatorName: asset.company_name || "",
    inspectionFrequencyWeeks: Number(asset.inspection_frequency_weeks || (assetType === "trailer" ? 10 : 6)),
    frequencySource: asset.inspection_frequency_source || "",
    frequencyReference: asset.inspection_frequency_reference || "",
    status: asset.status,
    vorMarkedAt: rawDate(asset.vor_marked_at),
    vorReason: asset.vor_reason || ""
  });
  const assets = [
    ...vehicles[0].map((asset) => mapAsset(asset, "vehicle")),
    ...trailers[0].map((asset) => mapAsset(asset, "trailer"))
  ];
  const records = inspections[0].map((record) => ({
    id: record.id,
    assetType: record.asset_type,
    assetId: record.asset_id,
    registrationNumber: record.registration_snapshot,
    inspectionKind: record.inspection_kind,
    inspectionDate: rawDate(record.inspection_date),
    inspectionDateLabel: fmtDate(record.inspection_date),
    nextDue: rawDate(record.next_due),
    nextDueLabel: fmtDate(record.next_due),
    inspectorName: record.inspector_name,
    providerName: record.provider_name,
    overallResult: record.overall_result,
    brakeResult: record.brake_result,
    qaStatus: record.qa_status,
    qaBy: record.qa_by || "",
    qaAt: record.qa_at,
    locked: Boolean(record.locked_at),
    items: itemMap.get(record.id) || []
  }));
  const openSafetyDefects = records.reduce((count, record) => count + record.items.filter((item) =>
    ["advisory", "fail"].includes(item.status) && !item.repairedAndVerified
  ).length, 0);
  const missingFrequencyEvidence = assets.filter((asset) => !asset.frequencySource || !asset.frequencyReference).length;
  return {
    checklist: {
      vehicle: checklistFor("vehicle"),
      trailer: checklistFor("trailer")
    },
    assets,
    inspections: records,
    motTests: motTests[0].map((test) => ({
      id: test.id,
      assetType: test.asset_type,
      assetId: test.asset_id,
      registrationNumber: test.registration_snapshot,
      testDate: rawDate(test.test_date),
      result: test.result,
      certificateNumber: test.certificate_number || "",
      expiryDate: rawDate(test.expiry_date),
      failureReason: test.failure_reason || "",
      providerName: test.provider_name,
      retestOf: test.retest_of,
      hasDocument: Boolean(test.has_document)
    })),
    providers: providers[0].map((provider) => ({
      id: provider.id,
      providerName: provider.provider_name,
      contractReference: provider.contract_reference,
      contractStart: rawDate(provider.contract_start),
      contractEnd: rawDate(provider.contract_end),
      volDeclared: Boolean(provider.vol_declared),
      lastQualityAudit: rawDate(provider.last_quality_audit),
      nextQualityAudit: rawDate(provider.next_quality_audit),
      contactDetails: provider.contact_details || "",
      active: Boolean(provider.active)
    })),
    recalls: recalls[0].map((recall) => ({
      id: recall.id,
      assetType: recall.asset_type,
      assetId: recall.asset_id,
      recallReference: recall.recall_reference,
      description: recall.description,
      issuedDate: rawDate(recall.issued_date),
      dueDate: rawDate(recall.due_date),
      status: recall.status,
      actionDetails: recall.action_details || "",
      verifiedBy: recall.verified_by || ""
    })),
    dailyChecks: dailyChecks[0].map((check) => ({
      id: check.id,
      assetType: check.asset_type,
      assetId: check.asset_id,
      checkDate: rawDate(check.check_date),
      driverName: check.driver_name,
      result: check.result,
      defectDetails: check.defect_details || ""
    })),
    missedInspections: missed[0].map((entry) => ({
      id: entry.id,
      assetType: entry.asset_type,
      assetId: entry.asset_id,
      dueDate: rawDate(entry.due_date),
      reason: entry.reason,
      correctiveAction: entry.corrective_action,
      recordedBy: entry.recorded_by || ""
    })),
    summary: {
      submittedAwaitingQa: records.filter((record) => record.qaStatus === "submitted").length,
      openSafetyDefects,
      missingFrequencyEvidence,
      openRecalls: recalls[0].filter((recall) => recall.status !== "verified").length,
      motFailures: motTests[0].filter((test) => test.result === "fail").length
    }
  };
}

exports.getCompliancePortal = async (_req, res) => {
  try {
    res.json(await portalData());
  } catch (error) {
    res.status(500).json({ message: "Could not load DVSA compliance records.", error: error.message });
  }
};

exports.getComplianceDocument = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const source = String(req.params.source || "");
    if (!id) return res.status(400).json({ message: "Valid document id required." });
    const queries = {
      compliance_document: "SELECT file_data AS attachment_data FROM compliance_documents WHERE id=?",
      repair_evidence: "SELECT repair_document AS attachment_data FROM compliance_inspection_items WHERE id=?",
      recall_evidence: "SELECT evidence_data AS attachment_data FROM compliance_recalls WHERE id=?"
    };
    if (!queries[source]) return res.status(400).json({ message: "Valid document source required." });
    const [[document]] = await db.query(queries[source], [id]);
    if (!document?.attachment_data) return res.status(404).json({ message: "Document not found." });
    return res.json({ attachmentData: document.attachment_data });
  } catch (error) {
    return res.status(500).json({ message: "Could not load compliance document.", error: error.message });
  }
};

exports.createInspection = async (req, res) => {
  const validation = validateInspection(req.body);
  if (!validation.ok) return res.status(400).json({ message: "Complete all required inspection evidence.", errors: validation.errors });
  const value = validation.value;
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const asset = await readAsset(connection, value.assetType, value.assetId);
    if (!asset) {
      await connection.rollback();
      return res.status(404).json({ message: "Vehicle or trailer was not found." });
    }
    const frequencyWeeks = Math.max(2, Number(asset.inspection_frequency_weeks || assetMeta(value.assetType).defaultFrequency));
    const nextDue = nextInspectionWeek(value.inspectionDate, frequencyWeeks);
    const [inserted] = await connection.query(
      `INSERT INTO compliance_inspections
        (asset_type,asset_id,registration_snapshot,make_model_snapshot,operator_name,inspection_kind,
         inspection_date,scheduled_date,odometer_km,frequency_weeks,next_due,provider_name,inspector_name,
         inspector_signature,brake_method,brake_result,brake_reference,overall_result,roadworthy_declared,
         notes,created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [value.assetType, value.assetId, asset.registration_number, asset.make_model, value.operatorName,
        value.inspectionKind, value.inspectionDate, value.scheduledDate, value.odometerKm, frequencyWeeks,
        nextDue, value.providerName, value.inspectorName, value.inspectorSignature, value.brakeMethod,
        value.brakeResult, value.brakeReference, value.overallResult, value.declaration ? 1 : 0,
        value.notes || null, req.sessionUser?.name || "System"]
    );
    const inspectionId = inserted.insertId;
    for (const item of value.items) {
      let defectId = null;
      if (["advisory", "fail"].includes(item.status)) {
        const severity = item.status === "fail" && ["low", "medium"].includes(item.severity) ? "high" : item.severity;
        const [defect] = await connection.query(
          `INSERT INTO defect_reports
            (vehicle_id,trailer_id,asset_type,defect_type,description,severity,reported_by,status,workflow_status,reported_at)
           VALUES (?,?,?,?,?,?,?,'open','reported',NOW())`,
          [value.assetType === "vehicle" ? value.assetId : null,
            value.assetType === "trailer" ? value.assetId : null,
            value.assetType, item.label, item.notes, severity, value.inspectorName]
        );
        defectId = defect.insertId;
      }
      await connection.query(
        `INSERT INTO compliance_inspection_items
          (inspection_id,item_key,item_label,item_status,notes,severity,defect_id)
         VALUES (?,?,?,?,?,?,?)`,
        [inspectionId, item.key, item.label, item.status, item.notes || null, item.severity, defectId]
      );
    }
    const documents = [
      ["inspection_sheet", value.inspectionDocument],
      ["brake_report", value.brakeDocument],
      ["wheel_retorque", value.wheelRetorqueDocument]
    ].filter(([, data]) => isDataUrl(data));
    for (const [type, data] of documents) {
      await connection.query(
        `INSERT INTO compliance_documents
          (inspection_id,document_type,file_data,file_sha256,uploaded_by,uploaded_at_utc)
         VALUES (?,?,?,?,?,UTC_TIMESTAMP())`,
        [inspectionId, type, data, documentHash(data), req.sessionUser?.name || "System"]
      );
    }
    const legacyTable = value.assetType === "trailer" ? "trailer_inspections" : "vehicle_inspections";
    const legacyId = value.assetType === "trailer" ? "trailer_id" : "vehicle_id";
    await connection.query(
      `INSERT INTO ${legacyTable} (${legacyId},inspection_date,inspection_type,inspector_name,result,notes,next_due)
       VALUES (?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE inspector_name=VALUES(inspector_name),result=VALUES(result),notes=VALUES(notes),next_due=VALUES(next_due)`,
      [value.assetId, value.inspectionDate, "Safety inspection", value.inspectorName, value.overallResult,
        `Compliance inspection #${inspectionId}. ${value.notes || ""}`.trim(), nextDue]
    );
    const meta = assetMeta(value.assetType);
    if (value.overallResult === "fail" || value.brakeResult === "fail") {
      await connection.query(`UPDATE ${meta.table} SET status='maintenance' WHERE id=?`, [value.assetId]);
    }
    await connection.commit();
    await logActivity(req, {
      module: "maintenance", action: "compliance_inspection_submit", entityType: "compliance_inspection",
      entityId: inspectionId, entityLabel: `${asset.registration_number} · ${value.inspectionDate}`,
      details: { result: value.overallResult, brakeResult: value.brakeResult, itemCount: value.items.length }
    });
    res.status(201).json({ message: "Inspection submitted for compliance review.", id: inspectionId, nextDue });
  } catch (error) {
    try { await connection.rollback(); } catch (_rollbackError) { /* no-op */ }
    const duplicate = error.code === "ER_DUP_ENTRY";
    res.status(duplicate ? 409 : 500).json({
      message: duplicate ? "This inspection type is already recorded for the asset on that date." : "Could not save the inspection.",
      error: error.message
    });
  } finally {
    connection.release();
  }
};

exports.repairInspectionItem = async (req, res) => {
  const validation = validateRepair(req.body);
  if (!validation.ok) return res.status(400).json({ message: "Complete the repair and independent verification evidence.", errors: validation.errors });
  const itemId = Number(req.params.itemId);
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [[item]] = await connection.query(
      `SELECT item.*, inspection.locked_at, inspection.registration_snapshot
       FROM compliance_inspection_items item JOIN compliance_inspections inspection ON inspection.id=item.inspection_id
       WHERE item.id=? FOR UPDATE`,
      [itemId]
    );
    if (!item) {
      await connection.rollback();
      return res.status(404).json({ message: "Inspection item was not found." });
    }
    if (item.locked_at) {
      await connection.rollback();
      return res.status(409).json({ message: "Approved inspection records are locked and cannot be changed." });
    }
    if (!['advisory', 'fail'].includes(item.item_status)) {
      await connection.rollback();
      return res.status(409).json({ message: "Only defect or advisory items require repair verification." });
    }
    const value = validation.value;
    await connection.query(
      `UPDATE compliance_inspection_items SET repair_description=?,repaired_by=?,repaired_at=?,
       verifier_name=?,verifier_signature=?,verified_at=NOW(),repair_document=?,repair_document_sha256=?,
       repair_document_uploaded_at_utc=UTC_TIMESTAMP() WHERE id=?`,
      [value.repairDescription, value.repairedBy, value.repairedAt, value.verifierName,
        value.verifierSignature, value.repairDocument, documentHash(value.repairDocument), itemId]
    );
    if (item.defect_id) {
      await connection.query(
        `UPDATE defect_reports SET status='resolved',workflow_status='verified',resolved_at=NOW() WHERE id=?`,
        [item.defect_id]
      );
    }
    await connection.commit();
    await logActivity(req, {
      module: "maintenance", action: "inspection_repair_verified", entityType: "compliance_inspection_item",
      entityId: itemId, entityLabel: `${item.registration_snapshot} · ${item.item_label}`,
      details: { repairedBy: value.repairedBy, verifierName: value.verifierName }
    });
    res.json({ message: "Repair evidence and independent verification saved." });
  } catch (error) {
    try { await connection.rollback(); } catch (_rollbackError) { /* no-op */ }
    res.status(500).json({ message: "Could not save repair verification.", error: error.message });
  } finally {
    connection.release();
  }
};

exports.reviewInspection = async (req, res) => {
  const inspectionId = Number(req.params.id);
  const action = clean(req.body.action).toLowerCase();
  const qaBy = clean(req.body.qa_by || req.body.qaBy || req.sessionUser?.name);
  const qaSignature = clean(req.body.qa_signature || req.body.qaSignature);
  const qaNotes = clean(req.body.qa_notes || req.body.qaNotes);
  if (!["approve", "reject"].includes(action)) return res.status(400).json({ message: "Review action must be approve or reject." });
  if (!qaBy || qaSignature.length < 2) return res.status(400).json({ message: "Reviewer name and signature are required." });
  if (action === "reject" && qaNotes.length < 3) return res.status(400).json({ message: "Explain why the inspection was rejected." });
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [[inspection]] = await connection.query(`SELECT * FROM compliance_inspections WHERE id=? FOR UPDATE`, [inspectionId]);
    if (!inspection) {
      await connection.rollback();
      return res.status(404).json({ message: "Inspection was not found." });
    }
    if (inspection.locked_at) {
      await connection.rollback();
      return res.status(409).json({ message: "This inspection is already approved and locked." });
    }
    if (action === "approve" && qaBy.toLowerCase() === String(inspection.inspector_name || "").toLowerCase()) {
      await connection.rollback();
      return res.status(409).json({ message: "The inspector cannot independently approve their own inspection." });
    }
    if (action === "approve") {
      const [[unverified]] = await connection.query(
        `SELECT COUNT(*) AS total FROM compliance_inspection_items
         WHERE inspection_id=? AND item_status IN ('advisory','fail')
           AND (verified_at IS NULL OR repair_document_sha256 IS NULL)`,
        [inspectionId]
      );
      if (Number(unverified.total || 0) > 0) {
        await connection.rollback();
        return res.status(409).json({ message: "All defects and advisories must be repaired and independently verified before approval." });
      }
      if (inspection.brake_result !== "pass") {
        await connection.rollback();
        return res.status(409).json({ message: "A failed brake assessment cannot be approved. Record a successful reassessment first." });
      }
      await connection.query(
        `UPDATE compliance_inspections SET qa_status='approved',qa_by=?,qa_signature=?,qa_notes=?,qa_at=NOW(),locked_at=NOW() WHERE id=?`,
        [qaBy, qaSignature, qaNotes || null, inspectionId]
      );
      const idField = inspection.asset_type === "trailer" ? "trailer_id" : "vehicle_id";
      const assetColumn = inspection.asset_type === "trailer" ? "trailer_id" : "vehicle_id";
      const asset = await readAsset(connection, inspection.asset_type, inspection.asset_id);
      const [[existingCompleted]] = await connection.query(
        `SELECT id FROM maintenance_jobs WHERE ${assetColumn}=? AND service_type='Safety inspection'
         AND status='completed' AND service_date=? ORDER BY id DESC LIMIT 1 FOR UPDATE`,
        [inspection.asset_id, rawDate(inspection.inspection_date)]
      );
      let completedJobId = existingCompleted?.id;
      if (completedJobId) {
        await connection.query(
          `UPDATE maintenance_jobs SET garage_name=?,assigned_mechanic=?,completion_notes=?,completed_at=COALESCE(completed_at,NOW()) WHERE id=?`,
          [inspection.provider_name, inspection.inspector_name, `Approved compliance inspection #${inspectionId}`, completedJobId]
        );
      } else {
        const [completedJob] = await connection.query(
          `INSERT INTO maintenance_jobs
            (job_number,asset_type,${assetColumn},service_type,due_date,service_date,status,garage_name,
             assigned_mechanic,completion_notes,completed_at)
           VALUES (?,?,?,'Safety inspection',?,?, 'completed',?,?,?,NOW())`,
          [`CMP-${inspectionId}-${String(Date.now()).slice(-6)}`, inspection.asset_type, inspection.asset_id,
            inspection.inspection_date, inspection.inspection_date, inspection.provider_name,
            inspection.inspector_name, `Approved compliance inspection #${inspectionId}`]
        );
        completedJobId = completedJob.insertId;
      }
      const [[existingOpen]] = await connection.query(
        `SELECT id FROM maintenance_jobs WHERE ${assetColumn}=? AND service_type='Safety inspection'
         AND status IN ('planned','booked','in_progress') ORDER BY due_date ASC,id DESC LIMIT 1 FOR UPDATE`,
        [inspection.asset_id]
      );
      if (existingOpen) {
        await connection.query(
          `UPDATE maintenance_jobs SET due_date=?,priority=?,recurrence_source_job_id=?,notes=? WHERE id=?`,
          [rawDate(inspection.next_due), rawDate(inspection.next_due) < ukDateKey() ? "critical" : "normal",
            completedJobId, "Generated from approved DVSA compliance inspection", existingOpen.id]
        );
      } else {
        await connection.query(
          `INSERT INTO maintenance_jobs
            (job_number,asset_type,${assetColumn},service_type,due_date,status,priority,recurrence_source_job_id,notes)
           VALUES (?,?,?,'Safety inspection',?,'planned',?,?,'Generated from approved DVSA compliance inspection')`,
          [`CMP-NEXT-${inspectionId}-${String(Date.now()).slice(-5)}`, inspection.asset_type, inspection.asset_id,
            rawDate(inspection.next_due), rawDate(inspection.next_due) < ukDateKey() ? "critical" : "normal", completedJobId]
        );
      }
      const meta = assetMeta(inspection.asset_type);
      if (inspection.asset_type === "trailer") {
        await connection.query(`UPDATE trailers SET next_inspection_due=? WHERE id=?`, [inspection.next_due, inspection.asset_id]);
      }
      const [[openDefects]] = await connection.query(
        `SELECT COUNT(*) AS total FROM defect_reports WHERE ${idField}=? AND status!='resolved'`,
        [inspection.asset_id]
      );
      if (Number(openDefects.total || 0) === 0 && !asset?.vor_marked_at) {
        await connection.query(`UPDATE ${meta.table} SET status=IF(status='maintenance','available',status) WHERE id=?`, [inspection.asset_id]);
      }
    } else {
      await connection.query(
        `UPDATE compliance_inspections SET qa_status='rejected',qa_by=?,qa_signature=?,qa_notes=?,qa_at=NOW() WHERE id=?`,
        [qaBy, qaSignature, qaNotes, inspectionId]
      );
    }
    await connection.commit();
    await logActivity(req, {
      module: "maintenance", action: `compliance_inspection_${action}d`, entityType: "compliance_inspection",
      entityId: inspectionId, entityLabel: inspection.registration_snapshot, details: { qaBy, qaNotes }
    });
    res.json({ message: action === "approve" ? "Inspection approved and permanently locked." : "Inspection rejected for correction." });
  } catch (error) {
    try { await connection.rollback(); } catch (_rollbackError) { /* no-op */ }
    res.status(500).json({ message: "Could not review the inspection.", error: error.message });
  } finally {
    connection.release();
  }
};

exports.createMotTest = async (req, res) => {
  const validation = validateMot(req.body);
  if (!validation.ok) return res.status(400).json({ message: "Complete the MOT evidence.", errors: validation.errors });
  const value = validation.value;
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const asset = await readAsset(connection, value.assetType, value.assetId);
    if (!asset) {
      await connection.rollback();
      return res.status(404).json({ message: "Vehicle or trailer was not found." });
    }
    if (value.retestOf) {
      const [[failed]] = await connection.query(
        `SELECT id FROM compliance_mot_tests WHERE id=? AND asset_type=? AND asset_id=? AND result='fail'`,
        [value.retestOf, value.assetType, value.assetId]
      );
      if (!failed) {
        await connection.rollback();
        return res.status(409).json({ message: "The selected retest does not match a failed MOT for this asset." });
      }
    }
    const [inserted] = await connection.query(
      `INSERT INTO compliance_mot_tests
        (asset_type,asset_id,registration_snapshot,test_date,result,certificate_number,expiry_date,
         failure_reason,tester_name,provider_name,odometer_km,retest_of,created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [value.assetType, value.assetId, asset.registration_number, value.testDate, value.result,
        value.certificateNumber, value.expiryDate, value.failureReason, value.testerName, value.providerName,
        value.odometerKm, value.retestOf, req.sessionUser?.name || "System"]
    );
    await connection.query(
      `INSERT INTO compliance_documents
        (mot_test_id,document_type,file_data,file_sha256,uploaded_by,uploaded_at_utc)
       VALUES (?,'mot_certificate',?,?,?,UTC_TIMESTAMP())`,
      [inserted.insertId, value.document, documentHash(value.document), req.sessionUser?.name || "System"]
    );
    const meta = assetMeta(value.assetType);
    if (value.result === "pass") {
      await connection.query(`UPDATE ${meta.table} SET mot_expiry=? WHERE id=?`, [value.expiryDate, value.assetId]);
    } else {
      await connection.query(`UPDATE ${meta.table} SET status='maintenance' WHERE id=?`, [value.assetId]);
      await connection.query(
        `INSERT INTO defect_reports (vehicle_id,trailer_id,asset_type,defect_type,description,severity,reported_by,status,workflow_status)
         VALUES (?,?,?,?,?,'high',?,'open','reported')`,
        [value.assetType === "vehicle" ? value.assetId : null, value.assetType === "trailer" ? value.assetId : null,
          value.assetType, "MOT failure", value.failureReason, value.testerName]
      );
    }
    await connection.commit();
    await logActivity(req, {
      module: "maintenance", action: "mot_result_recorded", entityType: "compliance_mot_test",
      entityId: inserted.insertId, entityLabel: asset.registration_number,
      details: { result: value.result, certificateNumber: value.certificateNumber, retestOf: value.retestOf }
    });
    res.status(201).json({ message: `MOT ${value.result} result and evidence saved.`, id: inserted.insertId });
  } catch (error) {
    try { await connection.rollback(); } catch (_rollbackError) { /* no-op */ }
    res.status(500).json({ message: "Could not save the MOT result.", error: error.message });
  } finally {
    connection.release();
  }
};

exports.updateInspectionFrequency = async (req, res) => {
  const { assetType, assetId } = normalizeAsset(req.body);
  const weeks = Number(req.body.weeks);
  const sourceName = clean(req.body.source_name || req.body.sourceName);
  const licenceReference = clean(req.body.licence_reference || req.body.licenceReference);
  const changeReason = clean(req.body.change_reason || req.body.changeReason);
  const effectiveFrom = clean(req.body.effective_from || req.body.effectiveFrom);
  if (!assetId || !Number.isInteger(weeks) || weeks < 2 || weeks > 13 || !sourceName || !licenceReference || changeReason.length < 5 || !validDate(effectiveFrom)) {
    return res.status(400).json({ message: "Asset, 2-13 week frequency, VOL source/reference, effective date and change reason are required." });
  }
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const asset = await readAsset(connection, assetType, assetId);
    if (!asset) {
      await connection.rollback();
      return res.status(404).json({ message: "Vehicle or trailer was not found." });
    }
    const meta = assetMeta(assetType);
    await connection.query(
      `INSERT INTO compliance_frequency_history
        (asset_type,asset_id,previous_weeks,new_weeks,source_name,licence_reference,change_reason,effective_from,changed_by)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [assetType, assetId, asset.inspection_frequency_weeks, weeks, sourceName, licenceReference,
        changeReason, effectiveFrom, req.sessionUser?.name || "System"]
    );
    await connection.query(
      `UPDATE ${meta.table} SET inspection_frequency_weeks=?,inspection_frequency_source=?,inspection_frequency_reference=? WHERE id=?`,
      [weeks, sourceName, licenceReference, assetId]
    );
    await connection.commit();
    await logActivity(req, {
      module: "maintenance", action: "inspection_frequency_changed", entityType: assetType,
      entityId: assetId, entityLabel: asset.registration_number, reason: changeReason,
      reasonCategory: "compliance_issue", details: { from: asset.inspection_frequency_weeks, to: weeks, licenceReference }
    });
    res.json({ message: "Inspection frequency and VOL evidence updated." });
  } catch (error) {
    try { await connection.rollback(); } catch (_rollbackError) { /* no-op */ }
    res.status(500).json({ message: "Could not update inspection frequency.", error: error.message });
  } finally {
    connection.release();
  }
};

exports.createProvider = async (req, res) => {
  const providerName = clean(req.body.provider_name || req.body.providerName);
  const contractReference = clean(req.body.contract_reference || req.body.contractReference);
  const contractStart = clean(req.body.contract_start || req.body.contractStart);
  const contractEnd = clean(req.body.contract_end || req.body.contractEnd) || null;
  const lastQualityAudit = clean(req.body.last_quality_audit || req.body.lastQualityAudit);
  const nextQualityAudit = clean(req.body.next_quality_audit || req.body.nextQualityAudit);
  const volDeclared = Boolean(req.body.vol_declared ?? req.body.volDeclared);
  if (!providerName || !contractReference || !validDate(contractStart) || (contractEnd && !validDate(contractEnd))
      || !validDate(lastQualityAudit) || !validDate(nextQualityAudit) || !volDeclared) {
    return res.status(400).json({ message: "Provider, contract, audit dates and VOL declaration confirmation are required." });
  }
  if ((contractEnd && contractEnd < contractStart) || nextQualityAudit <= lastQualityAudit) {
    return res.status(400).json({ message: "Contract end cannot precede its start, and next quality audit must be after the last audit." });
  }
  if (lastQualityAudit > ukDateKey()) {
    return res.status(400).json({ message: "Last quality audit cannot be after today in the UK." });
  }
  try {
    const [result] = await db.query(
      `INSERT INTO compliance_providers
        (provider_name,contract_reference,contract_start,contract_end,vol_declared,last_quality_audit,next_quality_audit,contact_details)
       VALUES (?,?,?,?,?,?,?,?)`,
      [providerName, contractReference, contractStart, contractEnd, 1, lastQualityAudit, nextQualityAudit,
        clean(req.body.contact_details || req.body.contactDetails) || null]
    );
    await logActivity(req, {
      module: "maintenance", action: "maintenance_provider_added", entityType: "compliance_provider",
      entityId: result.insertId, entityLabel: providerName, details: { contractReference, volDeclared: true }
    });
    res.status(201).json({ message: "Maintenance provider contract and audit details saved.", id: result.insertId });
  } catch (error) {
    const status = error.code === "ER_DUP_ENTRY" ? 409 : 500;
    res.status(status).json({ message: status === 409 ? "This provider contract already exists." : "Could not save provider details.", error: error.message });
  }
};

exports.createRecall = async (req, res) => {
  const { assetType, assetId } = normalizeAsset(req.body);
  const reference = clean(req.body.recall_reference || req.body.recallReference);
  const description = clean(req.body.description);
  const issuedDate = clean(req.body.issued_date || req.body.issuedDate);
  const dueDate = clean(req.body.due_date || req.body.dueDate);
  if (!assetId || !reference || description.length < 3 || !validDate(issuedDate) || !validDate(dueDate)
      || issuedDate > ukDateKey() || dueDate < issuedDate) {
    return res.status(400).json({ message: "Asset, recall reference, description, issue date and due date are required." });
  }
  try {
    const asset = await readAsset(db, assetType, assetId);
    if (!asset) return res.status(404).json({ message: "Vehicle or trailer was not found." });
    const [result] = await db.query(
      `INSERT INTO compliance_recalls (asset_type,asset_id,recall_reference,description,issued_date,due_date)
       VALUES (?,?,?,?,?,?)`,
      [assetType, assetId, reference, description, issuedDate, dueDate]
    );
    await logActivity(req, {
      module: "maintenance", action: "safety_recall_recorded", entityType: "compliance_recall",
      entityId: result.insertId, entityLabel: `${asset.registration_number} · ${reference}`
    });
    res.status(201).json({ message: "Safety recall added to the compliance register.", id: result.insertId });
  } catch (error) {
    const status = error.code === "ER_DUP_ENTRY" ? 409 : 500;
    res.status(status).json({ message: status === 409 ? "This recall is already recorded for the asset." : "Could not save safety recall.", error: error.message });
  }
};

exports.verifyRecall = async (req, res) => {
  const id = Number(req.params.id);
  const actionDetails = clean(req.body.action_details || req.body.actionDetails);
  const actionedAt = clean(req.body.actioned_at || req.body.actionedAt);
  const verifiedBy = clean(req.body.verified_by || req.body.verifiedBy);
  const signature = clean(req.body.verifier_signature || req.body.verifierSignature);
  const evidence = req.body.evidence;
  if (actionDetails.length < 3 || !validDate(actionedAt) || actionedAt > ukDateKey()
      || !verifiedBy || signature.length < 2 || !isDataUrl(evidence)) {
    return res.status(400).json({ message: "Recall action, date, verifier signature and evidence are required." });
  }
  try {
    const [result] = await db.query(
      `UPDATE compliance_recalls SET status='verified',action_details=?,actioned_at=?,verified_by=?,verifier_signature=?,
       evidence_data=?,evidence_sha256=?,evidence_uploaded_at_utc=UTC_TIMESTAMP()
       WHERE id=? AND status!='verified'`,
      [actionDetails, actionedAt, verifiedBy, signature, evidence, documentHash(evidence), id]
    );
    if (!result.affectedRows) return res.status(409).json({ message: "Recall was not found or is already verified." });
    await logActivity(req, {
      module: "maintenance", action: "safety_recall_verified", entityType: "compliance_recall",
      entityId: id, entityLabel: verifiedBy
    });
    res.json({ message: "Recall action and evidence verified." });
  } catch (error) {
    res.status(500).json({ message: "Could not verify the recall.", error: error.message });
  }
};

exports.createDailyCheck = async (req, res) => {
  const { assetType, assetId } = normalizeAsset(req.body);
  const checkDate = clean(req.body.check_date || req.body.checkDate);
  const driverName = clean(req.body.driver_name || req.body.driverName);
  const result = clean(req.body.result);
  const defectDetails = clean(req.body.defect_details || req.body.defectDetails);
  const declaration = Boolean(req.body.declaration);
  const signature = clean(req.body.signature);
  if (!assetId || !validDate(checkDate) || checkDate > ukDateKey() || !driverName
      || !["nil_defect", "defect"].includes(result) || !declaration || signature.length < 2
      || (result === "defect" && defectDetails.length < 3)) {
    return res.status(400).json({ message: "Asset, date, driver, result, declaration and signature are required; describe any defect." });
  }
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const asset = await readAsset(connection, assetType, assetId);
    if (!asset) {
      await connection.rollback();
      return res.status(404).json({ message: "Vehicle or trailer was not found." });
    }
    let defectId = null;
    if (result === "defect") {
      const [defect] = await connection.query(
        `INSERT INTO defect_reports (vehicle_id,trailer_id,asset_type,defect_type,description,severity,reported_by,status,workflow_status)
         VALUES (?,?,?,?,?,'high',?,'open','reported')`,
        [assetType === "vehicle" ? assetId : null, assetType === "trailer" ? assetId : null,
          assetType, "Daily walkaround defect", defectDetails, driverName]
      );
      defectId = defect.insertId;
      await connection.query(`UPDATE ${assetMeta(assetType).table} SET status='maintenance' WHERE id=?`, [assetId]);
    }
    const [inserted] = await connection.query(
      `INSERT INTO compliance_daily_checks (asset_type,asset_id,check_date,driver_name,result,defect_details,declaration,signature,defect_id)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [assetType, assetId, checkDate, driverName, result, defectDetails || null, 1, signature, defectId]
    );
    await connection.commit();
    await logActivity(req, {
      module: "maintenance", action: "daily_walkaround_recorded", entityType: "compliance_daily_check",
      entityId: inserted.insertId, entityLabel: `${asset.registration_number} · ${checkDate}`, details: { result, defectId }
    });
    res.status(201).json({ message: result === "defect" ? "Daily defect recorded and asset placed in maintenance." : "Nil-defect daily check recorded.", id: inserted.insertId });
  } catch (error) {
    try { await connection.rollback(); } catch (_rollbackError) { /* no-op */ }
    res.status(500).json({ message: "Could not save the daily check.", error: error.message });
  } finally {
    connection.release();
  }
};

exports.recordMissedInspection = async (req, res) => {
  const { assetType, assetId } = normalizeAsset(req.body);
  const dueDate = clean(req.body.due_date || req.body.dueDate);
  const reason = clean(req.body.reason);
  const correctiveAction = clean(req.body.corrective_action || req.body.correctiveAction);
  if (!assetId || !validDate(dueDate) || dueDate > ukDateKey() || reason.length < 5 || correctiveAction.length < 5) {
    return res.status(400).json({ message: "Asset, missed due date, reason and corrective action are required." });
  }
  try {
    const asset = await readAsset(db, assetType, assetId);
    if (!asset) return res.status(404).json({ message: "Vehicle or trailer was not found." });
    const [result] = await db.query(
      `INSERT INTO compliance_missed_inspections (asset_type,asset_id,due_date,reason,corrective_action,recorded_by)
       VALUES (?,?,?,?,?,?)`,
      [assetType, assetId, dueDate, reason, correctiveAction, req.sessionUser?.name || "System"]
    );
    await db.query(`UPDATE ${assetMeta(assetType).table} SET status='maintenance' WHERE id=?`, [assetId]);
    await logActivity(req, {
      module: "maintenance", action: "missed_inspection_recorded", entityType: "compliance_missed_inspection",
      entityId: result.insertId, entityLabel: `${asset.registration_number} · ${dueDate}`,
      reason, reasonCategory: "compliance_issue", details: { correctiveAction }
    });
    res.status(201).json({ message: "Missed inspection recorded and asset placed off road until inspection." });
  } catch (error) {
    res.status(500).json({ message: "Could not record the missed inspection.", error: error.message });
  }
};

async function canReturnAssetToRoad(assetType, assetId) {
  await ensureComplianceSchema();
  const asset = await readAsset(db, assetType, assetId);
  if (!asset) return { ok: false, status: 404, message: "Vehicle or trailer was not found." };
  const vorStart = rawDate(asset.vor_marked_at);
  if (!vorStart) return { ok: true, asset };
  const [[inspection]] = await db.query(
    `SELECT id,inspection_date FROM compliance_inspections
     WHERE asset_type=? AND asset_id=? AND inspection_kind='return_to_service'
       AND qa_status='approved' AND inspection_date>=? ORDER BY inspection_date DESC,id DESC LIMIT 1`,
    [assetType, assetId, vorStart]
  );
  if (!inspection) {
    return { ok: false, status: 409, message: "An approved return-to-service inspection completed after the VOR start date is required." };
  }
  const idField = assetType === "trailer" ? "trailer_id" : "vehicle_id";
  const [[defects]] = await db.query(
    `SELECT COUNT(*) AS total FROM defect_reports WHERE ${idField}=? AND status!='resolved'`,
    [assetId]
  );
  if (Number(defects.total || 0) > 0) {
    return { ok: false, status: 409, message: "All open defects must be repaired and verified before return to road." };
  }
  const [[recalls]] = await db.query(
    `SELECT COUNT(*) AS total FROM compliance_recalls WHERE asset_type=? AND asset_id=? AND status!='verified' AND due_date<=CURDATE()`,
    [assetType, assetId]
  );
  if (Number(recalls.total || 0) > 0) {
    return { ok: false, status: 409, message: "Overdue safety recalls must be verified before return to road." };
  }
  return { ok: true, asset, inspectionId: inspection.id };
}

exports.canReturnAssetToRoad = canReturnAssetToRoad;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  })[character]);
}

exports.getAuditPack = async (req, res) => {
  const assetType = req.params.assetType === "trailer" ? "trailer" : "vehicle";
  const assetId = Number(req.params.assetId);
  try {
    const asset = await readAsset(db, assetType, assetId);
    if (!asset) return res.status(404).json({ message: "Vehicle or trailer was not found." });
    const [inspections, items, docs, mot, defects, vor, recalls, daily, frequency] = await Promise.all([
      db.query(`SELECT * FROM compliance_inspections WHERE asset_type=? AND asset_id=? AND inspection_date>=DATE_SUB(CURDATE(),INTERVAL 15 MONTH) ORDER BY inspection_date DESC`, [assetType, assetId]),
      db.query(`SELECT item.* FROM compliance_inspection_items item JOIN compliance_inspections inspection ON inspection.id=item.inspection_id WHERE inspection.asset_type=? AND inspection.asset_id=? AND inspection.inspection_date>=DATE_SUB(CURDATE(),INTERVAL 15 MONTH) ORDER BY inspection.inspection_date DESC,item.id`, [assetType, assetId]),
      db.query(`SELECT document_type,file_data,file_sha256,uploaded_by,uploaded_at,inspection_id,mot_test_id FROM compliance_documents WHERE inspection_id IN (SELECT id FROM compliance_inspections WHERE asset_type=? AND asset_id=?) OR mot_test_id IN (SELECT id FROM compliance_mot_tests WHERE asset_type=? AND asset_id=?)`, [assetType, assetId, assetType, assetId]),
      db.query(`SELECT * FROM compliance_mot_tests WHERE asset_type=? AND asset_id=? AND test_date>=DATE_SUB(CURDATE(),INTERVAL 24 MONTH) ORDER BY test_date DESC`, [assetType, assetId]),
      db.query(`SELECT * FROM defect_reports WHERE ${assetType === "trailer" ? "trailer_id" : "vehicle_id"}=? AND reported_at>=DATE_SUB(NOW(),INTERVAL 15 MONTH) ORDER BY reported_at DESC`, [assetId]),
      db.query(`SELECT * FROM vor_history WHERE asset_type=? AND asset_id=? AND since_date>=DATE_SUB(CURDATE(),INTERVAL 15 MONTH) ORDER BY since_date DESC`, [assetType, assetId]),
      db.query(`SELECT * FROM compliance_recalls WHERE asset_type=? AND asset_id=? ORDER BY issued_date DESC`, [assetType, assetId]),
      db.query(`SELECT * FROM compliance_daily_checks WHERE asset_type=? AND asset_id=? AND check_date>=DATE_SUB(CURDATE(),INTERVAL 15 MONTH) ORDER BY check_date DESC`, [assetType, assetId]),
      db.query(`SELECT * FROM compliance_frequency_history WHERE asset_type=? AND asset_id=? ORDER BY effective_from DESC`, [assetType, assetId])
    ]);
    const itemRows = items[0].map((item) => `<tr><td>#${item.inspection_id}</td><td>${escapeHtml(item.item_label)}</td><td>${escapeHtml(item.item_status)}</td><td>${escapeHtml(item.notes || "-")}</td><td>${escapeHtml(item.repair_description || "-")}</td><td>${escapeHtml(item.verifier_name || "-")}</td><td>${escapeHtml(item.repair_document_sha256 || "-")}</td></tr>`).join("");
    const inspectionRows = inspections[0].map((inspection) => `<tr><td>#${inspection.id}</td><td>${fmtDate(inspection.inspection_date)}</td><td>${escapeHtml(inspection.inspection_kind)}</td><td>${escapeHtml(inspection.overall_result)}</td><td>${escapeHtml(inspection.brake_method)} / ${escapeHtml(inspection.brake_result)}</td><td>${escapeHtml(inspection.inspector_name)}<br><small>Signature: ${escapeHtml(inspection.inspector_signature)}</small></td><td>${escapeHtml(inspection.qa_status)} ${inspection.qa_by ? `by ${escapeHtml(inspection.qa_by)}<br><small>Signature: ${escapeHtml(inspection.qa_signature || "-")}</small>` : ""}</td></tr>`).join("");
    const documentRows = docs[0].map((document, index) => `<tr><td>${escapeHtml(document.document_type)}</td><td>${escapeHtml(document.inspection_id || "-")}</td><td>${escapeHtml(document.mot_test_id || "-")}</td><td><a href="${escapeHtml(document.file_data)}" download="evidence-${index + 1}">Open / download evidence</a></td><td>${escapeHtml(document.file_sha256)}</td><td>${escapeHtml(document.uploaded_by || "-")}<br><small>${escapeHtml(String(document.uploaded_at || ""))}</small></td></tr>`).join("");
    const simpleRows = (rows, cells) => rows.map((row) => `<tr>${cells.map((cell) => `<td>${escapeHtml(typeof cell === "function" ? cell(row) : row[cell] ?? "-")}</td>`).join("")}</tr>`).join("");
    const html = `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><title>DVSA maintenance audit pack - ${escapeHtml(asset.registration_number)}</title><style>body{font:14px Arial;color:#111;margin:28px}h1,h2{margin:0 0 10px}h2{margin-top:28px}table{width:100%;border-collapse:collapse;margin:10px 0}th,td{border:1px solid #bbb;padding:7px;text-align:left;vertical-align:top}.meta{display:grid;grid-template-columns:repeat(2,1fr);gap:6px}.muted{color:#555}@media print{body{margin:10mm}h2{break-after:avoid}table{break-inside:auto}tr{break-inside:avoid}}</style></head><body>
      <h1>DVSA Maintenance Audit Pack</h1><p class="muted">Generated ${escapeHtml(new Date().toLocaleString("en-GB", { timeZone: "Europe/London" }))} · records cover at least the previous 15 months where available.</p>
      <div class="meta"><b>Registration: ${escapeHtml(asset.registration_number)}</b><span>Fleet code: ${escapeHtml(asset.fleet_code || "-")}</span><span>Make/model: ${escapeHtml(asset.make_model || "-")}</span><span>Operator: ${escapeHtml(asset.company_name || "-")}</span><span>Inspection frequency: ${escapeHtml(asset.inspection_frequency_weeks)} weeks</span><span>Status: ${escapeHtml(asset.status)}</span></div>
      <h2>Safety inspections</h2><table><thead><tr><th>ID</th><th>Date</th><th>Type</th><th>Result</th><th>Brake assessment</th><th>Inspector</th><th>QA</th></tr></thead><tbody>${inspectionRows || '<tr><td colspan="7">No records</td></tr>'}</tbody></table>
      <h2>Inspection items, defects and repairs</h2><table><thead><tr><th>Inspection</th><th>Item</th><th>Result</th><th>Finding</th><th>Repair</th><th>Verified by</th><th>Repair evidence SHA-256</th></tr></thead><tbody>${itemRows || '<tr><td colspan="7">No records</td></tr>'}</tbody></table>
      <h2>MOT history</h2><table><thead><tr><th>Date</th><th>Result</th><th>Certificate</th><th>Expiry</th><th>Failure reason</th><th>Provider</th></tr></thead><tbody>${simpleRows(mot[0], [(r)=>fmtDate(r.test_date),"result","certificate_number",(r)=>fmtDate(r.expiry_date),"failure_reason","provider_name"]) || '<tr><td colspan="6">No records</td></tr>'}</tbody></table>
      <h2>Defect and rectification register</h2><table><thead><tr><th>Reported</th><th>Defect</th><th>Severity</th><th>Status</th><th>Reported by</th><th>Resolved</th></tr></thead><tbody>${simpleRows(defects[0], [(r)=>String(r.reported_at||""),"defect_type","severity","workflow_status","reported_by",(r)=>String(r.resolved_at||"-")]) || '<tr><td colspan="6">No records</td></tr>'}</tbody></table>
      <h2>VOR history</h2><table><thead><tr><th>Since</th><th>Expected return</th><th>Actual return</th><th>Reason</th></tr></thead><tbody>${simpleRows(vor[0], [(r)=>fmtDate(r.since_date),(r)=>fmtDate(r.expected_till_date),(r)=>fmtDate(r.actual_return_date),"reason"]) || '<tr><td colspan="4">No records</td></tr>'}</tbody></table>
      <h2>Safety recalls</h2><table><thead><tr><th>Reference</th><th>Issued</th><th>Due</th><th>Status</th><th>Action</th><th>Verified by</th></tr></thead><tbody>${simpleRows(recalls[0], ["recall_reference",(r)=>fmtDate(r.issued_date),(r)=>fmtDate(r.due_date),"status","action_details","verified_by"]) || '<tr><td colspan="6">No records</td></tr>'}</tbody></table>
      <h2>Daily checks</h2><table><thead><tr><th>Date</th><th>Driver</th><th>Result</th><th>Defect</th></tr></thead><tbody>${simpleRows(daily[0], [(r)=>fmtDate(r.check_date),"driver_name","result","defect_details"]) || '<tr><td colspan="4">No records</td></tr>'}</tbody></table>
      <h2>Frequency change history</h2><table><thead><tr><th>Effective</th><th>Previous</th><th>New</th><th>VOL reference</th><th>Reason</th><th>Changed by</th></tr></thead><tbody>${simpleRows(frequency[0], [(r)=>fmtDate(r.effective_from),"previous_weeks","new_weeks","licence_reference","change_reason","changed_by"]) || '<tr><td colspan="6">No records</td></tr>'}</tbody></table>
      <h2>Evidence manifest</h2><table><thead><tr><th>Type</th><th>Inspection</th><th>MOT</th><th>Evidence</th><th>SHA-256</th><th>Uploaded by</th></tr></thead><tbody>${documentRows || '<tr><td colspan="6">No records</td></tr>'}</tbody></table>
      </body></html>`;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="maintenance-audit-${asset.registration_number}-${ukDateKey()}.html"`);
    res.send(html);
  } catch (error) {
    res.status(500).json({ message: "Could not create the maintenance audit pack.", error: error.message });
  }
};

exports.getComplianceBackup = async (_req, res) => {
  const tables = [
    "compliance_inspections",
    "compliance_inspection_items",
    "compliance_documents",
    "compliance_mot_tests",
    "compliance_frequency_history",
    "compliance_providers",
    "compliance_recalls",
    "compliance_daily_checks",
    "compliance_missed_inspections",
    "maintenance_document_archive",
    "vor_history"
  ];
  try {
    const entries = await Promise.all(tables.map(async (table) => {
      const [rows] = await db.query(`SELECT * FROM ${table}`);
      return [table, rows];
    }));
    const [vehicles, trailers, maintenanceJobs, defects, maintenanceActivity] = await Promise.all([
      db.query(`SELECT * FROM vehicles`),
      db.query(`SELECT * FROM trailers`),
      db.query(`SELECT * FROM maintenance_jobs WHERE created_at>=DATE_SUB(NOW(),INTERVAL 15 MONTH) OR status IN ('planned','booked','in_progress')`),
      db.query(`SELECT * FROM defect_reports WHERE reported_at>=DATE_SUB(NOW(),INTERVAL 15 MONTH) OR status!='resolved'`),
      db.query(`SELECT * FROM activity_logs WHERE module_key='maintenance' AND created_at>=DATE_SUB(NOW(),INTERVAL 15 MONTH) ORDER BY id`)
    ]);
    const data = Object.fromEntries(entries);
    data.vehicles = vehicles[0];
    data.trailers = trailers[0];
    data.maintenance_jobs = maintenanceJobs[0];
    data.defect_reports = defects[0];
    data.maintenance_activity_logs = maintenanceActivity[0];
    const generatedAt = new Date().toISOString();
    const checksum = crypto.createHash("sha256").update(JSON.stringify(data)).digest("hex");
    const backup = {
      format: "astrafleet-dvsa-compliance-backup",
      version: 1,
      generatedAt,
      retentionScope: "All compliance records plus at least 15 months of operational maintenance records",
      sha256: checksum,
      data
    };
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="fleet-compliance-backup-${ukDateKey()}.json"`);
    res.send(JSON.stringify(backup));
  } catch (error) {
    res.status(500).json({ message: "Could not create the fleet compliance backup.", error: error.message });
  }
};

exports.ensureComplianceSchemaInternal = ensureComplianceSchema;
