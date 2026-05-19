const bcrypt = require("bcrypt");
const pool = require("../db/connection");

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

    res.json({
      role: user.role,
      name: user.name,
      id: user.id,
      approvalStatus: user.approval_status,
      accessModules: parseAccessModules(user.access_modules)
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Server error. Please try again." });
  }
}

async function registerEmployee(req, res) {
  const { name, email, password, phone, department, jobTitle } = req.body;

  if (!name || !email || !password || !department || !jobTitle) {
    return res.status(400).json({ error: "Name, email, password, department, and job title are required." });
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

module.exports = { login, registerEmployee, ensureEmployeeAuthSchema, employeeModules, parseAccessModules };
