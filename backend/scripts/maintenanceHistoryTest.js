const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cleanMaintenanceHistory, maintenanceCostRows } = require('../utils/maintenanceHistory');

test('history excludes future dates and inspection projections, preserving distinct assets and defects', () => {
  const base = { vehicleId: 1, assetType: 'vehicle', title: 'Safety inspection', dateRaw: '2026-08-12' };
  const rows = [
    { ...base, id: 's1', source: 'service' },
    { ...base, id: 'i1', source: 'inspection' },
    { ...base, id: 't1', vehicleId: null, trailerId: 1, assetType: 'trailer', source: 'trailer_inspection' },
    { ...base, id: 'd1', source: 'defect' },
    { ...base, id: 's2', source: 'service', dateRaw: '2026-10-16' },
    { ...base, id: 's3', source: 'service', dateRaw: '' },
    { ...base, id: 'i2', source: 'inspection', dateRaw: '2026-07-12' }
  ];
  assert.deepEqual(cleanMaintenanceHistory(rows, '2026-09-14').map(r => r.id).sort(), ['d1', 'i2', 's1', 't1']);
});

test('costs separate estimates, missing actuals and assets sharing a registration', () => {
  const base = { vehicleId: 1, assetType: 'vehicle', vehicle: 'REG1', estimatedCostGbp: 500, finalCostGbp: null, billAmountGbp: '' };
  const result = maintenanceCostRows([
    { ...base, status: 'completed' },
    { ...base, status: 'completed', finalCostGbp: 0 },
    { ...base, status: 'booked' },
    { ...base, status: 'cancelled', finalCostGbp: 999 },
    { ...base, status: 'failed', finalCostGbp: 999 },
    { ...base, vehicleId: null, trailerId: 1, assetType: 'trailer', status: 'completed', billAmountGbp: 200 }
  ]);
  assert.equal(result.length, 2);
  const vehicle = result.find(r => r.assetId === 'vehicle:1');
  assert.equal(vehicle.actual, 0);
  assert.equal(vehicle.estimated, 500);
  assert.equal(vehicle.unpricedJobs, 1);
  assert.equal(vehicle.completedJobs, 2);
  assert.equal(vehicle.openJobs, 1);
  assert.equal(result.find(r => r.assetId === 'trailer:1').actual, 200);
});
