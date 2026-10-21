// Who may join which realtime room. Checked on every join, so a logged-out or
// revoked session stops receiving events the next time the page rejoins.
const db = require("../db/connection");
const { parseAccessModules, verifyActiveSession } = require("../controllers/authController");

// Room -> employee pages that may listen. Admins may join every room.
// null = admin only.
const ROOM_MODULES = {
  "admin-tracking": ["tracking"],
  "admin-chat": ["drivers", "jobs"],
  "admin-jobs": ["jobs", "trips"],
  "admin-audit": null
};

function socketToken(socket) {
  return socket.handshake?.auth?.token || socket.handshake?.headers?.["x-session-token"] || null;
}

async function socketUser(socket) {
  const payload = await verifyActiveSession(socketToken(socket));
  if (!payload) return null;
  const [[user]] = await db.query(
    "SELECT id, role, approval_status, access_modules FROM users WHERE id = ?",
    [payload.id]
  );
  if (!user) return null;
  let driverId = null;
  if (user.role === "driver") {
    const [[driver]] = await db.query("SELECT id FROM drivers WHERE user_id = ? LIMIT 1", [user.id]);
    driverId = driver?.id ?? null;
  }
  return {
    role: user.role,
    active: user.role !== "employee" || user.approval_status === "active",
    modules: parseAccessModules(user.access_modules),
    driverId
  };
}

function hasModule(user, modules) {
  if (!user?.active) return false;
  if (user.role === "admin") return true;
  return user.role === "employee" && Array.isArray(modules) && modules.some((key) => user.modules.includes(key));
}

async function canJoinAdminRoom(socket, room) {
  return hasModule(await socketUser(socket), ROOM_MODULES[room]);
}

// Driver rooms carry one driver's chat and job events.
// The installed mobile app connects without a token, so token-less joins stay
// allowed until SOCKET_LEGACY_DRIVER_JOIN=false (set it once every phone runs a
// build that sends its token).
async function canJoinDriverRoom(socket, driverId) {
  if (!socketToken(socket)) return process.env.SOCKET_LEGACY_DRIVER_JOIN !== "false";
  const user = await socketUser(socket);
  if (!user?.active) return false;
  if (user.role === "driver") return Number(user.driverId) === Number(driverId);
  return hasModule(user, ["drivers", "jobs"]);
}

module.exports = { ROOM_MODULES, canJoinAdminRoom, canJoinDriverRoom };
