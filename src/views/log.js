import { localDate, plateMath, parseMealText } from "../model.js";
import { native, scanBarcode, lookupBarcode, scanLabel, ScanError } from "../scan.js";
import { uid } from "../store.js";
import { $, $$, esc, num, field, select, toast, success, confirmDialog } from "../ui.js";

const EXERCISES = {
  Chest: ["Bench Press", "Incline Dumbbell Press", "Push-up", "Cable Fly", "Dip"],
  Back: ["Deadlift", "Pull-up", "Barbell Row", "Lat Pulldown", "Seated Cable Row"],
  Legs: ["Back Squat", "Front Squat", "Leg Press", "Romanian Deadlift", "Lunge", "Leg Curl", "Leg Extension", "Calf Raise"],
  Shoulders: ["Overhead Press", "Lateral Raise", "Rear Delt Fly", "Face Pull"],
  Arms: ["Barbell Curl", "Hammer Curl", "Triceps Pushdown", "Skull Crusher"],
  Core: ["Plank", "Hanging Leg Raise", "Cable Crunch", "Ab Wheel"],
};
const ALL_EXERCISES = Object.values(EXERCISES).flat();
const INTENSITY = [[1, "1 · very easy"], [2, "2 · easy"], [3, "3 · moderate"], [4, "4 · hard"], [5, "5 · very hard"]];

let mode = "meal"; // "meal" | "workout"
let shownMode = "meal"; // where the toggle's thumb was last drawn, so it can slide
let restInterval = null;

export function openLog(app, section, editing = null) {
  mode = section || mode;
  app.editing = editing;
}

export function renderLog(root, app) {
  const editing = app.editing;
  if (editing) mode = editing.kind;
  root.innerHTML = `
    <div class="segmented" role="tablist" style="--pos:${shownMode === "workout" ? 1 : 0}">
      <button role="tab" data-mode="meal" aria-selected="${mode === "meal"}">Meal</button>
      <button role="tab" data-mode="workout" aria-selected="${mode === "workout"}">Workout</button>
    </div>
    <div id="logBody"></div>
    <datalist id="exerciseList">${ALL_EXERCISES.map((e) => `<option value="${esc(e)}">`).join("")}</datalist>`;
  requestAnimationFrame(() => $(".segmented", root)?.style.setProperty("--pos", mode === "workout" ? 1 : 0));
  shownMode = mode;
  $$("[data-mode]", root).forEach((b) =>
    b.addEventListener("click", () => {
      mode = b.dataset.mode;
      app.editing = null;
      renderLog(root, app);
    }),
  );
  if (mode === "meal") renderMeal($("#logBody"), app);
  else renderWorkout($("#logBody"), app);
}

// ---------- Meals ----------

