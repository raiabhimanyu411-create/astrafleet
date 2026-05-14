import api from "./axios";

export const getJobFormData  = ()         => api.get("/api/jobs/form-data");
export const getJobs         = (params)   => api.get("/api/jobs", { params });
export const getJobById      = (id)       => api.get(`/api/jobs/${id}`);
export const createJob       = (data)     => api.post("/api/jobs", data);
export const updateJob       = (id, data) => api.put(`/api/jobs/${id}`, data);
export const updateJobStatus = (id, data) => api.patch(`/api/jobs/${id}/status`, data);
export const cancelJob       = (id, data) => api.delete(`/api/jobs/${id}`, { data });
