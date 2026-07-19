import { io } from "socket.io-client";

let socket;
let adminChatSubscribers = 0;

function getSocketUrl() {
  if (import.meta.env.VITE_API_BASE_URL) return import.meta.env.VITE_API_BASE_URL;
  if (import.meta.env.DEV) return "http://localhost:5001";
  return window.location.origin;
}

export function getRealtimeSocket() {
  if (!socket) {
    socket = io(getSocketUrl(), {
      autoConnect: false,
      transports: ["websocket", "polling"]
    });
    socket.on("connect", () => {
      if (adminChatSubscribers > 0) socket.emit("admin-chat:join");
    });
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
