import { useEffect, useRef, useState } from "react";
import { getDriverChatMessages, getDriverChats, sendDriverChatMessage } from "../../api/adminApi";
import { getRealtimeSocket, joinAdminChatRoom, leaveAdminChatRoom } from "../../api/realtime";
import { StatusPill } from "../../components/StatusPill";
import { getAuthSession } from "../../utils/authSession";

function getInitials(name = "") {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts.at(-1)[0]}`.toUpperCase();
}

export function DriverChatWidget({ compact = false, initialDriverId = null, hideDriverList = false, title = "Driver Support Console" }) {
  const [drivers, setDrivers] = useState([]);
  const [selectedDriver, setSelectedDriver] = useState(null);
  const [messages, setMessages] = useState([]);
  const [driverSearch, setDriverSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [threadLoading, setThreadLoading] = useState(false);
  const [error, setError] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const threadRef = useRef(null);
  const selectedRef = useRef(null);
  const session = getAuthSession();
  const quickReplies = [
    "Thanks, received. Dispatch is reviewing this now.",
    "Please share your current location and ETA.",
    "Can you confirm loading is complete?",
    "Please pause safely and wait for dispatch instructions."
  ];

  function announceActiveChat(driverId) {
    window.dispatchEvent(new CustomEvent("admin-driver-chat:active", {
      detail: { driverId: driverId || null }
    }));
  }

  async function loadChats(showLoading = true) {
    try {
      if (showLoading) setLoading(true);
      setError("");
      const res = await getDriverChats();
      const nextDrivers = res.data.drivers || [];
      setDrivers(nextDrivers);
      setSelectedDriver(current => {
        if (initialDriverId) {
          return nextDrivers.find(driver => Number(driver.id) === Number(initialDriverId)) || current || null;
        }
        return current || nextDrivers[0] || null;
      });
    } catch (err) {
      setError(err?.response?.data?.message || "Could not load driver chats.");
    } finally {
      if (showLoading) setLoading(false);
    }
  }

  async function loadThread(driver) {
    if (!driver?.id) return;
    try {
      setThreadLoading(true);
      const res = await getDriverChatMessages(driver.id);
      setMessages(res.data.messages || []);
      setDrivers(prev => prev.map(item => item.id === driver.id ? { ...item, unreadCount: 0 } : item));
    } catch (err) {
      setError(err?.response?.data?.message || "Could not load this chat.");
    } finally {
      setThreadLoading(false);
    }
  }

  useEffect(() => {
    loadChats();
  }, [initialDriverId]);

  useEffect(() => {
    function handleExternalSelect(event) {
      const driverId = event.detail?.driverId;
      if (!driverId) return;
      announceActiveChat(driverId);
      setSelectedDriver(current => {
        if (Number(current?.id) === Number(driverId)) return current;
        return drivers.find(driver => Number(driver.id) === Number(driverId)) || current;
      });
      window.setTimeout(() => {
        document.getElementById("admin-driver-chat")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 0);
    }

    window.addEventListener("admin-driver-chat:select", handleExternalSelect);
    return () => window.removeEventListener("admin-driver-chat:select", handleExternalSelect);
  }, [drivers]);

  useEffect(() => {
    return () => announceActiveChat(null);
  }, []);

  useEffect(() => {
    selectedRef.current = selectedDriver;
    loadThread(selectedDriver);
  }, [selectedDriver?.id]);

  useEffect(() => {
    if (!threadRef.current) return;
    threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [messages]);

  useEffect(() => {
    const socket = getRealtimeSocket();

    function handleMessage(message) {
      loadChats(false);
      if (Number(message.driverId) !== Number(selectedRef.current?.id)) return;
      setMessages(prev => prev.some(item => item.id === message.id) ? prev : [...prev, message]);
      if (message.senderRole === "driver") {
        getDriverChatMessages(message.driverId)
          .then(() => setDrivers(prev => prev.map(item => Number(item.id) === Number(message.driverId) ? { ...item, unreadCount: 0 } : item)))
          .catch(() => {});
      }
    }

    socket.connect();
    joinAdminChatRoom();
    socket.on("driver-chat:message", handleMessage);

    return () => {
      socket.off("driver-chat:message", handleMessage);
      leaveAdminChatRoom();
    };
  }, []);

  async function handleSend(event) {
    event.preventDefault();
    if (!selectedDriver || !body.trim() || sending) return;
    try {
      setSending(true);
      const res = await sendDriverChatMessage(selectedDriver.id, {
        body: body.trim(),
        senderName: session?.name || "Admin"
      });
      setBody("");
      const message = res.data.chatMessage;
      if (message) {
        setMessages(prev => prev.some(item => item.id === message.id) ? prev : [...prev, message]);
      }
      await loadChats(false);
    } catch (err) {
      setError(err?.response?.data?.message || "Message could not be sent.");
    } finally {
      setSending(false);
    }
  }

  const filteredDrivers = drivers.filter(driver => {
    const query = driverSearch.trim().toLowerCase();
    if (!query) return true;
    return (
      driver.fullName.toLowerCase().includes(query) ||
      driver.employeeCode.toLowerCase().includes(query) ||
      (driver.phone || "").toLowerCase().includes(query) ||
      (driver.lastMessage?.body || "").toLowerCase().includes(query)
    );
  });

  const unreadTotal = drivers.reduce((sum, driver) => sum + Number(driver.unreadCount || 0), 0);

  return (
    <article className="content-card admin-chat-card" id="admin-driver-chat">
      <div className="section-head">
        <div>
          <span className="card-label">Driver Support</span>
          <h2>{title}</h2>
        </div>
        <div className="admin-chat-head-actions">
          <StatusPill tone={unreadTotal ? "danger" : "success"}>{unreadTotal ? `${unreadTotal} unread` : "Inbox clear"}</StatusPill>
          <button className="header-action-button" type="button" onClick={() => loadChats(false)}>Refresh</button>
        </div>
      </div>

      {error && <p className="driver-empty">{error}</p>}

      <div className={`admin-chat-layout ${compact ? "compact" : ""}`}>
        {!hideDriverList && (
          <div className="admin-chat-driver-list">
            <input
              className="af-input admin-chat-search"
              placeholder="Search Driver Or Message..."
              value={driverSearch}
              onChange={e => setDriverSearch(e.target.value)}
            />
            {loading && <p className="driver-empty">Loading drivers...</p>}
            {!loading && filteredDrivers.length === 0 && <p className="driver-empty">No drivers found.</p>}
            {filteredDrivers.map(driver => (
              <button
                className={`admin-chat-driver ${selectedDriver?.id === driver.id ? "active" : ""}`}
                key={driver.id}
                type="button"
                onClick={() => {
                  setSelectedDriver(driver);
                  announceActiveChat(driver.id);
                }}
              >
                <span className="chat-avatar" aria-hidden="true">{getInitials(driver.fullName)}</span>
                <div>
                  <strong>{driver.fullName}</strong>
                  <p>{driver.employeeCode} · {driver.phone}</p>
                  <span>{driver.lastMessage?.body || "No messages yet"}</span>
                </div>
                <div>
                  {driver.unreadCount > 0 && <StatusPill tone="danger">{driver.unreadCount} new</StatusPill>}
                  <small>{driver.lastMessage?.at || "Open chat"}</small>
                </div>
              </button>
            ))}
          </div>
        )}

        <div className="admin-chat-thread-wrap">
          <div className="admin-chat-thread-head">
            <div>
              <strong>{selectedDriver?.fullName || "Select a driver"}</strong>
              <p>{selectedDriver ? `${selectedDriver.shiftStatus} · ${selectedDriver.complianceStatus}` : "Choose a driver to open support chat"}</p>
            </div>
            {selectedDriver && (
              <div className="admin-chat-driver-status">
                <StatusPill tone={selectedDriver.complianceStatus === "clear" ? "success" : selectedDriver.complianceStatus === "blocked" ? "danger" : "warning"}>
                  {selectedDriver.complianceStatus}
                </StatusPill>
                <StatusPill tone={selectedDriver.shiftStatus === "ready" ? "success" : selectedDriver.shiftStatus === "on_trip" ? "warning" : "neutral"}>
                  {selectedDriver.shiftStatus?.replace("_", " ")}
                </StatusPill>
              </div>
            )}
          </div>

          <div className="message-thread admin-chat-thread" ref={threadRef}>
            {threadLoading && <p className="driver-empty">Loading messages...</p>}
            {!threadLoading && selectedDriver && messages.length === 0 && (
              <p className="driver-empty">No chat yet. Send the first support message.</p>
            )}
            {!selectedDriver && <p className="driver-empty">Select the Chat button from the driver list.</p>}
            {messages.map(msg => (
              <div key={msg.id} className={`message-bubble ${msg.senderRole === "driver" ? "incoming" : "outgoing"}`}>
                <span className="message-meta">{msg.senderName} · {msg.at}</span>
                <p>{msg.body}</p>
              </div>
            ))}
          </div>

          <div className="admin-chat-quick-replies">
            {quickReplies.map(reply => (
              <button
                className="header-action-button"
                disabled={!selectedDriver || sending}
                key={reply}
                type="button"
                onClick={() => setBody(reply)}
              >
                {reply}
              </button>
            ))}
          </div>

          <form className="message-compose" onSubmit={handleSend}>
            <textarea
              className="af-input"
              disabled={!selectedDriver}
              onFocus={() => announceActiveChat(selectedDriver?.id)}
              onChange={e => setBody(e.target.value)}
              placeholder={selectedDriver ? `Message ${selectedDriver.fullName}...` : "Select a driver first"}
              rows={2}
              value={body}
            />
            <button className="af-submit-btn" disabled={!selectedDriver || !body.trim() || sending} type="submit">
              {sending ? "Sending..." : "Send Message"}
            </button>
          </form>
        </div>
      </div>
    </article>
  );
}
