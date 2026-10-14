import {
  localDate, addDays, dayTotals, glycoSeries, glycoStatus, carbPlan, plannedCost, readinessFor, latestCheck,
  streak, lastNDays, workoutCost, parseMealText, mealNameFromText,
} from "../model.js";
import { uid } from "../store.js";
import { $, $$, esc, round, num, progress, select, success } from "../ui.js";
import { native } from "../scan.js";
import { animate, countUp } from "../motion.js";
import { workoutLine, mealLine } from "./entries.js";

let chartDays = 14;

export function renderToday(root, app) {
  const { state } = app;
  const s = state.settings;
  const today = localDate();
  const series = glycoSeries(state, today);
  const level = series[today].end;
  const status = glycoStatus(level, s.glycoCap);
  const totals = dayTotals(state, today);
  const workouts = state.workouts.filter((w) => w.date === today);
  const tomorrow = addDays(today, 1);
  const tomorrowWorkouts = state.workouts.filter((w) => w.date === tomorrow);
  const ready = readinessFor(state, latestCheck(state));
  const week = lastNDays(today, 7);
  const weekWorkouts = state.workouts.filter((w) => week.includes(w.date)).length;
  const weekProtein = state.meals.filter((m) => week.includes(m.date)).reduce((t, m) => t + (+m.protein || 0), 0);
  const plannedFromLog = tomorrowWorkouts.reduce((t, w) => t + workoutCost(w, s), 0);
  const quick = quickMeals(state);
  const kcalLeft = s.kcalTarget - totals.kcal;

  root.innerHTML = `
    ${state.meta.personalized ? "" : `<button class="banner" data-go="settings" data-section="personalize">Using default targets. <strong>Personalize them →</strong></button>`}

    <section class="card meal-first">
      <div class="card-head"><h2>Log a meal</h2><span class="sub" id="kcalLeft">${kcalLeft >= 0 ? `${round(kcalLeft)} kcal left` : `${round(-kcalLeft)} kcal over`}</span></div>
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
      <div class="stats mt">
        <div><div class="label">Calories</div><div class="kpi">${round(totals.kcal)}</div><div class="sub">of ${s.kcalTarget}</div></div>
        <div><div class="label">Protein</div><div class="kpi">${round(totals.protein)}<small>g</small></div><div class="sub">of ${s.proteinTarget} g</div></div>
        <div><div class="label">Carbs</div><div class="kpi">${round(totals.carbs)}<small>g</small></div><div class="sub">guide ${s.carbGuide} g</div></div>
        <div><div class="label">Fiber</div><div class="kpi">${round(totals.fiber)}<small>g</small></div><div class="sub">of ${s.fiberTarget} g</div></div>
      </div>
      <div class="label mt">Protein</div>${progress(totals.protein, s.proteinTarget, "good")}
    </section>

    <section class="card">
      <div class="card-head"><h2>Today's meals</h2><button class="btn small" data-go="log" data-section="meal">+ Add</button></div>
      ${totals.meals.length ? `<ul class="entries">${totals.meals.map(mealLine).join("")}</ul>` : `<p class="hint">No meals logged yet.</p>`}
    </section>

    <section class="card tank ${status.tone}">
      <div class="tank-head">
        <div>
          <div class="label">Glycogen tank</div>
          <div class="kpi" id="tankGrams">${round(level)} g <small>/ ${s.glycoCap} g</small></div>
          <div class="hint">${esc(status.label)}</div>
        </div>
        <div class="gauge" id="gauge" style="--pct:0"><span id="gaugePct">0%</span></div>
      </div>
      <div class="chart-head">
        <span class="label">Trend</span>
        ${select("chartDays", "", [[7, "7 days"], [14, "14 days"], [30, "30 days"]], chartDays)}
      </div>
      <canvas id="chart" height="150" aria-label="Glycogen trend chart"></canvas>
      <div id="chartTip" class="chart-tip">Tap the chart to see a day's value.</div>
    </section>

    <section class="card">
      <h2>Plan tomorrow's carbs</h2>
      <p class="hint">Enter tomorrow's training. We'll suggest how many carbs to eat today so your tank stays near 75% full through tomorrow.${plannedFromLog ? " Workouts you've already logged for tomorrow are included." : ""}</p>
      <div class="row3">
        <label class="field"><span>Hard sets</span><input id="planSets" type="number" inputmode="numeric" min="0" placeholder="0"></label>
        <label class="field"><span>Cardio min</span><input id="planMins" type="number" inputmode="numeric" min="0" placeholder="0"></label>
        ${select("planInt", "Intensity", [[1, "Very easy"], [2, "Easy"], [3, "Moderate"], [4, "Hard"], [5, "Very hard"]], 3)}
      </div>
      <div class="plan-out"><span class="label">Eat this much more today</span><span class="kpi" id="planOut">—</span></div>
      <p class="hint" id="planNote" hidden>Your tank is low. Refilling it fully will take a couple of days, so this is capped at 1.5× your daily carb guide.</p>
    </section>

    <section class="card two">
      <div><div class="label">Readiness</div><div class="kpi">${ready ? ready.score : "–"}</div><div class="sub">${ready ? esc(ready.label) : `<a href="#" data-go="checkin">Do a check-in</a>`}</div></div>
      <div><div class="label">Streak</div><div class="kpi">${streak(state, today)}</div><div class="sub">days logged</div></div>
      <div><div class="label">Workouts (7d)</div><div class="kpi">${weekWorkouts}</div></div>
      <div><div class="label">Protein (7d)</div><div class="kpi">${round(weekProtein)}<small>g</small></div></div>
    </section>

    <section class="card">
      <div class="card-head"><h2>Today's training</h2><button class="btn small" data-go="log" data-section="workout">+ Add</button></div>
      ${workouts.length ? `<ul class="entries">${workouts.map((w) => workoutLine(w, s)).join("")}</ul>` : `<p class="hint">No training logged yet.</p>`}
    </section>

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

  const updatePlan = () => {
    const cost = plannedFromLog + plannedCost({ sets: num($("#planSets")), mins: num($("#planMins")), intensity: num($("#planInt")) }, s);
    const plan = carbPlan(level, cost, s);
    $("#planOut").textContent = plan.grams ? `${round(plan.grams)} g carbs` : "You're set";
    $("#planNote").hidden = !plan.capped;
  };
  ["planSets", "planMins", "planInt"].forEach((id) => $("#" + id).addEventListener("input", updatePlan));
  updatePlan();

  $("#chartDays").addEventListener("change", (e) => {
    chartDays = +e.target.value;
    animate(700, (p) => drawChart(series, today, s.glycoCap, p));
  });

  // Gauge fills, numbers count up and the trend line draws in. While the launch
  // animation is still on screen, wait for it so these play when visible.
  const reveal = () => {
    requestAnimationFrame(() => $("#gauge")?.style.setProperty("--pct", round(status.pct)));
    countUp($("#tankGrams"), level, 1000, (v) => `${Math.round(v)} g `);
    countUp($("#gaugePct"), status.pct, 1000, (v) => `${Math.round(v)}%`);
    animate(900, (p) => drawChart(series, today, s.glycoCap, p));
  };
  drawChart(series, today, s.glycoCap, 0);
  if (app.launching) app.revealToday = reveal;
  else reveal();
}

function addMeal(app, meal) {
  app.state.meals.push({ id: uid(), date: localDate(), notes: "", ...meal });
  app.save();
  success(`Added ${meal.name}`);
  app.go("today");
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

// Draws the trend; `progress` (0..1) reveals the line from left to right.
function drawChart(series, today, cap, progress = 1) {
  const canvas = $("#chart");
  if (!canvas) return;
  const days = lastNDays(today, chartDays);
  const values = days.map((d) => series[d]?.end ?? null);
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = 150;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  const css = getComputedStyle(document.documentElement);
  const accent = css.getPropertyValue("--accent").trim();
  const grid = css.getPropertyValue("--line").trim();
  const pad = 10;
  const x = (i) => pad + ((w - pad * 2) * i) / (days.length - 1);
  const y = (v) => h - pad - ((h - pad * 2) * v) / cap;

  ctx.strokeStyle = grid;
  ctx.lineWidth = 1;
  for (const f of [0.25, 0.5, 0.75, 1]) {
    ctx.beginPath();
    ctx.moveTo(pad, y(cap * f));
    ctx.lineTo(w - pad, y(cap * f));
    ctx.stroke();
  }
  const pts = values.map((v, i) => (v == null ? null : [x(i), y(v)])).filter(Boolean);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, progress >= 1 ? w : pad + (w - pad * 2) * progress + 2, h);
  ctx.clip();
  if (pts.length === 1 && progress > 0) {
    // Only one day so far: show it as a dot until there's a trend to draw.
    ctx.beginPath();
    ctx.arc(pts[0][0], pts[0][1], 5, 0, Math.PI * 2);
    ctx.fillStyle = accent;
    ctx.fill();
    const tip = $("#chartTip");
    if (tip && !tip.dataset.touched) tip.textContent = "Your trend line appears after a couple of days of logging.";
  } else if (pts.length && progress > 0) {
    const grad = ctx.createLinearGradient(0, pad, 0, h - pad);
    grad.addColorStop(0, accent + "55");
    grad.addColorStop(1, accent + "05");
    ctx.beginPath();
    pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
    ctx.lineTo(pts[pts.length - 1][0], h - pad);
    ctx.lineTo(pts[0][0], h - pad);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.beginPath();
    pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = "round";
    ctx.stroke();
  }
  ctx.restore();

  canvas.onpointerdown = canvas.onpointermove = (e) => {
    $("#chartTip").dataset.touched = "1";
    if (e.type === "pointermove" && e.buttons === 0 && e.pointerType !== "mouse") return;
    const rect = canvas.getBoundingClientRect();
    const i = Math.round(((e.clientX - rect.left - pad) / (rect.width - pad * 2)) * (days.length - 1));
    const d = days[Math.max(0, Math.min(days.length - 1, i))];
    const v = series[d];
    const [yy, mm, dd] = d.split("-").map(Number);
    const label = new Date(yy, mm - 1, dd).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    $("#chartTip").textContent = v ? `${label}: ${round(v.end)} g (+${round(v.added)} meals, −${round(v.training)} training, −${round(v.cost - v.training)} everyday)` : `${label}: no data`;
  };
}
