// Liquid intake on the Meals home: a daily goal, one-tap water buttons, and
// other drinks. Amounts are stored in ml; people on pounds see fluid ounces.
// Drinks live in profile.drinks (like measurements) so they sync with the
// existing profile record.
import { localDate, addDays } from "../model.js";
import { $, $$, esc, round, num, progress, success, toast } from "../ui.js";

const ML_PER_OZ = 29.5735;
const KEEP_DAYS = 120;
export const DRINK_TYPES = ["Water", "Coffee", "Tea", "Milk", "Juice", "Soda", "Sports drink", "Protein shake", "Other"];

const metric = (s) => s.units === "kg";
const unit = (s) => (metric(s) ? "ml" : "oz");
const toUnit = (ml, s) => (metric(s) ? round(ml) : round(ml / ML_PER_OZ));
const toMl = (v, s) => (metric(s) ? v : v * ML_PER_OZ);
export const drinkGoalMl = (s) => s.drinkTarget || (metric(s) ? 2000 : 64 * ML_PER_OZ);

export function drinksOn(state, date) {
  return (state.profile?.drinks || []).filter((d) => d.date === date);
}

const timeOf = (at) => (at ? new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "");

export function drinksCard(app) {
  const s = app.state.settings;
  const today = localDate();
  const list = drinksOn(app.state, today);
  const total = list.reduce((t, d) => t + (+d.ml || 0), 0);
  const goal = drinkGoalMl(s);
  const quick = metric(s) ? [250, 500] : [8, 16];
  return `
    <section class="card drinks" id="drinksCard">
      <div class="card-head"><h2>Water &amp; drinks</h2><button class="sub link-btn" id="drinkGoalEdit">${toUnit(total, s)} / ${toUnit(goal, s)} ${unit(s)}</button></div>
      ${progress(total, goal, "m-water")}
      <div class="drink-goal" id="drinkGoalForm" hidden>
        <label class="field"><span>Daily goal (${unit(s)})</span><input id="drinkGoal" type="number" inputmode="numeric" min="1" value="${toUnit(goal, s)}"></label>
        <button class="btn small primary" id="drinkGoalSave">Save goal</button>
      </div>
      <div class="drink-quick">
        ${quick.map((q) => `<button class="btn drink-btn" data-water="${q}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.7s-6 6.6-6 11.1a6 6 0 0 0 12 0C18 9.3 12 2.7 12 2.7z"/></svg>+${q} ${unit(s)}</button>`).join("")}
        <button class="btn drink-btn ghost" id="drinkOther">+ Other</button>
      </div>
      <div class="drink-form" id="drinkForm" hidden>
        <label class="field"><span>Drink</span><select id="drinkType">${DRINK_TYPES.map((t) => `<option>${t}</option>`).join("")}</select></label>
        <label class="field"><span>Amount (${unit(s)})</span><input id="drinkAmt" type="number" inputmode="decimal" min="0" step="any" placeholder="${quick[0]}"></label>
        <button class="btn primary" id="drinkAdd">Add</button>
      </div>
      ${list.length ? `<ul class="entries drink-list">${[...list].reverse().map((d) => `
        <li><div class="entry static">
          <span class="entry-main"><strong>${esc(d.type)}</strong><span class="entry-kcal">${toUnit(d.ml, s)} ${unit(s)}<button class="drink-del" data-drink-del="${esc(d.id)}" aria-label="Remove ${esc(d.type)}">✕</button></span></span>
          <span class="entry-sub">${esc(timeOf(d.at))}</span>
        </div></li>`).join("")}</ul>` : `<p class="hint">Tap a button each time you finish a drink.</p>`}
    </section>`;
}

export function hookDrinks(app) {
  const card = $("#drinksCard");
  if (!card) return;
  const s = app.state.settings;
  const redraw = () => {
    card.outerHTML = drinksCard(app);
    hookDrinks(app);
  };
  const add = (type, amount) => {
    if (!(amount > 0)) return toast("Enter an amount");
    const now = Date.now();
    const today = localDate();
    const cutoff = addDays(today, -KEEP_DAYS);
    const drinks = (app.state.profile?.drinks || []).filter((d) => d.date >= cutoff);
    drinks.push({ id: `d${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`, date: today, at: now, type, ml: round(toMl(amount, s)) });
    app.state.profile = { ...app.state.profile, drinks };
    app.save();
    success(`${type} added`);
    redraw();
  };

  $$("[data-water]", card).forEach((b) => b.addEventListener("click", () => add("Water", +b.dataset.water)));
  $("#drinkOther").addEventListener("click", () => {
    const f = $("#drinkForm");
    f.hidden = !f.hidden;
    if (!f.hidden) $("#drinkAmt").focus();
  });
  $("#drinkAdd").addEventListener("click", () => add($("#drinkType").value, num($("#drinkAmt"))));
  $("#drinkGoalEdit").addEventListener("click", () => {
    const f = $("#drinkGoalForm");
    f.hidden = !f.hidden;
  });
  $("#drinkGoalSave").addEventListener("click", () => {
    const v = num($("#drinkGoal"));
    if (!(v > 0)) return toast("Enter a goal");
    s.drinkTarget = round(toMl(v, s));
    app.save();
    success("Goal saved");
    redraw();
  });
  $$("[data-drink-del]", card).forEach((b) =>
    b.addEventListener("click", () => {
      app.state.profile = { ...app.state.profile, drinks: (app.state.profile?.drinks || []).filter((d) => d.id !== b.dataset.drinkDel) };
      app.save();
      redraw();
    }),
  );
}
