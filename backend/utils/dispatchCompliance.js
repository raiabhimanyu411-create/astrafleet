// Can this truck / trailer / driver legally go out on a job? ONE rule set used by every place that puts
// an asset or driver on a job (Jobs, Dispatch, replace truck, job start), by the pick-lists, by the
// Vehicles / Drivers / Maintenance / Overview counts and by the Dispatch "Issue" column — so every page
// shows the same answer and a page can never offer something the server will refuse.
//
// Truck / trailer blocks: off road (VOR), MOT / insurance / road tax expired OR not recorded, safety
// inspection (PMI) overdue, open high or critical defect.
// Driver blocks: compliance blocked or archived (hard); compliance under review, onboarding not finished,
// licence / D4 medical / driver CPC / tacho card expired or not recorded, DVLA licence check overdue or
// not recorded, 12+ penalty points.
// "Not recorded" is treated as blocked, never as safe (the old 2099-12-31 placeholder counts as not recorded).
// An admin may override the soft blocks by giving a written reason (logged); never VOR / blocked driver.
// Dates are compared on the DB clock, which runs on UK time (see db/connection.js).

const { logActivity } = require("./auditLogger");

const PMI_TYPES = `('Safety inspection','6-week safety inspection','10-week safety inspection')`;
const OPEN_JOB = `('planned','booked','in_progress')`;

// Due dates are the Monday of the due week, so an inspection only counts as overdue once that week has ended.
const INSPECTION_OVERDUE = `DATE_ADD(inspection_due, INTERVAL 6 DAY) < CURDATE()`;

// Wraps an asset query with the expired / overdue flags, worked out the same way for trucks and trailers.
const withFlags = (inner) => `
  SELECT x.*,
    (mot_due IS NOT NULL AND mot_due < CURDATE()) AS mot_expired,
    (insurance_due IS NOT NULL AND insurance_due < CURDATE()) AS insurance_expired,
    (road_tax_due IS NOT NULL AND road_tax_due < CURDATE()) AS road_tax_expired,
    (inspection_due IS NOT NULL AND ${INSPECTION_OVERDUE}) AS inspection_overdue,
    (mot_due IS NULL) AS mot_missing,
    (insurance_due IS NULL) AS insurance_missing,
    (road_tax_due IS NULL) AS road_tax_missing
  FROM (${inner}) x`;

const VEHICLE_SQL = withFlags(`
    SELECT v.id, v.registration_number, v.status,
      COALESCE((SELECT MAX(r.next_due_date) FROM maintenance_records r WHERE r.vehicle_id=v.id AND LOWER(r.service_type)='mot'), v.mot_expiry) AS mot_due,
      COALESCE((SELECT MAX(r.next_due_date) FROM maintenance_records r WHERE r.vehicle_id=v.id AND LOWER(r.service_type)='insurance'), v.insurance_expiry) AS insurance_due,
      COALESCE((SELECT MAX(r.next_due_date) FROM maintenance_records r WHERE r.vehicle_id=v.id AND LOWER(r.service_type) IN ('road tax','road_tax')), v.road_tax_expiry) AS road_tax_due,
      COALESCE(
        (SELECT MIN(j.due_date) FROM maintenance_jobs j
          WHERE j.vehicle_id=v.id AND j.trailer_id IS NULL AND j.service_type IN ${PMI_TYPES} AND j.status IN ${OPEN_JOB}),
        (SELECT ADDDATE(DATE_SUB(MAX(j.service_date), INTERVAL WEEKDAY(MAX(j.service_date)) DAY),
                        (GREATEST(COALESCE(v.inspection_frequency_weeks, 6), 2) - 1) * 7)
           FROM maintenance_jobs j
          WHERE j.vehicle_id=v.id AND j.trailer_id IS NULL AND j.service_type IN ${PMI_TYPES}
            AND j.status='completed' AND j.service_date IS NOT NULL)
      ) AS inspection_due,
      (SELECT COUNT(*) FROM defect_reports d
        WHERE d.vehicle_id=v.id AND d.status <> 'resolved' AND d.severity IN ('high','critical')) AS serious_defects
    FROM vehicles v
    WHERE v.id IN (?)`);

