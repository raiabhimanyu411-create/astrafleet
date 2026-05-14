require("dotenv").config();
const http = require("http");
const path = require("path");
const express = require("express");
const { Server } = require("socket.io");
const adminRoutes = require("./routes/adminRoutes");
const cors = require("cors");
const panelRoutes = require("./routes/panelRoutes");
const authRoutes = require("./routes/authRoutes");
const customerRoutes = require("./routes/customerRoutes");
const jobRoutes      = require("./routes/jobRoutes");
const driverRoutes   = require("./routes/driverRoutes");
const vehicleRoutes  = require("./routes/vehicleRoutes");
const { setRealtimeServer } = require("./realtime");

const app = express();
const PORT = process.env.PORT || 5001;
const CLIENT_DIST_PATH = path.join(__dirname, "..", "client", "dist");

const corsOptions = process.env.CORS_ORIGIN
  ? { origin: process.env.CORS_ORIGIN.split(",").map((origin) => origin.trim()) }
  : { origin: true };

app.use(cors(corsOptions));
app.use(express.json());

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
    activeRoles: ["Admin", "Driver"],
    scope: "Admin + Driver only",
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

const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: corsOptions
});

io.on("connection", (socket) => {
  socket.on("admin-tracking:join", () => {
    socket.join("admin-tracking");
  });

  socket.on("admin-tracking:leave", () => {
    socket.leave("admin-tracking");
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
  httpServer.listen(PORT, () => {
    console.log(`Astra Fleet backend listening on http://localhost:${PORT}`);
  });
}

module.exports = { app, httpServer, io };
