// Apple Health (iPhone) and Health Connect (Android): read-only.
//
// Reads workouts, steps, sleep, resting heart rate, heart rate variability and
// active calories. Watch workouts are added to the log automatically (each one
// once, even if the user later deletes it); each day's activity, sleep and
// heart summary goes in state.meta.healthDays for the Tank card and Check-in.
// Health data is never used for ads (Apple 5.1.3 / Health Connect policy).
import { Capacitor } from "@capacitor/core";
import { Health } from "@capgo/capacitor-health";
import { localDate, addDays } from "./model.js";
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); // same format as store.js

const native = Capacitor.isNativePlatform();
const READ = ["workouts", "steps", "sleep", "restingHeartRate", "heartRateVariability", "calories"];
const CONNECTED_KEY = "glycotank.healthConnected"; // permission is per device, so this stays on the phone
const KEEP_DAYS = 14;
const MIN_GAP_MS = 5 * 60_000;
export const healthName = () => (Capacitor.getPlatform() === "android" ? "Health Connect" : "Apple Health");

// Imported statically and never returned from an async function: Capacitor
// plugin proxies answer every property, including "then", so awaiting one never settles.
const plug = () => Health;

export async function healthAvailable() {
  if (!native) return false;
  try {
    const res = await Promise.race([plug().isAvailable(), new Promise((r) => setTimeout(() => r({ available: false, timedOut: true }), 4000))]);
    return !!res.available;
  } catch {
    return false;
  }
}

export const healthConnected = () => {
  try {
    return localStorage.getItem(CONNECTED_KEY) === "1";
  } catch {
    return false;
  }
};
const setConnected = (on) => {
  try {
    on ? localStorage.setItem(CONNECTED_KEY, "1") : localStorage.removeItem(CONNECTED_KEY);
  } catch {}
};

// Shows the system permission sheet. iOS never says which types were allowed,
// so "connected" means the user went through the sheet; missing data just reads as empty.
export async function connectHealth(app) {
  const h = plug();
  const res = await h.requestAuthorization({ read: READ, requestHistoryAccess: false });
  if (Capacitor.getPlatform() === "android" && !res.readAuthorized?.length) return false;
  setConnected(true);
  await syncHealth(app, { force: true, firstRun: true });
  return true;
}

export function disconnectHealth() {
  setConnected(false);
}

export const openHealthSettings = () => plug().openHealthConnectSettings().catch(() => {});

// ---------- mapping ----------

const STRENGTH = new Set(["strengthTraining", "traditionalStrengthTraining", "functionalStrengthTraining", "weightlifting", "coreTraining", "crossTraining", "calisthenics", "benchPress", "deadlift", "latPullDown", "lunge", "barbellShoulderPress", "backExtension", "plank", "crunch", "burpee"]);
const SPORT = new Set(["americanFootball", "australianFootball", "badminton", "baseball", "basketball", "cricket", "handball", "hockey", "iceHockey", "lacrosse", "racquetball", "rugby", "soccer", "softball", "squash", "tableTennis", "tennis", "volleyball", "pickleball", "golf", "boxing", "kickboxing", "martialArts", "wrestling", "fencing", "waterPolo", "discSports", "frisbeedisc", "rollerHockey"]);
// Light movement that steps already cover, or that barely uses glycogen.
const SKIP = new Set(["walking", "cooldown", "mindAndBody", "meditation", "guidedBreathing", "flexibility", "stretching", "preparationAndRecovery", "transition", "fishing", "hunting", "sailing", "taiChi"]);

export const workoutLabel = (t = "other") =>
  ({ highIntensityIntervalTraining: "HIIT", traditionalStrengthTraining: "Strength training", functionalStrengthTraining: "Functional strength", runningTreadmill: "Treadmill run", bikingStationary: "Indoor cycling" })[t] ||
  t.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()).trim();

// One Health workout -> a GlycoTank workout, or null to skip.
export function toWorkout(w) {
  if (SKIP.has(w.workoutType)) return null;
  const mins = Math.round((w.duration || 0) / 60);
  if (mins < 5) return null;
  const kcalPerMin = w.totalEnergyBurned ? w.totalEnergyBurned / mins : 0;
  const intensity = !kcalPerMin ? 3 : kcalPerMin < 5 ? 2 : kcalPerMin < 8 ? 3 : kcalPerMin < 11 ? 4 : 5;
  const base = {
    id: uid(),
    date: localDate(new Date(w.startDate)),
    name: workoutLabel(w.workoutType),
    source: "health",
    healthId: w.platformId || `${w.startDate}|${w.workoutType}`,
    ...(w.totalEnergyBurned ? { kcal: Math.round(w.totalEnergyBurned) } : {}),
    notes: `From ${healthName()}${w.sourceName ? ` (${w.sourceName})` : ""}`,
  };
  // Strength: about one hard set per 3 minutes of lifting.
  if (STRENGTH.has(w.workoutType)) return { ...base, type: "strength", sets: Math.max(1, Math.round(mins / 3)), reps: 8, mins };
  if (SPORT.has(w.workoutType)) return { ...base, type: "sport", mins, intensity };
  return { ...base, type: "cardio", mins, intensity };
}