const TRAILER_SQL = withFlags(`
    SELECT t.id, COALESCE(t.registration_number, t.trailer_code) AS registration_number, t.status,
      NULL AS road_tax_due, 1 AS no_road_tax,
      COALESCE((SELECT MAX(r.next_due_date) FROM trailer_maintenance_records r WHERE r.trailer_id=t.id AND LOWER(r.service_type)='mot'), t.mot_expiry) AS mot_due,
      t.insurance_expiry AS insurance_due,
      COALESCE(
        (SELECT MIN(j.due_date) FROM maintenance_jobs j
          WHERE j.trailer_id=t.id AND j.service_type IN ${PMI_TYPES} AND j.status IN ${OPEN_JOB}),
        t.next_inspection_due,
        (SELECT ADDDATE(DATE_SUB(MAX(j.service_date), INTERVAL WEEKDAY(MAX(j.service_date)) DAY),
                        (GREATEST(COALESCE(t.inspection_frequency_weeks, 10), 2) - 1) * 7)
           FROM maintenance_jobs j
          WHERE j.trailer_id=t.id AND j.service_type IN ${PMI_TYPES}
            AND j.status='completed' AND j.service_date IS NOT NULL)
      ) AS inspection_due,
      (SELECT COUNT(*) FROM defect_reports d
        WHERE d.trailer_id=t.id AND d.status <> 'resolved' AND d.severity IN ('high','critical')) AS serious_defects
    FROM trailers t
    WHERE t.id IN (?)`);

function blockersFor(row, type) {
  const vorStatuses = type === "trailer" ? ["maintenance"] : ["maintenance", "stopped"];
  const hard = vorStatuses.includes(row.status) ? ["Off road (VOR)"] : [];
  const soft = [];
  if (Number(row.mot_expired)) soft.push(type === "trailer" ? "Annual test (MOT) expired" : "MOT expired");
  else if (Number(row.mot_missing)) soft.push(type === "trailer" ? "Annual test (MOT) not recorded" : "MOT not recorded");
  if (Number(row.insurance_expired)) soft.push("Insurance expired");
  // Trailers are usually covered by the truck's policy, so a trailer without its own date is not blocked.
  else if (Number(row.insurance_missing) && type !== "trailer") soft.push("Insurance not recorded");
  if (Number(row.road_tax_expired)) soft.push("Road tax expired");
  else if (Number(row.road_tax_missing) && !Number(row.no_road_tax)) soft.push("Road tax not recorded");
  if (Number(row.inspection_overdue)) soft.push("Safety inspection overdue");
  if (Number(row.serious_defects)) soft.push(`${row.serious_defects} open high/critical defect${Number(row.serious_defects) === 1 ? "" : "s"}`);
  return { hard, soft, all: [...hard, ...soft] };
}

// The approved override stays on the job, so the driver can still start it later.
async function recordOverride(conn, jobId, reason) {
  try {
    await conn.query("UPDATE trips SET compliance_override_reason=?, compliance_override_at=NOW() WHERE id=?", [reason, jobId]);
  } catch (error) {
    if (error.code !== "ER_BAD_FIELD_ERROR") throw error;
  }
}

// Map of id -> { hard, soft, all } for the given ids (only assets with at least one blocker are included).
async function assetBlockers(conn, type, ids) {
  const list = [...new Set((ids || []).map(Number).filter(Boolean))];
  if (!list.length) return new Map();
  const [rows] = await conn.query(type === "trailer" ? TRAILER_SQL : VEHICLE_SQL, [list]);
  const result = new Map();
  for (const row of rows) {
    const blockers = blockersFor(row, type);
    if (blockers.all.length) {
      result.set(Number(row.id), {
        ...blockers,
        registration: row.registration_number,
        inspectionDue: Number(row.inspection_overdue) ? String(row.inspection_due).slice(0, 10) : null
      });
    }
  }
  return result;
}

