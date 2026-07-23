const db = require("../db/connection");
const { logActivity } = require("../utils/auditLogger");

const INSPECTION_INTERVAL_DAYS = 42;
const TRAILER_INSPECTION_INTERVAL_DAYS = 70;
const DEFAULT_ROAD_TAX_INTERVAL_MONTHS = 6;
const UK_TIME_ZONE = "Europe/London";
const UK_DATE_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  timeZone: UK_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});
const MAINTENANCE_RULES = {
  "Brake test": { days: INSPECTION_INTERVAL_DAYS },
  "Safety inspection": { days: INSPECTION_INTERVAL_DAYS },
  MOT: { months: 12 },
  "Tacho Calibration": { months: 24 },
  "Road Tax": { months: DEFAULT_ROAD_TAX_INTERVAL_MONTHS },
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

async function addUniqueIndexIfMissing(table, indexName, columns) {
  const [rows] = await db.query(`SHOW INDEX FROM ${table} WHERE Key_name=?`, [indexName]);
  if (rows.length > 0) return;
  await db.query(`CREATE UNIQUE INDEX ${indexName} ON ${table} (${columns.join(", ")})`);
}

async function duplicateGroupCount(table, identityColumns, whereClause = "1=1") {
  const [[row]] = await db.query(
    `SELECT COUNT(*) AS count FROM (
       SELECT 1 FROM ${table}
       WHERE ${whereClause}
       GROUP BY ${identityColumns.join(", ")}
       HAVING COUNT(*) > 1
     ) duplicate_groups`
  );
  return Number(row?.count || 0);
}

async function duplicateExtraRowCount(table, identityColumns, whereClause = "1=1") {
  const [[row]] = await db.query(
    `SELECT COALESCE(SUM(duplicate_count - 1), 0) AS count FROM (
       SELECT COUNT(*) AS duplicate_count FROM ${table}
       WHERE ${whereClause}
       GROUP BY ${identityColumns.join(", ")}
       HAVING COUNT(*) > 1
     ) duplicate_groups`
  );
  return Number(row?.count || 0);
}

async function removeEmptyOpenJobDuplicates() {
  const [groups] = await db.query(`
    SELECT asset_type, vehicle_id, trailer_id, service_type
    FROM maintenance_jobs
    WHERE status IN ('planned','booked','in_progress')
    GROUP BY asset_type, vehicle_id, trailer_id, service_type
    HAVING COUNT(*) > 1
  `);
  let removed = 0;
  const deletions = [];
  for (const group of groups) {
    const idField = group.asset_type === "trailer" ? "trailer_id" : "vehicle_id";
    const assetId = group.asset_type === "trailer" ? group.trailer_id : group.vehicle_id;
    const [rows] = await db.query(
      `SELECT id,
              (defect_id IS NOT NULL OR bill_attachment_data IS NOT NULL OR bill_number IS NOT NULL
               OR COALESCE(notes,'')!='' OR COALESCE(completion_notes,'')!=''
               OR COALESCE(final_cost_gbp,0)!=0) AS has_user_data
       FROM maintenance_jobs
       WHERE ${idField}=? AND service_type=? AND status IN ('planned','booked','in_progress')
       ORDER BY has_user_data DESC, FIELD(status,'in_progress','booked','planned'), id DESC`,
      [assetId, group.service_type]
    );
    if (rows.length < 2) continue;
    const [keeper, ...extras] = rows;
    const emptyExtraIds = extras.filter((row) => !Number(row.has_user_data)).map((row) => row.id);
    if (emptyExtraIds.length > 0) {
      const [result] = await db.query(`DELETE FROM maintenance_jobs WHERE id IN (?)`, [emptyExtraIds]);
      removed += Number(result.affectedRows || 0);
      deletions.push({
        assetType: group.asset_type,
        assetId,
        serviceType: group.service_type,
        keeperId: keeper.id,
        removedIds: emptyExtraIds
      });
    }
  }
  return { removed, deletions };
}

async function mergeExactCompletedJobDuplicates() {
  const [groups] = await db.query(`
    SELECT asset_type, vehicle_id, trailer_id, service_type, service_date, COUNT(*) AS duplicate_count
    FROM maintenance_jobs
    WHERE status='completed' AND service_date IS NOT NULL
    GROUP BY asset_type, vehicle_id, trailer_id, service_type, service_date
    HAVING COUNT(*) > 1
  `);
  let removed = 0;
  const merges = [];
  for (const group of groups) {
    const idField = group.asset_type === "trailer" ? "trailer_id" : "vehicle_id";
    const assetId = group.asset_type === "trailer" ? group.trailer_id : group.vehicle_id;
    const [duplicates] = await db.query(
      `SELECT * FROM maintenance_jobs
       WHERE ${idField}=? AND service_type=? AND service_date=? AND status='completed'
       ORDER BY (job_number NOT LIKE 'MIG-%') DESC,
                (bill_attachment_data IS NOT NULL) DESC,
                (bill_number IS NOT NULL) DESC,
                (completion_notes IS NOT NULL) DESC,
                id DESC`,
      [assetId, group.service_type, rawDate(group.service_date)]
    );
    if (duplicates.length < 2) continue;
    const [keeper, ...extras] = duplicates;
    const removedIds = [];
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      for (const extra of extras) {
        await connection.query(
          `UPDATE maintenance_jobs SET
             garage_name=COALESCE(garage_name, ?), assigned_mechanic=COALESCE(assigned_mechanic, ?),
             final_cost_gbp=COALESCE(final_cost_gbp, ?), completed_mileage_km=COALESCE(completed_mileage_km, ?),
             next_due_mileage_km=COALESCE(next_due_mileage_km, ?), bill_number=COALESCE(bill_number, ?),
             bill_date=COALESCE(bill_date, ?), bill_amount_gbp=COALESCE(bill_amount_gbp, ?),
             bill_notes=COALESCE(bill_notes, ?), bill_attachment_data=COALESCE(bill_attachment_data, ?),
             completion_notes=COALESCE(completion_notes, ?)
           WHERE id=?`,
          [extra.garage_name, extra.assigned_mechanic, extra.final_cost_gbp, extra.completed_mileage_km,
            extra.next_due_mileage_km, extra.bill_number, extra.bill_date, extra.bill_amount_gbp,
            extra.bill_notes, extra.bill_attachment_data, extra.completion_notes, keeper.id]
        );
        await connection.query(`UPDATE maintenance_job_notes SET job_id=? WHERE job_id=?`, [keeper.id, extra.id]);
        await connection.query(`DELETE FROM maintenance_jobs WHERE id=?`, [extra.id]);
        removed += 1;
        removedIds.push(extra.id);
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    if (removedIds.length > 0) {
      merges.push({
        assetType: group.asset_type,
        assetId,
        serviceType: group.service_type,
        serviceDate: rawDate(group.service_date),
        keeperId: keeper.id,
        removedIds
      });
    }
  }
  return { removed, merges };
}

async function verifyAndRepairMaintenanceIntegrity() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS maintenance_integrity_runs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      checked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      completed_job_duplicate_groups_before INT NOT NULL DEFAULT 0,
      completed_jobs_removed INT NOT NULL DEFAULT 0,
      projection_rows_removed INT NOT NULL DEFAULT 0,
      unresolved_open_job_groups INT NOT NULL DEFAULT 0,
      status VARCHAR(30) NOT NULL DEFAULT 'verified',
      details JSON DEFAULT NULL
    ) ENGINE=InnoDB
  `);

  // Canonicalize legacy names before applying exact-identity constraints.
  await db.query(`UPDATE vehicle_inspections SET inspection_type='Safety inspection' WHERE inspection_type='6-week safety inspection'`);
  await db.query(`UPDATE trailer_inspections SET inspection_type='Safety inspection' WHERE inspection_type='10-week safety inspection'`);

  const completedGroupsBefore = await duplicateGroupCount(
    "maintenance_jobs",
    ["asset_type", "vehicle_id", "trailer_id", "service_type", "service_date"],
    "status='completed' AND service_date IS NOT NULL"
  );
  const projectionBefore = await Promise.all([
    duplicateExtraRowCount("vehicle_inspections", ["vehicle_id", "inspection_type", "inspection_date"]),
    duplicateExtraRowCount("trailer_inspections", ["trailer_id", "inspection_type", "inspection_date"]),
    duplicateExtraRowCount("maintenance_records", ["vehicle_id", "service_type", "service_date"]),
    duplicateExtraRowCount("trailer_maintenance_records", ["trailer_id", "service_type", "service_date"])
  ]);

  // Merge useful fields into the oldest projection row, then remove only rows
  // with the exact same asset, type and service/inspection date.
  await db.query(`
    UPDATE vehicle_inspections keeper
    JOIN vehicle_inspections duplicate
      ON duplicate.vehicle_id=keeper.vehicle_id AND duplicate.inspection_type=keeper.inspection_type
     AND duplicate.inspection_date=keeper.inspection_date AND duplicate.id>keeper.id
    SET keeper.inspector_name=COALESCE(keeper.inspector_name,duplicate.inspector_name),
        keeper.notes=COALESCE(keeper.notes,duplicate.notes), keeper.next_due=COALESCE(keeper.next_due,duplicate.next_due)
  `);
  await db.query(`DELETE duplicate FROM vehicle_inspections duplicate JOIN vehicle_inspections keeper ON duplicate.vehicle_id=keeper.vehicle_id AND duplicate.inspection_type=keeper.inspection_type AND duplicate.inspection_date=keeper.inspection_date AND duplicate.id>keeper.id`);
  await db.query(`
    UPDATE trailer_inspections keeper
    JOIN trailer_inspections duplicate
      ON duplicate.trailer_id=keeper.trailer_id AND duplicate.inspection_type=keeper.inspection_type
     AND duplicate.inspection_date=keeper.inspection_date AND duplicate.id>keeper.id
    SET keeper.inspector_name=COALESCE(keeper.inspector_name,duplicate.inspector_name),
        keeper.notes=COALESCE(keeper.notes,duplicate.notes), keeper.next_due=COALESCE(keeper.next_due,duplicate.next_due)
  `);
  await db.query(`DELETE duplicate FROM trailer_inspections duplicate JOIN trailer_inspections keeper ON duplicate.trailer_id=keeper.trailer_id AND duplicate.inspection_type=keeper.inspection_type AND duplicate.inspection_date=keeper.inspection_date AND duplicate.id>keeper.id`);
  await db.query(`
    UPDATE maintenance_records keeper
    JOIN maintenance_records duplicate
      ON duplicate.vehicle_id=keeper.vehicle_id AND duplicate.service_type=keeper.service_type
     AND duplicate.service_date=keeper.service_date AND duplicate.id>keeper.id
    SET keeper.description=COALESCE(keeper.description,duplicate.description),
        keeper.cost_gbp=GREATEST(keeper.cost_gbp,duplicate.cost_gbp), keeper.mileage=COALESCE(keeper.mileage,duplicate.mileage),
        keeper.next_due_date=COALESCE(keeper.next_due_date,duplicate.next_due_date), keeper.garage_name=COALESCE(keeper.garage_name,duplicate.garage_name)
  `);
  await db.query(`DELETE duplicate FROM maintenance_records duplicate JOIN maintenance_records keeper ON duplicate.vehicle_id=keeper.vehicle_id AND duplicate.service_type=keeper.service_type AND duplicate.service_date=keeper.service_date AND duplicate.id>keeper.id`);
  await db.query(`
    UPDATE trailer_maintenance_records keeper
    JOIN trailer_maintenance_records duplicate
      ON duplicate.trailer_id=keeper.trailer_id AND duplicate.service_type=keeper.service_type
     AND duplicate.service_date=keeper.service_date AND duplicate.id>keeper.id
    SET keeper.description=COALESCE(keeper.description,duplicate.description),
        keeper.cost_gbp=GREATEST(keeper.cost_gbp,duplicate.cost_gbp),
        keeper.next_due_date=COALESCE(keeper.next_due_date,duplicate.next_due_date), keeper.garage_name=COALESCE(keeper.garage_name,duplicate.garage_name)
  `);
  await db.query(`DELETE duplicate FROM trailer_maintenance_records duplicate JOIN trailer_maintenance_records keeper ON duplicate.trailer_id=keeper.trailer_id AND duplicate.service_type=keeper.service_type AND duplicate.service_date=keeper.service_date AND duplicate.id>keeper.id`);

  const completedJobCleanup = await mergeExactCompletedJobDuplicates();
  const openJobCleanup = await removeEmptyOpenJobDuplicates();
  const completedJobsRemoved = completedJobCleanup.removed;
  const emptyOpenJobsRemoved = openJobCleanup.removed;
  await addUniqueIndexIfMissing("vehicle_inspections", "uniq_vehicle_inspection_event", ["vehicle_id", "inspection_type", "inspection_date"]);
  await addUniqueIndexIfMissing("trailer_inspections", "uniq_trailer_inspection_event", ["trailer_id", "inspection_type", "inspection_date"]);
  await addUniqueIndexIfMissing("maintenance_records", "uniq_vehicle_maintenance_event", ["vehicle_id", "service_type", "service_date"]);
  await addUniqueIndexIfMissing("trailer_maintenance_records", "uniq_trailer_maintenance_event", ["trailer_id", "service_type", "service_date"]);

  const [[openGroups]] = await db.query(`
    SELECT COUNT(*) AS count FROM (
      SELECT asset_type, vehicle_id, trailer_id, service_type
      FROM maintenance_jobs
      WHERE status IN ('planned','booked','in_progress')
      GROUP BY asset_type, vehicle_id, trailer_id, service_type
      HAVING COUNT(*) > 1
    ) duplicates
  `);
  const [duplicateDocumentGroups] = await db.query(`
    SELECT document_hash, COUNT(*) AS copies, COUNT(DISTINCT identity_key) AS distinct_identities,
           GROUP_CONCAT(job_id ORDER BY job_id SEPARATOR ',') AS job_ids
    FROM (
      SELECT id AS job_id,
             SHA2(bill_attachment_data, 256) AS document_hash,
             CONCAT(
               COALESCE(asset_type, 'vehicle'), ':', COALESCE(vehicle_id, 0), ':', COALESCE(trailer_id, 0), ':',
               service_type, ':', COALESCE(DATE_FORMAT(service_date, '%Y-%m-%d'), '-')
             ) AS identity_key
      FROM maintenance_jobs
      WHERE bill_attachment_data IS NOT NULL AND bill_attachment_data != ''
    ) documents
    GROUP BY document_hash
    HAVING COUNT(*) > 1 AND COUNT(DISTINCT identity_key) > 1
    ORDER BY copies DESC, document_hash
    LIMIT 200
  `);
  const projectionRowsRemoved = projectionBefore.reduce((sum, count) => sum + count, 0);
  const unresolvedOpenJobGroups = Number(openGroups?.count || 0);
  const documentDuplicateGroups = duplicateDocumentGroups.length;
  const integrityNeedsReview = unresolvedOpenJobGroups > 0 || documentDuplicateGroups > 0;
  await db.query(
    `INSERT INTO maintenance_integrity_runs
      (completed_job_duplicate_groups_before, completed_jobs_removed, projection_rows_removed,
       unresolved_open_job_groups, status, details)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [completedGroupsBefore, completedJobsRemoved, projectionRowsRemoved, unresolvedOpenJobGroups,
      integrityNeedsReview ? "review_required" : "verified",
      JSON.stringify({
        checkedAt: new Date().toISOString(),
        mode: "exact-duplicate-safe-merge",
        emptyOpenJobsRemoved,
        completedJobMerges: completedJobCleanup.merges.slice(0, 200),
        emptyOpenJobDeletions: openJobCleanup.deletions.slice(0, 200),
        duplicateDocumentGroups: duplicateDocumentGroups.map((group) => ({
          documentHash: group.document_hash,
          copies: Number(group.copies || 0),
          distinctIdentities: Number(group.distinct_identities || 0),
          jobIds: String(group.job_ids || "").split(",").filter(Boolean).map(Number)
        })),
        auditTruncated: completedJobCleanup.merges.length > 200
          || openJobCleanup.deletions.length > 200
          || duplicateDocumentGroups.length === 200
      })]
  );
  return {
    completedGroupsBefore,
    completedJobsRemoved,
    projectionRowsRemoved,
    emptyOpenJobsRemoved,
    unresolvedOpenJobGroups,
    documentDuplicateGroups
  };
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
  await addColumnIfMissing("vehicles", "vor_reason", "VARCHAR(255) DEFAULT NULL");
  await addColumnIfMissing("vehicles", "vor_marked_at", "DATETIME DEFAULT NULL");
  await addColumnIfMissing("vehicles", "vor_till", "DATE DEFAULT NULL");
  await addColumnIfMissing("vehicles", "tacho_calibration_expiry", "DATE DEFAULT NULL");
  await db.query(`
    UPDATE vehicles v
    JOIN (
      SELECT mr.vehicle_id, mr.next_due_date
      FROM maintenance_records mr
      WHERE mr.service_type = 'Tacho Calibration'
        AND mr.next_due_date IS NOT NULL
        AND mr.id = (
          SELECT mr2.id FROM maintenance_records mr2
          WHERE mr2.vehicle_id = mr.vehicle_id AND mr2.service_type = 'Tacho Calibration'
          ORDER BY mr2.service_date DESC, mr2.id DESC
          LIMIT 1
        )
    ) latest_tacho ON latest_tacho.vehicle_id = v.id
    SET v.tacho_calibration_expiry = latest_tacho.next_due_date
    WHERE v.tacho_calibration_expiry IS NULL
  `);

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
  await addColumnIfMissing("maintenance_jobs", "recurrence_source_job_id", "INT DEFAULT NULL");

  await db.query(`
    CREATE TABLE IF NOT EXISTS maintenance_document_archive (
      id                   INT AUTO_INCREMENT PRIMARY KEY,
      original_job_id      INT DEFAULT NULL,
      job_number           VARCHAR(40) DEFAULT NULL,
      asset_type           VARCHAR(20) NOT NULL,
      vehicle_id           INT DEFAULT NULL,
      trailer_id           INT DEFAULT NULL,
      service_type         VARCHAR(100) NOT NULL,
      service_date         DATE DEFAULT NULL,
      due_date             DATE DEFAULT NULL,
      bill_number          VARCHAR(100) DEFAULT NULL,
      bill_date            DATE DEFAULT NULL,
      bill_amount_gbp      DECIMAL(10,2) DEFAULT NULL,
      bill_notes           TEXT DEFAULT NULL,
      attachment_data      LONGTEXT NOT NULL,
      document_sha256      CHAR(64) NOT NULL,
      archive_reason       VARCHAR(255) NOT NULL,
      archived_by          VARCHAR(120) DEFAULT NULL,
      archived_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_document_archive_job (original_job_id),
      INDEX idx_document_archive_hash (document_sha256),
      INDEX idx_document_archive_asset (asset_type, vehicle_id, trailer_id)
    ) ENGINE=InnoDB
  `);

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
  await addColumnIfMissing("trailers", "vor_reason", "VARCHAR(255) DEFAULT NULL");
  await addColumnIfMissing("trailers", "vor_marked_at", "DATETIME DEFAULT NULL");
  await addColumnIfMissing("trailers", "vor_till", "DATE DEFAULT NULL");

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

  // Keeps a permanent record of every VOR period so the schedule can still show
  // which weeks a vehicle was off road after it's marked back on road.
  await db.query(`
    CREATE TABLE IF NOT EXISTS vor_history (
      id                 INT AUTO_INCREMENT PRIMARY KEY,
      asset_type         ENUM('vehicle','trailer') NOT NULL DEFAULT 'vehicle',
      asset_id           INT NOT NULL,
      reason             VARCHAR(255) DEFAULT NULL,
      since_date         DATE NOT NULL,
      expected_till_date DATE DEFAULT NULL,
      actual_return_date DATE DEFAULT NULL,
      created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB
  `);

  // One-time-compatible rename. These statements are intentionally idempotent,
  // so existing installations migrate saved history/jobs on the first request
  // after deployment while fresh installations remain unchanged.
  await db.query(`UPDATE maintenance_jobs SET service_type='Brake test' WHERE service_type IN ('Roller brake test','Roller Brake Test')`);
  await db.query(`UPDATE maintenance_records SET service_type='Brake test' WHERE service_type IN ('Roller brake test','Roller Brake Test')`);
  await db.query(`UPDATE trailer_maintenance_records SET service_type='Brake test' WHERE service_type IN ('Roller brake test','Roller Brake Test')`);
  await db.query(`UPDATE vehicle_inspections SET inspection_type='Brake test' WHERE inspection_type IN ('Roller brake test','Roller Brake Test')`);
  await db.query(`UPDATE trailer_inspections SET inspection_type='Brake test' WHERE inspection_type IN ('Roller brake test','Roller Brake Test')`);

  // Road Tax is a six-month fleet rule. Correct legacy 12-month rows as well as
  // new saves so the live planner and the vehicle compliance date cannot drift.
  await db.query(`
    UPDATE maintenance_jobs
    SET road_tax_interval_months=?,
        due_date=CASE
          WHEN status != 'completed' AND service_date IS NOT NULL THEN DATE_ADD(service_date, INTERVAL 6 MONTH)
          ELSE due_date
        END
    WHERE service_type='Road Tax'
      AND (COALESCE(road_tax_interval_months, 0) != ?
        OR (status != 'completed' AND service_date IS NOT NULL AND due_date != DATE_ADD(service_date, INTERVAL 6 MONTH)))
  `, [DEFAULT_ROAD_TAX_INTERVAL_MONTHS, DEFAULT_ROAD_TAX_INTERVAL_MONTHS]);
  await db.query(`
    UPDATE maintenance_records
    SET next_due_date=DATE_ADD(service_date, INTERVAL 6 MONTH)
    WHERE service_type IN ('Road Tax','road_tax')
      AND service_date IS NOT NULL
      AND (next_due_date IS NULL OR next_due_date != DATE_ADD(service_date, INTERVAL 6 MONTH))
  `);
  await db.query(`
    UPDATE vehicles v
    JOIN (
      SELECT vehicle_id, MAX(service_date) AS latest_service_date
      FROM maintenance_records
      WHERE service_type IN ('Road Tax','road_tax') AND service_date IS NOT NULL
      GROUP BY vehicle_id
    ) tax ON tax.vehicle_id=v.id
    SET v.road_tax_expiry=DATE_ADD(tax.latest_service_date, INTERVAL 6 MONTH)
    WHERE v.road_tax_expiry IS NULL
       OR v.road_tax_expiry != DATE_ADD(tax.latest_service_date, INTERVAL 6 MONTH)
  `);

  // Inspection frequency is counted by inclusive ISO-week buckets: the week
  // containing the completed inspection is Week 1. For example, a 6-week
  // inspection completed in WK17 is next due in WK22 (five week-start jumps).
  // Recalculate legacy saved dates automatically so no vehicle needs a manual
  // edit after deployment.
  await db.query(`
    UPDATE vehicle_inspections vi
    JOIN vehicles v ON v.id=vi.vehicle_id
    SET vi.next_due=ADDDATE(
      DATE_SUB(vi.inspection_date, INTERVAL WEEKDAY(vi.inspection_date) DAY),
      (GREATEST(COALESCE(v.inspection_frequency_weeks, 6), 2) - 1) * 7
    )
    WHERE vi.inspection_date IS NOT NULL
      AND vi.inspection_type IN ('Safety inspection','Brake test','6-week safety inspection')
  `);
  await db.query(`
    UPDATE maintenance_records mr
    JOIN vehicles v ON v.id=mr.vehicle_id
    SET mr.next_due_date=ADDDATE(
      DATE_SUB(mr.service_date, INTERVAL WEEKDAY(mr.service_date) DAY),
      (GREATEST(COALESCE(v.inspection_frequency_weeks, 6), 2) - 1) * 7
    )
    WHERE mr.service_date IS NOT NULL
      AND mr.service_type IN ('Safety inspection','Brake test','6-week safety inspection')
  `);
  await db.query(`
    UPDATE trailer_inspections
    SET next_due=ADDDATE(
      DATE_SUB(inspection_date, INTERVAL WEEKDAY(inspection_date) DAY),
      (10 - 1) * 7
    )
    WHERE inspection_date IS NOT NULL
      AND inspection_type IN ('Safety inspection','Brake test','10-week safety inspection')
  `);
  await db.query(`
    UPDATE trailer_maintenance_records
    SET next_due_date=ADDDATE(
      DATE_SUB(service_date, INTERVAL WEEKDAY(service_date) DAY),
      (10 - 1) * 7
    )
    WHERE service_date IS NOT NULL
      AND service_type IN ('Safety inspection','Brake test','10-week safety inspection')
  `);
  await db.query(`
    UPDATE trailers t
    JOIN (
      SELECT ti.trailer_id, ti.next_due
      FROM trailer_inspections ti
      WHERE ti.id = (
        SELECT ti2.id
        FROM trailer_inspections ti2
        WHERE ti2.trailer_id=ti.trailer_id
        ORDER BY ti2.inspection_date DESC, ti2.id DESC
        LIMIT 1
      )
    ) latest_inspection ON latest_inspection.trailer_id=t.id
    SET t.next_inspection_due=latest_inspection.next_due
  `);

  // Older quick-inspection actions wrote the inspection tables but could miss
  // the completed maintenance job used by the profile and annual planner.
  // Backfill those historical completions once, without duplicating an event
  // that already has a matching completed job.
  await db.query(`
    INSERT INTO maintenance_jobs
      (job_number, asset_type, vehicle_id, service_type, due_date, service_date,
       status, completion_notes, completed_at)
    SELECT CONCAT('MIG-VI-', vi.vehicle_id, '-', vi.id),
           'vehicle', vi.vehicle_id,
           CASE
             WHEN vi.inspection_type IN ('Safety inspection','6-week safety inspection') THEN 'Safety inspection'
             ELSE 'Brake test'
           END,
           vi.inspection_date, vi.inspection_date, 'completed', vi.notes,
           NOW()
    FROM vehicle_inspections vi
    WHERE vi.inspection_date IS NOT NULL
      AND vi.inspection_type IN ('Safety inspection','6-week safety inspection','Brake test')
      AND NOT EXISTS (
        SELECT 1
        FROM maintenance_jobs j
        WHERE j.vehicle_id=vi.vehicle_id
          AND j.asset_type='vehicle'
          AND j.status='completed'
          AND j.service_date=vi.inspection_date
          AND j.service_type=CASE
            WHEN vi.inspection_type IN ('Safety inspection','6-week safety inspection') THEN 'Safety inspection'
            ELSE 'Brake test'
          END
      )
  `);
  await db.query(`
    INSERT INTO maintenance_jobs
      (job_number, asset_type, trailer_id, service_type, due_date, service_date,
       status, completion_notes, completed_at)
    SELECT CONCAT('MIG-TI-', ti.trailer_id, '-', ti.id),
           'trailer', ti.trailer_id, 'Safety inspection',
           ti.inspection_date, ti.inspection_date, 'completed', ti.notes,
           NOW()
    FROM trailer_inspections ti
    WHERE ti.inspection_date IS NOT NULL
      AND ti.inspection_type IN ('Safety inspection','10-week safety inspection')
      AND NOT EXISTS (
        SELECT 1
        FROM maintenance_jobs j
        WHERE j.trailer_id=ti.trailer_id
          AND j.asset_type='trailer'
          AND j.status='completed'
          AND j.service_type='Safety inspection'
          AND j.service_date=ti.inspection_date
      )
  `);
  await db.query(`
    UPDATE maintenance_jobs
    SET next_due_mileage_km=completed_mileage_km + 85000
    WHERE service_type='Full Service'
      AND status='completed'
      AND completed_mileage_km IS NOT NULL
      AND (next_due_mileage_km IS NULL OR next_due_mileage_km != completed_mileage_km + 85000)
  `);

  // Keep one independent live due job per inspection type. Completing a brake
  // test must not advance the safety-inspection cycle (or vice versa).
  // This runs automatically on the first maintenance request after a restart,
  // so existing vehicles do not need to be opened and saved one by one.
  const [inspectionAlignmentSeeds] = await db.query(`
    SELECT v.id AS vehicle_id,
           j.service_type,
           COALESCE(v.inspection_frequency_weeks, 6) AS inspection_frequency_weeks,
           MAX(j.service_date) AS latest_inspection_date
    FROM vehicles v
    JOIN maintenance_jobs j
      ON j.vehicle_id=v.id
     AND j.service_type IN ('Safety inspection','Brake test')
     AND j.status='completed'
     AND j.service_date IS NOT NULL
    GROUP BY v.id, j.service_type, v.inspection_frequency_weeks
  `);
  for (const seed of inspectionAlignmentSeeds) {
    const intervalDays = Math.max(1, Number(seed.inspection_frequency_weeks || 6)) * 7;
    const alignedDueDate = calculateNextDueDate(
      seed.service_type,
      rawDate(seed.latest_inspection_date),
      null,
      intervalDays
    );
    await ensureInspectionJob(seed.vehicle_id, seed.service_type, alignedDueDate);
  }

  const integrityResult = await verifyAndRepairMaintenanceIntegrity();
  console.log("[MaintenanceIntegrity] verified", integrityResult);
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

