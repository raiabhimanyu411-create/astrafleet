const db = require("../db/connection");
const crypto = require("crypto");
const { emitAdminAuditEvent } = require("../realtime");

let schemaReady = false;
let sessionSchemaReady = false;

const reasonCategories = new Set([
  "duplicate",
  "client_request",
  "incorrect_amount",
  "wrong_assignment",
  "compliance_issue",
  "data_correction",
  "other"
]);

async function addColumnIfMissing(table, column, definition) {
  const [rows] = await db.query(`SHOW COLUMNS FROM ${table} LIKE ?`, [column]);
  if (rows.length === 0) {
    try {
      await db.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    } catch (error) {
      if (error.code !== "ER_DUP_FIELDNAME") throw error;
    }
  }
}

async function ensureActivitySchema() {
  if (schemaReady) return;
  await db.query(
    `CREATE TABLE IF NOT EXISTS activity_logs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      actor_user_id INT DEFAULT NULL,
      actor_name VARCHAR(120) DEFAULT NULL,
      actor_role VARCHAR(40) DEFAULT NULL,
      module_key VARCHAR(60) NOT NULL,
      action_key VARCHAR(60) NOT NULL,
      entity_type VARCHAR(80) DEFAULT NULL,
      entity_id VARCHAR(80) DEFAULT NULL,
      entity_label VARCHAR(180) DEFAULT NULL,
      reason TEXT DEFAULT NULL,
      reason_category VARCHAR(60) DEFAULT NULL,
      details JSON DEFAULT NULL,
      previous_hash CHAR(64) DEFAULT NULL,
      entry_hash CHAR(64) DEFAULT NULL,
      ip_address VARCHAR(80) DEFAULT NULL,
      user_agent VARCHAR(255) DEFAULT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_activity_created_at (created_at),
      INDEX idx_activity_actor (actor_user_id),
      INDEX idx_activity_module (module_key, action_key)
    ) ENGINE=InnoDB`
  );
  await addColumnIfMissing("activity_logs", "reason", "TEXT DEFAULT NULL");
  await addColumnIfMissing("activity_logs", "reason_category", "VARCHAR(60) DEFAULT NULL");
  await addColumnIfMissing("activity_logs", "details", "JSON DEFAULT NULL");
  await addColumnIfMissing("activity_logs", "previous_hash", "CHAR(64) DEFAULT NULL");
  await addColumnIfMissing("activity_logs", "entry_hash", "CHAR(64) DEFAULT NULL");
  schemaReady = true;
}

async function ensureSessionSchema() {
  if (sessionSchemaReady) return;
  await db.query(
    `CREATE TABLE IF NOT EXISTS user_sessions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      session_token_hash CHAR(64) NOT NULL,
      role VARCHAR(40) DEFAULT NULL,
      login_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      logout_at DATETIME DEFAULT NULL,
      last_activity_at DATETIME DEFAULT NULL,
      ip_address VARCHAR(80) DEFAULT NULL,
      user_agent VARCHAR(255) DEFAULT NULL,
      INDEX idx_sessions_user (user_id),
      INDEX idx_sessions_token (session_token_hash)
    ) ENGINE=InnoDB`
  );
  sessionSchemaReady = true;
}

function readActorFromHeaders(req) {
  const id = Number(req.headers["x-session-user-id"] || 0) || null;
  const role = req.headers["x-session-role"] || null;
  return { id, role };
}

async function getActor(req) {
  const actor = readActorFromHeaders(req);
  if (!actor.id) return { id: null, name: "System", role: actor.role || "system" };

  try {
    const [[user]] = await db.query("SELECT id, name, role FROM users WHERE id = ?", [actor.id]);
    if (user) return { id: user.id, name: user.name, role: user.role };
  } catch {
    // Logging must not break the user action.
  }

  return { id: actor.id, name: "Unknown user", role: actor.role || "unknown" };
}

function publicActivityPayload(row) {
  return {
    id: row.id,
    actorName: row.actor_name || "System",
    actorRole: row.actor_role || "system",
    module: row.module_key,
    action: row.action_key,
    entityType: row.entity_type,
    entityId: row.entity_id,
    entityLabel: row.entity_label,
    reason: row.reason,
    createdAt: row.created_at
  };
}

function normalizeComparable(value) {
  if (value instanceof Date) return value.toISOString();
  if (value == null) return "";
  if (typeof value === "number") return Number(value);
  return String(value);
}

function buildChangeSet(before = {}, after = {}, keys = []) {
  return keys.reduce((acc, key) => {
    const from = normalizeComparable(before[key]);
    const to = normalizeComparable(after[key]);
    if (from !== to) acc[key] = { before: before[key] ?? null, after: after[key] ?? null };
    return acc;
  }, {});
}

