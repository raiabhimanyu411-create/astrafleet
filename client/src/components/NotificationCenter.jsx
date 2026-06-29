import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/axios";
import { StateNotice } from "./StateNotice";
import { StatusPill } from "./StatusPill";

const toneLabel = {
  danger: "Action",
  warning: "Watch",
  info: "Info"
};

const tonePill = {
  danger: "danger",
  warning: "warning",
  info: "neutral"
};

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

  const load = useCallback((isInitial = false) => {
    if (isInitial) setLoading(true);
    const params = paramKey && paramValue ? { [paramKey]: paramValue } : {};
    api.get(fetchUrl, { params })
      .then((res) => {
        setData({
          count: res.data.count || 0,
          notifications: res.data.notifications || []
        });
        setError("");
      })
      .catch(() => {
        if (isInitial) setError("Notifications could not be loaded");
      })
      .finally(() => {
        if (isInitial) setLoading(false);
      });
  }, [fetchUrl, paramKey, paramValue]);

  useEffect(() => {
    load(true);
    const timer = setInterval(() => load(false), 30000);
    return () => clearInterval(timer);
  }, [load]);

  const filtered = useMemo(() => {
    if (filter === "all") return data.notifications;
    return data.notifications.filter((item) => item.type === filter);
  }, [data.notifications, filter]);

  function openNotification(item) {
    api.post(`${fetchUrl}/${encodeURIComponent(item.id)}/ack`).then(() => load(false)).catch(() => {});
    if (item.link) navigate(item.link);
  }

  function acknowledge(item) {
    api.post(`${fetchUrl}/${encodeURIComponent(item.id)}/ack`).then(() => load(false)).catch(() => {});
  }

  return (
    <section className="content-card notification-center-card" id="notifications">
      <div className="section-head notification-center-head">
        <div>
          <span className="card-label">{eyebrow}</span>
          <h2>{title}</h2>
        </div>
        <div className="notification-center-actions">
          <StatusPill tone={data.count > 0 ? "warning" : "success"}>
            {data.count} active
          </StatusPill>
          <button className="header-action-button" onClick={() => load(false)} type="button">
            Refresh
          </button>
        </div>
      </div>

      <StateNotice loading={loading} error={error} />

      <div className="notification-filter-row" role="group" aria-label="Notification filters">
        {["all", "danger", "warning", "info"].map((item) => (
          <button
            className={`notification-filter-btn${filter === item ? " active" : ""}`}
            key={item}
            onClick={() => setFilter(item)}
            type="button"
          >
            {item === "all" ? "All" : toneLabel[item]}
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
          {filtered.map((item) => (
            <button
              className={`notification-center-item ${item.type || "info"}`}
              disabled={!item.link}
              key={item.id}
              onClick={() => openNotification(item)}
              type="button"
            >
              <span className="notification-center-rail" />
              <span className="notification-center-copy">
                <strong>{item.title}</strong>
                <span>{item.body}</span>
              </span>
              <StatusPill tone={tonePill[item.type] || "info"}>
                {item.acknowledged ? "Acked" : toneLabel[item.type] || "Info"}
              </StatusPill>
              {!item.acknowledged && (
                <span
                  className="header-action-button"
                  onClick={(event) => {
                    event.stopPropagation();
                    acknowledge(item);
                  }}
                >
                  Acknowledge
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
