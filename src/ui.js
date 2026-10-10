// Small DOM helpers shared by every screen.

import { haptic } from "./motion.js";

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(v) {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export const round = (v, digits = 0) => {
  const f = 10 ** digits;
  return Math.round((+v || 0) * f) / f;
};

export function num(el) {
  const v = parseFloat(el?.value);
  return Number.isFinite(v) ? v : 0;
}

export function prettyDate(dateStr, today) {
  if (dateStr === today) return "Today";
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

// Confirmation toast plus a success haptic, for saves.
export function success(message) {
  toast(message);
  haptic.success();
}

let toastTimer;
export function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.hidden = false;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => (el.hidden = true), 200);
  }, 2200);
}

// Promise-based confirm dialog that matches the app's styling.
export function confirmDialog(message, okLabel = "Delete") {
  const dlg = $("#confirm");
  $("#confirmText", dlg).textContent = message;
  $("#confirmOk", dlg).textContent = okLabel;
  dlg.showModal();
  return new Promise((resolve) => {
    dlg.addEventListener("close", () => resolve(dlg.returnValue === "ok"), { once: true });
  });
}

export function field(id, label, attrs = "", value = "") {
  return `<label class="field"><span>${label}</span><input id="${id}" ${attrs} value="${esc(value)}"></label>`;
}

export function select(id, label, options, selected) {
  return `<label class="field"><span>${label}</span><select id="${id}">${options
    .map(([v, t]) => `<option value="${esc(v)}"${String(v) === String(selected) ? " selected" : ""}>${esc(t)}</option>`)
    .join("")}</select></label>`;
}

export function progress(value, max, tone = "") {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return `<div class="bar ${tone}" role="progressbar" aria-valuenow="${Math.round(pct)}" aria-valuemin="0" aria-valuemax="100"><div style="width:${pct}%"></div></div>`;
}
