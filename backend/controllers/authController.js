const bcrypt = require("bcrypt");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const pool = require("../db/connection");
const { closeUserSession, createUserSession, isUserSessionActive, logActivity, revokeUserSessions } = require("../utils/auditLogger");

const employeeModules = new Set(["jobs", "customers", "trips", "drivers", "vehicles", "maintenance", "finance", "billing", "tracking", "alerts"]);

async function addColumnIfMissing(table, column, definition) {
  const [rows] = await pool.query(`SHOW COLUMNS FROM ${table} LIKE ?`, [column]);
  if (rows.length === 0) {
    try {
      await pool.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    } catch (error) {
      if (error.code !== "ER_DUP_FIELDNAME") throw error;
    }
  }
}

async function ensureEmployeeAuthSchema() {
  await pool.query("ALTER TABLE users MODIFY role ENUM('admin','driver','employee') NOT NULL DEFAULT 'driver'");
  await addColumnIfMissing("users", "employee_code", "VARCHAR(40) DEFAULT NULL");
  await addColumnIfMissing("users", "phone", "VARCHAR(30) DEFAULT NULL");
  await addColumnIfMissing("users", "department", "VARCHAR(80) DEFAULT NULL");
  await addColumnIfMissing("users", "job_title", "VARCHAR(120) DEFAULT NULL");
  await addColumnIfMissing("users", "access_modules", "JSON DEFAULT NULL");
  await addColumnIfMissing("users", "approval_status", "ENUM('pending','active','rejected') NOT NULL DEFAULT 'active'");
}

