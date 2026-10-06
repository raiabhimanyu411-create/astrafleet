require("dotenv").config();
// AstraFleet is a UK operation: every clock — Node, MySQL NOW()/CURRENT_TIMESTAMP/CURDATE() — runs on
// UK time (GMT in winter, BST in summer), whatever timezone the host machine is set to.
process.env.TZ = "Europe/London";
const mysql = require("mysql2/promise");

const UK_TIME_ZONE = "Europe/London";

const pool = mysql.createPool({
  host:     process.env.DB_HOST     || "localhost",
  user:     process.env.DB_USER     || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME     || "AstraFleet",
  // Keep comparisons and UNION queries consistent when older tables use a
  // different database default collation.
  charset: "utf8mb4_unicode_ci",
  dateStrings: true,
  waitForConnections: true,
  connectionLimit: 10,
});

// Current UK offset from UTC, e.g. "+01:00" during BST.
function ukOffset(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: UK_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(date).map(part => [part.type, part.value]));
  const ukAsUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
  const minutes = Math.round((ukAsUtc - Math.floor(date.getTime() / 60000) * 60000) / 60000);
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

// "Europe/London" needs MySQL's timezone tables (mysql_tzinfo_to_sql). Without them we fall back to the
// current numeric offset and refresh it whenever GMT/BST changes, checked each time a connection is used.
let namedZoneSupported = null;

function desiredZone() {
  return namedZoneSupported ? UK_TIME_ZONE : ukOffset();
}

pool.pool.on("connection", connection => {
  if (namedZoneSupported !== null) return;
  connection.query(`SET time_zone = '${UK_TIME_ZONE}'`, error => {
    namedZoneSupported = !error;
    if (error) console.warn(`[DB] MySQL has no '${UK_TIME_ZONE}' timezone table; using UK offset ${ukOffset()} (auto-updates for BST/GMT).`);
  });
});

pool.pool.on("acquire", connection => {
  const zone = desiredZone();
  if (connection.__ukTimeZone === zone) return;
  connection.__ukTimeZone = zone;
  // Queued on this connection ahead of the caller's own query, so it always runs first.
  connection.query("SET time_zone = ?", [zone], error => {
    if (error) {
      connection.__ukTimeZone = null;
      console.error("[DB] Could not set UK time zone:", error.message);
    }
  });
});

pool.ukOffset = ukOffset;
module.exports = pool;
