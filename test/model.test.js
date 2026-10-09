import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SETTINGS, localDate, addDays, workoutCost, glycoSeries, glycoStatus, carbPlan, plannedCost,
  readiness, baselineRhr, streak, personalize, plateMath, dayTotals, parseMealText,
} from "../src/model.js";

// Most tests turn everyday use off to check one effect at a time.
const s = { ...DEFAULT_SETTINGS, dailyUse: 0 };
const empty = (settings = s) => ({ meals: [], workouts: [], checks: [], settings });

test("localDate uses the local calendar day, not UTC", () => {
  assert.equal(localDate(new Date(2026, 9, 9, 23, 30)), "2026-10-09");
  assert.equal(localDate(new Date(2026, 0, 1, 0, 5)), "2026-01-01");
});

test("addDays crosses month and year boundaries", () => {
  assert.equal(addDays("2026-01-31", 1), "2026-02-01");
  assert.equal(addDays("2026-01-01", -1), "2025-12-31");
  assert.equal(addDays("2024-02-28", 1), "2024-02-29");
});

test("workout costs match the original model", () => {
  assert.equal(workoutCost({ type: "strength", sets: 10 }, s), 60);
  assert.ok(Math.abs(workoutCost({ type: "cardio", mins: 30, intensity: 3 }, s) - 29.7) < 1e-9);
  assert.equal(workoutCost({ type: "sport" }, s), 10);
});

test("glycogen starts at 70%, adds carbs × uptake, subtracts training, and is clamped", () => {
  const st = empty();
  st.meals.push({ date: "2026-10-01", carbs: 100 });
  st.workouts.push({ date: "2026-10-01", type: "strength", sets: 10 });
  const day = glycoSeries(st, "2026-10-01")["2026-10-01"];
  assert.equal(day.start, 280);
  assert.equal(day.added, 85);
  assert.equal(day.cost, 60);
  assert.equal(day.end, 305);

  st.meals.push({ date: "2026-10-02", carbs: 1000 });
  assert.equal(glycoSeries(st, "2026-10-02")["2026-10-02"].end, 400);
  st.workouts.push({ date: "2026-10-03", type: "strength", sets: 200 });
  assert.equal(glycoSeries(st, "2026-10-03")["2026-10-03"].end, 0);
});

test("glycogen carries over across empty days", () => {
  const st = empty();
  st.meals.push({ date: "2026-10-01", carbs: 100 });
  const series = glycoSeries(st, "2026-10-04");
  assert.deepEqual(Object.keys(series), ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]);
  assert.equal(series["2026-10-04"].end, 365);
});

test("everyday use scales with how full the tank is", () => {
  const st = empty({ ...DEFAULT_SETTINGS, dailyUse: 150 });
  st.meals.push({ date: "2026-10-01", carbs: 200 });
  const series = glycoSeries(st, "2026-10-02");
  // starts at 280 g (70%): uses 150 × 0.7 = 105 g
  assert.equal(series["2026-10-01"].end, 280 + 170 - 105);
  assert.equal(series["2026-10-01"].training, 0);
  // next day starts at 345 g: uses 150 × 345/400
  assert.ok(Math.abs(series["2026-10-02"].end - (345 - 150 * (345 / 400))) < 1e-9);
});

test("a steady diet settles at a matching level instead of emptying", () => {
  const st = empty({ ...DEFAULT_SETTINGS, dailyUse: 150 });
  for (let d = 1; d <= 28; d++) {
    const date = `2026-10-${String(d).padStart(2, "0")}`;
    st.meals.push({ date, carbs: 200 }); // 170 g stored per day
    st.workouts.push({ date, type: "strength", sets: 9 }); // 54 g per day
  }
  // equilibrium: 170 − 54 = 150 × level/400 → level ≈ 309 g
  const end = glycoSeries(st, "2026-10-28")["2026-10-28"].end;
  assert.ok(Math.abs(end - (116 / 150) * 400) < 5, `ended at ${end}`);
});

test("glycogen series with no data still returns the end date", () => {
  const series = glycoSeries(empty(), "2026-10-09");
  assert.equal(series["2026-10-09"].end, 280);
});

test("status bands", () => {
  assert.equal(glycoStatus(50, 400).tone, "low");
  assert.equal(glycoStatus(150, 400).tone, "mid");
  assert.equal(glycoStatus(300, 400).tone, "good");
});

test("carb planner aims for 75% after tomorrow's training and everyday use", () => {
  // 0.75*400 = 300; today ends at 250; tomorrow costs 60 → need 110 g stored → 110/0.85 g eaten
  assert.ok(Math.abs(carbPlan(250, 60, s).grams - 110 / 0.85) < 1e-9);
  assert.equal(carbPlan(400, 0, s).grams, 0);
  // with everyday use: tomorrow uses 150 × 0.75 = 112.5 g at the 75% target
  assert.ok(Math.abs(carbPlan(250, 60, { ...s, dailyUse: 150 }).grams - 222.5 / 0.85) < 1e-9);
  // an empty tank is capped at 1.5 × the 250 g carb guide
  assert.deepEqual(carbPlan(0, 60, { ...s, dailyUse: 150 }), { grams: 375, capped: true });
  assert.equal(plannedCost({ sets: 10, mins: 0 }, s), 60);
});

