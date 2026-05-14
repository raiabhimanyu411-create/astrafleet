import { io } from "socket.io-client";

let socket;

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
  }

  return socket;
}
