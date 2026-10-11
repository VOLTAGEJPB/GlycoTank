// Pure calculation logic for GlycoTank: no DOM, no storage. Everything here is
// unit-tested in test/model.test.js.

export const DEFAULT_SETTINGS = {
  kcalTarget: 2200,
  proteinTarget: 140,
  fiberTarget: 28,
  carbGuide: 250,
  glycoCap: 400, // grams of glycogen the "tank" holds when full
  uptakePct: 85, // share of dietary carbs that ends up stored
  setCost: 6, // grams used per hard strength set
  cardioGpm: 0.33, // grams per minute of cardio at intensity 1
  otherCost: 10, // grams for a sport/other session
  dailyUse: 150, // grams/day used by the brain and everyday activity when the tank is full (scales with how full it is)
  units: "lb", // display units for body weight and lifts
  reminders: { log: "", checkin: "" }, // "HH:MM" or ""
};

const START_FRACTION = 0.7; // assumed tank level before the first logged day
const PLAN_TARGET_FRACTION = 0.75; // the carb planner aims to start tomorrow here
const HISTORY_LIMIT_DAYS = 120;

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const n = (v) => (Number.isFinite(+v) ? +v : 0);

// Local calendar date as YYYY-MM-DD (not UTC, so evening entries stay on the right day).
export function localDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return localDate(new Date(y, m - 1, d + days));
}

export function workoutCost(w, s) {
  if (w.type === "strength") return n(w.sets) * s.setCost;
  if (w.type === "cardio") return n(w.mins) * s.cardioGpm * clamp(n(w.intensity) || 1, 1, 5);
  return s.otherCost;
}

export function dayTotals(state, date) {
  const meals = state.meals.filter((m) => m.date === date);
  const sum = (k) => meals.reduce((t, m) => t + n(m[k]), 0);
  return { kcal: sum("kcal"), carbs: sum("carbs"), protein: sum("protein"), fat: sum("fat"), fiber: sum("fiber"), meals };
}

// Day-by-day glycogen estimate up to `endDate`. Each day starts where the
// previous one ended; meals add carbs × uptake%, everyday use and workouts
// subtract, and the level stays between 0 and the tank's capacity.
// Everyday use scales with how full the tank is (a fuller tank burns more
// carbohydrate, a low one shifts toward fat), so the level settles where it
// matches the diet instead of drifting to empty or full.
// Days before the first entry aren't simulated: the tank starts at 70% then.
// Days with no meals logged are treated as "not tracked" rather than fasting,
// so everyday use only applies on days with food logged (training still counts).
export function glycoSeries(state, endDate) {
  const s = state.settings;
  const dates = [...state.meals, ...state.workouts].map((x) => x.date).filter((d) => d <= endDate).sort();
  const earliest = addDays(endDate, -HISTORY_LIMIT_DAYS);
  let date = !dates.length ? endDate : dates[0] > earliest ? dates[0] : earliest;

  const series = {};
  let level = s.glycoCap * START_FRACTION;
  for (;;) {
    const meals = state.meals.filter((m) => m.date === date);
    const added = meals.reduce((t, m) => t + n(m.carbs) * (s.uptakePct / 100), 0);
    const training = state.workouts.filter((w) => w.date === date).reduce((t, w) => t + workoutCost(w, s), 0);
    const start = level;
    const cost = training + (meals.length ? everydayUse(start, s) : 0);
    level = clamp(start + added - cost, 0, s.glycoCap);
    series[date] = { start, added, training, cost, end: level };
    if (date === endDate) break;
    date = addDays(date, 1);
  }
  return series;
}

export function everydayUse(level, s) {
  return s.glycoCap > 0 ? n(s.dailyUse) * clamp(level / s.glycoCap, 0, 1) : 0;
}

export function glycoStatus(level, cap) {
  const pct = cap > 0 ? (level / cap) * 100 : 0;
  if (pct < 25) return { pct, tone: "low", label: "Low: consider carbs or rest" };
  if (pct < 50) return { pct, tone: "mid", label: "Moderate: an easier day fits" };
  return { pct, tone: "good", label: "Good: ready to train" };
}

