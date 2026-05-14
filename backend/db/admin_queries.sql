-- Run after schema.sql
-- This file seeds sample admin-module data and includes ready-made queries.

-- ------------------------------------
-- SAMPLE ADMIN PAGE CONTENT
-- ------------------------------------
INSERT INTO admin_pages (page_key, badge, title, description) VALUES
  ('overview', 'Admin control tower', 'Transport management system admin panel', 'Manage fleet, drivers, routes, billing, and live truck movement from one admin workspace.'),
  ('drivers', 'Driver management', 'Driver onboarding and compliance', 'Handle onboarding, document expiry, shift readiness, and trip allocation approvals in one place.'),
  ('finance', 'Finance management', 'Collections, payouts and cash position', 'Track collections follow-up, vendor payouts, cash flow, and overdue controls in pound sterling.'),
  ('trips', 'Trip / route planning', 'Dispatch routes and dock scheduling', 'Run lane planning, dispatch scheduling, dock windows, and vehicle assignments from one workspace.'),
  ('billing', 'Invoicing & billing', 'Freight invoices and POD billing', 'Manage invoice generation, POD-linked billing, and payment status tracking in pound sterling.'),
  ('tracking', 'GPS / live tracking', 'Truck positions, ETA and last ping', 'Give admins visibility into every active truck''s location, speed, ETA, and last ping.'),
  ('alerts', 'Control room alerts', 'Delay, breakdown and compliance escalations', 'A dedicated admin view for delay, breakdown, compliance breach, and reassignment escalations.')
ON DUPLICATE KEY UPDATE
  badge = VALUES(badge),
  title = VALUES(title),
  description = VALUES(description);

INSERT INTO admin_page_highlights (page_id, highlight_text, sort_order) VALUES
  ((SELECT id FROM admin_pages WHERE page_key = 'overview'), 'Admins get a consolidated view of dispatch, compliance, finance, and live tracking.', 1),
  ((SELECT id FROM admin_pages WHERE page_key = 'overview'), 'Driver approvals, trip planning, and truck availability are visible in one control layer.', 2),
  ((SELECT id FROM admin_pages WHERE page_key = 'overview'), 'All payments and billing values are now tracked in pound sterling.', 3),
  ((SELECT id FROM admin_pages WHERE page_key = 'drivers'), 'The driver desk centralizes everything from onboarding to live shift readiness.', 1),
  ((SELECT id FROM admin_pages WHERE page_key = 'drivers'), 'Expiring documents and blocked drivers are visible to admins ahead of time.', 2),
  ((SELECT id FROM admin_pages WHERE page_key = 'drivers'), 'Trip approvals are available only for drivers with clear documents.', 3),
  ((SELECT id FROM admin_pages WHERE page_key = 'finance'), 'Customer receivables and vendor liabilities are visible in one finance desk.', 1),
  ((SELECT id FROM admin_pages WHERE page_key = 'finance'), 'All payment values are normalized in pound sterling.', 2),
  ((SELECT id FROM admin_pages WHERE page_key = 'finance'), 'Overdue customers and held payouts are ready for escalation.', 3),
  ((SELECT id FROM admin_pages WHERE page_key = 'trips'), 'The route planning desk keeps dispatch, yard slots, and driver assignments aligned.', 1),
  ((SELECT id FROM admin_pages WHERE page_key = 'trips'), 'Blocked trips and late dock windows are available to admins on the same screen.', 2),
  ((SELECT id FROM admin_pages WHERE page_key = 'trips'), 'Quick reassignment is possible based on fleet availability.', 3),
  ((SELECT id FROM admin_pages WHERE page_key = 'billing'), 'The invoice register is linked with trips and POD records.', 1),
  ((SELECT id FROM admin_pages WHERE page_key = 'billing'), 'Billing issues such as missing POD or held customer approvals are visible separately.', 2),
  ((SELECT id FROM admin_pages WHERE page_key = 'billing'), 'All invoice values are issued in pound sterling.', 3),
  ((SELECT id FROM admin_pages WHERE page_key = 'tracking'), 'The live tracking desk shows the latest movement for every active truck.', 1),
  ((SELECT id FROM admin_pages WHERE page_key = 'tracking'), 'Slow or stopped movement and stale GPS pings can be identified immediately.', 2),
  ((SELECT id FROM admin_pages WHERE page_key = 'tracking'), 'ETA risks are synced with dispatch and alerts desks.', 3),
  ((SELECT id FROM admin_pages WHERE page_key = 'alerts'), 'Critical operational issues are visible in a separate escalation feed.', 1),
  ((SELECT id FROM admin_pages WHERE page_key = 'alerts'), 'Owners and next actions can be tracked from the resolution queue.', 2),
  ((SELECT id FROM admin_pages WHERE page_key = 'alerts'), 'Alerts from drivers, routes, billing, and tracking are centralized.', 3)