// Adds `dispatch_blockers` (array of reasons, empty when clear) to pick-list rows.
async function annotateDispatchBlockers(conn, type, rows) {
  const blockers = await assetBlockers(conn, type, rows.map(row => row.id));
  return rows.map(row => ({ ...row, dispatch_blockers: blockers.get(Number(row.id))?.all || [] }));
}

// Checks the truck / trailer about to be put on a job. Returns null when allowed, otherwise
// { status, body } for the caller to send. A written override reason lets the soft blockers through.
async function checkAssetsDispatchable(conn, req, { vehicleId, trailerId, driverId = null, jobId = null, allowOverride = true }) {
  const overrideReason = allowOverride ? String(req.body?.compliance_override_reason || "").trim() : "";
  const found = [];
  for (const [type, id] of [["vehicle", vehicleId], ["trailer", trailerId]]) {
    if (!id) continue;
    const blockers = (await assetBlockers(conn, type, [id])).get(Number(id));
    if (blockers) found.push({ type, id: Number(id), ...blockers });
  }
  if (driverId) {
    const blockers = (await driverBlockers(conn, [driverId])).get(Number(driverId));
    if (blockers) found.push({ type: "driver", id: Number(driverId), ...blockers });
  }
  if (!found.length) return null;

  const hard = found.filter(item => item.hard.length);
  if (hard.length) {
    const driver = hard.find(item => item.type === "driver");
    return {
      status: 409,
      body: {
        code: driver ? "DRIVER_BLOCKED" : "ASSET_OFF_ROAD",
        message: driver
          ? `${driver.name}: ${driver.hard.join(", ")}. Choose another driver.`
          : `${hard.map(item => item.registration).join(", ")} is off road (VOR). Return it to the road in Maintenance before using it on a job.`
      }
    };
  }

  const summary = found.map(item => `${item.registration}: ${item.soft.join(", ")}`).join("; ");
  if (!allowOverride) {
    return { status: 409, body: { code: "COMPLIANCE_BLOCKED", message: `Do not dispatch. ${summary}. Ask the office to fix the records or approve an override.` } };
  }
  if (overrideReason.length < 5) {
    return {
      status: 409,
      body: {
        code: "COMPLIANCE_BLOCKED",
        message: `Do not dispatch. ${summary}. An admin override needs a written reason.`,
        blockers: found.map(item => ({ type: item.type, id: item.id, registration: item.registration, reasons: item.soft }))
      }
    };
  }

  await logActivity(req, {
    module: "jobs",
    action: "compliance_override",
    entityType: "job",
    entityId: jobId,
    reason: overrideReason,
    reasonCategory: "compliance_issue",
    details: { blockers: summary, vehicle_id: vehicleId || null, trailer_id: trailerId || null, driver_id: driverId || null }
  });
  if (jobId) await recordOverride(conn, jobId, overrideReason);
  return null;
}

// ── Drivers ────────────────────────────────────────────────────────────────────────────────────
// Dates at or after this are the old "not recorded" placeholder (2099-12-31), not real expiries.
const PLACEHOLDER_DATE = "2090-01-01";
// DVLA licence check: most UK operators check every 6 months (more often for higher-risk drivers).
const DVLA_CHECK_MONTHS = 6;

