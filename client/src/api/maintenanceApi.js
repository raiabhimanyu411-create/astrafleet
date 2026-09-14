import api from "./axios";

export const getMaintenancePortal = () => api.get("/api/maintenance");
export const reconcileMaintenanceFleet = () => api.post("/api/maintenance/reconcile");
export const autoPlanMaintenanceWork = () => api.post("/api/maintenance/automation/plan");
export const createMaintenanceJob = (data) => api.post("/api/maintenance/jobs", data);
export const createBulkMaintenanceJobs = (data) => api.post("/api/maintenance/jobs/bulk", data);
export const updateMaintenanceJob = (id, data) => api.put(`/api/maintenance/jobs/${id}`, data);
export const updateMaintenanceBill = (id, data) => api.patch(`/api/maintenance/jobs/${id}/bill`, data);
export const getMaintenanceDocument = (id, config) => api.get(`/api/maintenance/jobs/${id}/document`, config);
export const getComplianceDocument = (source, id, config) => api.get(
  `/api/maintenance/compliance/documents/${source}/${id}`,
  config
);
export const removeMaintenanceDocument = (id, data = {}) => api.delete(`/api/maintenance/jobs/${id}/document`, { data });
export const completeMaintenanceJob = (id, data) => api.patch(`/api/maintenance/jobs/${id}/complete`, data);
export const createJobFromDefect = (defectId, data = {}) => api.post(`/api/maintenance/defects/${defectId}/job`, data);
export const updateDefectWorkflow = (defectId, data = {}) => api.patch(`/api/maintenance/defects/${defectId}/workflow`, data);
export const reportBreakdown = (data) => api.post("/api/maintenance/breakdown", data);
export const setVorStatus = (data) => api.post("/api/maintenance/vor", data);
export const completeEventFromSchedule = (data) => api.post("/api/maintenance/events/done", data);
export const undoCompletedMaintenanceEvent = (jobId, data = {}) => api.patch(`/api/maintenance/events/${jobId}/undo`, data);
export const getJobNotes = (jobId) => api.get(`/api/maintenance/jobs/${jobId}/notes`);
export const addJobNote = (jobId, data) => api.post(`/api/maintenance/jobs/${jobId}/notes`, data);

export const getMaintenanceCompliance = () => api.get("/api/maintenance/compliance");
export const createComplianceInspection = (data) => api.post("/api/maintenance/compliance/inspections", data);
export const repairComplianceInspectionItem = (itemId, data) => api.patch(`/api/maintenance/compliance/inspection-items/${itemId}/repair`, data);
export const reviewComplianceInspection = (inspectionId, data) => api.patch(`/api/maintenance/compliance/inspections/${inspectionId}/review`, data);
export const createComplianceMotTest = (data) => api.post("/api/maintenance/compliance/mot-tests", data);
export const updateComplianceFrequency = (data) => api.post("/api/maintenance/compliance/frequencies", data);
export const createComplianceProvider = (data) => api.post("/api/maintenance/compliance/providers", data);
export const createComplianceRecall = (data) => api.post("/api/maintenance/compliance/recalls", data);
export const verifyComplianceRecall = (id, data) => api.patch(`/api/maintenance/compliance/recalls/${id}/verify`, data);
export const createComplianceDailyCheck = (data) => api.post("/api/maintenance/compliance/daily-checks", data);
export const recordMissedComplianceInspection = (data) => api.post("/api/maintenance/compliance/missed-inspections", data);
export const getMaintenanceAuditPack = (assetType, assetId) => api.get(
  `/api/maintenance/compliance/assets/${assetType}/${assetId}/audit-pack`,
  { responseType: "blob" }
);
export const getMaintenanceComplianceBackup = () => api.get(
  "/api/maintenance/compliance/backup",
  { responseType: "blob" }
);
