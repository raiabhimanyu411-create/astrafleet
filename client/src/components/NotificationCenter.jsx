import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/axios";
import { StateNotice } from "./StateNotice";
import { StatusPill } from "./StatusPill";

const toneLabel = { danger: "Action", warning: "Watch", info: "Info" };
const tonePill = { danger: "danger", warning: "warning", info: "neutral" };

function formatNotificationDate(value) {
  if (!value) return "Live notification";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Live notification";
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function NotificationCenter({
  fetchUrl,
  paramKey,
  paramValue,
  title = "Notification Centre",
  eyebrow = "Live feed",
  emptyTitle = "No active notifications",
  emptyBody = "Everything is clear right now."
}) {
  const navigate = useNavigate();
  const [data, setData] = useState({ count: 0, notifications: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState(null);
  const [busyId, setBusyId] = useState("");

  const load = useCallback((isInitial = false) => {
    if (isInitial) setLoading(true);
    const params = paramKey && paramValue ? { [paramKey]: paramValue } : {};
    return api.get(fetchUrl, { params })
      .then((res) => {
        setData({
          count: res.data.count || 0,
          notifications: res.data.notifications || []
        });
        setError("");
      })
      .catch(() => {
        if (isInitial) setError("Notifications could not be loaded.");
      })
      .finally(() => {
        if (isInitial) setLoading(false);
      });
  }, [fetchUrl, paramKey, paramValue]);

  useEffect(() => {
    load(true);
    const timer = setInterval(() => load(false), 15000);
    const refresh = () => load(false);
    window.addEventListener("admin-notification:refresh", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("admin-notification:refresh", refresh);
    };
  }, [load]);

  const counts = useMemo(() => ({
    all: data.notifications.length,
    unread: data.notifications.filter(item => !item.isRead).length,
    priority: data.notifications.filter(item => item.isPriority).length,
    danger: data.notifications.filter(item => item.type === "danger").length
  }), [data.notifications]);

  const filtered = useMemo(() => {
    if (filter === "unread") return data.notifications.filter(item => !item.isRead);
    if (filter === "priority") return data.notifications.filter(item => item.isPriority);
    if (filter === "danger") return data.notifications.filter(item => item.type === "danger");
    return data.notifications;
  }, [data.notifications, filter]);

  async function runAction(item, action, request) {
    setBusyId(`${item.id}-${action}`);
    setError("");
    try {
      await request();
      if (action === "delete") setSelected(null);
      if (selected?.id === item.id && action !== "delete") {
        setSelected(current => current ? {
          ...current,
          isRead: action === "read" ? true : action === "unread" ? false : current.isRead,
          isPriority: action === "priority" ? !current.isPriority : current.isPriority,
          acknowledged: action === "ack" ? true : current.acknowledged
        } : current);
      }
      await load(false);
      window.dispatchEvent(new CustomEvent("admin-notification:refresh"));
    } catch (err) {
      setError(err?.response?.data?.message || "Notification action could not be completed.");
    } finally {
      setBusyId("");
    }
  }

  function setRead(item, isRead = true) {
    return runAction(item, isRead ? "read" : "unread", () => api.patch(
      `${fetchUrl}/${encodeURIComponent(item.id)}/read`,
      { isRead }
    ));
  }

  function acknowledge(item) {
    return runAction(item, "ack", () => api.post(`${fetchUrl}/${encodeURIComponent(item.id)}/ack`));
  }

  function togglePriority(item) {
    return runAction(item, "priority", () => api.patch(
      `${fetchUrl}/${encodeURIComponent(item.id)}/priority`,
      { isPriority: !item.isPriority }
    ));
  }

  function removeNotification(item) {
    if (!window.confirm(`Delete notification "${item.title}" from your inbox?`)) return;
    return runAction(item, "delete", () => api.delete(`${fetchUrl}/${encodeURIComponent(item.id)}`));
  }

  async function markAllRead() {
    const unreadIds = data.notifications.filter(item => !item.isRead).map(item => item.id);
    if (!unreadIds.length) return;
    setBusyId("read-all");
    try {
      await api.post(`${fetchUrl}/read-all`, { ids: unreadIds });
      await load(false);
      window.dispatchEvent(new CustomEvent("admin-notification:refresh"));
    } catch (err) {
      setError(err?.response?.data?.message || "Notifications could not be marked as read.");
    } finally {
      setBusyId("");
    }
  }

  function viewDetails(item) {
    setSelected(item);
    if (!item.isRead) setRead(item);
  }

  function openLinkedRecord(item) {
    if (!item.link) return;
    if (!item.isRead) setRead(item);
    setSelected(null);
    navigate(item.link);
  }

  return (
    <>
      <section className="content-card notification-center-card" id="notifications">
        <div className="notification-inbox-top">
          <div>
            <span className="card-label">{eyebrow}</span>
            <h2>{title}</h2>
            <p>Review alerts, prioritise important items, and open their linked operational records.</p>
          </div>
          <div className="notification-center-actions">
            <StatusPill tone={data.count > 0 ? "warning" : "success"}>{data.count} unread</StatusPill>
            <button className="header-action-button" disabled={!counts.unread || busyId === "read-all"} onClick={markAllRead} type="button">
              {busyId === "read-all" ? "Updating…" : "Mark all read"}
            </button>
            <button className="header-action-button" onClick={() => load(false)} type="button">Refresh</button>
          </div>
        </div>

        <StateNotice loading={loading} error={error} />

        <div className="notification-filter-row" role="group" aria-label="Notification filters">
          {[
            ["all", "All"],
            ["unread", "Unread"],
            ["priority", "Priority"],
            ["danger", "Action needed"]
          ].map(([key, label]) => (
            <button className={`notification-filter-btn${filter === key ? " active" : ""}`} key={key} onClick={() => setFilter(key)} type="button">
              {label}<span>{counts[key]}</span>
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div className="notification-empty-state">
            <strong>{emptyTitle}</strong>
            <p>{filter === "all" ? emptyBody : "No notifications match this filter."}</p>
          </div>
        ) : (
          <div className="notification-center-list">
            {filtered.map(item => (
              <article className={`notification-center-item ${item.type || "info"}${item.isRead ? " read" : " unread"}${item.isPriority ? " priority" : ""}`} key={item.id}>
                <button className="notification-center-open" onClick={() => viewDetails(item)} type="button">
                  <span className="notification-center-icon" aria-hidden="true">
                    {item.type === "danger" ? "!" : item.type === "warning" ? "⌁" : "i"}
                  </span>
                  <span className="notification-center-copy">
                    <span className="notification-item-meta">
                      <span>{item.source || toneLabel[item.type] || "Notification"}</span>
                      <span>{formatNotificationDate(item.createdAt)}</span>
                    </span>
                    <strong>{item.title}</strong>
                    <span className="notification-body-preview">{item.body}</span>
                  </span>
                </button>
                <div className="notification-center-item-actions">
                  {item.isPriority && <StatusPill tone="warning">Priority</StatusPill>}
                  <StatusPill tone={item.isRead ? "neutral" : tonePill[item.type] || "neutral"}>
                    {item.isRead ? "Read" : toneLabel[item.type] || "New"}
                  </StatusPill>
                  <button className={`notification-icon-action${item.isPriority ? " active" : ""}`} title={item.isPriority ? "Remove priority" : "Mark priority"} onClick={() => togglePriority(item)} type="button">★</button>
                  <button className="notification-text-action" onClick={() => setRead(item, !item.isRead)} type="button">
                    {item.isRead ? "Mark unread" : "Mark read"}
                  </button>
                  <button className="notification-text-action" onClick={() => viewDetails(item)} type="button">Details</button>
                  <button className="notification-icon-action danger" title="Delete notification" onClick={() => removeNotification(item)} type="button">×</button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {selected && (
        <div className="notification-detail-overlay" onClick={() => setSelected(null)}>
          <aside className="notification-detail-panel" aria-modal="true" role="dialog" onClick={event => event.stopPropagation()}>
            <div className={`notification-detail-accent ${selected.type || "info"}`} />
            <div className="notification-detail-head">
              <div>
                <span className="card-label">{selected.source || "Admin notification"}</span>
                <h2>{selected.title}</h2>
              </div>
              <button className="notification-detail-close" aria-label="Close details" onClick={() => setSelected(null)} type="button">×</button>
            </div>
            <div className="notification-detail-body">
              <div className="notification-detail-status">
                <StatusPill tone={tonePill[selected.type] || "neutral"}>{toneLabel[selected.type] || "Info"}</StatusPill>
                <StatusPill tone={selected.isRead ? "neutral" : "warning"}>{selected.isRead ? "Read" : "Unread"}</StatusPill>
                {selected.isPriority && <StatusPill tone="warning">Priority</StatusPill>}
              </div>
              <p className="notification-detail-message">{selected.body}</p>
              <dl className="notification-detail-meta">
                <div><dt>Received</dt><dd>{formatNotificationDate(selected.createdAt)}</dd></div>
                <div><dt>Reference</dt><dd>{selected.id}</dd></div>
                <div><dt>Linked record</dt><dd>{selected.link || "No linked record"}</dd></div>
              </dl>
            </div>
            <div className="notification-detail-actions">
              {selected.link && <button className="af-submit-btn" onClick={() => openLinkedRecord(selected)} type="button">Open Linked Record</button>}
              <button className={`header-action-button${selected.isPriority ? " active" : ""}`} onClick={() => togglePriority(selected)} type="button">
                {selected.isPriority ? "Remove Priority" : "Mark Priority"}
              </button>
              {!selected.acknowledged && <button className="header-action-button" onClick={() => acknowledge(selected)} type="button">Acknowledge</button>}
              <button className="header-action-button" onClick={() => setRead(selected, !selected.isRead)} type="button">
                {selected.isRead ? "Mark Unread" : "Mark Read"}
              </button>
              <button className="header-action-button danger" onClick={() => removeNotification(selected)} type="button">Delete</button>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
