import { esc, round } from "../ui.js";

export function workoutDetail(w, s) {
  if (w.type === "strength") {
    // Per-set detail when the sets differ, e.g. "3 sets: 8×185, 6×205, 5×215 lb".
    const list = w.setList || [];
    const same = list.every((x) => x.reps === list[0]?.reps && x.weight === list[0]?.weight);
    if (list.length > 1 && !same) return `${list.length} sets: ${list.map((x) => `${x.reps || "?"}${x.weight ? `×${round(x.weight, 1)}` : ""}`).join(", ")}${list.some((x) => x.weight) ? ` ${s.units}` : ""}`;
    return `${round(w.sets)} × ${round(w.reps)}${w.weight ? ` @ ${round(w.weight, 1)} ${s.units}` : ""}`;
  }
  if (w.type === "cardio") return `${round(w.mins)} min · intensity ${w.intensity}`;
  const label = w.type === "sport" ? "Sport" : "Other";
  return w.mins ? `${label} · ${round(w.mins)} min` : label;
}

export function workoutLine(w, s) {
  return `<li><button class="entry" data-edit="workout" data-id="${esc(w.id)}">
    <span class="entry-main"><strong>${esc(w.name || w.type)}</strong>${w.sessionName ? `<span class="tag">${esc(w.sessionName)}</span>` : ""}</span>
    <span class="entry-sub">${esc(workoutDetail(w, s))}</span></button></li>`;
}

const MACROS = [
  ["carbs", "Carbs", 4],
  ["protein", "Protein", 4],
  ["fat", "Fat", 9],
  ["fiber", "Fiber", 0],
];

// Where a meal's calories come from: carbs and protein 4 kcal/g, fat 9 kcal/g.
function calorieSplit(m) {
  const parts = MACROS.filter(([, , kcal]) => kcal).map(([k, , kcal]) => [k, (+m[k] || 0) * kcal]);
  const total = parts.reduce((t, [, v]) => t + v, 0);
  if (!total) return "";
  const pct = (v) => Math.round((v / total) * 100);
  const label = parts.map(([k, v]) => `${pct(v)}% ${k}`).join(", ");
  return `<span class="macro-split" role="img" aria-label="Calories: ${label}">${parts
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `<span class="m-${k}" style="flex:${v}"></span>`)
    .join("")}</span>`;
}

export function mealLine(m) {
  return `<li><button class="entry" data-edit="meal" data-id="${esc(m.id)}">
    <span class="entry-main"><strong>${esc(m.name || "Meal")}</strong><span class="entry-kcal">${round(m.kcal)} kcal</span></span>
    ${calorieSplit(m)}
    <span class="macro-chips">${MACROS.map(([k, label]) => `<span class="macro m-${k}"><b>${round(+m[k] || 0)}g</b> ${label}</span>`).join("")}</span></button></li>`;
}
