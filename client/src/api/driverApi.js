import api from "./axios";

export const getDrivers       = ()              => api.get("/api/drivers");
export const getDriverById    = (id)            => api.get(`/api/drivers/${id}`);
export const createDriver     = (data)          => api.post("/api/drivers", data);
export const updateDriver     = (id, data)      => api.put(`/api/drivers/${id}`, data);
export const addDocument      = (id, data)      => api.post(`/api/drivers/${id}/documents`, data);
export const updateDocument   = (id, docId, data) => api.put(`/api/drivers/${id}/documents/${docId}`, data);
export const deleteDocument   = (id, docId)    => api.delete(`/api/drivers/${id}/documents/${docId}`);

export const getDriverPanelData = (userId) =>
  api.get("/api/drivers/me/panel", { params: { userId } });

export const updateDriverJobStatus = (userId, jobId, data) =>
  api.patch(`/api/drivers/me/jobs/${jobId}/status`, data, { params: { userId } });

export const submitDriverPod = (userId, jobId, data) =>
  api.post(`/api/drivers/me/jobs/${jobId}/pod`, data, { params: { userId } });

export const startDriverShift = (userId, data = {}) =>
  api.post("/api/drivers/me/shift/start", data, { params: { userId } });

export const endDriverShift = (userId, data = {}) =>
  api.post("/api/drivers/me/shift/end", data, { params: { userId } });

export const createDriverExpense = (userId, data) =>
  api.post("/api/drivers/me/expenses", data, { params: { userId } });

export const createDriverDefectReport = (userId, data) =>
  api.post("/api/drivers/me/defects", data, { params: { userId } });

export const updateDriverLocation = (userId, data) =>
  api.post("/api/drivers/me/location", data, { params: { userId } });

export const submitDriverWalkaround = (userId, data) =>
  api.post("/api/drivers/me/walkaround", data, { params: { userId } });

export const logDriverOdometer = (userId, data) =>
  api.post("/api/drivers/me/odometer", data, { params: { userId } });

export const updateDriverJobEta = (userId, jobId, data) =>
  api.patch(`/api/drivers/me/jobs/${jobId}/eta`, data, { params: { userId } });

export const getDriverMessages = (userId) =>
  api.get("/api/drivers/me/messages", { params: { userId } });

export const sendDriverMessage = (userId, data) =>
  api.post("/api/drivers/me/messages", data, { params: { userId } });

export const rescheduleDriverJob = (userId, jobId, data) =>
  api.post(`/api/drivers/me/jobs/${jobId}/reschedule`, data, { params: { userId } });