exports.initializeMaintenance = async () => {
  if (!schemaSyncPromise) schemaSyncPromise = syncMaintenanceSchema();
  return schemaSyncPromise;
};

function rawDate(d) {
  if (!d) return "";
  if (typeof d === "string") return d.slice(0, 10);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function ukDateKey(value = new Date()) {
  const parts = Object.fromEntries(
    UK_DATE_FORMATTER.formatToParts(value)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function calendarDate(value) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    const [year, month, day] = value.slice(0, 10).split("-").map(Number);
    return new Date(year, month - 1, day, 12, 0, 0, 0);
  }
  return new Date(value);
}

function fmtDate(d) {
  if (!d) return "-";
  return calendarDate(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const today = calendarDate(ukDateKey());
  today.setHours(0, 0, 0, 0);
  const date = calendarDate(dateStr);
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
  const next = calendarDate(date);
  next.setDate(next.getDate() + days);
  return next;
}

function addMonths(date, months) {
  const next = calendarDate(date);
  const originalDay = next.getDate();
  next.setDate(1);
  next.setMonth(next.getMonth() + months);
  const lastDayOfTargetMonth = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
  next.setDate(Math.min(originalDay, lastDayOfTargetMonth));
  return next;
}

function startOfWeek(date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  const day = next.getDay() || 7;
  next.setDate(next.getDate() - day + 1);
  return next;
}

function inspectionDueWeekDate(date, inspectionIntervalDays = INSPECTION_INTERVAL_DAYS) {
  const frequencyWeeks = Math.max(2, Math.round(Number(inspectionIntervalDays || INSPECTION_INTERVAL_DAYS) / 7));
  const completedWeekStart = startOfWeek(calendarDate(date));
  return addDays(completedWeekStart, (frequencyWeeks - 1) * 7);
}

function maintenanceWeekNumber(date) {
  // ISO-8601 week number: weeks start on Monday and week 1 contains 4 January.
  const [year, month, day] = rawDate(date).split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1, day));
  const isoDay = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - isoDay);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  return Math.ceil((((target - yearStart) / (24 * 60 * 60 * 1000)) + 1) / 7);
}