// Extra carbs to eat today so that, after tomorrow's everyday use and planned
// training, the tank is still at ~75% of capacity. Capped at 1.5× the daily
// carb guide: a very low tank takes a few days to refill, not one huge meal.
export function carbPlan(todayEnd, plannedCost, s) {
  const target = s.glycoCap * PLAN_TARGET_FRACTION;
  const needed = target - todayEnd + plannedCost + everydayUse(target, s);
  const grams = needed > 0 ? needed / (Math.max(10, s.uptakePct) / 100) : 0;
  const max = n(s.carbGuide) * 1.5;
  return { grams: max ? Math.min(grams, max) : grams, capped: !!max && grams > max };
}

export function plannedCost({ sets = 0, mins = 0, intensity = 3 }, s) {
  return workoutCost({ type: "strength", sets }, s) + workoutCost({ type: "cardio", mins, intensity }, s);
}

const MOOD_FACTOR = { great: 1.1, ok: 1.0, tired: 0.85, stressed: 0.8, sore: 0.85 };

// Readiness score (0–100) from a check-in. A normal night (7 h sleep, resting
// heart rate at your usual level, feeling OK) scores 70. Each hour of sleep
// moves it 6 points; each beat per minute above your own recent average
// costs 2 points (below adds 1); mood scales the result.
export function readiness(check, baselineRhr = null) {
  if (!check) return null;
  const sleep = clamp(n(check.sleep) || 7, 0, 12);
  const rhr = n(check.rhr);
  const diff = rhr && baselineRhr ? rhr - baselineRhr : 0;
  const base = 70 + (sleep - 7) * 6 - (diff > 0 ? diff * 2 : diff);
  const score = Math.round(clamp(base * (MOOD_FACTOR[check.mood] ?? 1), 0, 100));
  return { score, label: score >= 70 ? "Train" : score >= 50 ? "Go easy" : "Rest" };
}

// Average resting heart rate over the 14 check-ins before `date`, or null.
export function baselineRhr(state, date) {
  const prior = state.checks
    .filter((c) => c.date < date && n(c.rhr) > 0)
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 14);
  return prior.length ? prior.reduce((t, c) => t + n(c.rhr), 0) / prior.length : null;
}

export function latestCheck(state) {
  return [...state.checks].sort((a, b) => (a.date < b.date ? 1 : -1))[0] || null;
}

export function readinessFor(state, check) {
  return check ? readiness(check, baselineRhr(state, check.date)) : null;
}

// Consecutive days, ending today (or yesterday, if nothing is logged yet today), with any entry.
export function streak(state, today) {
  const active = new Set([...state.meals, ...state.workouts, ...state.checks].map((x) => x.date));
  let day = active.has(today) ? today : addDays(today, -1);
  let count = 0;
  while (active.has(day)) {
    count++;
    day = addDays(day, -1);
  }
  return count;
}

export function lastNDays(today, days) {
  return Array.from({ length: days }, (_, i) => addDays(today, -(days - 1 - i)));
}

// ---- Personalized targets ----
// Mifflin-St Jeor BMR × 1.2, plus exercise calories from METs (Compendium of
// Physical Activities), adjusted for the weekly weight-change goal at
// ~3,500 kcal per pound.

const KG_PER_LB = 0.45359237;

export function bmr({ kg, cm, age, sex }) {
  if (!kg || !cm) return 0;
  const base = 10 * kg + 6.25 * cm - 5 * (age || 30);
  return sex === "f" ? base - 161 : base + 5;
}

const kcalFromMet = (kg, met, mins) => ((met * 3.5 * kg) / 200) * mins;
const CARDIO_MET = [0, 3, 5, 7, 9, 11];

