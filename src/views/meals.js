import { localDate, dayTotals, parseMealText, mealNameFromText } from "../model.js";
import { uid } from "../store.js";
import { $, $$, esc, round, progress, success } from "../ui.js";
import { native } from "../scan.js";
import { mealLine } from "./entries.js";

// The home screen: everything here is about logging what you ate today.
export function renderMeals(root, app) {
  const { state } = app;
  const s = state.settings;
  const totals = dayTotals(state, localDate());
  const quick = quickMeals(state);
  const kcalLeft = s.kcalTarget - totals.kcal;
  const pct = Math.min(100, (totals.kcal / s.kcalTarget) * 100 || 0);

  root.innerHTML = `
    <section class="card meal-first">
      <div class="meal-hero">
        <div class="ring ${kcalLeft < 0 ? "over" : ""}" style="--pct:${round(pct)}">
          <div><div class="kpi" id="kcalLeft">${round(Math.abs(kcalLeft))}</div><div class="sub">${kcalLeft >= 0 ? "kcal left" : "kcal over"}</div></div>
        </div>
        <div class="macros">
          <div><div class="label">Protein <span>${round(totals.protein)} / ${s.proteinTarget} g</span></div>${progress(totals.protein, s.proteinTarget, "good")}</div>
          <div><div class="label">Carbs <span>${round(totals.carbs)} / ${s.carbGuide} g</span></div>${progress(totals.carbs, s.carbGuide)}</div>
          <div><div class="label">Fiber <span>${round(totals.fiber)} / ${s.fiberTarget} g</span></div>${progress(totals.fiber, s.fiberTarget)}</div>
        </div>
      </div>
      <h2 class="mt">What did you eat?</h2>
      <form id="quickMeal" class="quick-add">
        <input id="qmText" placeholder="e.g. Oats 300 cal 54c 10p" autocomplete="off" enterkeyhint="done" aria-label="Quick add a meal">
        <button class="btn primary">Add</button>
      </form>
      <div class="scan-row">
        <button class="btn scan-btn" data-scan="barcode"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h2v14H3V5zm3 0h1v14H6V5zm2 0h2v14H8V5zm3 0h1v14h-1V5zm3 0h2v14h-2V5zm3 0h1v14h-1V5zm2 0h2v14h-2V5z"/></svg>${native ? "Scan barcode" : "Look up barcode"}</button>
        ${native ? `<button class="btn scan-btn" data-scan="label"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h6v2H6v4H4V4zm10 0h6v6h-2V6h-4V4zM4 14h2v4h4v2H4v-6zm14 0h2v6h-6v-2h4v-4zM8 9h8v2H8V9zm0 4h6v2H8v-2z"/></svg>Scan label</button>` : ""}
      </div>
      ${quick.length ? `<div class="label mt">Tap to add again</div>
      <div class="chips">${quick.map((q, i) => `<button class="chip" data-quick="${i}">${q.fav ? "★ " : ""}${esc(q.name)}<small>${round(q.kcal)} kcal</small></button>`).join("")}</div>` : ""}
      <button class="btn ghost wide mt" data-go="log" data-section="meal">Enter a meal in detail</button>
    </section>

    <section class="card">
      <div class="card-head"><h2>Today's meals</h2><span class="sub">${round(totals.kcal)} of ${s.kcalTarget} kcal</span></div>
      ${totals.meals.length ? `<ul class="entries">${totals.meals.map(mealLine).join("")}</ul>` : `<p class="hint">Nothing logged yet today. Type a meal above, scan it, or tap one you've had before.</p>`}
    </section>

    ${state.meta.personalized ? "" : `<button class="banner" data-go="settings" data-section="personalize">Using default targets. <strong>Personalize them →</strong></button>`}
  `;

  // Quick add: "Chicken bowl 650 cal 70c 45p" saves right away. Text with no
  // numbers opens the full form with the name filled in.
  $("#quickMeal").addEventListener("submit", (e) => {
    e.preventDefault();
    const text = $("#qmText").value.trim();
    const vals = parseMealText(text);
    const name = mealNameFromText(text);
    if (![vals.kcal, vals.carbs, vals.protein, vals.fat].some((v) => v != null)) {
      app.editing = null;
      app.prefill = name ? { name } : null;
      return app.go("log", "meal");
    }
    for (const k in vals) vals[k] ??= 0;
    if (!vals.kcal) vals.kcal = Math.round(vals.carbs * 4 + vals.protein * 4 + vals.fat * 9);
    addMeal(app, { name: name || "Meal", ...vals });
  });
  $$("[data-quick]", root).forEach((b) =>
    b.addEventListener("click", () => {
      const { name, kcal, carbs, protein, fat, fiber } = quick[b.dataset.quick];
      addMeal(app, { name, kcal, carbs, protein, fat, fiber });
    }),
  );
  // The scan buttons open the meal form and start the scan from the same tap.
  $$("[data-scan]", root).forEach((b) =>
    b.addEventListener("click", () => {
      app.editing = null;
      app.autoScan = b.dataset.scan;
      app.go("log", "meal");
    }),
  );
}

function addMeal(app, meal) {
  app.state.meals.push({ id: uid(), date: localDate(), notes: "", ...meal });
  app.save();
  success(`Added ${meal.name}`);
  app.go("meals");
}

// Favorites first, then the most recent other meals, by name, up to six.
function quickMeals(state) {
  const out = state.mealFavs.map((f) => ({ ...f, fav: true }));
  const seen = new Set(out.map((q) => q.name.toLowerCase()));
  for (const m of [...state.meals].reverse()) {
    if (out.length >= 6) break;
    const key = (m.name || "").toLowerCase();
    if (!key || key === "meal" || seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out.slice(0, 6);
}
