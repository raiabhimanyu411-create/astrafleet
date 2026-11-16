// Planned job cost for the job form preview. Same rules as the saved job, job list and job detail
// (calcJobEconomics in backend/controllers/jobController.js) — change both together.
// backend/scripts/jobCostParityTest.js checks the two give the same numbers.
//   Fuel: (miles + empty running miles) x fuel cost per mile, using the truck's own mpg when it has one.
//   AdBlue: same miles x AdBlue per mile. Planned tolls / charges (Dartford, ULEZ/CAZ, DVS) are added.
//   Time: the planned schedule, else travel + loading + unloading, plus empty running at the average speed.
//   Driver and truck cost: hours x hourly rate. Truck cost is always charged.
//   Overheads: % of the cost above. Suggested price: cost plus the markup % from Settings.
const KM_TO_MILES = 0.621371;
const LITRES_PER_GALLON = 4.546;

const round2 = value => Math.round(value * 100) / 100;
const validMins = value => value != null && value !== "" && Number.isFinite(Number(value)) && Number(value) >= 0;

const optional = value => (Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : 0);

export function estimateJobCost({ distanceKm, plannedMins = null, fallbackMins = null, settings, vehicleMpg = null, plannedCharges = 0 }) {
  if (!settings) return null;
  const keys = ["mpg", "fuel_price_per_litre", "driver_rate_per_hour", "fleet_cost_per_hour", "margin_pct"];
  if (!keys.every(key => Number.isFinite(Number(settings[key])) && Number(settings[key]) >= 0) || Number(settings.mpg) <= 0) return null;
  if (distanceKm == null || !Number.isFinite(Number(distanceKm)) || Number(distanceKm) < 0) return null;

  const durationSource = validMins(plannedMins) ? "planned" : validMins(fallbackMins) ? "fallback" : null;
  if (!durationSource) return null;
  const distanceMiles = Number(distanceKm) * KM_TO_MILES;
  const mpg = optional(vehicleMpg) || Number(settings.mpg);
  const emptyMiles = distanceMiles * optional(settings.empty_running_pct) / 100;
  const avgSpeed = optional(settings.avg_speed_mph);
  const emptyMins = emptyMiles > 0 && avgSpeed > 0 ? Math.round(emptyMiles / avgSpeed * 60) : 0;
  const totalMins = Number(durationSource === "planned" ? plannedMins : fallbackMins) + emptyMins;
  const runMiles = distanceMiles + emptyMiles;
  const fuelCostPerMile = (LITRES_PER_GALLON / mpg) * Number(settings.fuel_price_per_litre);
  const fuelCost = runMiles * fuelCostPerMile;
  const adblueCost = runMiles * optional(settings.adblue_cost_per_mile);
  const chargesCost = optional(plannedCharges);
  const totalHours = totalMins / 60;
  const driverCost = totalHours * Number(settings.driver_rate_per_hour);
  const fleetCost = totalHours * Number(settings.fleet_cost_per_hour);
  const overheadRate = optional(settings.overhead_pct) / 100;
  const directCost = fuelCost + adblueCost + driverCost + fleetCost + chargesCost;
  const overheadCost = directCost * overheadRate;
  const totalCost = directCost + overheadCost;
  const suggestedPrice = totalCost * (1 + Number(settings.margin_pct) / 100);

  return {
    durationSource,
    totalMins,
    distanceMiles: Math.round(distanceMiles * 10) / 10,
    fuelCostPerMile: round2(fuelCostPerMile),
    fuelCost: round2(fuelCost),
    driverCost: round2(driverCost),
    fleetCost: round2(fleetCost),
    adblueCost: round2(adblueCost),
    chargesCost: round2(chargesCost),
    overheadCost: round2(overheadCost),
    emptyMiles: Math.round(emptyMiles * 10) / 10,
    mpgUsed: mpg,
    fleetCostPerHour: Number(settings.fleet_cost_per_hour),
    totalCost: round2(totalCost),
    suggestedPrice: round2(suggestedPrice)
  };
}
