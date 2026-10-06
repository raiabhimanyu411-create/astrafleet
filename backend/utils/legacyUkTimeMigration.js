// One-time conversion of maintenance timestamps that MySQL wrote with its own clock (NOW() / column
// defaults) before the backend switched every session to UK time. Those values are wall-clock times in
// the database server's old timezone (e.g. IST on a machine in India, UTC on most cloud servers) and are
// rewritten as UK wall-clock times (GMT/BST).
//
// Safety rules:
//   - Runs once, before the HTTP server accepts requests, so no new UK-time rows exist yet.
//   - A marker row in maintenance_data_migrations makes it run exactly once, even with several instances.
//   - Only columns that were ever written by the database clock are touched. Dates people type in
//     (service_date, due_date …), TIMESTAMP columns (MySQL converts those itself) and *_utc columns are not.
//   - If the old timezone cannot be identified with certainty nothing is changed. To convert in that case,
//     set LEGACY_DB_TIME_ZONE (an IANA name such as "Asia/Kolkata" or "UTC") BEFORE the first deploy of this
//     code; once it has started, the marker is recorded and it never converts later.
//   - Any error rolls everything back. The marker is still recorded so a later restart can never convert
//     rows that the new code already wrote in UK time.
const db = require("../db/connection");

const MIGRATION_KEY = "uk_time_legacy_maintenance_v1";
const UK_TIME_ZONE = "Europe/London";

// Maintenance tab columns written only by MySQL's clock before this change.
const LEGACY_COLUMNS = [
  ["maintenance_jobs", "completed_at"],
  ["maintenance_jobs", "bill_approved_at"],
  ["defect_reports", "reported_at"],
  ["defect_reports", "resolved_at"],
  ["vehicle_inspections", "submitted_at"],
  ["compliance_inspections", "created_at"],
  ["compliance_inspections", "updated_at"],
  ["compliance_inspections", "qa_at"],
  ["compliance_inspections", "locked_at"],
  ["compliance_inspection_items", "verified_at"],
  ["compliance_daily_checks", "created_at"],
  ["compliance_documents", "uploaded_at"],
  ["compliance_frequency_history", "created_at"],
  ["compliance_missed_inspections", "created_at"],
  ["compliance_mot_tests", "created_at"],
  ["compliance_providers", "created_at"],
  ["compliance_recalls", "created_at"],
  ["maintenance_document_archive", "archived_at"],
  ["maintenance_integrity_runs", "checked_at"]
];

const formatters = new Map();
function wallParts(zone, instantMs) {
  if (!formatters.has(zone)) {
    formatters.set(zone, new Intl.DateTimeFormat("en-GB", {
      timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
    }));
  }
  return Object.fromEntries(formatters.get(zone).formatToParts(new Date(instantMs)).map(part => [part.type, part.value]));
}

function offsetMs(zone, instantMs) {
  const p = wallParts(zone, instantMs);
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(instantMs / 1000) * 1000;
}

// "YYYY-MM-DD HH:MM:SS" in `fromZone` → the same instant as UK wall-clock text.
function convertWallTime(value, fromZone) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return null;
  const [, y, mo, d, h, mi, s = "00"] = match;
  const asUtc = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
  let instant = asUtc - offsetMs(fromZone, asUtc);
  instant = asUtc - offsetMs(fromZone, instant);
  const p = wallParts(UK_TIME_ZONE, instant);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

// Works out which timezone MySQL used for NOW() before sessions were switched to UK time.
async function detectLegacyZone() {
  const override = process.env.LEGACY_DB_TIME_ZONE;
  if (override) {
    try {
      new Intl.DateTimeFormat("en-GB", { timeZone: override });
      return { zone: override, how: "LEGACY_DB_TIME_ZONE" };
    } catch {
      return { error: `LEGACY_DB_TIME_ZONE "${override}" is not a valid IANA timezone.` };
    }
  }
  const conn = await db.getConnection();
  try {
    await conn.query("SET time_zone = @@global.time_zone");
    const [[row]] = await conn.query(
      "SELECT @@global.time_zone AS global_zone, @@system_time_zone AS system_zone, TIMESTAMPDIFF(MINUTE, UTC_TIMESTAMP(), NOW()) AS offset_min"
    );
    const globalZone = String(row.global_zone || "");
    const systemZone = String(row.system_zone || "").toUpperCase();
    const offset = Number(row.offset_min);
    const label = `${globalZone === "SYSTEM" ? systemZone : globalZone} (UTC${offset >= 0 ? "+" : ""}${offset / 60}h)`;
    const ukOffsetNow = Math.round(offsetMs(UK_TIME_ZONE, Date.now()) / 60000);

    if (globalZone !== "SYSTEM") {
      if (/^[+-]00:00$/.test(globalZone) || globalZone.toUpperCase() === "UTC") return { zone: "UTC", how: label };
      if (/^[A-Za-z_]+\/[A-Za-z_]+$/.test(globalZone)) return { zone: globalZone, how: label };
      return { error: `MySQL global time_zone is ${globalZone}; set LEGACY_DB_TIME_ZONE before deploying to convert.` };
    }
    if (offset === 330) return { zone: "Asia/Kolkata", how: label };
    if (["UTC", "GMT0", "UCT"].includes(systemZone) && offset === 0) return { zone: "UTC", how: label };
    // GMT/BST (or Irish time, whose clock matches the UK) means old values are already UK time.
    if (["GMT", "BST", "WET", "WEST", "IST"].includes(systemZone) && offset === ukOffsetNow) return { zone: UK_TIME_ZONE, how: label };
    return { error: `MySQL server timezone ${label} is not recognised; set LEGACY_DB_TIME_ZONE before deploying to convert.` };
  } finally {
    conn.destroy(); // its session timezone was changed; never hand it back to the pool
  }
}

