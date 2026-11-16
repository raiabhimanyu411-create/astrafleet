// Fresh test data covering the compliance / P&L / KPI audit cases (Nov 2026).
// Runs ONLY against a database whose name ends in "_test", and wipes it first.
//   DB_NAME=AstraFleet_test node scripts/seedTestScenario.js
require("dotenv").config();
const bcrypt = require("bcrypt");

if (!/_test$/i.test(process.env.DB_NAME || "")) {
  console.error("Refusing to run: set DB_NAME to a database ending in _test.");
  process.exit(1);
}
const db = require("../db/connection");

const TABLES = [
  "driver_job_status_events", "job_stops", "invoices", "trips", "defect_reports", "maintenance_jobs",
  "maintenance_records", "vehicle_inspections", "driver_messages", "control_room_alerts", "drivers",
  "trailers", "vehicles", "customers", "routes", "user_sessions", "users", "notification_acknowledgements"
];

const day = (n) => `DATE_ADD(CURDATE(), INTERVAL ${n} DAY)`;

async function run() {
  await db.query("SET FOREIGN_KEY_CHECKS=0");
  for (const table of TABLES) {
    try { await db.query(`DELETE FROM ${table}`); } catch (error) { if (error.code !== "ER_NO_SUCH_TABLE") throw error; }
  }
  await db.query("SET FOREIGN_KEY_CHECKS=1");

  const hash = await bcrypt.hash("Test@12345", 10);
  await db.query(
    `INSERT INTO users (id, name, email, password, role, approval_status) VALUES
       (1, 'Sarah Mitchell', 'admin@test.local', ?, 'admin', 'active'),
       (2, 'Jack Turner', 'jack@test.local', ?, 'driver', 'active')`,
    [hash, hash]
  );

  await db.query(`INSERT INTO customers (id, company_name, contact_name, phone, payment_terms_days, account_status)
                  VALUES (1, 'Tesco Distribution', 'Mark Allen', '0161 496 0000', 30, 'active')`);

  // Trucks — every one has status "available" except the VOR truck.
  await db.query(`
    INSERT INTO vehicles (id, registration_number, fleet_code, model_name, truck_type, status, mot_expiry, insurance_expiry, road_tax_expiry, inspection_frequency_weeks) VALUES
      (1, 'AB12CDE', 'TRK-001', 'DAF XF', 'Artic', 'available', ${day(200)}, ${day(200)}, ${day(200)}, 6),
      (2, 'NJ71BFZ', 'TRK-002', 'Volvo FH', 'Artic', 'available', ${day(-25)}, ${day(150)}, ${day(-34)}, 6),
      (3, 'DX19YMO', 'TRK-003', 'Scania R', 'Artic', 'available', ${day(120)}, ${day(-19)}, ${day(120)}, 6),
      (4, 'KT21BZN', 'TRK-004', 'MAN TGX', 'Rigid', 'available', ${day(120)}, ${day(120)}, ${day(120)}, 6),
      (5, 'PX71UTR', 'TRK-005', 'DAF CF', 'Rigid', 'available', ${day(120)}, NULL, ${day(120)}, 6),
      (6, 'MX22KHT', 'TRK-006', 'Iveco S-Way', 'Artic', 'maintenance', ${day(120)}, ${day(120)}, ${day(120)}, 6)`);
  // Safety inspections (PMI): recent for all, except KT21BZN (15 weeks ago on a 6-week cycle).
  await db.query(`
    INSERT INTO maintenance_jobs (job_number, vehicle_id, service_type, due_date, service_date, status, asset_type) VALUES
      ('MJ-1', 1, 'Safety inspection', ${day(-10)}, ${day(-10)}, 'completed', 'vehicle'),
      ('MJ-2', 2, 'Safety inspection', ${day(-10)}, ${day(-10)}, 'completed', 'vehicle'),
      ('MJ-3', 3, 'Safety inspection', ${day(-10)}, ${day(-10)}, 'completed', 'vehicle'),
      ('MJ-4', 4, 'Safety inspection', ${day(-105)}, ${day(-105)}, 'completed', 'vehicle'),
      ('MJ-5', 5, 'Safety inspection', ${day(-10)}, ${day(-10)}, 'completed', 'vehicle'),
      ('MJ-6', 6, 'Safety inspection', ${day(-10)}, ${day(-10)}, 'completed', 'vehicle')`);

  await db.query(`
    INSERT INTO trailers (id, trailer_code, registration_number, trailer_type, status, mot_expiry, next_inspection_due) VALUES
      (1, 'TRL501', 'C123456', 'Curtainsider', 'available', ${day(200)}, ${day(30)}),
      (2, 'TRL502', 'C654321', 'Box', 'available', ${day(-5)}, ${day(30)})`);

  // Drivers
  await db.query(`
    INSERT INTO drivers (id, user_id, employee_code, full_name, phone, license_number, license_expiry, medical_expiry,
                         cpc_expiry, tacho_card_expiry, date_of_birth, dvla_check_date, penalty_points,
                         onboarding_status, shift_status, compliance_status) VALUES
      (1, 2, 'DRV-001', 'Jack Turner', '07911 123456', 'TURNE801015J99AB', ${day(900)}, ${day(900)}, ${day(700)}, ${day(800)}, '1980-01-15', ${day(-30)}, 3, 'active', 'ready', 'clear'),
      (2, NULL, 'DRV-002', 'amrik singh', '07911 123457', 'SINGH801015A99AB', ${day(900)}, ${day(900)}, ${day(700)}, ${day(800)}, '1982-03-02', ${day(-30)}, 0, 'active', 'ready', 'review'),
      (3, NULL, 'DRV-003', 'Ethan Clarke', '07911 123458', 'Pending', '2099-12-31', '2099-12-31', NULL, NULL, '1990-06-10', NULL, NULL, 'active', 'ready', 'clear'),
      (4, NULL, 'DRV-004', 'Noah Hughes', '07911 123459', 'HUGHE801015N99AB', ${day(900)}, ${day(900)}, ${day(700)}, ${day(800)}, '1975-09-09', ${day(-30)}, 0, 'active', 'review', 'blocked'),
      (5, NULL, 'DRV-005', 'Oliver Smith', '07911 123460', 'SMITH801015O99AB', ${day(900)}, ${day(3650)}, ${day(700)}, ${day(800)}, '1975-01-01', ${day(-300)}, 12, 'active', 'ready', 'clear')`);

  // Jobs
  await db.query(`
    INSERT INTO trips (id, trip_code, client_name, customer_id, dispatch_status, planned_departure, driver_id, vehicle_id, trailer_id,
                       freight_amount_gbp, estimated_distance_km, total_job_duration_mins, pickup_address, drop_address, pod_status) VALUES
      (1, '2026-917-1', 'Crown Medical', NULL, 'planned', '2026-09-17 08:00:00', NULL, NULL, NULL, 640, 210, 300, 'Unit 4, Trafford Park, M17 1PG', 'Hams Hall, B46 1AL', 'pending'),
      (2, '2026-916-1', 'Tesco Distribution', 1, 'planned', CONCAT(${day(1)}, ' 07:00:00'), 1, 3, 1, 900, 300, 420, 'Daventry, NN11 8RE', 'Avonmouth, BS11 9YA', 'pending'),
      (3, 'JOB-5129635', 'tesco   distribution', NULL, 'completed', '2026-06-10 09:00:00', 1, 1, 1, 265, 23.5, 120, 'Trafford Park, M17 1PG', 'Salford, M50 3SP', 'uploaded'),
      (4, '2026-916-2', 'Crown Medical', NULL, 'planned', CONCAT(${day(2)}, ' 09:00:00'), NULL, NULL, NULL, NULL, NULL, NULL, 'No postcode given', 'Somewhere', 'pending')`);
  // Full schedules (collection → loading done → delivery arrival → unload end), as the job form saves them.
  await db.query(`UPDATE trips SET loading_done_time=DATE_ADD(planned_departure, INTERVAL 60 MINUTE),
                  calculated_arrival=DATE_ADD(planned_departure, INTERVAL (total_job_duration_mins - 60) MINUTE),
                  calculated_unload_end=DATE_ADD(planned_departure, INTERVAL total_job_duration_mins MINUTE),
                  estimated_eta_mins=GREATEST(total_job_duration_mins - 120, 30)
                  WHERE total_job_duration_mins IS NOT NULL`);
  // JOB-5129635: 14.6 miles, closed 19 days after collection (the audit's -£14,018 case).
  await db.query(`UPDATE trips SET actual_departure='2026-06-10 10:00:00', actual_arrival='2026-06-29 02:24:00',
                  pickup_arrived_at='2026-06-10 09:00:00', primary_drop_arrived_at='2026-06-29 02:24:00',
                  driver_job_status='delivered', primary_drop_status='completed' WHERE id=3`);

  console.log("Seeded test scenario. Admin login: admin@test.local / Test@12345");
  process.exit(0);
}

run().catch((error) => { console.error(error); process.exit(1); });
