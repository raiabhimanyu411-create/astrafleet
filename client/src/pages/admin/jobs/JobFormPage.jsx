import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { createJob, estimateJobRoute, getJobById, getJobFormData, updateJob } from "../../../api/jobApi";
import { getSettings } from "../../../api/settingsApi";
import { AdminWorkspaceLayout } from "../AdminWorkspaceLayout";

function Field({ label, hint, required, error, children }) {
  return (
    <div className="af-field">
      <label className="af-label">{label}{required && <span style={{ color: "#dc2626" }}> *</span>}</label>
      {children}
      {error && <p className="af-field-error">{error}</p>}
      {hint && <p className="af-hint">{hint}</p>}
    </div>
  );
}

const emptyFields = {
  customer_id: "",
  client_name: "",
  client_phone: "",
  route_id: "",
  pickup_address: "",
  drop_address: "",
  planned_departure: "",
  delivery_deadline: "",
  load_description: "",
  freight_amount: "",
  driver_id: "",
  vehicle_id: "",
  trailer_id: "",
  loading_done_time: "",
  delivery_arrival_time: "",
  delivery_departure_time: "",
  loading_duration_mins: "90",
  unloading_duration_mins: "90"
};
const FLEET_COST_PER_HOUR_GBP = 12.05;

function calcTiming(loadingDoneTime, distanceMiles, loadingMins, unloadingMins, avgSpeedMph) {
  if (!loadingDoneTime || !distanceMiles) return null;
  const departure = new Date(loadingDoneTime);
  if (isNaN(departure.getTime())) return null;
  const travelMins = Math.round((distanceMiles / avgSpeedMph) * 60);
  const arrival = new Date(departure.getTime() + travelMins * 60000);
  const unloadEnd = new Date(arrival.getTime() + (unloadingMins || 90) * 60000);
  const totalMins = (loadingMins || 90) + travelMins + (unloadingMins || 90);
  return { travelMins, arrival, unloadEnd, totalMins };
}

function calcCost(distanceMiles, totalMins, settings) {
  if (!distanceMiles || !settings) return null;
  const fuelCostPerMile = (4.546 / settings.mpg) * settings.fuel_price_per_litre;
  const fuelCost = distanceMiles * fuelCostPerMile;
  const totalHours = (totalMins || 0) / 60;
  const driverCost = totalHours * settings.driver_rate_per_hour;
  const fleetCost = totalHours * FLEET_COST_PER_HOUR_GBP;
  const totalCost = fuelCost + driverCost + fleetCost;
  const suggestedPrice = totalCost * (1 + settings.margin_pct / 100);
  return { fuelCost, driverCost, fleetCost, fleetCostPerHour: FLEET_COST_PER_HOUR_GBP, totalCost, suggestedPrice, fuelCostPerMile };
}

function fmtGBP(n) {
  return `£${Number(n).toFixed(2)}`;
}

