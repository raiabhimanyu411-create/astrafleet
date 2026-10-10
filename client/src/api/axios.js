import axios from "axios";
import { clearAuthSession, getAuthSession } from "../utils/authSession";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || "",
});

api.interceptors.request.use((config) => {
  const session = getAuthSession();
  if (session?.id) config.headers["x-session-user-id"] = session.id;
  if (session?.role) config.headers["x-session-role"] = session.role;
  if (session?.sessionToken) config.headers["x-session-token"] = session.sessionToken;
  return config;
});

// Expired or revoked token (logout elsewhere, password change, access removed): drop it and go to login.
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && error.response.data?.code === "SESSION_EXPIRED" && getAuthSession()) {
      clearAuthSession();
      if (window.location.pathname !== "/") window.location.replace("/");
    }
    return Promise.reject(error);
  }
);

export default api;