export function personalize(p) {
  const kg = p.weightUnits === "lb" ? n(p.weight) * KG_PER_LB : n(p.weight);
  const cm = p.heightUnits === "ftin" ? (n(p.heightFt) * 12 + n(p.heightIn)) * 2.54 : n(p.heightCm);
  if (!kg || !cm) return null;
  const goal = p.goal || "maintain";
  const days = n(p.daysPerWeek);
  const sets = n(p.setsPerSession);
  const cardioMins = n(p.cardioMinsPerWeek);
  const intensity = clamp(n(p.cardioIntensity) || 3, 1, 5);
  let lbPerWeek = clamp(n(p.lbPerWeek), -2, 2);
  if (goal === "maintain") lbPerWeek = 0;
  if (goal === "cut") lbPerWeek = -Math.abs(lbPerWeek);
  if (goal === "gain") lbPerWeek = Math.abs(lbPerWeek);

  const exerciseWeek = kcalFromMet(kg, 3.5, sets * 2 * days) + kcalFromMet(kg, CARDIO_MET[intensity], cardioMins);
  const tdee = bmr({ kg, cm, age: n(p.age), sex: p.sex }) * 1.2 + exerciseWeek / 7;
  const floor = p.sex === "f" ? 1200 : 1500;
  const kcalTarget = Math.round(Math.max(floor, tdee + (lbPerWeek * 3500) / 7));

  const proteinPerKg = goal === "cut" ? (Math.abs(lbPerWeek) >= 0.75 ? 2.2 : 2.0) : goal === "gain" ? 1.8 : 2.0;
  const fatPerKg = goal === "cut" ? 0.6 : goal === "gain" ? 1.0 : 0.8;
  const proteinTarget = Math.round(kg * proteinPerKg);
  const fat = Math.round(kg * fatPerKg);
  const carbGuide = Math.max(0, Math.round((kcalTarget - proteinTarget * 4 - fat * 9) / 4));
  const fiberTarget = Math.round(clamp((14 * kcalTarget) / 1000, 20, 45));

  return {
    tdee: Math.round(tdee),
    kcalTarget,
    proteinTarget,
    fatTarget: fat,
    carbGuide,
    fiberTarget,
    glycoCap: Math.round(clamp(350 + (kg - 70) * 1.8 + days * 12 + cardioMins / 4, 300, 600)),
    uptakePct: goal === "gain" ? 90 : goal === "cut" || p.lowCarb ? 80 : 85,
    setCost: +clamp(5.5 + (kg > 90 ? 0.7 : kg < 65 ? -0.5 : 0), 4.5, 7.5).toFixed(1),
    cardioGpm: kg < 65 ? 0.25 : kg > 90 ? 0.36 : 0.33,
    dailyUse: Math.round(clamp(kg * 1.8, 100, 220)),
    calorieFloorApplied: tdee + (lbPerWeek * 3500) / 7 < floor,
  };
}

// Plate loading per side, greedy from heaviest plate.
export function plateMath(target, bar, units) {
  const plates = units === "kg" ? [25, 20, 15, 10, 5, 2.5, 1.25] : [45, 35, 25, 10, 5, 2.5];
  if (!(target > bar)) return { plates: [], remainder: 0 };
  let side = (target - bar) / 2;
  const used = [];
  for (const p of plates) {
    while (side >= p - 1e-9) {
      used.push(p);
      side -= p;
    }
  }
  return { plates: used, remainder: Math.round(side * 2 * 100) / 100 };
}

// Reads macros from free text such as "650 cal 70c 45p 18f 8 fiber" or
// "calories 500 carbs 60 protein 32". Whether numbers come before or after
// their labels is decided by which appears first. Unmentioned values are null.
const MEAL_LABELS = {
  kcal: ["kcal", "cal", "cals", "calorie", "calories"],
  carbs: ["c", "carb", "carbs"],
  protein: ["p", "prot", "protein"],
  fat: ["f", "fat", "fats"],
  fiber: ["fib", "fiber", "fibre"],
};

export function parseMealText(text) {
  const out = { kcal: null, carbs: null, protein: null, fat: null, fiber: null };
  const tokens = [...text.matchAll(/(\d+(?:\.\d+)?)|([a-z]+)/gi)]
    .map((m) => (m[1] ? { num: parseFloat(m[1]) } : { word: m[2].toLowerCase() }))
    .filter((t) => t.num != null || t.word !== "g");
  const keyFor = (word) => Object.keys(MEAL_LABELS).find((k) => MEAL_LABELS[k].includes(word));
  const firstNum = tokens.findIndex((t) => t.num != null);
  const firstLabel = tokens.findIndex((t) => t.word && keyFor(t.word));
  if (firstNum < 0 || firstLabel < 0) return out;
  const numberFirst = firstNum < firstLabel;
  for (let i = 0; i < tokens.length - 1; i++) {
    const [a, b] = numberFirst ? [tokens[i], tokens[i + 1]] : [tokens[i + 1], tokens[i]];
    const key = b.word && keyFor(b.word);
    if (a.num != null && key && out[key] == null) out[key] = a.num;
  }
  return out;
}