ON DUPLICATE KEY UPDATE
  highlight_text = VALUES(highlight_text);

INSERT INTO admin_modules (title, description, route_path, sort_order, is_active) VALUES
  ('Driver Management', 'Driver onboarding, document expiry, shift readiness, and trip allocation approvals.', '/admin/drivers', 1, 1),
  ('Finance Management', 'Collections follow-up, vendor payouts, cash flow view, and overdue control.', '/admin/finance', 2, 1),
  ('Trip / Route Planning', 'Lane planning, dispatch scheduling, dock windows, and vehicle assignment.', '/admin/trips', 3, 1),
  ('Vehicle Management', 'Fleet registration, compliance dates, maintenance logs, and defect reporting.', '/admin/vehicles', 4, 1),
  ('Invoicing & Billing', 'Freight invoice generation, POD-linked billing, and payment status tracking.', '/admin/billing', 5, 1),
  ('GPS / Live Tracking', 'Current location, speed, ETA, and last ping visibility for every active truck.', '/admin/tracking', 6, 1),
  ('Control Room Alerts', 'Delay, breakdown, compliance breach, and reassignment escalations.', '/admin/alerts', 7, 1)
ON DUPLICATE KEY UPDATE
  description = VALUES(description),
  route_path = VALUES(route_path),
  sort_order = VALUES(sort_order),
  is_active = VALUES(is_active);

-- ------------------------------------
-- SAMPLE VEHICLES
-- ------------------------------------
INSERT INTO vehicles (
  registration_number, fleet_code, model_name, truck_type, status, fuel_type, capacity_tonnes, year_of_manufacture, colour,
  mot_expiry, insurance_expiry, road_tax_expiry, current_location, speed_kph, last_ping_at, next_service_due
) VALUES
  ('MX22KHT', 'FLT-101', 'Mercedes Actros 2545', 'Curtainsider', 'in_transit', 'Diesel', 26.00, 2022, 'White', DATE_ADD(CURDATE(), INTERVAL 210 DAY), DATE_ADD(CURDATE(), INTERVAL 160 DAY), DATE_ADD(CURDATE(), INTERVAL 120 DAY), 'M6 Northbound, Stoke-on-Trent', 58.0, DATE_SUB(NOW(), INTERVAL 2 MINUTE), DATE_ADD(CURDATE(), INTERVAL 18 DAY)),
  ('KT21BZN', 'FLT-102', 'DAF XF 530', 'Box Van', 'stopped', 'Diesel', 18.00, 2021, 'Blue', DATE_ADD(CURDATE(), INTERVAL 35 DAY), DATE_ADD(CURDATE(), INTERVAL 80 DAY), DATE_ADD(CURDATE(), INTERVAL 48 DAY), 'Birmingham fuel stop', 0.0, DATE_SUB(NOW(), INTERVAL 5 MINUTE), DATE_ADD(CURDATE(), INTERVAL 7 DAY)),
  ('PX71UTR', 'FLT-103', 'Volvo FH 460', 'Refrigerated', 'in_transit', 'Diesel', 24.00, 2021, 'Silver', DATE_ADD(CURDATE(), INTERVAL 15 DAY), DATE_ADD(CURDATE(), INTERVAL 24 DAY), DATE_ADD(CURDATE(), INTERVAL 95 DAY), 'Leeds outer ring', 34.0, DATE_SUB(NOW(), INTERVAL 9 MINUTE), DATE_ADD(CURDATE(), INTERVAL 3 DAY)),
  ('NV23LQP', 'FLT-104', 'Scania R450', 'Flatbed', 'planned', 'Diesel', 28.00, 2023, 'Red', DATE_ADD(CURDATE(), INTERVAL 300 DAY), DATE_ADD(CURDATE(), INTERVAL 220 DAY), DATE_ADD(CURDATE(), INTERVAL 180 DAY), 'Avonmouth yard', 12.0, DATE_SUB(NOW(), INTERVAL 3 MINUTE), DATE_ADD(CURDATE(), INTERVAL 26 DAY))
