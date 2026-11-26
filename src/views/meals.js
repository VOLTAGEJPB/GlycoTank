import { localDate, dayTotals, streak, weekLog, monthLog, shiftMonth, mealSlot, MEAL_SLOTS } from "../model.js";
import { $, round, progress, esc } from "../ui.js";
import { reducedMotion, haptic } from "../motion.js";
import { mealLine } from "./entries.js";
import { drinksCard, hookDrinks } from "./drinks.js";

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
    <section class="card week" id="weekCard">${progressCard(app, today)}</section>

    <section class="card meal-first">
      <div class="meal-hero">
        <div class="ring ${kcalLeft < 0 ? "over" : ""}" style="--pct:${round(pct)}">
          <div><div class="kpi" id="kcalLeft">${round(Math.abs(kcalLeft))}</div><div class="sub">${kcalLeft >= 0 ? "kcal left" : "kcal over"}</div></div>
        </div>
        <div class="macros">
          <div><div class="label">Calories <span>${round(totals.kcal)} / ${s.kcalTarget}</span></div>${progress(totals.kcal, s.kcalTarget)}</div>
          <div><div class="label">Protein <span>${round(totals.protein)} / ${s.proteinTarget} g</span></div>${progress(totals.protein, s.proteinTarget, "m-protein")}</div>
          <div><div class="label">Carbs <span>${round(totals.carbs)} / ${s.carbGuide} g</span></div>${progress(totals.carbs, s.carbGuide, "m-carbs")}</div>
          <div><div class="label">Fiber <span>${round(totals.fiber)} / ${s.fiberTarget} g</span></div>${progress(totals.fiber, s.fiberTarget, "m-fiber")}</div>
        </div>
      </div>
    </section>

    ${MEAL_SLOTS.map(slotCard).join("")}

    ${drinksCard(app)}

    ${state.meta.personalized ? "" : `<button class="banner" data-go="more" data-section="goals">Using default targets. <strong>Personalize them →</strong></button>`}
  `;

  hookDrinks(app);
  hookProgressCard(app, today);
  root.querySelectorAll("[data-slot]").forEach((b) =>
    b.addEventListener("click", () => {
      app.editing = null;
      app.prefill = { slot: b.dataset.slot };
      app.go("log", "meal");
    }),
  );
}

// ----- This week, or a whole month -----
// The Month button grows the week strip into a calendar; the arrows step back
// through earlier months. app.calMonth holds the month shown (null = week).
const GRID_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 4h-1V2h-2v2H8V2H6v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 16H5V9h14v11z"/></svg>';

function progressCard(app, today) {
  const { state } = app;
  const days = streak(state, today);
  if (!app.calMonth) {
    const week = weekLog(state, today);
    const logged = week.filter((d) => d.meals).length;
    return `
      <div class="card-head"><h2>This week</h2><button type="button" class="cal-toggle" id="calToggle" aria-expanded="false">${GRID_ICON}Month</button></div>
      <div class="week-days">${week.map((d, i) => `
        <div class="wday ${d.meals ? "done" : ""} ${d.date === today ? "today" : ""} ${d.future ? "future" : ""}">
          <span class="wl">${DAY_LETTERS[i]}</span>
          <span class="wdot">${d.meals ? d.meals : ""}</span>
        </div>`).join("")}</div>
      <p class="sub week-sum">${logged} of 7 days logged</p>
      ${progress(logged, 7, "good")}
      <p class="hint streak-line">${days ? `<strong>${days}-day streak.</strong> ${logged >= 7 ? "A perfect week!" : "Keep it going."}` : "Log a meal to start your streak."}</p>`;
  }
  const month = app.calMonth;
  const thisMonth = today.slice(0, 7);
  const { lead, days: list } = monthLog(state, month, today);
  const past = list.filter((d) => !d.future);
  const logged = past.filter((d) => d.meals);
  const avg = logged.length ? Math.round(logged.reduce((t, d) => t + d.kcal, 0) / logged.length) : 0;
  const target = state.settings.kcalTarget;
  const [y, m] = month.split("-").map(Number);
  const title = new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "long", ...(y !== new Date().getFullYear() ? { year: "numeric" } : {}) });
  // Logged days are shaded by how close calories came to the target.
  const tone = (d) => {
    if (!d.meals) return "";
    const r = d.kcal / target;
    return r > 1.1 ? "over" : r >= 0.85 ? "on" : "under";
  };
  return `
    <div class="card-head"><h2>${esc(title)}</h2><button type="button" class="cal-toggle open" id="calToggle" aria-expanded="true">${GRID_ICON}Week</button></div>
    <div class="cal-nav">
      <button type="button" class="cal-arrow" id="calPrev" aria-label="Previous month">‹</button>
      <span class="sub">${logged.length} of ${past.length || list.length} days logged</span>
      <button type="button" class="cal-arrow" id="calNext" aria-label="Next month" ${month >= thisMonth ? "disabled" : ""}>›</button>
    </div>
    <div class="cal-grid">
      ${DAY_LETTERS.map((l) => `<span class="wl">${l}</span>`).join("")}
      ${"<span></span>".repeat(lead)}
      ${list.map((d, i) => `
        <div class="cday ${d.meals ? "done" : ""} ${tone(d)} ${d.date === today ? "today" : ""} ${d.future ? "future" : ""}" style="--i:${i}" ${d.meals ? `aria-label="${d.day}: ${d.meals} ${d.meals === 1 ? "meal" : "meals"}, ${Math.round(d.kcal)} kcal"` : ""}>
          <span>${d.day}</span>
        </div>`).join("")}
    </div>
    ${progress(logged.length, past.length || 1, "good")}
    <div class="cal-legend"><span><i class="on"></i>Near target</span><span><i class="under"></i>Under</span><span><i class="over"></i>Over</span></div>
    <p class="hint streak-line">${logged.length ? `Averaged <strong>${avg.toLocaleString()} kcal</strong> on logged days. Target ${target.toLocaleString()}.` : month === thisMonth ? "Log a meal to start filling in this month." : "Nothing logged this month."}${month === thisMonth && days ? ` <strong>${days}-day streak.</strong>` : ""}</p>`;
}

// Re-draws only this card, easing its height between the old and new size.
function swapProgressCard(app, today, cls) {
  const card = $("#weekCard");
  if (!card) return;
  const from = card.offsetHeight;
  card.innerHTML = progressCard(app, today);
  hookProgressCard(app, today);
  card.classList.remove("cal-in", "cal-out", "cal-prev", "cal-next");
  if (reducedMotion()) return;
  const to = card.offsetHeight;
  void card.offsetWidth;
  card.classList.add(cls);
  card.animate([{ height: `${from}px` }, { height: `${to}px` }], { duration: 380, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" });
}

function hookProgressCard(app, today) {
  $("#calToggle")?.addEventListener("click", () => {
    haptic.tap();
    const opening = !app.calMonth;
    app.calMonth = opening ? today.slice(0, 7) : null;
    swapProgressCard(app, today, opening ? "cal-in" : "cal-out");
  });
  $("#calPrev")?.addEventListener("click", () => {
    app.calMonth = shiftMonth(app.calMonth, -1);
    swapProgressCard(app, today, "cal-prev");
  });
  $("#calNext")?.addEventListener("click", () => {
    app.calMonth = shiftMonth(app.calMonth, 1);
    swapProgressCard(app, today, "cal-next");
  });
}
