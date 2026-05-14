require("dotenv").config();
const bcrypt = require("bcrypt");
const pool = require("./connection");

const users = [
  { name: "Fleet Admin",  email: "admin@astrafleet.com",  password: "admin123",  role: "admin"  },
  { name: "Ravi Kumar",   email: "driver@astrafleet.com", password: "driver123", role: "driver" },
];

async function seed() {
  for (const u of users) {
    const hash = await bcrypt.hash(u.password, 10);
    await pool.execute(
      "INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE name=name",
      [u.name, u.email, hash, u.role]
    );
    console.log(`✓ Seeded: ${u.email} (${u.role})`);
  }

  await pool.execute(
    `UPDATE drivers d
     JOIN users u ON u.email = ?
     SET d.user_id = u.id
     WHERE d.employee_code = ? AND d.user_id IS NULL`,
    ["driver@astrafleet.com", "DRV-201"]
  );
  console.log("✓ Linked driver@astrafleet.com to DRV-201");

  console.log("Done.");
  process.exit(0);
}

seed().catch(err => { console.error(err); process.exit(1); });
