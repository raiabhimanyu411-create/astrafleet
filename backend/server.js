require("dotenv").config();
const http = require("http");
const path = require("path");
const express = require("express");
const { Server } = require("socket.io");
const { ROOM_MODULES, canJoinAdminRoom, canJoinDriverRoom } = require("./utils/socketAccess");
const { getSettingsMap } = require("./controllers/settingsController");
const adminRoutes = require("./routes/adminRoutes");
const cors = require("cors");
const helmet = require("helmet");
const panelRoutes = require("./routes/panelRoutes");
const authRoutes = require("./routes/authRoutes");
const customerRoutes = require("./routes/customerRoutes");
const jobRoutes      = require("./routes/jobRoutes");
const driverRoutes   = require("./routes/driverRoutes");
const vehicleRoutes  = require("./routes/vehicleRoutes");
const maintenanceRoutes = require("./routes/maintenanceRoutes");
const maintenanceController = require("./controllers/maintenanceController");
const settingsRoutes    = require("./routes/settingsRoutes");
const { chatRoom, setRealtimeServer } = require("./realtime");
const { runLegacyUkTimeMigration } = require("./utils/legacyUkTimeMigration");

const app = express();
const PORT = process.env.PORT || 5001;
const CLIENT_DIST_PATH = path.join(__dirname, "..", "client", "dist");

const corsOptions = process.env.CORS_ORIGIN
  ? { origin: process.env.CORS_ORIGIN.split(",").map((origin) => origin.trim()) }
  : { origin: true };

// Security headers: HSTS, nosniff, frame-ancestors / X-Frame-Options, referrer policy, and no
// "X-Powered-By: Express". The CSP lists only what the web app really loads (Google Fonts, OpenStreetMap
// tiles, blob: document previews, the PDF worker, socket.io).
app.disable("x-powered-by");
// Behind nginx: trust the one proxy hop in front of Node so req.ip is the real client address
// (activity log / sessions). Set TRUST_PROXY=0 when Node is exposed directly.
app.set("trust proxy", process.env.TRUST_PROXY === undefined ? 1 : Number(process.env.TRUST_PROXY) || false);
app.use(helmet({
  contentSecurityPolicy: process.env.NODE_ENV === "production" ? {
    useDefaults: true,
    directives: {
      "default-src": ["'self'"],
      "script-src": ["'self'"],
      "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      "font-src": ["'self'", "data:", "https://fonts.gstatic.com"],
      "img-src": ["'self'", "data:", "blob:", "https://*.openstreetmap.org"],
      "connect-src": ["'self'", "ws:", "wss:"],
      "worker-src": ["'self'", "blob:"],
      "frame-src": ["'self'", "blob:", "data:"],
      "object-src": ["'none'"],
      "frame-ancestors": ["'none'"],
      "upgrade-insecure-requests": null
    }
  } : false,
  crossOriginResourcePolicy: { policy: "same-site" },
  crossOriginEmbedderPolicy: false,
  strictTransportSecurity: { maxAge: 31536000, includeSubDomains: true }
}));
app.use(cors(corsOptions));
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || "25mb" }));

if (process.env.NODE_ENV !== "production") {
  app.get("/", (_req, res) => {
    res.send("Astra Fleet backend is running.");
  });
}

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "Astra Fleet backend",
    port: PORT,
    activeRoles: ["Admin", "Employee", "Driver"],
    scope: "Admin-controlled employee access + Driver operations",
    timestamp: new Date().toISOString()
  });
});

app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/panels", panelRoutes);
app.use("/api/customers", customerRoutes);
app.use("/api/jobs",      jobRoutes);
app.use("/api/drivers",   driverRoutes);
app.use("/api/vehicles",  vehicleRoutes);
app.use("/api/maintenance", maintenanceRoutes);
app.use("/api/settings",   settingsRoutes);

// Unknown API paths get a JSON 404, not the web app's HTML page.
app.use("/api", (_req, res) => {
  res.status(404).json({ message: "API route not found." });
});

app.use((err, _req, res, next) => {
  if (err?.type === "entity.too.large") {
    return res.status(413).json({ message: "Upload is too large. Please use a smaller POD photo." });
  }
  return next(err);
});

const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: corsOptions
});

io.on("connection", (socket) => {
  // Admin rooms carry every driver's GPS, chat and the audit log, so each join is checked
  // against the caller's login. A refused join is simply ignored (no events arrive).
  for (const room of Object.keys(ROOM_MODULES)) {
    socket.on(`${room}:join`, () => {
      canJoinAdminRoom(socket, room)
        .then((allowed) => { if (allowed) socket.join(room); })
        .catch((error) => console.error(`[Realtime] ${room} join check failed:`, error.message));
    });
    socket.on(`${room}:leave`, () => socket.leave(room));
  }

  socket.on("driver-chat:join", (driverId) => {
    if (!driverId) return;
    canJoinDriverRoom(socket, driverId)
      .then((allowed) => { if (allowed) socket.join(chatRoom(driverId)); })
      .catch((error) => console.error("[Realtime] driver-chat join check failed:", error.message));
  });

  socket.on("driver-chat:leave", (driverId) => {
    if (driverId) socket.leave(chatRoom(driverId));
  });
});

setRealtimeServer(io);

if (process.env.NODE_ENV === "production") {
  app.use(express.static(CLIENT_DIST_PATH));
  app.get(/.*/, (_req, res) => {
    res.sendFile(path.join(CLIENT_DIST_PATH, "index.html"));
  });
}

if (require.main === module) {
  // Convert maintenance times MySQL wrote in its old timezone to UK time once, before any request can
  // write new UK-time rows. Never blocks startup: on any problem it logs and leaves the data unchanged.
  runLegacyUkTimeMigration()
    .then((result) => {
      if (result.status === "applied") {
        const changed = result.summary.reduce((sum, item) => sum + item.changed, 0);
        console.log(`[UK time] Converted ${changed} old maintenance times from ${result.from} to UK time.`);
      }
    })
    .catch((error) => console.error("[UK time] Conversion check failed:", error.message))
    // Load admin Settings before serving, so the first maintenance refresh uses the saved intervals.
    .then(() => getSettingsMap().catch((error) => console.error("[Settings] load failed, using defaults:", error.message)))
    // Columns the shared compliance / costing rules need, then one-time tidy-ups (customer links on
    // free-text jobs, cost-rate snapshots on old completed jobs). Never blocks startup.
    .then(() => require("./utils/complianceSchema").ensureComplianceSchema()
      .then(() => require("./controllers/jobController").ensureJobCostSchema())
      .then(() => require("./utils/dataConsistency").runDataConsistency())
      .catch((error) => console.error("[Startup] compliance / data checks failed:", error.message)))
    .finally(() => {
      httpServer.listen(PORT, () => {
        console.log(`Astra Fleet backend listening on http://localhost:${PORT}`);
        maintenanceController.initializeMaintenance()
          .catch((error) => console.error("[MaintenanceIntegrity] startup verification failed:", error.message));
      });
    });
}

module.exports = { app, httpServer, io };
