import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import api from "../api/axios";
import { getRealtimeSocket, joinAdminChatRoom, leaveAdminChatRoom } from "../api/realtime";
import { getAuthSession } from "../utils/authSession";

let audioContext = null;

function ensureAudioContext() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;
  if (!audioContext) audioContext = new AudioContextClass();
  if (audioContext.state === "suspended") audioContext.resume().catch(() => {});
  return audioContext;
}

function playAdminNotificationTone(kind = "notification") {
  const context = ensureAudioContext();
  if (!context || context.state !== "running") return;
  const now = context.currentTime;
  const notes = kind === "message"
    ? [[880, 0], [1175, 0.13], [880, 0.27]]
    : [[740, 0], [988, 0.14], [1318, 0.3]];

  notes.forEach(([frequency, offset], index) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = index === notes.length - 1 ? "triangle" : "sine";
    oscillator.frequency.setValueAtTime(frequency, now + offset);
    gain.gain.setValueAtTime(0.0001, now + offset);
    gain.gain.exponentialRampToValueAtTime(0.22, now + offset + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.16);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(now + offset);
    oscillator.stop(now + offset + 0.18);
  });
}

export function GlobalAdminNotifier() {
  useLocation();
  const session = getAuthSession();
  const navigate = useNavigate();
  const [toasts, setToasts] = useState([]);
  const knownNotificationIds = useRef(new Set());
  const initialised = useRef(false);
  const activeChatDriverId = useRef(null);
  const toastSequence = useRef(0);

  const dismissToast = useCallback((toastId) => {
    setToasts(current => current.filter(item => item.toastId !== toastId));
  }, []);

  const pushToast = useCallback((item, soundKind) => {
    const toastId = `${Date.now()}-${++toastSequence.current}`;
    setToasts(current => [...current.slice(-2), { ...item, toastId }]);
    playAdminNotificationTone(soundKind);
    window.setTimeout(() => dismissToast(toastId), 9000);
  }, [dismissToast]);

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
        const response = await api.get("/api/admin/notifications");
        if (!alive) return;
        const notifications = response.data.notifications || [];
        if (!initialised.current) {
          notifications.forEach(item => knownNotificationIds.current.add(item.id));
          initialised.current = true;
          return;
        }
        notifications.forEach(item => {
          if (knownNotificationIds.current.has(item.id)) return;
          knownNotificationIds.current.add(item.id);
          if (!item.isRead) {
            pushToast({ ...item, kind: "notification" }, "notification");
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
  }, [pushToast, session?.role]);

  useEffect(() => {
    if (session?.role !== "admin") return undefined;
    const socket = getRealtimeSocket();

    function handleDriverMessage(message) {
      if (message.senderRole !== "driver") return;
      if (Number(activeChatDriverId.current) === Number(message.driverId)) return;
      pushToast({
        id: `chat-${message.id}`,
        kind: "message",
        title: `Message from ${message.driverName || message.senderName || "driver"}`,
        body: message.body,
        link: `/admin/drivers/${message.driverId}`,
        driverId: message.driverId,
        source: "Driver chat"
      }, "message");
    }

    socket.connect();
    joinAdminChatRoom();
    socket.on("driver-chat:message", handleDriverMessage);
    return () => {
      socket.off("driver-chat:message", handleDriverMessage);
      leaveAdminChatRoom();
    };
  }, [pushToast, session?.role]);

  if (session?.role !== "admin" || !toasts.length) return null;

  function openToast(toast) {
    dismissToast(toast.toastId);
    if (toast.kind === "notification") {
      api.patch(`/api/admin/notifications/${encodeURIComponent(toast.id)}/read`)
        .then(() => window.dispatchEvent(new CustomEvent("admin-notification:refresh")))
        .catch(() => {});
    }
    if (toast.kind === "message" && toast.driverId) {
      navigate("/admin/drivers");
      const selectDriverChat = () => {
        window.dispatchEvent(new CustomEvent("admin-driver-chat:select", { detail: { driverId: toast.driverId } }));
      };
      window.setTimeout(selectDriverChat, 150);
      window.setTimeout(selectDriverChat, 1000);
      return;
    }
    if (toast.link) navigate(toast.link);
  }

  return (
    <aside className="admin-toast-region" aria-label="New admin notifications" aria-live="assertive">
      {toasts.map(toast => (
        <article className={`admin-live-toast ${toast.kind || "notification"} ${toast.type || "info"}`} key={toast.toastId}>
          <span className="admin-live-toast-icon" aria-hidden="true">{toast.kind === "message" ? "✦" : "!"}</span>
          <button className="admin-live-toast-copy" onClick={() => openToast(toast)} type="button">
            <span>{toast.source || (toast.kind === "message" ? "Driver chat" : "New notification")}</span>
            <strong>{toast.title}</strong>
            <p>{toast.body}</p>
            <small>Click to open</small>
          </button>
          <button className="admin-live-toast-close" aria-label="Close popup" onClick={() => dismissToast(toast.toastId)} type="button">×</button>
        </article>
      ))}
    </aside>
  );
}
