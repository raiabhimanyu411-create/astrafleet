const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const database = `astrafleet_jobs_test_${Date.now()}`;
const base = { host: process.env.DB_HOST || 'localhost', user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || '' };
function response() { return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } }; }
async function call(handler, request) { const res = response(); await handler({ body: {}, params: {}, query: {}, headers: {}, socket: {}, sessionUser: { id: 1, name: 'Test Admin', role: 'admin' }, ...request }, res); return res; }

(async () => {
  const admin = await mysql.createConnection(base);
  let db;
  try {
    await admin.query(`CREATE DATABASE \`${database}\``);
    const schemaDb = await mysql.createConnection({ ...base, database, multipleStatements: true });
    await schemaDb.query(fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8'));
    await schemaDb.end();
    process.env.DB_NAME = database;
    db = require('../db/connection');
    const jobs = require('../controllers/jobController');

    let res = await call(jobs.createJob, { body: {
      client_name: 'Lifecycle Client', pickup_address: 'London SW1A 1AA', drop_address: 'Manchester M2 4AA',
      planned_departure: '2026-09-17T08:00', loading_done_time: '2026-09-17T09:00',
      calculated_arrival: '2026-09-17T13:00', calculated_unload_end: '2026-09-17T13:45',
      estimated_distance_km: 320, estimated_eta_mins: 240, freight_amount: null,
      load_description: 'Test load', reference: 'LIFE-1', stops: []
    } });
    assert.equal(res.statusCode, 201, JSON.stringify(res.body));
    const id = res.body.job.id;

    res = await call(jobs.listJobs, { query: {} });
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    let job = res.body.jobs.find(item => item.id === id);
    assert(job);
    assert.equal(job.departureRaw, '2026-09-17T08:00');
    assert.equal(job.totalJobDurationMins, 345);
    assert.equal(job.profitLossValue, null, 'missing freight must not become zero revenue');

    res = await call(jobs.updateJob, { params: { id }, body: {
      require_planned: true, pickup_address: 'London SW1A 1AA', drop_address: 'Birmingham B1 1AA',
      planned_departure: '2026-09-18T22:30', loading_done_time: '2026-09-18T23:15',
      calculated_arrival: '2026-09-19T01:15', calculated_unload_end: '2026-09-19T02:00', stops: []
    } });
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    const [[stored]] = await db.query('SELECT * FROM trips WHERE id=?', [id]);
    assert.equal(stored.planned_departure.slice(0, 16).replace(' ', 'T'), '2026-09-18T22:30');
    assert.equal(Number(stored.loading_duration_mins), 45);
    assert.equal(Number(stored.unloading_duration_mins), 45);
    assert.equal(Number(stored.total_job_duration_mins), 210);
    assert.equal(stored.estimated_distance_km, null, 'changed route must invalidate stale distance');

    res = await call(jobs.updateJob, { params: { id }, body: { calculated_arrival: '2026-09-18T22:00' } });
    assert.equal(res.statusCode, 400, 'invalid chronology must be rejected');
    console.log('Job lifecycle integration passed: UK overnight times, derived durations, partial update, stale-route invalidation, missing revenue, chronology.');
  } finally {
    if (db) await db.end();
    await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
    await admin.end();
  }
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