ON DUPLICATE KEY UPDATE
  current_location = VALUES(current_location),
  speed_kph = VALUES(speed_kph),
  last_ping_at = VALUES(last_ping_at),
  status = VALUES(status);

-- ------------------------------------
-- SAMPLE TRAILERS / TROLLEYS
-- ------------------------------------
INSERT INTO trailers (
  trailer_code, registration_number, trailer_type, capacity_tonnes, status, current_location
) VALUES
  ('TRL-501', 'TRL501', 'Curtainsider trailer', 26.00, 'in_use', 'M6 Northbound, Stoke-on-Trent'),
  ('TRL-502', 'TRL502', 'Box trailer', 18.00, 'planned', 'Birmingham yard'),
  ('TRL-503', 'TRL503', 'Refrigerated trailer', 24.00, 'in_use', 'Leeds outer ring'),
  ('TRL-504', 'TRL504', 'Flatbed trailer', 28.00, 'planned', 'Avonmouth yard')
ON DUPLICATE KEY UPDATE
  trailer_type = VALUES(trailer_type),
  capacity_tonnes = VALUES(capacity_tonnes),
  status = VALUES(status),
  current_location = VALUES(current_location);

-- ------------------------------------
-- SAMPLE ROUTES
-- ------------------------------------
INSERT INTO routes (
  route_code, origin_hub, destination_hub, distance_km, toll_estimate_gbp, standard_eta_hours, status
) VALUES
  ('LON-MAN', 'London', 'Manchester', 335, 124.00, 4.6, 'active'),
  ('BHM-GLA', 'Birmingham', 'Glasgow', 470, 166.00, 6.8, 'planned'),
  ('LDS-LON', 'Leeds', 'London', 315, 118.00, 4.4, 'blocked'),
  ('BRS-EDH', 'Bristol', 'Edinburgh', 615, 202.00, 8.9, 'approved')
ON DUPLICATE KEY UPDATE
  destination_hub = VALUES(destination_hub),
  status = VALUES(status);

-- ------------------------------------
-- SAMPLE DRIVERS
-- ------------------------------------
INSERT INTO drivers (
  employee_code, full_name, phone, license_number, license_expiry, medical_expiry,
  onboarding_status, shift_status, compliance_status, home_depot
) VALUES
  ('DRV-201', 'Ethan Clarke', '07700123451', 'UK-LIC-001', DATE_ADD(CURDATE(), INTERVAL 300 DAY), DATE_ADD(CURDATE(), INTERVAL 120 DAY), 'active', 'ready', 'clear', 'London'),
  ('DRV-202', 'Oliver Smith', '07700123452', 'UK-LIC-002', DATE_ADD(CURDATE(), INTERVAL 210 DAY), DATE_ADD(CURDATE(), INTERVAL 60 DAY), 'active', 'review', 'review', 'Birmingham'),
  ('DRV-203', 'Noah Hughes', '07700123453', 'UK-LIC-003', DATE_ADD(CURDATE(), INTERVAL 180 DAY), DATE_SUB(CURDATE(), INTERVAL 1 DAY), 'active', 'review', 'blocked', 'Leeds'),
  ('DRV-204', 'Jack Turner', '07700123454', 'UK-LIC-004', DATE_ADD(CURDATE(), INTERVAL 420 DAY), DATE_ADD(CURDATE(), INTERVAL 180 DAY), 'ready', 'ready', 'clear', 'Liverpool')
ON DUPLICATE KEY UPDATE
  phone = VALUES(phone),
  compliance_status = VALUES(compliance_status),
  shift_status = VALUES(shift_status);

