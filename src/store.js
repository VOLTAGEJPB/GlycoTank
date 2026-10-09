// App state persistence. On iOS/Android it uses Capacitor Preferences (native
// storage the OS won't evict like WebView localStorage); in a browser it falls
// back to localStorage. Saves are debounced.

import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";
import { DEFAULT_SETTINGS } from "./model.js";

const KEY = "glycotank.v2";
const LEGACY_KEY = "glycotank"; // data written by the original web/Android app
const native = Capacitor.isNativePlatform();

export function emptyState() {
  return {
    version: 2,
    meals: [],
    workouts: [],
    checks: [],
    mealFavs: [],
    workoutFavs: [],
    profile: {},
    settings: structuredClone(DEFAULT_SETTINGS),
    meta: { introSeen: false, personalized: false },
  };
}

async function readRaw(key) {
  if (native) return (await Preferences.get({ key })).value;
  return localStorage.getItem(key);
}

async function writeRaw(key, value) {
  if (native) await Preferences.set({ key, value });
  else localStorage.setItem(key, value);
}

// Normalize stored or imported data into the current shape.
export function normalize(raw) {
  const base = emptyState();
  if (!raw || typeof raw !== "object") return base;
  const legacy = raw.version !== 2;
  const settings = { ...base.settings, ...(raw.settings || {}) };
  if (legacy && raw.settings) {
    if (raw.settings.cardioGpmIntensity1 != null) settings.cardioGpm = raw.settings.cardioGpmIntensity1;
    delete settings.cardioGpmIntensity1;
    delete settings.autosave;
    delete settings.lastBackup;
    delete settings.chartDays;
    delete settings.remind;
    settings.units = "kg"; // the original app logged weights in kg
  }
  settings.reminders = { ...base.settings.reminders, ...(settings.reminders || {}) };
  const list = (k) => (Array.isArray(raw[k]) ? raw[k] : []);
  return {
    ...base,
    meals: list("meals"),
    workouts: list("workouts"),
    checks: list("checks"),
    mealFavs: list("mealFavs"),
    workoutFavs: list("workoutFavs"),
    profile: raw.profile && typeof raw.profile === "object" ? raw.profile : {},
    settings,
    meta: { ...base.meta, ...(raw.meta || {}), introSeen: legacy ? true : !!raw.meta?.introSeen },
  };
}

export async function loadState() {
  try {
    const current = await readRaw(KEY);
    if (current) return normalize(JSON.parse(current));
    // One-time import from the original app's storage (same WebView origin).
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const state = normalize(JSON.parse(legacy));
      await writeRaw(KEY, JSON.stringify(state));
      return state;
    }
  } catch (e) {
    console.error("Could not load saved data", e);
  }
  return emptyState();
}

let timer = null;
let pending = null;

export function saveState(state) {
  pending = state;
  clearTimeout(timer);
  timer = setTimeout(flush, 300);
}

export async function flush() {
  clearTimeout(timer);
  if (!pending) return;
  const json = JSON.stringify(pending);
  pending = null;
  try {
    await writeRaw(KEY, json);
  } catch (e) {
    console.error("Could not save data", e);
  }
}

// Make sure nothing is lost when the app is backgrounded or closed.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flush();
});
window.addEventListener("pagehide", flush);

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
