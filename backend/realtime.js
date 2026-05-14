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

module.exports = {
  emitDriverLocationUpdate,
  getRealtimeServer,
  setRealtimeServer
};