const DRIVER_SQL = `
  SELECT d.id, d.full_name, d.employee_code, d.compliance_status, d.onboarding_status, d.archived_at,
         d.date_of_birth, d.penalty_points, d.dvla_check_date,
         CASE WHEN d.license_expiry >= '${PLACEHOLDER_DATE}' THEN NULL ELSE d.license_expiry END AS license_expiry,
         CASE WHEN d.medical_expiry >= '${PLACEHOLDER_DATE}' THEN NULL ELSE d.medical_expiry END AS medical_expiry,
         CASE WHEN d.cpc_expiry >= '${PLACEHOLDER_DATE}' THEN NULL ELSE d.cpc_expiry END AS cpc_expiry,
         CASE WHEN d.tacho_card_expiry >= '${PLACEHOLDER_DATE}' THEN NULL ELSE d.tacho_card_expiry END AS tacho_card_expiry,
         DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS today
  FROM drivers d
  WHERE d.id IN (?)`;

const dateKey = value => (value ? String(value).slice(0, 10) : null);

function addYears(key, years) {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(Date.UTC(y + years, m - 1, d));
  return date.toISOString().slice(0, 10);
}

function addMonths(key, months) {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1 + months, d));
  return date.toISOString().slice(0, 10);
}

function ageOn(dobKey, todayKey) {
  if (!dobKey) return null;
  const [by, bm, bd] = dobKey.split("-").map(Number);
  const [ty, tm, td] = todayKey.split("-").map(Number);
  return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
}

// Latest date a D4 medical can legally run to from today: every 5 years from 45, every year from 65.
// Under 45 the vocational licence (and its medical) runs to the 45th birthday.
function maxMedicalExpiry(dobKey, todayKey) {
  const age = ageOn(dobKey, todayKey);
  if (age === null) return addYears(todayKey, 5);
  if (age >= 65) return addYears(todayKey, 1);
  if (age >= 45) return addYears(todayKey, 5);
  const fortyFifth = addYears(dobKey, 45);
  return fortyFifth > addYears(todayKey, 5) ? fortyFifth : addYears(todayKey, 5);
}

function driverBlockersFor(row) {
  const hard = [];
  const soft = [];
  if (row.archived_at) hard.push("Driver archived");
  if (row.compliance_status === "blocked") hard.push("Driver compliance blocked");
  if (row.compliance_status === "review") soft.push("Compliance under review");
  if (["new", "docs_pending"].includes(row.onboarding_status)) soft.push("Onboarding not complete");

  const today = row.today;
  const five = addYears(today, 5);
  const docs = [
    ["Driving licence", dateKey(row.license_expiry), null],
    ["D4 medical", dateKey(row.medical_expiry), maxMedicalExpiry(dateKey(row.date_of_birth), today)],
    ["Driver CPC", dateKey(row.cpc_expiry), five],
    ["Tacho card", dateKey(row.tacho_card_expiry), five]
  ];
  for (const [label, date, maxDate] of docs) {
    if (!date) soft.push(`${label} expiry not recorded`);
    else if (date < today) soft.push(`${label} expired`);
    else if (maxDate && date > maxDate) soft.push(`${label} expiry ${date} is beyond the legal renewal interval — check the date`);
  }

  const check = dateKey(row.dvla_check_date);
  if (!check) soft.push("DVLA licence check not recorded");
  else if (addMonths(check, DVLA_CHECK_MONTHS) < today) soft.push(`DVLA licence check overdue (last ${check})`);
  if (Number(row.penalty_points) >= 12) soft.push(`${row.penalty_points} penalty points — check for disqualification`);
  return { hard, soft, all: [...hard, ...soft] };
}

// Map of id -> { hard, soft, all, name } for drivers with at least one blocker.
async function driverBlockers(conn, ids) {
  const list = [...new Set((ids || []).map(Number).filter(Boolean))];
  if (!list.length) return new Map();
  const [rows] = await conn.query(DRIVER_SQL, [list]);
  const result = new Map();
  for (const row of rows) {
    const blockers = driverBlockersFor(row);
    if (blockers.all.length) result.set(Number(row.id), { ...blockers, registration: row.full_name, name: row.full_name });
  }
  return result;
}

async function annotateDriverBlockers(conn, rows) {
  const blockers = await driverBlockers(conn, rows.map(row => row.id));
  return rows.map(row => ({ ...row, dispatch_blockers: blockers.get(Number(row.id))?.all || [] }));
}

