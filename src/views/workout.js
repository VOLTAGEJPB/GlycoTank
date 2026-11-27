// Log > Workout: date and type at the top, routines and recent workouts one
// tap away, exercises with a row per set, and a rest timer you set once.
import { Capacitor } from "@capacitor/core";
import { localDate, plateMath } from "../model.js";
import { uid } from "../store.js";
import { $, $$, esc, num, toast, success, confirmDialog } from "../ui.js";
import { haptic } from "../motion.js";
import { shareWorkout } from "../social.js";
import { shareToggle, shareIf } from "./share-ui.js";

const EXERCISES = {
  Chest: ["Bench Press", "Incline Dumbbell Press", "Push-up", "Cable Fly", "Dip"],
  Back: ["Deadlift", "Pull-up", "Barbell Row", "Lat Pulldown", "Seated Cable Row"],
  Legs: ["Back Squat", "Front Squat", "Leg Press", "Romanian Deadlift", "Lunge", "Leg Curl", "Leg Extension", "Calf Raise"],
  Shoulders: ["Overhead Press", "Lateral Raise", "Rear Delt Fly", "Face Pull"],
  Arms: ["Barbell Curl", "Hammer Curl", "Triceps Pushdown", "Skull Crusher"],
  Core: ["Plank", "Hanging Leg Raise", "Cable Crunch", "Ab Wheel"],
};
export const ALL_EXERCISES = Object.values(EXERCISES).flat();
const TYPES = [["strength", "🏋️", "Strength"], ["cardio", "🏃", "Cardio"], ["sport", "⚽", "Sport"], ["other", "✨", "Other"]];
const INTENSITY = ["Very easy", "Easy", "Moderate", "Hard", "Very hard"];
const REST_NOTE_ID = 9100;

// The form survives re-renders (switching to Meal and back, a sync).
let form = null;
// Rest timer: one at a time across the app.
const rest = { end: 0, interval: null };