// ---- Scanning ----

// Pulls calories and macros out of text read from a Nutrition Facts panel by
// on-device OCR. Handles US labels ("Total Carbohydrate 37g") and EU-style
// labels ("Carbohydrate 37 g", "250 kcal"). OCR often reads a 0 before "g" as
// the letter O, so that's corrected first. Missing values come back as null.
export function parseNutritionLabel(rawText) {
  const text = rawText
    .replace(/\r/g, "")
    .replace(/\b[Oo](?=\s?m?g\b)/g, "0") // "Og" -> "0g"
    .replace(/(\d),(\d)/g, "$1.$2") // European decimal commas
    .replace(/[ \t]+/g, " ");
  const flat = text.replace(/\n/g, " ");
  const grams = (label) => {
    const m = flat.match(new RegExp(String.raw`(?:${label})\b[^0-9]{0,25}?(\d+(?:\.\d+)?)\s?g\b`, "i"));
    return m ? parseFloat(m[1]) : null;
  };
  // OCR often reads a label's left column first and the right column after, so
  // "Calories" and "230" (or "Serving size" and "2/3 cup") can end up far apart.
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  let kcal = null;
  const kcalMatch = flat.match(/(\d{2,4})\s?kcal/i) || flat.match(/calories\b[^0-9a-z%]{0,6}(\d{2,4})\b(?!\s?(?:m?g|%))/i);
  if (kcalMatch) kcal = parseInt(kcalMatch[1], 10);
  else if (/calories/i.test(flat)) {
    const lone = lines.find((l) => /^\d{2,4}$/.test(l) && +l >= 10 && +l <= 2000);
    if (lone) kcal = parseInt(lone, 10);
  }
  const UNITS = "cups?|tbsps?|tsps?|oz|g|ml|pieces?|bars?|slices?|containers?|packages?|packets?|cans?|bottles?|scoops?|servings?|crackers?|cookies?|chips?";
  const amount = new RegExp(String.raw`^\d[\d/.\s]*\s?(?:${UNITS})\b`, "i");
  let serving = flat.match(/serving size\s*:?\s*([^\n]{1,40}?)(?=\s+(?:amount|servings|calories|per\b)|$)/i)?.[1]?.trim() || null;
  if (!serving || !/\d/.test(serving)) serving = lines.find((l) => amount.test(l) && !/servings? per/i.test(l)) || null;
  return {
    kcal,
    carbs: grams(String.raw`total carbohydrates?|total carbs?|total carb\.?|carbohydrates?|carbs`),
    protein: grams("protein"),
    fat: grams(String.raw`total fat|fat`),
    fiber: grams(String.raw`dietary fiber|dietary fibre|fiber|fibre`),
    serving,
  };
}

// Converts an Open Food Facts product into meal values. Uses per-serving
// numbers when the product has them, otherwise per 100 g.
export function fromOpenFoodFacts(product) {
  if (!product) return null;
  const nu = product.nutriments || {};
  const pick = (key, basis) => {
    const v = nu[`${key}_${basis}`];
    return v == null || v === "" ? null : Math.round(parseFloat(v) * 10) / 10;
  };
  const hasServing = nu["energy-kcal_serving"] != null || nu.carbohydrates_serving != null;
  const basis = hasServing ? "serving" : "100g";
  let kcal = pick("energy-kcal", basis);
  if (kcal == null && nu[`energy_${basis}`] != null) kcal = Math.round(parseFloat(nu[`energy_${basis}`]) / 4.184); // kJ -> kcal
  const brand = product.brands?.split(",")[0]?.trim();
  const title = product.product_name?.trim();
  // Skip the brand when the product name already includes it ("Cheerios" by Cheerios).
  const name = brand && title && !title.toLowerCase().includes(brand.toLowerCase()) ? `${brand} ${title}` : title || brand;
  return {
    name: name || "Scanned item",
    kcal: kcal == null ? null : Math.round(kcal),
    carbs: pick("carbohydrates", basis),
    protein: pick("proteins", basis),
    fat: pick("fat", basis),
    fiber: pick("fiber", basis),
    serving: basis === "serving" ? product.serving_size || "1 serving" : "100 g",
  };
}