// Compliance problems on jobs that already have a truck / trailer / driver. Used by the Dispatch
// "Issue" column, alerts, and the job-start check. jobs: [{ id, vehicle_id, trailer_id, driver_id }]
// → Map jobId -> [reason, ...] (only jobs with problems).
async function jobComplianceIssues(conn, jobs) {
  const pick = key => jobs.map(job => job[key]).filter(Boolean);
  const [vehicles, trailers, drivers] = await Promise.all([
    assetBlockers(conn, "vehicle", pick("vehicle_id")),
    assetBlockers(conn, "trailer", pick("trailer_id")),
    driverBlockers(conn, pick("driver_id"))
  ]);
  const result = new Map();
  for (const job of jobs) {
    const issues = [];
    const add = (map, id, prefix) => {
      const item = id && map.get(Number(id));
      if (item) issues.push(...item.all.map(reason => `${prefix}${item.registration}: ${reason}`));
    };
    add(vehicles, job.vehicle_id, "");
    add(trailers, job.trailer_id, "Trailer ");
    add(drivers, job.driver_id, "Driver ");
    if (issues.length) result.set(Number(job.id), issues);
  }
  return result;
}

// Every truck / trailer whose safety inspection is overdue: [{ assetType, assetId, registration, dueDate }].
async function overdueInspections(conn) {
  const list = [];
  for (const [type, table] of [["vehicle", "vehicles"], ["trailer", "trailers"]]) {
    const [rows] = await conn.query(`SELECT id FROM ${table}`);
    const blockers = await assetBlockers(conn, type, rows.map(row => row.id));
    for (const [id, item] of blockers) {
      if (item.inspectionDue) list.push({ assetType: type, assetId: id, registration: item.registration, dueDate: item.inspectionDue });
    }
  }
  return list.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

// Re-checked when a job starts (loading / in transit), because a document can expire after the job was
// assigned. An override the admin already approved for this job (trips.compliance_override_reason) lets
// the soft blocks through; VOR trucks and blocked drivers never start. Drivers cannot override.
async function checkJobStartable(conn, req, jobId, { allowOverride = true } = {}) {
  let job;
  try {
    [[job]] = await conn.query("SELECT id, vehicle_id, trailer_id, driver_id, compliance_override_reason FROM trips WHERE id=?", [jobId]);
  } catch (error) {
    if (error.code !== "ER_BAD_FIELD_ERROR") throw error;
    [[job]] = await conn.query("SELECT id, vehicle_id, trailer_id, driver_id FROM trips WHERE id=?", [jobId]);
  }
  if (!job) return null;
  const ids = { vehicleId: job.vehicle_id, trailerId: job.trailer_id, driverId: job.driver_id, jobId: job.id };
  if (job.compliance_override_reason) {
    const result = await checkAssetsDispatchable(conn, { ...req, body: { compliance_override_reason: job.compliance_override_reason } }, { ...ids, jobId: null });
    return result && ["ASSET_OFF_ROAD", "DRIVER_BLOCKED"].includes(result.body.code) ? result : null;
  }
  return checkAssetsDispatchable(conn, req, { ...ids, allowOverride });
}

// Truck ids that are not road-legal right now (VOR or any blocker). Used by fleet counts on every page.
async function notRoadLegalVehicleIds(conn) {
  const [rows] = await conn.query("SELECT id FROM vehicles");
  return new Set((await assetBlockers(conn, "vehicle", rows.map(row => row.id))).keys());
}

module.exports = {
  assetBlockers, annotateDispatchBlockers, checkAssetsDispatchable, overdueInspections,
  driverBlockers, annotateDriverBlockers, jobComplianceIssues, notRoadLegalVehicleIds, recordOverride, checkJobStartable,
  __test: { driverBlockersFor, maxMedicalExpiry, blockersFor }
};