function planCodeForType(type) {
  return {
    "Safety inspection": "IB",
    "Brake test": "BT",
    MOT: "MOT",
    "Road Tax": "TAX",
    Insurance: "INS",
    "Tacho Calibration": "T",
    "Full Service": "SRV"
  }[type] || null;
}

function calculateNextDueDate(serviceType, serviceDate, _roadTaxIntervalMonths, inspectionIntervalDays = INSPECTION_INTERVAL_DAYS) {
  if (!serviceType || !serviceDate) return "";
  if (serviceType === "Road Tax") {
    return rawDate(addMonths(serviceDate, DEFAULT_ROAD_TAX_INTERVAL_MONTHS));
  }
  const rule = MAINTENANCE_RULES[serviceType];
  if (rule?.days) return rawDate(inspectionDueWeekDate(serviceDate, inspectionIntervalDays));
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
  const year = Number(ukDateKey().slice(0, 4));
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
  const serviceType = String(body.service_type || body.serviceType || "").trim().replace(/^Roller brake test$/i, "Brake test");
  return {
    asset_type: assetType,
    vehicle_id: assetType === "vehicle" ? numericAssetId : null,
    trailer_id: assetType === "trailer" ? numericAssetId : null,
    defect_id: body.defect_id || body.defectId || null,
    service_type: serviceType,
    due_date: body.due_date || body.dueDate || "",
    garage_name: String(body.garage_name || body.garageName || "").trim() || null,
    assigned_mechanic: String(body.assigned_mechanic || body.assignedMechanic || "").trim() || null,
    estimated_cost_gbp: Number(body.estimated_cost_gbp || body.estimatedCostGbp || 0),
    labour_cost_gbp: Number(body.labour_cost_gbp || body.labourCostGbp || 0),
    parts_cost_gbp: Number(body.parts_cost_gbp || body.partsCostGbp || 0),
    final_cost_gbp: body.final_cost_gbp || body.finalCostGbp || null,
    service_date: body.service_date || body.serviceDate || null,
    road_tax_interval_months: serviceType === "Road Tax"
      ? DEFAULT_ROAD_TAX_INTERVAL_MONTHS
      : null,
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

async function findOpenMaintenanceJob(assetType, assetId, serviceType) {
  const idField = assetType === "trailer" ? "trailer_id" : "vehicle_id";
  const [[existing]] = await db.query(
    `SELECT id, job_number FROM maintenance_jobs
     WHERE ${idField}=? AND service_type=? AND status IN ('planned','booked','in_progress')
     ORDER BY FIELD(status,'in_progress','booked','planned'), id DESC LIMIT 1`,
    [assetId, serviceType]
  );
  return existing || null;
}

async function findCompletedMaintenanceJob(assetType, assetId, serviceType, serviceDate) {
  if (!serviceDate) return null;
  const idField = assetType === "trailer" ? "trailer_id" : "vehicle_id";
  const [[existing]] = await db.query(
    `SELECT id, job_number FROM maintenance_jobs
     WHERE ${idField}=? AND service_type=? AND service_date=? AND status='completed'
     ORDER BY id DESC LIMIT 1`,
    [assetId, serviceType, serviceDate]
  );
  return existing || null;
}

async function mergeCompletedJobDetails(jobId, job) {
  await db.query(
    `UPDATE maintenance_jobs SET
       due_date=COALESCE(?,due_date), garage_name=COALESCE(?,garage_name),
       assigned_mechanic=COALESCE(?,assigned_mechanic), final_cost_gbp=COALESCE(?,final_cost_gbp),
       completed_mileage_km=COALESCE(?,completed_mileage_km), next_due_mileage_km=COALESCE(?,next_due_mileage_km),
       bill_number=COALESCE(?,bill_number), bill_date=COALESCE(?,bill_date),
       bill_amount_gbp=COALESCE(?,bill_amount_gbp), bill_notes=COALESCE(?,bill_notes),
       bill_attachment_data=COALESCE(?,bill_attachment_data), completion_notes=COALESCE(?,completion_notes)
     WHERE id=?`,
    [job.due_date || null, job.garage_name, job.assigned_mechanic, job.final_cost_gbp,
      job.completed_mileage_km, job.next_due_mileage_km, job.bill_number, job.bill_date,
      job.bill_amount_gbp, job.bill_notes, job.bill_attachment_data, job.completion_notes, jobId]
  );
  const historyTable = job.asset_type === "trailer" ? "trailer_maintenance_records" : "maintenance_records";
  const historyIdField = job.asset_type === "trailer" ? "trailer_id" : "vehicle_id";
  const assetId = job.trailer_id || job.vehicle_id;
  await db.query(
    `UPDATE ${historyTable}
     SET description=COALESCE(?,description), cost_gbp=COALESCE(?,cost_gbp),
         garage_name=COALESCE(?,garage_name)
     WHERE ${historyIdField}=? AND service_type=? AND service_date=?`,
    [job.completion_notes || job.notes, job.final_cost_gbp, job.garage_name,
      assetId, job.service_type, job.service_date]
  );
}

async function archiveJobDocument(connection, job, reason, archivedBy = "System") {
  if (!job?.bill_attachment_data) return null;
  const assetType = job.trailer_id || job.asset_type === "trailer" ? "trailer" : "vehicle";
  const [result] = await connection.query(
    `INSERT INTO maintenance_document_archive
      (original_job_id, job_number, asset_type, vehicle_id, trailer_id, service_type,
       service_date, due_date, bill_number, bill_date, bill_amount_gbp, bill_notes,
       attachment_data, document_sha256, archive_reason, archived_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, SHA2(?, 256), ?, ?)`,
    [
      job.id,
      job.job_number || null,
      assetType,
      job.vehicle_id || null,
      job.trailer_id || null,
      job.service_type,
      rawDate(job.service_date) || null,
      rawDate(job.due_date) || null,
      job.bill_number || null,
      rawDate(job.bill_date) || null,
      job.bill_amount_gbp ?? null,
      job.bill_notes || null,
      job.bill_attachment_data,
      job.bill_attachment_data,
      String(reason || "Document detached from maintenance job.").slice(0, 255),
      String(archivedBy || "System").slice(0, 120)
    ]
  );
  return result.insertId;
}

async function ensureRecurringJob(vehicleId, serviceType, dueDate, sourceJobId = null) {
  if (!vehicleId || !serviceType || !dueDate) return null;
  const [openRows] = await db.query(
    `SELECT id FROM maintenance_jobs
     WHERE vehicle_id=? AND service_type=? AND status IN ('planned','booked','in_progress')
     ORDER BY FIELD(status,'in_progress','booked','planned'), id DESC`,
    [vehicleId, serviceType]
  );
  if (openRows.length > 0) {
    const [existing, ...duplicates] = openRows;
    await db.query(
      `UPDATE maintenance_jobs
       SET due_date=?, priority=?, recurrence_source_job_id=COALESCE(?,recurrence_source_job_id)
       WHERE id=?`,
      [dueDate, recurringPriority(daysUntil(dueDate)), sourceJobId || null, existing.id]
    );
    // Old empty planner duplicates can be removed safely; data-bearing jobs
    // are retained for the startup integrity audit instead of being destroyed.
    if (duplicates.length > 0) {
      await db.query(
        `DELETE FROM maintenance_jobs
         WHERE id IN (?)
           AND defect_id IS NULL
           AND bill_attachment_data IS NULL
           AND bill_number IS NULL
           AND COALESCE(notes,'')=''
           AND COALESCE(completion_notes,'')=''
           AND COALESCE(final_cost_gbp,0)=0`,
        [duplicates.map((row) => row.id)]
      );
    }
    return existing.id;
  }
  const jobNumber = await nextJobNumber();
  const daysLeft = daysUntil(dueDate);
  const [result] = await db.query(
    `INSERT INTO maintenance_jobs
      (job_number, vehicle_id, service_type, due_date, priority, status, recurrence_source_job_id)
     VALUES (?, ?, ?, ?, ?, 'planned', ?)`,
    [jobNumber, vehicleId, serviceType, dueDate, recurringPriority(daysLeft), sourceJobId || null]
  );
  return result.insertId;
}

async function ensureTrailerRecurringJob(trailerId, serviceType, dueDate, sourceJobId = null) {
  if (!trailerId || !serviceType || !dueDate) return null;
  const [openRows] = await db.query(
    `SELECT id FROM maintenance_jobs
     WHERE trailer_id=? AND service_type=? AND status IN ('planned','booked','in_progress')
     ORDER BY FIELD(status,'in_progress','booked','planned'), id DESC`,
    [trailerId, serviceType]
  );
  if (openRows.length > 0) {
    const [existing, ...duplicates] = openRows;
    await db.query(
      `UPDATE maintenance_jobs
       SET due_date=?, priority=?, recurrence_source_job_id=COALESCE(?,recurrence_source_job_id)
       WHERE id=?`,
      [dueDate, recurringPriority(daysUntil(dueDate)), sourceJobId || null, existing.id]
    );
    if (duplicates.length > 0) {
      await db.query(
        `DELETE FROM maintenance_jobs
         WHERE id IN (?) AND defect_id IS NULL AND bill_attachment_data IS NULL
           AND bill_number IS NULL AND COALESCE(notes,'')='' AND COALESCE(completion_notes,'')=''
           AND COALESCE(final_cost_gbp,0)=0`,
        [duplicates.map((row) => row.id)]
      );
    }
    return existing.id;
  }
  const jobNumber = await nextJobNumber();
  const [result] = await db.query(
    `INSERT INTO maintenance_jobs
      (job_number, asset_type, trailer_id, service_type, due_date, priority, status, recurrence_source_job_id)
     VALUES (?, 'trailer', ?, ?, ?, ?, 'planned', ?)`,
    [jobNumber, trailerId, serviceType, dueDate, recurringPriority(daysUntil(dueDate)), sourceJobId || null]
  );
  return result.insertId;
}

async function ensureInspectionJob(vehicleId, serviceType, dueDate, sourceJobId = null) {
  if (!vehicleId || !serviceType || !dueDate) return;
  const priority = recurringPriority(daysUntil(dueDate));
  const jobId = await ensureRecurringJob(vehicleId, serviceType, dueDate, sourceJobId);
  if (jobId) await db.query(`UPDATE maintenance_jobs SET priority=? WHERE id=?`, [priority, jobId]);
}

async function alignInspectionJobFromLatestCompletion(vehicleId, serviceType, fallbackDueDate = null, sourceJobId = null) {
  return alignRecurringJobFromLatestCompletion("vehicle", vehicleId, serviceType, fallbackDueDate, sourceJobId);
}

async function alignRecurringJobFromLatestCompletion(assetType, assetId, serviceType, fallbackDueDate = null, sourceJobId = null) {
  if (!assetId) return fallbackDueDate;
  const idField = assetType === "trailer" ? "trailer_id" : "vehicle_id";
  const [[latest]] = await db.query(
    `SELECT id, service_date, road_tax_interval_months
     FROM maintenance_jobs
     WHERE ${idField}=? AND status='completed' AND service_type=? AND service_date IS NOT NULL
     ORDER BY service_date DESC, id DESC LIMIT 1`,
    [assetId, serviceType]
  );
  let inspectionIntervalDays = assetType === "trailer"
    ? TRAILER_INSPECTION_INTERVAL_DAYS
    : INSPECTION_INTERVAL_DAYS;
  if (assetType === "vehicle" && ["Safety inspection", "Brake test"].includes(serviceType)) {
    const [[vehicle]] = await db.query(`SELECT inspection_frequency_weeks FROM vehicles WHERE id=?`, [assetId]);
    inspectionIntervalDays = Math.max(2, Number(vehicle?.inspection_frequency_weeks || 6)) * 7;
  }
  const alignedDueDate = latest?.service_date
    ? calculateNextDueDate(
        serviceType,
        rawDate(latest.service_date),
        latest.road_tax_interval_months,
        inspectionIntervalDays
      )
    : fallbackDueDate;
  if (alignedDueDate) {
    if (assetType === "trailer") {
      await ensureTrailerRecurringJob(assetId, serviceType, alignedDueDate, latest?.id || sourceJobId);
    } else {
      await ensureRecurringJob(assetId, serviceType, alignedDueDate, latest?.id || sourceJobId);
    }
    const dueColumn = dueColumnForService(assetType, serviceType);
    if (dueColumn) {
      const assetTable = assetType === "trailer" ? "trailers" : "vehicles";
      await db.query(`UPDATE ${assetTable} SET ${dueColumn}=? WHERE id=?`, [alignedDueDate, assetId]);
    }
  }
  return alignedDueDate;
}

async function inspectionJobForQuickCompletion(assetType, assetId, serviceDate) {
  const idField = assetType === "trailer" ? "trailer_id" : "vehicle_id";
  const [[existing]] = await db.query(
    `SELECT * FROM maintenance_jobs
     WHERE ${idField}=?
       AND service_type='Safety inspection'
       AND status IN ('planned','booked','in_progress')
     ORDER BY ABS(DATEDIFF(due_date, ?)) ASC, id DESC
     LIMIT 1`,
    [assetId, serviceDate]
  );
  if (existing) return existing;

  const jobNumber = await nextJobNumber();
  const [created] = await db.query(
    `INSERT INTO maintenance_jobs
      (job_number, asset_type, ${idField}, service_type, due_date, service_date, priority, status)
     VALUES (?, ?, ?, 'Safety inspection', ?, ?, 'normal', 'planned')`,
    [jobNumber, assetType, assetId, serviceDate, serviceDate]
  );
  const [[job]] = await db.query(`SELECT * FROM maintenance_jobs WHERE id=?`, [created.insertId]);
  return job;
}

async function upsertInspectionRecord(assetType, assetId, inspectionType, inspectionDate, values) {
  const table = assetType === "trailer" ? "trailer_inspections" : "vehicle_inspections";
  const idField = assetType === "trailer" ? "trailer_id" : "vehicle_id";
  const [[existing]] = await db.query(
    `SELECT id FROM ${table}
     WHERE ${idField}=? AND inspection_type=? AND inspection_date=?
     ORDER BY id DESC LIMIT 1`,
    [assetId, inspectionType, inspectionDate]
  );
  if (existing) {
    await db.query(
      `UPDATE ${table}
       SET inspector_name=COALESCE(?,inspector_name), result=?, notes=COALESCE(?,notes), next_due=?
       WHERE id=?`,
      [values.inspectorName, values.result, values.notes, values.nextDue, existing.id]
    );
    return existing.id;
  }
  const [inserted] = await db.query(
    `INSERT INTO ${table}
      (${idField}, inspection_date, inspection_type, inspector_name, result, notes, next_due)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [assetId, inspectionDate, inspectionType, values.inspectorName, values.result, values.notes, values.nextDue]
  );
  return inserted.insertId;
}

function isGeneratedMaintenanceNote(note) {
  return /^auto-created/i.test(String(note || "").trim());
}

function isTrailerMaintenanceTypeAllowed(serviceType) {
  return ["Safety inspection", "MOT"].includes(serviceType);
}

function dueColumnForService(assetType, serviceType) {
  if (serviceType === "MOT") return "mot_expiry";
  if (assetType === "vehicle" && serviceType === "Road Tax") return "road_tax_expiry";
  if (serviceType === "Insurance") return "insurance_expiry";
  if (assetType === "vehicle" && serviceType === "Tacho Calibration") return "tacho_calibration_expiry";
  if (serviceType === "Full Service") return "next_service_due";
  if (assetType === "trailer" && serviceType === "Safety inspection") return "next_inspection_due";
  return null;
}

async function ensureDefectRepairJob(defect, defaults = {}) {
  const [[existing]] = await db.query(
    `SELECT id FROM maintenance_jobs WHERE defect_id=? AND status != 'cancelled' LIMIT 1`,
    [defect.id]
  );
  if (existing) return { id: existing.id, created: false };

  const due = defaults.dueDate || rawDate(addDays(ukDateKey(), defect.severity === "critical" ? 1 : defect.severity === "high" ? 3 : 7));
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
  const serviceDate = completion.serviceDate || job.service_date || ukDateKey();
  const isTrailer = Boolean(job.trailer_id || job.asset_type === "trailer");
  let inspectionIntervalDays = isTrailer ? TRAILER_INSPECTION_INTERVAL_DAYS : INSPECTION_INTERVAL_DAYS;
  if (!isTrailer && ["Safety inspection", "Brake test"].includes(job.service_type)) {
    const [[vehicle]] = await db.query(`SELECT inspection_frequency_weeks FROM vehicles WHERE id=?`, [job.vehicle_id]);
    inspectionIntervalDays = Math.max(1, Number(vehicle?.inspection_frequency_weeks || 6)) * 7;
  }
  const nextDueDate = completion.nextDueDate || calculateNextDueDate(
    job.service_type,
    serviceDate,
    job.road_tax_interval_months,
    inspectionIntervalDays
  ) || null;
  const completedMileageKm = completion.completedMileageKm || job.completed_mileage_km || null;
  const nextDueMileageKm = completion.nextDueMileageKm
    || job.next_due_mileage_km
    || (job.service_type === "Full Service" && completedMileageKm
      ? Number(completedMileageKm) + MAINTENANCE_RULES["Full Service"].mileageKm
      : null);
  const billAmountGbp = completion.billAmountGbp || job.bill_amount_gbp || null;

  // All completion entry points converge here. If the same asset/test/date was
  // already completed (for example from a double click or stale refresh), keep
  // the existing event and only merge newly supplied paperwork/details.
  const completionAssetType = isTrailer ? "trailer" : "vehicle";
  const completionAssetId = isTrailer ? job.trailer_id : job.vehicle_id;
  const idField = isTrailer ? "trailer_id" : "vehicle_id";
  const [[existingCompletion]] = await db.query(
    `SELECT id, job_number FROM maintenance_jobs
     WHERE ${idField}=? AND service_type=? AND service_date=? AND status='completed' AND id!=?
     ORDER BY id DESC LIMIT 1`,
    [completionAssetId, job.service_type, serviceDate, Number(job.id || 0)]
  );
  if (existingCompletion) {
    await mergeCompletedJobDetails(existingCompletion.id, {
      ...job,
      asset_type: completionAssetType,
      vehicle_id: isTrailer ? null : completionAssetId,
      trailer_id: isTrailer ? completionAssetId : null,
      service_date: serviceDate,
      final_cost_gbp: finalCost,
      completed_mileage_km: completedMileageKm,
      next_due_mileage_km: nextDueMileageKm,
      bill_amount_gbp: billAmountGbp,
      completion_notes: completionNotes
    });
    return {
      finalCost,
      completionNotes,
      serviceDate,
      nextDueDate,
      completedMileageKm,
      nextDueMileageKm,
      billAmountGbp,
      duplicatePrevented: true,
      existingJobId: existingCompletion.id
    };
  }

  await db.query(
    `UPDATE maintenance_jobs
     SET status='completed', final_cost_gbp=?, completion_notes=?, service_date=?, completed_mileage_km=?, next_due_mileage_km=?,
         bill_amount_gbp=COALESCE(?, bill_amount_gbp),
         road_tax_interval_months=CASE WHEN service_type='Road Tax' THEN ? ELSE road_tax_interval_months END,
         completed_at=COALESCE(completed_at, NOW())
     WHERE id=?`,
    [finalCost, completionNotes, serviceDate, completedMileageKm, nextDueMileageKm, billAmountGbp,
      DEFAULT_ROAD_TAX_INTERVAL_MONTHS, job.id]
  );
  const historyTable = isTrailer ? "trailer_maintenance_records" : "maintenance_records";
  const historyAssetField = isTrailer ? "trailer_id" : "vehicle_id";
  const historyAssetId = isTrailer ? job.trailer_id : job.vehicle_id;
  const [[existingHistory]] = await db.query(
    `SELECT id FROM ${historyTable}
     WHERE ${historyAssetField}=? AND service_type=? AND service_date=?
     ORDER BY id DESC LIMIT 1`,
    [historyAssetId, job.service_type, serviceDate]
  );
  if (existingHistory) {
    await db.query(
      `UPDATE ${historyTable}
       SET description=COALESCE(?,description), cost_gbp=?, next_due_date=?, garage_name=COALESCE(?,garage_name)
           ${isTrailer ? "" : ", mileage=COALESCE(?,mileage)"}
       WHERE id=?`,
      isTrailer
        ? [completionNotes || job.notes || null, finalCost, nextDueDate, job.garage_name || null, existingHistory.id]
        : [completionNotes || job.notes || null, finalCost, nextDueDate, job.garage_name || null, completedMileageKm, existingHistory.id]
    );
  } else if (isTrailer) {
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
  } else if (nextDueDate && job.service_type === "Tacho Calibration") {
    await db.query(`UPDATE vehicles SET tacho_calibration_expiry=? WHERE id=?`, [nextDueDate, job.vehicle_id]);
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
    } else if (nextDueDate && ["Safety inspection", "Brake test"].includes(job.service_type)) {
      await db.query(`UPDATE trailers SET next_inspection_due=? WHERE id=?`, [nextDueDate, job.trailer_id]);
    }
    if (nextDueDate && isTrailerMaintenanceTypeAllowed(job.service_type)) {
      await alignRecurringJobFromLatestCompletion("trailer", job.trailer_id, job.service_type, nextDueDate, job.id);
    }
  }
  if (!job.trailer_id && job.asset_type !== "trailer" && ["Safety inspection", "Brake test"].includes(job.service_type)) {
    await alignInspectionJobFromLatestCompletion(job.vehicle_id, job.service_type, nextDueDate, job.id);
  } else if (!job.trailer_id && job.asset_type !== "trailer") {
    await alignRecurringJobFromLatestCompletion("vehicle", job.vehicle_id, job.service_type, nextDueDate, job.id);
  }
  if (!job.trailer_id && job.asset_type !== "trailer" && ["Safety inspection", "Brake test"].includes(job.service_type)) {
    const [[existingInspection]] = await db.query(
      `SELECT id FROM vehicle_inspections
       WHERE vehicle_id=? AND inspection_type=? AND inspection_date=?
       ORDER BY id DESC LIMIT 1`,
      [job.vehicle_id, job.service_type, serviceDate]
    );
    if (existingInspection) {
      await db.query(
        `UPDATE vehicle_inspections
         SET inspector_name=COALESCE(?,inspector_name), notes=COALESCE(?,notes), next_due=?
         WHERE id=?`,
        [job.assigned_mechanic || job.garage_name || null, completionNotes || job.notes || null, nextDueDate, existingInspection.id]
      );
    } else {
      await db.query(
        `INSERT INTO vehicle_inspections
          (vehicle_id, inspection_date, inspection_type, inspector_name, result, notes, next_due)
         VALUES (?, ?, ?, ?, 'pass', ?, ?)`,
        [job.vehicle_id, serviceDate, job.service_type, job.assigned_mechanic || job.garage_name, completionNotes || job.notes, nextDueDate]
      );
    }
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
        last_fs.next_due_date AS next_service_due,
        v.mot_expiry,
        v.insurance_expiry,
        v.road_tax_expiry,
        v.tacho_calibration_expiry,
        v.current_location,
        v.company_name,
        v.vor_reason,
        v.vor_marked_at,
        v.vor_till,
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
      LEFT JOIN maintenance_records last_fs
        ON last_fs.id = (
          SELECT fs.id
          FROM maintenance_records fs
          WHERE fs.vehicle_id = v.id AND fs.service_type = 'Full Service'
          ORDER BY fs.service_date DESC, fs.id DESC
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
        last_fs.next_due_date IS NULL,
        last_fs.next_due_date ASC,
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
        t.vor_reason,
        t.vor_marked_at,
        t.vor_till,
        t.mot_expiry,
        t.insurance_expiry,
        t.next_service_due,
        (SELECT ti.next_due FROM trailer_inspections ti WHERE ti.trailer_id = t.id ORDER BY ti.inspection_date DESC LIMIT 1) AS next_inspection_due,
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
        vorReason: v.vor_reason || "",
        vorSince: fmtDate(v.vor_marked_at),
        vorTill: v.vor_till ? fmtDate(v.vor_till) : "",
        vorTillRaw: rawDate(v.vor_till),
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
        vorReason: t.vor_reason || "",
        vorSince: fmtDate(t.vor_marked_at),
        vorTill: t.vor_till ? fmtDate(t.vor_till) : "",
        vorTillRaw: rawDate(t.vor_till),
        action: Number(t.open_defects || 0) > 0
          ? "Defect review"
          : priorityDays === null ? "Plan service"
          : priorityDays < 0 ? "Book immediately"
          : priorityDays <= 14 ? "Book workshop"
          : "Monitor"
      };
    });
    const allPlannerRows = [...plannerRows, ...trailerPlannerRows];

    const today = calendarDate(ukDateKey());
    today.setHours(0, 0, 0, 0);
    const weeklyBoard = Array.from({ length: 8 }, (_, index) => {
      const start = addDays(today, index * 7);
      const end = addDays(start, 6);
      const dueItems = allPlannerRows.filter((row) => {
        const candidates = [row.nextServiceRaw, row.nextInspectionRaw].filter(Boolean).map(calendarDate);
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
      const dueDateRaw = j.service_type === "Road Tax" && j.service_date && j.status !== "completed"
        ? calculateNextDueDate(j.service_type, rawDate(j.service_date), DEFAULT_ROAD_TAX_INTERVAL_MONTHS)
        : rawDate(j.due_date);
      const daysLeft = daysUntil(dueDateRaw);
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
        dueDate: fmtDate(dueDateRaw),
        dueDateRaw,
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
        roadTaxIntervalMonths: j.service_type === "Road Tax" ? DEFAULT_ROAD_TAX_INTERVAL_MONTHS : null,
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
        createdAt: fmtDate(j.created_at),
        updatedAt: fmtDate(j.updated_at),
        updatedAtRaw: rawDate(j.updated_at)
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
    const openJobByVehicleAndType = new Map();
    for (const job of jobs) {
      if (["planned", "booked", "in_progress"].includes(job.status)) {
        const openPrefix = job.assetType === "trailer" ? `trailer:${job.trailerId}` : `${job.vehicleId}`;
        const openKey = `${openPrefix}:${job.serviceType}`;
        const currentOpen = openJobByVehicleAndType.get(openKey);
        const rank = { in_progress: 3, booked: 2, planned: 1 };
        if (!currentOpen
          || rank[job.status] > rank[currentOpen.status]
          || (rank[job.status] === rank[currentOpen.status] && Number(job.id) > Number(currentOpen.id))) {
          openJobByVehicleAndType.set(openKey, job);
        }
      }
      if (job.status !== "completed") continue;
      const prefix = job.assetType === "trailer" ? `trailer:${job.trailerId}` : `${job.vehicleId}`;
      const key = `${prefix}:${job.serviceType}`;
      const current = latestServiceByVehicleAndType.get(key);
      const isLaterDate = job.serviceDateRaw && (!current || job.serviceDateRaw > current.serviceDateRaw);
      const isStableTieWinner = job.serviceDateRaw
        && current
        && job.serviceDateRaw === current.serviceDateRaw
        && Number(job.id) > Number(current.id);
      if (isLaterDate || isStableTieWinner) {
        latestServiceByVehicleAndType.set(key, job);
      }
    }

    const dueFromCompletedJob = (latest, type, assetType = "vehicle", inspectionIntervalDays = null) => {
      if (!latest?.serviceDateRaw) return "";
      const resolvedInspectionIntervalDays = inspectionIntervalDays
        || (assetType === "trailer" ? TRAILER_INSPECTION_INTERVAL_DAYS : INSPECTION_INTERVAL_DAYS);
      return calculateNextDueDate(
        type,
        latest.serviceDateRaw,
        latest.roadTaxIntervalMonths || DEFAULT_ROAD_TAX_INTERVAL_MONTHS,
        resolvedInspectionIntervalDays
      );
    };

    const inspectionIntervalDaysForVehicle = (vehicle) => Math.max(
      1,
      Number(vehicle?.inspection_frequency_weeks || 6)
    ) * 7;

    const dueForVehicleType = (vehicle, type) => {
      const inspectionIntervalDays = inspectionIntervalDaysForVehicle(vehicle);
      const openJob = openJobByVehicleAndType.get(`${vehicle.id}:${type}`);
      if (openJob?.dueDateRaw) return openJob.dueDateRaw;
      if (type === "Full Service") {
        return dueFromCompletedJob(latestServiceByVehicleAndType.get(`${vehicle.id}:Full Service`), type);
      }
      return dueFromCompletedJob(
        latestServiceByVehicleAndType.get(`${vehicle.id}:${type}`),
        type,
        "vehicle",
        inspectionIntervalDays
      );
    };

    const profileItemTypes = ["MOT", "Road Tax", "Insurance", "Tacho Calibration", "Safety inspection", "Brake test", "Full Service"];
    const trailerProfileItemTypes = ["MOT", "Safety inspection"];

    const trailerComplianceItems = trailerRows.flatMap((t) =>
      trailerProfileItemTypes.map((itemType) => {
        const latest = latestServiceByVehicleAndType.get(`trailer:${t.id}:${itemType}`);
        const openJob = openJobByVehicleAndType.get(`trailer:${t.id}:${itemType}`);
        const dueDateRaw = openJob?.dueDateRaw || dueFromCompletedJob(latest, itemType, "trailer");
        return { vehicleId: t.id, assetType: "trailer", vehicle: t.registration_number, itemType, dueDateRaw, dueDate: fmtDate(dueDateRaw), daysLeft: daysUntil(dueDateRaw) };
      })
    ).filter((item) => item.dueDateRaw).map((item) => ({
      ...item,
      dueLabel: dueLabel(item.daysLeft),
      tone: item.daysLeft < 0 ? "danger" : item.daysLeft <= 30 ? "warning" : "success",
      reminder: item.daysLeft <= 30 ? "Reminder due" : "Scheduled"
    })).sort((a, b) => (a.daysLeft ?? 9999) - (b.daysLeft ?? 9999));

    const complianceItems = rows.flatMap((v) =>
      profileItemTypes.map((itemType) => {
        const dueDateRaw = dueForVehicleType(v, itemType);
        return { vehicleId: v.id, vehicle: v.registration_number, itemType, dueDateRaw, dueDate: fmtDate(dueDateRaw), daysLeft: daysUntil(dueDateRaw) };
      })
    ).filter((item) => item.dueDateRaw).map((item) => ({
      ...item,
      assetType: "vehicle",
      dueLabel: dueLabel(item.daysLeft),
      tone: item.daysLeft < 0 ? "danger" : item.daysLeft <= 30 ? "warning" : "success",
      reminder: item.daysLeft <= 30 ? "Reminder due" : "Scheduled"
    })).sort((a, b) => (a.daysLeft ?? 9999) - (b.daysLeft ?? 9999));

    const allComplianceItems = [...complianceItems, ...trailerComplianceItems]
      .sort((a, b) => (a.daysLeft ?? 9999) - (b.daysLeft ?? 9999));

    const vehicleProfiles = rows.map((v) => {
      const currentKm = odometerByVehicle.get(Number(v.id)) || null;
      return {
        vehicleId: v.id,
        vehicle: v.registration_number,
        fleetCode: v.fleet_code,
        make: v.model_name,
        inspectionFrequencyWeeks: Math.max(1, Number(v.inspection_frequency_weeks || 6)),
        currentKm,
        currentKmLabel: currentKm ? `${currentKm.toLocaleString("en-GB")} km` : "-",
        status: v.status,
        vorReason: v.vor_reason || "",
        vorMarkedAt: fmtDate(v.vor_marked_at),
        vorTill: v.vor_till ? fmtDate(v.vor_till) : "",
        items: profileItemTypes.map((type) => {
          const latest = latestServiceByVehicleAndType.get(`${v.id}:${type}`);
          const dueDateRaw = dueForVehicleType(v, type);
          const daysLeft = daysUntil(dueDateRaw);
          const serviceStatus = statusFromDays(daysLeft);
          const kmRemaining = type === "Full Service" && latest?.nextDueMileageKm && currentKm
            ? Number(latest.nextDueMileageKm) - currentKm
            : null;
          return {
            type,
            latestJobId: latest?.id || null,
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
            roadTaxIntervalMonths: type === "Road Tax" ? DEFAULT_ROAD_TAX_INTERVAL_MONTHS : null,
            kmRemaining,
            kmRemainingLabel: kmRemaining === null ? "-" : `${Number(kmRemaining).toLocaleString("en-GB")} km`,
            hasAttachment: Boolean(latest?.billAttachmentData),
            attachmentData: latest?.billAttachmentData || "",
            documentSubmittedAt: latest?.billAttachmentData ? (latest.updatedAt || latest.completedAt || "-") : "",
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
      status: t.status,
      vorReason: t.vor_reason || "",
      vorMarkedAt: fmtDate(t.vor_marked_at),
      vorTill: t.vor_till ? fmtDate(t.vor_till) : "",
      items: trailerProfileItemTypes.map((type) => {
        const latest = latestServiceByVehicleAndType.get(`trailer:${t.id}:${type}`);
        const openJob = openJobByVehicleAndType.get(`trailer:${t.id}:${type}`);
        const dueDateRaw = openJob?.dueDateRaw || dueFromCompletedJob(latest, type, "trailer");
        const daysLeft = daysUntil(dueDateRaw);
        const serviceStatus = statusFromDays(daysLeft);
        return {
          type,
          latestJobId: latest?.id || null,
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
          roadTaxIntervalMonths: null,
          kmRemaining: null,
          kmRemainingLabel: "-",
          hasAttachment: Boolean(latest?.billAttachmentData),
          attachmentData: latest?.billAttachmentData || "",
          documentSubmittedAt: latest?.billAttachmentData ? (latest.updatedAt || latest.completedAt || "-") : "",
          billNumber: latest?.billNumber || "",
          billAmountGbp: latest?.billAmountGbp || "",
          billNotes: latest?.billNotes && latest.billNotes !== "-" ? latest.billNotes : ""
        };
      })
    }));
    const allVehicleProfiles = [...vehicleProfiles, ...trailerProfiles];

    // Look back far enough that a completion logged with an older backdated
    // "date done" (e.g. catching up on paperwork weeks after the work was
    // actually done) still gets its own week column, while keeping the same
    // forward planning horizon as before (56 weeks past the current week).
    const planStart = addDays(startOfWeek(calendarDate(ukDateKey())), -26 * 7);
    const planWeekCount = 82;
    const planWeeks = Array.from({ length: planWeekCount }, (_, index) => {
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
    const planEnd = addDays(planStart, (planWeekCount * 7) - 1);

    // Closed VOR periods (asset already marked back on road) — kept so past
    // off-road weeks still show on the schedule for history purposes.
    const [closedVorRows] = await db.query(
      `SELECT asset_type, asset_id, reason, since_date, actual_return_date
       FROM vor_history WHERE actual_return_date IS NOT NULL`
    );
    const closedVorByAsset = new Map();
    for (const entry of closedVorRows) {
      const key = `${entry.asset_type}:${entry.asset_id}`;
      if (!closedVorByAsset.has(key)) closedVorByAsset.set(key, []);
      closedVorByAsset.get(key).push(entry);
    }

    const yearPlanRows = rows.map((v) => {
      const profile = vehicleProfiles.find((item) => Number(item.vehicleId) === Number(v.id));
      const events = [];
      const seeds = profileItemTypes.map((type) => {
        const latest = latestServiceByVehicleAndType.get(`${v.id}:${type}`);
        return {
          type,
          dueDateRaw: dueForVehicleType(v, type),
          roadTaxIntervalMonths: latest?.roadTaxIntervalMonths || DEFAULT_ROAD_TAX_INTERVAL_MONTHS
        };
      });
      for (const seed of seeds) {
        // A cycle has exactly one live due occurrence. The following due is
        // created only after this one is completed; do not pre-generate the
        // whole recurrence horizon.
        const dates = seed.dueDateRaw ? [seed.dueDateRaw] : [];
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
      // Add VOR (vehicle off road) badge across every week it spans
      if (v.status === "maintenance" && v.vor_reason) {
        const vorStartRaw = rawDate(v.vor_marked_at) || rawDate(planStart);
        const vorEndRaw = v.vor_till ? rawDate(v.vor_till) : rawDate(planEnd);
        for (const week of planWeeks) {
          if (week.endRaw < vorStartRaw || week.startRaw > vorEndRaw) continue;
          events.push({
            id: `vor-${v.id}-${week.key}`,
            vehicleId: v.id,
            vehicle: v.registration_number,
            fleetCode: v.fleet_code,
            make: v.model_name,
            type: "Vehicle Off Road",
            code: "VOR",
            kind: "vor",
            reason: v.vor_reason,
            vorSince: fmtDate(v.vor_marked_at),
            vorTill: v.vor_till ? fmtDate(v.vor_till) : "Ongoing",
            dueDateRaw: week.startRaw,
            dueDate: fmtDate(week.startRaw),
            tone: "danger",
            weekKey: week.key,
            weekLabel: week.label
          });
        }
      }
      // Add past (closed) VOR periods so history stays visible after the
      // vehicle is marked back on road.
      for (const period of closedVorByAsset.get(`vehicle:${v.id}`) || []) {
        const vorStartRaw = rawDate(period.since_date);
        const vorEndRaw = rawDate(period.actual_return_date);
        for (const week of planWeeks) {
          if (week.endRaw < vorStartRaw || week.startRaw > vorEndRaw) continue;
          events.push({
            id: `vor-history-${v.id}-${vorStartRaw}-${week.key}`,
            vehicleId: v.id,
            vehicle: v.registration_number,
            fleetCode: v.fleet_code,
            make: v.model_name,
            type: "Vehicle Off Road",
            code: "VOR",
            kind: "vor",
            reason: period.reason,
            vorSince: fmtDate(period.since_date),
            vorTill: fmtDate(period.actual_return_date),
            dueDateRaw: week.startRaw,
            dueDate: fmtDate(week.startRaw),
            tone: "danger",
            weekKey: week.key,
            weekLabel: week.label
          });
        }
      }

      // Add completed events within the plan window. Safety inspections and
      // brake tests remain separate records with distinct schedule codes.
      for (const job of jobs) {
        if (job.trailerId || Number(job.vehicleId) !== Number(v.id)) continue;
        if (job.status !== "completed" || !job.serviceDateRaw) continue;
        // A completed marker belongs to the day the work was actually done.
        // The job's due date may now represent the next scheduled occurrence.
        const completedDateRaw = job.serviceDateRaw;
        const completedLookbackStart = rawDate(addDays(planStart, -7));
        if (completedDateRaw < completedLookbackStart || completedDateRaw > rawDate(planEnd)) continue;
        const displayDateRaw = completedDateRaw < rawDate(planStart) ? rawDate(planStart) : completedDateRaw;
        const week = planWeeks.find((w) => displayDateRaw >= w.startRaw && displayDateRaw <= w.endRaw);
        if (!week) continue;
        const code = planCodeForType(job.serviceType);
        if (!code) continue;
        const completedEvent = {
          id: `done-${job.id}`,
          jobId: job.id,
          vehicleId: v.id,
          vehicle: v.registration_number,
          fleetCode: v.fleet_code,
          make: v.model_name,
          type: job.serviceType,
          code,
          dueDateRaw: displayDateRaw,
          displayDateRaw,
          dueDate: fmtDate(displayDateRaw),
          scheduledDateRaw: job.dueDateRaw,
          scheduledDate: job.dueDate,
          dueLabel: "Completed",
          daysLeft: -999,
          tone: "success",
          weekKey: week.key,
          weekLabel: week.label,
          kind: "completed",
          completedDateRaw,
          completedDate: job.serviceDate,
          nextDueDateRaw: dueFromCompletedJob(job, job.serviceType, "vehicle", inspectionIntervalDaysForVehicle(v)),
          nextDueDate: fmtDate(dueFromCompletedJob(job, job.serviceType, "vehicle", inspectionIntervalDaysForVehicle(v))),
          completionNotes: job.completionNotes && job.completionNotes !== "-" && !isGeneratedMaintenanceNote(job.completionNotes) ? job.completionNotes : "",
          hasAttachment: Boolean(job.billAttachmentData),
          billAttachmentData: job.billAttachmentData || "",
          billNumber: job.billNumber || "",
          billDate: job.billDateRaw ? job.billDate : "-",
          documentSubmittedAt: job.billAttachmentData ? (job.updatedAt || job.completedAt || "-") : ""
        };
        events.push(completedEvent);
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
      const seeds = trailerProfileItemTypes.map((type) => {
        const latest = latestServiceByVehicleAndType.get(`trailer:${t.id}:${type}`);
        const openJob = openJobByVehicleAndType.get(`trailer:${t.id}:${type}`);
        return {
          type,
          dueDateRaw: openJob?.dueDateRaw || dueFromCompletedJob(latest, type, "trailer"),
          roadTaxIntervalMonths: latest?.roadTaxIntervalMonths || DEFAULT_ROAD_TAX_INTERVAL_MONTHS
        };
      });
      for (const seed of seeds) {
        const dates = seed.dueDateRaw ? [seed.dueDateRaw] : [];
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
      // Add VOR (vehicle off road) badge across every week it spans
      if (t.status === "maintenance" && t.vor_reason) {
        const vorStartRaw = rawDate(t.vor_marked_at) || rawDate(planStart);
        const vorEndRaw = t.vor_till ? rawDate(t.vor_till) : rawDate(planEnd);
        for (const week of planWeeks) {
          if (week.endRaw < vorStartRaw || week.startRaw > vorEndRaw) continue;
          events.push({
            id: `vor-trailer-${t.id}-${week.key}`,
            vehicleId: t.id,
            assetType: "trailer",
            vehicle: t.registration_number,
            fleetCode: t.fleet_code,
            make: t.trailer_type,
            type: "Vehicle Off Road",
            code: "VOR",
            kind: "vor",
            reason: t.vor_reason,
            vorSince: fmtDate(t.vor_marked_at),
            vorTill: t.vor_till ? fmtDate(t.vor_till) : "Ongoing",
            dueDateRaw: week.startRaw,
            dueDate: fmtDate(week.startRaw),
            tone: "danger",
            weekKey: week.key,
            weekLabel: week.label
          });
        }
      }
      // Add past (closed) VOR periods so history stays visible after the
      // trailer is marked back on road.
      for (const period of closedVorByAsset.get(`trailer:${t.id}`) || []) {
        const vorStartRaw = rawDate(period.since_date);
        const vorEndRaw = rawDate(period.actual_return_date);
        for (const week of planWeeks) {
          if (week.endRaw < vorStartRaw || week.startRaw > vorEndRaw) continue;
          events.push({
            id: `vor-history-trailer-${t.id}-${vorStartRaw}-${week.key}`,
            vehicleId: t.id,
            assetType: "trailer",
            vehicle: t.registration_number,
            fleetCode: t.fleet_code,
            make: t.trailer_type,
            type: "Vehicle Off Road",
            code: "VOR",
            kind: "vor",
            reason: period.reason,
            vorSince: fmtDate(period.since_date),
            vorTill: fmtDate(period.actual_return_date),
            dueDateRaw: week.startRaw,
            dueDate: fmtDate(week.startRaw),
            tone: "danger",
            weekKey: week.key,
            weekLabel: week.label
          });
        }
      }

      // Add completed trailer events within the plan window. Trailers currently
      // support Safety inspection and MOT only.
      for (const job of jobs) {
        if (!job.trailerId || Number(job.trailerId) !== Number(t.id)) continue;
        if (job.status !== "completed" || !job.serviceDateRaw) continue;
        if (!["Safety inspection", "MOT"].includes(job.serviceType)) continue;
        // Keep completed trailer work on its actual completion date as well.
        const completedDateRaw = job.serviceDateRaw;
        const completedLookbackStart = rawDate(addDays(planStart, -7));
        if (completedDateRaw < completedLookbackStart || completedDateRaw > rawDate(planEnd)) continue;
        const displayDateRaw = completedDateRaw < rawDate(planStart) ? rawDate(planStart) : completedDateRaw;
        const week = planWeeks.find((w) => displayDateRaw >= w.startRaw && displayDateRaw <= w.endRaw);
        if (!week) continue;
        const code = planCodeForType(job.serviceType);
        if (!code) continue;
        events.push({
          id: `done-trailer-${job.id}`,
          jobId: job.id,
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
          scheduledDateRaw: job.dueDateRaw,
          scheduledDate: job.dueDate,
          dueLabel: "Completed",
          daysLeft: -999,
          tone: "success",
          weekKey: week.key,
          weekLabel: week.label,
          kind: "completed",
          completedDateRaw,
          completedDate: job.serviceDate,
          nextDueDateRaw: dueFromCompletedJob(job, job.serviceType, "trailer"),
          nextDueDate: fmtDate(dueFromCompletedJob(job, job.serviceType, "trailer")),
          completionNotes: job.completionNotes && job.completionNotes !== "-" && !isGeneratedMaintenanceNote(job.completionNotes) ? job.completionNotes : "",
          hasAttachment: Boolean(job.billAttachmentData),
          billAttachmentData: job.billAttachmentData || "",
          billNumber: job.billNumber || "",
          billDate: job.billDateRaw ? job.billDate : "-",
          documentSubmittedAt: job.billAttachmentData ? (job.updatedAt || job.completedAt || "-") : ""
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

    const thisMonthKey = ukDateKey().slice(0, 7);
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
      .filter((job) => job.status === "completed"
        && (job.billAttachmentData || job.billNumber || job.billNotes !== "-"))
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
        truckType: v.truck_type,
        inspectionFrequencyWeeks: Math.max(1, Number(v.inspection_frequency_weeks || 6))
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
        "UK intervals are supported for brake tests, 6-week inspections, MOT, tacho calibration, road tax, and 85,000 km full service."
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
        generatedAt: ukDateKey(),
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
    const inspectionDate = req.body.inspection_date || req.body.inspectionDate || ukDateKey();

    if (!vehicleId) {
      return res.status(400).json({ message: "Valid vehicle id is required." });
    }
    if (!["pass", "advisory", "fail"].includes(result)) {
      return res.status(400).json({ message: "Inspection result must be pass, advisory, or fail." });
    }

    const [[vehicle]] = await db.query(`SELECT id, inspection_frequency_weeks FROM vehicles WHERE id=?`, [vehicleId]);
    if (!vehicle) return res.status(404).json({ message: "Vehicle not found." });
    const inspectionFrequencyWeeks = Math.max(2, Number(vehicle.inspection_frequency_weeks || 6));
    const nextDue = calculateNextDueDate(
      "Safety inspection",
      inspectionDate,
      null,
      inspectionFrequencyWeeks * 7
    );

    const inspectionId = await upsertInspectionRecord(
      "vehicle",
      vehicleId,
      "Safety inspection",
      inspectionDate,
      { inspectorName, result, notes, nextDue }
    );

    if (result === "fail") {
      await db.query(`UPDATE vehicles SET status='maintenance' WHERE id=?`, [vehicleId]);
    } else {
      const job = await inspectionJobForQuickCompletion("vehicle", vehicleId, inspectionDate);
      await applyCompletedMaintenance(job, {
        serviceDate: inspectionDate,
        nextDueDate: nextDue,
        completionNotes: notes || "6-week safety inspection completed."
      });
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
      message: result === "fail"
        ? "Inspection recorded and vehicle kept in maintenance."
        : `Inspection done. Next ${inspectionFrequencyWeeks}-week safety inspection scheduled.`,
      id: inspectionId,
      nextDue
    });
  } catch (err) {
    res.status(500).json({ message: "Inspection completion error", error: err.message });
  }
};

exports.autoPlanDueWork = async (_req, res) => {
  try {
    const [completedRows] = await db.query(`
      SELECT
        v.id,
        v.registration_number,
        j.service_type,
        j.service_date,
        j.road_tax_interval_months
      FROM vehicles v
      JOIN maintenance_jobs j
        ON j.vehicle_id = v.id
       AND j.status = 'completed'
       AND j.service_date IS NOT NULL
       AND j.service_type IN ('MOT','Insurance','Road Tax','Safety inspection','Brake test')
      WHERE NOT EXISTS (
        SELECT 1
        FROM maintenance_jobs newer
        WHERE newer.vehicle_id = j.vehicle_id
          AND newer.service_type = j.service_type
          AND newer.status = 'completed'
          AND newer.service_date IS NOT NULL
          AND (newer.service_date > j.service_date OR (newer.service_date = j.service_date AND newer.id > j.id))
      )
    `);

    const dueItems = completedRows.map((row) => ({
      vehicleId: row.id,
      vehicle: row.registration_number,
      serviceType: row.service_type,
      dueDate: calculateNextDueDate(row.service_type, rawDate(row.service_date), row.road_tax_interval_months || DEFAULT_ROAD_TAX_INTERVAL_MONTHS)
    })).filter((item) => item.dueDate && daysUntil(item.dueDate) <= 30);

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
    if (job.service_type === "Road Tax" && job.service_date) {
      job.due_date = calculateNextDueDate(job.service_type, job.service_date, DEFAULT_ROAD_TAX_INTERVAL_MONTHS);
    } else if (!job.due_date && job.service_date) {
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
    if (job.status === "completed") {
      if (!job.service_date) {
        return res.status(400).json({ message: "Completed date is required." });
      }
      const existingCompleted = await findCompletedMaintenanceJob(
        job.asset_type,
        assetId,
        job.service_type,
        job.service_date
      );
      if (existingCompleted) {
        await mergeCompletedJobDetails(existingCompleted.id, job);
        return res.json({
          message: "Existing completed item updated; no duplicate was created.",
          id: existingCompleted.id,
          jobNumber: existingCompleted.job_number,
          updatedExisting: true
        });
      }
    }
    if (["planned", "booked", "in_progress"].includes(job.status)) {
      const existingOpen = await findOpenMaintenanceJob(job.asset_type, assetId, job.service_type);
      if (existingOpen) {
        await db.query(
          `UPDATE maintenance_jobs SET due_date=?, priority=?, status=?, garage_name=COALESCE(?,garage_name),
             assigned_mechanic=COALESCE(?,assigned_mechanic), notes=COALESCE(?,notes),
             parts_required=COALESCE(?,parts_required)
           WHERE id=?`,
          [job.due_date, job.priority, job.status, job.garage_name, job.assigned_mechanic,
            job.notes, job.parts_required, existingOpen.id]
        );
        return res.json({
          message: "Existing maintenance job updated; no duplicate was created.",
          id: existingOpen.id,
          jobNumber: existingOpen.job_number,
          updatedExisting: true
        });
      }
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
      const suppliedDueDate = rawItem.due_date || rawItem.dueDate || "";
      const dueDate = serviceType === "Road Tax" && base.service_date
        ? calculateNextDueDate(serviceType, base.service_date, DEFAULT_ROAD_TAX_INTERVAL_MONTHS)
        : suppliedDueDate;
      if (!serviceType || !dueDate) continue;
      if (base.asset_type === "trailer" && !isTrailerMaintenanceTypeAllowed(serviceType)) {
        return res.status(400).json({ message: "Trailers only support MOT and safety inspection." });
      }

      const jobNumber = await nextJobNumber();
      const status = rawItem.status || base.status || "planned";
      const priority = rawItem.priority || base.priority || recurringPriority(daysUntil(dueDate));
      const completedMileageKm = rawItem.completed_mileage_km || rawItem.completedMileageKm || base.completed_mileage_km;
      const nextDueMileageKm = rawItem.next_due_mileage_km || rawItem.nextDueMileageKm || base.next_due_mileage_km;
      const roadTaxIntervalMonths = serviceType === "Road Tax" ? DEFAULT_ROAD_TAX_INTERVAL_MONTHS : null;

      if (status === "completed") {
        if (!base.service_date) {
          return res.status(400).json({ message: "Completed date is required." });
        }
        const existingCompleted = await findCompletedMaintenanceJob(
          base.asset_type,
          assetId,
          serviceType,
          base.service_date
        );
        if (existingCompleted) {
          await mergeCompletedJobDetails(existingCompleted.id, {
            ...base,
            service_type: serviceType,
            due_date: dueDate,
            road_tax_interval_months: roadTaxIntervalMonths,
            completed_mileage_km: completedMileageKm,
            next_due_mileage_km: nextDueMileageKm
          });
          created.push({
            id: existingCompleted.id,
            jobNumber: existingCompleted.job_number,
            serviceType,
            dueDate,
            status,
            updatedExisting: true
          });
          continue;
        }
      }

      if (["planned", "booked", "in_progress"].includes(status)) {
        const existingOpen = await findOpenMaintenanceJob(base.asset_type, assetId, serviceType);
        if (existingOpen) {
          await db.query(
            `UPDATE maintenance_jobs SET due_date=?, priority=?, status=?, garage_name=COALESCE(?,garage_name),
               assigned_mechanic=COALESCE(?,assigned_mechanic), notes=COALESCE(?,notes),
               parts_required=COALESCE(?,parts_required)
             WHERE id=?`,
            [dueDate, priority, status, base.garage_name, base.assigned_mechanic,
              base.notes, base.parts_required, existingOpen.id]
          );
          created.push({
            id: existingOpen.id,
            jobNumber: existingOpen.job_number,
            serviceType,
            dueDate,
            status,
            updatedExisting: true
          });
          continue;
        }
      }

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
          base.service_date, roadTaxIntervalMonths, completedMileageKm, nextDueMileageKm,
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
        road_tax_interval_months: roadTaxIntervalMonths,
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
    const [[existingJob]] = await db.query(`SELECT * FROM maintenance_jobs WHERE id=?`, [id]);
    if (!existingJob) return res.status(404).json({ message: "Maintenance job not found." });
    const job = cleanJobPayload(req.body);
    if (job.service_type === "Road Tax" && job.service_date) {
      job.due_date = calculateNextDueDate(job.service_type, job.service_date, DEFAULT_ROAD_TAX_INTERVAL_MONTHS);
    } else if (!job.due_date && job.service_date) {
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

    if (existingJob.status === "completed" && job.status !== "completed") {
      return res.status(409).json({
        message: "Use ‘Mark as not done’ to undo a completion safely."
      });
    }

    if (existingJob.status === "completed") {
      const existingAssetType = existingJob.trailer_id || existingJob.asset_type === "trailer" ? "trailer" : "vehicle";
      const existingAssetId = existingAssetType === "trailer" ? Number(existingJob.trailer_id) : Number(existingJob.vehicle_id);
      if (job.asset_type !== existingAssetType || Number(assetId) !== existingAssetId || job.service_type !== existingJob.service_type) {
        return res.status(409).json({
          message: "A completed item’s vehicle and test type cannot be replaced. Update its date/details, or mark it as not done first."
        });
      }
      if (!job.service_date) {
        return res.status(400).json({ message: "Completed date is required." });
      }
      const completedDateChanged = rawDate(existingJob.service_date) !== rawDate(job.service_date);
      const carriesSameDocument = existingJob.bill_attachment_data
        && (!job.bill_attachment_data || job.bill_attachment_data === existingJob.bill_attachment_data);
      if (completedDateChanged && carriesSameDocument) {
        return res.status(409).json({
          message: "This completion date cannot be changed while its existing document is attached. Remove the wrong document first, or upload the correct document for the new date."
        });
      }

      let inspectionIntervalDays = existingAssetType === "trailer"
        ? TRAILER_INSPECTION_INTERVAL_DAYS
        : INSPECTION_INTERVAL_DAYS;
      if (existingAssetType === "vehicle" && ["Safety inspection", "Brake test"].includes(job.service_type)) {
        const [[vehicle]] = await db.query(`SELECT inspection_frequency_weeks FROM vehicles WHERE id=?`, [existingAssetId]);
        inspectionIntervalDays = Math.max(2, Number(vehicle?.inspection_frequency_weeks || 6)) * 7;
      }
      const nextDueDate = calculateNextDueDate(
        job.service_type,
        job.service_date,
        job.road_tax_interval_months,
        inspectionIntervalDays
      ) || null;
      const previousServiceDate = rawDate(existingJob.service_date);
      const connection = await db.getConnection();
      try {
        await connection.beginTransaction();
        const idField = existingAssetType === "trailer" ? "trailer_id" : "vehicle_id";
        const [[dateCollision]] = await connection.query(
          `SELECT id FROM maintenance_jobs
           WHERE ${idField}=? AND service_type=? AND status='completed' AND service_date=? AND id!=?
           LIMIT 1 FOR UPDATE`,
          [existingAssetId, job.service_type, job.service_date, id]
        );
        if (dateCollision) {
          await connection.rollback();
          return res.status(409).json({
            message: `${job.service_type} already has a completed record on ${job.service_date}. Edit that existing record instead.`
          });
        }

        await connection.query(
          `UPDATE maintenance_jobs SET
            due_date=?, garage_name=?, assigned_mechanic=?, estimated_cost_gbp=?, labour_cost_gbp=?, parts_cost_gbp=?,
            final_cost_gbp=?, service_date=?, road_tax_interval_months=?, completed_mileage_km=?, next_due_mileage_km=?,
            bill_number=?, bill_date=?, bill_amount_gbp=?, bill_notes=?, bill_attachment_data=?,
            bill_status=?, bill_payment_status=?, vendor_invoice_ref=?, priority=?, notes=?, parts_required=?, completion_notes=?
           WHERE id=?`,
          [
            job.due_date, job.garage_name, job.assigned_mechanic, job.estimated_cost_gbp, job.labour_cost_gbp,
            job.parts_cost_gbp, job.final_cost_gbp, job.service_date, job.road_tax_interval_months,
            job.completed_mileage_km, job.next_due_mileage_km, job.bill_number, job.bill_date,
            job.bill_amount_gbp, job.bill_notes, job.bill_attachment_data, job.bill_status,
            job.bill_payment_status, job.vendor_invoice_ref, job.priority, job.notes, job.parts_required,
            job.completion_notes, id
          ]
        );

        if (existingAssetType === "trailer") {
          await connection.query(
            `INSERT INTO trailer_maintenance_records
              (trailer_id, service_date, service_type, description, cost_gbp, next_due_date, garage_name)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE description=VALUES(description), cost_gbp=VALUES(cost_gbp),
               next_due_date=VALUES(next_due_date), garage_name=VALUES(garage_name)`,
            [existingAssetId, job.service_date, job.service_type, job.completion_notes || job.notes,
              Number(job.final_cost_gbp || 0), nextDueDate, job.garage_name]
          );
        } else {
          await connection.query(
            `INSERT INTO maintenance_records
              (vehicle_id, service_date, service_type, description, cost_gbp, mileage, next_due_date, garage_name)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE description=VALUES(description), cost_gbp=VALUES(cost_gbp),
               mileage=VALUES(mileage), next_due_date=VALUES(next_due_date), garage_name=VALUES(garage_name)`,
            [existingAssetId, job.service_date, job.service_type, job.completion_notes || job.notes,
              Number(job.final_cost_gbp || 0), job.completed_mileage_km, nextDueDate, job.garage_name]
          );
        }
        if (previousServiceDate && previousServiceDate !== job.service_date) {
          const historyTable = existingAssetType === "trailer" ? "trailer_maintenance_records" : "maintenance_records";
          const historyIdField = existingAssetType === "trailer" ? "trailer_id" : "vehicle_id";
          await connection.query(
            `DELETE FROM ${historyTable} WHERE ${historyIdField}=? AND service_type=? AND service_date=?`,
            [existingAssetId, job.service_type, previousServiceDate]
          );
        }

        if (["Safety inspection", "Brake test"].includes(job.service_type)) {
          const inspectionTable = existingAssetType === "trailer" ? "trailer_inspections" : "vehicle_inspections";
          const inspectionIdField = existingAssetType === "trailer" ? "trailer_id" : "vehicle_id";
          await connection.query(
            `INSERT INTO ${inspectionTable}
              (${inspectionIdField}, inspection_date, inspection_type, inspector_name, result, notes, next_due)
             VALUES (?, ?, ?, ?, 'pass', ?, ?)
             ON DUPLICATE KEY UPDATE inspector_name=VALUES(inspector_name), result=VALUES(result),
               notes=VALUES(notes), next_due=VALUES(next_due)`,
            [existingAssetId, job.service_date, job.service_type,
              job.assigned_mechanic || job.garage_name, job.completion_notes || job.notes, nextDueDate]
          );
          if (previousServiceDate && previousServiceDate !== job.service_date) {
            await connection.query(
              `DELETE FROM ${inspectionTable}
               WHERE ${inspectionIdField}=? AND inspection_type=? AND inspection_date=?`,
              [existingAssetId, job.service_type, previousServiceDate]
            );
          }
        }
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }

      await alignRecurringJobFromLatestCompletion(
        existingAssetType,
        existingAssetId,
        job.service_type,
        nextDueDate,
        id
      );
      await setAssetWorkshopStatus(existingAssetType, existingAssetId, job.status);
      return res.json({ message: "Completed maintenance item updated in place.", nextDueDate });
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
    if (job.status === "completed" && existingJob.status !== "completed") {
      await applyCompletedMaintenance({ ...existingJob, ...job, id });
      if (job.defect_id) {
        await db.query(
          `UPDATE defect_reports SET status='resolved', workflow_status='verified', resolved_at=NOW() WHERE id=?`,
          [job.defect_id]
        );
      }
      const idField = job.asset_type === "trailer" ? "trailer_id" : "vehicle_id";
      const [[open]] = await db.query(
        `SELECT COUNT(*) AS count FROM maintenance_jobs
         WHERE ${idField}=? AND id!=? AND status IN ('booked','in_progress')`,
        [assetId, id]
      );
      if (Number(open.count || 0) === 0) {
        const table = job.asset_type === "trailer" ? "trailers" : "vehicles";
        await db.query(`UPDATE ${table} SET status='available' WHERE id=? AND status='maintenance'`, [assetId]);
      }
    }
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
    if (job.status === "completed") {
      return res.json({ message: "Maintenance job was already completed; no duplicate history was created." });
    }

    await applyCompletedMaintenance(job, {
      finalCost: Number(req.body.final_cost_gbp || req.body.finalCostGbp || job.final_cost_gbp || job.estimated_cost_gbp || 0),
      completionNotes: String(req.body.completion_notes || req.body.completionNotes || job.completion_notes || "").trim() || null,
      serviceDate: req.body.service_date || req.body.serviceDate || job.service_date || ukDateKey(),
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
    const inspectionDate = req.body.inspection_date || req.body.inspectionDate || ukDateKey();
    const nextDue = calculateNextDueDate(
      "Safety inspection",
      inspectionDate,
      null,
      TRAILER_INSPECTION_INTERVAL_DAYS
    );

    if (!trailerId) return res.status(400).json({ message: "Valid trailer id is required." });
    if (!["pass", "advisory", "fail"].includes(result)) {
      return res.status(400).json({ message: "Inspection result must be pass, advisory, or fail." });
    }

    const [[trailer]] = await db.query(`SELECT id FROM trailers WHERE id=?`, [trailerId]);
    if (!trailer) return res.status(404).json({ message: "Trailer not found." });

    const inspectionId = await upsertInspectionRecord(
      "trailer",
      trailerId,
      "Safety inspection",
      inspectionDate,
      { inspectorName, result, notes, nextDue }
    );

    if (result === "fail") {
      await db.query(`UPDATE trailers SET status='maintenance' WHERE id=?`, [trailerId]);
    } else {
      const job = await inspectionJobForQuickCompletion("trailer", trailerId, inspectionDate);
      await applyCompletedMaintenance(job, {
        serviceDate: inspectionDate,
        nextDueDate: nextDue,
        completionNotes: notes || "10-week safety inspection completed."
      });
    }

    res.status(201).json({
      message: result === "fail" ? "Inspection recorded, trailer kept in maintenance." : "Inspection done. Next 10-week inspection scheduled.",
      id: inspectionId,
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
    const dueDate = rawDate(addDays(ukDateKey(), severity === "critical" ? 1 : severity === "high" ? 3 : 7));
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

// Mark or clear a vehicle/trailer's Vehicle Off Road (VOR) status
exports.setVorStatus = async (req, res) => {
  try {
    const encodedAsset = String(req.body.asset_id || req.body.assetId || "");
    const [encodedType, encodedId] = encodedAsset.includes(":") ? encodedAsset.split(":") : ["vehicle", encodedAsset];
    const assetType = encodedType === "trailer" ? "trailer" : "vehicle";
    const assetNumericId = Number(encodedId || 0);
    const onRoad = Boolean(req.body.on_road || req.body.onRoad);
    const reason = String(req.body.reason || "").trim();
    const since = req.body.since || req.body.vor_since || req.body.vorSince || null;
    const till = req.body.till || req.body.vor_till || req.body.vorTill || null;

    if (!assetNumericId) return res.status(400).json({ message: "Asset is required." });
    if (!onRoad && !reason) return res.status(400).json({ message: "A reason is required to mark a vehicle off road." });
    if (!onRoad && since && till && till < since) {
      return res.status(400).json({ message: "Expected back date cannot be before the off road since date." });
    }

    const table = assetType === "trailer" ? "trailers" : "vehicles";
    if (onRoad) {
      // Close the open history record first so the past VOR weeks stay on the
      // schedule for reference, then clear the live status columns.
      await db.query(
        `UPDATE vor_history SET actual_return_date=? WHERE asset_type=? AND asset_id=? AND actual_return_date IS NULL`,
        [ukDateKey(), assetType, assetNumericId]
      );
      await db.query(
        `UPDATE ${table} SET status='available', vor_reason=NULL, vor_marked_at=NULL, vor_till=NULL WHERE id=? AND status IN ('maintenance','stopped')`,
        [assetNumericId]
      );
      return res.json({ message: "Vehicle marked back on road." });
    }

    const sinceDate = since || ukDateKey();
    await db.query(
      `UPDATE ${table} SET status='maintenance', vor_reason=?, vor_marked_at=?, vor_till=? WHERE id=?`,
      [reason, sinceDate, till || null, assetNumericId]
    );
    await db.query(
      `INSERT INTO vor_history (asset_type, asset_id, reason, since_date, expected_till_date) VALUES (?, ?, ?, ?, ?)`,
      [assetType, assetNumericId, reason, sinceDate, till || null]
    );
    res.json({ message: "Vehicle marked off road (VOR)." });
  } catch (err) {
    res.status(500).json({ message: "VOR status update error", error: err.message });
  }
};

// Detach a wrongly associated document without destroying it. The full file
// and its original job metadata are retained in a non-UI archive for audit and
// recovery, while the active maintenance record stops displaying it.
exports.removeJobDocument = async (req, res) => {
  const connection = await db.getConnection();
  try {
    const jobId = Number(req.params.id);
    const reason = String(req.body.reason || "Document was attached to the wrong maintenance event.").trim();
    if (!jobId) return res.status(400).json({ message: "Valid maintenance job id is required." });
    if (reason.length < 5) return res.status(400).json({ message: "A short removal reason is required." });

    await connection.beginTransaction();
    const [[job]] = await connection.query(`SELECT * FROM maintenance_jobs WHERE id=? FOR UPDATE`, [jobId]);
    if (!job) {
      await connection.rollback();
      return res.status(404).json({ message: "Maintenance job was not found." });
    }
    if (!job.bill_attachment_data) {
      await connection.rollback();
      return res.status(409).json({ message: "This maintenance item has no attached document." });
    }

    const archiveId = await archiveJobDocument(
      connection,
      job,
      reason,
      req.sessionUser?.name || "Admin"
    );
    await connection.query(`UPDATE maintenance_jobs SET bill_attachment_data=NULL WHERE id=?`, [jobId]);
    await connection.commit();

    await logActivity(req, {
      module: "maintenance",
      action: "detach_document",
      entityType: "maintenance_job",
      entityId: jobId,
      entityLabel: `${job.job_number} · ${job.service_type}`,
      reason,
      reasonCategory: "data_correction",
      details: {
        archiveId,
        assetType: job.trailer_id || job.asset_type === "trailer" ? "trailer" : "vehicle",
        vehicleId: job.vehicle_id || null,
        trailerId: job.trailer_id || null,
        serviceType: job.service_type,
        serviceDate: rawDate(job.service_date) || null
      }
    });
    return res.json({ message: "Document removed from this item and preserved in the recovery archive.", archiveId });
  } catch (err) {
    try { await connection.rollback(); } catch (_rollbackError) { /* no-op */ }
    return res.status(500).json({ message: "Could not remove maintenance document.", error: err.message });
  } finally {
    connection.release();
  }
};

// Undo an accidental completion without creating a replacement/duplicate job.
// The same job returns to its planned state and all completion projections are
// removed in one transaction; the audit trail is stored separately.
exports.undoCompletedEvent = async (req, res) => {
  const connection = await db.getConnection();
  try {
    const jobId = Number(req.params.jobId);
    if (!jobId) return res.status(400).json({ message: "Valid maintenance job id is required." });

    await connection.beginTransaction();
    const [[job]] = await connection.query(
      `SELECT * FROM maintenance_jobs WHERE id=? FOR UPDATE`,
      [jobId]
    );
    if (!job) {
      await connection.rollback();
      return res.status(404).json({ message: "Maintenance completion was not found." });
    }
    if (job.status !== "completed" || !job.service_date) {
      await connection.rollback();
      return res.status(409).json({ message: "This maintenance item is not marked as completed." });
    }

    const assetType = job.trailer_id || job.asset_type === "trailer" ? "trailer" : "vehicle";
    const assetId = assetType === "trailer" ? Number(job.trailer_id) : Number(job.vehicle_id);
    const idField = assetType === "trailer" ? "trailer_id" : "vehicle_id";
    const historyTable = assetType === "trailer" ? "trailer_maintenance_records" : "maintenance_records";
    const historyIdField = assetType === "trailer" ? "trailer_id" : "vehicle_id";
    const inspectionTable = assetType === "trailer" ? "trailer_inspections" : "vehicle_inspections";
    const serviceDate = rawDate(job.service_date);
    let intervalDays = assetType === "trailer" ? TRAILER_INSPECTION_INTERVAL_DAYS : INSPECTION_INTERVAL_DAYS;
    if (assetType === "vehicle" && ["Safety inspection", "Brake test"].includes(job.service_type)) {
      const [[vehicle]] = await connection.query(`SELECT inspection_frequency_weeks FROM vehicles WHERE id=?`, [assetId]);
      intervalDays = Math.max(2, Number(vehicle?.inspection_frequency_weeks || 6)) * 7;
    }
    const generatedNextDue = calculateNextDueDate(
      job.service_type,
      serviceDate,
      job.road_tax_interval_months,
      intervalDays
    );

    const [blockingOpenJobs] = await connection.query(
      `SELECT id FROM maintenance_jobs
       WHERE ${idField}=? AND service_type=? AND id!=?
         AND status IN ('planned','booked','in_progress')
         AND NOT (
           recurrence_source_job_id=?
           OR (
             due_date=? AND defect_id IS NULL AND bill_attachment_data IS NULL
             AND bill_number IS NULL AND COALESCE(notes,'')='' AND COALESCE(completion_notes,'')=''
             AND COALESCE(final_cost_gbp,0)=0
           )
         )
       LIMIT 1`,
      [assetId, job.service_type, jobId, jobId, generatedNextDue || serviceDate]
    );
    if (blockingOpenJobs.length > 0) {
      await connection.rollback();
      return res.status(409).json({
        message: "Undo stopped safely because the following cycle already contains workshop data. Review that open job first."
      });
    }

    await connection.query(
      `DELETE FROM maintenance_jobs
       WHERE ${idField}=? AND service_type=? AND id!=?
         AND status IN ('planned','booked','in_progress')
         AND (
           recurrence_source_job_id=?
           OR (
             due_date=? AND defect_id IS NULL AND bill_attachment_data IS NULL
             AND bill_number IS NULL AND COALESCE(notes,'')='' AND COALESCE(completion_notes,'')=''
             AND COALESCE(final_cost_gbp,0)=0
           )
         )`,
      [assetId, job.service_type, jobId, jobId, generatedNextDue || serviceDate]
    );
    await connection.query(
      `DELETE FROM ${historyTable}
       WHERE ${historyIdField}=? AND service_type=? AND service_date=?`,
      [assetId, job.service_type, serviceDate]
    );
    if (["Safety inspection", "Brake test"].includes(job.service_type)) {
      const inspectionTypes = job.service_type === "Safety inspection"
        ? (assetType === "trailer"
            ? ["Safety inspection", "10-week safety inspection"]
            : ["Safety inspection", "6-week safety inspection"])
        : ["Brake test"];
      await connection.query(
        `DELETE FROM ${inspectionTable}
         WHERE ${idField}=? AND inspection_type IN (?) AND inspection_date=?`,
        [assetId, inspectionTypes, serviceDate]
      );
    }

    const undoReason = String(req.body.reason || "Marked as not done from maintenance planner.").trim();
    const archivedDocumentId = await archiveJobDocument(
      connection,
      job,
      `Completion undone: ${undoReason}`,
      req.sessionUser?.name || "Admin"
    );

    await connection.query(
      `UPDATE maintenance_jobs
       SET status='planned', service_date=NULL, completed_at=NULL,
           completion_notes=NULL, final_cost_gbp=NULL,
           completed_mileage_km=NULL, next_due_mileage_km=NULL,
           recurrence_source_job_id=NULL,
           bill_attachment_data=NULL, bill_number=NULL, bill_date=NULL,
           bill_amount_gbp=NULL, bill_notes=NULL, vendor_invoice_ref=NULL,
           bill_status='pending', bill_payment_status='unpaid'
       WHERE id=?`,
      [jobId]
    );

    const [[latestRemaining]] = await connection.query(
      `SELECT id, service_date, road_tax_interval_months
       FROM maintenance_jobs
       WHERE ${idField}=? AND service_type=? AND status='completed' AND service_date IS NOT NULL
       ORDER BY service_date DESC, id DESC LIMIT 1`,
      [assetId, job.service_type]
    );
    const restoredDueDate = latestRemaining?.service_date
      ? calculateNextDueDate(
          job.service_type,
          rawDate(latestRemaining.service_date),
          latestRemaining.road_tax_interval_months,
          intervalDays
        )
      : null;
    if (restoredDueDate) {
      await connection.query(
        `UPDATE maintenance_jobs
         SET due_date=?, priority=?, recurrence_source_job_id=?
         WHERE id=?`,
        [restoredDueDate, recurringPriority(daysUntil(restoredDueDate)), latestRemaining.id, jobId]
      );
    }
    const dueColumn = dueColumnForService(assetType, job.service_type);
    if (dueColumn) {
      const assetTable = assetType === "trailer" ? "trailers" : "vehicles";
      await connection.query(`UPDATE ${assetTable} SET ${dueColumn}=? WHERE id=?`, [restoredDueDate, assetId]);
    }

    await connection.commit();
    await logActivity(req, {
      module: "maintenance",
      action: "undo_completion",
      entityType: "maintenance_job",
      entityId: jobId,
      entityLabel: `${job.service_type} · ${serviceDate}`,
      reason: undoReason,
      reasonCategory: "data_correction",
      details: {
        assetType,
        assetId,
        serviceType: job.service_type,
        serviceDate,
        archivedDocumentId
      }
    });
    return res.json({ message: `${job.service_type} marked as not done.`, jobId });
  } catch (err) {
    try { await connection.rollback(); } catch (_rollbackError) { /* no-op */ }
    return res.status(500).json({ message: "Could not undo maintenance completion.", error: err.message });
  } finally {
    connection.release();
  }
};

// Mark an Excel schedule event as done — finds or creates job and completes it
exports.completeEventFromSchedule = async (req, res) => {
  try {
    const encodedAsset = String(req.body.asset_id || req.body.assetId || "");
    const [encodedType, encodedId] = encodedAsset.includes(":") ? encodedAsset.split(":") : ["vehicle", encodedAsset];
    const assetType = encodedType === "trailer" ? "trailer" : "vehicle";
    const assetNumericId = Number(encodedId || 0);
    const serviceType = String(req.body.service_type || req.body.serviceType || "").trim().replace(/^Roller brake test$/i, "Brake test");
    const serviceDate = req.body.service_date || req.body.serviceDate || ukDateKey();
    const requestedScheduledDueDate = req.body.due_date || req.body.dueDate || null;
    const scheduledDueDate = requestedScheduledDueDate || serviceDate;
    const garageName = String(req.body.garage_name || req.body.garageName || "").trim() || null;
    const finalCostGbp = Number(req.body.final_cost_gbp || req.body.finalCostGbp || 0);
    const correctionFinalCost = req.body.final_cost_gbp === "" || req.body.final_cost_gbp == null
      ? null
      : Number(req.body.final_cost_gbp);
    const billAttachmentData = req.body.bill_attachment_data || req.body.billAttachmentData || null;
    const billNotes = String(req.body.bill_notes || req.body.billNotes || "").trim() || null;
    const completionNotes = String(req.body.completion_notes || req.body.completionNotes || req.body.notes || "").trim() || billNotes;
    const billNumber = String(req.body.bill_number || req.body.billNumber || "").trim() || null;
    const billAmountGbp = req.body.bill_amount_gbp || req.body.billAmountGbp || null;
    const roadTaxIntervalMonths = serviceType === "Road Tax" ? DEFAULT_ROAD_TAX_INTERVAL_MONTHS : null;
    const completedJobId = Number(req.body.completed_job_id || req.body.completedJobId || 0);

    if (!assetNumericId || !serviceType) {
      return res.status(400).json({ message: "Asset and service type are required." });
    }
    if (assetType === "trailer" && !isTrailerMaintenanceTypeAllowed(serviceType)) {
      return res.status(400).json({ message: "Trailers only support MOT and safety inspection." });
    }

    let inspectionIntervalDays = assetType === "trailer" ? TRAILER_INSPECTION_INTERVAL_DAYS : INSPECTION_INTERVAL_DAYS;
    if (assetType === "vehicle" && ["Safety inspection", "Brake test"].includes(serviceType)) {
      const [[vehicle]] = await db.query(`SELECT inspection_frequency_weeks FROM vehicles WHERE id=?`, [assetNumericId]);
      inspectionIntervalDays = Math.max(1, Number(vehicle?.inspection_frequency_weeks || 6)) * 7;
    }
    const nextDueDate = calculateNextDueDate(
      serviceType,
      serviceDate,
      roadTaxIntervalMonths,
      inspectionIntervalDays
    );
    const idField = assetType === "trailer" ? "trailer_id" : "vehicle_id";

    // Correct an existing completed event in place. This preserves its document
    // and history identity instead of creating a second completion on a new date.
    if (completedJobId) {
      const [[completedJob]] = await db.query(
        `SELECT * FROM maintenance_jobs
         WHERE id=? AND ${idField}=? AND service_type=? AND status='completed'
         LIMIT 1`,
        [completedJobId, assetNumericId, serviceType]
      );
      if (!completedJob) {
        return res.status(404).json({ message: "Completed maintenance record was not found." });
      }

      const previousServiceDate = rawDate(completedJob.service_date);
      const completedDateChanged = previousServiceDate !== rawDate(serviceDate);
      const carriesSameDocument = completedJob.bill_attachment_data
        && (!billAttachmentData || billAttachmentData === completedJob.bill_attachment_data);
      if (completedDateChanged && carriesSameDocument) {
        return res.status(409).json({
          message: "This completion date cannot be changed while its existing document is attached. Remove the wrong document first, or upload the correct document for the new date."
        });
      }
      const historyTable = assetType === "trailer" ? "trailer_maintenance_records" : "maintenance_records";
      const historyIdField = assetType === "trailer" ? "trailer_id" : "vehicle_id";
      const correctionCost = correctionFinalCost ?? completedJob.final_cost_gbp ?? 0;
      const completedMileageKm = req.body.completed_mileage_km || req.body.completedMileageKm || completedJob.completed_mileage_km || null;
      const connection = await db.getConnection();
      try {
        await connection.beginTransaction();
        const [[dateCollision]] = await connection.query(
          `SELECT id FROM maintenance_jobs
           WHERE ${idField}=? AND service_type=? AND status='completed' AND service_date=? AND id!=?
           LIMIT 1 FOR UPDATE`,
          [assetNumericId, serviceType, serviceDate, completedJobId]
        );
        if (dateCollision) {
          await connection.rollback();
          return res.status(409).json({
            message: `${serviceType} already has a completed record on ${serviceDate}. Edit that existing record instead.`
          });
        }
        await connection.query(
          `UPDATE maintenance_jobs
           SET service_date=?, due_date=COALESCE(?,due_date), garage_name=COALESCE(?,garage_name), final_cost_gbp=COALESCE(?,final_cost_gbp),
               bill_attachment_data=COALESCE(?,bill_attachment_data), bill_notes=COALESCE(?,bill_notes),
               completion_notes=COALESCE(?,completion_notes), bill_number=COALESCE(?,bill_number),
               bill_amount_gbp=COALESCE(?,bill_amount_gbp), completed_mileage_km=COALESCE(?,completed_mileage_km),
               road_tax_interval_months=CASE WHEN service_type='Road Tax' THEN ? ELSE road_tax_interval_months END
           WHERE id=?`,
          [serviceDate, requestedScheduledDueDate, garageName, correctionFinalCost, billAttachmentData, billNotes,
            completionNotes, billNumber, billAmountGbp, completedMileageKm,
            DEFAULT_ROAD_TAX_INTERVAL_MONTHS, completedJobId]
        );

        if (assetType === "trailer") {
          await connection.query(
            `INSERT INTO trailer_maintenance_records
              (trailer_id, service_date, service_type, description, cost_gbp, next_due_date, garage_name)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE description=COALESCE(VALUES(description),description),
               cost_gbp=VALUES(cost_gbp), next_due_date=VALUES(next_due_date),
               garage_name=COALESCE(VALUES(garage_name),garage_name)`,
            [assetNumericId, serviceDate, serviceType, completionNotes, correctionCost, nextDueDate || null, garageName]
          );
        } else {
          await connection.query(
            `INSERT INTO maintenance_records
              (vehicle_id, service_date, service_type, description, cost_gbp, mileage, next_due_date, garage_name)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE description=COALESCE(VALUES(description),description),
               cost_gbp=VALUES(cost_gbp), mileage=COALESCE(VALUES(mileage),mileage),
               next_due_date=VALUES(next_due_date), garage_name=COALESCE(VALUES(garage_name),garage_name)`,
            [assetNumericId, serviceDate, serviceType, completionNotes, correctionCost,
              completedMileageKm, nextDueDate || null, garageName]
          );
        }
        if (previousServiceDate && previousServiceDate !== serviceDate) {
          await connection.query(
            `DELETE FROM ${historyTable} WHERE ${historyIdField}=? AND service_type=? AND service_date=?`,
            [assetNumericId, serviceType, previousServiceDate]
          );
        }

        if (["Safety inspection", "Brake test"].includes(serviceType)) {
          const inspectionTable = assetType === "trailer" ? "trailer_inspections" : "vehicle_inspections";
          await connection.query(
            `INSERT INTO ${inspectionTable}
              (${idField}, inspection_date, inspection_type, inspector_name, result, notes, next_due)
             VALUES (?, ?, ?, ?, 'pass', ?, ?)
             ON DUPLICATE KEY UPDATE inspector_name=COALESCE(VALUES(inspector_name),inspector_name),
               notes=COALESCE(VALUES(notes),notes), next_due=VALUES(next_due)`,
            [assetNumericId, serviceDate, serviceType, garageName, completionNotes, nextDueDate || null]
          );
          if (previousServiceDate && previousServiceDate !== serviceDate) {
            await connection.query(
              `DELETE FROM ${inspectionTable} WHERE ${idField}=? AND inspection_type=? AND inspection_date=?`,
              [assetNumericId, serviceType, previousServiceDate]
            );
          }
        }
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }

      await alignRecurringJobFromLatestCompletion(
        assetType,
        assetNumericId,
        serviceType,
        nextDueDate || null,
        completedJobId
      );

      return res.json({ message: "Completed event updated.", jobId: completedJobId, nextDueDate });
    }

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
             bill_amount_gbp=COALESCE(?,bill_amount_gbp),
             road_tax_interval_months=CASE WHEN service_type='Road Tax' THEN ? ELSE road_tax_interval_months END
         WHERE id=?`,
        [garageName, scheduledDueDate, finalCostGbp, billAttachmentData, billNotes, completionNotes,
          billNumber, billAmountGbp, DEFAULT_ROAD_TAX_INTERVAL_MONTHS, completedSameDay.id]
      );
      return res.json({ message: "Event already marked as done.", jobId: completedSameDay.id, nextDueDate });
    }

    // Find existing open job or create one
    const [[existing]] = await db.query(
      `SELECT id FROM maintenance_jobs
       WHERE ${idField}=?
         AND service_type=?
         AND status NOT IN ('completed','cancelled')
       ORDER BY FIELD(status,'in_progress','booked','planned'),
                ABS(DATEDIFF(COALESCE(due_date, ?), ?)) ASC, id DESC
       LIMIT 1`,
      [assetNumericId, serviceType, scheduledDueDate, scheduledDueDate]
    );

    let jobId;
    if (existing) {
      jobId = existing.id;
      await db.query(
        `UPDATE maintenance_jobs SET garage_name=COALESCE(?,garage_name), final_cost_gbp=?, bill_attachment_data=COALESCE(?,bill_attachment_data),
         due_date=COALESCE(?,due_date), bill_notes=COALESCE(?,bill_notes), completion_notes=COALESCE(?,completion_notes), bill_number=COALESCE(?,bill_number),
         bill_amount_gbp=COALESCE(?,bill_amount_gbp), road_tax_interval_months=CASE WHEN service_type='Road Tax' THEN ? ELSE road_tax_interval_months END
         WHERE id=?`,
        [garageName, finalCostGbp, billAttachmentData, scheduledDueDate, billNotes, completionNotes,
          billNumber, billAmountGbp, DEFAULT_ROAD_TAX_INTERVAL_MONTHS, jobId]
      );
    } else {
      const jobNumber = await nextJobNumber();
      const [newJob] = await db.query(
        `INSERT INTO maintenance_jobs
          (job_number, asset_type, ${idField}, service_type, due_date, garage_name, final_cost_gbp,
           bill_attachment_data, bill_notes, completion_notes, bill_number, bill_amount_gbp, status, priority, service_date,
           road_tax_interval_months)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'planned','normal',?,?)`,
        [jobNumber, assetType, assetNumericId, serviceType, scheduledDueDate, garageName, finalCostGbp,
         billAttachmentData, billNotes, completionNotes, billNumber, billAmountGbp, serviceDate, roadTaxIntervalMonths]
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
