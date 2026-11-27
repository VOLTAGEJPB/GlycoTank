// Light / dark appearance. settings.theme is "dark" (default), "light" or
// "system". The last choice is also kept in localStorage so the very first
// paint, before the saved state loads, already uses the right colors.
import { Capacitor } from "@capacitor/core";
import { StatusBar, Style } from "@capacitor/status-bar";

const KEY = "glycotank.theme";
const media = window.matchMedia?.("(prefers-color-scheme: light)");
let current = "dark";

export const THEMES = [["system", "Match phone"], ["light", "Light"], ["dark", "Dark"]];

const resolved = () => (current === "system" ? (media?.matches ? "light" : "dark") : current);

function paint() {
  const mode = resolved();
  const root = document.documentElement;
  root.dataset.theme = mode;
  document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", mode);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", mode === "light" ? "#f4f6f9" : "#0f1115");
  if (Capacitor.isNativePlatform()) {
    // Style.Dark = light text (for a dark background), Style.Light = dark text.
    StatusBar.setStyle({ style: mode === "light" ? Style.Light : Style.Dark }).catch(() => {});
  }
}

export function applyTheme(theme) {
  const next = ["light", "system"].includes(theme) ? theme : "dark";
  if (next === current && document.documentElement.dataset.theme) return;
  current = next;
  try {
    localStorage.setItem(KEY, current);
  } catch {}
  paint();
}

// Called once on startup, before the saved settings are read.
export function initTheme() {
  let saved = "dark";
  try {
    saved = localStorage.getItem(KEY) || "dark";
  } catch {}
  current = saved;
  paint();
  // The phone switched light/dark: repaint, and let the app redraw its charts.
  media?.addEventListener?.("change", () => {
    if (current !== "system") return;
    paint();
    window.dispatchEvent(new Event("themechange"));
  });
}

export const themeMode = resolved;
