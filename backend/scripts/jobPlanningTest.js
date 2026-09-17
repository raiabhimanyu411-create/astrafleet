const test = require('node:test');
const assert = require('node:assert/strict');
const { validateSchedule, normalisePlan, mergeJobUpdate } = require('../utils/jobPlanning');

test('validates the complete collection, primary drop and extra-stop sequence', () => {
  assert.match(validateSchedule({
    planned_departure: '2026-09-17T08:00', loading_done_time: '2026-09-17T09:00',
    calculated_arrival: '2026-09-17T11:00', calculated_unload_end: '2026-09-17T11:30',
    stops: [{ planned_arrival: '2026-09-17T11:15', planned_departure: '2026-09-17T12:00' }]
  }), /Stop 2 arrival cannot be before delivery departure/);
});

test('derives durations from UK schedule instead of carrying stale values', () => {
  const plan = normalisePlan({ planned_departure: '2026-09-17T08:00', loading_done_time: '2026-09-17T09:00', calculated_arrival: '2026-09-17T11:00', calculated_unload_end: '2026-09-17T11:45', loading_duration_mins: 999, unloading_duration_mins: 999, total_job_duration_mins: 999, stops: [] });
  assert.equal(plan.loading_duration_mins, 60);
  assert.equal(plan.unloading_duration_mins, 45);
  assert.equal(plan.total_job_duration_mins, 225);
});

test('partial updates retain existing required fields and missing revenue', () => {
  const merged = mergeJobUpdate({ client_name: 'Client', freight_amount_gbp: null, pickup_address: 'A' }, { pickup_address: 'B' }, [{ id: 1 }]);
  assert.equal(merged.client_name, 'Client');
  assert.equal(merged.freight_amount, null);
  assert.deepEqual(merged.stops, [{ id: 1 }]);
});
