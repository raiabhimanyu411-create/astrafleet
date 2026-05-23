import { useEffect, useRef, useState } from "react";
import { getDriverChatMessages, getDriverChats, sendDriverChatMessage } from "../../api/adminApi";
import { getRealtimeSocket } from "../../api/realtime";
import { StatusPill } from "../../components/StatusPill";
import { getAuthSession } from "../../utils/authSession";

export function DriverChatWidget({ compact = false }) {
  const [drivers, setDrivers] = useState([]);
  const [selectedDriver, setSelectedDriver] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [threadLoading, setThreadLoading] = useState(false);
  const [error, setError] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const threadRef = useRef(null);
  const selectedRef = useRef(null);
  const session = getAuthSession();

  async function loadChats(showLoading = true) {
    try {
      if (showLoading) setLoading(true);
      setError("");
      const res = await getDriverChats();
      setDrivers(res.data.drivers || []);
      setSelectedDriver(current => current || res.data.drivers?.[0] || null);
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
  }, []);

  useEffect(() => {
    function handleExternalSelect(event) {
      const driverId = event.detail?.driverId;
      if (!driverId) return;
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
    socket.emit("admin-chat:join");
    socket.on("driver-chat:message", handleMessage);

    return () => {
      socket.off("driver-chat:message", handleMessage);
      socket.emit("admin-chat:leave");
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

  return (
    <article className="content-card admin-chat-card" id="admin-driver-chat">
      <div className="section-head">
        <div>
          <span className="card-label">Driver support</span>
          <h2>Chat with driver</h2>
        </div>
        <button className="header-action-button" type="button" onClick={() => loadChats(false)}>Refresh</button>
      </div>

      {error && <p className="driver-empty">{error}</p>}

      <div className={`admin-chat-layout ${compact ? "compact" : ""}`}>
        <div className="admin-chat-driver-list">
          {loading && <p className="driver-empty">Loading drivers...</p>}
          {!loading && drivers.length === 0 && <p className="driver-empty">No drivers found.</p>}
          {drivers.map(driver => (
            <button
              className={`admin-chat-driver ${selectedDriver?.id === driver.id ? "active" : ""}`}
              key={driver.id}
              type="button"
              onClick={() => setSelectedDriver(driver)}
            >
              <div>
                <strong>{driver.fullName}</strong>
                <p>{driver.employeeCode} · {driver.phone}</p>
                <span>{driver.lastMessage?.body || "No messages yet"}</span>
              </div>
              <div>
                {driver.unreadCount > 0 && <StatusPill tone="danger">{driver.unreadCount} new</StatusPill>}
                <small>Chat</small>
              </div>
            </button>
          ))}
        </div>

        <div className="admin-chat-thread-wrap">
          <div className="admin-chat-thread-head">
            <div>
              <strong>{selectedDriver?.fullName || "Select a driver"}</strong>
              <p>{selectedDriver ? `${selectedDriver.shiftStatus} · ${selectedDriver.complianceStatus}` : "Choose a driver to open support chat"}</p>
            </div>
          </div>

          <div className="message-thread admin-chat-thread" ref={threadRef}>
            {threadLoading && <p className="driver-empty">Loading messages...</p>}
            {!threadLoading && selectedDriver && messages.length === 0 && (
              <p className="driver-empty">No chat yet. Send the first support message.</p>
            )}
            {!selectedDriver && <p className="driver-empty">Driver list se Chat button select karo.</p>}
            {messages.map(msg => (
              <div key={msg.id} className={`message-bubble ${msg.senderRole === "driver" ? "incoming" : "outgoing"}`}>
                <span className="message-meta">{msg.senderName} · {msg.at}</span>
                <p>{msg.body}</p>
              </div>
            ))}
          </div>

          <form className="message-compose" onSubmit={handleSend}>
            <textarea
              className="af-input"
              disabled={!selectedDriver}
              onChange={e => setBody(e.target.value)}
              placeholder={selectedDriver ? `Message ${selectedDriver.fullName}...` : "Select a driver first"}
              rows={2}
              value={body}
            />
            <button className="af-submit-btn" disabled={!selectedDriver || !body.trim() || sending} type="submit">
              {sending ? "Sending..." : "Send message"}
            </button>
          </form>
        </div>
      </div>
    </article>
  );
}
