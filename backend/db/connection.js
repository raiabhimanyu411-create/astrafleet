require("dotenv").config();
const mysql = require("mysql2/promise");

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

module.exports = pool;
