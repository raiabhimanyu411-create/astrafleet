// Sends a job / trip save. If the server says the truck or trailer must not be dispatched (MOT, insurance,
// road tax, inspection or a serious defect), the admin can give a written override reason and it is sent
// once more. Cancelling the prompt keeps the original error so the page shows why it was refused.
export async function withComplianceOverride(send) {
  try {
    return await send({});
  } catch (err) {
    const data = err?.response?.data;
    if (data?.code !== "COMPLIANCE_BLOCKED") throw err;
    const reason = (window.prompt(`${data.message}\n\nTo dispatch anyway, enter the override reason (it is logged):`) || "").trim();
    if (!reason) throw err;
    return send({ compliance_override_reason: reason });
  }
}

// Short label for pick-lists, e.g. " · Do not dispatch: MOT expired".
export function dispatchBlockLabel(asset) {
  const reasons = asset?.dispatch_blockers || [];
  return reasons.length ? ` · Do not dispatch: ${reasons.join(", ")}` : "";
}
