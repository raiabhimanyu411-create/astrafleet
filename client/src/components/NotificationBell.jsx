import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/axios";

function BellIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

const toneStyle = {
  danger: { bg: "#fee2e2", bar: "#dc2626", text: "#b91c1c" },
  warning: { bg: "#fef3c7", bar: "#d97706", text: "#92400e" },
  info: { bg: "#eff6ff", bar: "#2563eb", text: "#1d4ed8" }
};

export function NotificationBell({ fetchUrl, paramKey, paramValue }) {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [count, setCount] = useState(0);
  const [seen, setSeen] = useState(false);
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
    return () => clearInterval(timer);
  }, [load]);

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
    setOpen(false);
    if (notif.link) navigate(notif.link);
  }

  const showBadge = count > 0 && !seen;

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
          <span className={`notif-badge${showBadge ? " pulse" : ""}`}>
            {count > 9 ? "9+" : count}
          </span>
        )}
      </button>

      {open && (
        <div className="notif-dropdown">
          <div className="notif-dropdown-head">
            <strong>Notifications</strong>
            {count > 0 && <span className="notif-count-label">{count} active</span>}
          </div>

          {notifications.length === 0 ? (
            <p className="notif-empty">All clear — no active alerts.</p>
          ) : (
            <div className="notif-list">
              {notifications.map(n => {
                const style = toneStyle[n.type] || toneStyle.info;
                return (
                  <div
                    key={n.id}
                    className="notif-item"
                    style={{ background: style.bg, cursor: n.link ? "pointer" : "default" }}
                    onClick={() => handleNotifClick(n)}
                  >
                    <div className="notif-bar" style={{ background: style.bar }} />
                    <div className="notif-text">
                      <strong style={{ color: style.text }}>{n.title}</strong>
                      <p>{n.body}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <button className="notif-refresh-btn" onClick={load} type="button">
            Refresh
          </button>
        </div>
      )}
    </div>
  );
}
