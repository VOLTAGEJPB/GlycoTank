// Builds public/foods.json, the offline food list behind "Search foods", from
// USDA FoodData Central's Survey foods (FNDDS), which are public domain.
//
//   1. Download FoodData_Central_survey_food_json_<date>.zip from
//      https://fdc.nal.usda.gov/download-datasets and unzip it.
//   2. node scripts/build-foods.mjs path/to/surveyDownload.json <release date, e.g. 2024-10-31>
//
// Each row: [name, kcal, carbs, protein, fat, fiber, portions], nutrients per
// 100 g, portions as [description, grams].
import { readFileSync, writeFileSync } from "node:fs";

const src = process.argv[2];
if (!src) throw new Error("usage: node scripts/build-foods.mjs surveyDownload.json");
const foods = JSON.parse(readFileSync(src, "utf8")).SurveyFoods;

const NUTRIENTS = { 208: 1, 205: 2, 203: 3, 204: 4, 291: 5 }; // kcal, carbs, protein, fat, fiber
const r1 = (n) => Math.round(n * 10) / 10;

const rows = foods.map((f) => {
  const row = [f.description.trim(), 0, 0, 0, 0, 0, []];
  for (const n of f.foodNutrients) {
    const i = NUTRIENTS[n.nutrient?.number];
    if (i) row[i] = i === 1 ? Math.round(n.amount) : r1(n.amount);
  }
  const seen = new Set();
  // USDA's "Quantity not specified" weight is the typical amount eaten. As the
  // default, the portion that matches it ("1 regular" for a bagel), or else the closest
  // one ("1 individual container" rather than "1 cup" of cream cheese), goes first.
  const typical = f.foodPortions.find((p) => /not specified/i.test(p.portionDescription))?.gramWeight;
  const portions = f.foodPortions.filter((p) => p.gramWeight > 0 && !/not specified/i.test(p.portionDescription));
  const off = (p) => (typical ? Math.abs(Math.log(p.gramWeight / typical)) : 0);
  const best = portions.reduce((b, p) => (!b || off(p) < off(b) ? p : b), null);
  row[6] = [...portions]
    .sort((a, b) => (a === best ? -1 : b === best ? 1 : a.sequenceNumber - b.sequenceNumber))
    .map((p) => [p.portionDescription.trim(), r1(p.gramWeight)])
    .filter(([d]) => !seen.has(d) && seen.add(d));
  return row;
});

rows.sort((a, b) => a[0].localeCompare(b[0]));
const out = { source: "USDA FoodData Central, Survey foods (FNDDS)", version: process.argv[3] || src.match(/\d{4}-\d{2}-\d{2}/)?.[0] || "", foods: rows };
writeFileSync(new URL("../public/foods.json", import.meta.url), JSON.stringify(out));
console.log(`${rows.length} foods written to public/foods.json`);
