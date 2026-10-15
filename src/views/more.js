import { localDate, upsertMeasurement, streak } from "../model.js";
import { $, $$, esc, round, num, field, toast, success, confirmDialog, prettyDate } from "../ui.js";
import * as auth from "../auth.js";
import { renderSettings } from "./settings.js";
import { renderHistory } from "./history.js";
import { workoutDetail } from "./entries.js";

const icon = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
const ICONS = {
  profile: "M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z",
  goals: "M14.4 6L14 4H5v17h2v-7h5.6l.4 2h7V6z",
  body: "M12 3a9 9 0 0 0-9 9h2a7 7 0 0 1 14 0h2a9 9 0 0 0-9-9zm1 9.3V7h-2v5.3a2 2 0 1 0 2 0zM4 15h16v6H4z",
  routines: "M20.57 14.86L22 13.43 20.57 12 17 15.57 8.43 7 12 3.43 10.57 2 9.14 3.43 7.71 2 5.57 4.14 4.14 2.71 2.71 4.14l1.43 1.43L2 7.71l1.43 1.43L2 10.57 3.43 12 7 8.43 15.57 17 12 20.57 13.43 22l1.43-1.43L16.29 22l2.14-2.14 1.43 1.43 1.43-1.43-1.43-1.43L22 16.29z",
  history: "M13 3a9 9 0 1 1-8.5 12h2.1A7 7 0 1 0 6 9.5L8.5 12H3V6.5l1.6 1.6A9 9 0 0 1 13 3zm-1 5h2v4.6l3.2 1.9-1 1.7L12 13.7V8z",
  reminders: "M12 22c1.1 0 2-.9 2-2h-4c0 1.1.89 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z",
  data: "M19.35 10.04A7.49 7.49 0 0 0 12 4C9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 0 0 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z",
  about: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z",
};

const GROUPS = [
  ["You", [
    ["profile", "Profile", "Your account, details and units"],
    ["goals", "Goals", "Calorie, protein, carb and fiber targets"],
    ["body", "Weight & measurements", "Track your weight, waist and more"],
  ]],
  ["Training", [
    ["routines", "Workout routines", "Saved sessions you can start in one tap"],
    ["history", "History", "Past days of meals and training"],
  ]],
  ["App", [
    ["reminders", "Reminders", "Daily check-in and logging reminders"],
    ["data", "Your data", "Back up, export or restore"],
    ["about", "About & help", "Version, intro and data sources"],
  ]],
];
const TITLES = Object.fromEntries(GROUPS.flatMap(([, rows]) => rows.map(([k, t]) => [k, t])));
export const MORE_SECTIONS = Object.keys(TITLES);

export function renderMore(root, app) {
  const section = app.moreSection;
  if (!section || !TITLES[section]) {
    root.innerHTML = GROUPS.map(([label, rows]) => `
      <div class="label more-label">${label}</div>
      <section class="card more-list">
        ${rows.map(([k, title, sub]) => `
        <button class="more-row" data-go="more" data-section="${k}">
          <span class="more-icon">${icon(ICONS[k])}</span>
          <span class="more-text"><strong>${title}</strong><span>${sub}</span></span>
          <span class="chev" aria-hidden="true">›</span>
        </button>`).join("")}
      </section>`).join("");
    return;
  }
  $("#title").textContent = TITLES[section];
  root.innerHTML = `<button class="back-link" data-go="more" data-section="">‹ More</button><div id="moreBody"></div>`;
  const body = $("#moreBody");
  if (section === "history") return renderHistory(body, app);
  if (section === "body") return renderBody(body, app);
  if (section === "routines") return renderRoutines(body, app);
  if (section === "profile") {
    body.innerHTML = `${profileCard(app)}<div id="settingsBody"></div>`;
    hookProfile(app);
    return renderSettings($("#settingsBody"), app, "profile");
  }
  renderSettings(body, app, section);
}

