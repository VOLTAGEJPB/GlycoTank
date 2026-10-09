import { esc, round } from "../ui.js";

export function workoutDetail(w, s) {
  if (w.type === "strength") return `${round(w.sets)} × ${round(w.reps)}${w.weight ? ` @ ${round(w.weight, 1)} ${s.units}` : ""}`;
  if (w.type === "cardio") return `${round(w.mins)} min · intensity ${w.intensity}`;
  return w.type === "sport" ? "Sport" : "Other";
}

export function workoutLine(w, s) {
  return `<li><button class="entry" data-edit="workout" data-id="${esc(w.id)}">
    <span class="entry-main"><strong>${esc(w.name || w.type)}</strong>${w.sessionName ? `<span class="tag">${esc(w.sessionName)}</span>` : ""}</span>
    <span class="entry-sub">${esc(workoutDetail(w, s))}</span></button></li>`;
}

export function mealLine(m) {
  return `<li><button class="entry" data-edit="meal" data-id="${esc(m.id)}">
    <span class="entry-main"><strong>${esc(m.name || "Meal")}</strong><span class="entry-kcal">${round(m.kcal)} kcal</span></span>
    <span class="entry-sub">C ${round(m.carbs)} · P ${round(m.protein)} · F ${round(m.fat)} · Fiber ${round(m.fiber)}</span></button></li>`;
}
