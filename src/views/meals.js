import { localDate, dayTotals, streak, weekLog, mealSlot, MEAL_SLOTS } from "../model.js";
import { round, progress } from "../ui.js";
import { mealLine } from "./entries.js";

const DAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];

// The home screen: this week's logging, today's totals, and the day's meals
// by category, each with its own Add food button.
export function renderMeals(root, app) {
  const { state } = app;
  const s = state.settings;
  const today = localDate();
  const totals = dayTotals(state, today);
  const kcalLeft = s.kcalTarget - totals.kcal;
  const pct = Math.min(100, (totals.kcal / s.kcalTarget) * 100 || 0);
  const week = weekLog(state, today);
  const logged = week.filter((d) => d.meals).length;
  const days = streak(state, today);

  const slotCard = ([key, label]) => {
    const meals = totals.meals.filter((m) => mealSlot(m) === key);
    const kcal = meals.reduce((t, m) => t + (+m.kcal || 0), 0);
    return `
    <section class="card slot">
      <div class="card-head"><h2>${label}</h2><span class="sub">${meals.length ? `${round(kcal)} kcal` : ""}</span></div>
      ${meals.length ? `<ul class="entries">${meals.map(mealLine).join("")}</ul>` : ""}
      <button class="add-food" data-slot="${key}">+ Add food</button>
    </section>`;
  };

  root.innerHTML = `
    <section class="card week">
      <div class="card-head"><h2>This week</h2><span class="sub">${logged} of 7 days logged</span></div>
      <div class="week-days">${week.map((d, i) => `
        <div class="wday ${d.meals ? "done" : ""} ${d.date === today ? "today" : ""} ${d.future ? "future" : ""}">
          <span class="wl">${DAY_LETTERS[i]}</span>
          <span class="wdot">${d.meals ? d.meals : ""}</span>
        </div>`).join("")}</div>
      ${progress(logged, 7, "good")}
      <p class="hint streak-line">${days ? `<strong>${days}-day streak.</strong> ${logged >= 7 ? "A perfect week!" : "Keep it going."}` : "Log a meal to start your streak."}</p>
    </section>

    <section class="card meal-first">
      <div class="meal-hero">
        <div class="ring ${kcalLeft < 0 ? "over" : ""}" style="--pct:${round(pct)}">
          <div><div class="kpi" id="kcalLeft">${round(Math.abs(kcalLeft))}</div><div class="sub">${kcalLeft >= 0 ? "kcal left" : "kcal over"}</div></div>
        </div>
        <div class="macros">
          <div><div class="label">Calories <span>${round(totals.kcal)} / ${s.kcalTarget}</span></div>${progress(totals.kcal, s.kcalTarget)}</div>
          <div><div class="label">Protein <span>${round(totals.protein)} / ${s.proteinTarget} g</span></div>${progress(totals.protein, s.proteinTarget, "good")}</div>
          <div><div class="label">Carbs <span>${round(totals.carbs)} / ${s.carbGuide} g</span></div>${progress(totals.carbs, s.carbGuide)}</div>
          <div><div class="label">Fiber <span>${round(totals.fiber)} / ${s.fiberTarget} g</span></div>${progress(totals.fiber, s.fiberTarget)}</div>
        </div>
      </div>
    </section>

    ${MEAL_SLOTS.map(slotCard).join("")}

    ${state.meta.personalized ? "" : `<button class="banner" data-go="more" data-section="goals">Using default targets. <strong>Personalize them →</strong></button>`}
  `;

  root.querySelectorAll("[data-slot]").forEach((b) =>
    b.addEventListener("click", () => {
      app.editing = null;
      app.prefill = { slot: b.dataset.slot };
      app.go("log", "meal");
    }),
  );
}