// ---------- Profile ----------
function profileCard(app) {
  const { state } = app;
  const p = state.profile || {};
  const s = state.settings;
  const session = auth.current();
  const days = new Set(state.meals.map((m) => m.date)).size;
  const height = p.heightUnits === "cm" ? (p.heightCm ? `${p.heightCm} cm` : "") : p.heightFt ? `${p.heightFt}′${p.heightIn || 0}″` : "";
  const details = [p.age && `${p.age} years`, p.sex === "f" ? "Female" : p.sex === "m" ? "Male" : "", height, p.weight && `${round(p.weight, 1)} ${s.units}`].filter(Boolean);
  return `
    <section class="card profile-card">
      <div class="avatar" aria-hidden="true">${esc((p.name || session?.email || "?").trim()[0]?.toUpperCase() || "?")}</div>
      <div class="profile-main">
        <label class="field"><span>Name</span><input id="prName" value="${esc(p.name || "")}" placeholder="Your name" autocomplete="name"></label>
        ${session ? `<p class="hint">${esc(session.email)}</p>` : ""}
      </div>
      <div class="stats three">
        <div><div class="label">Days logged</div><div class="kpi">${days}</div></div>
        <div><div class="label">Streak</div><div class="kpi">${streak(state, localDate())}</div></div>
        <div><div class="label">Workouts</div><div class="kpi">${state.workouts.length}</div></div>
      </div>
      <p class="hint">${details.length ? esc(details.join(" · ")) : "Add your age, height and weight in Goals."} <a href="#" data-go="more" data-section="goals">Edit in Goals</a></p>
    </section>`;
}

function hookProfile(app) {
  $("#prName").addEventListener("change", (e) => {
    app.state.profile = { ...app.state.profile, name: e.target.value.trim() };
    app.save();
    toast("Saved");
    app.go("more", "profile");
  });
}

// ---------- Weight & measurements ----------
const PARTS = [
  ["waist", "Waist"],
  ["chest", "Chest"],
  ["hips", "Hips"],
  ["arms", "Arms"],
];

function renderBody(root, app) {
  const { state } = app;
  const s = state.settings;
  const len = s.units === "kg" ? "cm" : "in";
  const list = state.profile?.measurements || [];
  const latest = list.at(-1);
  const withWeight = list.filter((x) => x.weight);
  const first = withWeight[0];
  const last = withWeight.at(-1);
  const change = first && last && first !== last ? last.weight - first.weight : null;
  const today = localDate();
  const todays = list.find((x) => x.date === today) || {};

  root.innerHTML = `
    <section class="card">
      <h2>Weight</h2>
      <div class="two">
        <div><div class="label">Current</div><div class="kpi">${last ? round(last.weight, 1) : "–"}<small>${s.units}</small></div><div class="sub">${last ? esc(prettyDate(last.date, today)) : "Not logged yet"}</div></div>
        <div><div class="label">Change</div><div class="kpi">${change == null ? "–" : `${change > 0 ? "+" : ""}${round(change, 1)}`}<small>${change == null ? "" : s.units}</small></div><div class="sub">${first && change != null ? `since ${esc(prettyDate(first.date, today))}` : "Log twice to see your trend"}</div></div>
      </div>
      ${withWeight.length > 1 ? `<canvas id="wChart" height="120" aria-label="Weight trend"></canvas>` : ""}
    </section>

    <section class="card">
      <h2>Log today</h2>
      <div class="row2">
        ${field("bDate", "Date", 'type="date"', today)}
        ${field("bWeight", `Weight (${s.units})`, 'type="number" inputmode="decimal" min="0" step="0.1"', todays.weight ?? "")}
      </div>
      <div class="row2">
        ${field("bFat", "Body fat %", 'type="number" inputmode="decimal" min="0" max="80" step="0.1"', todays.bodyFat ?? "")}
        ${PARTS.map(([k, label]) => field("b_" + k, `${label} (${len})`, 'type="number" inputmode="decimal" min="0" step="0.1"', todays[k] ?? "")).join("")}
      </div>
      <div class="actions"><button class="btn primary" id="bSave">Save</button></div>
    </section>

    <section class="card">
      <h2>Entries</h2>
      ${list.length ? `<ul class="entries">${[...list].reverse().map((x) => `
        <li><div class="entry static">
          <span class="entry-main"><strong>${esc(prettyDate(x.date, today))}</strong>${x.weight ? `<span class="entry-kcal">${round(x.weight, 1)} ${s.units}</span>` : ""}</span>
          <span class="entry-sub">${esc([x.bodyFat && `${round(x.bodyFat, 1)}% fat`, ...PARTS.map(([k, l]) => x[k] && `${l} ${round(x[k], 1)} ${len}`)].filter(Boolean).join(" · ") || "Weight only")}
            <a href="#" data-del="${esc(x.date)}">Delete</a></span>
        </div></li>`).join("")}</ul>` : `<p class="hint">Your weigh-ins and measurements will appear here.</p>`}
    </section>`;

  $("#bSave").addEventListener("click", () => {
    const entry = { date: $("#bDate").value || today, weight: num($("#bWeight")) || null, bodyFat: num($("#bFat")) || null };
    for (const [k] of PARTS) entry[k] = num($("#b_" + k)) || null;
    if (!entry.weight && !entry.bodyFat && PARTS.every(([k]) => !entry[k])) return toast("Enter at least one measurement");
    const measurements = upsertMeasurement(state.profile?.measurements, entry);
    const newest = measurements.filter((x) => x.weight).at(-1);
    // The newest weigh-in also keeps Goals' body weight current.
    state.profile = { ...state.profile, measurements, ...(newest ? { weight: newest.weight, weightUnits: s.units } : {}) };
    app.save();
    success("Measurements saved");
    renderBody(root, app);
  });
  $$("[data-del]", root).forEach((a) =>
    a.addEventListener("click", async (e) => {
      e.preventDefault();
      if (!(await confirmDialog("Delete this entry?"))) return;
      state.profile = { ...state.profile, measurements: list.filter((x) => x.date !== a.dataset.del) };
      app.save();
      renderBody(root, app);
    }),
  );
  if (withWeight.length > 1) drawWeight($("#wChart"), withWeight.slice(-30));
}

