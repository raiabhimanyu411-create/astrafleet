import api from "./axios";

export const getSettings    = ()     => api.get("/api/settings");
export const updateSettings = (data) => api.put("/api/settings", data);
export const getSettingsSchema   = ()     => api.get("/api/settings/schema");
export const getSettingsDefaults = ()     => api.get("/api/settings/defaults");
