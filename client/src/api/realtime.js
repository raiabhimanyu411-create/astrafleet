import { io } from "socket.io-client";
import { getAuthSession } from "../utils/authSession";

let socket;
let adminChatSubscribers = 0;
let adminJobSubscribers = 0;

function getSocketUrl() {
  if (import.meta.env.VITE_API_BASE_URL) return import.meta.env.VITE_API_BASE_URL;
  if (import.meta.env.DEV) return "http://localhost:5001";
  return window.location.origin;
}

let socketToken = null;

function currentToken() {
  return getAuthSession()?.sessionToken || null;
}

export function getRealtimeSocket() {
  if (!socket) {
    socketToken = currentToken();
    socket = io(getSocketUrl(), {
      autoConnect: false,
      transports: ["websocket", "polling"],
      // The server checks this login before letting the socket join a room; read fresh on every reconnect.
      auth: (cb) => cb({ token: currentToken() })
    });
    socket.on("connect", () => {
      if (adminChatSubscribers > 0) socket.emit("admin-chat:join");
      if (adminJobSubscribers > 0) socket.emit("admin-jobs:join");
    });
  } else if (socketToken !== currentToken()) {
    // A different user signed in on this tab: reconnect so the server sees the new login.
    socketToken = currentToken();
    if (socket.active) socket.disconnect().connect();
  }

  return socket;
}

export function joinAdminChatRoom() {
  const realtimeSocket = getRealtimeSocket();
  adminChatSubscribers += 1;
  if (adminChatSubscribers === 1) realtimeSocket.emit("admin-chat:join");
}

export function leaveAdminChatRoom() {
  adminChatSubscribers = Math.max(0, adminChatSubscribers - 1);
  if (adminChatSubscribers === 0 && socket) socket.emit("admin-chat:leave");
}

export function subscribeJobUpdates(handler) {
  const s = getRealtimeSocket();
  adminJobSubscribers += 1;
  if (adminJobSubscribers === 1 && s.connected) s.emit('admin-jobs:join');
  s.on('job:updated', handler);
  const resync = () => handler({ source: 'reconnect' });
  s.on('connect', resync);
  s.connect();
  return () => {
    s.off('job:updated', handler); s.off('connect', resync);
    adminJobSubscribers = Math.max(0, adminJobSubscribers - 1);
    if (!adminJobSubscribers) s.emit('admin-jobs:leave');
  };
}
