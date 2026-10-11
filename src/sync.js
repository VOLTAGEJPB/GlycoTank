// Keeps the device in sync with the account's cloud copy.
// Local changes upload a moment after each save; remote changes download when
// the app opens or returns to the foreground. Works offline and catches up.

import { CLOUD } from "./cloud-config.js";
import { idToken, current } from "./auth.js";
import { toRecords, applyRecords } from "./sync-model.js";

let app = null;
let timer = null;
let running = null;
let listeners = [];

export const status = { lastSync: 0, error: null, syncing: false };
export const onStatus = (fn) => listeners.push(fn);
const emit = () => listeners.forEach((fn) => fn(status));

export function initSync(theApp) {
  app = theApp;
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && syncNow());
  window.addEventListener("online", () => syncNow());
}

// Called after every local save.
export function scheduleSync() {
  clearTimeout(timer);
  timer = setTimeout(syncNow, 2000);
}

async function api(method, path, body) {
  const res = await fetch(CLOUD.apiUrl + path, {
    method,
    headers: { Authorization: `Bearer ${await idToken()}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Sync failed (${res.status})`);
  return res.json();
}

// Uploads local changes and applies remote ones. Returns true if local data changed.
export function syncNow() {
  if (!app || !current() || !CLOUD.apiUrl) return Promise.resolve(false);
  if (running) return running;
  running = (async () => {
    const st = app.state;
    st.sync = st.sync || { cursor: 0, pushedAt: 0 };
    status.syncing = true;
    emit();
    try {
      const startedAt = Date.now();
      const records = toRecords(st, st.sync.pushedAt);
      let changed = 0;
      for (let i = 0; i === 0 || i < records.length; i += 500) {
        const res = await api("POST", "/sync", { since: st.sync.cursor, records: records.slice(i, i + 500) });
        changed += applyRecords(st, res.records);
        st.sync.cursor = res.cursor;
      }
      st.sync.pushedAt = startedAt;
      status.lastSync = Date.now();
      status.error = null;
      app.saveQuietly();
      if (changed) app.refresh();
      return changed > 0;
    } catch (e) {
      status.error = navigator.onLine === false ? "offline" : e.message;
      return false;
    } finally {
      status.syncing = false;
      running = null;
      emit();
    }
  })();
  return running;
}

export async function deleteCloudAccount() {
  await api("DELETE", "/account");
}
