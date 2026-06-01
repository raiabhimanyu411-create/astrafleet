import api from "./axios";

export const logout = () => api.post("/api/auth/logout");