-- ------------------------------------
-- SAMPLE DRIVER DOCUMENTS
-- ------------------------------------
INSERT INTO driver_documents (
  driver_id, document_type, document_number, expiry_date, verification_status
) VALUES
  ((SELECT id FROM drivers WHERE employee_code = 'DRV-201'), 'Tacho card', 'TC-201', DATE_ADD(CURDATE(), INTERVAL 8 DAY), 'expiring'),
  ((SELECT id FROM drivers WHERE employee_code = 'DRV-201'), 'Medical certificate', 'MC-201', DATE_ADD(CURDATE(), INTERVAL 120 DAY), 'valid'),
  ((SELECT id FROM drivers WHERE employee_code = 'DRV-202'), 'Driver CPC', 'CPC-202', DATE_ADD(CURDATE(), INTERVAL 3 DAY), 'expiring'),
  ((SELECT id FROM drivers WHERE employee_code = 'DRV-202'), 'Medical certificate', 'MC-202', DATE_ADD(CURDATE(), INTERVAL 60 DAY), 'valid'),
  ((SELECT id FROM drivers WHERE employee_code = 'DRV-203'), 'Medical certificate', 'MC-203', DATE_SUB(CURDATE(), INTERVAL 1 DAY), 'expired'),
  ((SELECT id FROM drivers WHERE employee_code = 'DRV-204'), 'Right to work', 'RTW-204', DATE_ADD(CURDATE(), INTERVAL 360 DAY), 'valid');

-- ------------------------------------
-- SAMPLE TRIPS
-- ------------------------------------
INSERT INTO trips (
  trip_code, route_id, vehicle_id, trailer_id, driver_id, client_name, dispatch_status, priority_level,
  planned_departure, eta, dock_window, pod_status, freight_amount_gbp
) VALUES
  (
    'LON-MAN-204',
    (SELECT id FROM routes WHERE route_code = 'LON-MAN'),
    (SELECT id FROM vehicles WHERE registration_number = 'MX22KHT'),
    (SELECT id FROM trailers WHERE trailer_code = 'TRL-501'),
    (SELECT id FROM drivers WHERE employee_code = 'DRV-201'),
    'Northshore Retail',
    'loading',
    'priority',
    DATE_ADD(NOW(), INTERVAL 2 HOUR),
    DATE_ADD(NOW(), INTERVAL 7 HOUR),
    '17:45-18:20',
    'verified',
    5800.00
  ),
  (
    'BHM-GLA-118',
    (SELECT id FROM routes WHERE route_code = 'BHM-GLA'),
    (SELECT id FROM vehicles WHERE registration_number = 'KT21BZN'),
    (SELECT id FROM trailers WHERE trailer_code = 'TRL-502'),
    (SELECT id FROM drivers WHERE employee_code = 'DRV-202'),
    'Apex Electronics UK',
    'planned',
    'standard',
    DATE_ADD(NOW(), INTERVAL 5 HOUR),
    DATE_ADD(NOW(), INTERVAL 11 HOUR),
    '20:00-20:45',
    'pending',
    11200.00
  ),
  (
    'LDS-LON-091',
    (SELECT id FROM routes WHERE route_code = 'LDS-LON'),
    (SELECT id FROM vehicles WHERE registration_number = 'PX71UTR'),
    (SELECT id FROM trailers WHERE trailer_code = 'TRL-503'),
    (SELECT id FROM drivers WHERE employee_code = 'DRV-203'),
    'Eastern Pharma',
    'blocked',
    'critical',
    DATE_SUB(NOW(), INTERVAL 1 HOUR),
    DATE_ADD(NOW(), INTERVAL 4 HOUR),
    'Missed 14:00 slot',
    'pending',
    9240.00
  ),
  (
    'BRS-EDH-233',
    (SELECT id FROM routes WHERE route_code = 'BRS-EDH'),
    (SELECT id FROM vehicles WHERE registration_number = 'NV23LQP'),
    (SELECT id FROM trailers WHERE trailer_code = 'TRL-504'),
    (SELECT id FROM drivers WHERE employee_code = 'DRV-204'),
    'Metro Foods',
    'planned',
    'standard',
    DATE_ADD(NOW(), INTERVAL 7 HOUR),
    DATE_ADD(NOW(), INTERVAL 15 HOUR),
    '21:30-22:15',
    'uploaded',
    7650.00
  )
