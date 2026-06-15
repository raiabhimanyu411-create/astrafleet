import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getRealtimeSocket } from "../../../api/realtime";
import { cancelJob, getJobs, updateJobAssignment, updateJobStatus } from "../../../api/jobApi";
import { DeleteReasonModal } from "../../../components/DeleteReasonModal";
import { StateNotice } from "../../../components/StateNotice";
import { StatusPill } from "../../../components/StatusPill";
import { AdminWorkspaceLayout } from "../AdminWorkspaceLayout";

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "planned", label: "Planned" },
  { value: "loading", label: "Loading" },
  { value: "active", label: "Active" },
  { value: "completed", label: "Completed" },
  { value: "blocked", label: "Blocked" }
];

const PRIORITY_OPTIONS = [
  { value: "", label: "All priorities" },
  { value: "standard", label: "Standard" },
  { value: "priority", label: "Priority" },
  { value: "critical", label: "Critical" }
];

function todayIso() {
  const now = new Date();
  const offsetMs = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offsetMs).toISOString().slice(0, 10);
}

function exportCsv(name, rows) {
  const csv = rows
    .map(row => row.map(value => `"${String(value ?? "").replaceAll('"', '""')}"`).join(","))
    .join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

export function JobsListPage() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [view, setView] = useState("all");
  const [quickFilter, setQuickFilter] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [blockTarget, setBlockTarget] = useState(null);

  function load() {
    setLoading(true);
    return getJobs()
      .then(r => {
        setData(r.data);
        setError("");
      })
      .catch(() => setError("Could not load jobs. Please refresh."))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  useEffect(() => {
    const socket = getRealtimeSocket();
    const handleJobUpdate = () => load();
    socket.connect();
    socket.emit("admin-jobs:join");
    socket.on("job:updated", handleJobUpdate);
    return () => {
      socket.off("job:updated", handleJobUpdate);
      socket.emit("admin-jobs:leave");
    };
  }, []);

  function isToday(job) {
    if (!job.departureRaw) return false;
    return String(job.departureRaw).slice(0, 10) === todayIso();
  }

  function hasAssignmentGap(job) {
    return !job.driverAssigned || !job.vehicleAssigned || !job.trailerId;
  }

  function isPodPending(job) {
    return job.status === "completed" && !["uploaded", "verified"].includes(String(job.podStatus || "").toLowerCase());
  }

  const jobs = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (data?.jobs || []).filter((job) => {
      if (view === "today" && !isToday(job)) return false;
      if (view === "unassigned" && !hasAssignmentGap(job)) return false;
      if (view === "live" && !["loading", "active"].includes(job.status)) return false;
      if (view === "completed" && job.status !== "completed") return false;
      if (view === "exceptions" && !(hasAssignmentGap(job) || job.etaRisk || job.status === "blocked" || isPodPending(job))) return false;

      if (quickFilter === "unassigned" && !hasAssignmentGap(job)) return false;
      if (quickFilter === "assigned" && !job.driverAssigned) return false;
      if (quickFilter === "pod_pending" && !isPodPending(job)) return false;
      if (quickFilter === "blocked" && job.status !== "blocked") return false;

      if (!query) return true;
      return [
        job.code,
        job.customer,
        job.customerContact,
        job.customerPhone,
        job.lane,
        job.routeCode,
        job.pickupAddress,
        job.dropAddress,
        job.driver,
        job.driverPhone,
        job.vehicle,
        job.vehicleFleetCode,
        job.vehicleType,
        job.trailer,
        job.trailerCode,
        job.trailerType,
        job.loadType,
        job.loadDescription,
        job.specialInstructions,
        job.dispatcherNotes,
        job.status,
        job.driverJobStatus,
        job.podStatus,
        job.freight
      ].some((value) => String(value || "").toLowerCase().includes(query));
    });
  }, [data, quickFilter, search, view]);

  const quickItems = useMemo(() => {
    const rows = data?.jobs || [];
    return [
      { key: "unassigned", label: "Unassigned", value: rows.filter(hasAssignmentGap).length },
      { key: "assigned", label: "Driver assigned", value: rows.filter(job => job.driverAssigned).length },
      { key: "pod_pending", label: "POD pending", value: rows.filter(isPodPending).length },
      { key: "blocked", label: "Blocked", value: rows.filter(job => job.status === "blocked").length }
    ];
  }, [data]);

  const hasFilters = Boolean(search || quickFilter || view !== "all");

  function clearBoardFilters() {
    setSearch("");
    setQuickFilter("");
    setView("all");
  }

  function applyQuickFilter(key) {
    setQuickFilter(current => current === key ? "" : key);
    if (key === "unassigned") setView("unassigned");
    if (key === "pod_pending" || key === "blocked") setView("exceptions");
    if (key === "assigned") setView("all");
  }

  async function setStatus(job, status) {
    setError("");
    setBusyId(job.id);
    try {
      await updateJobStatus(job.id, { status, reason: status === "blocked" ? "Blocked from jobs board" : undefined });
      await load();
    } catch (err) {
      setError(err?.response?.data?.message || "Job status could not be updated.");
    } finally {
      setBusyId(null);
    }
  }

  async function updatePlannerField(job, payload, busyKey, fallbackMessage = "Job could not be updated.") {
    setError("");
    setBusyId(`${busyKey}-${job.id}`);
    try {
      await updateJobAssignment(job.id, payload);
      await load();
    } catch (err) {
      setError(err?.response?.data?.message || fallbackMessage);
    } finally {
      setBusyId(null);
    }
  }

  function updateRevenue(job, value) {
    const current = Number(job.freightValue || 0).toFixed(2);
    const next = String(value || "").trim();
    if (!next || Number(next).toFixed(2) === current) return;
    updatePlannerField(job, { freight_amount: Number(next) }, "revenue", "Revenue could not be updated.");
  }

  async function handleCancel(payload) {
    if (!blockTarget) return;
    setError("");
    setBusyId(blockTarget.id);
    try {
      await cancelJob(blockTarget.id, payload);
      setBlockTarget(null);
      await load();
    } catch (err) {
      setError(err?.response?.data?.message || "Job could not be blocked. Please try again.");
    } finally {
      setBusyId(null);
    }
  }

  function exportJobs() {
    exportCsv("jobs-register.csv", [
      ["Job code", "Customer", "Lane", "Load", "Weight kg", "Driver", "Vehicle", "Trolley", "Departure", "ETA", "Stops", "Priority", "Status", "Freight GBP", "Risk"],
      ...jobs.map(job => [
        job.code,
        job.customer,
        job.lane,
        job.loadType,
        job.loadWeightKg,
        job.driver,
        job.vehicle,
        job.trailer,
        job.departureRaw,
        job.etaRaw,
        job.stopCount,
        job.priority,
        job.status,
        job.freightValue,
        [!job.driverAssigned || !job.vehicleAssigned ? "Assignment gap" : "", job.etaRisk ? "ETA risk" : "", job.status === "blocked" ? "Blocked" : ""].filter(Boolean).join("; ")
      ])
    ]);
  }

  return (
    <AdminWorkspaceLayout
      badge="Job management"
      title="Jobs planner"
      description="Create jobs and control the live haulage sheet from one place."
      highlights={[]}
    >
      <div className="finance-command-bar">
        <input
          className="af-input jobs-sheet-search"
          placeholder="Search job, customer, driver, truck, trolley, route, revenue..."
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button className="header-action-button" type="button" onClick={load}>Refresh</button>
        <button className="header-action-button" type="button" onClick={exportJobs}>Export CSV</button>
        <button className="af-submit-btn" type="button" onClick={() => navigate("/admin/jobs/new")}>+ New job</button>
      </div>

      <StateNotice loading={loading} error={error} />

      <section className="jobs-control-strip">
        <div className="jobs-quick-strip">
          {quickItems.map(item => (
            <button className={quickFilter === item.key ? "active" : ""} key={item.key} type="button" onClick={() => applyQuickFilter(item.key)}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </button>
          ))}
          <button className="clear" disabled={!hasFilters} type="button" onClick={clearBoardFilters}>Clear</button>
        </div>
        <div className="jobs-tabs" aria-label="Job views">
          {[
            ["all", "All"],
            ["today", "Today"],
            ["unassigned", "Unassigned"],
            ["live", "Live"],
            ["completed", "Completed"],
            ["exceptions", "Exceptions"]
          ].map(([key, label]) => (
            <button className={view === key ? "active" : ""} key={key} type="button" onClick={() => setView(key)}>
              {label}
            </button>
          ))}
        </div>
      </section>

      <section className="jobs-sheet-card">
        <div className="section-head">
          <div>
            <span className="card-label">Live Excel planner</span>
            <h2>{view === "all" ? "Freight booking records" : `${view.replace("_", " ")} jobs`}</h2>
          </div>
          <StatusPill tone={jobs.length ? "success" : "neutral"}>{jobs.length} visible</StatusPill>
        </div>

        <div className="jobs-planner-shell">
          <table className="jobs-planner-table">
            <colgroup>
              <col className="jobs-col-seq" />
              <col className="jobs-col-reference" />
              <col className="jobs-col-customer" />
              <col className="jobs-col-location" />
              <col className="jobs-col-location" />
              <col className="jobs-col-time" />
              <col className="jobs-col-time" />
              <col className="jobs-col-load" />
              <col className="jobs-col-driver" />
              <col className="jobs-col-contact" />
              <col className="jobs-col-asset" />
              <col className="jobs-col-asset" />
              <col className="jobs-col-small" />
              <col className="jobs-col-pill" />
              <col className="jobs-col-pill" />
              <col className="jobs-col-pod" />
              <col className="jobs-col-money" />
              <col className="jobs-col-notes" />
              <col className="jobs-col-action" />
            </colgroup>
            <thead>
              <tr>
                <th>Seq</th>
                <th>Reference</th>
                <th>Customer</th>
                <th>Collection</th>
                <th>Delivery</th>
                <th>Depart</th>
                <th>ETA / deadline</th>
                <th>Load</th>
                <th>Driver</th>
                <th>Contact</th>
                <th>Truck</th>
                <th>Trailer</th>
                <th>Stops</th>
                <th>Priority</th>
                <th>Status</th>
                <th>POD</th>
                <th>Revenue</th>
                <th>Text / notes</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job, index) => (
                <tr className={`jobs-planner-row ${job.status} ${job.priority}`} key={job.id}>
                  <td className="jobs-planner-seq">{index + 1}</td>
                  <td>
                    <button className="jobs-planner-link" type="button" onClick={() => navigate(`/admin/jobs/${job.id}`)}>
                      {job.code}
                    </button>
                    <small>{job.routeCode}</small>
                  </td>
                  <td>
                    <strong>{job.customer}</strong>
                    <small>{job.customerContact} · {job.customerPhone}</small>
                  </td>
                  <td>
                    <strong>{job.pickupAddress}</strong>
                    <small>{job.dockWindow !== "—" ? `Dock ${job.dockWindow}` : job.lane}</small>
                  </td>
                  <td>
                    <strong>{job.dropAddress}</strong>
                    <small>{job.distanceKm ? `${job.distanceKm} km` : job.lane}</small>
                  </td>
                  <td>
                    <strong>{job.departure}</strong>
                    <small>{job.departureRaw ? job.departureRaw.replace("T", " ") : "Time TBD"}</small>
                  </td>
                  <td>
                    <strong>{job.eta}</strong>
                    <small>{job.deadline !== "—" ? `Deadline ${job.deadline}` : `${job.etaHours || "—"}h route ETA`}</small>
                  </td>
                  <td>
                    <strong>{job.loadType}</strong>
                    <small>
                      {job.loadWeightKg ? `${job.loadWeightKg} kg` : "Weight TBD"}
                      {job.loadVolumeCbm ? ` · ${job.loadVolumeCbm} cbm` : ""}
                      {job.vehicleRequirement !== "—" ? ` · ${job.vehicleRequirement}` : ""}
                    </small>
                  </td>
                  <td>
                    <select
                      className="jobs-planner-select"
                      disabled={busyId === `driver-${job.id}`}
                      value={job.driverId || ""}
                      onChange={(e) => updatePlannerField(job, { driver_id: e.target.value ? Number(e.target.value) : null }, "driver", "Driver could not be assigned.")}
                    >
                      <option value="">Assign driver</option>
                      {(data?.drivers || []).map((driver) => (
                        <option key={driver.id} value={driver.id}>
                          {driver.full_name} · {driver.employee_code || "Driver"} · {driver.shift_status}
                        </option>
                      ))}
                    </select>
                    <small>{job.driver}</small>
                  </td>
                  <td>
                    <strong>{job.driverPhone}</strong>
                    <small>{job.driverEmployeeCode}</small>
                  </td>
                  <td>
                    <select
                      className="jobs-planner-select"
                      disabled={busyId === `vehicle-${job.id}`}
                      value={job.vehicleId || ""}
                      onChange={(e) => updatePlannerField(job, { vehicle_id: e.target.value ? Number(e.target.value) : null }, "vehicle", "Truck could not be assigned.")}
                    >
                      <option value="">Assign truck</option>
                      {(data?.vehicles || []).map((vehicle) => (
                        <option key={vehicle.id} value={vehicle.id}>
                          {vehicle.registration_number} · {vehicle.truck_type || vehicle.model_name || "Truck"}
                        </option>
                      ))}
                    </select>
                    <small>{job.vehicle}</small>
                  </td>
                  <td>
                    <select
                      className="jobs-planner-select"
                      disabled={busyId === `trailer-${job.id}`}
                      value={job.trailerId || ""}
                      onChange={(e) => updatePlannerField(job, { trailer_id: e.target.value ? Number(e.target.value) : null }, "trailer", "Trolley could not be assigned.")}
                    >
                      <option value="">Assign trolley</option>
                      {(data?.trailers || []).map((trailer) => (
                        <option key={trailer.id} value={trailer.id}>
                          {trailer.registration_number} · {trailer.trailer_code}
                        </option>
                      ))}
                    </select>
                    <small>{job.trailer}</small>
                  </td>
                  <td>
                    <strong>{job.stopCount || 0}</strong>
                    <small>{Number(job.stopCount || 0) > 0 ? "Multi-stop" : "Direct"}</small>
                  </td>
                  <td>
                    <select
                      className="jobs-planner-select compact"
                      disabled={busyId === `priority-${job.id}`}
                      value={job.priority || "standard"}
                      onChange={(e) => updatePlannerField(job, { priority_level: e.target.value }, "priority", "Priority could not be updated.")}
                    >
                      {PRIORITY_OPTIONS.filter((option) => option.value).map((option) => (
                        <option key={option.value} value={option.value}>{option.value}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      className="jobs-planner-select compact"
                      disabled={busyId === job.id}
                      value={job.status}
                      onChange={(e) => setStatus(job, e.target.value)}
                    >
                      {STATUS_OPTIONS.filter((option) => option.value).map((option) => (
                        <option key={option.value} value={option.value}>{option.value}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <strong>{job.podStatus}</strong>
                    <small>{job.driverJobStatus}</small>
                  </td>
                  <td>
                    <input
                      className="jobs-planner-input money"
                      defaultValue={Number(job.freightValue || 0).toFixed(2)}
                      disabled={busyId === `revenue-${job.id}`}
                      min="0"
                      onBlur={(e) => updateRevenue(job, e.target.value)}
                      step="0.01"
                      type="number"
                    />
                  </td>
                  <td>
                    <strong>{job.specialInstructions}</strong>
                    <small>{job.dispatcherNotes}</small>
                  </td>
                  <td>
                    <div className="jobs-planner-actions">
                      <button className="header-action-button" type="button" onClick={() => navigate(`/admin/jobs/${job.id}`)}>Open</button>
                      {job.status !== "blocked" && job.status !== "completed" && (
                        <button className="header-action-button danger" disabled={busyId === job.id} type="button" onClick={() => setBlockTarget(job)}>
                          {busyId === job.id ? "Saving..." : "Block"}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && jobs.length === 0 && (
            <p className="finance-empty">
              {search ? "No jobs match your search." : "No jobs yet. Create your first job."}
            </p>
          )}
        </div>
      </section>
      <DeleteReasonModal
        open={Boolean(blockTarget)}
        title="Block job"
        recordLabel={blockTarget ? `${blockTarget.code} · ${blockTarget.customer}` : ""}
        body="The job will be blocked, its vehicle and trolley will be released, and this reason will be visible to admin."
        confirmLabel="Block job"
        loading={Boolean(busyId)}
        onCancel={() => setBlockTarget(null)}
        onConfirm={handleCancel}
      />
    </AdminWorkspaceLayout>
  );
}
