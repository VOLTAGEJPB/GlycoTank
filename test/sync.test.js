import { test } from "node:test";
import assert from "node:assert/strict";
import { snapshot, stampChanges, toRecords, applyRecords } from "../src/sync-model.js";

const base = () => ({ meals: [], workouts: [], checks: [], settings: { units: "lb" }, profile: {}, meta: {}, mealFavs: [], workoutFavs: [] });

test("first stamp marks everything once", () => {
  const s = base();
  s.meals.push({ id: "a", name: "Oats" });
  const snap = stampChanges(s, null, 100);
  assert.equal(s.meals[0].updatedAt, 100);
  assert.equal(s.docStamps.settings, 1, "untouched docs get the oldest stamp");
  stampChanges(s, snap, 200);
  assert.equal(s.meals[0].updatedAt, 100, "unchanged records keep their stamp");
});

test("edits, additions and deletions are detected on save", () => {
  const s = base();
  s.meals.push({ id: "a", name: "Oats", kcal: 300 }, { id: "b", name: "Eggs" });
  let snap = stampChanges(s, null, 100);
  s.meals[0].kcal = 350; // edited
  s.meals = s.meals.filter((m) => m.id !== "b"); // deleted
  s.workouts.push({ id: "w", type: "strength", sets: 5 }); // added
  s.settings.units = "kg"; // doc changed
  snap = stampChanges(s, snap, 200);
  assert.equal(s.meals[0].updatedAt, 200);
  assert.equal(s.workouts[0].updatedAt, 200);
  assert.equal(s.deleted["meal:b"], 200);
  assert.equal(s.docStamps.settings, 200);
  assert.equal(s.docStamps.profile, 1);
  const recs = toRecords(s, 150).map((r) => `${r.kind}:${r.id}${r.deleted ? " (deleted)" : ""}`).sort();
  assert.deepEqual(recs, ["doc:settings", "meal:a", "meal:b (deleted)", "workout:w"]);
});

test("newer remote changes win, older ones are ignored", () => {
  const s = base();
  s.meals.push({ id: "a", name: "Local", updatedAt: 200 });
  assert.equal(applyRecords(s, [{ kind: "meal", id: "a", updatedAt: 100, data: { name: "Old remote" } }]), 0);
  assert.equal(s.meals[0].name, "Local");
  assert.equal(applyRecords(s, [{ kind: "meal", id: "a", updatedAt: 300, data: { name: "New remote" } }]), 1);
  assert.equal(s.meals[0].name, "New remote");
  assert.equal(s.meals.length, 1);
});

test("remote deletions remove local records and stick", () => {
  const s = base();
  s.meals.push({ id: "a", name: "Oats", updatedAt: 100 });
  applyRecords(s, [{ kind: "meal", id: "a", updatedAt: 200, deleted: true }]);
  assert.equal(s.meals.length, 0);
  assert.equal(s.deleted["meal:a"], 200);
  // An older copy arriving later doesn't bring it back.
  applyRecords(s, [{ kind: "meal", id: "a", updatedAt: 150, data: { name: "Oats" } }]);
  assert.equal(s.meals.length, 0);
});

test("new remote records and docs are added", () => {
  const s = base();
  s.docStamps = { settings: 100 };
  const n = applyRecords(s, [
    { kind: "check", id: "c1", updatedAt: 50, data: { date: "2026-10-01", sleep: 8 } },
    { kind: "doc", id: "settings", updatedAt: 300, data: { units: "kg" } },
    { kind: "doc", id: "nonsense", updatedAt: 999, data: 1 },
  ]);
  assert.equal(n, 2);
  assert.equal(s.checks[0].sleep, 8);
  assert.equal(s.settings.units, "kg");
  assert.equal(s.nonsense, undefined);
});

test("two devices converge", () => {
  const phone = base();
  const tablet = base();
  phone.meals.push({ id: "m1", name: "Phone meal" });
  let pSnap = stampChanges(phone, null, 100);
  applyRecords(tablet, toRecords(phone, 0));
  let tSnap = snapshot(tablet);
  tablet.meals[0].name = "Renamed on tablet";
  tSnap = stampChanges(tablet, tSnap, 300);
  phone.meals = [];
  pSnap = stampChanges(phone, pSnap, 200); // deleted on phone, but earlier than the rename
  applyRecords(phone, toRecords(tablet, 0));
  applyRecords(tablet, toRecords(phone, 0));
  assert.deepEqual(phone.meals.map((m) => m.name), ["Renamed on tablet"]);
  assert.deepEqual(tablet.meals.map((m) => m.name), ["Renamed on tablet"]);
});

test("a fresh install's default settings never overwrite the cloud copy", () => {
  const phone = base();
  let pSnap = stampChanges(phone, null, 100);
  phone.profile = { weight: 80 };
  pSnap = stampChanges(phone, pSnap, 200);
  const cloud = toRecords(phone, 0);
  const newPhone = base(); // installed later, still on defaults
  stampChanges(newPhone, null, 500);
  applyRecords(newPhone, cloud);
  assert.deepEqual(newPhone.profile, { weight: 80 });
  // ...and its defaults don't win when it uploads them either.
  applyRecords(phone, toRecords(newPhone, 0));
  assert.deepEqual(phone.profile, { weight: 80 });
  assert.equal(phone.settings.units, "lb");
});
