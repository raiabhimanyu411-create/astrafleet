const assert = require("assert");
const {
  checklistFor,
  normalizeAsset,
  validateInspection,
  validateMot,
  validateRepair
} = require("../utils/maintenanceComplianceRules");

const tinyPdf = "data:application/pdf;base64,JVBERi0xLjQ=";

assert.deepStrictEqual(normalizeAsset({ asset_id: "trailer:42" }), { assetType: "trailer", assetId: 42 });
assert(checklistFor("vehicle").length >= 15, "vehicle checklist should cover the principal inspection systems");
assert(checklistFor("trailer").some((item) => item.key === "brakes"), "trailer checklist must include brakes");

const vehicleItems = checklistFor("vehicle").map((item) => ({ ...item, status: "pass", notes: "" }));
const validInspection = validateInspection({
  asset_id: "vehicle:1",
  inspection_kind: "safety",
  inspection_date: "2026-07-25",
  operator_name: "Astra Fleet Ltd",
  provider_name: "Approved Workshop",
  inspector_name: "Inspector One",
  inspector_signature: "Inspector One",
  odometer_km: 120000,
  brake_method: "laden_roller",
  brake_result: "pass",
  brake_reference: "RBT-100",
  roadworthy_declared: true,
  inspection_document: tinyPdf,
  brake_document: tinyPdf,
  items: vehicleItems
});
assert.strictEqual(validInspection.ok, true, validInspection.errors.join(" "));
assert.strictEqual(validInspection.value.overallResult, "pass");

const missingEvidence = validateInspection({ ...validInspection.value, asset_id: "vehicle:1", inspection_document: "", brake_document: "" });
assert.strictEqual(missingEvidence.ok, false, "inspection without evidence must fail validation");

const failedItems = vehicleItems.map((item) => item.key === "brakes" ? { ...item, status: "fail", notes: "Service brake below required performance", severity: "critical" } : item);
const failedInspection = validateInspection({
  ...validInspection.value,
  asset_id: "vehicle:1",
  roadworthy_declared: true,
  inspection_document: tinyPdf,
  brake_document: tinyPdf,
  brake_result: "fail",
  items: failedItems
});
assert.strictEqual(failedInspection.ok, true, failedInspection.errors.join(" "));
assert.strictEqual(failedInspection.value.overallResult, "fail");

assert.strictEqual(validateRepair({
  repair_description: "Brake chamber replaced and system retested",
  repaired_by: "Workshop Tech",
  repaired_at: "2026-07-25",
  verifier_name: "Independent QA",
  verifier_signature: "Independent QA",
  repair_document: tinyPdf
}).ok, true);

assert.strictEqual(validateMot({
  asset_id: "vehicle:1",
  test_date: "2026-07-25",
  result: "pass",
  certificate_number: "MOT-100",
  expiry_date: "2027-07-24",
  tester_name: "Tester",
  provider_name: "Test Centre",
  document: tinyPdf
}).ok, true);

assert.strictEqual(validateMot({
  asset_id: "vehicle:1",
  test_date: "2026-07-25",
  result: "fail",
  tester_name: "Tester",
  provider_name: "Test Centre",
  document: tinyPdf
}).ok, false, "failed MOT must have failure reasons");

console.log("maintenance compliance smoke tests passed");
