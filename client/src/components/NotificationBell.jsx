import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/axios";
import {
  PREFS_EVENT,
  desktopAlertsSupported,
  isDesktopAlertsEnabled,
  isSoundEnabled,
  setDesktopAlertsEnabled,
  setSoundEnabled
} from "../utils/notificationPrefs";
import { SeverityIcon } from "./SeverityIcon";

function BellIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

export function NotificationBell({ fetchUrl, paramKey, paramValue, viewAllTo }) {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [count, setCount] = useState(0);
  const [seen, setSeen] = useState(false);
  const [soundOn, setSoundOn] = useState(isSoundEnabled);
  const [desktopOn, setDesktopOn] = useState(isDesktopAlertsEnabled);
  const wrapRef = useRef(null);
  const navigate = useNavigate();

  const load = useCallback(() => {
    const params = paramKey && paramValue ? { [paramKey]: paramValue } : {};
    api.get(fetchUrl, { params })
      .then(res => {
        setNotifications(res.data.notifications || []);
        setCount(res.data.count || 0);
      })
      .catch(() => {});
  }, [fetchUrl, paramKey, paramValue]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 30000);
    window.addEventListener("admin-notification:refresh", load);
    return () => {
      clearInterval(timer);
      window.removeEventListener("admin-notification:refresh", load);
    };
  }, [load]);

  useEffect(() => {
    function syncPrefs() {
      setSoundOn(isSoundEnabled());
      setDesktopOn(isDesktopAlertsEnabled());
    }
    window.addEventListener(PREFS_EVENT, syncPrefs);
    return () => window.removeEventListener(PREFS_EVENT, syncPrefs);
  }, []);

  useEffect(() => {
    if (!open) return;
    function handleClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  function handleOpen() {
    setOpen(prev => !prev);
    setSeen(true);
  }

  function handleNotifClick(notif) {
    api.post(`${fetchUrl}/${encodeURIComponent(notif.id)}/ack`).then(load).catch(() => {});
    setOpen(false);
    if (notif.link) navigate(notif.link);
  }

  function handleViewAll() {
    setOpen(false);
    if (!viewAllTo) return;
    if (viewAllTo.startsWith("#")) {
      window.location.hash = viewAllTo;
      document.querySelector(viewAllTo)?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    navigate(viewAllTo);
  }

  const showBadge = count > 0 && !seen;
  const hasCritical = notifications.some(n => n.type === "danger" && !n.isRead);

  return (
    <div className="notif-wrap" ref={wrapRef}>
      <button
        className={`notif-bell-btn${open ? " active" : ""}`}
        onClick={handleOpen}
        type="button"
        aria-label={`Notifications${count > 0 ? ` (${count})` : ""}`}
      >
        <BellIcon />
        {count > 0 && (
          <span className={`notif-badge${hasCritical ? " critical" : ""}${showBadge && hasCritical ? " pulse" : ""}`}>
            {count > 9 ? "9+" : count}
          </span>
        )}
      </button>

      {open && (
        <div className="notif-dropdown">
          <div className="notif-dropdown-head">
            <strong>Notifications</strong>
            {count > 0 && <span className={`notif-count-label${hasCritical ? " critical" : ""}`}>{count} active</span>}
          </div>

          {notifications.length === 0 ? (
            <p className="notif-empty">All clear — no active alerts.</p>
          ) : (
            <div className="notif-list">
              {notifications.map(n => (
                <button
                  key={n.id}
                  className={`notif-item ${n.type || "info"}${n.isRead ? " read" : ""}`}
                  onClick={() => handleNotifClick(n)}
                  type="button"
                >
                  <span className="notif-item-icon"><SeverityIcon type={n.type || "info"} size={18} /></span>
                  <span className="notif-text">
                    <strong>{n.title}</strong>
                    <p>{n.body}</p>
                  </span>
                  {!n.isRead && <span className="notif-unread-dot" aria-label="Unread" />}
                </button>
              ))}
            </div>
          )}

          <div className="notif-prefs">
            <label className="notif-pref">
              <input checked={soundOn} onChange={e => setSoundEnabled(e.target.checked)} type="checkbox" />
              <span>Alert sounds</span>
            </label>
            {desktopAlertsSupported() && (
              <label className="notif-pref">
                <input
                  checked={desktopOn}
                  disabled={Notification.permission === "denied"}
                  onChange={e => setDesktopAlertsEnabled(e.target.checked)}
                  type="checkbox"
                />
                <span>{Notification.permission === "denied" ? "Desktop alerts blocked" : "Desktop alerts"}</span>
              </label>
            )}
          </div>

          <div className="notif-footer-actions">
            {viewAllTo && (
              <button className="notif-refresh-btn" onClick={handleViewAll} type="button">
                View All
              </button>
            )}
            <button className="notif-refresh-btn" onClick={load} type="button">
              Refresh
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
