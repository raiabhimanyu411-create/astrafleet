import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  createDriverDefectReport,
  createDriverExpense,
  endDriverShift,
  getDriverMessages,
  getDriverPanelData,
  logDriverOdometer,
  rescheduleDriverJob,
  sendDriverMessage,
  startDriverShift,
  submitDriverPod,
  submitDriverWalkaround,
  updateDriverJobEta,
  updateDriverJobStatus,
  updateDriverLocation
} from "../../api/driverApi";
import { NotificationBell } from "../../components/NotificationBell";
import { PanelLayout } from "../../components/PanelLayout";
import { StatCard } from "../../components/StatCard";
import { StateNotice } from "../../components/StateNotice";
import { StatusPill } from "../../components/StatusPill";
import { clearAuthSession, getAuthSession } from "../../utils/authSession";
import { gpsErrorMessage, positionToPayload, watchDriverGps } from "../../utils/driverGps";

const WALKAROUND_CHECKS = [
  { key: "tyres",       label: "Tyres – pressure and condition" },
  { key: "lights",      label: "Lights and indicators" },
  { key: "brakes",      label: "Brakes – service and parking" },
  { key: "mirrors",     label: "Mirrors and windscreen" },
  { key: "fluids",      label: "Oil, coolant, and fluid levels" },
  { key: "coupling",    label: "Coupling and trailer security" },
  { key: "load",        label: "Load security and weight" },
  { key: "docs",        label: "Driver docs and vehicle paperwork" },
  { key: "bodywork",    label: "Bodywork and chassis" },
  { key: "horn",        label: "Horn and warning devices" },
  { key: "wipers",      label: "Wipers and washers" },
  { key: "speedometer", label: "Speedometer and instruments" },
];

const driverMenu = [
  { href: "#overview",   label: "Overview" },
  { href: "#walkaround", label: "Walkaround" },
  { href: "#jobs",       label: "Jobs" },
  { href: "#status",     label: "Status" },
  { href: "#pod",        label: "POD" },
  { href: "#shift",      label: "Shift" },
  { href: "#reports",    label: "Reports" },
  { href: "#history",    label: "History" },
  { href: "#messages",   label: "Messages" },
];

const emptyPod     = { signatureData: "", photoData: "", deliveryNotes: "" };
const emptyExpense = { expenseType: "fuel", amount: "", notes: "", receiptData: "" };
const emptyDefect  = { defectType: "Vehicle defect", severity: "medium", description: "" };

function readFileAsDataUrl(file, setter) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => setter(reader.result);
  reader.readAsDataURL(file);
}

function fmtTimer(secs) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// ── Canvas signature pad ────────────────────────────────────────
function SignatureCanvas({ onCapture }) {
  const canvasRef = useRef(null);
  const drawing   = useRef(false);

  function getPos(e, canvas) {
    const rect   = canvas.getBoundingClientRect();
    const scaleX = canvas.width  / rect.width;
    const scaleY = canvas.height / rect.height;
    if (e.touches) {
      return { x: (e.touches[0].clientX - rect.left) * scaleX, y: (e.touches[0].clientY - rect.top) * scaleY };
    }
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  }

  function startDraw(e) {
    e.preventDefault();
    drawing.current = true;
    const canvas = canvasRef.current;
    const ctx    = canvas.getContext("2d");
    const pos    = getPos(e, canvas);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
  }

  function draw(e) {
    e.preventDefault();
    if (!drawing.current) return;
    const canvas = canvasRef.current;
    const ctx    = canvas.getContext("2d");
    const pos    = getPos(e, canvas);
    ctx.lineWidth   = 2.5;
    ctx.lineCap     = "round";
    ctx.strokeStyle = "#0f172a";
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
  }

  function endDraw(e) {
    e.preventDefault();
    if (!drawing.current) return;
    drawing.current = false;
    onCapture(canvasRef.current.toDataURL());
  }

  function clearCanvas() {
    const canvas = canvasRef.current;
    canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
    onCapture("");
  }

  return (
    <div className="sig-canvas-wrap">
      <canvas
        ref={canvasRef}
        width={500}
        height={150}
        className="sig-canvas"
        onMouseDown={startDraw}
        onMouseMove={draw}
        onMouseUp={endDraw}
        onMouseLeave={endDraw}
        onTouchStart={startDraw}
        onTouchMove={draw}
        onTouchEnd={endDraw}
      />
      <button type="button" className="header-action-button" onClick={clearCanvas}>Clear signature</button>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────
function JobButton({ job, active, onClick }) {
  return (
    <button className={`driver-job-button ${active ? "active" : ""}`} onClick={onClick} type="button">
      <div>
        <strong>{job.code}</strong>
        <p>{job.route.from} to {job.route.to}</p>
        <span>{job.schedule.plannedDeparture}</span>
      </div>
      <StatusPill tone={job.statusTone}>{job.statusLabel}</StatusPill>
    </button>
  );
}

function Detail({ label, value }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value || "—"}</strong>
    </div>
  );
}

