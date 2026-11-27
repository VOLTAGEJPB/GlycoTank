// Tank > History: an overview of the last week (calories, macros, tank,
// steps, weight, training) with a tab per category for 7/30/90-day detail.
import { localDate, lastNDays, dayTotals, glycoSeries, workoutCost } from "../model.js";
import { $, $$, esc, round } from "../ui.js";

let tab = "overview";
let range = 7;

const TABS = [
  ["overview", "Overview"],
  ["calories", "Calories"],
  ["macros", "Macros"],
  ["tank", "Tank"],
  ["steps", "Steps"],
  ["weight", "Weight"],
  ["training", "Training"],
];

const fmt = (n) => Math.round(n).toLocaleString();
const dayLetter = (d) => new Date(d + "T12:00").toLocaleDateString(undefined, { weekday: "narrow" });
const shortDate = (d) => new Date(d + "T12:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
const chevron = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

// ---------- Data ----------
function metrics(state, days) {
  const s = state.settings;
  const today = days[days.length - 1];
  const series = glycoSeries(state, today);
  const health = state.meta.healthDays || {};
  const totals = days.map((d) => dayTotals(state, d));
  const workouts = days.map((d) => state.workouts.filter((w) => w.date === d));
  const weights = (state.profile?.measurements || []).filter((m) => m.weight).sort((a, b) => (a.date < b.date ? -1 : 1));
  return {
    days,
    kcal: totals.map((t) => (t.meals.length ? t.kcal : null)),
    carbs: totals.map((t) => (t.meals.length ? t.carbs : null)),
    protein: totals.map((t) => (t.meals.length ? t.protein : null)),
    fat: totals.map((t) => (t.meals.length ? t.fat : null)),
    tank: days.map((d) => (series[d] ? series[d].end : null)),
    steps: days.map((d) => health[d]?.steps ?? null),
    sessions: workouts.map((w) => w.length),
    used: workouts.map((ws) => (ws.length ? ws.reduce((t, w) => t + workoutCost(w, s), 0) : null)),
    weights,
    targets: { kcal: s.kcalTarget, protein: s.proteinTarget, carbs: s.carbGuide, cap: s.glycoCap },
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
function bars(days, values, { max, goal, color = "var(--accent)", stack, tall, tap } = {}) {
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
        return `<${tag} ${tap ? 'type="button"' : ""} class="hb-col" data-day="${d}" data-val="${total ? Math.round(total) : ""}" aria-label="${shortDate(d)}: ${total ? fmt(total) : "nothing logged"}"><span class="hb-track">${parts}</span><em>${label(d, i)}</em></${tag}>`;
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

// ---------- Cards ----------
const MACRO_COLORS = ["var(--carbs)", "var(--protein)", "var(--fat)"];

function card(key, title, stat, chart, extra = "") {
  return `<button type="button" class="card hcard" data-htab="${key}">
    <div class="hcard-head"><h2>${title}</h2>${chevron}</div>
    <div class="hcard-body"><div class="hcard-stat">${stat}</div><div class="hcard-chart">${chart}</div></div>${extra}</button>`;
}
const stat = (label, value, sub = "") => `<div><span class="label">${label}</span><strong>${value}</strong>${sub ? `<small>${sub}</small>` : ""}</div>`;

function weightSummary(m, days) {
  const w = m.weights;
  if (!w.length) return null;
  const inRange = w.filter((x) => x.date >= days[0]);
  const first = (inRange.length ? inRange : w)[0];
  const last = w.at(-1);
  const change = last.weight - first.weight;
  return { first, last, change, inRange };
}

function weightCard(m, days) {
  const ws = weightSummary(m, days);
  if (!ws) {
    return `<button type="button" class="card hcard" data-go="more" data-section="body">
      <div class="hcard-head"><h2>Weight</h2>${chevron}</div>
      <p class="hint">Log your weight to see your trend here.</p>
      <div class="hcard-cta">Log my weight ${chevron}</div></button>`;
  }
  const arrow = ws.change < 0 ? "↘" : ws.change > 0 ? "↗" : "→";
  const stale = (Date.now() - new Date(ws.last.date + "T12:00")) / 864e5 > 7;
  return `<div class="card hcard as-div">
    <button type="button" class="hcard-head plain" data-htab="weight"><h2>Weight</h2>${chevron}</button>
    <div class="hcard-body">
      <div class="hcard-stat">
        ${stat("Start", `${round(ws.first.weight, 1)} ${m.units}`)}
        ${stat(`Current (${shortDate(ws.last.date)})`, `${round(ws.last.weight, 1)} ${m.units}`)}
        ${stat("Change", `${arrow} ${round(Math.abs(ws.change), 1)} ${m.units}`)}
      </div>
      <div class="hcard-chart">${ws.inRange.length > 1 ? line(ws.inRange, m.units) : `<p class="hint center">${stale ? "You haven't logged your weight in a while." : "Log a few weigh-ins to see a trend."}</p>`}</div>
    </div>
    <button type="button" class="hcard-cta" data-go="more" data-section="body">Log my weight ${chevron}</button>
  </div>`;
}

function overview(m) {
  const d = m.days;
  const macroAvg = ["carbs", "protein", "fat"].map((k) => avg(m[k]));
  const stepsOn = logged(m.steps).length > 0;
  return [
    card("calories", "Calories", stat("7-day avg", `${fmt(avg(m.kcal))} kcal`, `Goal ${fmt(m.targets.kcal)}`), bars(d, m.kcal, { goal: m.targets.kcal })),
    card(
      "macros",
      "Macros",
      `<div class="macro-avgs">${["Carbs", "Protein", "Fat"].map((l, i) => `<span><i style="background:${MACRO_COLORS[i]}"></i>${l} <strong>${fmt(macroAvg[i])} g</strong></span>`).join("")}</div>`,
      bars(d, d.map((_, i) => (m.carbs[i] == null ? null : [m.carbs[i], m.protein[i], m.fat[i]])), { stack: MACRO_COLORS }),
    ),
    card("tank", "Carb tank", stat("7-day avg", `${fmt(avg(m.tank))} g`, `of ${fmt(m.targets.cap)} g`), bars(d, m.tank, { max: m.targets.cap })),
    weightCard(m, d),
    stepsOn ? card("steps", "Steps", stat("7-day avg", fmt(avg(m.steps))), bars(d, m.steps, { color: "var(--water)" })) : "",
    card("training", "Training", stat("This week", `${m.sessions.reduce((a, b) => a + b, 0)} sessions`, `${fmt(logged(m.used).reduce((a, b) => a + b, 0))} g carbs used`), bars(d, m.used, { color: "var(--fat)" })),
  ].join("");
}

// One category in detail, over 7, 30 or 90 days.
function detail(m, key) {
  const d = m.days;
  const rangePick = `<div class="range-pick" role="radiogroup" aria-label="Range">${[7, 30, 90]
    .map((r) => `<button type="button" role="radio" data-range="${r}" aria-checked="${r === range}">${r === 7 ? "Week" : r === 30 ? "Month" : "3 months"}</button>`)
    .join("")}</div>`;
  const listOf = (vals, unit, fmtv = fmt) => {
    const rows = d.map((day, i) => [day, vals[i]]).filter(([, v]) => v != null && v > 0).reverse().slice(0, 14);
    return rows.length
      ? `<ul class="hday-list">${rows.map(([day, v]) => `<li><span>${shortDate(day)}</span><strong>${fmtv(v)}${unit}</strong></li>`).join("")}</ul>`
      : `<p class="hint">Nothing logged in this range yet.</p>`;
  };
  const summary = (items) => `<div class="hsum">${items.map(([l, v]) => `<div><span class="label">${l}</span><strong>${v}</strong></div>`).join("")}</div>`;
  const tip = `<p class="hint hb-tip" id="hbTip">Tap a bar to see that day.</p>`;
  let body = "";
  if (key === "calories") {
    const hit = logged(m.kcal).filter((v) => Math.abs(v - m.targets.kcal) <= m.targets.kcal * 0.1).length;
    body = summary([["Average", `${fmt(avg(m.kcal))} kcal`], ["Goal", `${fmt(m.targets.kcal)} kcal`], ["Days near goal", `${hit} of ${logged(m.kcal).length}`]]) + bars(d, m.kcal, { goal: m.targets.kcal, tall: true, tap: true }) + tip + listOf(m.kcal, " kcal");
  } else if (key === "macros") {
    const a = ["carbs", "protein", "fat"].map((k) => avg(m[k]));
    body = summary([["Carbs", `${fmt(a[0])} g`], ["Protein", `${fmt(a[1])} g`], ["Fat", `${fmt(a[2])} g`]]) +
      bars(d, d.map((_, i) => (m.carbs[i] == null ? null : [m.carbs[i], m.protein[i], m.fat[i]])), { stack: MACRO_COLORS, tall: true, tap: true }) +
      `<div class="macro-avgs legend">${["Carbs", "Protein", "Fat"].map((l, i) => `<span><i style="background:${MACRO_COLORS[i]}"></i>${l}</span>`).join("")}</div>` + tip +
      `<p class="hint">Protein goal: ${fmt(m.targets.protein)} g a day. Average: ${fmt(a[1])} g.</p>`;
  } else if (key === "tank") {
    body = summary([["Average", `${fmt(avg(m.tank))} g`], ["Lowest", `${fmt(Math.min(...logged(m.tank), Infinity) === Infinity ? 0 : Math.min(...logged(m.tank)))} g`], ["Tank size", `${fmt(m.targets.cap)} g`]]) + bars(d, m.tank, { max: m.targets.cap, tall: true, tap: true }) + tip + listOf(m.tank, " g");
  } else if (key === "steps") {
    body = summary([["Average", fmt(avg(m.steps))], ["Best day", fmt(Math.max(0, ...logged(m.steps)))], ["Days", String(logged(m.steps).length)]]) + bars(d, m.steps, { color: "var(--water)", tall: true, tap: true }) + tip +
      `<p class="hint">Apple Health keeps the last 14 days in GlycoTank.</p>` + listOf(m.steps, "");
  } else if (key === "weight") {
    const ws = weightSummary(m, d);
    body = ws
      ? summary([["Start", `${round(ws.first.weight, 1)} ${m.units}`], ["Current", `${round(ws.last.weight, 1)} ${m.units}`], ["Change", `${ws.change > 0 ? "+" : ws.change < 0 ? "−" : ""}${round(Math.abs(ws.change), 1)} ${m.units}`]]) +
        (ws.inRange.length > 1 ? `<div class="wline-wrap">${line(ws.inRange, m.units)}</div>` : `<p class="hint">Log a few weigh-ins in this range to see a trend.</p>`) +
        `<ul class="hday-list">${[...ws.inRange].reverse().slice(0, 14).map((x) => `<li><span>${shortDate(x.date)}</span><strong>${round(x.weight, 1)} ${m.units}</strong></li>`).join("")}</ul>`
      : `<p class="hint">No weigh-ins yet.</p>`;
    body += `<button type="button" class="btn primary wide" data-go="more" data-section="body">Log my weight</button>`;
  } else if (key === "training") {
    const total = m.sessions.reduce((a, b) => a + b, 0);
    body = summary([["Sessions", String(total)], ["Active days", String(m.sessions.filter(Boolean).length)], ["Carbs used", `${fmt(logged(m.used).reduce((a, b) => a + b, 0))} g`]]) +
      bars(d, m.used, { color: "var(--fat)", tall: true, tap: true }) + tip + listOf(m.used, " g used");
  }
  return `<section class="card hdetail">${rangePick}${body}</section>`;
}

// ---------- Render ----------
export function renderHistory(host, app) {
  const { state } = app;
  const today = localDate();
  const stepsOn = Object.values(state.meta.healthDays || {}).some((x) => x?.steps);
  const tabs = TABS.filter(([k]) => k !== "steps" || stepsOn);
  if (!tabs.some(([k]) => k === tab)) tab = "overview";
  const m = metrics(state, lastNDays(today, tab === "overview" ? 7 : range));
  const i = tabs.findIndex(([k]) => k === tab);
  host.innerHTML = `
    <div class="htabs-wrap"><div class="htabs" role="tablist" aria-label="History" style="--n:${tabs.length};--i:${i}">
      <span class="htabs-ink" aria-hidden="true"></span>
      ${tabs.map(([k, l]) => `<button type="button" role="tab" data-htab="${k}" aria-selected="${k === tab}">${l}</button>`).join("")}
    </div></div>
    <div class="hbody">${tab === "overview" ? overview(m) : detail(m, tab)}</div>`;

  const ink = $(".htabs-ink", host);
  const active = $(`.htabs [aria-selected="true"]`, host);
  if (ink && active) {
    ink.style.width = `${active.offsetWidth}px`;
    ink.style.transform = `translateX(${active.offsetLeft}px)`;
    active.scrollIntoView({ block: "nearest", inline: "center" });
  }

  $$("[data-htab]", host).forEach((b) =>
    b.addEventListener("click", () => {
      tab = b.dataset.htab;
      renderHistory(host, app);
      if (b.closest(".hbody")) $(".htabs-wrap", host)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }),
  );
  $$("[data-range]", host).forEach((b) =>
    b.addEventListener("click", () => {
      range = +b.dataset.range;
      renderHistory(host, app);
    }),
  );
  $$(".hdetail .hb-col", host).forEach((b) =>
    b.addEventListener("click", () => {
      $$(".hb-col.on", host).forEach((x) => x.classList.remove("on"));
      b.classList.add("on");
      const tip = $("#hbTip", host);
      if (tip) tip.textContent = `${shortDate(b.dataset.day)}: ${b.dataset.val ? fmt(+b.dataset.val) : "nothing logged"}`;
    }),
  );
}
