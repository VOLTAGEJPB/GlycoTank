import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { servingOf, brandRow, rankBrands } from "../src/brands.js";
import { indexFood, searchFoods, nutritionFor, portionsFor, portionLabel } from "../src/foods.js";

const list = JSON.parse(readFileSync(new URL("../public/foods.json", import.meta.url))).foods.map(indexFood);

test("label serving sizes", () => {
  assert.deepEqual(servingOf("1 cake (9 g)", 9), ["1 cake", 9]);
  assert.deepEqual(servingOf("18 pieces (31g)"), ["18 pieces", 31]);
  assert.deepEqual(servingOf("12g", 12), ["1 serving", 12]);
  assert.deepEqual(servingOf("1 portion (13 g)", 13), ["1 serving", 13]);
  assert.deepEqual(servingOf("BAR (34 g)"), ["1 bar", 34]);
  assert.deepEqual(servingOf("13 pieces, 30 g (30 g)", 30), ["13 pieces", 30]);
  assert.equal(servingOf("", null), null);
});

test("store products become food rows", () => {
  const row = brandRow({ code: "030000", brands: "Quaker", product_name: "Quaker Lightly Salted Rice Cakes", serving_size: "1 cake (9 g)", serving_quantity: 9,
    nutriments: { "energy-kcal_100g": 398, carbohydrates_100g: 81, proteins_100g: 8, fat_100g: 3, fiber_100g: 4 } });
  assert.equal(row[0], "Quaker Lightly Salted Rice Cakes");
  const [desc, g] = portionsFor(row)[0];
  assert.equal(desc, "1 cake");
  assert.equal(nutritionFor(row, g).kcal, 36);
  assert.equal(portionLabel(desc, 2), "2 cakes");
  // Per-serving numbers only, a shouting name and a size in the name.
  const r2 = brandRow({ brands: "GREAT VALUE", product_name: "CRISPY RICE TREATS 7.8 oz box", serving_size: "1 bar (22 g)", nutriments: { "energy-kcal_serving": 100 } });
  assert.equal(r2[0], "Great Value Crispy Rice Treats");
  assert.equal(nutritionFor(r2, 22).kcal, 100);
  assert.equal(brandRow({ product_name: "Mystery", nutriments: {} }), null);
});

test("products with every word come first, repeats dropped", () => {
  const p = (name, kcal) => ({ brands: "Quaker", product_name: name, serving_size: "1 cake (9 g)", nutriments: { "energy-kcal_100g": kcal } });
  const rows = rankBrands([p("Oat bar", 400), p("Caramel Rice Cakes", 385), p("Caramel Rice Cakes", 385)], "rice cakes");
  assert.deepEqual(rows.map((r) => r[0]), ["Quaker Caramel Rice Cakes", "Quaker Oat bar"]);
});

test("brand words and joined words still find basic foods", () => {
  const top = (q) => searchFoods(list, q, 3);
  assert.equal(top("Quaker rice cakes")[0][0], "Rice cake");
  assert.ok(top("Quaker rice cakes").loose);
  assert.equal(top("ricecake")[0][0], "Rice cake");
  assert.equal(top("rice cake").loose, undefined);
});
