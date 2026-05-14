import api from "./axios";

export const getVehicles            = ()                  => api.get("/api/vehicles");
export const getVehicleById         = (id)                => api.get(`/api/vehicles/${id}`);
export const createVehicle          = (data)              => api.post("/api/vehicles", data);
export const updateVehicle          = (id, data)          => api.put(`/api/vehicles/${id}`, data);
export const updateVehicleStatus    = (id, data)          => api.patch(`/api/vehicles/${id}/status`, data);

export const addVehicleDocument     = (id, data)          => api.post(`/api/vehicles/${id}/documents`, data);
export const updateVehicleDocument  = (id, docId, data)   => api.put(`/api/vehicles/${id}/documents/${docId}`, data);
export const deleteVehicleDocument  = (id, docId)         => api.delete(`/api/vehicles/${id}/documents/${docId}`);

export const addMaintenance         = (id, data)          => api.post(`/api/vehicles/${id}/maintenance`, data);
export const deleteMaintenance      = (id, recId)         => api.delete(`/api/vehicles/${id}/maintenance/${recId}`);

export const addInspection          = (id, data)          => api.post(`/api/vehicles/${id}/inspections`, data);

export const addDefect              = (id, data)          => api.post(`/api/vehicles/${id}/defects`, data);
export const updateDefectStatus     = (id, defId, data)   => api.patch(`/api/vehicles/${id}/defects/${defId}`, data);