ON DUPLICATE KEY UPDATE
  dispatch_status = VALUES(dispatch_status),
  eta = VALUES(eta),
  dock_window = VALUES(dock_window);

-- ------------------------------------
-- SAMPLE INVOICES (ALL IN GBP)
-- ------------------------------------
INSERT INTO invoices (
  invoice_no, trip_id, client_name, amount_gbp, issued_at, due_date, payment_status, pod_verified, notes, currency
) VALUES
  ('INV-4821', (SELECT id FROM trips WHERE trip_code = 'LON-MAN-204'), 'Northshore Retail', 5800.00, CURDATE(), DATE_ADD(CURDATE(), INTERVAL 2 DAY), 'pending', 1, 'POD verified', 'GBP'),
  ('INV-4796', (SELECT id FROM trips WHERE trip_code = 'BHM-GLA-118'), 'Apex Electronics UK', 11200.00, DATE_SUB(CURDATE(), INTERVAL 7 DAY), DATE_SUB(CURDATE(), INTERVAL 4 DAY), 'overdue', 1, 'Escalation sent', 'GBP'),
  ('INV-4762', (SELECT id FROM trips WHERE trip_code = 'BRS-EDH-233'), 'Metro Foods', 7650.00, DATE_SUB(CURDATE(), INTERVAL 3 DAY), CURDATE(), 'paid', 1, 'Receipt posted', 'GBP'),
  ('INV-4840', (SELECT id FROM trips WHERE trip_code = 'LDS-LON-091'), 'Eastern Pharma', 9240.00, CURDATE(), DATE_ADD(CURDATE(), INTERVAL 5 DAY), 'hold', 0, 'Waiting POD scan', 'GBP')
ON DUPLICATE KEY UPDATE
  payment_status = VALUES(payment_status),
  pod_verified = VALUES(pod_verified),
  notes = VALUES(notes);

-- ------------------------------------
-- SAMPLE VENDOR PAYOUTS (GBP)
-- ------------------------------------
INSERT INTO vendor_payouts (
  payout_reference, vendor_name, lane_code, amount_gbp, due_date, payout_status, notes
) VALUES
  ('PAY-221', 'TyreHub Services', 'LON-MAN', 4850.00, DATE_ADD(CURDATE(), INTERVAL 1 DAY), 'scheduled', 'Tyre stock replenishment'),
  ('PAY-228', 'North Fuel Network', 'BHM-GLA', 8420.00, CURDATE(), 'processing', 'Fleet fuel card settlement'),
  ('PAY-230', 'Dockside Repairs', 'BRS-EDH', 6100.00, CURDATE(), 'paid', 'Workshop invoice cleared'),
  ('PAY-233', 'M62 Recovery Ltd', 'LDS-LON', 3200.00, DATE_ADD(CURDATE(), INTERVAL 2 DAY), 'hold', 'Waiting breakdown proof')
ON DUPLICATE KEY UPDATE
  payout_status = VALUES(payout_status),
  notes = VALUES(notes);