function renderMeal(root, app) {
  const { state } = app;
  const m = app.editing ? state.meals.find((x) => x.id === app.editing.id) : null;
  const v = m || { date: localDate(), ...app.prefill };
  app.prefill = null;
  root.innerHTML = `
    <section class="card">
      <h2>${m ? "Edit meal" : "Log a meal"}</h2>
      ${m ? "" : `
      <div class="scan-row">
        <button class="btn scan-btn" id="scanBarcode"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h2v14H3V5zm3 0h1v14H6V5zm2 0h2v14H8V5zm3 0h1v14h-1V5zm3 0h2v14h-2V5zm3 0h1v14h-1V5zm2 0h2v14h-2V5z"/></svg>${native ? "Scan barcode" : "Look up barcode"}</button>
        ${native ? `<button class="btn scan-btn" id="scanLabel"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h6v2H6v4H4V4zm10 0h6v6h-2V6h-4V4zM4 14h2v4h4v2H4v-6zm14 0h2v6h-6v-2h4v-4zM8 9h8v2H8V9zm0 4h6v2H8v-2z"/></svg>Scan label</button>` : ""}
      </div>
      <div id="barcodeEntry" class="barcode-entry" ${native ? "hidden" : ""}>
        <input id="barcodeInput" inputmode="numeric" placeholder="Barcode number, e.g. 016000275287" aria-label="Barcode number">
        <button class="btn small" id="barcodeGo">Look up</button>
      </div>
      ${native ? `<p class="hint scan-alt"><a href="#" id="typeBarcode">Type a barcode</a> · <a href="#" id="pickLabel">Use a photo of a label</a></p>` : ""}
      <div id="scanResult" class="scan-result" hidden></div>`}
      ${state.mealFavs.length ? select("mFav", "From favorites", [["", "Choose a favorite…"], ...state.mealFavs.map((f, i) => [i, f.name])], "") : ""}
      <div class="row2">
        ${field("mDate", "Date", 'type="date"', v.date)}
        ${field("mName", "Meal", 'placeholder="e.g. Chicken rice bowl" autocomplete="off"', v.name)}
      </div>
      <label class="field"><span>Quick entry</span><input id="mQuick" placeholder="e.g. 650 cal 70c 45p 18f 8 fiber" autocomplete="off"></label>
      <div class="row5">
        ${field("mKcal", "Calories", 'type="number" inputmode="numeric" min="0"', v.kcal ?? "")}
        ${field("mCarbs", "Carbs g", 'type="number" inputmode="decimal" min="0"', v.carbs ?? "")}
        ${field("mProtein", "Protein g", 'type="number" inputmode="decimal" min="0"', v.protein ?? "")}
        ${field("mFat", "Fat g", 'type="number" inputmode="decimal" min="0"', v.fat ?? "")}
        ${field("mFiber", "Fiber g", 'type="number" inputmode="decimal" min="0"', v.fiber ?? "")}
      </div>
      <p class="hint" id="mEstimate"></p>
      ${field("mNotes", "Notes", 'placeholder="Optional"', v.notes)}
      <div class="actions">
        <button class="btn primary" id="mSave">${m ? "Update meal" : "Save meal"}</button>
        <button class="btn ghost" id="mFavSave">Save as favorite</button>
        ${m ? `<button class="btn danger" id="mDelete">Delete</button>` : ""}
      </div>
    </section>`;

  const ids = { kcal: "mKcal", carbs: "mCarbs", protein: "mProtein", fat: "mFat", fiber: "mFiber" };
  const estimate = () => {
    const est = num($("#mCarbs")) * 4 + num($("#mProtein")) * 4 + num($("#mFat")) * 9;
    $("#mEstimate").textContent = est && !num($("#mKcal")) ? `Calories from macros: about ${Math.round(est)}. Leave Calories blank to use this.` : "";
  };
  Object.values(ids).forEach((id) => $("#" + id).addEventListener("input", estimate));
  estimate();

  $("#mQuick").addEventListener("input", (e) => {
    const p = parseMealText(e.target.value);
    for (const [k, id] of Object.entries(ids)) if (p[k] != null) $("#" + id).value = p[k];
    estimate();
  });
  // ----- Scan to fill -----
  let scanned = null; // values for one serving, as scanned
  const fillFromScan = (servings) => {
    for (const [k, id] of Object.entries(ids)) {
      const v = scanned[k];
      $("#" + id).value = v == null ? "" : Math.round(v * servings * 10) / 10;
    }
    estimate();
  };
  const showScan = (item) => {
    scanned = item;
    if (item.name && !$("#mName").value.trim()) $("#mName").value = item.name;
    const box = $("#scanResult");
    box.hidden = false;
    box.innerHTML = `
      <div class="scan-head"><strong>${esc(item.name || "Nutrition label")}</strong>
        <span>Per ${esc(item.serving || "serving")} · from ${item.source === "Open Food Facts" ? `<a href="https://world.openfoodfacts.org/product/${esc(item.barcode)}" target="_blank" rel="noopener">Open Food Facts</a>` : "the label"}</span></div>
      <div class="servings"><span>Servings</span>
        <button class="icon-btn" data-serv="-0.5" aria-label="Fewer servings">−</button>
        <input id="servings" type="number" inputmode="decimal" min="0.25" step="0.25" value="1" aria-label="Servings">
        <button class="icon-btn" data-serv="0.5" aria-label="More servings">+</button></div>
      <p class="hint">Check the numbers below match your package.</p>`;
    const input = $("#servings");
    const apply = () => fillFromScan(Math.max(0.25, num(input) || 1));
    input.addEventListener("input", apply);
    box.querySelectorAll("[data-serv]").forEach((b) =>
      b.addEventListener("click", () => {
        input.value = Math.max(0.25, (num(input) || 1) + +b.dataset.serv);
        apply();
      }),
    );
    apply();
    box.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };
  const busy = (btn, on, label) => {
    if (!btn) return;
    btn.disabled = on;
    btn.dataset.label ??= btn.lastChild.nodeValue;
    btn.lastChild.nodeValue = on ? label : btn.dataset.label;
  };
  const report = (e) => {
    if (e instanceof ScanError) toast(e.message);
    else {
      console.error(e);
      toast("Something went wrong while scanning. Please try again.");
    }
  };
  const lookup = async (code, btn) => {
    busy(btn, true, "Looking up…");
    try {
      showScan(await lookupBarcode(code));
      success("Found it");
    } catch (e) {
      report(e);
    } finally {
      busy(btn, false);
    }
  };
  $("#scanBarcode")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    if (!native) return $("#barcodeInput").focus();
    try {
      const code = await scanBarcode(() => busy(btn, true, "Setting up scanner…"));
      busy(btn, false);
      if (code) await lookup(code, btn);
    } catch (err) {
      busy(btn, false);
      report(err);
      if (err instanceof ScanError && err.unavailable) {
        $("#barcodeEntry").hidden = false;
        // Not focused from code here: it runs after an await, outside the tap, so
        // Android would focus the field without opening the keyboard.
        $("#barcodeInput").scrollIntoView({ block: "center", behavior: "smooth" });
      }
    }
  });
  const readLabel = async (fromGallery) => {
    const btn = $("#scanLabel");
    try {
      busy(btn, true, "Reading label…");
      const item = await scanLabel(fromGallery);
      if (item) {
        showScan(item);
        success("Label read");
      }
    } catch (err) {
      report(err);
    } finally {
      busy(btn, false);
    }
  };
  $("#scanLabel")?.addEventListener("click", () => readLabel(false));
  $("#pickLabel")?.addEventListener("click", (e) => {
    e.preventDefault();
    readLabel(true);
  });
  $("#typeBarcode")?.addEventListener("click", (e) => {
    e.preventDefault();
    $("#barcodeEntry").hidden = false;
    $("#barcodeInput").focus();
  });
  $("#barcodeGo")?.addEventListener("click", (e) => lookup($("#barcodeInput").value, e.currentTarget));
  // Scan buttons on Today land here and start the scan straight away.
  if (app.autoScan) {
    $(app.autoScan === "label" ? "#scanLabel" : "#scanBarcode")?.click();
    app.autoScan = null;
  }
  $("#barcodeInput")?.addEventListener("keydown", (e) => e.key === "Enter" && lookup(e.target.value, $("#barcodeGo")));

  $("#mFav")?.addEventListener("change", (e) => {
    const f = state.mealFavs[e.target.value];
    if (!f) return;
    $("#mName").value = f.name;
    for (const [k, id] of Object.entries(ids)) $("#" + id).value = f[k] ?? "";
    estimate();
  });

  const read = () => {
    const vals = Object.fromEntries(Object.entries(ids).map(([k, id]) => [k, num($("#" + id))]));
    if (!vals.kcal) vals.kcal = Math.round(vals.carbs * 4 + vals.protein * 4 + vals.fat * 9);
    return { name: $("#mName").value.trim() || "Meal", ...vals, notes: $("#mNotes").value.trim() };
  };

  $("#mSave").addEventListener("click", () => {
    const data = { ...read(), date: $("#mDate").value || localDate() };
    if (m) Object.assign(m, data);
    else state.meals.push({ id: uid(), ...data });
    app.editing = null;
    app.save();
    success(m ? "Meal updated" : "Meal saved");
    app.go("meals");
  });
  $("#mFavSave").addEventListener("click", () => {
    const { notes, ...fav } = read();
    state.mealFavs = state.mealFavs.filter((f) => f.name !== fav.name);
    state.mealFavs.push(fav);
    app.save();
    toast(`Saved "${fav.name}" to favorites`);
    renderMeal(root, app);
  });
  $("#mDelete")?.addEventListener("click", async () => {
    if (!(await confirmDialog("Delete this meal?"))) return;
    state.meals = state.meals.filter((x) => x.id !== m.id);
    app.editing = null;
    app.save();
    toast("Meal deleted");
    app.go("meals");
  });
}

