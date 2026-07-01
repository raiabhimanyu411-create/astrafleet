-- Run this in phpMyAdmin > AstraFleet database > SQL tab

CREATE TABLE IF NOT EXISTS users (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(100) NOT NULL,
  email      VARCHAR(150) NOT NULL UNIQUE,
  password   VARCHAR(255) NOT NULL,
  role       ENUM('admin', 'driver', 'employee') NOT NULL DEFAULT 'driver',
  employee_code VARCHAR(40) DEFAULT NULL,
  phone      VARCHAR(30) DEFAULT NULL,
  department VARCHAR(80) DEFAULT NULL,
  job_title  VARCHAR(120) DEFAULT NULL,
  access_modules JSON DEFAULT NULL,
  approval_status ENUM('pending', 'active', 'rejected') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS activity_logs (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  actor_user_id INT DEFAULT NULL,
  actor_name    VARCHAR(120) DEFAULT NULL,
  actor_role    VARCHAR(40) DEFAULT NULL,
  module_key    VARCHAR(60) NOT NULL,
  action_key    VARCHAR(60) NOT NULL,
  entity_type   VARCHAR(80) DEFAULT NULL,
  entity_id     VARCHAR(80) DEFAULT NULL,
  entity_label  VARCHAR(180) DEFAULT NULL,
  reason        TEXT DEFAULT NULL,
  reason_category VARCHAR(60) DEFAULT NULL,
  details       JSON DEFAULT NULL,
  previous_hash CHAR(64) DEFAULT NULL,
  entry_hash    CHAR(64) DEFAULT NULL,
  ip_address    VARCHAR(80) DEFAULT NULL,
  user_agent    VARCHAR(255) DEFAULT NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_activity_created_at (created_at),
  INDEX idx_activity_actor (actor_user_id),
  INDEX idx_activity_module (module_key, action_key)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS user_sessions (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  user_id            INT NOT NULL,
  session_token_hash CHAR(64) NOT NULL,
  role               VARCHAR(40) DEFAULT NULL,
  login_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  logout_at          DATETIME DEFAULT NULL,
  last_activity_at   DATETIME DEFAULT NULL,
  ip_address         VARCHAR(80) DEFAULT NULL,
  user_agent         VARCHAR(255) DEFAULT NULL,
  INDEX idx_sessions_user (user_id),
  INDEX idx_sessions_token (session_token_hash)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS notification_acknowledgements (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  notification_id VARCHAR(120) NOT NULL,
  user_id          INT DEFAULT NULL,
  acknowledged_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_notification_user (notification_id, user_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS vehicles (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  registration_number VARCHAR(20) NOT NULL UNIQUE,
  fleet_code          VARCHAR(30) NOT NULL,
  make                VARCHAR(80) DEFAULT NULL,
  model               VARCHAR(80) DEFAULT NULL,
  model_name          VARCHAR(120) NOT NULL,
  truck_type          VARCHAR(50) NOT NULL,
  status              ENUM('available', 'planned', 'in_transit', 'maintenance', 'stopped') NOT NULL DEFAULT 'available',
  fuel_type           VARCHAR(30) DEFAULT NULL,
  capacity_tonnes     DECIMAL(6,2) DEFAULT NULL,
  year_of_manufacture INT DEFAULT NULL,
  colour              VARCHAR(40) DEFAULT NULL,
  mot_expiry          DATE DEFAULT NULL,
  insurance_expiry    DATE DEFAULT NULL,
  road_tax_expiry     DATE DEFAULT NULL,
  permit_expiry       DATE DEFAULT NULL,
  pollution_expiry    DATE DEFAULT NULL,
  fitness_expiry      DATE DEFAULT NULL,
  odometer_reading    DECIMAL(12,1) DEFAULT NULL,
  current_location    VARCHAR(160) DEFAULT NULL,
  gps_latitude        DECIMAL(10,7) DEFAULT NULL,
  gps_longitude       DECIMAL(10,7) DEFAULT NULL,
  gps_accuracy_m      DECIMAL(8,2) DEFAULT NULL,
  speed_kph           DECIMAL(5,1) DEFAULT 0,
  last_ping_at        DATETIME DEFAULT NULL,
  next_service_due    DATE DEFAULT NULL,
  created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS trailers (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  trailer_code        VARCHAR(40) NOT NULL UNIQUE,
  registration_number VARCHAR(40) NOT NULL UNIQUE,
  trailer_type        VARCHAR(80) NOT NULL,
  capacity_tonnes     DECIMAL(6,2) DEFAULT NULL,
  status              ENUM('available', 'planned', 'in_use', 'maintenance') NOT NULL DEFAULT 'available',
  current_location    VARCHAR(160) DEFAULT NULL,
  created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS routes (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  route_code         VARCHAR(40) NOT NULL UNIQUE,
  origin_hub         VARCHAR(120) NOT NULL,
  destination_hub    VARCHAR(120) NOT NULL,
  distance_km        INT NOT NULL,
  toll_estimate_gbp  DECIMAL(10,2) NOT NULL DEFAULT 0,
  standard_eta_hours DECIMAL(5,1) NOT NULL DEFAULT 0,
  status             ENUM('draft', 'planned', 'approved', 'active', 'blocked') NOT NULL DEFAULT 'planned',
  created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS drivers (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  user_id            INT DEFAULT NULL,
  employee_code      VARCHAR(40) NOT NULL UNIQUE,
  full_name          VARCHAR(120) NOT NULL,
  phone              VARCHAR(30) DEFAULT NULL,
  license_number     VARCHAR(80) NOT NULL,
  license_expiry     DATE NOT NULL,
  medical_expiry     DATE NOT NULL,
  onboarding_status  ENUM('new', 'docs_pending', 'ready', 'active') NOT NULL DEFAULT 'new',
  shift_status       ENUM('ready', 'on_trip', 'rest', 'review') NOT NULL DEFAULT 'review',
  compliance_status  ENUM('clear', 'review', 'blocked') NOT NULL DEFAULT 'review',
  home_depot         VARCHAR(120) DEFAULT NULL,
  address            TEXT DEFAULT NULL,
  postcode           VARCHAR(20) DEFAULT NULL,
  date_of_birth      DATE DEFAULT NULL,
  national_insurance VARCHAR(40) DEFAULT NULL,
  cpc_number         VARCHAR(80) DEFAULT NULL,
  cpc_expiry         DATE DEFAULT NULL,
  tacho_card_number  VARCHAR(80) DEFAULT NULL,
  tacho_card_expiry  DATE DEFAULT NULL,
  emergency_contact_name  VARCHAR(120) DEFAULT NULL,
  emergency_contact_phone VARCHAR(30) DEFAULT NULL,
  bank_sort_code     VARCHAR(20) DEFAULT NULL,
  bank_account_number VARCHAR(30) DEFAULT NULL,
  assigned_vehicle_id INT DEFAULT NULL,
  salary_gbp         DECIMAL(10,2) DEFAULT NULL,
  commission_rate    DECIMAL(5,2) DEFAULT NULL,
  internal_score     INT DEFAULT NULL,
  accident_incident_record TEXT DEFAULT NULL,
  penalty_deduction_record TEXT DEFAULT NULL,
  created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_drivers_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS customers (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  company_name       VARCHAR(160) NOT NULL,
  contact_name       VARCHAR(120) DEFAULT NULL,
  email              VARCHAR(160) DEFAULT NULL,
  phone              VARCHAR(30) DEFAULT NULL,
  address            TEXT DEFAULT NULL,
  billing_address    TEXT DEFAULT NULL,
  saved_pickup_addresses TEXT DEFAULT NULL,
  saved_drop_addresses   TEXT DEFAULT NULL,
  postcode           VARCHAR(20) DEFAULT NULL,
  vat_number         VARCHAR(60) DEFAULT NULL,
  tax_details        VARCHAR(160) DEFAULT NULL,
  credit_limit_gbp   DECIMAL(12,2) DEFAULT NULL,
  rate_contract      TEXT DEFAULT NULL,
  payment_terms_days INT NOT NULL DEFAULT 30,
  account_status     ENUM('active', 'suspended', 'closed') NOT NULL DEFAULT 'active',
  created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS trips (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  trip_code         VARCHAR(40) NOT NULL UNIQUE,
  route_id          INT DEFAULT NULL,
  vehicle_id        INT DEFAULT NULL,
  trailer_id        INT DEFAULT NULL,
  driver_id         INT DEFAULT NULL,
  customer_id       INT DEFAULT NULL,
  client_name       VARCHAR(120) NOT NULL,
  client_phone      VARCHAR(30) DEFAULT NULL,
  dispatch_status   ENUM('planned', 'loading', 'active', 'blocked', 'completed', 'failed', 'cancelled') NOT NULL DEFAULT 'planned',
  priority_level    ENUM('standard', 'priority', 'critical') NOT NULL DEFAULT 'standard',
  planned_departure DATETIME DEFAULT NULL,
  eta               DATETIME DEFAULT NULL,
  eta_updated_at    DATETIME DEFAULT NULL,
  primary_drop_status VARCHAR(40) DEFAULT 'pending',
  primary_drop_completed_at DATETIME DEFAULT NULL,
  actual_departure  DATETIME DEFAULT NULL,
  actual_arrival    DATETIME DEFAULT NULL,
  dock_window       VARCHAR(80) DEFAULT NULL,
  pod_status        ENUM('pending', 'uploaded', 'verified') NOT NULL DEFAULT 'pending',
  driver_job_status VARCHAR(40) DEFAULT 'accepted',
  pickup_address    TEXT DEFAULT NULL,
  drop_address      TEXT DEFAULT NULL,
  load_type         VARCHAR(80) DEFAULT 'general',
  load_weight_kg    DECIMAL(10,2) DEFAULT NULL,
  load_volume_cbm    DECIMAL(10,2) DEFAULT NULL,
  vehicle_type_requirement VARCHAR(80) DEFAULT NULL,
  delivery_deadline  DATETIME DEFAULT NULL,
  load_description  TEXT DEFAULT NULL,
  special_instructions TEXT DEFAULT NULL,
  dispatcher_notes   TEXT DEFAULT NULL,
  delivery_notes    TEXT DEFAULT NULL,
  pod_signature_data LONGTEXT DEFAULT NULL,
  pod_photo_data    LONGTEXT DEFAULT NULL,
  failed_delivery_reason TEXT DEFAULT NULL,
  freight_amount_gbp DECIMAL(10,2) NOT NULL DEFAULT 0,
  deleted_at        DATETIME DEFAULT NULL,
  deleted_by        INT DEFAULT NULL,
  delete_reason     TEXT DEFAULT NULL,
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_trips_route FOREIGN KEY (route_id) REFERENCES routes (id) ON DELETE SET NULL,
  CONSTRAINT fk_trips_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles (id) ON DELETE SET NULL,
  CONSTRAINT fk_trips_trailer FOREIGN KEY (trailer_id) REFERENCES trailers (id) ON DELETE SET NULL,
  CONSTRAINT fk_trips_driver FOREIGN KEY (driver_id) REFERENCES drivers (id) ON DELETE SET NULL,
  CONSTRAINT fk_trips_customer FOREIGN KEY (customer_id) REFERENCES customers (id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS job_stops (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  trip_id         INT NOT NULL,
  stop_order      INT NOT NULL DEFAULT 1,
  stop_type       ENUM('pickup','delivery','waypoint') NOT NULL DEFAULT 'delivery',
  address         TEXT NOT NULL,
  contact_name    VARCHAR(120) DEFAULT NULL,
  contact_phone   VARCHAR(30) DEFAULT NULL,
  planned_arrival DATETIME DEFAULT NULL,
  planned_departure DATETIME DEFAULT NULL,
  actual_arrival  DATETIME DEFAULT NULL,
  status          ENUM('pending','arrived','completed','skipped') NOT NULL DEFAULT 'pending',
  notes           TEXT DEFAULT NULL,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_job_stops_trip (trip_id),
  CONSTRAINT fk_job_stops_trip FOREIGN KEY (trip_id) REFERENCES trips (id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS driver_documents (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  driver_id           INT NOT NULL,
  document_type       VARCHAR(80) NOT NULL,
  document_number     VARCHAR(80) NOT NULL,
  expiry_date         DATE NOT NULL,
  verification_status ENUM('valid', 'expiring', 'expired', 'pending') NOT NULL DEFAULT 'pending',
  created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_driver_documents_driver FOREIGN KEY (driver_id) REFERENCES drivers (id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS vehicle_documents (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  vehicle_id          INT NOT NULL,
  document_type       VARCHAR(80) NOT NULL,
  document_number     VARCHAR(80) DEFAULT NULL,
  expiry_date         DATE NOT NULL,
  verification_status ENUM('valid', 'expiring', 'expired', 'pending') NOT NULL DEFAULT 'pending',
  created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_vehicle_documents_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles (id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS maintenance_records (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  vehicle_id     INT NOT NULL,
  service_date   DATE NOT NULL,
  service_type   VARCHAR(100) NOT NULL,
  description    TEXT DEFAULT NULL,
  cost_gbp       DECIMAL(10,2) NOT NULL DEFAULT 0,
  mileage        INT DEFAULT NULL,
  next_due_date  DATE DEFAULT NULL,
  garage_name    VARCHAR(120) DEFAULT NULL,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_maintenance_records_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles (id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS vehicle_inspections (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  vehicle_id      INT NOT NULL,
  inspection_date DATE NOT NULL,
  inspection_type VARCHAR(80) NOT NULL DEFAULT 'Routine',
  inspector_name  VARCHAR(120) DEFAULT NULL,
  result          ENUM('pass', 'advisory', 'fail') NOT NULL DEFAULT 'pass',
  notes           TEXT DEFAULT NULL,
  next_due        DATE DEFAULT NULL,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_vehicle_inspections_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles (id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS defect_reports (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  vehicle_id  INT NOT NULL,
  driver_id   INT DEFAULT NULL,
  trip_id     INT DEFAULT NULL,
  defect_type VARCHAR(80) NOT NULL,
  description TEXT DEFAULT NULL,
  severity    ENUM('low', 'medium', 'high', 'critical') NOT NULL DEFAULT 'medium',
  reported_by VARCHAR(120) DEFAULT NULL,
  status      ENUM('open', 'in_progress', 'resolved') NOT NULL DEFAULT 'open',
  reported_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  resolved_at DATETIME DEFAULT NULL,
  CONSTRAINT fk_defect_reports_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles (id) ON DELETE CASCADE,
  CONSTRAINT fk_defect_reports_driver FOREIGN KEY (driver_id) REFERENCES drivers (id) ON DELETE SET NULL,
  CONSTRAINT fk_defect_reports_trip FOREIGN KEY (trip_id) REFERENCES trips (id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS driver_shifts (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  driver_id   INT NOT NULL,
  shift_start DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  shift_end   DATETIME DEFAULT NULL,
  total_hours DECIMAL(6,2) DEFAULT NULL,
  status      ENUM('active', 'completed') NOT NULL DEFAULT 'active',
  start_note  VARCHAR(255) DEFAULT NULL,
  end_note    VARCHAR(255) DEFAULT NULL,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_driver_shifts_driver FOREIGN KEY (driver_id) REFERENCES drivers (id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS driver_expenses (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  driver_id    INT NOT NULL,
  trip_id      INT DEFAULT NULL,
  expense_type ENUM('fuel', 'toll', 'parking', 'repair', 'meal', 'other') NOT NULL DEFAULT 'fuel',
  amount_gbp   DECIMAL(10,2) NOT NULL DEFAULT 0,
  notes        VARCHAR(255) DEFAULT NULL,
  receipt_data LONGTEXT DEFAULT NULL,
  expense_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_driver_expenses_driver FOREIGN KEY (driver_id) REFERENCES drivers (id) ON DELETE CASCADE,
  CONSTRAINT fk_driver_expenses_trip FOREIGN KEY (trip_id) REFERENCES trips (id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS driver_walkarounds (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  driver_id  INT NOT NULL,
  trip_id    INT DEFAULT NULL,
  checks     JSON NOT NULL,
  all_clear  TINYINT(1) NOT NULL DEFAULT 0,
  issues     TEXT DEFAULT NULL,
  checked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_walkaround_driver FOREIGN KEY (driver_id) REFERENCES drivers (id) ON DELETE CASCADE,
  CONSTRAINT fk_walkaround_trip FOREIGN KEY (trip_id) REFERENCES trips (id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS driver_odometer_logs (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  driver_id  INT NOT NULL,
  trip_id    INT DEFAULT NULL,
  vehicle_id INT DEFAULT NULL,
  reading_km DECIMAL(10,1) NOT NULL,
  log_type   ENUM('start', 'end') NOT NULL DEFAULT 'start',
  logged_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_odometer_driver FOREIGN KEY (driver_id) REFERENCES drivers (id) ON DELETE CASCADE,
  CONSTRAINT fk_odometer_trip FOREIGN KEY (trip_id) REFERENCES trips (id) ON DELETE SET NULL,
  CONSTRAINT fk_odometer_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles (id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS driver_messages (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  driver_id   INT NOT NULL,
  sender_role ENUM('driver', 'admin', 'dispatch') NOT NULL DEFAULT 'driver',
  sender_name VARCHAR(120) DEFAULT NULL,
  body        TEXT NOT NULL,
  trip_id     INT DEFAULT NULL,
  is_read     TINYINT(1) NOT NULL DEFAULT 0,
  sent_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_msg_driver FOREIGN KEY (driver_id) REFERENCES drivers (id) ON DELETE CASCADE,
  CONSTRAINT fk_msg_trip FOREIGN KEY (trip_id) REFERENCES trips (id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS driver_job_status_events (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  trip_id    INT NOT NULL,
  driver_id  INT DEFAULT NULL,
  status     VARCHAR(40) NOT NULL,
  reason     TEXT DEFAULT NULL,
  source     ENUM('driver', 'dispatch', 'admin', 'system') NOT NULL DEFAULT 'driver',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_driver_job_status_trip (trip_id, created_at),
  CONSTRAINT fk_driver_job_status_trip FOREIGN KEY (trip_id) REFERENCES trips (id) ON DELETE CASCADE,
  CONSTRAINT fk_driver_job_status_driver FOREIGN KEY (driver_id) REFERENCES drivers (id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS invoices (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  invoice_no     VARCHAR(40) NOT NULL UNIQUE,
  trip_id        INT DEFAULT NULL,
  client_name    VARCHAR(120) NOT NULL,
  amount_gbp     DECIMAL(10,2) NOT NULL DEFAULT 0,
  issued_at      DATE NOT NULL,
  due_date       DATE NOT NULL,
  payment_status ENUM('draft', 'sent', 'pending', 'overdue', 'paid', 'hold') NOT NULL DEFAULT 'draft',
  pod_verified   TINYINT(1) NOT NULL DEFAULT 0,
  notes          VARCHAR(255) DEFAULT NULL,
  currency       CHAR(3) NOT NULL DEFAULT 'GBP',
  deleted_at     DATETIME DEFAULT NULL,
  deleted_by     INT DEFAULT NULL,
  delete_reason  TEXT DEFAULT NULL,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_invoices_trip FOREIGN KEY (trip_id) REFERENCES trips (id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS vendor_payouts (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  payout_reference VARCHAR(40) NOT NULL UNIQUE,
  vendor_name      VARCHAR(120) NOT NULL,
  lane_code        VARCHAR(40) DEFAULT NULL,
  amount_gbp       DECIMAL(10,2) NOT NULL DEFAULT 0,
  due_date         DATE NOT NULL,
  payout_status    ENUM('scheduled', 'processing', 'paid', 'hold') NOT NULL DEFAULT 'scheduled',
  notes            VARCHAR(255) DEFAULT NULL,
  deleted_at       DATETIME DEFAULT NULL,
  deleted_by       INT DEFAULT NULL,
  delete_reason    TEXT DEFAULT NULL,
  created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS control_room_alerts (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  alert_code   VARCHAR(40) NOT NULL UNIQUE,
  module_name  ENUM('drivers', 'finance', 'trips', 'billing', 'tracking', 'alerts') NOT NULL,
  severity     ENUM('low', 'medium', 'high', 'critical') NOT NULL DEFAULT 'medium',
  title        VARCHAR(160) NOT NULL,
  description  VARCHAR(255) NOT NULL,
  trip_id      INT DEFAULT NULL,
  driver_id    INT DEFAULT NULL,
  vehicle_id   INT DEFAULT NULL,
  alert_status ENUM('open', 'watch', 'resolved') NOT NULL DEFAULT 'open',
  owner_name   VARCHAR(120) DEFAULT NULL,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_alerts_trip FOREIGN KEY (trip_id) REFERENCES trips (id) ON DELETE SET NULL,
  CONSTRAINT fk_alerts_driver FOREIGN KEY (driver_id) REFERENCES drivers (id) ON DELETE SET NULL,
  CONSTRAINT fk_alerts_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles (id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS admin_pages (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  page_key    ENUM('overview', 'drivers', 'finance', 'trips', 'billing', 'tracking', 'alerts') NOT NULL UNIQUE,
  badge       VARCHAR(120) NOT NULL,
  title       VARCHAR(180) NOT NULL,
  description VARCHAR(255) NOT NULL,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS admin_page_highlights (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  page_id        INT NOT NULL,
  highlight_text VARCHAR(255) NOT NULL,
  sort_order     INT NOT NULL DEFAULT 1,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_admin_page_highlights_page_sort (page_id, sort_order),
  CONSTRAINT fk_admin_page_highlights_page FOREIGN KEY (page_id) REFERENCES admin_pages (id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS admin_modules (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  title       VARCHAR(120) NOT NULL UNIQUE,
  description VARCHAR(255) NOT NULL,
  route_path  VARCHAR(120) NOT NULL,
  sort_order  INT NOT NULL DEFAULT 1,
  is_active   TINYINT(1) NOT NULL DEFAULT 1,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;
