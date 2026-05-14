const db = require("../db/connection");

function fmtDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

exports.listCustomers = async (req, res) => {
  try {
    const [[counts]] = await db.query(
      `SELECT COUNT(*) as total,
        SUM(account_status='active') as active,
        SUM(account_status='suspended') as suspended,
        SUM(created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)) as new_this_month
       FROM customers`
    );

    const [rows] = await db.query(
      `SELECT c.id, c.company_name, c.contact_name, c.email, c.phone,
              c.postcode, c.payment_terms_days, c.account_status, c.created_at,
              COUNT(DISTINCT t.id)  AS total_trips,
              COUNT(DISTINCT i.id)  AS total_invoices
       FROM customers c
       LEFT JOIN trips    t ON t.customer_id = c.id
       LEFT JOIN invoices i ON i.customer_id = c.id
       GROUP BY c.id
       ORDER BY c.created_at DESC`
    );

    res.json({
      stats: [
        { label: "Total customers", value: counts.total, tone: "neutral" },
        { label: "Active accounts", value: counts.active, tone: "success" },
        { label: "Suspended", value: counts.suspended, tone: "warning" },
        { label: "New this month", value: counts.new_this_month, tone: "neutral" }
      ],
      customers: rows.map(r => ({
        id: r.id,
        companyName: r.company_name,
        contactName: r.contact_name || "—",
        email: r.email || "—",
        phone: r.phone || "—",
        postcode: r.postcode || "—",
        paymentTerms: `Net ${r.payment_terms_days}`,
        status: r.account_status,
        tone: r.account_status === "active" ? "success" : r.account_status === "suspended" ? "warning" : "neutral",
        totalTrips: r.total_trips,
        totalInvoices: r.total_invoices,
        since: fmtDate(r.created_at)
      }))
    });
  } catch (err) {
    res.status(500).json({ message: "Customer list error", error: err.message });
  }
};

exports.getCustomerById = async (req, res) => {
  try {
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
      `SELECT id, invoice_no, amount_gbp, vat_amount_gbp, due_date, payment_status, pod_verified
       FROM invoices WHERE customer_id = ?
       ORDER BY created_at DESC LIMIT 20`, [id]
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
      postcode: c.postcode,
      vatNumber: c.vat_number,
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
    const {
      company_name, contact_name, email, phone,
      address, postcode, vat_number, payment_terms_days
    } = req.body;

    if (!company_name) {
      return res.status(400).json({ message: "Company name is required." });
    }

    const [result] = await db.query(
      `INSERT INTO customers
         (company_name, contact_name, email, phone, address, postcode, vat_number, payment_terms_days, account_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
      [
        company_name,
        contact_name || null,
        email || null,
        phone || null,
        address || null,
        postcode || null,
        vat_number || null,
        payment_terms_days || 30
      ]
    );

    const [[newCustomer]] = await db.query(
      `SELECT * FROM customers WHERE id = ?`, [result.insertId]
    );

    res.status(201).json({ message: "Customer created.", customer: newCustomer });
  } catch (err) {
    res.status(500).json({ message: "Customer create error", error: err.message });
  }
};

exports.updateCustomer = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      company_name, contact_name, email, phone,
      address, postcode, vat_number, payment_terms_days, account_status
    } = req.body;

    if (!company_name) {
      return res.status(400).json({ message: "Company name is required." });
    }

    const [[existing]] = await db.query(`SELECT id FROM customers WHERE id = ?`, [id]);
    if (!existing) return res.status(404).json({ message: "Customer not found." });

    await db.query(
      `UPDATE customers SET
         company_name=?, contact_name=?, email=?, phone=?,
         address=?, postcode=?, vat_number=?, payment_terms_days=?, account_status=?
       WHERE id=?`,
      [
        company_name,
        contact_name || null,
        email || null,
        phone || null,
        address || null,
        postcode || null,
        vat_number || null,
        payment_terms_days || 30,
        account_status || "active",
        id
      ]
    );

    const [[updated]] = await db.query(`SELECT * FROM customers WHERE id = ?`, [id]);
    res.json({ message: "Customer updated.", customer: updated });
  } catch (err) {
    res.status(500).json({ message: "Customer update error", error: err.message });
  }
};

exports.deleteCustomer = async (req, res) => {
  try {
    const { id } = req.params;
    const [[existing]] = await db.query(`SELECT id FROM customers WHERE id = ?`, [id]);
    if (!existing) return res.status(404).json({ message: "Customer not found." });

    await db.query(`UPDATE customers SET account_status='closed' WHERE id=?`, [id]);
    res.json({ message: "Customer closed." });
  } catch (err) {
    res.status(500).json({ message: "Customer delete error", error: err.message });
  }
};
