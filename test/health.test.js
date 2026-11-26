import test from "node:test";
import assert from "node:assert/strict";
import { toWorkout, sleepScore, summarizeSleep } from "../src/health.js";
import { stepsCost, glycoSeries } from "../src/model.js";

test("watch workouts map to GlycoTank workouts", () => {
  const run = toWorkout({ workoutType: "running", duration: 30 * 60, totalEnergyBurned: 300, startDate: "2026-11-26T12:00:00Z", platformId: "A" });
  assert.equal(run.type, "cardio");
  assert.equal(run.mins, 30);
  assert.equal(run.intensity, 4); // 10 kcal/min -> 4
  assert.equal(run.healthId, "A");
  assert.equal(run.source, "health");
  const lift = toWorkout({ workoutType: "traditionalStrengthTraining", duration: 45 * 60, startDate: "2026-11-26T12:00:00Z" });
  assert.equal(lift.type, "strength");
  assert.equal(lift.sets, 15);
  assert.equal(toWorkout({ workoutType: "soccer", duration: 3600, startDate: "2026-11-26T12:00:00Z" }).type, "sport");
  assert.equal(toWorkout({ workoutType: "walking", duration: 3600, startDate: "2026-11-26T12:00:00Z" }), null); // steps cover walks
  assert.equal(toWorkout({ workoutType: "running", duration: 120, startDate: "2026-11-26T12:00:00Z" }), null); // under 5 min
});

test("sleep summary and score", () => {
  const night = summarizeSleep([
    { sleepState: "inBed", value: 500 },
    { stages: [{ stage: "light", durationMinutes: 240 }, { stage: "deep", durationMinutes: 90 }, { stage: "rem", durationMinutes: 110 }, { stage: "awake", durationMinutes: 20 }] },
  ]);
  assert.deepEqual([night.asleep, night.awake, night.deep, night.rem, night.staged], [440, 20, 90, 110, true]);
  const score = sleepScore(night);
  assert.ok(score >= 85 && score <= 100, `score ${score}`);
  assert.equal(sleepScore({ asleep: 0 }), null);
  assert.ok(sleepScore({ asleep: 300, awake: 60 }) < 70); // 5 h, restless, no stages
});

test("steps above 6,000 use a little glycogen on logged days", () => {
  assert.equal(stepsCost(5000), 0);
  assert.equal(stepsCost(16000), 30);
  const state = {
    settings: { glycoCap: 400, uptakePct: 100, dailyUse: 0, setCost: 0, cardioGpm: 0, otherCost: 0 },
    meals: [{ date: "2026-11-26", carbs: 0 }],
    workouts: [],
    meta: { healthDays: { "2026-11-26": { steps: 16000 } } },
  };
  const day = glycoSeries(state, "2026-11-26")["2026-11-26"];
  assert.equal(day.activity, 30);
});
