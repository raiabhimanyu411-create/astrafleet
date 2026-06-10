import api from "./axios";

export const getMaintenancePortal = () => api.get("/api/maintenance");
export const createMaintenanceJob = (data) => api.post("/api/maintenance/jobs", data);
export const updateMaintenanceJob = (id, data) => api.put(`/api/maintenance/jobs/${id}`, data);
export const updateMaintenanceBill = (id, data) => api.patch(`/api/maintenance/jobs/${id}/bill`, data);
export const completeMaintenanceJob = (id, data) => api.patch(`/api/maintenance/jobs/${id}/complete`, data);
export const createJobFromDefect = (defectId, data = {}) => api.post(`/api/maintenance/defects/${defectId}/job`, data);
export const updateDefectWorkflow = (defectId, data = {}) => api.patch(`/api/maintenance/defects/${defectId}/workflow`, data);
export const markVehicleInspectionDone = (vehicleId, data = {}) => api.post(`/api/maintenance/vehicles/${vehicleId}/inspection-done`, data);
