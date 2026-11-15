import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { indexFood, searchFoods, nutritionFor, portionLabel, portionsFor, sumItems } from "../src/foods.js";

const list = JSON.parse(readFileSync(new URL("../public/foods.json", import.meta.url))).foods.map(indexFood);
const top = (q, n = 1) => searchFoods(list, q, n).map((r) => r[0]);

test("plain foods rank first", () => {
  assert.equal(top("bagel")[0], "Bagel");
  assert.equal(top("cream cheese")[0], "Cream cheese, regular, plain");
  assert.equal(top("bagels")[0], "Bagel");
});

test("every word must match", () => {
  assert.ok(top("bagel raisin", 5).every((n) => /bagel/i.test(n) && /raisin/i.test(n)));
  assert.deepEqual(top("zzzz qqqq"), []);
});

test("portions and nutrition", () => {
  const bagel = searchFoods(list, "bagel", 1)[0];
  const regular = portionsFor(bagel).find(([d]) => d === "1 regular");
  assert.equal(regular[1], 105);
  assert.equal(nutritionFor(bagel, 105).kcal, 277);
  assert.equal(portionLabel("1 regular", 2), "2 regular");
  assert.equal(portionLabel("oz", 3), "3 oz");
  assert.equal(portionLabel("1 tablespoon", 2), "2 tablespoons");
  assert.equal(portionLabel("1 sandwich", 2), "2 sandwiches");
  assert.deepEqual(sumItems([{ kcal: 277, carbs: 55 }, { kcal: 50.4, carbs: 0.6, protein: 1 }]), { kcal: 327, carbs: 55.6, protein: 1, fat: 0, fiber: 0 });
});
