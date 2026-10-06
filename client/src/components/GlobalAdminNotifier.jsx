import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import api from "../api/axios";
import { getRealtimeSocket, joinAdminChatRoom, leaveAdminChatRoom } from "../api/realtime";
import { getAuthSession } from "../utils/authSession";
import { isSoundEnabled, showDesktopAlert } from "../utils/notificationPrefs";
import { SeverityIcon } from "./SeverityIcon";

// How each kind of event behaves. Critical items never auto-dismiss and are
// shown as a page-level flashbar; everything else is a toast that times out.
const SEVERITY = {
  danger: { label: "Critical", duration: null, sound: "critical" },
  warning: { label: "Warning", duration: 15000, sound: "notification" },
  message: { label: "Driver message", duration: 8000, sound: "message" },
  success: { label: "Success", duration: 5000, sound: null },
  info: { label: "Info", duration: 6000, sound: null }
};

const MAX_VISIBLE_TOASTS = 3;
const NOTIFICATIONS_URL = "/api/admin/notifications";

function severityOf(item) {
  if (item.kind === "message") return "message";
  return SEVERITY[item.type] ? item.type : "info";
}

let audioContext = null;

function ensureAudioContext() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;
  if (!audioContext) audioContext = new AudioContextClass();
  if (audioContext.state === "suspended") audioContext.resume().catch(() => {});
  return audioContext;
}

const TONES = {
  message: [[880, 0], [1175, 0.13]],
  notification: [[740, 0], [988, 0.14], [1318, 0.3]],
  critical: [[988, 0], [740, 0.18], [988, 0.36], [740, 0.54]]
};

function playTone(kind) {
  if (!kind || !isSoundEnabled()) return;
  const context = ensureAudioContext();
  if (!context || context.state !== "running") return;
  const now = context.currentTime;
  const notes = TONES[kind] || TONES.notification;
  const peak = kind === "critical" ? 0.28 : 0.18;

  notes.forEach(([frequency, offset], index) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = kind === "critical" ? "square" : index === notes.length - 1 ? "triangle" : "sine";
    oscillator.frequency.setValueAtTime(frequency, now + offset);
    gain.gain.setValueAtTime(0.0001, now + offset);
    gain.gain.exponentialRampToValueAtTime(peak, now + offset + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.16);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(now + offset);
    oscillator.stop(now + offset + 0.18);
  });
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

function Flashbar({ items, onOpen, onAcknowledge, onDismiss }) {
  const [expanded, setExpanded] = useState(false);
  if (!items.length) return null;
  const visible = expanded ? items : items.slice(0, 1);
  const hidden = items.length - visible.length;

  return (
    <section className="af-flashbar" aria-label="Critical alerts" aria-live="assertive">
      {visible.map(item => (
        <article className="af-flash" key={item.toastId} role="alert">
          <span className="af-flash-icon"><SeverityIcon type="danger" /></span>
          <div className="af-flash-copy">
            <strong>{item.title}</strong>
            {item.body && <p>{item.body}</p>}
          </div>
          <div className="af-flash-actions">
            {item.link && <button className="af-flash-btn" onClick={() => onOpen(item)} type="button">View details</button>}
            <button className="af-flash-btn primary" onClick={() => onAcknowledge(item)} type="button">Acknowledge</button>
            <button className="af-flash-close" aria-label="Dismiss alert" onClick={() => onDismiss(item.toastId)} type="button"><CloseIcon /></button>
          </div>
        </article>
      ))}
      {items.length > 1 && (
        <button className="af-flash-toggle" onClick={() => setExpanded(value => !value)} type="button">
          {expanded ? "Collapse" : `Show ${hidden} more critical alert${hidden === 1 ? "" : "s"}`}
        </button>
      )}
    </section>
  );
}

function Toast({ toast, onOpen, onMarkRead, onDismiss }) {
  const severity = severityOf(toast);
  const config = SEVERITY[severity];
  const isMessage = severity === "message";

  return (
    <article className={`af-toast ${severity}`} role="status">
      <span className="af-toast-icon"><SeverityIcon type={severity} /></span>
      <div className="af-toast-copy">
        <span className="af-toast-source">{toast.source || config.label}</span>
        <strong>{toast.title}</strong>
        {toast.body && <p>{toast.body}</p>}
        <div className="af-toast-actions">
          {(isMessage || toast.link) && (
            <button className="af-toast-btn primary" onClick={() => onOpen(toast)} type="button">
              {isMessage ? "Reply" : "View"}
            </button>
          )}
          {!isMessage && (
            <button className="af-toast-btn" onClick={() => onMarkRead(toast)} type="button">Mark as read</button>
          )}
        </div>
      </div>
      <button className="af-toast-close" aria-label="Dismiss notification" onClick={() => onDismiss(toast.toastId)} type="button"><CloseIcon /></button>
      {config.duration && (
        <span
          className="af-toast-progress"
          onAnimationEnd={() => onDismiss(toast.toastId)}
          style={{ animationDuration: `${config.duration}ms` }}
        />
      )}
    </article>
  );
}

