const assert = require("assert");
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

const databaseName = `astrafleet_compliance_test_${Date.now()}`;
const connectionOptions = {
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || ""
};

function mockResponse() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    setHeader(key, value) { this.headers[key] = value; },
    send(body) { this.body = body; return this; }
  };
}

async function invoke(handler, request = {}) {
  const response = mockResponse();
  await handler({ body: {}, params: {}, query: {}, headers: {}, socket: {}, sessionUser: { id: 1, name: "Compliance Test", role: "admin" }, ...request }, response);
  return response;
}

async function main() {
  const admin = await mysql.createConnection(connectionOptions);
  try {
    await admin.query(`CREATE DATABASE \`${databaseName}\``);
    const schemaConnection = await mysql.createConnection({ ...connectionOptions, database: databaseName, multipleStatements: true });
    const schema = fs.readFileSync(path.join(__dirname, "..", "db", "schema.sql"), "utf8");
    await schemaConnection.query(schema);
    await schemaConnection.end();

    process.env.DB_NAME = databaseName;
    const db = require("../db/connection");
    const maintenance = require("../controllers/maintenanceController");
    const compliance = require("../controllers/maintenanceComplianceController");
    await maintenance.initializeMaintenance();
    await compliance.ensureComplianceSchemaInternal();

    const [vehicleInsert] = await db.query(
      `INSERT INTO vehicles
        (registration_number,fleet_code,make,model_name,truck_type,status,company_name,inspection_frequency_weeks)
       VALUES ('CMP-TEST-1','CMP-1','Test','HGV','HGV','available','Compliance Test Operator',6)`
    );
    const assetId = vehicleInsert.insertId;
    const attachment = "data:application/pdf;base64,JVBERi0xLjQ=";
    const items = require("../utils/maintenanceComplianceRules").checklistFor("vehicle")
      .map((item) => ({ ...item, status: "pass", notes: "" }));

    let response = await invoke(compliance.createInspection, { body: {
      asset_id: `vehicle:${assetId}`,
      inspection_kind: "safety",
      inspection_date: "2026-07-25",
      operator_name: "Compliance Test Operator",
      provider_name: "Test Workshop",
      inspector_name: "Test Inspector",
      inspector_signature: "Test Inspector",
      odometer_km: 100000,
      brake_method: "laden_roller",
      brake_result: "pass",
      brake_reference: "RBT-TEST-1",
      roadworthy_declared: true,
      inspection_document: attachment,
      brake_document: attachment,
      items
    } });
    assert.strictEqual(response.statusCode, 201, JSON.stringify(response.body));
    const safetyInspectionId = response.body.id;

    response = await invoke(compliance.reviewInspection, {
      params: { id: safetyInspectionId },
      body: { action: "approve", qa_by: "Transport Manager", qa_signature: "Transport Manager", qa_notes: "Complete" }
    });
    assert.strictEqual(response.statusCode, 200, JSON.stringify(response.body));

    response = await invoke(compliance.createMotTest, { body: {
      asset_id: `vehicle:${assetId}`,
      test_date: "2026-07-25",
      result: "pass",
      certificate_number: "MOT-CMP-1",
      expiry_date: "2027-07-24",
      tester_name: "MOT Tester",
      provider_name: "MOT Centre",
      odometer_km: 100000,
      document: attachment
    } });
    assert.strictEqual(response.statusCode, 201, JSON.stringify(response.body));

    response = await invoke(compliance.updateInspectionFrequency, { body: {
      asset_id: `vehicle:${assetId}`, weeks: 6, source_name: "VOL",
      licence_reference: "OB-CMP-1", change_reason: "Initial verified frequency", effective_from: "2026-07-25"
    } });
    assert.strictEqual(response.statusCode, 200, JSON.stringify(response.body));

    response = await invoke(compliance.createProvider, { body: {
      provider_name: "Test Workshop", contract_reference: "CON-CMP-1", contract_start: "2026-01-01",
      vol_declared: true, last_quality_audit: "2026-01-01", next_quality_audit: "2027-01-01"
    } });
    assert.strictEqual(response.statusCode, 201, JSON.stringify(response.body));

    response = await invoke(compliance.createRecall, { body: {
      asset_id: `vehicle:${assetId}`, recall_reference: "REC-CMP-1", description: "Test safety recall",
      issued_date: "2026-07-01", due_date: "2026-07-30"
    } });
    assert.strictEqual(response.statusCode, 201, JSON.stringify(response.body));
    const recallId = response.body.id;
    response = await invoke(compliance.verifyRecall, { params: { id: recallId }, body: {
      action_details: "Recall component replaced", actioned_at: "2026-07-25", verified_by: "Recall QA",
      verifier_signature: "Recall QA", evidence: attachment
    } });
    assert.strictEqual(response.statusCode, 200, JSON.stringify(response.body));

    response = await invoke(compliance.createDailyCheck, { body: {
      asset_id: `vehicle:${assetId}`, check_date: "2026-07-25", driver_name: "Test Driver",
      result: "nil_defect", declaration: true, signature: "Test Driver"
    } });
    assert.strictEqual(response.statusCode, 201, JSON.stringify(response.body));

    response = await invoke(maintenance.setVorStatus, { body: {
      asset_id: `vehicle:${assetId}`, reason: "Planned repair", since: "2026-07-25", till: "2026-07-26"
    } });
    assert.strictEqual(response.statusCode, 200, JSON.stringify(response.body));
    response = await invoke(maintenance.setVorStatus, { body: { asset_id: `vehicle:${assetId}`, on_road: true } });
    assert.strictEqual(response.statusCode, 409, "VOR return must be blocked without approved return-to-service inspection");

    response = await invoke(compliance.createInspection, { body: {
      asset_id: `vehicle:${assetId}`,
      inspection_kind: "return_to_service",
      inspection_date: "2026-07-25",
      operator_name: "Compliance Test Operator",
      provider_name: "Test Workshop",
      inspector_name: "Test Inspector",
      inspector_signature: "Test Inspector",
      odometer_km: 100010,
      brake_method: "laden_roller",
      brake_result: "pass",
      brake_reference: "RBT-TEST-2",
      roadworthy_declared: true,
      inspection_document: attachment,
      brake_document: attachment,
      items
    } });
    assert.strictEqual(response.statusCode, 201, JSON.stringify(response.body));
    response = await invoke(compliance.reviewInspection, { params: { id: response.body.id }, body: {
      action: "approve", qa_by: "Transport Manager", qa_signature: "Transport Manager"
    } });
    assert.strictEqual(response.statusCode, 200, JSON.stringify(response.body));
    response = await invoke(maintenance.setVorStatus, { body: { asset_id: `vehicle:${assetId}`, on_road: true } });
    assert.strictEqual(response.statusCode, 200, JSON.stringify(response.body));

    response = await invoke(compliance.recordMissedInspection, { body: {
      asset_id: `vehicle:${assetId}`, due_date: "2026-07-20", reason: "Workshop cancellation",
      corrective_action: "Vehicle removed from service and inspection rebooked"
    } });
    assert.strictEqual(response.statusCode, 201, JSON.stringify(response.body));

    response = await invoke(compliance.getCompliancePortal);
    assert.strictEqual(response.statusCode, 200, JSON.stringify(response.body));
    assert(response.body.inspections.length >= 2, "portal should include completed test inspections");

    response = await invoke(compliance.getAuditPack, { params: { assetType: "vehicle", assetId } });
    assert.strictEqual(response.statusCode, 200, String(response.body));
    assert(String(response.body).includes("DVSA Maintenance Audit Pack"), "audit pack should be printable HTML");

    response = await invoke(compliance.getComplianceBackup);
    assert.strictEqual(response.statusCode, 200, String(response.body));
    const backup = JSON.parse(response.body);
    assert.strictEqual(backup.format, "astrafleet-dvsa-compliance-backup");
    assert(backup.sha256 && backup.data.compliance_inspections.length >= 2, "backup must include checksum and compliance data");

    const [[locked]] = await db.query(`SELECT locked_at FROM compliance_inspections WHERE id=?`, [safetyInspectionId]);
    assert(locked.locked_at, "approved inspection must be locked");
    const [[jobCount]] = await db.query(`SELECT COUNT(*) AS total FROM maintenance_jobs WHERE vehicle_id=? AND service_type='Safety inspection'`, [assetId]);
    assert(jobCount.total >= 2, "approved inspection should create completed history and next planned job");

    console.log("maintenance compliance integration test passed");
    await db.end();
  } finally {
    await admin.query(`DROP DATABASE IF EXISTS \`${databaseName}\``);
    await admin.end();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