const fmtDate = (d) => {
  const today = localDate(), yest = localDate(new Date(Date.now() - 864e5));
  return d === today ? "Today" : d === yest ? "Yesterday" : new Date(d + "T12:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
};
const clock = (t) => `${Math.floor(t / 60)}:${String(Math.max(0, t) % 60).padStart(2, "0")}`;
const setsOf = (w) =>
  w.setList?.length ? w.setList.map((x) => ({ reps: x.reps || "", weight: x.weight || "", done: true })) : Array.from({ length: Math.max(1, +w.sets || 1) }, () => ({ reps: w.reps || "", weight: w.weight || "", done: true }));

function blankForm(date) {
  return { date: date || localDate(), type: "strength", name: "", exercises: [{ name: "", sets: [{ reps: "", weight: "", done: false }] }], cardio: { name: "", mins: 30, intensity: 3 }, other: { name: "", mins: "" }, notes: "" };
}
function formFromWorkout(w) {
  const f = blankForm(w.date);
  f.type = w.type;
  f.notes = w.notes || "";
  if (w.type === "strength") f.exercises = [{ name: w.name, sets: setsOf(w) }];
  else if (w.type === "cardio") f.cardio = { name: w.name, mins: w.mins ?? 30, intensity: w.intensity ?? 3 };
  else f.other = { name: w.name, mins: w.mins ?? "" };
  return f;
}
const fromRoutine = (r, date) => ({ ...blankForm(date), name: r.name, exercises: r.exercises.map((e) => ({ name: e.name, sets: Array.from({ length: Math.max(1, +e.sets || 1) }, () => ({ reps: e.reps || "", weight: e.weight || "", done: false })) })) });

// The most recent time this exercise was logged, as a short line.
function lastTime(state, name, skipId) {
  const key = name.trim().toLowerCase();
  if (!key) return "";
  const prev = state.workouts.filter((w) => w.type === "strength" && w.id !== skipId && (w.name || "").toLowerCase() === key).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  if (!prev) return "";
  const u = state.settings.units;
  const sets = prev.setList?.length ? prev.setList.map((x) => `${x.reps || "?"}${x.weight ? `×${x.weight}` : ""}`).join(", ") : `${prev.sets || "?"}×${prev.reps || "?"}${prev.weight ? ` @ ${prev.weight}` : ""}`;
  return `Last time (${fmtDate(prev.date)}): ${sets}${prev.weight || prev.setList?.some((x) => x.weight) ? ` ${u}` : ""}`;
}

// Favorites, routines and recent workouts, newest first.
function quickWorkouts(state) {
  const out = state.workoutFavs.map((f, i) => ({ fav: true, i, label: f.type === "routine" ? f.name : f.name, sub: f.type === "routine" ? `${f.exercises.length} exercises` : f.type, item: f }));
  const seen = new Set(out.map((q) => q.label.toLowerCase()));
  for (const w of [...state.workouts].sort((a, b) => (a.date < b.date ? 1 : -1))) {
    if (out.length >= 15) break;
    const label = w.sessionName || w.name;
    if (!label || seen.has(label.toLowerCase())) continue;
    seen.add(label.toLowerCase());
    if (w.sessionId) {
      const ex = state.workouts.filter((x) => x.sessionId === w.sessionId);
      out.push({ label, sub: `${ex.length} exercises`, item: { type: "routine", name: label, exercises: ex.map((x) => ({ name: x.name, sets: x.sets, reps: x.reps, weight: x.weight })) } });
    } else out.push({ label, sub: w.type, item: w });
  }
  return out;
}

export function renderWorkout(root, app) {
  const { state } = app;
  const s = state.settings;
  const units = s.units;
  const editing = app.editing ? state.workouts.find((x) => x.id === app.editing.id) : null;

  if (editing) form = formFromWorkout(editing);
  else if (app.startRoutine != null && state.workoutFavs[app.startRoutine]?.type === "routine") form = fromRoutine(state.workoutFavs[app.startRoutine]);
  else if (app.newRoutine) form = { ...blankForm(), name: "" };
  else if (!form || form.saved) form = blankForm();
  const naming = app.newRoutine;
  app.startRoutine = null;
  app.newRoutine = false;
  const f = form;

  const draw = () => {
    const quick = editing ? [] : quickWorkouts(state);
    root.innerHTML = `
    <section class="card add-card wk">
      <div class="add-top">
        <h2>${editing ? "Edit workout" : "Log workout"}</h2>
        <div class="add-when"><label class="pill-select date"><span>${esc(fmtDate(f.date))}</span><input id="wDate" type="date" aria-label="Date" value="${esc(f.date)}"></label></div>
      </div>
      <div class="wk-types" role="radiogroup" aria-label="Type">${TYPES.map(([k, icon, label]) => `<button type="button" role="radio" data-type="${k}" aria-checked="${f.type === k}"><span>${icon}</span>${label}</button>`).join("")}</div>
      ${quick.length ? `<div class="section-head"><span class="label">Routines &amp; recent</span></div>
        <div class="quick-list">${quick.map((q, i) => `<button type="button" class="quick-row" data-quick="${i}"><span class="star${q.fav ? " on" : ""}" aria-hidden="true">${q.fav ? "★" : "↺"}</span><span class="q-name">${esc(q.label)}</span><span class="q-kcal">${esc(q.sub)}</span></button>`).join("")}</div>` : ""}
    </section>

    <section class="card wk-main">
      ${f.type === "strength" ? strengthHtml() : f.type === "cardio" ? cardioHtml() : otherHtml()}
      <details class="manual"${f.notes ? " open" : ""}><summary><span>Notes</span></summary>
        <label class="field"><input id="wNotes" placeholder="How did it feel?" value="${esc(f.notes)}"></label></details>
      ${shareToggle("wShare", !editing)}
      <div class="actions">
        <button class="btn primary wide" id="wSave">${editing ? "Update workout" : "Save workout"}</button>
        ${editing ? `<button class="btn danger" id="wDelete">Delete</button>` : `<button class="btn ghost" id="wFavSave">★ ${f.type === "strength" && (f.exercises.length > 1 || f.name) ? "Save as routine" : "Save as favorite"}</button>`}
      </div>
    </section>

    ${f.type === "strength" ? restHtml() : ""}
    ${f.type === "strength" ? `<button type="button" class="rest-float" id="restFloat" hidden aria-label="Rest timer, tap to show"><b>⏱</b><span></span></button>` : ""}
    ${f.type === "strength" ? `<section class="card"><details class="manual"><summary><span>Plate math</span></summary>
      <div class="row2">
        <label class="field"><span>Target (${units})</span><input id="pmTarget" type="number" inputmode="decimal" min="0"></label>
        <label class="field"><span>Bar (${units})</span><input id="pmBar" type="number" inputmode="decimal" min="0" value="${units === "kg" ? 20 : 45}"></label>
      </div><p class="kpi-sm" id="pmOut">Enter a target weight.</p></details></section>` : ""}`;
    wire();
  };

  const strengthHtml = () => `
    ${f.exercises.length > 1 || f.name || naming ? `<label class="field"><span>Workout name</span><input id="wName" placeholder="e.g. Push day, Legs" value="${esc(f.name)}"></label>` : ""}
    ${f.exercises.map((ex, i) => `
      <div class="wk-ex" data-ex="${i}">
        <div class="wk-ex-head"><input class="wk-ex-name" list="exerciseList" placeholder="Exercise, e.g. Bench Press" value="${esc(ex.name)}" autocomplete="off" aria-label="Exercise">
          ${f.exercises.length > 1 ? `<button type="button" class="icon-btn" data-rm-ex aria-label="Remove exercise">✕</button>` : ""}</div>
        <p class="wk-last">${esc(lastTime(state, ex.name, editing?.id))}</p>
        <div class="wk-sets">
          <div class="wk-set head"><span>Set</span><span>Reps</span><span>${units}</span><span></span></div>
          ${ex.sets.map((st, j) => `<div class="wk-set" data-set="${j}"><span class="n">${j + 1}</span>
            <input type="number" inputmode="numeric" min="0" placeholder="0" value="${esc(st.reps)}" data-f="reps" aria-label="Reps">
            <input type="number" inputmode="decimal" min="0" step="0.5" placeholder="0" value="${esc(st.weight)}" data-f="weight" aria-label="Weight">
            <button type="button" class="wk-done" aria-pressed="${!!st.done}" aria-label="Set done">✓</button></div>`).join("")}
        </div>
        <div class="wk-ex-actions"><button type="button" class="link-btn" data-add-set>+ Add set</button>${ex.sets.length > 1 ? `<button type="button" class="link-btn muted" data-rm-set>Remove last set</button>` : ""}</div>
      </div>`).join("")}
    ${editing ? "" : `<button type="button" class="btn wide" id="wAddEx">+ Add exercise</button>`}`;

  const cardioHtml = () => `
    <label class="field"><span>Activity</span><input id="wcName" list="cardioList" placeholder="e.g. Run, Bike, Rower" value="${esc(f.cardio.name)}"></label>
    <datalist id="cardioList">${["Run", "Walk", "Bike", "Rower", "Elliptical", "Stair climber", "Swim", "Hike"].map((x) => `<option value="${x}">`).join("")}</datalist>
    <label class="field"><span>Minutes</span><div class="wk-stepper"><button type="button" data-mins="-5">−5</button><input id="wcMins" type="number" inputmode="numeric" min="1" value="${esc(f.cardio.mins)}"><button type="button" data-mins="5">+5</button></div></label>
    <div class="field"><span>Intensity</span><div class="wk-int">${INTENSITY.map((l, i) => `<button type="button" data-int="${i + 1}" aria-pressed="${+f.cardio.intensity === i + 1}"><b>${i + 1}</b>${l}</button>`).join("")}</div></div>`;

  const otherHtml = () => `
    <label class="field"><span>Activity</span><input id="woName" placeholder="${f.type === "sport" ? "e.g. Basketball, Soccer" : "e.g. Yoga, Climbing"}" value="${esc(f.other.name)}"></label>
    <label class="field"><span>Minutes (optional)</span><input id="woMins" type="number" inputmode="numeric" min="0" value="${esc(f.other.mins)}"></label>`;

  const restHtml = () => {
    const secs = s.restSecs || 90;
    return `<section class="card wk-rest">
      <div class="card-head"><h2>Rest timer</h2><label class="wk-auto"><input type="checkbox" id="restAuto" ${s.restAuto !== false ? "checked" : ""}> Start when a set is done</label></div>
      <div class="wk-clock"><button type="button" class="wk-adj" data-adj="-15" aria-label="15 seconds less">−15</button>
        <div class="wk-ring" id="restRing" style="--p:0"><span id="restClock">${clock(secs)}</span><small id="restSub">Countdown ${clock(secs)}</small></div>
        <button type="button" class="wk-adj" data-adj="15" aria-label="15 seconds more">+15</button></div>
      <div class="wk-presets">${[60, 90, 120, 180].map((x) => `<button type="button" data-preset="${x}" aria-pressed="${x === secs}">${x < 120 ? `${x}s` : `${x / 60} min`}</button>`).join("")}</div>
      <div class="actions"><button class="btn primary wide" id="restGo">Start rest</button><button class="btn ghost" id="restStop">Reset</button></div>
    </section>`;
  };

  // ---------- Rest timer ----------
  const restSecs = () => s.restSecs || 90;
  const paintRest = () => {
    const left = rest.end ? Math.ceil((rest.end - Date.now()) / 1000) : restSecs();
    if ($("#restClock")) $("#restClock").textContent = clock(Math.max(0, left));
    $("#restRing")?.style.setProperty("--p", rest.end ? 1 - Math.max(0, left) / restSecs() : 0);
    if ($("#restGo")) $("#restGo").textContent = rest.end ? "Restart" : "Start rest";
    // A small floating countdown while resting, so it's visible next to your sets.
    const fl = $("#restFloat");
    if (fl) {
      fl.hidden = !rest.end || left <= 0;
      $("span", fl).textContent = clock(Math.max(0, left));
    }
    if (rest.end && left <= 0) finishRest();
  };
  const finishRest = () => {
    clearInterval(rest.interval);
    rest.end = 0;
    haptic.success?.();
    navigator.vibrate?.([200, 100, 200]);
    toast("Rest over. Next set!");
    paintRest();
  };
  const notify = async (on) => {
    if (!Capacitor.isNativePlatform()) return;
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    await LocalNotifications.cancel({ notifications: [{ id: REST_NOTE_ID }] }).catch(() => {});
    if (!on) return;
    if ((await LocalNotifications.checkPermissions()).display !== "granted") return;
    await LocalNotifications.schedule({ notifications: [{ id: REST_NOTE_ID, title: "Rest over", body: "Time for your next set.", schedule: { at: new Date(rest.end) } }] }).catch(() => {});
  };
  // Always restarts from the saved countdown.
  const startRest = () => {
    clearInterval(rest.interval);
    rest.end = Date.now() + restSecs() * 1000;
    rest.interval = setInterval(() => ($("#restClock") ? paintRest() : clearInterval(rest.interval)), 250);
    notify(true);
    paintRest();
  };
  const stopRest = () => {
    clearInterval(rest.interval);
    rest.end = 0;
    notify(false);
    paintRest();
  };
  const setRest = (secs) => {
    s.restSecs = Math.max(15, Math.min(600, secs));
    app.save();
    $$("[data-preset]", root).forEach((b) => b.setAttribute("aria-pressed", +b.dataset.preset === s.restSecs));
    if ($("#restSub")) $("#restSub").textContent = `Countdown ${clock(s.restSecs)}`;
    if (rest.end) startRest();
    else paintRest();
  };

  // ---------- Wiring ----------
  const wire = () => {
    $("#wDate").addEventListener("change", (e) => {
      f.date = e.target.value || localDate();
      e.target.previousElementSibling.textContent = fmtDate(f.date);
    });
    $$("[data-type]", root).forEach((b) => b.addEventListener("click", () => ((f.type = b.dataset.type), draw())));
    $$("[data-quick]", root).forEach((b) =>
      b.addEventListener("click", () => {
        const it = quickWorkouts(state)[+b.dataset.quick].item;
        if (it.type === "routine") Object.assign(f, fromRoutine(it, f.date));
        else if (it.type === "strength") {
          const one = { name: it.name, sets: setsOf(it).map((x) => ({ ...x, done: false })) };
          const empty = f.exercises.length === 1 && !f.exercises[0].name;
          f.type = "strength";
          f.exercises = empty ? [one] : [...f.exercises, one];
        } else if (it.type === "cardio") Object.assign(f, { type: "cardio", cardio: { name: it.name, mins: it.mins ?? 30, intensity: it.intensity ?? 3 } });
        else Object.assign(f, { type: it.type, other: { name: it.name, mins: it.mins ?? "" } });
        draw();
        $(".wk-main")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }),
    );
    $("#wName")?.addEventListener("input", (e) => (f.name = e.target.value));
    $("#wNotes")?.addEventListener("input", (e) => (f.notes = e.target.value));
    // Strength
    $$(".wk-ex", root).forEach((el) => {
      const ex = f.exercises[+el.dataset.ex];
      $(".wk-ex-name", el).addEventListener("input", (e) => (ex.name = e.target.value));
      $(".wk-ex-name", el).addEventListener("change", () => ($(".wk-last", el).textContent = lastTime(state, ex.name, editing?.id)));
      $$(".wk-set[data-set]", el).forEach((row) => {
        const st = ex.sets[+row.dataset.set];
        $$("input", row).forEach((inp) => inp.addEventListener("input", () => (st[inp.dataset.f] = inp.value)));
        $(".wk-done", row).addEventListener("click", (e) => {
          st.done = !st.done;
          e.currentTarget.setAttribute("aria-pressed", st.done);
          haptic.tap?.();
          if (st.done && s.restAuto !== false && $("#restGo")) startRest();
        });
      });
      $("[data-add-set]", el).addEventListener("click", () => {
        const prev = ex.sets.at(-1) || {};
        ex.sets.push({ reps: prev.reps ?? "", weight: prev.weight ?? "", done: false });
        draw();
      });
      $("[data-rm-set]", el)?.addEventListener("click", () => (ex.sets.pop(), draw()));
      $("[data-rm-ex]", el)?.addEventListener("click", () => (f.exercises.splice(+el.dataset.ex, 1), draw()));
    });
    $("#wAddEx")?.addEventListener("click", () => {
      f.exercises.push({ name: "", sets: [{ reps: "", weight: "", done: false }] });
      draw();
      $$(".wk-ex-name", root).at(-1)?.focus();
    });
    // Cardio / other
    $("#wcName")?.addEventListener("input", (e) => (f.cardio.name = e.target.value));
    $("#wcMins")?.addEventListener("input", (e) => (f.cardio.mins = e.target.value));
    $$("[data-mins]", root).forEach((b) =>
      b.addEventListener("click", () => {
        f.cardio.mins = Math.max(1, (+f.cardio.mins || 0) + +b.dataset.mins);
        $("#wcMins").value = f.cardio.mins;
      }),
    );
    $$("[data-int]", root).forEach((b) =>
      b.addEventListener("click", () => {
        f.cardio.intensity = +b.dataset.int;
        $$("[data-int]", root).forEach((x) => x.setAttribute("aria-pressed", x === b));
      }),
    );
    $("#woName")?.addEventListener("input", (e) => (f.other.name = e.target.value));
    $("#woMins")?.addEventListener("input", (e) => (f.other.mins = e.target.value));
    // Rest timer
    $$("[data-adj]", root).forEach((b) => b.addEventListener("click", () => setRest(restSecs() + +b.dataset.adj)));
    $$("[data-preset]", root).forEach((b) => b.addEventListener("click", () => setRest(+b.dataset.preset)));
    $("#restGo")?.addEventListener("click", startRest);
    $("#restStop")?.addEventListener("click", stopRest);
    $("#restFloat")?.addEventListener("click", () => $(".wk-rest")?.scrollIntoView({ behavior: "smooth", block: "center" }));
    $("#restAuto")?.addEventListener("change", (e) => {
      s.restAuto = e.target.checked;
      app.save();
    });
    if ($("#restClock")) {
      paintRest();
      if (rest.end) rest.interval = (clearInterval(rest.interval), setInterval(() => ($("#restClock") ? paintRest() : clearInterval(rest.interval)), 250));
    }
    // Plate math
    const plates = () => {
      const target = num($("#pmTarget")), bar = num($("#pmBar"));
      if (!target) return ($("#pmOut").textContent = "Enter a target weight.");
      if (target <= bar) return ($("#pmOut").textContent = "Just the bar.");
      const r = plateMath(target, bar, units);
      $("#pmOut").textContent = `Each side: ${r.plates.join(" + ") || "—"} ${units}${r.remainder ? ` (${r.remainder} ${units} short)` : ""}`;
    };
    ["pmTarget", "pmBar"].forEach((id) => $("#" + id)?.addEventListener("input", plates));
    // Save / favorite / delete
    $("#wSave").addEventListener("click", save);
    $("#wFavSave")?.addEventListener("click", saveFav);
    $("#wDelete")?.addEventListener("click", async () => {
      if (!(await confirmDialog("Delete this workout?"))) return;
      state.workouts = state.workouts.filter((x) => x.id !== editing.id);
      app.editing = null;
      app.save();
      toast("Workout deleted");
      app.go("tank");
    });
  };

  // One saved record per exercise; the per-set detail is kept in setList.
  const strengthRecords = () =>
    f.exercises
      .map((ex) => {
        const sets = ex.sets.filter((x) => +x.reps || +x.weight);
        if (!ex.name.trim() && !sets.length) return null;
        const list = sets.map((x) => ({ reps: +x.reps || 0, weight: +x.weight || 0 }));
        const top = list.reduce((a, b) => (b.weight > a.weight ? b : a), list[0] || { reps: 0, weight: 0 });
        return { type: "strength", name: ex.name.trim() || "Strength", sets: list.length || ex.sets.length, reps: top.reps || undefined, weight: top.weight || undefined, setList: list.length ? list : undefined };
      })
      .filter(Boolean);

  const one = () => {
    if (f.type === "cardio") return { type: "cardio", name: f.cardio.name.trim() || "Cardio", mins: +f.cardio.mins || 0, intensity: +f.cardio.intensity || 3 };
    return { type: f.type, name: f.other.name.trim() || (f.type === "sport" ? "Sport" : "Other"), mins: +f.other.mins || undefined };
  };

  function save() {
    const date = f.date || localDate();
    const notes = (f.notes || "").trim() || undefined;
    if (f.type === "strength") {
      const recs = strengthRecords();
      if (!recs.length) return toast("Add an exercise and at least one set");
      if (editing) {
        for (const k of ["sets", "reps", "weight", "mins", "intensity", "setList"]) delete editing[k];
        Object.assign(editing, recs[0], { date, notes });
      } else {
        const session = recs.length > 1 || f.name.trim();
        const sessionId = session ? uid() : undefined;
        const sessionName = session ? f.name.trim() || "Workout" : undefined;
        for (const r of recs) state.workouts.push({ id: uid(), date, ...r, notes, sessionId, sessionName });
        shareIf("wShare", () => shareWorkout(recs, units, sessionName));
      }
    } else {
      const data = { ...one(), date, notes };
      if (editing) {
        for (const k of ["sets", "reps", "weight", "mins", "intensity", "setList"]) delete editing[k];
        Object.assign(editing, data);
      } else {
        state.workouts.push({ id: uid(), ...data });
        shareIf("wShare", () => shareWorkout([data], units));
      }
    }
    app.editing = null;
    app.save();
    form.saved = true;
    stopRest();
    success(editing ? "Workout updated" : "Workout saved");
    app.go("tank");
  }

  function saveFav() {
    if (f.type === "strength") {
      const recs = strengthRecords();
      if (!recs.length) return toast("Add at least one exercise");
      if (recs.length === 1 && !f.name.trim()) {
        const fav = { ...recs[0] };
        delete fav.setList;
        state.workoutFavs = state.workoutFavs.filter((x) => x.name !== fav.name);
        state.workoutFavs.push(fav);
        app.save();
        return toast(`Saved "${fav.name}" to favorites`);
      }
      const routine = { type: "routine", name: f.name.trim() || "Routine", exercises: recs.map((r) => ({ name: r.name, sets: r.sets, reps: r.reps, weight: r.weight })) };
      state.workoutFavs = state.workoutFavs.filter((x) => x.name !== routine.name);
      state.workoutFavs.push(routine);
      app.save();
      return toast(`Saved routine "${routine.name}"`);
    }
    const fav = one();
    state.workoutFavs = state.workoutFavs.filter((x) => x.name !== fav.name);
    state.workoutFavs.push(fav);
    app.save();
    toast(`Saved "${fav.name}" to favorites`);
  }

  draw();
}