-- ------------------------------------
-- SAMPLE CONTROL ROOM ALERTS
-- ------------------------------------
INSERT INTO control_room_alerts (
  alert_code, module_name, severity, title, description, trip_id, driver_id, vehicle_id, alert_status, owner_name, created_at
) VALUES
  (
    'ALT-3001',
    'drivers',
    'critical',
    'PX71UTR driver reassignment',
    'A new driver must be confirmed for the Leeds to London trip after a rest-rule breach.',
    (SELECT id FROM trips WHERE trip_code = 'LDS-LON-091'),
    (SELECT id FROM drivers WHERE employee_code = 'DRV-203'),
    (SELECT id FROM vehicles WHERE registration_number = 'PX71UTR'),
    'open',
    'Dispatch desk · Aisha Khan',
    NOW()
  ),
  (
    'ALT-3004',
    'drivers',
    'high',
    'KT21BZN compliance reminder',
    'Release approval is on hold because Driver CPC renewal is pending.',
    (SELECT id FROM trips WHERE trip_code = 'BHM-GLA-118'),
    (SELECT id FROM drivers WHERE employee_code = 'DRV-202'),
    (SELECT id FROM vehicles WHERE registration_number = 'KT21BZN'),
    'watch',
    'Compliance desk · Lewis Ward',
    NOW()
  ),
  (
    'ALT-3010',
    'billing',
    'medium',
    'INV-4840 POD blocker',
    'Billing release is blocked because the POD scan is missing.',
    (SELECT id FROM trips WHERE trip_code = 'LDS-LON-091'),
    NULL,
    NULL,
    'watch',
    'Billing desk · Mia Green',
    NOW()
  ),
  (
    'ALT-3012',
    'tracking',
    'high',
    'M6 congestion watch',
    'ETA review is required because of traffic load on the LON-MAN lane.',
    (SELECT id FROM trips WHERE trip_code = 'LON-MAN-204'),
    (SELECT id FROM drivers WHERE employee_code = 'DRV-201'),
    (SELECT id FROM vehicles WHERE registration_number = 'MX22KHT'),
    'open',
    'Control room · Sam Reed',
    NOW()
  )
ON DUPLICATE KEY UPDATE
  alert_status = VALUES(alert_status),
  description = VALUES(description),
  owner_name = VALUES(owner_name);

-- ------------------------------------
-- PAGE-WISE READY QUERIES
-- ------------------------------------

-- 1. Admin overview stats
SELECT
  (SELECT COUNT(*) FROM vehicles WHERE status IN ('available', 'planned', 'in_transit', 'stopped')) AS fleet_available,
  (SELECT COUNT(*) FROM drivers WHERE shift_status IN ('ready', 'review')) AS drivers_ready,
  (SELECT COUNT(*) FROM trips WHERE dispatch_status IN ('planned', 'loading', 'active', 'blocked')) AS trips_in_motion,
  (SELECT COALESCE(SUM(amount_gbp), 0) FROM invoices WHERE payment_status IN ('pending', 'overdue', 'hold')) AS receivables_at_risk_gbp;

-- 2. Driver management view
SELECT
  d.employee_code,
  d.full_name,
  d.onboarding_status,
  d.compliance_status,
  dd.document_type,
  dd.expiry_date
FROM drivers d
LEFT JOIN driver_documents dd ON dd.driver_id = d.id
ORDER BY d.full_name, dd.expiry_date;

-- 3. Finance management view
SELECT
  invoice_no,
  client_name,
  amount_gbp,
  due_date,
  payment_status
FROM invoices
ORDER BY due_date;

SELECT
  payout_reference,
  vendor_name,
  amount_gbp,
  due_date,
  payout_status
FROM vendor_payouts
ORDER BY due_date;

-- 4. Trip / route planning view
SELECT
  t.trip_code,
  r.origin_hub,
  r.destination_hub,
  v.registration_number,
  d.full_name,
  t.dispatch_status,
  t.dock_window
FROM trips t
LEFT JOIN routes r ON r.id = t.route_id
LEFT JOIN vehicles v ON v.id = t.vehicle_id
LEFT JOIN drivers d ON d.id = t.driver_id
ORDER BY t.planned_departure;

-- 5. Invoicing & billing view
SELECT
  invoice_no,
  client_name,
  amount_gbp,
  payment_status,
  pod_verified,
  notes
FROM invoices
ORDER BY issued_at DESC;

-- 6. GPS / live tracking view
SELECT
  v.registration_number,
  v.current_location,
  v.speed_kph,
  v.last_ping_at,
  d.full_name,
  t.trip_code,
  t.eta
FROM vehicles v
LEFT JOIN trips t ON t.vehicle_id = v.id
LEFT JOIN drivers d ON d.id = t.driver_id
ORDER BY v.last_ping_at DESC;

-- 7. Control room alerts view
SELECT
  alert_code,
  module_name,
  severity,
  title,
  description,
  alert_status,
  owner_name
FROM control_room_alerts
ORDER BY created_at DESC;