// ---------- Workouts ----------

function renderWorkout(root, app) {
  const { state } = app;
  const s = state.settings;
  const w = app.editing ? state.workouts.find((x) => x.id === app.editing.id) : null;
  const v = w || { date: localDate(), type: "strength", sets: 3, reps: 8, intensity: 3, mins: 30 };
  const units = s.units;

  root.innerHTML = `
    <section class="card">
      <h2>${w ? "Edit workout" : "Log training"}</h2>
      ${!w && state.workoutFavs.length ? select("wFav", "From favorites", [["", "Choose a favorite…"], ...state.workoutFavs.map((f, i) => [i, f.name])], "") : ""}
      <div class="row2">
        ${field("wDate", "Date", 'type="date"', v.date)}
        ${select("wType", "Type", [["strength", "Strength"], ["cardio", "Cardio"], ["sport", "Sport"], ["other", "Other"]], v.type)}
      </div>
      ${w ? "" : select("wMode", "Log", [["single", "One exercise"], ["session", "A full session (several exercises)"]], "single")}

      <div id="strengthBox">
        ${field("wName", "Exercise", 'list="exerciseList" placeholder="e.g. Bench Press" autocomplete="off"', v.type === "strength" ? v.name : "")}
        <div class="row3">
          ${field("wSets", "Hard sets", 'type="number" inputmode="numeric" min="1"', v.sets ?? "")}
          ${field("wReps", "Reps", 'type="number" inputmode="numeric" min="1"', v.reps ?? "")}
          ${field("wWeight", `Weight (${units})`, 'type="number" inputmode="decimal" min="0" step="0.5"', v.weight ?? "")}
        </div>
      </div>

      <div id="sessionBox" hidden>
        ${field("wSessionName", "Session name", 'placeholder="e.g. Upper A, Leg day"')}
        <div id="sessRows"></div>
        <button class="btn small" id="addRow">+ Add exercise</button>
      </div>

      <div id="cardioBox" hidden>
        ${field("wCardioName", "Activity", 'placeholder="e.g. Run, Bike, Rower"', v.type === "cardio" ? v.name : "")}
        <div class="row2">
          ${field("wMins", "Minutes", 'type="number" inputmode="numeric" min="1"', v.mins ?? 30)}
          ${select("wIntensity", "Intensity", INTENSITY, v.intensity ?? 3)}
        </div>
      </div>

      <div id="otherBox" hidden>
        ${field("wOtherName", "Activity", 'placeholder="e.g. Basketball"', v.type === "sport" || v.type === "other" ? v.name : "")}
      </div>

      ${field("wNotes", "Notes", 'placeholder="Optional"', v.notes)}
      <div class="actions">
        <button class="btn primary" id="wSave">${w ? "Update workout" : "Save"}</button>
        ${w ? "" : `<button class="btn ghost" id="wFavSave">Save as favorite</button>`}
        ${w ? `<button class="btn danger" id="wDelete">Delete</button>` : ""}
      </div>
    </section>

    <section class="card">
      <h2>Rest timer</h2>
      <div class="timer"><span id="restClock">0:00</span>
        <div class="actions"><button class="btn small" data-rest="60">60s</button><button class="btn small" data-rest="90">90s</button><button class="btn small" data-rest="120">2 min</button><button class="btn small ghost" data-rest="0">Stop</button></div>
      </div>
    </section>

    <section class="card">
      <h2>Plate math</h2>
      <div class="row2">
        ${field("pmTarget", `Target (${units})`, 'type="number" inputmode="decimal" min="0"', "")}
        ${field("pmBar", `Bar (${units})`, 'type="number" inputmode="decimal" min="0"', units === "kg" ? 20 : 45)}
      </div>
      <p class="kpi-sm" id="pmOut">Enter a target weight.</p>
    </section>`;

  const showBoxes = () => {
    const type = $("#wType").value;
    const session = $("#wMode")?.value === "session" && type === "strength";
    $("#strengthBox").hidden = type !== "strength" || session;
    $("#sessionBox").hidden = !session;
    $("#cardioBox").hidden = type !== "cardio";
    $("#otherBox").hidden = type !== "sport" && type !== "other";
    $("#wFavSave") && ($("#wFavSave").hidden = session);
    if (session && !$("#sessRows").children.length) addRow();
  };
  const addRow = (pref = {}) => {
    const row = document.createElement("div");
    row.className = "sess-row";
    row.innerHTML = `
      <input class="sName" list="exerciseList" placeholder="Exercise" value="${esc(pref.name || "")}" aria-label="Exercise">
      <input class="sSets" type="number" inputmode="numeric" min="1" placeholder="Sets" aria-label="Sets">
      <input class="sReps" type="number" inputmode="numeric" min="1" placeholder="Reps" aria-label="Reps">
      <input class="sWeight" type="number" inputmode="decimal" min="0" step="0.5" placeholder="${units}" aria-label="Weight">
      <button class="icon-btn" aria-label="Remove exercise">✕</button>`;
    row.querySelector("button").addEventListener("click", () => row.remove());
    $("#sessRows").appendChild(row);
  };
  $("#wType").addEventListener("change", showBoxes);
  $("#wMode")?.addEventListener("change", showBoxes);
  $("#addRow").addEventListener("click", () => addRow());
  showBoxes();

  $("#wFav")?.addEventListener("change", (e) => {
    const f = state.workoutFavs[e.target.value];
    if (!f) return;
    $("#wType").value = f.type;
    if ($("#wMode")) $("#wMode").value = "single";
    showBoxes();
    if (f.type === "strength") {
      $("#wName").value = f.name;
      $("#wSets").value = f.sets ?? "";
      $("#wReps").value = f.reps ?? "";
      $("#wWeight").value = f.weight ?? "";
    } else if (f.type === "cardio") {
      $("#wCardioName").value = f.name;
      $("#wMins").value = f.mins ?? "";
      $("#wIntensity").value = f.intensity ?? 3;
    } else $("#wOtherName").value = f.name;
  });

  const readOne = () => {
    const type = $("#wType").value;
    if (type === "strength") return { type, name: $("#wName").value.trim() || "Strength", sets: num($("#wSets")), reps: num($("#wReps")), weight: num($("#wWeight")) };
    if (type === "cardio") return { type, name: $("#wCardioName").value.trim() || "Cardio", mins: num($("#wMins")), intensity: +$("#wIntensity").value };
    return { type, name: $("#wOtherName").value.trim() || (type === "sport" ? "Sport" : "Other") };
  };

  $("#wSave").addEventListener("click", () => {
    const date = $("#wDate").value || localDate();
    const notes = $("#wNotes").value.trim();
    if (!$("#sessionBox").hidden) {
      const rows = $$(".sess-row", root)
        .map((r) => ({ name: $(".sName", r).value.trim(), sets: num($(".sSets", r)), reps: num($(".sReps", r)), weight: num($(".sWeight", r)) }))
        .filter((r) => r.name || r.sets);
      if (!rows.length) return toast("Add at least one exercise");
      const sessionId = uid();
      const sessionName = $("#wSessionName").value.trim() || "Session";
      for (const r of rows) state.workouts.push({ id: uid(), date, type: "strength", ...r, name: r.name || "Strength", sessionId, sessionName, notes });
      app.save();
      success(`Session saved (${rows.length} exercise${rows.length === 1 ? "" : "s"})`);
      return app.go("tank");
    }
    const data = { ...readOne(), date, notes };
    if (w) {
      for (const k of ["sets", "reps", "weight", "mins", "intensity"]) delete w[k];
      Object.assign(w, data);
    } else state.workouts.push({ id: uid(), ...data });
    app.editing = null;
    app.save();
    success(w ? "Workout updated" : "Workout saved");
    app.go("tank");
  });
  $("#wFavSave")?.addEventListener("click", () => {
    const fav = readOne();
    state.workoutFavs = state.workoutFavs.filter((f) => f.name !== fav.name);
    state.workoutFavs.push(fav);
    app.save();
    toast(`Saved "${fav.name}" to favorites`);
  });
  $("#wDelete")?.addEventListener("click", async () => {
    if (!(await confirmDialog("Delete this workout?"))) return;
    state.workouts = state.workouts.filter((x) => x.id !== w.id);
    app.editing = null;
    app.save();
    toast("Workout deleted");
    app.go("tank");
  });

  // Rest timer
  const clock = (t) => `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
  $$("[data-rest]", root).forEach((b) =>
    b.addEventListener("click", () => {
      clearInterval(restInterval);
      let left = +b.dataset.rest;
      $("#restClock").textContent = clock(left);
      if (!left) return;
      restInterval = setInterval(() => {
        left--;
        const el = $("#restClock");
        if (!el) return clearInterval(restInterval);
        el.textContent = clock(left);
        if (left <= 0) {
          clearInterval(restInterval);
          navigator.vibrate?.([200, 100, 200]);
          toast("Rest over. Next set!");
        }
      }, 1000);
    }),
  );

  // Plate math
  const plates = () => {
    const target = num($("#pmTarget")), bar = num($("#pmBar"));
    if (!target) return ($("#pmOut").textContent = "Enter a target weight.");
    if (target <= bar) return ($("#pmOut").textContent = "Just the bar.");
    const r = plateMath(target, bar, units);
    $("#pmOut").textContent = `Each side: ${r.plates.join(" + ") || "—"} ${units}${r.remainder ? ` (${r.remainder} ${units} short)` : ""}`;
  };
  ["pmTarget", "pmBar"].forEach((id) => $("#" + id).addEventListener("input", plates));
  $("#wWeight")?.addEventListener("input", () => {
    $("#pmTarget").value = $("#wWeight").value;
    plates();
  });
}
