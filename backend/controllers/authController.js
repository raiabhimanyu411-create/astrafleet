const bcrypt = require("bcrypt");
const crypto = require("crypto");
const pool = require("../db/connection");
const { closeUserSession, createUserSession, logActivity } = require("../utils/auditLogger");

const employeeModules = new Set(["jobs", "customers", "trips", "drivers", "vehicles", "finance", "billing", "tracking", "alerts"]);

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

function sessionSecret() {
  return process.env.SESSION_SECRET || process.env.JWT_SECRET || "astrafleet-local-session-secret";
}

function signSessionToken(user) {
  const payload = {
    id: user.id,
    role: user.role,
    issuedAt: Date.now()
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
    return payload;
  } catch {
    return null;
  }
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
      return res.status(403).json({ error: "Your employee account is waiting for admin approval." });
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

module.exports = { login, logout, registerEmployee, ensureEmployeeAuthSchema, employeeModules, parseAccessModules, signSessionToken, verifySessionToken };
