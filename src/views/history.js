import { localDate, dayTotals } from "../model.js";
import { $, esc, round, select, prettyDate } from "../ui.js";
import { workoutLine, mealLine } from "./entries.js";

const filters = { type: "", protein: "" };
const PAGE = 30;
let shown = PAGE;

export function renderHistory(root, app) {
  const { state } = app;
  const s = state.settings;
  const today = localDate();
  const dates = [...new Set([...state.meals, ...state.workouts].map((x) => x.date))].sort().reverse();

  const days = dates
    .map((date) => {
      const totals = dayTotals(state, date);
      let workouts = state.workouts.filter((w) => w.date === date);
      if (filters.type) workouts = workouts.filter((w) => w.type === filters.type);
      const hit = totals.protein >= s.proteinTarget;
      if (filters.protein && (filters.protein === "hit") !== hit) return null;
      const meals = filters.type ? [] : totals.meals;
      if (!workouts.length && !meals.length) return null;
      return { date, totals, workouts, meals, hit };
    })
    .filter(Boolean);

  root.innerHTML = `
    <section class="card filters">
      ${select("hType", "Show", [["", "Meals & training"], ["strength", "Strength only"], ["cardio", "Cardio only"], ["sport", "Sport only"], ["other", "Other only"]], filters.type)}
      ${select("hProtein", "Protein", [["", "Any day"], ["hit", "Hit target"], ["miss", "Missed target"]], filters.protein)}
    </section>
    ${days.length ? days.slice(0, shown).map((d) => `
      <section class="card day">
        <div class="card-head"><h2>${esc(prettyDate(d.date, today))}</h2>
          <span class="tag ${d.hit ? "ok" : ""}">${round(d.totals.kcal)} kcal · ${round(d.totals.protein)} g protein</span></div>
        ${d.workouts.length ? `<ul class="entries">${d.workouts.map((w) => workoutLine(w, s)).join("")}</ul>` : ""}
        ${d.meals.length ? `<ul class="entries">${d.meals.map(mealLine).join("")}</ul>` : ""}
      </section>`).join("") : `<p class="empty">${dates.length ? "No days match these filters." : "Nothing logged yet. Your history will appear here."}</p>`}
    ${days.length > shown ? `<button class="btn wide" id="more">Show more</button>` : ""}`;

  $("#hType").addEventListener("change", (e) => {
    filters.type = e.target.value;
    shown = PAGE;
    renderHistory(root, app);
  });
  $("#hProtein").addEventListener("change", (e) => {
    filters.protein = e.target.value;
    shown = PAGE;
    renderHistory(root, app);
  });
  $("#more")?.addEventListener("click", () => {
    shown += PAGE;
    renderHistory(root, app);
  });
}
