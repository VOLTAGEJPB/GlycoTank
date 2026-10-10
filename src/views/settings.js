import { personalize, DEFAULT_SETTINGS, localDate } from "../model.js";
import { normalize, emptyState } from "../store.js";
import { $, $$, esc, num, field, select, toast, success, confirmDialog } from "../ui.js";
import { shareFile, toCsv, applyReminders, remindersSupported } from "../native.js";

const TUNABLE = [
  ["kcalTarget", "Calories / day", 1],
  ["proteinTarget", "Protein g / day", 1],
  ["carbGuide", "Carb guide g / day", 1],
  ["fiberTarget", "Fiber g / day", 1],
  ["glycoCap", "Tank capacity (g)", 10],
  ["uptakePct", "Carb uptake %", 1],
  ["setCost", "Grams per hard set", 0.1],
  ["cardioGpm", "Cardio g/min at intensity 1", 0.01],
  ["dailyUse", "Everyday use, full tank (g/day)", 5],
];

export function renderSettings(root, app) {
  const { state } = app;
  const s = state.settings;
  const p = { weightUnits: s.units, heightUnits: s.units === "kg" ? "cm" : "ftin", goal: "maintain", sex: "m", daysPerWeek: 3, setsPerSession: 12, cardioMinsPerWeek: 60, cardioIntensity: 3, ...state.profile };

  root.innerHTML = `
    <section class="card" id="personalize">
      <h2>Personalize your targets</h2>
      <p class="hint">Answer a few questions and we'll estimate your calories, macros and tank settings. Everything stays on this device.</p>
      <div class="row3">
        ${field("pWeight", `Body weight (${p.weightUnits})`, 'type="number" inputmode="decimal" min="30"', p.weight ?? "")}
        ${field("pAge", "Age", 'type="number" inputmode="numeric" min="14" max="100"', p.age ?? "")}
        ${select("pSex", "Sex", [["m", "Male"], ["f", "Female"]], p.sex)}
      </div>
      ${p.heightUnits === "ftin"
        ? `<div class="row2">${field("pFt", "Height (ft)", 'type="number" inputmode="numeric" min="3" max="8"', p.heightFt ?? "")}${field("pIn", "(in)", 'type="number" inputmode="numeric" min="0" max="11"', p.heightIn ?? "")}</div>`
        : field("pCm", "Height (cm)", 'type="number" inputmode="numeric" min="100" max="240"', p.heightCm ?? "")}
      <div class="row2">
        ${select("pGoal", "Goal", [["maintain", "Maintain weight"], ["cut", "Lose fat"], ["gain", "Build muscle"]], p.goal)}
        ${field("pRate", "Change per week (lb)", 'type="number" inputmode="decimal" min="0" max="2" step="0.25" placeholder="e.g. 1"', p.lbPerWeek ?? "")}
      </div>
      <div class="row2">
        ${field("pDays", "Training days / week", 'type="number" inputmode="numeric" min="0" max="7"', p.daysPerWeek)}
        ${field("pSets", "Hard sets / session", 'type="number" inputmode="numeric" min="0"', p.setsPerSession)}
      </div>
      <div class="row2">
        ${field("pCardio", "Cardio min / week", 'type="number" inputmode="numeric" min="0"', p.cardioMinsPerWeek)}
        ${select("pInt", "Cardio intensity", [[1, "1 · very easy"], [2, "2 · easy"], [3, "3 · moderate"], [4, "4 · hard"], [5, "5 · very hard"]], p.cardioIntensity)}
      </div>
      <label class="check"><input type="checkbox" id="pLowCarb" ${p.lowCarb ? "checked" : ""}> I prefer lower carb</label>
      <div id="pOut" class="results"></div>
      <div class="actions"><button class="btn primary" id="pApply">Use these targets</button></div>
    </section>

    <section class="card">
      <h2>Targets &amp; tank</h2>
      <p class="hint">Fine-tune any value. Changes save automatically.</p>
      <div class="row2">${TUNABLE.map(([k, label, step]) => field("t_" + k, label, `type="number" inputmode="decimal" min="0" step="${step}"`, s[k])).join("")}</div>
      <div class="actions"><button class="btn ghost" id="tReset">Reset to defaults</button></div>
      <details>
        <summary>How the glycogen tank works</summary>
        <p>Glycogen is carbohydrate stored in your muscles and liver: your short-term fuel. GlycoTank keeps a running estimate of it.</p>
        <ul>
          <li><strong>Meals add</strong> carbs × uptake% (default 85%).</li>
          <li><strong>Strength training uses</strong> a set amount per hard set (default 6 g).</li>
          <li><strong>Cardio uses</strong> grams per minute × intensity (default 0.33 g/min at intensity 1).</li>
          <li><strong>Everyday use</strong> drains up to 150 g a day (by default) for your brain and normal activity. It's highest when the tank is full and drops as it empties, because your body shifts toward burning fat.</li>
          <li>The tank can't go below empty or above its capacity.</li>
        </ul>
        <p>These are simplified estimates for general fitness use, not measurements.</p>
      </details>
    </section>

    <section class="card">
      <h2>Units</h2>
      ${select("sUnits", "Weights", [["lb", "Pounds (lb)"], ["kg", "Kilograms (kg)"]], s.units)}
    </section>

    <section class="card">
      <h2>Reminders</h2>
      ${remindersSupported ? `
        <p class="hint">Daily notifications at the times you choose. Leave a time blank to turn it off. On Android, allow notifications and then turn on <em>Alarms &amp; reminders</em> for GlycoTank so they arrive on time.</p>
        <div class="row2">
          ${field("rCheckin", "Morning check-in", 'type="time"', s.reminders.checkin)}
          ${field("rLog", "Log meals & training", 'type="time"', s.reminders.log)}
        </div>
        <div class="actions"><button class="btn" id="rSave">Save reminders</button></div>`
      : `<p class="hint">Reminders are available in the iPhone and Android apps.</p>`}
    </section>

    <section class="card">
      <h2>Your data</h2>
      <p class="hint">GlycoTank has no accounts or servers. Your data lives only on this device, so export a backup now and then.</p>
      <div class="actions">
        <button class="btn" id="dJson">Back up (JSON)</button>
        <button class="btn" id="dCsv">Export spreadsheet (CSV)</button>
        <label class="btn">Restore backup<input type="file" id="dImport" accept="application/json,.json" hidden></label>
        <button class="btn danger" id="dClear">Delete all data</button>
      </div>
    </section>

    <section class="card">
      <h2>About</h2>
      <p class="hint">GlycoTank ${esc(app.version)} · Made by Joel Perez.</p>
      <p class="hint">GlycoTank provides general fitness and nutrition estimates. It is not a medical device and does not give medical advice. Talk to a doctor or dietitian before making big changes to your diet or training, especially if you have diabetes or another health condition.</p>
      <div class="actions"><button class="btn ghost" id="aIntro">Replay the intro</button></div>
    </section>`;

  // ----- Personalize -----
  const readProfile = () => ({
    ...p,
    weight: num($("#pWeight")), age: num($("#pAge")), sex: $("#pSex").value,
    heightFt: num($("#pFt")), heightIn: num($("#pIn")), heightCm: num($("#pCm")),
    goal: $("#pGoal").value, lbPerWeek: num($("#pRate")), daysPerWeek: num($("#pDays")), setsPerSession: num($("#pSets")),
    cardioMinsPerWeek: num($("#pCardio")), cardioIntensity: +$("#pInt").value, lowCarb: $("#pLowCarb").checked,
  });
  const showResult = () => {
    const prof = readProfile();
    $("#pRate").closest(".field").hidden = prof.goal === "maintain";
    const r = personalize(prof);
    $("#pApply").disabled = !r;
    $("#pOut").innerHTML = r
      ? `<div><span class="label">Calories</span><strong>${r.kcalTarget}</strong></div>
         <div><span class="label">Protein</span><strong>${r.proteinTarget} g</strong></div>
         <div><span class="label">Carbs</span><strong>${r.carbGuide} g</strong></div>
         <div><span class="label">Fat</span><strong>${r.fatTarget} g</strong></div>
         <div><span class="label">Fiber</span><strong>${r.fiberTarget} g</strong></div>
         <div><span class="label">Tank</span><strong>${r.glycoCap} g</strong></div>
         ${r.calorieFloorApplied ? `<p class="hint full">We don't go below ${prof.sex === "f" ? "1,200" : "1,500"} calories a day without professional guidance, so your rate of change will be slower.</p>` : ""}`
      : `<p class="hint full">Enter your weight and height to see your targets.</p>`;
  };
  $$("#personalize input, #personalize select").forEach((el) => el.addEventListener("input", showResult));
  showResult();
  $("#pApply").addEventListener("click", () => {
    const prof = readProfile();
    const r = personalize(prof);
    if (!r) return;
    state.profile = prof;
    for (const k of ["kcalTarget", "proteinTarget", "carbGuide", "fiberTarget", "glycoCap", "uptakePct", "setCost", "cardioGpm", "dailyUse"]) s[k] = r[k];
    state.meta.personalized = true;
    app.save();
    success("Your targets are set");
    renderSettings(root, app);
  });

  // ----- Manual targets -----
  for (const [k] of TUNABLE) {
    $("#t_" + k).addEventListener("change", (e) => {
      const v = parseFloat(e.target.value);
      if (!(v >= 0)) return (e.target.value = s[k]);
      s[k] = k === "uptakePct" ? Math.min(100, Math.max(10, v)) : k === "glycoCap" ? Math.max(100, v) : v;
      e.target.value = s[k];
      state.meta.personalized = true;
      app.save();
      toast("Saved");
    });
  }
  $("#tReset").addEventListener("click", async () => {
    if (!(await confirmDialog("Reset all targets and tank settings to the defaults?", "Reset"))) return;
    for (const [k] of TUNABLE) s[k] = DEFAULT_SETTINGS[k];
    state.meta.personalized = false;
    app.save();
    renderSettings(root, app);
  });

  $("#sUnits").addEventListener("change", (e) => {
    s.units = e.target.value;
    state.profile = { ...state.profile, weightUnits: s.units, heightUnits: s.units === "kg" ? "cm" : "ftin" };
    app.save();
    renderSettings(root, app);
  });

  $("#rSave")?.addEventListener("click", async () => {
    s.reminders = { checkin: $("#rCheckin").value, log: $("#rLog").value };
    app.save();
    try {
      const ok = await applyReminders(s.reminders);
      toast(ok ? "Reminders saved" : "Notifications are turned off for GlycoTank in your phone's settings");
    } catch (e) {
      console.error(e);
      toast("Couldn't schedule reminders");
    }
  });

  // ----- Data -----
  const stamp = localDate();
  $("#dJson").addEventListener("click", () => shareFile(`glycotank-backup-${stamp}.json`, JSON.stringify(state, null, 2), "application/json").catch(shareError));
  $("#dCsv").addEventListener("click", async () => {
    try {
      await shareFile(`glycotank-meals-${stamp}.csv`, toCsv(state.meals, ["date", "name", "kcal", "carbs", "protein", "fat", "fiber", "notes"]), "text/csv");
      await shareFile(`glycotank-workouts-${stamp}.csv`, toCsv(state.workouts, ["date", "type", "name", "sessionName", "sets", "reps", "weight", "mins", "intensity", "notes"]), "text/csv");
    } catch (e) {
      shareError(e);
    }
  });
  $("#dImport").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = normalize(JSON.parse(await file.text()));
      const count = data.meals.length + data.workouts.length + data.checks.length;
      if (!(await confirmDialog(`Replace everything on this device with this backup (${count} entries)?`, "Restore"))) return;
      app.replaceState(data);
      toast("Backup restored");
    } catch {
      toast("That file isn't a GlycoTank backup");
    }
  });
  $("#dClear").addEventListener("click", async () => {
    if (!(await confirmDialog("Delete all your meals, workouts, check-ins and settings from this device? This can't be undone."))) return;
    app.replaceState(emptyState());
    toast("All data deleted");
  });
  $("#aIntro").addEventListener("click", () => app.showIntro());
}

function shareError(e) {
  // Closing the share sheet without choosing an app is not an error.
  if (!/cancel/i.test(String(e?.message || e))) {
    console.error(e);
    toast("Couldn't export");
  }
}
