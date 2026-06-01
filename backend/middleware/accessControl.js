const db = require("../db/connection");
const { parseAccessModules, verifySessionToken } = require("../controllers/authController");
const { logActivity, touchUserSession } = require("../utils/auditLogger");

async function readSessionUser(req) {
  const id = Number(req.headers["x-session-user-id"] || 0);
  if (!id) return null;
  const tokenPayload = verifySessionToken(req.headers["x-session-token"]);
  if (!tokenPayload || Number(tokenPayload.id) !== id) return null;
  const [[user]] = await db.query(
    `SELECT id, name, role, approval_status, access_modules
     FROM users WHERE id = ?`,
    [id]
  );
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    role: user.role,
    approvalStatus: user.approval_status,
    accessModules: parseAccessModules(user.access_modules)
  };
}

function requireAdmin(req, res, next) {
  readSessionUser(req)
    .then((user) => {
      if (user?.role === "admin") {
        req.sessionUser = user;
        touchUserSession(req);
        return next();
      }
      return res.status(403).json({ message: "Admin access is required." });
    })
    .catch((error) => res.status(500).json({ message: "Access check error", error: error.message }));
}

function requireModuleAccess(moduleKey) {
  return (req, res, next) => {
    readSessionUser(req)
      .then((user) => {
        if (!user) return res.status(401).json({ message: "Login session is required." });
        if (user.role === "admin") {
          req.sessionUser = user;
          touchUserSession(req);
          if (req.method === "GET" && req.path !== "/notifications" && req.path !== "/activity") {
            logActivity(req, { actor: user, module: moduleKey, action: "view", entityType: "panel", entityLabel: req.originalUrl });
          }
          return next();
        }
        if (user.role === "employee" && user.approvalStatus === "active" && user.accessModules.includes(moduleKey)) {
          req.sessionUser = user;
          touchUserSession(req);
          if (req.method === "GET") {
            logActivity(req, { actor: user, module: moduleKey, action: "view", entityType: "panel", entityLabel: req.originalUrl });
          }
          return next();
        }
        return res.status(403).json({ message: `Access to ${moduleKey} panel is not assigned.` });
      })
      .catch((error) => res.status(500).json({ message: "Access check error", error: error.message }));
  };
}

module.exports = {
  requireAdmin,
  requireModuleAccess
};
