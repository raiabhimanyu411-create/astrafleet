import api from "./axios";

export const getMaintenancePortal = () => api.get("/api/maintenance");
export const autoPlanMaintenanceWork = () => api.post("/api/maintenance/automation/plan");
export const createMaintenanceJob = (data) => api.post("/api/maintenance/jobs", data);
export const createBulkMaintenanceJobs = (data) => api.post("/api/maintenance/jobs/bulk", data);
export const updateMaintenanceJob = (id, data) => api.put(`/api/maintenance/jobs/${id}`, data);
export const updateMaintenanceBill = (id, data) => api.patch(`/api/maintenance/jobs/${id}/bill`, data);
export const completeMaintenanceJob = (id, data) => api.patch(`/api/maintenance/jobs/${id}/complete`, data);
export const createJobFromDefect = (defectId, data = {}) => api.post(`/api/maintenance/defects/${defectId}/job`, data);
export const updateDefectWorkflow = (defectId, data = {}) => api.patch(`/api/maintenance/defects/${defectId}/workflow`, data);
export const markVehicleInspectionDone = (vehicleId, data = {}) => api.post(`/api/maintenance/vehicles/${vehicleId}/inspection-done`, data);
export const markTrailerInspectionDone = (trailerId, data = {}) => api.post(`/api/maintenance/trailers/${trailerId}/inspection-done`, data);
export const reportBreakdown = (data) => api.post("/api/maintenance/breakdown", data);
export const setVorStatus = (data) => api.post("/api/maintenance/vor", data);
export const completeEventFromSchedule = (data) => api.post("/api/maintenance/events/done", data);
export const getJobNotes = (jobId) => api.get(`/api/maintenance/jobs/${jobId}/notes`);
export const addJobNote = (jobId, data) => api.post(`/api/maintenance/jobs/${jobId}/notes`, data);
