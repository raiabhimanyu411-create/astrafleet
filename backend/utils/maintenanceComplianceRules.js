const VEHICLE_INSPECTION_ITEMS = [
  ["registration", "Registration plate and vehicle identity"],
  ["cab_controls", "Cab controls, warning lamps and instruments"],
  ["mirrors_glass", "Mirrors, glass and visibility"],
  ["lights", "Lamps, reflectors and electrical equipment"],
  ["steering", "Steering system"],
  ["brakes", "Braking system and performance"],
  ["wheels_tyres", "Wheels, tyres and wheel security"],
  ["suspension", "Suspension"],
  ["axles", "Axles, hubs and bearings"],
  ["chassis", "Chassis, body and load security"],
  ["coupling", "Coupling equipment"],
  ["fuel_exhaust", "Fuel, exhaust and emissions"],
  ["speed_limiter", "Speed limiter where fitted"],
  ["tachograph", "Tachograph where fitted"],
  ["safety_equipment", "Safety equipment and markings"]
];

const TRAILER_INSPECTION_ITEMS = [
  ["identity", "Trailer identity and plating"],
  ["lights", "Lamps, reflectors and electrical connections"],
  ["brakes", "Braking system and performance"],
  ["wheels_tyres", "Wheels, tyres and wheel security"],
  ["suspension", "Suspension"],
  ["axles", "Axles, hubs and bearings"],
  ["chassis", "Chassis, body and load security"],
  ["coupling", "Coupling and landing legs"],
  ["safety_equipment", "Safety equipment and markings"]
];

const ITEM_STATUSES = new Set(["pass", "advisory", "fail", "not_applicable"]);
const INSPECTION_KINDS = new Set(["safety", "first_use", "return_to_service"]);
const BRAKE_METHODS = new Set(["laden_roller", "decelerometer_temperature", "ebpms"]);
const BRAKE_RESULTS = new Set(["pass", "fail"]);
const MOT_RESULTS = new Set(["pass", "fail"]);
const { ukDateKey } = require("./maintenanceDates");

function checklistFor(assetType) {
  return (assetType === "trailer" ? TRAILER_INSPECTION_ITEMS : VEHICLE_INSPECTION_ITEMS)
    .map(([key, label]) => ({ key, label }));
}

function cleanText(value) {
  return String(value || "").trim();
}

function isDataUrl(value) {
  return /^data:[^;,]+(?:;[^,]*)?,/i.test(cleanText(value));
}

