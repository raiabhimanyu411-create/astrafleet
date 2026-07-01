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
import { getRealtimeSocket } from "../../api/realtime";
import { logout } from "../../api/authApi";
import { NotificationBell } from "../../components/NotificationBell";
import { NotificationCenter } from "../../components/NotificationCenter";
import { PanelLayout } from "../../components/PanelLayout";
import { StatCard } from "../../components/StatCard";
import { StateNotice } from "../../components/StateNotice";
import { StatusPill } from "../../components/StatusPill";
import { clearAuthSession, getAuthSession } from "../../utils/authSession";
import { gpsErrorMessage, positionToPayload, requestDriverGpsAccess, watchDriverGps } from "../../utils/driverGps";

const WALKAROUND_CHECKS = [
  { key: "tyres",       label: "Tyres – Pressure And Condition" },
  { key: "lights",      label: "Lights And Indicators" },
  { key: "brakes",      label: "Brakes – Service And Parking" },
  { key: "mirrors",     label: "Mirrors And Windscreen" },
  { key: "fluids",      label: "Oil, Coolant, And Fluid Levels" },
  { key: "coupling",    label: "Coupling And Trailer Security" },
  { key: "load",        label: "Load Security And Weight" },
  { key: "docs",        label: "Driver Docs And Vehicle Paperwork" },
  { key: "bodywork",    label: "Bodywork And Chassis" },
  { key: "horn",        label: "Horn And Warning Devices" },
  { key: "wipers",      label: "Wipers And Washers" },
  { key: "speedometer", label: "Speedometer And Instruments" },
];

const driverMenu = [
  { href: "#overview",   label: "Overview" },
  { href: "#live",       label: "Live Work" },
  { href: "#notifications", label: "Notifications" },
  { href: "#pod",        label: "POD" },
  { href: "#reports",    label: "Reports" },
  { href: "#history",    label: "History" },
  { href: "#messages",   label: "Messages" },
];

const driverWorkspaces = [
  { key: "live", label: "Live Work", detail: "Jobs + status + route" },
  { key: "pod", label: "POD + Shift", detail: "Proof and shift" },
  { key: "reports", label: "Reports", detail: "Expense or defect" },
  { key: "history", label: "History", detail: "Past activity" },
  { key: "messages", label: "Messages", detail: "Admin chat" },
  { key: "notifications", label: "Alerts", detail: "Inbox" },
  { key: "overview", label: "Overview", detail: "Driver summary" },
];

