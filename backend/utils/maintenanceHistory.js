// Inspection tables also contain projections of completed maintenance services.
// Keep the service record once, while retaining independent inspections/defects.
function cleanMaintenanceHistory(rows, today) {
  const valid = rows.filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.dateRaw || "")
    && row.dateRaw <= today);
  const key = (row) => `${row.assetType}:${row.trailerId || row.vehicleId}:${String(row.title || "").trim().toLowerCase()}:${row.dateRaw}`;
  const services = new Set(valid.filter((row) => ["service", "trailer_service"].includes(row.source)).map(key));
  return valid.filter((row) => !(["inspection", "trailer_inspection"].includes(row.source) && services.has(key(row))))
    .sort((a, b) => b.dateRaw.localeCompare(a.dateRaw) || String(a.id).localeCompare(String(b.id)));
}

function maintenanceCostRows(jobs) {
  const assets = new Map();
  for (const job of jobs) {
    if (["cancelled", "failed"].includes(job.status)) continue;
    const assetId = `${job.assetType}:${job.assetType === "trailer" ? job.trailerId : job.vehicleId}`;
    if (!assets.has(assetId)) assets.set(assetId, { assetId, vehicle: job.vehicle, assetType: job.assetType, actual: 0, estimated: 0, completedJobs: 0, openJobs: 0, unpricedJobs: 0 });
    const row = assets.get(assetId);
    if (job.status === "completed") {
      row.completedJobs += 1;
      const actual = job.finalCostGbp ?? (job.billAmountGbp === "" ? null : job.billAmountGbp);
      if (actual == null) row.unpricedJobs += 1;
      else row.actual += Number(actual);
    } else {
      row.openJobs += 1;
      row.estimated += Number(job.estimatedCostGbp || 0);
    }
  }
  return [...assets.values()].sort((a, b) => b.actual - a.actual || b.estimated - a.estimated);
}

module.exports = { cleanMaintenanceHistory, maintenanceCostRows };
