// Push notifications for the driver mobile app, delivered through the Expo Push service.
// Every notify* export is fire-and-forget: failures are logged and never reach the
// request or realtime event that triggered them. Set DRIVER_PUSH_ENABLED=false to switch off.
const db = require("../db/connection");
const { fmtUkDateTime } = require("./jobDateTimes");

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_TOKEN_PATTERN = /^Expo(nent)?PushToken\[[^\]]+\]$/;
const JOB_SOURCES = new Set(["admin-create", "admin-planner", "admin-edit", "admin-cancel", "vehicle-replacement"]);

let schemaReady = null;

function pushEnabled() {
  return process.env.DRIVER_PUSH_ENABLED !== "false";
}

function ensurePushSchema() {
  schemaReady ||= db.query(
    `CREATE TABLE IF NOT EXISTS driver_push_tokens (
      id INT AUTO_INCREMENT PRIMARY KEY,
      driver_id INT NOT NULL,
      token VARCHAR(255) NOT NULL,
      platform VARCHAR(20) DEFAULT NULL,
      app_version VARCHAR(40) DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_driver_push_token (token),
      INDEX idx_driver_push_tokens_driver (driver_id)
    ) ENGINE=InnoDB`
  ).catch(error => {
    schemaReady = null;
    throw error;
  });
  return schemaReady;
}

function isExpoPushToken(token) {
  return EXPO_TOKEN_PATTERN.test(String(token || ""));
}

async function registerToken(driverId, { token, platform, appVersion }) {
  await ensurePushSchema();
  // A phone that signs in as another driver moves its token to that driver.
  await db.query(
    `INSERT INTO driver_push_tokens (driver_id, token, platform, app_version)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE driver_id=VALUES(driver_id), platform=VALUES(platform), app_version=VALUES(app_version)`,
    [driverId, token, String(platform || "").slice(0, 20) || null, String(appVersion || "").slice(0, 40) || null]
  );
}

async function removeToken(driverId, token) {
  await ensurePushSchema();
  await db.query(`DELETE FROM driver_push_tokens WHERE driver_id=? AND token=?`, [driverId, token]);
}

async function sendToDriver(driverId, { title, body, data, channelId }) {
  if (!pushEnabled() || !driverId) return;
  await ensurePushSchema();
  const [rows] = await db.query(`SELECT token FROM driver_push_tokens WHERE driver_id=?`, [driverId]);
  if (!rows.length) return;

  const messages = rows.map(({ token }) => ({
    to: token,
    title,
    body: String(body || "").slice(0, 240),
    data: data || {},
    sound: "default",
    priority: "high",
    channelId
  }));
  const headers = { Accept: "application/json", "Content-Type": "application/json" };
  if (process.env.EXPO_ACCESS_TOKEN) headers.Authorization = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`;

  const response = await fetch(EXPO_PUSH_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(messages),
    signal: AbortSignal.timeout(10000)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Expo push HTTP ${response.status}: ${JSON.stringify(result.errors || result)}`);

  // Tickets come back in the same order as the messages. Drop tokens for uninstalled apps.
  const tickets = Array.isArray(result.data) ? result.data : [];
  for (const [index, ticket] of tickets.entries()) {
    if (ticket?.status !== "error") continue;
    if (ticket.details?.error === "DeviceNotRegistered") {
      await db.query(`DELETE FROM driver_push_tokens WHERE token=?`, [messages[index].to]);
    } else {
      console.error("[Push] Ticket error:", ticket.message || ticket.details?.error);
    }
  }
}

function notify(driverId, payload) {
  sendToDriver(Number(driverId), payload).catch(error => console.error("[Push] Driver notification failed:", error.message));
}

function notifyChatMessage(message) {
  if (!message?.driverId || message.senderRole === "driver") return;
  // Planner assignments also post a chat message; the job push already covers those.
  if (/^New job assigned:/.test(String(message.body || ""))) return;
  notify(message.driverId, {
    title: message.senderName || "Dispatch",
    body: message.body,
    data: { type: "message", messageId: message.id, jobId: message.tripId || null },
    channelId: "messages"
  });
}

async function jobEvent(payload) {
  const [[job]] = await db.query(
    `SELECT t.id, t.trip_code, t.driver_id, t.planned_departure,
            COALESCE(r.origin_hub, t.pickup_address, 'Pickup TBD') AS pickup_label,
            COALESCE(r.destination_hub, t.drop_address, 'Drop TBD') AS drop_label,
            v.registration_number, tr.trailer_code
     FROM trips t
     LEFT JOIN routes r ON r.id = t.route_id
     LEFT JOIN vehicles v ON v.id = t.vehicle_id
     LEFT JOIN trailers tr ON tr.id = t.trailer_id
     WHERE t.id = ?`,
    [payload.jobId]
  );
  if (!job) return;

  const code = job.trip_code || "Job";
  const currentDriver = Number(job.driver_id) || null;
  const previousDriver = Number(payload.previousDriverId) || null;
  const vehicleLine = job.registration_number
    ? `Vehicle ${job.registration_number}${job.trailer_code ? ` · Trailer ${job.trailer_code}` : ""}`
    : "";
  const departure = job.planned_departure ? fmtUkDateTime(job.planned_departure) : "";
  const assigned = currentDriver && (payload.source === "admin-create"
    || (["admin-planner", "admin-edit"].includes(payload.source) && currentDriver !== previousDriver));

  if (assigned) {
    notify(currentDriver, {
      title: `New job assigned · ${code}`,
      body: [`${job.pickup_label} → ${job.drop_label}`, departure && departure !== "—" ? departure : "", vehicleLine].filter(Boolean).join("\n"),
      data: { type: "job-assigned", jobId: job.id },
      channelId: "jobs"
    });
  }
  if (previousDriver && currentDriver !== previousDriver && ["admin-planner", "admin-edit"].includes(payload.source)) {
    notify(previousDriver, {
      title: `Job removed · ${code}`,
      body: `${code} is no longer assigned to you.`,
      data: { type: "job-removed", jobId: job.id },
      channelId: "jobs"
    });
  }
  if (payload.source === "admin-cancel" && currentDriver) {
    notify(currentDriver, {
      title: `Job cancelled · ${code}`,
      body: `${code} (${job.pickup_label} → ${job.drop_label}) has been cancelled by dispatch.`,
      data: { type: "job-cancelled", jobId: job.id },
      channelId: "jobs"
    });
  }
  if (payload.source === "vehicle-replacement" && currentDriver) {
    notify(currentDriver, {
      title: `Vehicle changed · ${code}`,
      body: vehicleLine || "Your vehicle for this job has changed. Open the job for details.",
      data: { type: "job-updated", jobId: job.id },
      channelId: "jobs"
    });
  }
}

function notifyJobEvent(payload) {
  if (!pushEnabled() || !payload?.jobId || !JOB_SOURCES.has(payload.source)) return;
  jobEvent(payload).catch(error => console.error("[Push] Job notification failed:", error.message));
}

module.exports = { ensurePushSchema, isExpoPushToken, notifyChatMessage, notifyJobEvent, registerToken, removeToken };
