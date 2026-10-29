import api from "../api/axios";

// Several components on one page (the header bell and the pop-up notifier) read the same list. Calls made
// within a couple of seconds share one request instead of hitting the server again.
const SHARE_MS = 2000;
const recent = new Map();

export function sharedGet(url, params) {
  const key = `${url}?${JSON.stringify(params || {})}`;
  const hit = recent.get(key);
  if (hit && Date.now() - hit.at < SHARE_MS) return hit.promise;
  const promise = api.get(url, params ? { params } : undefined);
  recent.set(key, { at: Date.now(), promise });
  promise.catch(() => recent.delete(key));
  return promise;
}

// Call after changing the data (read, acknowledge) so the next read is fresh.
export function forgetSharedGet(url) {
  for (const key of recent.keys()) {
    if (key.startsWith(`${url}?`)) recent.delete(key);
  }
}