function requestMeta(req) {
  return {
    ip: req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress || null,
    userAgent: String(req.headers["user-agent"] || "").slice(0, 255) || null
  };
}

function cleanReason(value) {
  return String(value || "").trim();
}

function requireDeleteReason(req) {
  const reason = cleanReason(req.body?.reason || req.query?.reason);
  const category = String(req.body?.reasonCategory || req.query?.reasonCategory || "").trim();
  if (!reasonCategories.has(category)) {
    return { ok: false, message: "Select a valid deletion reason category." };
  }
  if (reason.length < 5) {
    return { ok: false, message: "Deletion reason is required and must be at least 5 characters." };
  }
  return { ok: true, reason, reasonCategory: category };
}

function tokenHash(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

async function createUserSession(req, user, sessionToken) {
  try {
    await ensureSessionSchema();
    const meta = requestMeta(req);
    await db.query(
      `INSERT INTO user_sessions (user_id, session_token_hash, role, login_at, last_activity_at, ip_address, user_agent)
       VALUES (?, ?, ?, NOW(), NOW(), ?, ?)`,
      [user.id, tokenHash(sessionToken), user.role, meta.ip, meta.userAgent]
    );
  } catch (error) {
    console.error("Session create error:", error.message);
  }
}

async function touchUserSession(req) {
  const token = req.headers["x-session-token"];
  if (!token) return;
  try {
    await ensureSessionSchema();
    await db.query(
      `UPDATE user_sessions SET last_activity_at=NOW()
       WHERE session_token_hash=? AND logout_at IS NULL`,
      [tokenHash(token)]
    );
  } catch {
    // Best-effort session activity only.
  }
}

async function closeUserSession(req) {
  const token = req.headers["x-session-token"] || req.body?.sessionToken;
  if (!token) return;
  await ensureSessionSchema();
  await db.query(
    `UPDATE user_sessions SET logout_at=NOW(), last_activity_at=NOW()
     WHERE session_token_hash=? AND logout_at IS NULL`,
    [tokenHash(token)]
  );
}

async function lastAuditHash(connection = db) {
  const [[last]] = await connection.query(
    `SELECT entry_hash FROM activity_logs WHERE entry_hash IS NOT NULL ORDER BY id DESC LIMIT 1`
  );
  return last?.entry_hash || null;
}

function computeEntryHash(payload) {
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

async function logActivity(req, entry, connection = db) {
  try {
    await ensureActivitySchema();
    const actor = entry.actor || await getActor(req);
    const meta = requestMeta(req);
    const previousHash = await lastAuditHash(connection);
    const hashPayload = {
      previousHash,
      actorId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      module: entry.module,
      action: entry.action,
      entityType: entry.entityType || null,
      entityId: entry.entityId == null ? null : String(entry.entityId),
      entityLabel: entry.entityLabel || null,
      reason: cleanReason(entry.reason) || null,
      reasonCategory: entry.reasonCategory || null,
      details: entry.details || null,
      createdAt: new Date().toISOString()
    };
    const entryHash = computeEntryHash(hashPayload);
    const [result] = await connection.query(
      `INSERT INTO activity_logs
        (actor_user_id, actor_name, actor_role, module_key, action_key, entity_type,
         entity_id, entity_label, reason, reason_category, details, previous_hash, entry_hash, ip_address, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        actor.id,
        actor.name,
        actor.role,
        entry.module,
        entry.action,
        entry.entityType || null,
        entry.entityId == null ? null : String(entry.entityId),
        entry.entityLabel || null,
        cleanReason(entry.reason) || null,
        entry.reasonCategory || null,
        entry.details ? JSON.stringify(entry.details) : null,
        previousHash,
        entryHash,
        meta.ip,
        meta.userAgent
      ]
    );
    emitAdminAuditEvent(publicActivityPayload({
      id: result.insertId,
      actor_name: actor.name,
      actor_role: actor.role,
      module_key: entry.module,
      action_key: entry.action,
      entity_type: entry.entityType || null,
      entity_id: entry.entityId == null ? null : String(entry.entityId),
      entity_label: entry.entityLabel || null,
      reason: cleanReason(entry.reason) || null,
      created_at: new Date().toISOString()
    }));
  } catch (error) {
    console.error("Activity log error:", error.message);
  }
}

module.exports = {
  buildChangeSet,
  closeUserSession,
  createUserSession,
  ensureActivitySchema,
  ensureSessionSchema,
  getActor,
  logActivity,
  requireDeleteReason,
  touchUserSession,
  reasonCategories
};