// GlycoTank's own sleep score (0-100) from one night: 60 for duration (8 h =
// full marks), 20 for efficiency (asleep vs awake in bed), 20 for deep + REM
// (about 40% of sleep = full marks). Without stage data the stage part gets 14.
export function sleepScore({ asleep = 0, awake = 0, deep = 0, rem = 0, staged = false }) {
  if (!asleep) return null;
  const dur = Math.min(asleep / 480, 1) * 60;
  const eff = (asleep / (asleep + awake || 1)) * 20;
  const stages = staged ? Math.min((deep + rem) / asleep / 0.4, 1) * 20 : 14;
  return Math.round(Math.max(0, Math.min(100, dur + eff + stages)));
}

// Sums sleep samples into one night (minutes per stage).
export function summarizeSleep(samples) {
  const night = { asleep: 0, awake: 0, deep: 0, rem: 0, light: 0, staged: false };
  const add = (state, mins) => {
    if (state === "awake") night.awake += mins;
    else if (state === "inBed") return;
    else {
      night.asleep += mins;
      if (state === "deep" || state === "rem" || state === "light") (night[state] += mins), (night.staged = true);
    }
  };
  for (const s of samples) {
    if (s.stages?.length) for (const st of s.stages) add(st.stage, st.durationMinutes);
    else add(s.sleepState || "asleep", s.value);
  }
  for (const k of ["asleep", "awake", "deep", "rem", "light"]) night[k] = Math.round(night[k]);
  return night;
}

// ---------- reading ----------

const iso = (d) => d.toISOString();
const dayStart = (date) => new Date(`${date}T00:00:00`);

async function dailySums(h, dataType, days) {
  const end = new Date();
  const start = dayStart(addDays(localDate(), -(days - 1)));
  const { samples } = await h.queryAggregated({ dataType, startDate: iso(start), endDate: iso(end), bucket: "day", aggregation: "sum" });
  return Object.fromEntries(samples.map((s) => [localDate(new Date(s.startDate)), Math.round(s.value || 0)]));
}

async function latest(h, dataType, sinceDays = 3) {
  const { samples } = await h.readSamples({ dataType, startDate: iso(new Date(Date.now() - sinceDays * 864e5)), endDate: iso(new Date()), limit: 1, ascending: false });
  return samples[0] ? Math.round(samples[0].value) : null;
}

// Last night: sleep that ended between 6 pm yesterday and 2 pm today.
async function lastNight(h) {
  const today = localDate();
  const start = new Date(`${addDays(today, -1)}T18:00:00`);
  const end = new Date(`${today}T14:00:00`);
  const { samples } = await h.readSamples({ dataType: "sleep", startDate: iso(start), endDate: iso(new Date(Math.min(end, Date.now()))), limit: 500, ascending: true });
  const night = summarizeSleep(samples);
  return night.asleep ? { ...night, score: sleepScore(night) } : null;
}

const quiet = (p) => p.catch((e) => (console.warn("health", e?.message || e), null));
let lastRun = 0;
let running = null;

// Pulls new workouts and today's numbers. Safe to call often (throttled).
// Returns true if anything changed.
export function syncHealth(app, { force = false, firstRun = false } = {}) {
  if (!native || !healthConnected()) return Promise.resolve(false);
  if (running) return running;
  if (!force && Date.now() - lastRun < MIN_GAP_MS) return Promise.resolve(false);
  lastRun = Date.now();
  running = (async () => {
    const h = plug();
    const state = app.state;
    const meta = state.meta;
    let changed = false;

    // Workouts: the last 7 days on first connect, then since the last check.
    const since = firstRun || !meta.healthCheckedAt ? Date.now() - 7 * 864e5 : meta.healthCheckedAt - 36 * 3600e3;
    const res = await quiet(h.queryWorkouts({ startDate: iso(new Date(since)), endDate: iso(new Date()), limit: 100, ascending: true }));
    const seen = new Set(meta.healthImported || []);
    for (const w of res?.workouts || []) {
      const item = toWorkout(w);
      if (!item || seen.has(item.healthId)) continue;
      seen.add(item.healthId);
      state.workouts.push(item);
      changed = true;
    }
    meta.healthImported = [...seen].slice(-400);

    // Daily numbers.
    const [steps, kcal, night, rhr, hrv] = await Promise.all([
      quiet(dailySums(h, "steps", 7)),
      quiet(dailySums(h, "calories", 7)),
      quiet(lastNight(h)),
      quiet(latest(h, "restingHeartRate")),
      quiet(latest(h, "heartRateVariability")),
    ]);
    const days = { ...(meta.healthDays || {}) };
    const dates = new Set([...Object.keys(steps || {}), ...Object.keys(kcal || {})]);
    for (const d of dates) days[d] = { ...days[d], ...(steps?.[d] != null ? { steps: steps[d] } : {}), ...(kcal?.[d] != null ? { activeKcal: kcal[d] } : {}) };
    const today = localDate();
    days[today] = { ...days[today], ...(night ? { sleep: night } : {}), ...(rhr ? { rhr } : {}), ...(hrv ? { hrv } : {}) };
    const cutoff = addDays(today, -KEEP_DAYS);
    for (const d of Object.keys(days)) if (d < cutoff) delete days[d];
    if (JSON.stringify(days) !== JSON.stringify(meta.healthDays || {})) (meta.healthDays = days), (changed = true);
    meta.healthCheckedAt = Date.now();
    if (changed) app.save();
    return changed;
  })().finally(() => (running = null));
  return running;
}

// Today's numbers for the Tank card and Check-in (any device; they sync).
export const healthToday = (state) => state.meta.healthDays?.[localDate()] || null;
