import { useEffect, useState } from "react";

const SESSION_KEY = "astrafleet_session";
const SESSION_EVENT = "astrafleet:session";

export function saveAuthSession(session) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  window.dispatchEvent(new Event(SESSION_EVENT));
}

export function getAuthSession() {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearAuthSession() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(SESSION_KEY);
}

// Live copy of the signed-in session: re-renders when the name or access changes.
export function useAuthSession() {
  const [session, setSession] = useState(() => getAuthSession());
  useEffect(() => {
    const sync = () => setSession(getAuthSession());
    window.addEventListener(SESSION_EVENT, sync);
    return () => window.removeEventListener(SESSION_EVENT, sync);
  }, []);
  return session;
}

// "Abhimanyu Rai" -> "Abhimanyu"
export function firstNameOf(name) {
  return String(name || "").trim().split(/\s+/)[0] || "";
}