function TimelineStep({ active, done, label }) {
  return (
    <div className={`driver-step ${active ? "active" : ""} ${done ? "done" : ""}`}>
      <span />
      <p>{label}</p>
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────
export function DriverPanel() {
  const [data,          setData]          = useState(null);
  const [selectedJobId, setSelectedJobId] = useState(null);
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState("");
  const [notice,        setNotice]        = useState("");
  const [busy,          setBusy]          = useState("");
  const [noticeError,   setNoticeError]   = useState(false);

  const [pod,        setPod]        = useState(emptyPod);
  const [expense,    setExpense]    = useState(emptyExpense);
  const [defect,     setDefect]     = useState(emptyDefect);
  const [shiftNote,  setShiftNote]  = useState("");
  const [useSigPad,  setUseSigPad]  = useState(false);

  // Walkaround
  const [walkaround, setWalkaround] = useState({ checks: {}, issues: "", done: false });

  // Odometer
  const [odometer, setOdometer] = useState({ reading: "", type: "start" });

  // ETA update
  const [etaInput, setEtaInput] = useState("");

  // Break/rest timer
  const [breakActive,  setBreakActive]  = useState(false);
  const [breakSeconds, setBreakSeconds] = useState(0);
  const breakTimerRef = useRef(null);

  // Messaging
  const [messages,    setMessages]    = useState([]);
  const [msgLoading,  setMsgLoading]  = useState(false);
  const [newMessage,  setNewMessage]  = useState("");
  const [msgSending,  setMsgSending]  = useState(false);

  // Failed delivery reschedule
  const [reschedule, setReschedule] = useState({ visible: false, date: "", reason: "" });

  const navigate         = useNavigate();
  const session          = getAuthSession();
  const userId           = session?.id;
  const selectedJobIdRef = useRef(selectedJobId);
  const gpsLogoutRef     = useRef(false);

  const jobs = useMemo(() => {
    const combined = [...(data?.todayJobs || []), ...(data?.upcomingJobs || [])];
    return combined.filter((job, idx, arr) => arr.findIndex(j => j.id === job.id) === idx);
  }, [data]);

  const selectedJob    = jobs.find(j => j.id === selectedJobId) || data?.activeJob || jobs[0] || null;
  const deliveryFlow   = (data?.statusFlow || []).filter(s => !["offered", "declined"].includes(s.value));
  const statusIndex    = deliveryFlow.findIndex(s => s.value === selectedJob?.status);
  const incompleteJobs = jobs.filter(j => !["delivered", "failed_delivery", "declined"].includes(j.status));
  const completedJobs  = jobs.filter(j => ["delivered", "failed_delivery", "declined"].includes(j.status));

  // ── Break timer persistence ─────────────────────────────────
  useEffect(() => {
    try {
      const stored = localStorage.getItem("astrafleet_break_start");
      if (stored) {
        const elapsed = Math.floor((Date.now() - Number(stored)) / 1000);
        setBreakSeconds(elapsed);
        setBreakActive(true);
        breakTimerRef.current = setInterval(() => setBreakSeconds(s => s + 1), 1000);
      }
    } catch { /* ignore */ }
    return () => clearInterval(breakTimerRef.current);
  }, []);

  function startBreak() {
    setBreakActive(true);
    setBreakSeconds(0);
    breakTimerRef.current = setInterval(() => setBreakSeconds(s => s + 1), 1000);
    try { localStorage.setItem("astrafleet_break_start", Date.now()); } catch { /* ignore */ }
  }

  function endBreak() {
    setBreakActive(false);
    clearInterval(breakTimerRef.current);
    setBreakSeconds(0);
    try { localStorage.removeItem("astrafleet_break_start"); } catch { /* ignore */ }
  }

  // ── Data loading ────────────────────────────────────────────
  async function loadPanel(nextSelectedId) {
    if (!userId) return;
    try {
      setLoading(true);
      setError("");
      const res = await getDriverPanelData(userId);
      setData(res.data);
      setSelectedJobId(nextSelectedId || res.data.activeJob?.id || res.data.todayJobs?.[0]?.id || res.data.upcomingJobs?.[0]?.id || null);
    } catch (err) {
      setError(err.response?.data?.message || "Could not load driver panel.");
    } finally {
      setLoading(false);
    }
  }

  async function loadMessages() {
    if (!userId) return;
    try {
      setMsgLoading(true);
      const res = await getDriverMessages(userId);
      setMessages(res.data.messages || []);
    } catch { /* silent */ } finally {
      setMsgLoading(false);
    }
  }

  useEffect(() => { selectedJobIdRef.current = selectedJobId; }, [selectedJobId]);

  useEffect(() => {
    loadPanel();
    loadMessages();
    const panelTimer = setInterval(() => loadPanel(selectedJobIdRef.current), 30000);
    const msgTimer   = setInterval(() => loadMessages(), 60000);
    return () => { clearInterval(panelTimer); clearInterval(msgTimer); };
  }, [userId]);

  useEffect(() => {
    if (!userId) return undefined;

    function forceLogout(err) {
      if (gpsLogoutRef.current) return;
      gpsLogoutRef.current = true;
      setNotice(`${gpsErrorMessage(err)} Logging out for admin tracking safety.`);
      clearAuthSession();
      window.setTimeout(() => navigate("/", { replace: true }), 900);
    }

    return watchDriverGps({
      onPosition: (position) => {
        updateDriverLocation(userId, positionToPayload(position)).catch(() => {});
      },
      onBlocked: forceLogout
    });
  }, [navigate, userId]);

  function handleLogout() {
    clearAuthSession();
    navigate("/", { replace: true });
  }

  // ── Generic action runner ───────────────────────────────────
  async function runAction(label, action) {
    try {
      setBusy(label);
      setNotice("");
      setNoticeError(false);
      const result = await action();
      setNotice(result?.data?.message || "Updated successfully.");
      setNoticeError(false);
      await loadPanel(selectedJob?.id);
    } catch (err) {
      setNotice(err.response?.data?.message || "Action failed. Please try again.");
      setNoticeError(true);
    } finally {
      setBusy("");
    }
  }

  // ── Handlers ────────────────────────────────────────────────
  function handleStatus(status) {
    if (!selectedJob) return;
    let reason = "";
    if (status === "failed_delivery" || status === "declined") {
      reason = window.prompt(status === "declined" ? "Reason for declining this job?" : "Reason for failed delivery?");
      if (reason === null) return;
      if (status === "failed_delivery") setReschedule(r => ({ ...r, visible: true }));
    }
    runAction(status, () => updateDriverJobStatus(userId, selectedJob.id, { status, reason: reason || "" }));
  }

  function handlePodSubmit(event) {
    event.preventDefault();
    if (!selectedJob) return;
    runAction("pod", async () => {
      const result = await submitDriverPod(userId, selectedJob.id, pod);
      setPod(emptyPod);
      return result;
    });
  }

  function handleExpenseSubmit(event) {
    event.preventDefault();
    runAction("expense", async () => {
      const result = await createDriverExpense(userId, { ...expense, tripId: selectedJob?.id });
      setExpense(emptyExpense);
      return result;
    });
  }

  function handleDefectSubmit(event) {
    event.preventDefault();
    runAction("defect", async () => {
      const result = await createDriverDefectReport(userId, defect);
      setDefect(emptyDefect);
      return result;
    });
  }

  function handleShiftStart() {
    runAction("shift-start", async () => {
      const result = await startDriverShift(userId, { note: shiftNote });
      setShiftNote("");
      return result;
    });
  }

  function handleShiftEnd() {
    runAction("shift-end", async () => {
      const result = await endDriverShift(userId, { note: shiftNote });
      setShiftNote("");
      return result;
    });
  }

  function handleWalkaroundSubmit(event) {
    event.preventDefault();
    const allClear = WALKAROUND_CHECKS.every(c => walkaround.checks[c.key] === true);
    runAction("walkaround", async () => {
      const result = await submitDriverWalkaround(userId, {
        tripId: selectedJob?.id,
        checks: walkaround.checks,
        allClear,
        issues: walkaround.issues
      });
      setWalkaround({ checks: {}, issues: "", done: true });
      return result;
    });
  }

  function handleOdometerSubmit(event) {
    event.preventDefault();
    if (!odometer.reading) return;
    runAction("odometer", async () => {
      const result = await logDriverOdometer(userId, {
        tripId: selectedJob?.id,
        readingKm: odometer.reading,
        logType: odometer.type
      });
      setOdometer({ reading: "", type: "start" });
      return result;
    });
  }

  function handleEtaUpdate(event) {
    event.preventDefault();
    if (!selectedJob || !etaInput) return;
    runAction("eta", async () => {
      const result = await updateDriverJobEta(userId, selectedJob.id, { eta: etaInput });
      setEtaInput("");
      return result;
    });
  }

  async function handleSendMessage(event) {
    event.preventDefault();
    if (!newMessage.trim() || msgSending) return;
    try {
      setMsgSending(true);
      await sendDriverMessage(userId, { body: newMessage.trim(), tripId: selectedJob?.id });
      setNewMessage("");
      await loadMessages();
    } catch (err) {
      setNotice(err.response?.data?.message || "Message failed to send.");
      setNoticeError(true);
    } finally {
      setMsgSending(false);
    }
  }

  function handleRescheduleSubmit(event) {
    event.preventDefault();
    if (!reschedule.date || !selectedJob) return;
    runAction("reschedule", async () => {
      const result = await rescheduleDriverJob(userId, selectedJob.id, {
        newDate: reschedule.date,
        reason: reschedule.reason
      });
      setReschedule({ visible: false, date: "", reason: "" });
      return result;
    });
  }

  const walkaroundAllChecked = WALKAROUND_CHECKS.every(c => walkaround.checks[c.key] !== undefined);
  const walkaroundAllClear   = WALKAROUND_CHECKS.every(c => walkaround.checks[c.key] === true);

  return (
    <PanelLayout
      badge={data?.header?.badge || "Driver Panel"}
      title={data?.header?.title || "Driver workspace"}
      description={data?.header?.description || "Daily driver operations in one browser panel."}
      highlights={data?.highlights || ["Assigned jobs", "Status updates", "POD and reports"]}
      menu={driverMenu}
      roleLabel="Driver workspace"
      headerContent={(
        <>
          <NotificationBell
            fetchUrl="/api/drivers/me/notifications"
            paramKey="userId"
            paramValue={userId}
          />
          <button className="header-action-button" onClick={() => loadPanel(selectedJob?.id)} type="button">Refresh</button>
          <button className="header-action-button danger" onClick={handleLogout} type="button">Logout</button>
        </>
      )}
    >
      <StateNotice loading={loading} error={error} />

      {/* ── Document expiry warnings ── */}
      {(data?.docWarnings || []).length > 0 && (
        <div className="doc-expiry-banner">
          <strong>Document expiry alert</strong>
          <div className="doc-expiry-list">
            {data.docWarnings.map(w => (
              <span key={w.label} className={`doc-expiry-chip ${w.tone}`}>
                {w.label}: {w.days < 0 ? "EXPIRED" : `${w.days}d left`} ({w.expiry})
              </span>
            ))}
          </div>
        </div>
      )}

      {notice && (
        <div className={`state-card ${noticeError ? "error" : "driver-notice"}`} aria-live="polite">
          <span className={`state-dot ${noticeError ? "error" : "success"}`} />
          <div><strong>{noticeError ? "Action failed" : "Driver update"}</strong><p>{notice}</p></div>
        </div>
      )}

      {/* ── Stats ── */}
      <section className="stats-grid" id="overview">
        {(data?.stats || []).map(item => <StatCard item={item} key={item.label} />)}
      </section>

      {/* ── Driver command strip ── */}
      <section className="driver-command-strip">
        <article>
          <span className="card-label">Driver</span>
          <strong>{data?.driver?.name || "—"}</strong>
          <p>{data?.driver?.employeeCode || "No employee code"} · {data?.driver?.homeDepot || "Depot not set"}</p>
        </article>
        <article>
          <span className="card-label">Contact</span>
          <strong>{data?.driver?.phone || "—"}</strong>
          <p>{data?.driver?.email || "Email not linked"}</p>
        </article>
        <article>
          <span className="card-label">Readiness</span>
          <strong>{data?.driver?.shiftStatus || "rest"}</strong>
          <p>Compliance: {data?.driver?.complianceStatus || "review"}</p>
        </article>
        <article>
          <span className="card-label">Queue</span>
          <strong>{incompleteJobs.length} open</strong>
          <p>{completedJobs.length} completed or closed</p>
        </article>
      </section>

      {/* ── Break / rest timer ── */}
      <section className="break-timer-bar">
        <div className="break-timer-info">
          <span className="card-label">Break / rest timer</span>
          <strong className={`break-timer-display ${breakActive ? "running" : ""}`}>
            {fmtTimer(breakSeconds)}
          </strong>
          {breakActive && breakSeconds >= 2700 && (
            <span className="break-timer-badge success">45 min target reached</span>
          )}
        </div>
        <div className="driver-action-row" style={{ marginTop: 0 }}>
          <button
            className="af-submit-btn"
            type="button"
            disabled={breakActive}
            onClick={startBreak}
          >
            Start break
          </button>
          <button
            className="header-action-button danger"
            type="button"
            disabled={!breakActive}
            onClick={endBreak}
          >
            End break
          </button>
        </div>
      </section>

      {/* ── Walkaround checklist ── */}
      <section className="content-card" id="walkaround" style={{ marginBottom: 16 }}>
        <div className="section-head">
          <div>
            <span className="card-label">Pre-trip walkaround</span>
            <h2>Vehicle safety checklist</h2>
          </div>
          {data?.latestWalkaround && (
            <StatusPill tone={data.latestWalkaround.allClear ? "success" : "danger"}>
              Last: {data.latestWalkaround.allClear ? "All clear" : "Issues"} · {data.latestWalkaround.at}
            </StatusPill>
          )}
        </div>

        {walkaround.done ? (
          <div className="driver-form-notice">
            Walkaround submitted. Refresh the panel to record a new check.
            <button
              type="button"
              className="header-action-button"
              style={{ marginLeft: 12 }}
              onClick={() => setWalkaround({ checks: {}, issues: "", done: false })}
            >
              New check
            </button>
          </div>
        ) : (
          <form className="af-form" onSubmit={handleWalkaroundSubmit}>
            <div className="walkaround-grid">
              {WALKAROUND_CHECKS.map(item => {
                const val = walkaround.checks[item.key];
                return (
                  <label key={item.key} className={`walkaround-item ${val === true ? "pass" : val === false ? "fail" : ""}`}>
                    <span className="walkaround-label">{item.label}</span>
                    <div className="walkaround-toggle">
                      <button
                        type="button"
                        className={`wt-btn pass ${val === true ? "active" : ""}`}
                        onClick={() => setWalkaround(w => ({ ...w, checks: { ...w.checks, [item.key]: true } }))}
                      >
                        OK
                      </button>
                      <button
                        type="button"
                        className={`wt-btn fail ${val === false ? "active" : ""}`}
                        onClick={() => setWalkaround(w => ({ ...w, checks: { ...w.checks, [item.key]: false } }))}
                      >
                        Fail
                      </button>
                    </div>
                  </label>
                );
              })}
            </div>

            {!walkaroundAllClear && walkaroundAllChecked && (
              <div className="af-field">
                <label className="af-label">Describe the issue(s)</label>
                <textarea
                  className="af-input"
                  value={walkaround.issues}
                  onChange={e => setWalkaround(w => ({ ...w, issues: e.target.value }))}
                  placeholder="Describe defects found during walkaround..."
                  required
                />
              </div>
            )}

            <div className="driver-action-row">
              <button
                className="af-submit-btn"
                type="submit"
                disabled={!walkaroundAllChecked || busy === "walkaround"}
              >
                {busy === "walkaround" ? "Submitting..." : walkaroundAllClear ? "Submit — All clear" : "Submit with issues"}
              </button>
              {!walkaroundAllChecked && (
                <span style={{ fontSize: "0.82rem", color: "#64748b", alignSelf: "center" }}>
                  {WALKAROUND_CHECKS.filter(c => walkaround.checks[c.key] !== undefined).length} / {WALKAROUND_CHECKS.length} checked
                </span>
              )}
            </div>
          </form>
        )}
      </section>

      {/* ── Jobs + Job spotlight ── */}
      <section className="content-grid" id="jobs">
        <article className="content-card">
          <div className="section-head">
            <div>
              <span className="card-label">Today&apos;s duties</span>
              <h2>Assigned jobs</h2>
            </div>
            <StatusPill tone={data?.shift ? "success" : "warning"}>{data?.shift ? "Shift active" : "Off shift"}</StatusPill>
          </div>
          <div className="driver-job-list">
            {jobs.length ? jobs.map(job => (
              <JobButton
                active={selectedJob?.id === job.id}
                job={job}
                key={job.id}
                onClick={() => setSelectedJobId(job.id)}
              />
            )) : <p className="driver-empty">No assigned jobs yet.</p>}
          </div>
        </article>

        <article className="content-card trip-spotlight">
          <div className="section-head">
            <div>
              <span className="card-label">Selected job</span>
              <h2>{selectedJob?.code || "No job selected"}</h2>
            </div>
            {selectedJob && <StatusPill tone={selectedJob.statusTone}>{selectedJob.statusLabel}</StatusPill>}
          </div>

          {selectedJob ? (
            <>
              <div className="detail-grid">
                <Detail label="Pickup"       value={selectedJob.route.pickupAddress} />
                <Detail label="Drop"         value={selectedJob.route.dropAddress} />
                <Detail label="Customer"     value={selectedJob.customer.name} />
                <Detail label="Contact"      value={`${selectedJob.customer.contact} · ${selectedJob.customer.phone}`} />
                <Detail label="Departure"    value={selectedJob.schedule.plannedDeparture} />
                <Detail label="ETA"          value={selectedJob.schedule.eta} />
                <Detail label="Dock window"  value={selectedJob.schedule.dockWindow} />
                <Detail label="Vehicle"      value={selectedJob.vehicle} />
                <Detail label="Trailer / Trolley" value={selectedJob.trailer} />
                <Detail label="Load"         value={`${selectedJob.load.type} · ${selectedJob.load.weight}`} />
                <Detail label="Load detail"  value={selectedJob.load.description} />
                <Detail label="Instructions" value={selectedJob.specialInstructions} />
              </div>

              {/* ETA update */}
              <form className="eta-update-row" onSubmit={handleEtaUpdate}>
                <span className="card-label" style={{ alignSelf: "center" }}>Update ETA</span>
                <input
                  className="af-input"
                  type="datetime-local"
                  value={etaInput}
                  onChange={e => setEtaInput(e.target.value)}
                  style={{ flex: 1, minWidth: 0 }}
                />
                <button className="header-action-button" type="submit" disabled={!etaInput || busy === "eta"}>
                  {busy === "eta" ? "Saving..." : "Set ETA"}
                </button>
              </form>

              {/* Odometer logging */}
              <form className="odometer-row" onSubmit={handleOdometerSubmit}>
                <span className="card-label" style={{ alignSelf: "center" }}>Odometer</span>
                <select
                  className="af-select"
                  value={odometer.type}
                  onChange={e => setOdometer(o => ({ ...o, type: e.target.value }))}
                  style={{ width: "auto" }}
                >
                  <option value="start">Trip start</option>
                  <option value="end">Trip end</option>
                </select>
                <input
                  className="af-input"
                  type="number"
                  min="0"
                  step="0.1"
                  value={odometer.reading}
                  onChange={e => setOdometer(o => ({ ...o, reading: e.target.value }))}
                  placeholder="Reading (km)"
                  style={{ flex: 1, minWidth: 0 }}
                />
                <button className="header-action-button" type="submit" disabled={!odometer.reading || busy === "odometer"}>
                  {busy === "odometer" ? "Saving..." : "Log"}
                </button>
              </form>

              <div className="driver-action-row">
                <a className="af-submit-btn driver-nav-link" href={selectedJob.route.navigationUrl} rel="noreferrer" target="_blank">Open navigation</a>
                <a className="header-action-button driver-nav-link" href={`tel:${selectedJob.customer.phone}`}>Call customer</a>
              </div>
            </>
          ) : <p className="driver-empty">Select a job to see route, customer, and load details.</p>}
        </article>
      </section>

      {/* ── Job status ── */}
      <section className="content-card" id="status" style={{ marginBottom: 16 }}>
        <div className="section-head">
          <div>
            <span className="card-label">Job status update</span>
            <h2>Move job through delivery flow</h2>
          </div>
          <StatusPill tone="neutral">Dispatch sync</StatusPill>
        </div>
        {selectedJob?.status === "offered" ? (
          <div className="driver-status-grid">
            <button className="driver-status-button active" disabled={Boolean(busy)} onClick={() => handleStatus("accepted")} type="button">
              {busy === "accepted" ? "Accepting..." : "Accept job"}
            </button>
            <button className="driver-status-button" disabled={Boolean(busy)} onClick={() => handleStatus("declined")} type="button">
              {busy === "declined" ? "Declining..." : "Decline job"}
            </button>
          </div>
        ) : (
          <>
            <div className="driver-stepper" aria-label="Selected job progress">
              {deliveryFlow.map((status, index) => (
                <TimelineStep
                  active={selectedJob?.status === status.value}
                  done={statusIndex > index || selectedJob?.status === "delivered"}
                  key={status.value}
                  label={status.label}
                />
              ))}
            </div>
            <div className="driver-status-grid">
              {deliveryFlow.map(status => (
                <button
                  className={selectedJob?.status === status.value ? "driver-status-button active" : "driver-status-button"}
                  disabled={!selectedJob || Boolean(busy) || selectedJob?.status === "declined"}
                  key={status.value}
                  onClick={() => handleStatus(status.value)}
                  type="button"
                >
                  {busy === status.value ? "Updating..." : status.label}
                </button>
              ))}
            </div>
          </>
        )}

        {/* Failed delivery reschedule form */}
        {reschedule.visible && selectedJob?.status === "failed_delivery" && (
          <form className="reschedule-form" onSubmit={handleRescheduleSubmit}>
            <div className="section-head" style={{ marginBottom: 10 }}>
              <div>
                <span className="card-label">Reschedule delivery</span>
                <h3>Set new delivery date</h3>
              </div>
            </div>
            <div className="af-grid-2">
              <div className="af-field">
                <label className="af-label">New delivery date / time</label>
                <input
                  className="af-input"
                  type="datetime-local"
                  value={reschedule.date}
                  onChange={e => setReschedule(r => ({ ...r, date: e.target.value }))}
                  required
                />
              </div>
              <div className="af-field">
                <label className="af-label">Reschedule reason</label>
                <input
                  className="af-input"
                  value={reschedule.reason}
                  onChange={e => setReschedule(r => ({ ...r, reason: e.target.value }))}
                  placeholder="Customer unavailable, access issue..."
                />
              </div>
            </div>
            <div className="driver-action-row">
              <button className="af-submit-btn" type="submit" disabled={!reschedule.date || busy === "reschedule"}>
                {busy === "reschedule" ? "Rescheduling..." : "Confirm reschedule"}
              </button>
              <button
                type="button"
                className="header-action-button"
                onClick={() => setReschedule({ visible: false, date: "", reason: "" })}
              >
                Dismiss
              </button>
            </div>
          </form>
        )}
      </section>

      {/* ── POD + Shift ── */}
      <section className="content-grid" id="pod">
        <article className="content-card">
          <div className="section-head">
            <div>
              <span className="card-label">Proof of Delivery</span>
              <h2>Signature, photo, notes</h2>
            </div>
            <StatusPill tone={selectedJob?.podStatus === "verified" ? "success" : "warning"}>
              POD: {selectedJob?.podStatus || "pending"}
            </StatusPill>
          </div>

          <form className="af-form" onSubmit={handlePodSubmit}>
            {/* Signature — canvas or file */}
            <div className="af-field">
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <label className="af-label" style={{ margin: 0 }}>Customer signature</label>
                <button
                  type="button"
                  className="header-action-button"
                  style={{ padding: "3px 10px", fontSize: "0.75rem" }}
                  onClick={() => setUseSigPad(v => !v)}
                >
                  {useSigPad ? "Use file upload" : "Use signature pad"}
                </button>
              </div>

              {useSigPad ? (
                <SignatureCanvas onCapture={dataUrl => setPod(p => ({ ...p, signatureData: dataUrl }))} />
              ) : (
                <input
                  className="af-input"
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={e => readFileAsDataUrl(e.target.files?.[0], value => setPod(p => ({ ...p, signatureData: value })))}
                />
              )}
            </div>

            <div className="af-field">
              <label className="af-label">Delivery photo</label>
              <input
                className="af-input"
                type="file"
                accept="image/*"
                capture="environment"
                onChange={e => readFileAsDataUrl(e.target.files?.[0], value => setPod(p => ({ ...p, photoData: value })))}
              />
            </div>

            <div className="af-field">
              <label className="af-label">Delivery notes</label>
              <textarea
                className="af-input"
                value={pod.deliveryNotes}
                onChange={e => setPod(p => ({ ...p, deliveryNotes: e.target.value }))}
                placeholder="Receiver name, condition, exceptions..."
              />
            </div>

            <div className="pod-preview-grid">
              <div>
                <span className="card-label">Signature preview</span>
                {pod.signatureData
                  ? <img alt="Signature preview" src={pod.signatureData} />
                  : <p>No signature captured.</p>}
              </div>
              <div>
                <span className="card-label">Delivery photo preview</span>
                {pod.photoData
                  ? <img alt="Delivery proof preview" src={pod.photoData} />
                  : <p>No delivery photo selected.</p>}
              </div>
            </div>

            <button className="af-submit-btn" disabled={!selectedJob || busy === "pod"} type="submit">
              {busy === "pod" ? "Submitting..." : "Submit POD"}
            </button>
          </form>
        </article>

        {/* ── Shift ── */}
        <article className="content-card" id="shift">
          <div className="section-head">
            <div>
              <span className="card-label">Shift</span>
              <h2>Start / end shift</h2>
            </div>
            <StatusPill tone={data?.shift ? "success" : "neutral"}>{data?.shift?.startedAt || "Not started"}</StatusPill>
          </div>

          <div className="driver-shift-panel">
            <Detail label="Current state" value={data?.shift ? "Shift active" : "Off shift"} />
            <Detail label="Started"       value={data?.shift?.startedAt} />
          </div>

          <textarea
            className="af-input"
            value={shiftNote}
            onChange={e => setShiftNote(e.target.value)}
            placeholder="Optional shift note: vehicle checks, handover, delay reason..."
          />
          <div className="driver-action-row">
            <button className="af-submit-btn"           disabled={Boolean(data?.shift) || Boolean(busy)} onClick={handleShiftStart} type="button">Start shift</button>
            <button className="header-action-button danger" disabled={!data?.shift || Boolean(busy)}       onClick={handleShiftEnd}   type="button">End shift</button>
          </div>

          {/* Shift history */}
          {(data?.shiftHistory || []).length > 0 && (
            <div style={{ marginTop: 16 }}>
              <span className="card-label">Recent shifts</span>
              <div className="data-rows compact" style={{ marginTop: 8 }}>
                {data.shiftHistory.map(s => (
                  <div className="data-row" key={s.id}>
                    <div>
                      <strong>{s.start}</strong>
                      <p>Ended: {s.end}</p>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <span>{s.hours}</span>
                      <p>{s.status}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </article>
      </section>

      {/* ── Reports ── */}
      <section className="content-grid" id="reports">
        <article className="content-card">
          <div className="section-head">
            <div>
              <span className="card-label">Expense / fuel entry</span>
              <h2>Record cost</h2>
            </div>
          </div>
          <form className="af-form" onSubmit={handleExpenseSubmit}>
            <div className="af-grid-2">
              <select className="af-select" value={expense.expenseType} onChange={e => setExpense(p => ({ ...p, expenseType: e.target.value }))}>
                <option value="fuel">Fuel</option>
                <option value="toll">Toll</option>
                <option value="parking">Parking</option>
                <option value="repair">Repair</option>
                <option value="meal">Meal</option>
                <option value="other">Other</option>
              </select>
              <input className="af-input" type="number" min="0" step="0.01" value={expense.amount} onChange={e => setExpense(p => ({ ...p, amount: e.target.value }))} placeholder="Amount GBP" required />
            </div>
            <input className="af-input" type="file" accept="image/*,.pdf" onChange={e => readFileAsDataUrl(e.target.files?.[0], value => setExpense(p => ({ ...p, receiptData: value })))} />
            <textarea className="af-input" value={expense.notes} onChange={e => setExpense(p => ({ ...p, notes: e.target.value }))} placeholder="Fuel litres, receipt ref, notes..." />
            <button className="af-submit-btn" disabled={busy === "expense"} type="submit">{busy === "expense" ? "Saving..." : "Save expense"}</button>
          </form>
        </article>

        <article className="content-card">
          <div className="section-head">
            <div>
              <span className="card-label">Vehicle defect report</span>
              <h2>Report issue</h2>
            </div>
          </div>
          <form className="af-form" onSubmit={handleDefectSubmit}>
            <div className="af-grid-2">
              <input className="af-input" value={defect.defectType} onChange={e => setDefect(p => ({ ...p, defectType: e.target.value }))} placeholder="Defect type" required />
              <select className="af-select" value={defect.severity} onChange={e => setDefect(p => ({ ...p, severity: e.target.value }))}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
            <textarea className="af-input" value={defect.description} onChange={e => setDefect(p => ({ ...p, description: e.target.value }))} placeholder="Describe the issue..." required />
            <button className="af-submit-btn" disabled={busy === "defect"} type="submit">{busy === "defect" ? "Submitting..." : "Submit defect"}</button>
          </form>
        </article>
      </section>

      {/* ── Expenses + Upcoming jobs ── */}
      <section className="content-grid">
        <article className="content-card">
          <div className="section-head">
            <div>
              <span className="card-label">Recent expenses</span>
              <h2>Submitted costs</h2>
            </div>
            <StatusPill tone="neutral">{data?.expenses?.length || 0} entries</StatusPill>
          </div>
          <div className="data-rows compact">
            {(data?.expenses || []).length ? data.expenses.map(item => (
              <div className="data-row" key={item.id}>
                <div>
                  <strong>{item.type}</strong>
                  <p>{item.jobCode} · {item.note}</p>
                </div>
                <div>
                  <span>{item.amount}</span>
                  <p>{item.at}</p>
                </div>
                <StatusPill tone="neutral">sent</StatusPill>
              </div>
            )) : <p className="driver-empty">No expense entries submitted yet.</p>}
          </div>
        </article>

        <article className="content-card">
          <div className="section-head">
            <div>
              <span className="card-label">Upcoming work</span>
              <h2>Next assigned jobs</h2>
            </div>
            <StatusPill tone="neutral">{data?.upcomingJobs?.length || 0} jobs</StatusPill>
          </div>
          <div className="data-rows compact">
            {(data?.upcomingJobs || []).length ? data.upcomingJobs.slice(0, 5).map(job => (
              <button className="driver-mini-row" key={job.id} onClick={() => setSelectedJobId(job.id)} type="button">
                <div>
                  <strong>{job.code}</strong>
                  <p>{job.route.from} to {job.route.to}</p>
                </div>
                <span>{job.schedule.plannedDeparture}</span>
              </button>
            )) : <p className="driver-empty">No upcoming jobs in the queue.</p>}
          </div>
        </article>
      </section>

      {/* ── History: Defects + POD ── */}
      <section className="content-grid" id="history">
        <article className="content-card">
          <div className="section-head">
            <div>
              <span className="card-label">Defect history</span>
              <h2>Recent vehicle reports</h2>
            </div>
            <StatusPill tone="neutral">{data?.defectHistory?.length || 0} reports</StatusPill>
          </div>
          <div className="data-rows compact">
            {(data?.defectHistory || []).length ? data.defectHistory.map(d => (
              <div className="data-row" key={d.id}>
                <div>
                  <strong>{d.type}</strong>
                  <p>{d.vehicle} · {d.at}</p>
                </div>
                <div style={{ textAlign: "right" }}>
                  <StatusPill tone={d.severity === "critical" || d.severity === "high" ? "danger" : d.severity === "medium" ? "warning" : "neutral"}>{d.severity}</StatusPill>
                  <p style={{ fontSize: "0.78rem", color: "#64748b", marginTop: 4 }}>{d.status}</p>
                </div>
              </div>
            )) : <p className="driver-empty">No defect reports submitted yet.</p>}
          </div>
        </article>

        <article className="content-card">
          <div className="section-head">
            <div>
              <span className="card-label">POD history</span>
              <h2>Delivered jobs</h2>
            </div>
            <StatusPill tone="neutral">{data?.podHistory?.length || 0} deliveries</StatusPill>
          </div>
          <div className="data-rows compact">
            {(data?.podHistory || []).length ? data.podHistory.map(p => (
              <div className="data-row" key={p.id}>
                <div>
                  <strong>{p.code}</strong>
                  <p>Drop: {p.to}</p>
                  {p.notes && <p style={{ color: "#64748b", fontSize: "0.75rem" }}>{p.notes}</p>}
                </div>
                <StatusPill tone={p.podStatus === "verified" ? "success" : p.podStatus === "uploaded" ? "warning" : "neutral"}>
                  {p.podStatus || "pending"}
                </StatusPill>
              </div>
            )) : <p className="driver-empty">No delivered jobs yet.</p>}
          </div>
        </article>
      </section>

      {/* ── In-app messaging ── */}
      <section className="content-card" id="messages" style={{ marginBottom: 16 }}>
        <div className="section-head">
          <div>
            <span className="card-label">In-app messaging</span>
            <h2>Driver ↔ Dispatch</h2>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button className="header-action-button" type="button" onClick={loadMessages}>Refresh</button>
          </div>
        </div>

        <div className="message-thread">
          {msgLoading && <p className="driver-empty">Loading messages...</p>}
          {!msgLoading && messages.length === 0 && (
            <p className="driver-empty">No messages yet. Send one below to contact dispatch.</p>
          )}
          {messages.map(msg => (
            <div key={msg.id} className={`message-bubble ${msg.senderRole === "driver" ? "outgoing" : "incoming"}`}>
              <span className="message-meta">{msg.senderName} · {msg.at}</span>
              <p>{msg.body}</p>
            </div>
          ))}
        </div>

        <form className="message-compose" onSubmit={handleSendMessage}>
          <textarea
            className="af-input"
            value={newMessage}
            onChange={e => setNewMessage(e.target.value)}
            placeholder="Type a message to dispatch..."
            rows={2}
          />
          <button
            className="af-submit-btn"
            type="submit"
            disabled={!newMessage.trim() || msgSending}
            style={{ width: "auto" }}
          >
            {msgSending ? "Sending..." : "Send to dispatch"}
          </button>
        </form>
      </section>
    </PanelLayout>
  );
}