function fmtTime(date) {
  if (!date) return "—";
  return date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function fmtMins(mins) {
  if (!mins) return "—";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function toInputDateTime(date) {
  if (!date) return "";
  const next = new Date(date);
  if (Number.isNaN(next.getTime())) return "";
  const offsetMs = next.getTimezoneOffset() * 60000;
  return new Date(next.getTime() - offsetMs).toISOString().slice(0, 16);
}

function toInputTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function combineDateAndTime(dateValue, timeValue) {
  if (!timeValue) return "";
  const date = dateValue ? new Date(dateValue) : new Date();
  if (Number.isNaN(date.getTime())) return "";
  const [hours, minutes] = timeValue.split(":").map(Number);
  date.setHours(hours || 0, minutes || 0, 0, 0);
  return toInputDateTime(date);
}

function addHours(value, hours, extraStops = 0) {
  if (!value || !hours) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  date.setMinutes(date.getMinutes() + Number(hours) * 60 + 30 + extraStops * 30);
  return toInputDateTime(date);
}

function addMinutes(value, minutes, extraStops = 0) {
  if (!value || !minutes) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  date.setMinutes(date.getMinutes() + Number(minutes) + 30 + extraStops * 30);
  return toInputDateTime(date);
}

const emptyStop = { address: "", stop_type: "delivery", contact_name: "", contact_phone: "", planned_arrival: "", notes: "" };

function displayDateTime(value) {
  if (!value) return "Select route and pickup time";
  return new Date(value).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function addressLines(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
}

function getApiErrorMessage(err) {
  const data = err?.response?.data;
  return data?.error || data?.message || err?.message || "Could not save job. Please try again.";
}

function validateJobForm(fields) {
  const errors = {};
  if (!fields.client_name.trim()) errors.client_name = "Enter the client name.";
  if (!fields.pickup_address.trim()) errors.pickup_address = "Enter the pickup address.";
  if (!fields.drop_address.trim()) errors.drop_address = "Enter the delivery address.";
  if (!fields.load_description.trim()) errors.load_description = "Enter the goods or load details.";
  return errors;
}

export function JobFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isEdit = Boolean(id);

  const [formData, setFormData] = useState({ customers: [], drivers: [], vehicles: [], routes: [] });
  const [fields, setFields] = useState(emptyFields);
  const [stops, setStops] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [sysSettings, setSysSettings] = useState(null);
  const [routeEstimate, setRouteEstimate] = useState(null);
  const [estimateBusy, setEstimateBusy] = useState(false);
  const [estimateErr, setEstimateErr] = useState("");

  useEffect(() => {
    async function init() {
      try {
        const [fdRes, stRes] = await Promise.all([getJobFormData(), getSettings()]);
        setFormData(fdRes.data);
        setSysSettings(stRes.data);

        if (isEdit) {
          const jobRes = await getJobById(id);
          const j = jobRes.data;
          setFields({
            customer_id: j.form?.customer_id ? String(j.form.customer_id) : "",
            client_name: j.customer?.name !== "—" ? j.customer?.name || "" : "",
            client_phone: j.customer?.phone !== "—" ? j.customer?.phone || "" : "",
            route_id: j.form?.route_id ? String(j.form.route_id) : "",
            pickup_address: j.route?.pickupAddress || "",
            drop_address: j.route?.dropAddress || "",
            planned_departure: j.form?.planned_departure || "",
            delivery_deadline: j.form?.delivery_deadline || "",
            load_description: j.load?.description !== "—" ? j.load?.description || "" : "",
            freight_amount: j.load?.freight !== "—" ? (j.load?.freight || "").replace("£", "").replace(/,/g, "") : "",
            driver_id: j.form?.driver_id ? String(j.form.driver_id) : "",
            vehicle_id: j.form?.vehicle_id ? String(j.form.vehicle_id) : "",
            trailer_id: j.form?.trailer_id ? String(j.form.trailer_id) : "",
            loading_done_time: j.timing?.loadingDoneTime || "",
            delivery_arrival_time: j.timing?.calculatedArrival || "",
            delivery_departure_time: j.timing?.calculatedUnloadEnd || "",
            loading_duration_mins: j.timing?.loadingDurationMins ? String(j.timing.loadingDurationMins) : "90",
            unloading_duration_mins: j.timing?.unloadingDurationMins ? String(j.timing.unloadingDurationMins) : "90"
          });
          if (!j.form?.route_id && j.route?.distanceKm) {
            setRouteEstimate({
              distanceKm: Number(j.route.distanceKm),
              distanceMiles: Number(j.route.distanceMiles || j.route.distanceKm * 0.621371),
              durationMins: j.route.etaHours ? Math.round(Number(j.route.etaHours) * 60) : null,
              standardEtaHours: j.route.etaHours || null,
              source: "saved-estimate"
            });
          }
          if (j.stops?.length > 0) {
            setStops(j.stops.map(s => ({
              address: s.address || "",
              stop_type: s.type || "delivery",
              contact_name: s.contactName !== "—" ? s.contactName || "" : "",
              contact_phone: s.contactPhone !== "—" ? s.contactPhone || "" : "",
              planned_arrival: "",
              notes: s.notes !== "—" ? s.notes || "" : ""
            })));
          }
        }
      } catch {
        setLoadErr("Could not load form data. Please go back and try again.");
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [id, isEdit]);

  function set(key, value) {
    setSubmitErr("");
    if (["pickup_address", "drop_address", "route_id"].includes(key)) {
      setEstimateErr("");
      setRouteEstimate(null);
    }
    setFieldErrors(prev => ({ ...prev, [key]: "" }));
    setFields(prev => ({ ...prev, [key]: value }));
  }

  function handleCustomerChange(customerId) {
    const customer = formData.customers.find(c => String(c.id) === customerId);
    const pickupOptions = customer ? addressLines(customer.saved_pickup_addresses || customer.address) : [];
    const dropOptions = customer ? addressLines(customer.saved_drop_addresses) : [];
    setFields(prev => ({
      ...prev,
      customer_id: customerId,
      client_name: customer ? customer.company_name : "",
      client_phone: customer ? customer.phone || "" : prev.client_phone,
      pickup_address: customer ? pickupOptions[0] || customer.address || prev.pickup_address : prev.pickup_address,
      drop_address: customer ? dropOptions[0] || prev.drop_address : prev.drop_address
    }));
    setRouteEstimate(null);
    setEstimateErr("");
    setFieldErrors(prev => ({ ...prev, client_name: "", pickup_address: "", drop_address: "" }));
  }

  function handleRouteChange(routeId) {
    const route = formData.routes.find(r => String(r.id) === routeId);
    setFields(prev => {
      const routeStartTime = prev.loading_done_time || prev.planned_departure;
      const suggestedDeadline = route ? addHours(routeStartTime, route.standard_eta_hours) : "";
      return {
        ...prev,
        route_id: routeId,
        pickup_address: route ? route.origin_hub : prev.pickup_address,
        drop_address: route ? route.destination_hub : prev.drop_address,
        delivery_deadline: prev.delivery_deadline || suggestedDeadline
      };
    });
    setRouteEstimate(null);
    setEstimateErr("");
    if (route) setFieldErrors(prev => ({ ...prev, pickup_address: "", drop_address: "" }));
  }

  function handleArrivalChange(value) {
    setFields(prev => {
      const route = formData.routes.find(r => String(r.id) === prev.route_id);
      const routeStartTime = prev.loading_done_time || value;
      const currentValidStops = stops.filter(s => s.address.trim()).length;
      return {
        ...prev,
        planned_departure: value,
        delivery_deadline: prev.delivery_deadline || (route ? addHours(routeStartTime, route.standard_eta_hours, currentValidStops) : "")
      };
    });
  }

  function handleRouteDepartureChange(timeValue) {
    setFields(prev => {
      const value = combineDateAndTime(prev.planned_departure, timeValue);
      const route = formData.routes.find(r => String(r.id) === prev.route_id);
      const currentValidStops = stops.filter(s => s.address.trim()).length;
      const suggestedDeadline = route
        ? addHours(value, route.standard_eta_hours, currentValidStops)
        : routeEstimate?.durationMins
          ? addMinutes(value, routeEstimate.durationMins, currentValidStops)
          : "";
      return {
        ...prev,
        loading_done_time: value,
        delivery_deadline: prev.delivery_deadline || suggestedDeadline
      };
    });
  }

  function handleDeliveryDepartureChange(timeValue) {
    setFields(prev => {
      const fallbackArrival = prev.delivery_arrival_time || timingCalc?.arrival;
      return {
        ...prev,
        delivery_departure_time: combineDateAndTime(fallbackArrival, timeValue)
      };
    });
  }

  const selectedRoute = useMemo(
    () => formData.routes.find(r => String(r.id) === fields.route_id),
    [fields.route_id, formData.routes]
  );
  const selectedCustomer = useMemo(
    () => formData.customers.find(c => String(c.id) === fields.customer_id),
    [fields.customer_id, formData.customers]
  );
  const pickupOptions = useMemo(() => {
    if (!selectedCustomer) return [];
    return addressLines(selectedCustomer.saved_pickup_addresses || selectedCustomer.address);
  }, [selectedCustomer]);
  const dropOptions = useMemo(() => {
    if (!selectedCustomer) return [];
    return addressLines(selectedCustomer.saved_drop_addresses);
  }, [selectedCustomer]);

  const validStops = stops.filter(s => s.address.trim());
  const routeStartTime = fields.loading_done_time || fields.planned_departure;
  const etaPreview = selectedRoute
    ? addHours(routeStartTime, selectedRoute.standard_eta_hours, validStops.length)
    : routeEstimate?.durationMins
      ? addMinutes(routeStartTime, routeEstimate.durationMins, validStops.length)
      : "";

  const distanceMiles = selectedRoute ? selectedRoute.distance_km * 0.621371 : routeEstimate?.distanceMiles || null;
  const avgSpeedMph = sysSettings?.avg_speed_mph || 40;
  const loadingMins = parseInt(fields.loading_duration_mins) || 90;
  const unloadingMins = parseInt(fields.unloading_duration_mins) || 90;

  const timingCalc = useMemo(
    () => calcTiming(fields.loading_done_time, distanceMiles, loadingMins, unloadingMins, avgSpeedMph),
    [fields.loading_done_time, distanceMiles, loadingMins, unloadingMins, avgSpeedMph]
  );
  const manualDeliveryArrival = fields.delivery_arrival_time ? new Date(fields.delivery_arrival_time) : null;
  const manualDeliveryDeparture = fields.delivery_departure_time ? new Date(fields.delivery_departure_time) : null;
  const hasManualDeliveryTimes =
    manualDeliveryArrival && manualDeliveryDeparture &&
    !Number.isNaN(manualDeliveryArrival.getTime()) &&
    !Number.isNaN(manualDeliveryDeparture.getTime()) &&
    manualDeliveryDeparture >= manualDeliveryArrival;
  const estimatedTravelMins = selectedRoute?.standard_eta_hours
    ? Math.round(Number(selectedRoute.standard_eta_hours) * 60)
    : routeEstimate?.durationMins || null;
  const manualTravelMins = hasManualDeliveryTimes && fields.loading_done_time
    ? Math.max(0, Math.round((manualDeliveryArrival - new Date(fields.loading_done_time)) / 60000))
    : null;
  const manualUnloadingMins = hasManualDeliveryTimes
    ? Math.max(0, Math.round((manualDeliveryDeparture - manualDeliveryArrival) / 60000))
    : null;
  const estimatedTotalMins = hasManualDeliveryTimes
    ? loadingMins + manualTravelMins + manualUnloadingMins
    : timingCalc?.totalMins || (estimatedTravelMins ? loadingMins + estimatedTravelMins + unloadingMins : null);

  const costCalc = useMemo(
    () => calcCost(distanceMiles, estimatedTotalMins, sysSettings),
    [distanceMiles, estimatedTotalMins, sysSettings]
  );

  const freightValue = parseFloat(fields.freight_amount) || 0;
  const profitLoss = costCalc ? freightValue - costCalc.totalCost : null;

  async function calculateRouteEstimate() {
    setEstimateErr("");
    setRouteEstimate(null);
    if (!fields.pickup_address.trim() || !fields.drop_address.trim()) {
      setEstimateErr("Enter pickup and delivery addresses with UK postcodes.");
      return;
    }
    setEstimateBusy(true);
    try {
      const res = await estimateJobRoute({
        pickup_address: fields.pickup_address,
        drop_address: fields.drop_address
      });
      setRouteEstimate(res.data);
      setFields(prev => ({
        ...prev,
        delivery_deadline: prev.delivery_deadline || ((prev.loading_done_time || prev.planned_departure) ? addMinutes(prev.loading_done_time || prev.planned_departure, res.data.durationMins, validStops.length) : "")
      }));
    } catch (err) {
      setEstimateErr(err?.response?.data?.message || "Could not calculate distance from postcodes.");
    } finally {
      setEstimateBusy(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitErr("");
    const validationErrors = validateJobForm(fields);
    setFieldErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) {
      setSubmitErr("Please amend the highlighted fields.");
      return;
    }

    const calcArrivalStr = fields.delivery_arrival_time || (timingCalc?.arrival
      ? new Date(timingCalc.arrival.getTime() - timingCalc.arrival.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
      : null);
    const calcUnloadEndStr = fields.delivery_departure_time || (timingCalc?.unloadEnd
      ? new Date(timingCalc.unloadEnd.getTime() - timingCalc.unloadEnd.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
      : null);

    const payload = {
      customer_id: fields.customer_id ? Number(fields.customer_id) : null,
      client_name: fields.client_name || null,
      client_phone: fields.client_phone || null,
      route_id: fields.route_id ? Number(fields.route_id) : null,
      pickup_address: fields.pickup_address || null,
      drop_address: fields.drop_address || null,
      planned_departure: fields.planned_departure || null,
      delivery_deadline: fields.delivery_deadline || etaPreview || null,
      load_type: "general",
      load_description: fields.load_description || null,
      freight_amount: fields.freight_amount ? Number(fields.freight_amount) : null,
      priority_level: "standard",
      driver_id: fields.driver_id ? Number(fields.driver_id) : null,
      vehicle_id: fields.vehicle_id ? Number(fields.vehicle_id) : null,
      trailer_id: fields.trailer_id ? Number(fields.trailer_id) : null,
      loading_done_time: fields.loading_done_time || null,
      loading_duration_mins: loadingMins,
      unloading_duration_mins: unloadingMins,
      estimated_distance_km: selectedRoute ? null : routeEstimate?.distanceKm || null,
      estimated_eta_mins: selectedRoute ? null : routeEstimate?.durationMins || null,
      calculated_arrival: calcArrivalStr,
      calculated_unload_end: calcUnloadEndStr,
      total_job_duration_mins: estimatedTotalMins || null,
      stops: stops.filter(s => s.address.trim()).map(s => ({
        address: s.address.trim(),
        stop_type: s.stop_type,
        contact_name: s.contact_name || null,
        contact_phone: s.contact_phone || null,
        planned_arrival: s.planned_arrival || null,
        notes: s.notes || null
      }))
    };

    setSubmitting(true);
    try {
      if (isEdit) {
        await updateJob(id, payload);
        navigate(`/admin/jobs/${id}`);
      } else {
        const res = await createJob(payload);
        navigate(`/admin/jobs/${res.data.job.id}`);
      }
    } catch (err) {
      setSubmitErr(getApiErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AdminWorkspaceLayout
      badge="Job management"
      title={isEdit ? "Edit job" : "Add job"}
      description="Simple job booking with automatic ETA when a saved route is selected."
      highlights={[]}
    >
      <div className="af-page" style={{ maxWidth: 920 }}>
        <div className="af-back-row">
          <button className="af-back-btn" type="button" onClick={() => navigate(isEdit ? `/admin/jobs/${id}` : "/admin/jobs")}>
            ← Back
          </button>
        </div>

        {loadErr && (
          <div className="state-card error" style={{ marginBottom: 20 }}>
            <span className="state-dot error" />
            <div><strong>Load error</strong><p>{loadErr}</p></div>
          </div>
        )}

        {loading ? (
          <div className="state-card">
            <span className="state-dot loading" />
            <div><strong>Loading...</strong><p>Fetching form data</p></div>
          </div>
        ) : (
          <form className="af-form" onSubmit={handleSubmit} noValidate>
            <div className="af-section">
              <p className="af-section-title">Client details</p>
              <div className="af-grid-2">
                <Field label="Customer account" hint="Optional. Select if this client already exists.">
                  <select className="af-select" value={fields.customer_id} onChange={e => handleCustomerChange(e.target.value)}>
                    <option value="">No account / enter manually</option>
                    {formData.customers.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
                  </select>
                </Field>
                <Field label="Client name" required error={fieldErrors.client_name}>
                  <input className="af-input" type="text" placeholder="e.g. Northline Retail" value={fields.client_name} onChange={e => set("client_name", e.target.value)} aria-invalid={Boolean(fieldErrors.client_name)} />
                </Field>
                <Field label="Contact number">
                  <input className="af-input" type="tel" placeholder="e.g. 07700 900000" value={fields.client_phone} onChange={e => set("client_phone", e.target.value)} />
                </Field>
                {selectedCustomer && (
                  <div style={{ gridColumn: "1 / -1", padding: 12, border: "1px solid #e2e8f0", borderRadius: 8, background: "#f8fafc" }}>
                    <span className="card-label">Auto-filled from customer</span>
                    <p style={{ margin: "5px 0 0", color: "#475569", fontSize: "0.86rem" }}>
                      {selectedCustomer.contact_name || "Contact not set"} · {selectedCustomer.phone || "Phone not set"} · {selectedCustomer.email || "Email not set"}
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="af-section">
              <p className="af-section-title">Trip details</p>
              <div className="af-grid-2">
                <Field label="Saved route" hint="Select a route to auto-fill pickup, delivery, distance, and ETA.">
                  <select className="af-select" value={fields.route_id} onChange={e => handleRouteChange(e.target.value)}>
                    <option value="">Custom pickup and delivery</option>
                    {formData.routes.map(r => (
                      <option key={r.id} value={r.id}>{r.origin_hub} → {r.destination_hub}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Arrival date & time" hint="When the truck reaches pickup/loading.">
                  <input className="af-input" type="datetime-local" value={fields.planned_departure} onChange={e => handleArrivalChange(e.target.value)} />
                </Field>
                <Field label="Departure time" hint="Same date as pickup arrival. Used for ETA and cost.">
                  <input className="af-input" type="time" value={toInputTime(fields.loading_done_time)} onChange={e => handleRouteDepartureChange(e.target.value)} />
                </Field>
                <Field label="Pickup address" required error={fieldErrors.pickup_address}>
                  {pickupOptions.length > 0 && (
                    <select className="af-select" style={{ marginBottom: 8 }} value="" onChange={e => e.target.value && set("pickup_address", e.target.value)}>
                      <option value="">Choose saved pickup address</option>
                      {pickupOptions.map((address, index) => <option key={`${address}-${index}`} value={address}>{address}</option>)}
                    </select>
                  )}
                  <textarea className="af-input" style={{ minHeight: 72, resize: "vertical" }} placeholder="Full pickup address" value={fields.pickup_address} onChange={e => set("pickup_address", e.target.value)} aria-invalid={Boolean(fieldErrors.pickup_address)} />
                </Field>
                <Field label="Delivery address" required error={fieldErrors.drop_address}>
                  {dropOptions.length > 0 && (
                    <select className="af-select" style={{ marginBottom: 8 }} value="" onChange={e => e.target.value && set("drop_address", e.target.value)}>
                      <option value="">Choose saved delivery address</option>
                      {dropOptions.map((address, index) => <option key={`${address}-${index}`} value={address}>{address}</option>)}
                    </select>
                  )}
                  <textarea className="af-input" style={{ minHeight: 72, resize: "vertical" }} placeholder="Full delivery address" value={fields.drop_address} onChange={e => set("drop_address", e.target.value)} aria-invalid={Boolean(fieldErrors.drop_address)} />
                </Field>
                <Field label="Delivery arrival date & time" hint="When the truck reaches the delivery point. Auto-calculated if left blank.">
                  <input className="af-input" type="datetime-local" value={fields.delivery_arrival_time} onChange={e => set("delivery_arrival_time", e.target.value)} />
                </Field>
                <Field label="Delivery departure time" hint="Same date as delivery arrival. Auto-calculated if left blank.">
                  <input className="af-input" type="time" value={toInputTime(fields.delivery_departure_time)} onChange={e => handleDeliveryDepartureChange(e.target.value)} />
                </Field>
              </div>

              <div style={{ marginTop: 16, padding: 16, border: "1px solid #dbeafe", background: "#eff6ff", borderRadius: 8 }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 12 }}>
                  <div>
                    <span className="card-label">Distance</span>
                    <strong style={{ display: "block", color: "#1e3a8a" }}>
                      {selectedRoute?.distance_km
                        ? `${Math.round(selectedRoute.distance_km * 0.621371)} mi`
                        : routeEstimate?.distanceMiles
                          ? `${routeEstimate.distanceMiles} mi`
                          : "Not calculated"}
                    </strong>
                  </div>
                  <div>
                    <span className="card-label">ETA</span>
                    <strong style={{ display: "block", color: "#1e3a8a" }}>
                      {selectedRoute?.standard_eta_hours
                        ? `${selectedRoute.standard_eta_hours}h travel + 30m buffer`
                        : routeEstimate?.durationMins
                          ? `${fmtMins(routeEstimate.durationMins)} travel + 30m buffer`
                          : "Calculate from postcode"}
                    </strong>
                  </div>
                  <div>
                    <span className="card-label">Suggested delivery</span>
                    <strong style={{ display: "block", color: "#1e3a8a" }}>{displayDateTime(etaPreview)}</strong>
                  </div>
                </div>
                {!selectedRoute && (
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
                    <button className="header-action-button" type="button" disabled={estimateBusy} onClick={calculateRouteEstimate}>
                      {estimateBusy ? "Calculating..." : "Calculate distance"}
                    </button>
                    {routeEstimate && (
                      <span style={{ color: "#1e40af", fontSize: "0.84rem", fontWeight: 700 }}>
                        {routeEstimate.pickupPostcode} → {routeEstimate.dropPostcode}
                      </span>
                    )}
                    {estimateErr && <span style={{ color: "#b91c1c", fontSize: "0.84rem", fontWeight: 700 }}>{estimateErr}</span>}
                  </div>
                )}
              </div>

              <div className="af-grid-2" style={{ marginTop: 16 }}>
                <Field label="Delivery deadline" hint="Auto-filled from route ETA. You can change it.">
                  <input className="af-input" type="datetime-local" value={fields.delivery_deadline} onChange={e => set("delivery_deadline", e.target.value)} />
                </Field>
              </div>
            </div>

            <div className="af-section">
              <p className="af-section-title">Load & assignment</p>
              <div className="af-grid-2">
                <Field label="Goods / load details" required error={fieldErrors.load_description}>
                  <textarea className="af-input" style={{ minHeight: 78, resize: "vertical" }} placeholder="e.g. 20 pallets of retail goods" value={fields.load_description} onChange={e => set("load_description", e.target.value)} aria-invalid={Boolean(fieldErrors.load_description)} />
                </Field>
                <Field label="Freight amount (£)">
                  <div className="af-input-prefix-wrap">
                    <span className="af-prefix">£</span>
                    <input className="af-input af-input-prefixed" type="number" min="0" step="0.01" placeholder="e.g. 1800.00" value={fields.freight_amount} onChange={e => set("freight_amount", e.target.value)} />
                  </div>
                </Field>
                <Field label="Assign driver">
                  <select className="af-select" value={fields.driver_id} onChange={e => set("driver_id", e.target.value)}>
                    <option value="">Assign later</option>
                    {formData.drivers.map(d => <option key={d.id} value={d.id}>{d.full_name} · {d.shift_status}</option>)}
                  </select>
                </Field>
                <Field label="Assign vehicle">
                  <select className="af-select" value={fields.vehicle_id} onChange={e => set("vehicle_id", e.target.value)}>
                    <option value="">Assign later</option>
                    {formData.vehicles.map(v => (
                      <option key={v.id} value={v.id}>
                        {v.registration_number} · {v.truck_type || v.model_name || "Truck"} · {v.status}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Assign trailer">
                  <select className="af-select" value={fields.trailer_id} onChange={e => set("trailer_id", e.target.value)}>
                    <option value="">Assign later</option>
                    {(formData.trailers || []).map(t => (
                      <option key={t.id} value={t.id}>
                        {t.registration_number} · {t.trailer_type || "Trailer"} · {t.status}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            </div>

            {/* ── Time Calculation Section ── */}
            <div className="af-section">
              <p className="af-section-title">Time &amp; cost calculation</p>
              <div className="af-grid-2">
                <Field label="Loading duration (minutes)" hint="Default: 90 min. Included in driver cost.">
                  <input
                    className="af-input"
                    type="number"
                    min="15"
                    step="15"
                    placeholder="90"
                    value={fields.loading_duration_mins}
                    onChange={e => set("loading_duration_mins", e.target.value)}
                  />
                </Field>
                <Field label="Unloading duration (minutes)" hint="Default: 90 min. Included in driver cost.">
                  <input
                    className="af-input"
                    type="number"
                    min="15"
                    step="15"
                    placeholder="90"
                    value={fields.unloading_duration_mins}
                    onChange={e => set("unloading_duration_mins", e.target.value)}
                  />
                </Field>
              </div>

              {/* Auto-calculated time preview */}
              {fields.loading_done_time && distanceMiles ? (
                <div className="job-timing-calc-card">
                  <div className="job-timing-row">
                    <div className="job-timing-item">
                      <span className="job-timing-label">Distance</span>
                      <strong>{distanceMiles.toFixed(1)} mi</strong>
                    </div>
                    <div className="job-timing-sep">→</div>
                    <div className="job-timing-item">
                      <span className="job-timing-label">Travel time</span>
                      <strong>{fmtMins(timingCalc?.travelMins)}</strong>
                      <small>@ {avgSpeedMph} mph avg</small>
                    </div>
                    <div className="job-timing-sep">→</div>
                    <div className="job-timing-item">
                      <span className="job-timing-label">Arrive at drop</span>
                      <strong>{fields.delivery_arrival_time ? fmtTime(new Date(fields.delivery_arrival_time)) : timingCalc ? fmtTime(timingCalc.arrival) : "—"}</strong>
                    </div>
                    <div className="job-timing-sep">→</div>
                    <div className="job-timing-item">
                      <span className="job-timing-label">Depart drop</span>
                      <strong>{fields.delivery_departure_time ? fmtTime(new Date(fields.delivery_departure_time)) : timingCalc ? fmtTime(timingCalc.unloadEnd) : "—"}</strong>
                    </div>
                    <div className="job-timing-total">
                      <span className="job-timing-label">Total job time</span>
                      <strong>{fmtMins(timingCalc?.totalMins)}</strong>
                      <small>{fmtMins(loadingMins)} load + travel + {fmtMins(unloadingMins)} unload</small>
                    </div>
                  </div>
                </div>
              ) : (
                <p style={{ color: "#94a3b8", fontSize: "0.84rem", marginTop: 12 }}>
                  Select a route or calculate distance from postcodes, then enter loading done time to auto-calculate travel time and arrival.
                </p>
              )}

              {/* Cost preview */}
              {costCalc && (
                <div className="job-economics-card" style={{ marginTop: 16 }}>
                  <div className="job-economics-title">Job cost estimate</div>
                  <div className="job-economics-grid">
                    <div className="job-economics-row">
                      <span>Fuel ({distanceMiles?.toFixed(1)} mi × {fmtGBP(costCalc.fuelCostPerMile)}/mi)</span>
                      <strong>{fmtGBP(costCalc.fuelCost)}</strong>
                    </div>
                    <div className="job-economics-row">
                      <span>Driver ({fmtMins(estimatedTotalMins)} @ £{sysSettings?.driver_rate_per_hour}/hr)</span>
                      <strong>{fmtGBP(costCalc.driverCost)}</strong>
                    </div>
                    <div className="job-economics-row">
                      <span>Fleet ({fmtMins(estimatedTotalMins)} @ {fmtGBP(costCalc.fleetCostPerHour)}/hr)</span>
                      <strong>{fmtGBP(costCalc.fleetCost)}</strong>
                    </div>
                    <div className="job-economics-row total">
                      <span>Total cost</span>
                      <strong>{fmtGBP(costCalc.totalCost)}</strong>
                    </div>
                    <div className="job-economics-row suggested">
                      <span>Suggested price (+{sysSettings?.margin_pct}% margin)</span>
                      <strong>{fmtGBP(costCalc.suggestedPrice)}</strong>
                    </div>
                    {freightValue > 0 && (
                      <div className={`job-economics-row profit ${profitLoss >= 0 ? "profit-pos" : "profit-neg"}`}>
                        <span>{profitLoss >= 0 ? "Profit" : "Loss"}</span>
                        <strong>{profitLoss >= 0 ? "+" : "-"}{fmtGBP(Math.abs(profitLoss))}</strong>
                      </div>
                    )}
                  </div>
                  <p className="job-economics-hint">
                    Fuel: £{sysSettings?.fuel_price_per_litre}/L · {sysSettings?.mpg} MPG · Driver: £{sysSettings?.driver_rate_per_hour}/hr · Fleet: {fmtGBP(FLEET_COST_PER_HOUR_GBP)}/hr
                  </p>
                </div>
              )}
            </div>

            <div className="af-section">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <p className="af-section-title" style={{ margin: 0 }}>
                  Intermediate stops
                  {validStops.length > 0 && (
                    <span style={{ marginLeft: 8, fontSize: "0.75rem", fontWeight: 600, color: "#2563eb", background: "#eff6ff", borderRadius: 20, padding: "2px 8px" }}>
                      {validStops.length} stop{validStops.length > 1 ? "s" : ""} · +{validStops.length * 30} min ETA
                    </span>
                  )}
                </p>
                <button
                  type="button"
                  className="header-action-button"
                  onClick={() => setStops(prev => [...prev, { ...emptyStop }])}
                >
                  + Add stop
                </button>
              </div>

              {stops.length === 0 && (
                <p style={{ color: "#94a3b8", fontSize: "0.84rem", margin: 0 }}>
                  No intermediate stops. Click "Add stop" to include waypoints, additional pickups, or delivery stops.
                </p>
              )}

              {stops.map((stop, i) => (
                <div key={i} style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: "14px 16px", marginBottom: 10, background: "#f8fafc", position: "relative" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                    <strong style={{ fontSize: "0.84rem", color: "#0f172a" }}>Stop {i + 1}</strong>
                    <button
                      type="button"
                      className="header-action-button danger"
                      style={{ padding: "4px 10px", fontSize: "0.75rem" }}
                      onClick={() => setStops(prev => prev.filter((_, idx) => idx !== i))}
                    >
                      Remove
                    </button>
                  </div>
                  <div className="af-grid-2">
                    <Field label="Stop type">
                      <select className="af-select" value={stop.stop_type} onChange={e => setStops(prev => prev.map((s, idx) => idx === i ? { ...s, stop_type: e.target.value } : s))}>
                        <option value="delivery">Delivery</option>
                        <option value="pickup">Pickup</option>
                        <option value="waypoint">Waypoint</option>
                      </select>
                    </Field>
                    <Field label="Planned arrival at stop">
                      <input className="af-input" type="datetime-local" value={stop.planned_arrival} onChange={e => setStops(prev => prev.map((s, idx) => idx === i ? { ...s, planned_arrival: e.target.value } : s))} />
                    </Field>
                    <div style={{ gridColumn: "1 / -1" }}>
                      <Field label="Stop address" required>
                        <textarea className="af-input" style={{ minHeight: 60, resize: "vertical" }} placeholder="Full address for this stop" value={stop.address} onChange={e => setStops(prev => prev.map((s, idx) => idx === i ? { ...s, address: e.target.value } : s))} />
                      </Field>
                    </div>
                    <Field label="Contact name">
                      <input className="af-input" type="text" placeholder="e.g. John Smith" value={stop.contact_name} onChange={e => setStops(prev => prev.map((s, idx) => idx === i ? { ...s, contact_name: e.target.value } : s))} />
                    </Field>
                    <Field label="Contact phone">
                      <input className="af-input" type="tel" placeholder="e.g. 07700 900123" value={stop.contact_phone} onChange={e => setStops(prev => prev.map((s, idx) => idx === i ? { ...s, contact_phone: e.target.value } : s))} />
                    </Field>
                    <div style={{ gridColumn: "1 / -1" }}>
                      <Field label="Notes">
                        <input className="af-input" type="text" placeholder="Any special notes for this stop" value={stop.notes} onChange={e => setStops(prev => prev.map((s, idx) => idx === i ? { ...s, notes: e.target.value } : s))} />
                      </Field>
                    </div>
                  </div>
                </div>
              ))}

              {validStops.length > 0 && (selectedRoute || routeEstimate) && (
                <div style={{ marginTop: 8, padding: "10px 14px", background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 8, fontSize: "0.84rem", color: "#1e40af" }}>
                  <strong>ETA with stops:</strong> {displayDateTime(etaPreview)} — base travel ({selectedRoute ? `${selectedRoute.standard_eta_hours}h` : fmtMins(routeEstimate.durationMins)}) + 30 min × {validStops.length} stop{validStops.length > 1 ? "s" : ""}
                </div>
              )}
            </div>

            {submitErr && (
              <div className="state-card error">
                <span className="state-dot error" />
                <div><strong>Error</strong><p>{submitErr}</p></div>
              </div>
            )}

            <div className="af-actions">
              <button type="button" className="header-action-button" onClick={() => navigate(isEdit ? `/admin/jobs/${id}` : "/admin/jobs")}>
                Cancel
              </button>
              <button type="submit" className="af-submit-btn" disabled={submitting}>
                {submitting ? "Saving..." : isEdit ? "Save changes →" : "Create job →"}
              </button>
            </div>
          </form>
        )}
      </div>
    </AdminWorkspaceLayout>
  );
}
