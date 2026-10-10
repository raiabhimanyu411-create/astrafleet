import api from "./axios";

export const logout = () => api.post("/api/auth/logout");
export const getMySession = () => api.get("/api/auth/session");
export const getMyProfile = () => api.get("/api/auth/me");
export const updateMyProfile = (data) => api.patch("/api/auth/me", data);