export function GlobalAdminNotifier() {
  useLocation();
  const session = getAuthSession();
  const navigate = useNavigate();
  const [toasts, setToasts] = useState([]);
  const [flashes, setFlashes] = useState([]);
  const knownNotificationIds = useRef(new Set());
  const initialised = useRef(false);
  const activeChatDriverId = useRef(null);
  const toastSequence = useRef(0);
  const openRef = useRef(null);

  const dismissToast = useCallback((toastId) => {
    setToasts(current => current.filter(item => item.toastId !== toastId));
  }, []);

  const dismissFlash = useCallback((toastId) => {
    setFlashes(current => current.filter(item => item.toastId !== toastId));
  }, []);

  const dismissAllToasts = useCallback(() => setToasts([]), []);

  const pushItem = useCallback((item, { silent = false } = {}) => {
    const toastId = `${Date.now()}-${++toastSequence.current}`;
    const entry = { ...item, toastId };
    const severity = severityOf(item);

    if (severity === "danger") {
      setFlashes(current => [entry, ...current.filter(existing => existing.id !== item.id)]);
    } else {
      setToasts(current => [...current, entry]);
    }
    if (silent) return;

    playTone(SEVERITY[severity].sound);
    if (severity === "danger" || severity === "message") {
      showDesktopAlert({
        title: item.title,
        body: item.body,
        tag: String(item.id),
        onClick: () => openRef.current?.(entry)
      });
    }
  }, []);

  useEffect(() => {
    const unlock = () => ensureAudioContext();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  useEffect(() => {
    if (session?.role !== "admin") return undefined;

    function handleActiveChat(event) {
      activeChatDriverId.current = event.detail?.driverId ? Number(event.detail.driverId) : null;
    }

    window.addEventListener("admin-driver-chat:active", handleActiveChat);
    return () => window.removeEventListener("admin-driver-chat:active", handleActiveChat);
  }, [session?.role]);

  useEffect(() => {
    if (session?.role !== "admin") return undefined;
    let alive = true;

    async function pollNotifications() {
      try {
        const response = await api.get(NOTIFICATIONS_URL);
        if (!alive) return;
        const notifications = response.data.notifications || [];
        if (!initialised.current) {
          notifications.forEach(item => {
            knownNotificationIds.current.add(item.id);
            // Critical alerts stay on screen until someone acknowledges them,
            // including ones that arrived before this page was opened.
            if (item.type === "danger" && !item.isRead && !item.acknowledged) {
              pushItem({ ...item, kind: "notification" }, { silent: true });
            }
          });
          initialised.current = true;
          return;
        }
        notifications.forEach(item => {
          if (knownNotificationIds.current.has(item.id)) return;
          knownNotificationIds.current.add(item.id);
          if (!item.isRead) {
            pushItem({ ...item, kind: "notification" });
            window.dispatchEvent(new CustomEvent("admin-notification:refresh"));
          }
        });
      } catch {
        // The regular inbox remains the source of truth if polling temporarily fails.
      }
    }

    pollNotifications();
    const timer = window.setInterval(pollNotifications, 10000);
    const refresh = () => pollNotifications();
    window.addEventListener("admin-notification:refresh", refresh);
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener("admin-notification:refresh", refresh);
    };
  }, [pushItem, session?.role]);

  useEffect(() => {
    if (session?.role !== "admin") return undefined;
    const socket = getRealtimeSocket();

    function handleDriverMessage(message) {
      if (message.senderRole !== "driver") return;
      if (Number(activeChatDriverId.current) === Number(message.driverId)) return;
      pushItem({
        id: `chat-${message.id}`,
        kind: "message",
        title: message.driverName || message.senderName || "Driver",
        body: message.body,
        link: `/admin/drivers/${message.driverId}`,
        driverId: message.driverId,
        source: "Driver chat"
      });
    }

    socket.connect();
    joinAdminChatRoom();
    socket.on("driver-chat:message", handleDriverMessage);
    return () => {
      socket.off("driver-chat:message", handleDriverMessage);
      leaveAdminChatRoom();
    };
  }, [pushItem, session?.role]);

  function markRead(item) {
    if (item.kind !== "notification") return Promise.resolve();
    return api.patch(`${NOTIFICATIONS_URL}/${encodeURIComponent(item.id)}/read`, { isRead: true })
      .then(() => window.dispatchEvent(new CustomEvent("admin-notification:refresh")))
      .catch(() => {});
  }

  function openItem(item) {
    dismissToast(item.toastId);
    dismissFlash(item.toastId);
    markRead(item);
    if (item.kind === "message" && item.driverId) {
      navigate("/admin/drivers");
      const selectDriverChat = () => {
        window.dispatchEvent(new CustomEvent("admin-driver-chat:select", { detail: { driverId: item.driverId } }));
      };
      window.setTimeout(selectDriverChat, 150);
      window.setTimeout(selectDriverChat, 1000);
      return;
    }
    if (item.link) navigate(item.link);
  }
  openRef.current = openItem;

  function handleMarkRead(item) {
    dismissToast(item.toastId);
    markRead(item);
  }

  function acknowledge(item) {
    dismissFlash(item.toastId);
    api.post(`${NOTIFICATIONS_URL}/${encodeURIComponent(item.id)}/ack`)
      .then(() => window.dispatchEvent(new CustomEvent("admin-notification:refresh")))
      .catch(() => {});
  }

  if (session?.role !== "admin" || (!toasts.length && !flashes.length)) return null;

  const visibleToasts = toasts.slice(-MAX_VISIBLE_TOASTS);
  const overflow = toasts.length - visibleToasts.length;

  return (
    <>
      <Flashbar items={flashes} onAcknowledge={acknowledge} onDismiss={dismissFlash} onOpen={openItem} />
      {toasts.length > 0 && (
        <aside className="af-toast-region" aria-label="Notifications" aria-live="polite">
          {(overflow > 0 || toasts.length > 1) && (
            <div className="af-toast-stack-head">
              <span>{overflow > 0 ? `+${overflow} more notification${overflow === 1 ? "" : "s"}` : `${toasts.length} notifications`}</span>
              <button onClick={dismissAllToasts} type="button">Dismiss all</button>
            </div>
          )}
          {visibleToasts.map(toast => (
            <Toast key={toast.toastId} onDismiss={dismissToast} onMarkRead={handleMarkRead} onOpen={openItem} toast={toast} />
          ))}
        </aside>
      )}
    </>
  );
}
