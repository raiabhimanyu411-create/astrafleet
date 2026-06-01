let io = null;

function setRealtimeServer(server) {
  io = server;
}

function getRealtimeServer() {
  return io;
}

function emitDriverLocationUpdate(payload) {
  if (!io) return;
  io.to("admin-tracking").emit("driver-location:updated", {
    ...payload,
    updatedAt: new Date().toISOString()
  });
}

function chatRoom(driverId) {
  return `driver-chat:${driverId}`;
}

function emitDriverChatMessage(message) {
  if (!io || !message?.driverId) return;
  io.to("admin-chat").emit("driver-chat:message", message);
  io.to(chatRoom(message.driverId)).emit("driver-chat:message", message);
}

function emitAdminAuditEvent(payload) {
  if (!io) return;
  io.to("admin-audit").emit("admin-audit:event", {
    ...payload,
    emittedAt: new Date().toISOString()
  });
}

module.exports = {
  chatRoom,
  emitAdminAuditEvent,
  emitDriverChatMessage,
  emitDriverLocationUpdate,
  getRealtimeServer,
  setRealtimeServer
};