function parseAccessModules(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const SESSION_SECRET_FILE = path.join(__dirname, "..", ".session-secret");
const SESSION_TTL_MS = {
  admin: 12 * 60 * 60 * 1000,
  employee: 12 * 60 * 60 * 1000,
  driver: 30 * 24 * 60 * 60 * 1000
};
let cachedSessionSecret = null;

// Never fall back to a hardcoded secret: anyone with the source could forge admin tokens.
// Without SESSION_SECRET, a random secret is generated once and kept in a gitignored file
// (survives `git reset --hard` deploys) so tokens stay valid across restarts.
function sessionSecret() {
  if (cachedSessionSecret) return cachedSessionSecret;
  const fromEnv = process.env.SESSION_SECRET || process.env.JWT_SECRET;
  if (fromEnv) {
    cachedSessionSecret = fromEnv;
    return cachedSessionSecret;
  }
  try {
    cachedSessionSecret = fs.readFileSync(SESSION_SECRET_FILE, "utf8").trim() || null;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (!cachedSessionSecret) {
    cachedSessionSecret = crypto.randomBytes(48).toString("base64url");
    fs.writeFileSync(SESSION_SECRET_FILE, cachedSessionSecret, { mode: 0o600 });
    console.warn(`SESSION_SECRET is not set; generated one in ${SESSION_SECRET_FILE}.`);
  }
  return cachedSessionSecret;
}

function signSessionToken(user) {
  const issuedAt = Date.now();
  const payload = {
    id: user.id,
    role: user.role,
    issuedAt,
    expiresAt: issuedAt + (SESSION_TTL_MS[user.role] || SESSION_TTL_MS.admin),
    nonce: crypto.randomBytes(8).toString("base64url")
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", sessionSecret()).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function verifySessionToken(token) {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const [encoded, signature] = token.split(".");
  const expected = crypto.createHmac("sha256", sessionSecret()).update(encoded).digest("base64url");
  if (!signature || signature.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (!payload?.id || !payload?.role) return null;
    // Tokens issued before expiry existed carry no expiresAt and are rejected (one-time re-login).
    if (!Number.isFinite(payload.expiresAt) || Date.now() >= payload.expiresAt) return null;
    return payload;
  } catch {
    return null;
  }
}

// Signature + expiry + a live user_sessions row (logout and password change revoke it).
async function verifyActiveSession(token) {
  const payload = verifySessionToken(token);
  if (!payload) return null;
  if (!(await isUserSessionActive(token))) return null;
  return payload;
}

async function login(req, res) {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }

  try {
    await ensureEmployeeAuthSchema();

    const [rows] = await pool.execute(
      `SELECT id, name, email, password, role, approval_status, access_modules
       FROM users WHERE email = ?`,
      [email]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    const user = rows[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    if (user.role === "employee" && user.approval_status !== "active") {
      return res.status(403).json({
        error: user.approval_status === "rejected"
          ? "Your employee access has been turned off. Contact your admin."
          : "Your employee account is waiting for admin approval."
      });
    }

    if (user.role === "driver") {
      // SELECT * so this still works before the archived_at column has been added.
      const [[driver]] = await pool.execute(`SELECT * FROM drivers WHERE user_id = ? LIMIT 1`, [user.id]);
      if (driver?.archived_at) {
        return res.status(403).json({ error: "This driver account has been archived. Contact your transport office." });
      }
    }

    const sessionToken = signSessionToken(user);

    await createUserSession(req, user, sessionToken);
    await logActivity(req, {
      actor: { id: user.id, name: user.name, role: user.role },
      module: user.role === "employee" ? "employee_portal" : user.role,
      action: "login",
      entityType: "user",
      entityId: user.id,
      entityLabel: user.name,
      details: { email: user.email, role: user.role }
    });

    res.json({
      role: user.role,
      name: user.name,
      id: user.id,
      sessionToken,
      approvalStatus: user.approval_status,
      accessModules: parseAccessModules(user.access_modules)
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Server error. Please try again." });
  }
}

async function logout(req, res) {
  try {
    await closeUserSession(req);
    await logActivity(req, {
      module: "session",
      action: "logout",
      entityType: "user",
      entityId: req.headers["x-session-user-id"] || null,
      details: { role: req.headers["x-session-role"] || null }
    });
    res.json({ message: "Logged out." });
  } catch (err) {
    res.status(500).json({ message: "Logout error", error: err.message });
  }
}

// Lets the client refresh role/pages without a re-login after admin changes access.
async function getMySession(req, res) {
  try {
    const payload = await verifyActiveSession(req.headers["x-session-token"]);
    if (!payload) return res.status(401).json({ code: "SESSION_EXPIRED", message: "Login session has expired." });

    const [[user]] = await pool.execute(
      `SELECT id, name, role, approval_status, access_modules FROM users WHERE id = ?`,
      [payload.id]
    );
    if (!user) return res.status(401).json({ code: "SESSION_EXPIRED", message: "Login session has expired." });

    res.json({
      id: user.id,
      name: user.name,
      role: user.role,
      approvalStatus: user.approval_status,
      accessModules: parseAccessModules(user.access_modules)
    });
  } catch (err) {
    res.status(500).json({ message: "Session check error", error: err.message });
  }
}

async function getMyProfile(req, res) {
  try {
    const payload = await verifyActiveSession(req.headers["x-session-token"]);
    const userId = Number(req.headers["x-session-user-id"] || 0);
    if (!payload || payload.role !== "admin" || payload.id !== userId) {
      return res.status(401).json({ code: "SESSION_EXPIRED", message: "Admin session is required." });
    }

    const [[user]] = await pool.execute(
      `SELECT id, name, email, role, created_at FROM users WHERE id = ? AND role='admin'`,
      [userId]
    );
    if (!user) return res.status(404).json({ message: "Admin profile not found." });

    res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      createdAt: user.created_at
    });
  } catch (err) {
    res.status(500).json({ message: "Profile fetch error", error: err.message });
  }
}

async function updateMyProfile(req, res) {
  try {
    const payload = await verifyActiveSession(req.headers["x-session-token"]);
    const userId = Number(req.headers["x-session-user-id"] || 0);
    if (!payload || payload.role !== "admin" || payload.id !== userId) {
      return res.status(401).json({ code: "SESSION_EXPIRED", message: "Admin session is required." });
    }

    const name = String(req.body.name || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const currentPassword = String(req.body.currentPassword || "");
    const newPassword = String(req.body.newPassword || "");

    if (!name || !email || !currentPassword) {
      return res.status(400).json({ message: "Name, email, and current password are required." });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ message: "Enter a valid email address." });
    }
    if (newPassword && newPassword.length < 6) {
      return res.status(400).json({ message: "New password must be at least 6 characters." });
    }

    const [[user]] = await pool.execute(
      `SELECT id, name, email, password FROM users WHERE id = ? AND role='admin'`,
      [userId]
    );
    if (!user) return res.status(404).json({ message: "Admin profile not found." });

    const passwordOk = await bcrypt.compare(currentPassword, user.password);
    if (!passwordOk) return res.status(401).json({ message: "Current password is incorrect." });

    const [[emailOwner]] = await pool.execute(
      `SELECT id FROM users WHERE email = ? AND id <> ? LIMIT 1`,
      [email, userId]
    );
    if (emailOwner) return res.status(409).json({ message: "This email is already used by another account." });

    const nextHash = newPassword ? await bcrypt.hash(newPassword, 10) : user.password;
    await pool.execute(
      `UPDATE users SET name=?, email=?, password=? WHERE id=? AND role='admin'`,
      [name, email, nextHash, userId]
    );
    if (newPassword) {
      // Sign out every other device that still holds a token from the old password.
      await revokeUserSessions(userId, { exceptToken: req.headers["x-session-token"] });
    }

    await logActivity(req, {
      actor: { id: userId, name, role: "admin" },
      module: "profile",
      action: "update",
      entityType: "admin_profile",
      entityId: userId,
      entityLabel: name,
      details: {
        changedName: user.name !== name,
        changedEmail: user.email !== email,
        changedPassword: Boolean(newPassword)
      }
    });

    res.json({
      message: "Profile updated.",
      profile: { id: userId, name, email, role: "admin" }
    });
  } catch (err) {
    res.status(500).json({ message: "Profile update error", error: err.message });
  }
}

async function registerEmployee(req, res) {
  const name = String(req.body.name || "").trim();
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const phone = String(req.body.phone || "").trim();
  const department = String(req.body.department || "").trim();
  const jobTitle = String(req.body.jobTitle || "").trim();

  if (!name || !email || !password || !department || !jobTitle) {
    return res.status(400).json({ error: "Name, email, password, department, and job title are required." });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "Enter a valid work email address." });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters." });
  }

  try {
    await ensureEmployeeAuthSchema();

    const [existing] = await pool.execute("SELECT id FROM users WHERE email = ?", [email]);
    if (existing.length > 0) {
      return res.status(409).json({ error: "An account with this email already exists." });
    }

    const hash = await bcrypt.hash(password, 10);
    const employeeCode = `EMP-${Date.now().toString().slice(-6)}`;

    await pool.execute(
      `INSERT INTO users
        (name, email, password, role, employee_code, phone, department, job_title, access_modules, approval_status)
       VALUES (?, ?, ?, 'employee', ?, ?, ?, ?, JSON_ARRAY(), 'pending')`,
      [name, email, hash, employeeCode, phone || null, department, jobTitle]
    );

    res.status(201).json({
      message: "Employee registration submitted. Admin approval is required before login.",
      employeeCode
    });
  } catch (err) {
    console.error("Employee registration error:", err);
    res.status(500).json({ error: "Server error. Please try again." });
  }
}

module.exports = { verifyActiveSession, login, logout, getMySession, getMyProfile, updateMyProfile, registerEmployee, ensureEmployeeAuthSchema, employeeModules, parseAccessModules, signSessionToken, verifySessionToken };