function validDate(value) {
  const text = cleanText(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const date = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text;
}

function normalizeAsset(body = {}) {
  const encoded = cleanText(body.asset_id || body.assetId);
  const [encodedType, encodedId] = encoded.includes(":") ? encoded.split(":") : [body.asset_type || "vehicle", encoded];
  const assetType = encodedType === "trailer" ? "trailer" : "vehicle";
  const assetId = Number(encodedId || body.asset_id_numeric || 0);
  return { assetType, assetId };
}

function normalizeItems(assetType, items) {
  const received = new Map((Array.isArray(items) ? items : []).map((item) => [cleanText(item.key), item]));
  return checklistFor(assetType).map((definition) => {
    const item = received.get(definition.key) || {};
    return {
      ...definition,
      status: cleanText(item.status).toLowerCase(),
      notes: cleanText(item.notes),
      severity: cleanText(item.severity || "medium").toLowerCase()
    };
  });
}

function validateInspection(body = {}) {
  const errors = [];
  const { assetType, assetId } = normalizeAsset(body);
  const inspectionKind = cleanText(body.inspection_kind || body.inspectionKind || "safety");
  const inspectionDate = cleanText(body.inspection_date || body.inspectionDate);
  const inspectorName = cleanText(body.inspector_name || body.inspectorName);
  const inspectorSignature = cleanText(body.inspector_signature || body.inspectorSignature);
  const operatorName = cleanText(body.operator_name || body.operatorName);
  const providerName = cleanText(body.provider_name || body.providerName);
  const brakeMethod = cleanText(body.brake_method || body.brakeMethod);
  const brakeResult = cleanText(body.brake_result || body.brakeResult);
  const brakeReference = cleanText(body.brake_reference || body.brakeReference);
  const declaration = Boolean(body.roadworthy_declared ?? body.roadworthyDeclared);
  const inspectionDocument = body.inspection_document || body.inspectionDocument;
  const brakeDocument = body.brake_document || body.brakeDocument;
  const odometerKm = body.odometer_km === "" || body.odometerKm === "" ? null : Number(body.odometer_km ?? body.odometerKm);
  const items = normalizeItems(assetType, body.items);

  if (!assetId) errors.push("A valid vehicle or trailer is required.");
  if (!INSPECTION_KINDS.has(inspectionKind)) errors.push("Select a valid inspection type.");
  if (!validDate(inspectionDate)) errors.push("A valid inspection date is required.");
  if (validDate(inspectionDate) && inspectionDate > ukDateKey()) errors.push("Inspection date cannot be after today in the UK.");
  const scheduledDate = cleanText(body.scheduled_date || body.scheduledDate);
  if (scheduledDate && !validDate(scheduledDate)) errors.push("Scheduled date is invalid.");
  if (!operatorName) errors.push("Operator name is required.");
  if (!providerName) errors.push("Maintenance provider or workshop is required.");
  if (!inspectorName) errors.push("Inspector name is required.");
  if (inspectorSignature.length < 2) errors.push("Inspector signature is required.");
  if (assetType === "vehicle" && (!Number.isFinite(odometerKm) || odometerKm < 0)) errors.push("A valid odometer reading is required.");
  if (!BRAKE_METHODS.has(brakeMethod)) errors.push("A valid brake-performance assessment method is required.");
  if (!BRAKE_RESULTS.has(brakeResult)) errors.push("Brake-performance result is required.");
  if (!brakeReference) errors.push("Brake report or assessment reference is required.");
  if (!isDataUrl(inspectionDocument)) errors.push("The completed inspection sheet must be attached.");
  if (!isDataUrl(brakeDocument)) errors.push("The brake-performance report must be attached.");
  if (!declaration) errors.push("The inspector must sign the roadworthiness declaration.");

  items.forEach((item) => {
    if (!ITEM_STATUSES.has(item.status)) errors.push(`${item.label}: select a result.`);
    if (["advisory", "fail"].includes(item.status) && item.notes.length < 3) {
      errors.push(`${item.label}: describe the defect or advisory.`);
    }
  });

  const failedItems = items.filter((item) => item.status === "fail");
  const advisoryItems = items.filter((item) => item.status === "advisory");
  const overallResult = brakeResult === "fail" || failedItems.length > 0
    ? "fail"
    : advisoryItems.length > 0 ? "advisory" : "pass";

  return {
    ok: errors.length === 0,
    errors,
    value: {
      assetType,
      assetId,
      inspectionKind,
      inspectionDate,
      scheduledDate: scheduledDate || null,
      operatorName,
      providerName,
      inspectorName,
      inspectorSignature,
      odometerKm,
      brakeMethod,
      brakeResult,
      brakeReference,
      declaration,
      overallResult,
      notes: cleanText(body.notes),
      inspectionDocument,
      brakeDocument,
      wheelRetorqueDocument: body.wheel_retorque_document || body.wheelRetorqueDocument || null,
      items
    }
  };
}

function validateRepair(body = {}) {
  const errors = [];
  const repairDescription = cleanText(body.repair_description || body.repairDescription);
  const repairedBy = cleanText(body.repaired_by || body.repairedBy);
  const repairedAt = cleanText(body.repaired_at || body.repairedAt);
  const verifierName = cleanText(body.verifier_name || body.verifierName);
  const verifierSignature = cleanText(body.verifier_signature || body.verifierSignature);
  const repairDocument = body.repair_document || body.repairDocument;
  if (repairDescription.length < 3) errors.push("Repair details are required.");
  if (!repairedBy) errors.push("Repairer name is required.");
  if (!validDate(repairedAt)) errors.push("Repair date is required.");
  if (validDate(repairedAt) && repairedAt > ukDateKey()) errors.push("Repair date cannot be after today in the UK.");
  if (!verifierName) errors.push("Verifier name is required.");
  if (verifierSignature.length < 2) errors.push("Verifier signature is required.");
  if (repairedBy && verifierName && repairedBy.toLowerCase() === verifierName.toLowerCase()) {
    errors.push("Repairer and independent verifier must be different people.");
  }
  if (!isDataUrl(repairDocument)) errors.push("Repair evidence must be attached.");
  return {
    ok: errors.length === 0,
    errors,
    value: { repairDescription, repairedBy, repairedAt, verifierName, verifierSignature, repairDocument }
  };
}

function validateMot(body = {}) {
  const errors = [];
  const { assetType, assetId } = normalizeAsset(body);
  const testDate = cleanText(body.test_date || body.testDate);
  const result = cleanText(body.result).toLowerCase();
  const certificateNumber = cleanText(body.certificate_number || body.certificateNumber);
  const expiryDate = cleanText(body.expiry_date || body.expiryDate);
  const failureReason = cleanText(body.failure_reason || body.failureReason);
  const testerName = cleanText(body.tester_name || body.testerName);
  const providerName = cleanText(body.provider_name || body.providerName);
  const document = body.document;
  if (!assetId) errors.push("A valid vehicle or trailer is required.");
  if (!validDate(testDate)) errors.push("MOT test date is required.");
  if (validDate(testDate) && testDate > ukDateKey()) errors.push("MOT test date cannot be after today in the UK.");
  if (!MOT_RESULTS.has(result)) errors.push("MOT result must be pass or fail.");
  if (!testerName) errors.push("Tester name is required.");
  if (!providerName) errors.push("Test centre or provider is required.");
  if (result === "pass" && !certificateNumber) errors.push("MOT certificate number is required for a pass.");
  if (result === "pass" && !validDate(expiryDate)) errors.push("MOT expiry date is required for a pass.");
  if (result === "pass" && validDate(testDate) && validDate(expiryDate) && expiryDate <= testDate) errors.push("MOT expiry date must be after the test date.");
  if (result === "fail" && failureReason.length < 3) errors.push("MOT failure reasons are required.");
  if (!isDataUrl(document)) errors.push("MOT certificate or failure notice must be attached.");
  return {
    ok: errors.length === 0,
    errors,
    value: {
      assetType,
      assetId,
      testDate,
      result,
      certificateNumber: certificateNumber || null,
      expiryDate: expiryDate || null,
      failureReason: failureReason || null,
      testerName,
      providerName,
      odometerKm: body.odometer_km === "" ? null : Number(body.odometer_km ?? body.odometerKm ?? 0) || null,
      retestOf: Number(body.retest_of || body.retestOf || 0) || null,
      document
    }
  };
}

module.exports = {
  BRAKE_METHODS,
  INSPECTION_KINDS,
  ITEM_STATUSES,
  checklistFor,
  isDataUrl,
  normalizeAsset,
  validateInspection,
  validateMot,
  validateRepair,
  validDate
};
