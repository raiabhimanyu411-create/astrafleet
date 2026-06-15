const db = require("../db/connection");
const { buildChangeSet, logActivity } = require("../utils/auditLogger");

function fmtDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}
function fmtAmount(n) {
  return n != null
    ? `£${Number(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : "—";
}

let customerSchemaReady = false;

async function addColumnIfMissing(table, column, definition) {
  const [rows] = await db.query(`SHOW COLUMNS FROM ${table} LIKE ?`, [column]);
  if (rows.length === 0) {
    try {
      await db.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    } catch (error) {
      if (error.code !== "ER_DUP_FIELDNAME") throw error;
    }
  }
}

async function ensureCustomerSchema() {
  if (customerSchemaReady) return;
  await addColumnIfMissing("trips", "customer_id", "INT DEFAULT NULL");
  await addColumnIfMissing("customers", "billing_address", "TEXT DEFAULT NULL");
  await addColumnIfMissing("customers", "saved_pickup_addresses", "TEXT DEFAULT NULL");
  await addColumnIfMissing("customers", "saved_drop_addresses", "TEXT DEFAULT NULL");
  await addColumnIfMissing("customers", "tax_details", "VARCHAR(160) DEFAULT NULL");
  await addColumnIfMissing("customers", "credit_limit_gbp", "DECIMAL(12,2) DEFAULT NULL");
  await addColumnIfMissing("customers", "rate_contract", "TEXT DEFAULT NULL");
  customerSchemaReady = true;
}

exports.listCustomers = async (req, res) => {
  try {
    await ensureCustomerSchema();

    const [[counts]] = await db.query(
      `SELECT COUNT(*) as total,
        COALESCE(SUM(account_status='active'), 0) as active,
        COALESCE(SUM(account_status='suspended'), 0) as suspended,
        COALESCE(SUM(account_status='closed'), 0) as closed,
        COALESCE(SUM(created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)), 0) as new_this_month
       FROM customers`
    );
    const [[totals]] = await db.query(
      `SELECT
        COALESCE(SUM(i.amount_gbp), 0) as billed,
        COALESCE(SUM(CASE WHEN i.payment_status='paid' THEN i.amount_gbp ELSE 0 END), 0) as paid,
        COALESCE(SUM(CASE WHEN i.payment_status!='paid' THEN i.amount_gbp ELSE 0 END), 0) as outstanding,
        COALESCE(SUM(CASE WHEN i.payment_status='overdue' THEN i.amount_gbp ELSE 0 END), 0) as overdue
       FROM invoices i`
    );

    const [rows] = await db.query(
      `SELECT c.id, c.company_name, c.contact_name, c.email, c.phone,
              c.address, c.billing_address, c.saved_pickup_addresses, c.saved_drop_addresses,
              c.postcode, c.vat_number, c.tax_details, c.payment_terms_days, c.credit_limit_gbp,
              c.rate_contract, c.account_status, c.created_at,
              COALESCE(t.total_trips, 0) AS total_trips,
              COALESCE(t.last_trip_at, NULL) AS last_trip_at,
              COALESCE(i.total_invoices, 0) AS total_invoices,
              COALESCE(i.billed_amount, 0) AS billed_amount,
              COALESCE(i.outstanding_amount, 0) AS outstanding_amount,
              COALESCE(i.overdue_amount, 0) AS overdue_amount,
              COALESCE(i.last_invoice_at, NULL) AS last_invoice_at
       FROM customers c
       LEFT JOIN (
          SELECT customer_id, COUNT(*) AS total_trips, MAX(created_at) AS last_trip_at
          FROM trips GROUP BY customer_id
       ) t ON t.customer_id = c.id
       LEFT JOIN (
          SELECT t.customer_id,
                 COUNT(i.id) AS total_invoices,
                 SUM(i.amount_gbp) AS billed_amount,
                 SUM(CASE WHEN i.payment_status!='paid' THEN i.amount_gbp ELSE 0 END) AS outstanding_amount,
                 SUM(CASE WHEN i.payment_status='overdue' THEN i.amount_gbp ELSE 0 END) AS overdue_amount,
                 MAX(i.created_at) AS last_invoice_at
          FROM invoices i
          INNER JOIN trips t ON t.id = i.trip_id
          WHERE t.customer_id IS NOT NULL
          GROUP BY t.customer_id
       ) i ON i.customer_id = c.id
       ORDER BY c.created_at DESC`
    );

    res.json({
      stats: [
        { label: "Total customers", value: counts.total, description: "All customer accounts.", change: "Live from database", tone: "neutral" },
        { label: "Active accounts", value: counts.active, description: "Open for bookings.", change: "Account ready", tone: "success" },
        { label: "Suspended", value: counts.suspended, description: "Paused from new work.", change: "Needs review", tone: "warning" },
        { label: "New this month", value: counts.new_this_month, description: "Recently onboarded.", change: "30 day window", tone: "neutral" }
      ],
      accountHealth: [
        { label: "Total billed", value: fmtAmount(totals.billed), description: "Invoice value across customers.", change: "GBP", tone: "neutral" },
        { label: "Collected", value: fmtAmount(totals.paid), description: "Paid invoice value.", change: "Cash in", tone: "success" },
        { label: "Outstanding", value: fmtAmount(totals.outstanding), description: "Unpaid customer balance.", change: "Follow up", tone: "warning" },
        { label: "Overdue exposure", value: fmtAmount(totals.overdue), description: "Past due receivables.", change: "Risk", tone: Number(totals.overdue) > 0 ? "danger" : "success" }
      ],
      customers: rows.map(r => ({
        id: r.id,
        companyName: r.company_name,
        contactName: r.contact_name || "—",
        email: r.email || "—",
        phone: r.phone || "—",
        address: r.address || "—",
        billingAddress: r.billing_address || "—",
        savedPickupAddresses: r.saved_pickup_addresses || "—",
        savedDropAddresses: r.saved_drop_addresses || "—",
        postcode: r.postcode || "—",
        vatNumber: r.vat_number || "—",
        taxDetails: r.tax_details || "—",
        paymentTermsDays: r.payment_terms_days || 30,
        paymentTerms: `Net ${r.payment_terms_days}`,
        creditLimitRaw: r.credit_limit_gbp ?? "",
        creditLimit: fmtAmount(r.credit_limit_gbp),
        rateContract: r.rate_contract || "—",
        status: r.account_status,
        tone: r.account_status === "active" ? "success" : r.account_status === "suspended" ? "warning" : "neutral",
        totalTrips: r.total_trips,
        totalInvoices: r.total_invoices,
        billedAmount: fmtAmount(r.billed_amount),
        billedValue: Number(r.billed_amount || 0),
        outstandingAmount: fmtAmount(r.outstanding_amount),
        outstandingValue: Number(r.outstanding_amount || 0),
        overdueAmount: fmtAmount(r.overdue_amount),
        overdueValue: Number(r.overdue_amount || 0),
        lastActivity: fmtDate(r.last_invoice_at || r.last_trip_at || r.created_at),
        atRisk: Number(r.overdue_amount || 0) > 0 || r.account_status !== "active",
        since: fmtDate(r.created_at)
      }))
    });
  } catch (err) {
    res.status(500).json({ message: "Customer list error", error: err.message });
  }
};

exports.updateCustomerStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { account_status } = req.body;
    const valid = ["active", "suspended", "closed"];
    if (!valid.includes(account_status)) {
      return res.status(400).json({ message: "Invalid customer status." });
    }

    const [result] = await db.query(
      `UPDATE customers SET account_status=? WHERE id=?`,
      [account_status, id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ message: "Customer not found." });
    await logActivity(req, {
      module: "customers",
      action: "status_update",
      entityType: "customer",
      entityId: id,
      details: { account_status }
    });

    res.json({ message: "Customer status updated.", account_status });
  } catch (err) {
    res.status(500).json({ message: "Customer status update error", error: err.message });
  }
};

exports.updateCustomerInline = async (req, res) => {
  try {
    await ensureCustomerSchema();
    const { id } = req.params;
    const [[existing]] = await db.query(`SELECT * FROM customers WHERE id = ?`, [id]);
    if (!existing) return res.status(404).json({ message: "Customer not found." });

    const fieldMap = {
      companyName: "company_name",
      contactName: "contact_name",
      email: "email",
      phone: "phone",
      address: "address",
      billingAddress: "billing_address",
      savedPickupAddresses: "saved_pickup_addresses",
      savedDropAddresses: "saved_drop_addresses",
      postcode: "postcode",
      vatNumber: "vat_number",
      taxDetails: "tax_details",
      creditLimitGbp: "credit_limit_gbp",
      paymentTermsDays: "payment_terms_days",
      rateContract: "rate_contract",
      status: "account_status"
    };
    const validStatus = ["active", "suspended", "closed"];
    const updates = [];
    const values = [];

    Object.entries(req.body || {}).forEach(([field, value]) => {
      const column = fieldMap[field];
      if (!column) return;
      if (field === "status" && !validStatus.includes(value)) return;
      if (field === "companyName" && !String(value || "").trim()) return;
      updates.push(`${column} = ?`);
      values.push(value === "" ? null : value);
    });

    if (!updates.length) {
      return res.status(400).json({ message: "No valid customer fields supplied." });
    }

    await db.query(`UPDATE customers SET ${updates.join(", ")} WHERE id = ?`, [...values, id]);
    const [[updated]] = await db.query(`SELECT * FROM customers WHERE id = ?`, [id]);

    await logActivity(req, {
      module: "customers",
      action: "inline_update",
      entityType: "customer",
      entityId: id,
      entityLabel: updated.company_name,
      details: { changes: buildChangeSet(existing, updated, Object.values(fieldMap)) }
    });

    res.json({ message: "Customer updated." });
  } catch (err) {
    res.status(500).json({ message: "Customer inline update error", error: err.message });
  }
};

exports.getCustomerById = async (req, res) => {
  try {
    await ensureCustomerSchema();

    const { id } = req.params;

    const [[c]] = await db.query(
      `SELECT * FROM customers WHERE id = ?`, [id]
    );
    if (!c) return res.status(404).json({ message: "Customer not found." });

    const [trips] = await db.query(
      `SELECT t.id, t.trip_code, t.dispatch_status, t.priority_level,
              t.planned_departure, t.eta, t.freight_amount_gbp,
              r.origin_hub, r.destination_hub,
              d.full_name as driver_name
       FROM trips t
       LEFT JOIN routes  r ON t.route_id  = r.id
       LEFT JOIN drivers d ON t.driver_id = d.id
       WHERE t.customer_id = ?
       ORDER BY t.created_at DESC LIMIT 20`, [id]
    );

    const [invoices] = await db.query(
      `SELECT i.id, i.invoice_no, i.amount_gbp, i.due_date, i.payment_status, i.pod_verified
       FROM invoices i
       INNER JOIN trips t ON t.id = i.trip_id
       WHERE t.customer_id = ?
       ORDER BY i.created_at DESC LIMIT 20`, [id]
    );

    const dispatchTone = { active: "success", loading: "warning", blocked: "danger", planned: "neutral", completed: "neutral" };
    const payTone = { overdue: "danger", pending: "warning", sent: "warning", hold: "neutral", draft: "neutral", paid: "success" };

    res.json({
      id: c.id,
      companyName: c.company_name,
      contactName: c.contact_name,
      email: c.email,
      phone: c.phone,
      address: c.address,
      billingAddress: c.billing_address || c.address,
      savedPickupAddresses: c.saved_pickup_addresses || "",
      savedDropAddresses: c.saved_drop_addresses || "",
      postcode: c.postcode,
      vatNumber: c.vat_number,
      taxDetails: c.tax_details,
      creditLimitGbp: c.credit_limit_gbp,
      rateContract: c.rate_contract,
      paymentTermsDays: c.payment_terms_days,
      status: c.account_status,
      tone: c.account_status === "active" ? "success" : "warning",
      since: fmtDate(c.created_at),
      trips: trips.map(t => ({
        id: t.id,
        code: t.trip_code,
        lane: t.origin_hub && t.destination_hub ? `${t.origin_hub} → ${t.destination_hub}` : "TBD",
        driver: t.driver_name || "Unassigned",
        departure: fmtDate(t.planned_departure),
        status: t.dispatch_status,
        tone: dispatchTone[t.dispatch_status] || "neutral",
        freight: t.freight_amount_gbp ? `£${Number(t.freight_amount_gbp).toLocaleString("en-GB", { minimumFractionDigits: 2 })}` : "—"
      })),
      invoices: invoices.map(i => ({
        id: i.id,
        invoiceNo: i.invoice_no,
        amount: `£${Number(i.amount_gbp).toLocaleString("en-GB", { minimumFractionDigits: 2 })}`,
        due: fmtDate(i.due_date),
        status: i.payment_status,
        tone: payTone[i.payment_status] || "neutral",
        podVerified: !!i.pod_verified
      }))
    });
  } catch (err) {
    res.status(500).json({ message: "Customer detail error", error: err.message });
  }
};

exports.createCustomer = async (req, res) => {
  try {
    await ensureCustomerSchema();
    const {
      company_name, contact_name, email, phone,
      address, billing_address, saved_pickup_addresses, saved_drop_addresses,
      postcode, vat_number, tax_details, credit_limit_gbp, payment_terms_days, rate_contract
    } = req.body;

    if (!company_name) {
      return res.status(400).json({ message: "Company name is required." });
    }

    const [result] = await db.query(
      `INSERT INTO customers
         (company_name, contact_name, email, phone, address, postcode, vat_number, payment_terms_days, account_status,
          billing_address, saved_pickup_addresses, saved_drop_addresses, tax_details, credit_limit_gbp, rate_contract)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)`,
      [
        company_name,
        contact_name || null,
        email || null,
        phone || null,
        address || null,
        postcode || null,
        vat_number || null,
        payment_terms_days || 30,
        billing_address || null,
        saved_pickup_addresses || null,
        saved_drop_addresses || null,
        tax_details || null,
        credit_limit_gbp || null,
        rate_contract || null
      ]
    );

    const [[newCustomer]] = await db.query(
      `SELECT * FROM customers WHERE id = ?`, [result.insertId]
    );
    await logActivity(req, {
      module: "customers",
      action: "create",
      entityType: "customer",
      entityId: result.insertId,
      entityLabel: company_name,
      details: { company_name, email, phone }
    });

    res.status(201).json({ message: "Customer created.", customer: newCustomer });
  } catch (err) {
    res.status(500).json({ message: "Customer create error", error: err.message });
  }
};

exports.updateCustomer = async (req, res) => {
  try {
    await ensureCustomerSchema();
    const { id } = req.params;
    const {
      company_name, contact_name, email, phone,
      address, billing_address, saved_pickup_addresses, saved_drop_addresses,
      postcode, vat_number, tax_details, credit_limit_gbp, payment_terms_days, account_status, rate_contract
    } = req.body;

    if (!company_name) {
      return res.status(400).json({ message: "Company name is required." });
    }

    const [[existing]] = await db.query(`SELECT * FROM customers WHERE id = ?`, [id]);
    if (!existing) return res.status(404).json({ message: "Customer not found." });

    await db.query(
      `UPDATE customers SET
         company_name=?, contact_name=?, email=?, phone=?,
         address=?, billing_address=?, saved_pickup_addresses=?, saved_drop_addresses=?,
         postcode=?, vat_number=?, tax_details=?, credit_limit_gbp=?, payment_terms_days=?, account_status=?, rate_contract=?
       WHERE id=?`,
      [
        company_name,
        contact_name || null,
        email || null,
        phone || null,
        address || null,
        billing_address || null,
        saved_pickup_addresses || null,
        saved_drop_addresses || null,
        postcode || null,
        vat_number || null,
        tax_details || null,
        credit_limit_gbp || null,
        payment_terms_days || 30,
        account_status || "active",
        rate_contract || null,
        id
      ]
    );

    const [[updated]] = await db.query(`SELECT * FROM customers WHERE id = ?`, [id]);
    await logActivity(req, {
      module: "customers",
      action: "update",
      entityType: "customer",
      entityId: id,
      entityLabel: updated.company_name,
      details: { changes: buildChangeSet(existing, updated, ["company_name", "contact_name", "email", "phone", "address", "billing_address", "saved_pickup_addresses", "saved_drop_addresses", "postcode", "vat_number", "tax_details", "credit_limit_gbp", "payment_terms_days", "account_status", "rate_contract"]) }
    });
    res.json({ message: "Customer updated.", customer: updated });
  } catch (err) {
    res.status(500).json({ message: "Customer update error", error: err.message });
  }
};

exports.deleteCustomer = async (req, res) => {
  try {
    const { id } = req.params;
    const [[existing]] = await db.query(`SELECT id, company_name, account_status FROM customers WHERE id = ?`, [id]);
    if (!existing) return res.status(404).json({ message: "Customer not found." });

    await db.query(`UPDATE customers SET account_status='closed' WHERE id=?`, [id]);
    await logActivity(req, {
      module: "customers",
      action: "delete",
      entityType: "customer",
      entityId: id,
      entityLabel: existing.company_name,
      details: { changes: buildChangeSet(existing, { ...existing, account_status: "closed" }, ["account_status"]) }
    });
    res.json({ message: "Customer closed." });
  } catch (err) {
    res.status(500).json({ message: "Customer delete error", error: err.message });
  }
};
