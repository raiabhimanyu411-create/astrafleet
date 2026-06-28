import api from "./axios";

export const getJobFormData  = ()         => api.get("/api/jobs/form-data");
export const getJobs         = (params)   => api.get("/api/jobs", { params });
export const getJobById      = (id)       => api.get(`/api/jobs/${id}`);
export const createJob       = (data)     => api.post("/api/jobs", data);
export const updateJob       = (id, data) => api.put(`/api/jobs/${id}`, data);
export const updateJobAssignment = (id, data) => api.patch(`/api/jobs/${id}/assignment`, data);
export const updateJobStatus = (id, data) => api.patch(`/api/jobs/${id}/status`, data);
export const cancelJob       = (id, data) => api.delete(`/api/jobs/${id}`, { data });
export const getJobNotes     = (id)       => api.get(`/api/jobs/${id}/notes`);
export const addJobNote      = (id, data) => api.post(`/api/jobs/${id}/notes`, data);
export const addJobStop      = (id, data) => api.post(`/api/jobs/${id}/stops`, data);
export const deleteJobStop   = (id, stopId) => api.delete(`/api/jobs/${id}/stops/${stopId}`);