async function existingColumns(conn) {
  const [rows] = await conn.query(
    `SELECT TABLE_NAME AS t, COLUMN_NAME AS c, DATA_TYPE AS d, EXTRA AS extra
     FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()`
  );
  return rows;
}

// Returns a per-column summary. With dryRun nothing is written and no marker is recorded.
async function runLegacyUkTimeMigration({ dryRun = false, log = console } = {}) {
  await db.query(`CREATE TABLE IF NOT EXISTS maintenance_data_migrations (
    migration_key VARCHAR(100) PRIMARY KEY,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB`);
  const [[done]] = await db.query("SELECT applied_at FROM maintenance_data_migrations WHERE migration_key=?", [MIGRATION_KEY]);
  if (done) return { status: "already_applied", appliedAt: done.applied_at };

  const legacy = await detectLegacyZone();
  if (legacy.error) {
    log.warn(`[UK time] Old maintenance times not converted (left as they were): ${legacy.error}`);
    if (!dryRun) await db.query("INSERT IGNORE INTO maintenance_data_migrations (migration_key) VALUES (?)", [MIGRATION_KEY]);
    return { status: "skipped", reason: legacy.error };
  }
  if (legacy.zone === UK_TIME_ZONE) {
    if (!dryRun) await db.query("INSERT IGNORE INTO maintenance_data_migrations (migration_key) VALUES (?)", [MIGRATION_KEY]);
    return { status: "not_needed", from: legacy.how };
  }

  const conn = await db.getConnection();
  const summary = [];
  try {
    await conn.beginTransaction();
    if (!dryRun) {
      const [claim] = await conn.query("INSERT IGNORE INTO maintenance_data_migrations (migration_key) VALUES (?)", [MIGRATION_KEY]);
      if (!claim.affectedRows) {
        await conn.rollback();
        return { status: "already_applied" };
      }
    }
    const columns = await existingColumns(conn);
    for (const [table, column] of LEGACY_COLUMNS) {
      const info = columns.find(row => row.t === table && row.c === column);
      if (!info || info.d !== "datetime") continue;
      // Columns with ON UPDATE CURRENT_TIMESTAMP must be pinned or this fix would stamp "now" on them.
      const pinned = columns.filter(row => row.t === table && /on update/i.test(row.extra || "") && row.c !== column).map(row => row.c);
      const [rows] = await conn.query(`SELECT id, \`${column}\` AS value FROM \`${table}\` WHERE \`${column}\` IS NOT NULL`);
      let changed = 0;
      let sample = null;
      for (const row of rows) {
        const next = convertWallTime(row.value, legacy.zone);
        if (!next || next === String(row.value).slice(0, 19)) continue;
        changed += 1;
        sample ||= { id: row.id, before: String(row.value).slice(0, 19), after: next };
        if (!dryRun) {
          const pin = pinned.map(name => `, \`${name}\`=\`${name}\``).join("");
          await conn.query(`UPDATE \`${table}\` SET \`${column}\`=?${pin} WHERE id=?`, [next, row.id]);
        }
      }
      summary.push({ column: `${table}.${column}`, rows: rows.length, changed, sample });
    }
    if (dryRun) await conn.rollback();
    else await conn.commit();
    return { status: dryRun ? "dry_run" : "applied", from: legacy.how, zone: legacy.zone, summary };
  } catch (error) {
    await conn.rollback();
    // Keep the marker so a later restart never re-reads UK-time rows as old-timezone rows.
    if (!dryRun) await db.query("INSERT IGNORE INTO maintenance_data_migrations (migration_key) VALUES (?)", [MIGRATION_KEY]).catch(() => {});
    log.error(`[UK time] Conversion failed and was rolled back; old maintenance times left unchanged: ${error.message}`);
    return { status: "failed", error: error.message };
  } finally {
    conn.release();
  }
}

module.exports = { LEGACY_COLUMNS, MIGRATION_KEY, convertWallTime, runLegacyUkTimeMigration };