test("readiness: a normal night scores 70 and trains", () => {
  assert.deepEqual(readiness({ sleep: 7, rhr: 60, mood: "ok" }, 60), { score: 70, label: "Train" });
  assert.deepEqual(readiness({ sleep: 7, mood: "ok" }), { score: 70, label: "Train" });
  assert.equal(readiness(null), null);
});

test("readiness: short sleep, raised heart rate and stress lower it", () => {
  assert.deepEqual(readiness({ sleep: 6, rhr: 60, mood: "ok" }, 60), { score: 64, label: "Go easy" });
  assert.deepEqual(readiness({ sleep: 7, rhr: 66, mood: "ok" }, 60), { score: 58, label: "Go easy" });
  assert.equal(readiness({ sleep: 4, rhr: 70, mood: "stressed" }, 58).label, "Rest");
  assert.equal(readiness({ sleep: 9, rhr: 55, mood: "great" }, 60).score, 96); // (70 + 12 + 5) × 1.1
});

test("baseline resting heart rate averages earlier check-ins only", () => {
  const st = empty();
  st.checks.push({ date: "2026-10-01", rhr: 58 }, { date: "2026-10-02", rhr: 62 }, { date: "2026-10-03", rhr: 80 }, { date: "2026-10-02", rhr: 0 });
  assert.equal(baselineRhr(st, "2026-10-03"), 60);
  assert.equal(baselineRhr(st, "2026-10-01"), null);
});

test("streak counts back from today, or from yesterday if today is empty", () => {
  const st = empty();
  for (const d of ["2026-10-07", "2026-10-08", "2026-10-09"]) st.meals.push({ date: d, carbs: 0 });
  assert.equal(streak(st, "2026-10-09"), 3);
  assert.equal(streak(st, "2026-10-10"), 3);
  assert.equal(streak(st, "2026-10-11"), 0);
});

test("day totals", () => {
  const st = empty();
  st.meals.push({ date: "2026-10-09", kcal: 500, protein: 40, carbs: 50, fat: 10, fiber: 5 }, { date: "2026-10-09", kcal: "300", protein: 20 });
  const t = dayTotals(st, "2026-10-09");
  assert.equal(t.kcal, 800);
  assert.equal(t.protein, 60);
  assert.equal(t.fiber, 5);
});

test("personalize: Mifflin-St Jeor based targets", () => {
  // 180 lb (81.65 kg), 5'10" (177.8 cm), 35-year-old man, maintain, 3×12 sets, 60 min cardio at 3
  const r = personalize({ weight: 180, weightUnits: "lb", heightUnits: "ftin", heightFt: 5, heightIn: 10, age: 35, sex: "m", goal: "maintain", daysPerWeek: 3, setsPerSession: 12, cardioMinsPerWeek: 60, cardioIntensity: 3 });
  // BMR 1757.7 × 1.2 = 2109.3; exercise: 72 min × 3.5 MET (360 kcal) + 60 min × 7 MET (600 kcal) = 960/wk → 137/day
  assert.equal(r.tdee, 2246);
  assert.equal(r.kcalTarget, 2246);
  assert.equal(r.proteinTarget, 163);
  assert.equal(r.fatTarget, 65);
  assert.equal(r.carbGuide, Math.round((2246 - 163 * 4 - 65 * 9) / 4));
  assert.equal(r.fiberTarget, 31);
  assert.equal(r.dailyUse, 147);
  assert.equal(personalize({ weight: 0 }), null);
});

test("personalize: cutting applies a deficit but never goes below the floor", () => {
  const base = { weight: 120, weightUnits: "lb", heightUnits: "cm", heightCm: 157, age: 40, sex: "f", daysPerWeek: 0 };
  const cut = personalize({ ...base, goal: "cut", lbPerWeek: 2 });
  assert.equal(cut.kcalTarget, 1200);
  assert.equal(cut.calorieFloorApplied, true);
  const maintain = personalize({ ...base, goal: "maintain", lbPerWeek: 2 });
  assert.ok(maintain.kcalTarget > 1200);
});

test("meal quick entry parsing", () => {
  assert.deepEqual(parseMealText("650 cal 70c 45p 18f 8 fiber"), { kcal: 650, carbs: 70, protein: 45, fat: 18, fiber: 8 });
  assert.deepEqual(parseMealText("calories 500 carbs 60 protein 32.5 fat 12"), { kcal: 500, carbs: 60, protein: 32.5, fat: 12, fiber: null });
  assert.deepEqual(parseMealText("40g protein, 30g carbs"), { kcal: null, carbs: 30, protein: 40, fat: null, fiber: null });
  assert.deepEqual(parseMealText("chicken bowl"), { kcal: null, carbs: null, protein: null, fat: null, fiber: null });
});

test("plate math", () => {
  assert.deepEqual(plateMath(225, 45, "lb").plates, [45, 45]);
  assert.deepEqual(plateMath(100, 20, "kg").plates, [25, 15]);
  assert.deepEqual(plateMath(45, 45, "lb").plates, []);
  assert.equal(plateMath(136, 45, "lb").remainder, 1);
});
