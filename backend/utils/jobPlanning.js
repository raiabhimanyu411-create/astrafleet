const { dateTimeKey, isDateTimeKey, wallMinutesBetween } = require('./jobDateTimes');

// Stored schedules are London wall times, not browser-local instants.
function validateSchedule(body) {
  const sequence = [
    ['Collection arrival', body.planned_departure], ['Collection departure', body.loading_done_time],
    ['Delivery arrival', body.calculated_arrival], ['Delivery departure', body.calculated_unload_end],
    ...(body.stops || []).flatMap((s, i) => [[`Stop ${i + 2} arrival`, s.planned_arrival], [`Stop ${i + 2} departure`, s.planned_departure]])
  ];
  let previous;
  for (const [label, value] of sequence) {
    if (!value) continue;
    if (!isDateTimeKey(value)) return `${label} must contain a valid UK date and time.`;
    if (previous && wallMinutesBetween(previous[1], value) < 0) return `${label} cannot be before ${previous[0].toLowerCase()}.`;
    previous = [label, value];
  }
  return '';
}

function normalisePlan(body) {
  const result = { ...body };
  for (const key of ['planned_departure', 'loading_done_time', 'calculated_arrival', 'calculated_unload_end', 'delivery_deadline']) {
    result[key] = body[key] ? dateTimeKey(body[key]) : null;
  }
  const loading = wallMinutesBetween(body.planned_departure, body.loading_done_time);
  const unloading = wallMinutesBetween(body.calculated_arrival, body.calculated_unload_end);
  if (loading !== null && loading >= 0) result.loading_duration_mins = loading;
  if (unloading !== null && unloading >= 0) result.unloading_duration_mins = unloading;
  const stops = body.stops || [];
  const lastDeparture = stops.length ? stops[stops.length - 1].planned_departure : body.calculated_unload_end;
  const total = wallMinutesBetween(body.planned_departure, lastDeparture);
  // Never carry a stale total after a date/stop edit, or assume missing stop dwell time.
  result.total_job_duration_mins = total !== null && total >= 0 ? total : null;
  return result;
}

function mergeJobUpdate(existing, patch, stops) {
  return { ...existing, freight_amount: existing.freight_amount_gbp, stops, ...patch };
}
module.exports = { validateSchedule, normalisePlan, mergeJobUpdate };
