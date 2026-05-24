import axios from "axios";
import { getAuthSession } from "../utils/authSession";

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

export default api;
