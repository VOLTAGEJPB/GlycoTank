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

// ---------- Feed ----------
const DEMO_FEED = () => {
  const now = Date.now();
  const f = DEMO_DATA.friends;
  return {
    posts: [
      { id: "p1", author: f[1], kind: "workout", text: "Push day done. New bench PR!", item: { name: "Push day", type: "strength", units: "lb", exercises: [{ name: "Bench press", sets: 4, reps: 6, weight: 225 }, { name: "Incline DB press", sets: 3, reps: 10, weight: 70 }, { name: "Dips", sets: 3, reps: 12 }] }, photo: false, at: now - 40 * 60e3, reactions: { "🔥": 3, "💪": 2 }, mine: "🔥", comments: [{ id: "c1", text: "Beast 💪", at: now - 30 * 60e3, by: f[0], canDelete: false }], canDelete: false },
      { id: "p2", author: f[0], kind: "meal", text: "Meal prep Sunday", item: { name: "Chicken, rice & broccoli", kcal: 620, carbs: 68, protein: 52, fat: 14, slot: "lunch" }, photo: false, at: now - 3 * 3600e3, reactions: { "😋": 4 }, mine: null, comments: [], canDelete: false },
      { id: "p3", author: DEMO_DATA.me, kind: "text", text: "Day 14 of logging every day. Feeling great!", item: null, photo: false, at: now - 26 * 3600e3, reactions: { "👏": 3, "🔥": 1 }, mine: null, comments: [{ id: "c2", text: "Keep it up!", at: now - 25 * 3600e3, by: f[2], canDelete: true }], canDelete: true },
    ],
    next: null,
  };
};

export async function loadFeed(before) {
  if (DEMO) return DEMO_FEED();
  return api("GET", `/social/feed${before ? `?before=${encodeURIComponent(before)}` : ""}`);
}
export const post = (body) => api("POST", "/social", { action: "post", ...body });
export const postAction = (action, body) => api("POST", "/social", { action, ...body });

const postPhotos = new Map();
export async function postPhoto(author, id) {
  const key = `${author}/${id}`;
  if (!postPhotos.has(key)) {
    postPhotos.set(key, api("GET", `/social/photo?uid=${encodeURIComponent(author)}&post=${encodeURIComponent(id)}`).then((r) => `data:image/jpeg;base64,${r.data}`).catch(() => null));
  }
  return postPhotos.get(key);
}

// Scales a photo for a post: up to 1080 px on the long side, JPEG.
export async function postJpeg(blob) {
  const bmp = await createImageBitmap(blob, { imageOrientation: "from-image" });
  let q = 0.8, side = 1080, out;
  do {
    const scale = Math.min(1, side / Math.max(bmp.width, bmp.height));
    const canvas = Object.assign(document.createElement("canvas"), { width: Math.round(bmp.width * scale), height: Math.round(bmp.height * scale) });
    canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
    out = canvas.toDataURL("image/jpeg", q).split(",")[1];
    side -= 180;
    q -= 0.08;
  } while (out.length * 0.75 > 190_000 && side > 300);
  bmp.close?.();
  return out;
}

// What a meal or workout shares (no notes or private details).
export function shareMeal(m) {
  return { kind: "meal", item: { name: m.name, kcal: m.kcal, carbs: m.carbs, protein: m.protein, fat: m.fat, slot: m.slot } };
}
export function shareWorkout(rows, units, sessionName) {
  if (rows.length > 1 || sessionName) return { kind: "workout", item: { name: sessionName || "Workout", type: "strength", units, exercises: rows.map((r) => ({ name: r.name, sets: r.sets, reps: r.reps, weight: r.weight })) } };
  const w = rows[0];
  return { kind: "workout", item: { name: w.name, type: w.type, sets: w.sets, reps: w.reps, weight: w.weight, mins: w.mins, intensity: w.intensity, units } };
}
