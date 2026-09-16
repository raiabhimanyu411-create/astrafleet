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

function emitDriverJobAssigned(payload) {
  if (!io || !payload?.driverId) return;
  io.to(chatRoom(payload.driverId)).emit("driver-job:assigned", {
    ...payload,
    emittedAt: new Date().toISOString()
  });
}

function emitAdminAuditEvent(payload) {
  if (!io) return;
  io.to("admin-audit").emit("admin-audit:event", {
    ...payload,
    emittedAt: new Date().toISOString()
  });
}

function emitJobUpdate(payload) {
  if (!io) return;
  io.to("admin-jobs").emit("job:updated", {
    ...payload,
    emittedAt: new Date().toISOString()
  });
  // Notify only the assigned driver (and previous driver after reassignment).
  // Resolve assignment centrally so no mutation endpoint can omit the driver refresh.
  if (payload?.jobId) {
    require('./db/connection').query('SELECT driver_id FROM trips WHERE id=?', [payload.jobId])
      .then(([rows]) => {
        const ids = new Set([rows[0]?.driver_id, payload.driverId, payload.previousDriverId].filter(Boolean).map(Number));
        for (const driverId of ids) io?.to(chatRoom(driverId)).emit('job:updated', { ...payload, driverId });
      }).catch(error => console.error('[Realtime] Driver refresh failed:', error.message));
  }
}

module.exports = {
  chatRoom,
  emitAdminAuditEvent,
  emitDriverChatMessage,
  emitDriverJobAssigned,
  emitDriverLocationUpdate,
  emitJobUpdate,
  getRealtimeServer,
  setRealtimeServer
};