function drawWeight(canvas, points) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = 120, pad = 10;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
  const vals = points.map((p) => +p.weight);
  const lo = Math.min(...vals) - 1, hi = Math.max(...vals) + 1;
  const x = (i) => pad + ((w - pad * 2) * i) / (points.length - 1);
  const y = (v) => h - pad - ((h - pad * 2) * (v - lo)) / (hi - lo);
  ctx.beginPath();
  vals.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))));
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2.5;
  ctx.lineJoin = "round";
  ctx.stroke();
  ctx.fillStyle = accent;
  vals.forEach((v, i) => {
    ctx.beginPath();
    ctx.arc(x(i), y(v), 3, 0, Math.PI * 2);
    ctx.fill();
  });
}

// ---------- Workout routines ----------
function renderRoutines(root, app) {
  const { state } = app;
  const s = state.settings;
  const favs = state.workoutFavs.map((f, i) => ({ ...f, i }));
  const routines = favs.filter((f) => f.type === "routine");
  const singles = favs.filter((f) => f.type !== "routine");

  root.innerHTML = `
    <section class="card">
      <div class="card-head"><h2>Routines</h2><button class="btn small" id="newRoutine">+ New</button></div>
      ${routines.length ? `<ul class="entries">${routines.map((r) => `
        <li><div class="entry static">
          <span class="entry-main"><strong>${esc(r.name)}</strong><span class="tag">${r.exercises.length} exercise${r.exercises.length === 1 ? "" : "s"}</span></span>
          <span class="entry-sub">${esc(r.exercises.map((e) => e.name).join(", "))}</span>
          <span class="entry-actions"><button class="btn small primary" data-start="${r.i}">Start</button><button class="btn small ghost" data-remove="${r.i}">Delete</button></span>
        </div></li>`).join("")}</ul>`
      : `<p class="hint">A routine is a session you repeat, like "Upper A" or "Leg day". Tap <strong>+ New</strong>, add the exercises, then tap <strong>Save as routine</strong>.</p>`}
    </section>
    ${singles.length ? `
    <section class="card">
      <h2>Favorite exercises</h2>
      <ul class="entries">${singles.map((f) => `
        <li><div class="entry static">
          <span class="entry-main"><strong>${esc(f.name)}</strong></span>
          <span class="entry-sub">${esc(workoutDetail(f, s))}</span>
          <span class="entry-actions"><button class="btn small ghost" data-remove="${f.i}">Delete</button></span>
        </div></li>`).join("")}</ul>
    </section>` : ""}`;

  $("#newRoutine").addEventListener("click", () => {
    app.editing = null;
    app.newRoutine = true;
    app.go("log", "workout");
  });
  $$("[data-start]", root).forEach((b) =>
    b.addEventListener("click", () => {
      app.editing = null;
      app.startRoutine = +b.dataset.start;
      app.go("log", "workout");
    }),
  );
  $$("[data-remove]", root).forEach((b) =>
    b.addEventListener("click", async () => {
      const f = state.workoutFavs[b.dataset.remove];
      if (!(await confirmDialog(`Delete "${f.name}"?`))) return;
      state.workoutFavs = state.workoutFavs.filter((x) => x !== f);
      app.save();
      renderRoutines(root, app);
    }),
  );
}
