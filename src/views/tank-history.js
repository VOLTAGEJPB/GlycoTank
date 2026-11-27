// Tank screen tabs: Tank (the main dashboard, drawn by tank.js), Nutrition
// (calories and macros), Steps and Weight, each over a week, month or 3 months.
import { localDate, lastNDays, dayTotals } from "../model.js";
import { $, $$, round } from "../ui.js";

let tab = "tank";
let range = 7;

const TABS = [
  ["tank", "Tank"],
  ["nutrition", "Nutrition"],
  ["steps", "Steps"],
  ["weight", "Weight"],
];

const fmt = (n) => Math.round(n).toLocaleString();
const dayLetter = (d) => new Date(d + "T12:00").toLocaleDateString(undefined, { weekday: "narrow" });
const shortDate = (d) => new Date(d + "T12:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });

// ---------- Data ----------
function metrics(state, days) {
  const s = state.settings;
  const health = state.meta.healthDays || {};
  const totals = days.map((d) => dayTotals(state, d));
  const weights = (state.profile?.measurements || []).filter((m) => m.weight).sort((a, b) => (a.date < b.date ? -1 : 1));
  return {
    days,
    kcal: totals.map((t) => (t.meals.length ? t.kcal : null)),
    carbs: totals.map((t) => (t.meals.length ? t.carbs : null)),
    protein: totals.map((t) => (t.meals.length ? t.protein : null)),
    fat: totals.map((t) => (t.meals.length ? t.fat : null)),
    steps: days.map((d) => health[d]?.steps ?? null),
    weights,
    targets: { kcal: s.kcalTarget, protein: s.proteinTarget },
    units: s.units || "lb",
  };
}

const logged = (vals) => vals.filter((v) => v != null && v > 0);
const avg = (vals) => {
  const v = logged(vals);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
};

// ---------- Charts ----------
// Pill-shaped bars that fill from the bottom. `stack` draws several colored
// parts per bar (macros). A dashed line marks the goal when given.
function bars(days, values, { max, goal, color = "var(--accent)", stack, tall, tap, unit = "" } = {}) {
  const tag = tap ? "button" : "span";
  const top = Math.max(max || 0, goal || 0, ...values.map((v) => (Array.isArray(v) ? v.reduce((a, b) => a + b, 0) : v || 0)), 1) * 1.08;
  const few = days.length <= 10;
  const every = few ? 1 : days.length <= 31 ? 7 : 14;
  const label = (d, i) => (few ? dayLetter(d) : (days.length - 1 - i) % every === 0 ? shortDate(d) : "");
  return `<div class="hb ${tall ? "tall" : ""} ${few ? "few" : "many"}" style="--n:${days.length}">
    ${goal ? `<div class="hb-goal" style="--g:${goal / top}"></div>` : ""}
    <div class="hb-cols">${days
      .map((d, i) => {
        const v = values[i];
        const parts = stack
          ? (v || []).map((x, k) => `<i style="height:${(x / top) * 100}%;background:${stack[k]}"></i>`).join("")
          : v
            ? `<i style="height:${(v / top) * 100}%;background:${color}"></i>`
            : "";
        const total = stack ? (v || []).reduce((a, b) => a + b, 0) : v;
        return `<${tag} ${tap ? 'type="button"' : ""} class="hb-col" data-day="${d}" data-val="${total ? Math.round(total) : ""}" data-unit="${unit}" aria-label="${shortDate(d)}: ${total ? fmt(total) : "nothing logged"}"><span class="hb-track">${parts}</span><em>${label(d, i)}</em></${tag}>`;
      })
      .join("")}</div></div>`;
}

// Weight: a line through the weigh-ins in the range.
function line(points, units) {
  if (points.length < 2) return "";
  const w = 300, h = 110, pad = 8;
  const xs = points.map((p) => new Date(p.date + "T12:00").getTime());
  const ys = points.map((p) => +p.weight);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  const [y0, y1] = [Math.min(...ys) - 1, Math.max(...ys) + 1];
  const px = (x) => pad + ((w - pad * 2) * (x - x0)) / (x1 - x0 || 1);
  const py = (y) => h - pad - ((h - pad * 2) * (y - y0)) / (y1 - y0 || 1);
  const d = points.map((p, i) => `${i ? "L" : "M"}${px(xs[i]).toFixed(1)} ${py(ys[i]).toFixed(1)}`).join(" ");
  return `<svg class="wline" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-label="Weight trend in ${units}">
    <path d="${d} L${px(xs.at(-1)).toFixed(1)} ${h} L${px(xs[0]).toFixed(1)} ${h} Z" class="wline-fill"/>
    <path d="${d}" class="wline-stroke" vector-effect="non-scaling-stroke"/>
    ${points.map((p, i) => `<circle cx="${px(xs[i]).toFixed(1)}" cy="${py(ys[i]).toFixed(1)}" r="3.2" vector-effect="non-scaling-stroke"/>`).join("")}
  </svg>`;
}

// ---------- Panes ----------
const MACRO_COLORS = ["var(--carbs)", "var(--protein)", "var(--fat)"];

function weightSummary(m, days) {
  const w = m.weights;
  if (!w.length) return null;
  const inRange = w.filter((x) => x.date >= days[0]);
  const first = (inRange.length ? inRange : w)[0];
  const last = w.at(-1);
  return { first, last, change: last.weight - first.weight, inRange };
}

const rangePick = () =>
  `<div class="range-pick" role="radiogroup" aria-label="Range">${[7, 30, 90]
    .map((r) => `<button type="button" role="radio" data-range="${r}" aria-checked="${r === range}">${r === 7 ? "Week" : r === 30 ? "Month" : "3 months"}</button>`)
    .join("")}</div>`;
const summary = (items) => `<div class="hsum">${items.map(([l, v]) => `<div><span class="label">${l}</span><strong>${v}</strong></div>`).join("")}</div>`;
const tip = `<p class="hint hb-tip">Tap a bar to see that day.</p>`;
function listOf(days, vals, unit) {
  const rows = days.map((day, i) => [day, vals[i]]).filter(([, v]) => v != null && v > 0).reverse().slice(0, 7);
  return rows.length
    ? `<ul class="hday-list">${rows.map(([day, v]) => `<li><span>${shortDate(day)}</span><strong>${fmt(v)}${unit}</strong></li>`).join("")}</ul>`
    : `<p class="hint">Nothing logged in this range yet.</p>`;
}

function pane(m, key) {
  const d = m.days;
  if (key === "nutrition") {
    const hit = logged(m.kcal).filter((v) => Math.abs(v - m.targets.kcal) <= m.targets.kcal * 0.1).length;
    const a = ["carbs", "protein", "fat"].map((k) => avg(m[k]));
    return `
      <section class="card hdetail"><h2>Calories</h2>
        ${summary([["Average", `${fmt(avg(m.kcal))} kcal`], ["Goal", `${fmt(m.targets.kcal)} kcal`], ["Near goal", `${hit} of ${logged(m.kcal).length} days`]])}
        ${bars(d, m.kcal, { goal: m.targets.kcal, tall: true, tap: true, unit: " kcal" })}${tip}
      </section>
      <section class="card hdetail"><h2>Macros</h2>
        ${summary([["Carbs", `${fmt(a[0])} g`], ["Protein", `${fmt(a[1])} g`], ["Fat", `${fmt(a[2])} g`]])}
        ${bars(d, d.map((_, i) => (m.carbs[i] == null ? null : [m.carbs[i], m.protein[i], m.fat[i]])), { stack: MACRO_COLORS, tall: true, tap: true, unit: " g" })}
        <div class="macro-avgs legend">${["Carbs", "Protein", "Fat"].map((l, i) => `<span><i style="background:${MACRO_COLORS[i]}"></i>${l}</span>`).join("")}</div>${tip}
        <p class="hint">Daily averages on days you logged food. Protein goal: ${fmt(m.targets.protein)} g.</p>
      </section>`;
  }
  if (key === "steps") {
    if (!logged(m.steps).length)
      return `<section class="card hdetail"><h2>Steps</h2><p class="hint">No steps yet. Connect Apple Health to see your daily steps here.</p>
        <button type="button" class="btn primary wide" data-go="more" data-section="health">Connect</button></section>`;
    return `<section class="card hdetail"><h2>Steps</h2>
      ${summary([["Average", fmt(avg(m.steps))], ["Best day", fmt(Math.max(0, ...logged(m.steps)))], ["Days", String(logged(m.steps).length)]])}
      ${bars(d, m.steps, { color: "var(--water)", tall: true, tap: true, unit: " steps" })}${tip}
      ${listOf(d, m.steps, " steps")}
    </section>`;
  }
  // weight
  const ws = weightSummary(m, d);
  const body = ws
    ? summary([["Start", `${round(ws.first.weight, 1)} ${m.units}`], ["Current", `${round(ws.last.weight, 1)} ${m.units}`], ["Change", `${ws.change > 0 ? "+" : ws.change < 0 ? "−" : ""}${round(Math.abs(ws.change), 1)} ${m.units}`]]) +
      (ws.inRange.length > 1 ? `<div class="wline-wrap">${line(ws.inRange, m.units)}</div>` : `<p class="hint">Log a few weigh-ins in this range to see a trend.</p>`) +
      `<ul class="hday-list">${[...ws.inRange].reverse().slice(0, 7).map((x) => `<li><span>${shortDate(x.date)}</span><strong>${round(x.weight, 1)} ${m.units}</strong></li>`).join("")}</ul>`
    : `<p class="hint">Log your weight to see your trend here.</p>`;
  return `<section class="card hdetail"><h2>Weight</h2>${body}
    <button type="button" class="btn primary wide" data-go="more" data-section="body">Log my weight</button></section>`;
}

// ---------- Render ----------
export const currentTankTab = () => tab;

// The Tank | Nutrition | Steps | Weight switcher at the top of the Tank screen.
// `onChange` re-renders the screen after the tab or range changes.
export function tankTabs(host, onChange) {
  const i = TABS.findIndex(([k]) => k === tab);
  host.innerHTML = `<div class="htabs" role="tablist" aria-label="Tank sections" style="--i:${i}">
      <span class="htabs-ink" aria-hidden="true"></span>
      ${TABS.map(([k, l]) => `<button type="button" role="tab" data-htab="${k}" aria-selected="${k === tab}">${l}</button>`).join("")}
    </div>`;
  const ink = $(".htabs-ink", host);
  const active = $(`[aria-selected="true"]`, host);
  requestAnimationFrame(() => {
    if (!ink || !active) return;
    ink.style.width = `${active.offsetWidth}px`;
    ink.style.transform = `translateX(${active.offsetLeft}px)`;
  });
  $$("[data-htab]", host).forEach((b) =>
    b.addEventListener("click", () => {
      if (tab === b.dataset.htab) return;
      tab = b.dataset.htab;
      onChange();
    }),
  );
}

// Nutrition, Steps or Weight, over a week, a month or 3 months.
export function renderTankPane(host, app, onChange) {
  const m = metrics(app.state, lastNDays(localDate(), range));
  host.innerHTML = rangePick() + pane(m, tab);
  $$("[data-range]", host).forEach((b) =>
    b.addEventListener("click", () => {
      range = +b.dataset.range;
      onChange();
    }),
  );
  $$(".hb-col", host).forEach((b) =>
    b.addEventListener("click", () => {
      const card = b.closest(".card");
      $$(".hb-col.on", card).forEach((x) => x.classList.remove("on"));
      b.classList.add("on");
      const t = $(".hb-tip", card);
      if (t) t.textContent = `${shortDate(b.dataset.day)}: ${b.dataset.val ? fmt(+b.dataset.val) + b.dataset.unit : "nothing logged"}`;
    }),
  );
}
