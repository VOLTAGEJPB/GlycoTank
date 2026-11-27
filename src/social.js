// Friends: talks to /social on the GlycoTank API, keeps the friend list in
// memory, reports which days you logged (for streaks), and handles push.
import { Capacitor } from "@capacitor/core";
import { CLOUD } from "./cloud-config.js";
import { idToken, current } from "./auth.js";
import { localDate, lastNDays, dayTotals } from "./model.js";

const PHOTO_KEY = "glycotank.friendPhotos";
let data = null; // last GET /social answer
let loadedAt = 0;
let activityTimer = null;
let lastActivity = "";
let pushReady = false;
const listeners = new Set();

const DEMO = typeof location !== "undefined" && location.search.includes("demo");
const DEMO_DATA = {
  me: { uid: "me", handle: "joel", name: "Joel", emoji: "💪", color: "#57cc99", photoVer: 0, share: true },
  friends: [
    { uid: "a", handle: "maria.fit", name: "Maria", emoji: "🏃", color: "#ff6b9a", photoVer: 0, streak: 9, loggedToday: false, shared: 6 },
    { uid: "b", handle: "dre_lifts", name: "Andre", emoji: "🏋️", color: "#5cb8ff", photoVer: 0, streak: 21, loggedToday: true, shared: 14, summary: { kcal: 2140, protein: 168, carbs: 230, workouts: 1 } },
    { uid: "c", handle: "sam", name: "Sam", emoji: "🥑", color: "#ffb547", photoVer: 0, streak: 3, loggedToday: true, shared: 3 },
  ],
  incoming: [{ uid: "d", handle: "kev.runs", name: "Kevin", emoji: "🚴", color: "#b99cff", photoVer: 0 }],
  outgoing: [],
};
export const socialAvailable = () => DEMO || !!(CLOUD.apiUrl && current());
export const socialData = () => data;
export const onSocial = (fn) => (listeners.add(fn), () => listeners.delete(fn));
const emit = () => listeners.forEach((fn) => fn(data));

export class SocialError extends Error {}

async function api(method, path, body) {
  if (DEMO) return body?.action === "setProfile" || !body ? DEMO_DATA : { ok: true };
  let res;
  try {
    res = await fetch(CLOUD.apiUrl + path, {
      method,
      headers: { Authorization: `Bearer ${await idToken()}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new SocialError("Can't reach GlycoTank. Check your internet connection.");
  }
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new SocialError(out.error || "Something went wrong. Please try again.");
  return out;
}

function keep(next) {
  if (next && "friends" in next) {
    data = next;
    loadedAt = Date.now();
    emit();
  }
  return data;
}

export async function loadSocial(force = false) {
  if (!socialAvailable()) return null;
  if (!force && data && Date.now() - loadedAt < 60_000) return data;
  return keep(await api("GET", "/social"));
}

export const act = async (action, body = {}) => keep(await api("POST", "/social", { action, ...body }));

// ---------- Activity (streaks) ----------
function activityFor(state) {
  const today = localDate();
  const active = new Set([...state.meals, ...state.workouts, ...state.checks].map((x) => x.date));
  const days = lastNDays(today, 120).filter((d) => active.has(d));
  const t = dayTotals(state, today);
  const summary = { date: today, kcal: t.kcal, protein: t.protein, carbs: t.carbs, workouts: state.workouts.filter((w) => w.date === today).length };
  return { days, summary, tz: Intl.DateTimeFormat().resolvedOptions().timeZone };
}

// Called after every save; sends at most once every few seconds, and only
// when something friends can see actually changed.
export function reportActivity(app) {
  if (!data?.me || !socialAvailable()) return;
  clearTimeout(activityTimer);
  activityTimer = setTimeout(async () => {
    const body = activityFor(app.state);
    const key = JSON.stringify(body);
    if (key === lastActivity) return;
    try {
      await api("POST", "/social", { action: "activity", ...body });
      lastActivity = key;
    } catch {}
  }, 4000);
}
export const sendActivityNow = (app) => act("activity", activityFor(app.state)).catch(() => {});

// ---------- Photos ----------
let photoCache = null;
function cache() {
  if (!photoCache) {
    try {
      photoCache = JSON.parse(localStorage.getItem(PHOTO_KEY) || "{}");
    } catch {
      photoCache = {};
    }
  }
  return photoCache;
}
// A data: URL for the user's photo, or null. `ver` 0 means no photo.
export async function photoFor(uid, ver) {
  if (!ver) return null;
  const c = cache();
  if (c[uid]?.ver === ver) return c[uid].url;
  try {
    const r = await api("GET", `/social/photo?uid=${encodeURIComponent(uid)}`);
    c[uid] = { ver, url: `data:image/jpeg;base64,${r.data}` };
    const keys = Object.keys(c);
    if (keys.length > 120) delete c[keys[0]];
    try {
      localStorage.setItem(PHOTO_KEY, JSON.stringify(c));
    } catch {}
    return c[uid].url;
  } catch {
    return null;
  }
}

// Square-crops and shrinks a picked photo to a 256 px JPEG (base64).
export async function squareJpeg(blob) {
  const bmp = await createImageBitmap(blob, { imageOrientation: "from-image" });
  const side = Math.min(bmp.width, bmp.height);
  const canvas = Object.assign(document.createElement("canvas"), { width: 256, height: 256 });
  canvas.getContext("2d").drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, 256, 256);
  bmp.close?.();
  return canvas.toDataURL("image/jpeg", 0.82).split(",")[1];
}

// ---------- Push ----------
// Asks for notification permission (iOS) and registers this phone.
export async function enablePush(app) {
  if (Capacitor.getPlatform() !== "ios" || pushReady) return;
  const { PushNotifications } = await import("@capacitor/push-notifications");
  let perm = await PushNotifications.checkPermissions();
  if (perm.receive === "prompt" || perm.receive === "prompt-with-rationale") perm = await PushNotifications.requestPermissions();
  if (perm.receive !== "granted") return;
  pushReady = true;
  await PushNotifications.addListener("registration", ({ value }) => act("pushToken", { token: value, platform: "ios" }).catch(() => {}));
  await PushNotifications.addListener("pushNotificationActionPerformed", ({ notification }) => {
    const route = notification?.data?.route;
    if (route === "log") app.go("log");
    else app.go("friends");
  });
  await PushNotifications.addListener("pushNotificationReceived", () => loadSocial(true).catch(() => {}));
  await PushNotifications.register();
}

// Re-registers on start when permission was already given (tokens can change).
export async function resumePush(app) {
  if (Capacitor.getPlatform() !== "ios") return;
  const { PushNotifications } = await import("@capacitor/push-notifications");
  if ((await PushNotifications.checkPermissions()).receive === "granted") await enablePush(app);
}
