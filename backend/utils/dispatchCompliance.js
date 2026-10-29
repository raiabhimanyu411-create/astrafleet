// Can this truck / trailer legally go out on a job? One rule set used by every place that puts an asset
// on a job (Jobs, Dispatch, replace truck) and by the pick-lists, so a page can never offer an asset the
// server will refuse.
//
// Blocks: off road (VOR), MOT / insurance / road tax expired, safety inspection overdue, open high or
// critical defect. An admin may override everything except VOR by giving a written reason (logged).
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
    (inspection_due IS NOT NULL AND ${INSPECTION_OVERDUE}) AS inspection_overdue
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
      NULL AS road_tax_due,
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
  if (Number(row.insurance_expired)) soft.push("Insurance expired");
  if (Number(row.road_tax_expired)) soft.push("Road tax expired");
  if (Number(row.inspection_overdue)) soft.push("Safety inspection overdue");
  if (Number(row.serious_defects)) soft.push(`${row.serious_defects} open high/critical defect${Number(row.serious_defects) === 1 ? "" : "s"}`);
  return { hard, soft, all: [...hard, ...soft] };
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
async function checkAssetsDispatchable(conn, req, { vehicleId, trailerId, jobId = null }) {
  const overrideReason = String(req.body?.compliance_override_reason || "").trim();
  const found = [];
  for (const [type, id] of [["vehicle", vehicleId], ["trailer", trailerId]]) {
    if (!id) continue;
    const blockers = (await assetBlockers(conn, type, [id])).get(Number(id));
    if (blockers) found.push({ type, id: Number(id), ...blockers });
  }
  if (!found.length) return null;

  const hard = found.filter(item => item.hard.length);
  if (hard.length) {
    return {
      status: 409,
      body: {
        code: "ASSET_OFF_ROAD",
        message: `${hard.map(item => item.registration).join(", ")} is off road (VOR). Return it to the road in Maintenance before using it on a job.`
      }
    };
  }

  const summary = found.map(item => `${item.registration}: ${item.soft.join(", ")}`).join("; ");
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
    details: { blockers: summary, vehicle_id: vehicleId || null, trailer_id: trailerId || null }
  });
  return null;
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

module.exports = { assetBlockers, annotateDispatchBlockers, checkAssetsDispatchable, overdueInspections };