const allowedStatusTransitions = {
  offered: ["accepted", "declined"],
  accepted: ["arrived_pickup", "failed_delivery"],
  arrived_pickup: ["loaded", "failed_delivery"],
  loaded: ["in_transit", "failed_delivery"],
  in_transit: ["arrived_drop", "failed_delivery"],
  arrived_drop: ["failed_delivery"],
  delivered: [],
  failed_delivery: [],
  declined: []
};

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
      <button type="button" className="header-action-button" onClick={clearCanvas}>Clear Signature</button>
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
  const [gpsBlocked,    setGpsBlocked]    = useState(false);

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
  const [messageAlert, setMessageAlert] = useState(null);

  // Failed delivery reschedule
  const [reschedule, setReschedule] = useState({ visible: false, date: "", reason: "" });
  const [jobFilter, setJobFilter] = useState("open");
  const [activeSection, setActiveSection] = useState("live");

  const navigate         = useNavigate();
  const session          = getAuthSession();
  const userId           = session?.id;
  const selectedJobIdRef = useRef(selectedJobId);
  const gpsLogoutRef     = useRef(false);

  const jobs = useMemo(() => {
    const combined = data?.jobs || [...(data?.todayJobs || []), ...(data?.upcomingJobs || []), data?.activeJob].filter(Boolean);
    return combined.filter((job, idx, arr) => arr.findIndex(j => j.id === job.id) === idx);
  }, [data]);

  const selectedJob    = jobs.find(j => j.id === selectedJobId) || data?.activeJob || jobs[0] || null;
  const deliveryFlow   = (data?.statusFlow || []).filter(s => !["offered", "declined"].includes(s.value));
  const statusButtonFlow = deliveryFlow.filter(s => s.value !== "delivered");
  const statusIndex    = deliveryFlow.findIndex(s => s.value === selectedJob?.status);
  const incompleteJobs = jobs.filter(j => !["delivered", "failed_delivery", "declined"].includes(j.status));
  const completedJobs  = jobs.filter(j => ["delivered", "failed_delivery", "declined"].includes(j.status));
  const todayJobs      = jobs.filter(j => data?.todayJobs?.some(today => today.id === j.id));
  const filteredJobs   = jobFilter === "today"
    ? todayJobs
    : jobFilter === "upcoming"
      ? (data?.upcomingJobs || [])
      : jobFilter === "completed"
        ? completedJobs
        : incompleteJobs;
  const selectedStatus = selectedJob?.status || "accepted";
  const allowedNextStatuses = new Set([selectedStatus, ...(allowedStatusTransitions[selectedStatus] || [])]);
  const driverPanelMenu = useMemo(() => driverMenu.map(item => ({
    ...item,
    onClick: () => setActiveSection(item.href.replace("#", "") || "live")
  })), []);

  function selectSection(section) {
    setActiveSection(section);
    window.history.replaceState(null, "", `#${section}`);
  }

  useEffect(() => {
    function syncHashSection() {
      const hashSection = window.location.hash.replace("#", "");
      if (driverWorkspaces.some(item => item.key === hashSection)) {
        setActiveSection(hashSection);
      }
    }

    syncHashSection();
    window.addEventListener("hashchange", syncHashSection);
    return () => window.removeEventListener("hashchange", syncHashSection);
  }, []);

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
    if (session?.role === "driver" && !session?.sessionToken) {
      clearAuthSession();
      navigate("/", { replace: true });
      return undefined;
    }
    loadPanel();
    loadMessages();
    const panelTimer = setInterval(() => loadPanel(selectedJobIdRef.current), 30000);
    const msgTimer   = setInterval(() => loadMessages(), 60000);
    return () => { clearInterval(panelTimer); clearInterval(msgTimer); };
  }, [navigate, session?.role, session?.sessionToken, userId]);

  useEffect(() => {
    const driverId = data?.driver?.id;
    if (!driverId) return undefined;

    const socket = getRealtimeSocket();
    function handleChatMessage(message) {
      if (Number(message.driverId) !== Number(driverId)) return;
      setMessages(prev => prev.some(item => item.id === message.id) ? prev : [...prev, message]);
      if (message.senderRole !== "driver") {
        setMessageAlert(message);
      }
    }
    function handleJobAssigned(payload) {
      if (Number(payload.driverId) !== Number(driverId)) return;
      loadPanel(payload.jobId);
      loadMessages();
    }

    socket.connect();
    socket.emit("driver-chat:join", driverId);
    socket.on("driver-chat:message", handleChatMessage);
    socket.on("driver-job:assigned", handleJobAssigned);

    return () => {
      socket.off("driver-chat:message", handleChatMessage);
      socket.off("driver-job:assigned", handleJobAssigned);
      socket.emit("driver-chat:leave", driverId);
    };
  }, [data?.driver?.id]);

  useEffect(() => {
    if (!userId) return undefined;

    function handleGpsBlocked(err) {
      if (gpsLogoutRef.current) return;
      gpsLogoutRef.current = true;
      setGpsBlocked(true);
      setNotice(`${gpsErrorMessage(err)} Live admin tracking is paused until GPS access is restored.`);
      setNoticeError(true);
    }

    return watchDriverGps({
      onPosition: (position) => {
        gpsLogoutRef.current = false;
        setGpsBlocked(false);
        updateDriverLocation(userId, positionToPayload(position)).catch(() => {});
      },
      onBlocked: handleGpsBlocked
    });
  }, [navigate, userId]);

  async function handleLogout() {
    try {
      await logout();
    } catch {
      // Still clear the local session if the backend is temporarily unavailable.
    }
    clearAuthSession();
    navigate("/", { replace: true });
  }

  async function handleRetryGps() {
    try {
      setBusy("gps");
      const position = await requestDriverGpsAccess();
      await updateDriverLocation(userId, positionToPayload(position));
      gpsLogoutRef.current = false;
      setGpsBlocked(false);
      setNotice("GPS tracking restored.");
      setNoticeError(false);
    } catch (err) {
      setNotice(gpsErrorMessage(err));
      setNoticeError(true);
    } finally {
      setBusy("");
    }
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
  const hasPodEvidence       = Boolean(pod.signatureData || pod.photoData);
  const podBlockedReason = !selectedJob
    ? "Select a job before submitting POD."
    : ["failed_delivery", "declined"].includes(selectedJob.status)
      ? "POD cannot be submitted for a failed or declined job."
      : !hasPodEvidence
        ? "Signature or delivery photo is required before POD submission."
        : "";

  return (
    <PanelLayout
      badge={data?.header?.badge || "Driver Panel"}
      title={data?.header?.title || "Driver Workspace"}
      description={data?.header?.description || "Daily driver operations in one browser panel."}
      highlights={[]}
      menu={driverPanelMenu}
      roleLabel="Driver Workspace"
      className="driver-panel-shell"
      headerContent={(
        <>
          <NotificationBell
            fetchUrl="/api/drivers/me/notifications"
            paramKey="userId"
            paramValue={userId}
            viewAllTo="#notifications"
          />
          <button className="header-action-button" onClick={() => loadPanel(selectedJob?.id)} type="button">Refresh</button>
          <button className="header-action-button danger" onClick={handleLogout} type="button">Logout</button>
        </>
      )}
    >
      <StateNotice loading={loading} error={error} />

      {messageAlert && (
        <div className="driver-message-alert" role="status" aria-live="polite">
          <button
            className="driver-message-alert-main"
            onClick={() => {
              setActiveSection("messages");
              setMessageAlert(null);
              window.history.replaceState(null, "", "#messages");
            }}
            type="button"
          >
            <span className="card-label">New admin message</span>
            <strong>{messageAlert.senderName || "Dispatch"}</strong>
            <p>{messageAlert.body}</p>
          </button>
          <button
            aria-label="Dismiss message alert"
            className="driver-message-alert-close"
            onClick={() => setMessageAlert(null)}
            type="button"
          >
            ×
          </button>
        </div>
      )}

      {/* ── Document expiry warnings ── */}
      {(data?.docWarnings || []).length > 0 && (
        <div className="doc-expiry-banner">
          <strong>Document Expiry Alert</strong>
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
          <div><strong>{noticeError ? "Action Needed" : "Driver Update"}</strong><p>{notice}</p></div>
          {gpsBlocked && (
            <button className="header-action-button" disabled={busy === "gps"} onClick={handleRetryGps} type="button">
              {busy === "gps" ? "Checking..." : "Retry GPS"}
            </button>
          )}
        </div>
      )}

      <nav className="driver-workspace-tabs" aria-label="Driver workspace sections">
        {driverWorkspaces.map(item => (
          <button
            className={activeSection === item.key ? "active" : ""}
            key={item.key}
            onClick={() => selectSection(item.key)}
            type="button"
          >
            <strong>{item.label}</strong>
            <span>{item.detail}</span>
          </button>
        ))}
      </nav>

      {activeSection === "notifications" && (
        <NotificationCenter
          fetchUrl="/api/drivers/me/notifications"
          paramKey="userId"
          paramValue={userId}
          title="Driver Notification Inbox"
          eyebrow="Driver Alerts"
          emptyBody="No driver jobs, POD reminders, or shift alerts need attention right now."
        />
      )}

      {activeSection === "overview" && (
        <>
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
              <span className="card-label">Break / Rest Timer</span>
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
                Start Break
              </button>
              <button
                className="header-action-button danger"
                type="button"
                disabled={!breakActive}
                onClick={endBreak}
              >
                End Break
              </button>
            </div>
          </section>
        </>
      )}

      {/* ── Jobs + Job spotlight ── */}
      {activeSection === "live" && <section className="content-grid" id="live">
        <article className="content-card">
          <div className="section-head">
            <div>
              <span className="card-label">Today&apos;s Duties</span>
              <h2>Assigned Jobs</h2>
            </div>
            <StatusPill tone={data?.shift ? "success" : "warning"}>{data?.shift ? "Shift Active" : "Off Shift"}</StatusPill>
          </div>
          <div className="driver-job-tabs" role="tablist" aria-label="Job filters">
            <button className={jobFilter === "open" ? "active" : ""} onClick={() => setJobFilter("open")} type="button">Open ({incompleteJobs.length})</button>
            <button className={jobFilter === "today" ? "active" : ""} onClick={() => setJobFilter("today")} type="button">Today ({todayJobs.length})</button>
            <button className={jobFilter === "upcoming" ? "active" : ""} onClick={() => setJobFilter("upcoming")} type="button">Upcoming ({data?.upcomingJobs?.length || 0})</button>
            <button className={jobFilter === "completed" ? "active" : ""} onClick={() => setJobFilter("completed")} type="button">Closed ({completedJobs.length})</button>
          </div>
          <div className="driver-job-list">
            {filteredJobs.length ? filteredJobs.map(job => (
              <JobButton
                active={selectedJob?.id === job.id}
                job={job}
                key={job.id}
                onClick={() => setSelectedJobId(job.id)}
              />
            )) : <p className="driver-empty">No jobs in this view.</p>}
          </div>
        </article>

        <article className="content-card trip-spotlight">
          <div className="section-head">
            <div>
              <span className="card-label">Selected Job</span>
              <h2>{selectedJob?.code || "No job selected"}</h2>
            </div>
            {selectedJob && <StatusPill tone={selectedJob.statusTone}>{selectedJob.statusLabel}</StatusPill>}
          </div>

          {selectedJob ? (
            <>
              <div className="driver-route-timeline">
                {(selectedJob.routePoints || [
                  {
                    id: "pickup",
                    label: "Pickup",
                    address: selectedJob.route.pickupAddress,
                    arrival: selectedJob.schedule.plannedDeparture,
                    departure: selectedJob.schedule.plannedDeparture
                  },
                  {
                    id: "drop-1",
                    label: "Drop 1",
                    address: selectedJob.route.dropAddress,
                    arrival: selectedJob.schedule.eta,
                    departure: "—"
                  }
                ]).map((point) => (
                  <div className={`driver-route-point ${point.type || ""}`} key={point.id || point.label}>
                    <span className="card-label">{point.label}</span>
                    <strong>{point.address}</strong>
                    <div>
                      <p>Arrival: {point.arrival || "—"}</p>
                      <p>Departure: {point.departure || "—"}</p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="detail-grid">
                <Detail label="Reference"    value={selectedJob.reference} />
                <Detail label="Load ID"      value={selectedJob.loadId} />
                <Detail label="Vehicle"      value={selectedJob.vehicle} />
                <Detail label="Trailer" value={selectedJob.trailer} />
                <Detail label="Load"         value={`${selectedJob.load.type} · ${selectedJob.load.weight}`} />
                <Detail label="Load Detail"  value={selectedJob.load.description} />
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
                  <option value="start">Trip Start</option>
                  <option value="end">Trip End</option>
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
                <a className="af-submit-btn driver-nav-link" href={selectedJob.route.navigationUrl} rel="noreferrer" target="_blank">Open Navigation</a>
              </div>
            </>
          ) : <p className="driver-empty">Select a job to see route, customer, and load details.</p>}
        </article>
      </section>}

      {/* ── Job status ── */}
      {activeSection === "live" && <section className="content-card" id="status" style={{ marginBottom: 16 }}>
        <div className="section-head">
          <div>
            <span className="card-label">Job Status Update</span>
            <h2>Move Job Through Delivery Flow</h2>
          </div>
          <StatusPill tone="neutral">Dispatch Sync</StatusPill>
        </div>
        {selectedJob?.status === "offered" ? (
          <div className="driver-status-grid">
            <button className="driver-status-button active" disabled={Boolean(busy)} onClick={() => handleStatus("accepted")} type="button">
              {busy === "accepted" ? "Accepting..." : "Accept Job"}
            </button>
            <button className="driver-status-button" disabled={Boolean(busy)} onClick={() => handleStatus("declined")} type="button">
              {busy === "declined" ? "Declining..." : "Decline Job"}
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
              {statusButtonFlow.map(status => {
                const allowed = allowedNextStatuses.has(status.value);
                return (
                <button
                  className={selectedJob?.status === status.value ? "driver-status-button active" : "driver-status-button"}
                  disabled={!selectedJob || Boolean(busy) || !allowed || ["declined", "failed_delivery", "delivered"].includes(selectedJob?.status)}
                  key={status.value}
                  onClick={() => handleStatus(status.value)}
                  title={!allowed ? "Complete the previous job step first." : undefined}
                  type="button"
                >
                  {busy === status.value ? "Updating..." : status.label}
                </button>
              );
              })}
            </div>
            {selectedJob?.status === "arrived_drop" && (
              <p className="driver-empty" style={{ marginTop: 10 }}>Submit POD with a signature or photo to complete this job.</p>
            )}
          </>
        )}

        {/* Failed delivery reschedule form */}
        {reschedule.visible && selectedJob?.status === "failed_delivery" && (
          <form className="reschedule-form" onSubmit={handleRescheduleSubmit}>
            <div className="section-head" style={{ marginBottom: 10 }}>
              <div>
                <span className="card-label">Reschedule Delivery</span>
                <h3>Set New Delivery Date</h3>
              </div>
            </div>
            <div className="af-grid-2">
              <div className="af-field">
                <label className="af-label">New Delivery Date / Time</label>
                <input
                  className="af-input"
                  type="datetime-local"
                  value={reschedule.date}
                  onChange={e => setReschedule(r => ({ ...r, date: e.target.value }))}
                  required
                />
              </div>
              <div className="af-field">
                <label className="af-label">Reschedule Reason</label>
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
                {busy === "reschedule" ? "Rescheduling..." : "Confirm Reschedule"}
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
      </section>}

      {/* ── POD + Shift ── */}
      {activeSection === "pod" && <section className="content-grid" id="pod">
        <article className="content-card">
          <div className="section-head">
            <div>
              <span className="card-label">Proof Of Delivery</span>
              <h2>Signature, Photo, Notes</h2>
            </div>
            <StatusPill tone={selectedJob?.podStatus === "verified" ? "success" : "warning"}>
              POD: {selectedJob?.podStatus || "pending"}
            </StatusPill>
          </div>

          <form className="af-form" onSubmit={handlePodSubmit}>
            {/* Signature — canvas or file */}
            <div className="af-field">
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <label className="af-label" style={{ margin: 0 }}>Customer Signature</label>
                <button
                  type="button"
                  className="header-action-button"
                  style={{ padding: "3px 10px", fontSize: "0.75rem" }}
                  onClick={() => setUseSigPad(v => !v)}
                >
                  {useSigPad ? "Use File Upload" : "Use Signature Pad"}
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
              <label className="af-label">Delivery Photo</label>
              <input
                className="af-input"
                type="file"
                accept="image/*"
                capture="environment"
                onChange={e => readFileAsDataUrl(e.target.files?.[0], value => setPod(p => ({ ...p, photoData: value })))}
              />
            </div>

            <div className="af-field">
              <label className="af-label">Delivery Notes</label>
              <textarea
                className="af-input"
                value={pod.deliveryNotes}
                onChange={e => setPod(p => ({ ...p, deliveryNotes: e.target.value }))}
                placeholder="Receiver name, condition, exceptions..."
              />
            </div>

            <div className="pod-preview-grid">
              <div>
                <span className="card-label">Signature Preview</span>
                {pod.signatureData
                  ? <img alt="Signature preview" src={pod.signatureData} />
                  : <p>No signature captured.</p>}
              </div>
              <div>
                <span className="card-label">Delivery Photo Preview</span>
                {pod.photoData
                  ? <img alt="Delivery proof preview" src={pod.photoData} />
                  : <p>No delivery photo selected.</p>}
              </div>
            </div>

            <button className="af-submit-btn" disabled={Boolean(podBlockedReason) || busy === "pod"} type="submit">
              {busy === "pod" ? "Submitting..." : "Submit POD"}
            </button>
            {podBlockedReason && <p className="driver-empty">{podBlockedReason}</p>}
            {!podBlockedReason && !data?.shift && (
              <p className="driver-empty">Shift is not active. Submitting POD will start the shift record automatically.</p>
            )}
          </form>
        </article>

        {/* ── Shift ── */}
        <article className="content-card" id="shift">
          <div className="section-head">
            <div>
              <span className="card-label">Shift</span>
              <h2>Start / End Shift</h2>
            </div>
            <StatusPill tone={data?.shift ? "success" : "neutral"}>{data?.shift?.startedAt || "Not started"}</StatusPill>
          </div>

          <div className="driver-shift-panel">
            <Detail label="Current State" value={data?.shift ? "Shift Active" : "Off Shift"} />
            <Detail label="Started"       value={data?.shift?.startedAt} />
          </div>

          <textarea
            className="af-input"
            value={shiftNote}
            onChange={e => setShiftNote(e.target.value)}
            placeholder="Optional shift note: vehicle checks, handover, delay reason..."
          />
          <div className="driver-action-row">
            <button className="af-submit-btn"           disabled={Boolean(data?.shift) || Boolean(busy)} onClick={handleShiftStart} type="button">Start Shift</button>
            <button className="header-action-button danger" disabled={!data?.shift || Boolean(busy)}       onClick={handleShiftEnd}   type="button">End Shift</button>
          </div>

          {/* Shift history */}
          {(data?.shiftHistory || []).length > 0 && (
            <div style={{ marginTop: 16 }}>
              <span className="card-label">Recent Shifts</span>
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
      </section>}

      {/* ── Reports ── */}
      {activeSection === "reports" && <section className="content-grid" id="reports">
        <article className="content-card">
          <div className="section-head">
            <div>
              <span className="card-label">Expense / Fuel Entry</span>
              <h2>Record Cost</h2>
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
            <button className="af-submit-btn" disabled={busy === "expense"} type="submit">{busy === "expense" ? "Saving..." : "Save Expense"}</button>
          </form>
        </article>

        <article className="content-card">
          <div className="section-head">
            <div>
              <span className="card-label">Vehicle Defect Report</span>
              <h2>Report Issue</h2>
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
            <button className="af-submit-btn" disabled={busy === "defect"} type="submit">{busy === "defect" ? "Submitting..." : "Submit Defect"}</button>
          </form>
        </article>
      </section>}

      {/* ── Expenses + Upcoming jobs ── */}
      {activeSection === "history" && <section className="content-grid">
        <article className="content-card">
          <div className="section-head">
            <div>
              <span className="card-label">Recent Expenses</span>
              <h2>Submitted Costs</h2>
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
              <span className="card-label">Upcoming Work</span>
              <h2>Next Assigned Jobs</h2>
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
      </section>}

      {/* ── History: Defects + POD ── */}
      {activeSection === "history" && <section className="content-grid" id="history">
        <article className="content-card">
          <div className="section-head">
            <div>
              <span className="card-label">Defect History</span>
              <h2>Recent Vehicle Reports</h2>
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
              <span className="card-label">POD History</span>
              <h2>Delivered Jobs</h2>
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
      </section>}

      {/* ── In-app messaging ── */}
      {activeSection === "messages" && <section className="content-card" id="messages" style={{ marginBottom: 16 }}>
        <div className="section-head">
          <div>
            <span className="card-label">In-App Messaging</span>
            <h2>Driver ↔ Admin Support</h2>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button className="header-action-button" type="button" onClick={loadMessages}>Refresh</button>
          </div>
        </div>

        <div className="message-thread">
          {msgLoading && <p className="driver-empty">Loading messages...</p>}
          {!msgLoading && messages.length === 0 && (
            <p className="driver-empty">No messages yet. Send one below to contact admin support.</p>
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
            placeholder="Type a message to admin support..."
            rows={2}
          />
          <button
            className="af-submit-btn"
            type="submit"
            disabled={!newMessage.trim() || msgSending}
            style={{ width: "auto" }}
          >
            {msgSending ? "Sending..." : "Send To Admin"}
          </button>
        </form>
      </section>}
    </PanelLayout>
  );
}
