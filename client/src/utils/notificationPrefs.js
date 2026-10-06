const SOUND_KEY = "astrafleet:notifications:sound";
const DESKTOP_KEY = "astrafleet:notifications:desktop";
export const PREFS_EVENT = "notification-prefs:change";

function read(key, fallback) {
  try {
    const value = window.localStorage.getItem(key);
    return value === null ? fallback : value === "1";
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    window.localStorage.setItem(key, value ? "1" : "0");
  } catch {
    // Preferences are a convenience; ignore storage failures.
  }
  window.dispatchEvent(new CustomEvent(PREFS_EVENT));
}

export function isSoundEnabled() {
  return read(SOUND_KEY, true);
}

export function setSoundEnabled(value) {
  write(SOUND_KEY, value);
}

export function desktopAlertsSupported() {
  return typeof window !== "undefined" && "Notification" in window;
}

export function isDesktopAlertsEnabled() {
  return desktopAlertsSupported() && Notification.permission === "granted" && read(DESKTOP_KEY, false);
}

export async function setDesktopAlertsEnabled(value) {
  if (!value) {
    write(DESKTOP_KEY, false);
    return false;
  }
  if (!desktopAlertsSupported()) return false;
  const permission = Notification.permission === "default"
    ? await Notification.requestPermission()
    : Notification.permission;
  const granted = permission === "granted";
  write(DESKTOP_KEY, granted);
  return granted;
}

// Fires an OS-level notification only while the tab is in the background,
// so admins on another tab still hear about critical events and driver messages.
export function showDesktopAlert({ title, body, tag, onClick }) {
  if (!document.hidden || !isDesktopAlertsEnabled()) return;
  try {
    const alert = new Notification(title, { body, tag, icon: "/favicon.png" });
    alert.onclick = () => {
      window.focus();
      alert.close();
      onClick?.();
    };
  } catch {
    // Some browsers only allow notifications from a service worker.
  }
}
