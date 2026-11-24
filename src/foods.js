// Food search: a built-in list of ~5,400 everyday foods with standard portions
// (USDA FoodData Central survey foods, public domain; see scripts/build-foods.mjs).
// The list ships with the app and loads on first search, so it works offline.
//
// A row is [name, kcal, carbs, protein, fat, fiber, portions], nutrients per
// 100 g, portions as [description, grams].

let loading = null;

export function loadFoods() {
  loading ??= fetch("foods.json")
    .then((r) => {
      if (!r.ok) throw new Error(`foods.json ${r.status}`);
      return r.json();
    })
    .then((d) => d.foods.map(indexFood))
    .catch((e) => {
      loading = null; // let the next search try again
      throw e;
    });
  return loading;
}

const EVERYDAY = new Set(["plain", "regular", "raw", "whole", "brewed", "nfs", "boiled", "grilled"]);
export const indexFood = (row) => ({ row, words: words(row[0]), head: words(row[0].split(",")[0]) });
const words = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9]+/).filter(Boolean);
// "bagels" finds "bagel", "berries" finds "berry"
const stems = (w) => [w, w.replace(/ies$/, "y"), w.replace(/es$/, ""), w.replace(/s$/, "")].filter((s, i, a) => s.length > 1 && a.indexOf(s) === i);

// Every typed word has to start some word of the food's name. Foods whose name
// starts with what was typed, and shorter, plainer names, rank first, so
// "cream cheese" puts "Cream cheese, regular, plain" above "Cheese spread, cream cheese".
// Menu names the USDA list doesn't carry, mapped to its closest food.
// Each key is the name squashed to letters, so "Mc Chicken" and "mcchicken" both work.
export const MENU_ITEMS = [
  ["mcchicken", "McChicken", "chicken fillet sandwich fried fast food"],
  ["mccrispy", "McCrispy", "chicken fillet sandwich fried fast food"],
  ["chickfila", "Chick-fil-A sandwich", "chicken fillet sandwich fried fast food"],
  ["chickensandwich", "Chicken sandwich", "chicken fillet sandwich fried fast food"],
  ["mcnugget", "McNuggets", "chicken nuggets fast food"],
  ["filetofish", "Filet-O-Fish", "fish sandwich fried fast food"],
  ["fishfillet", "Filet-O-Fish", "fish sandwich fried fast food"],
  ["mcmuffin", "McMuffin", "egg sandwich english muffin"],
  ["mcgriddle", "McGriddle", "egg cheese sausage"],
  ["hashbrown", "Hash brown", "potato hash brown fast food"],
  ["mcflurry", "McFlurry", "ice cream sundae"],
  ["blizzard", "Blizzard", "ice cream sundae"],
  ["frosty", "Frosty", "milk shake fast food"],
  ["crunchwrap", "Crunchwrap", "burrito"],
  ["chalupa", "Chalupa", "gordita"],
  ["baconator", "Baconator", "cheeseburger fast food large patty"],
];
const squash = (s) => String(s).toLowerCase().replace(/[^a-z]/g, "");

// The menu item a search is for, if it's one the food list only has under a plain name.
export function menuItemFor(query) {
  const q = squash(query);
  if (q.length < 4) return null;
  const hit = MENU_ITEMS.find(([key]) => key.startsWith(q) || q.startsWith(key));
  return hit ? { name: hit[1], query: hit[2] } : null;
}

export function searchFoods(list, query, limit = 25) {
  // "McChicken" isn't in the list, so show the closest plain foods first.
  const menu = menuItemFor(query);
  if (menu) {
    const close = plainSearch(list, menu.query, limit);
    const own = plainSearch(list, query, limit).filter((r) => !close.includes(r));
    return [...close, ...own].slice(0, limit);
  }
  const rows = plainSearch(list, query, limit);
  if (rows.length) return rows;
  return looseSearch(list, query, limit);
}

// When nothing has every word: drop leading words the list doesn't know, like a
// brand ("Quaker rice cakes" -> "rice cakes"), or split words typed together
// ("ricecake" -> "Rice cake"). The rows are marked `loose`.
function looseSearch(list, query, limit) {
  const q = words(query);
  let rows = [];
  for (let i = 1; i < q.length && !rows.length; i++) rows = plainSearch(list, q.slice(i).join(" "), limit);
  const joined = squash(query);
  if (!rows.length && q.length === 1 && joined.length >= 5) {
    rows = list
      .filter((f) => squash(f.row[0].split(",")[0]).startsWith(joined.replace(/s$/, "")))
      .sort((a, b) => a.row[0].length - b.row[0].length)
      .slice(0, limit)
      .map((f) => f.row);
  }
  rows.loose = rows.length > 0;
  return rows;
}

function plainSearch(list, query, limit) {
  const q = words(query);
  if (!q.length) return [];
  const found = [];
  for (const f of list) {
    let score = 0;
    let ok = true;
    for (let i = 0; i < q.length && ok; i++) {
      const forms = stems(q[i]);
      const at = f.words.findIndex((w) => forms.some((s) => w.startsWith(s)));
      if (at < 0) ok = false;
      else score += (at === i ? 30 : at < q.length + 1 ? 10 : 0) + (forms.includes(f.words[at]) ? 10 : 0);
    }
    if (!ok) continue;
    score -= f.words.length * 2 + (f.row[0].match(/,/g) || []).length * 3;
    // The food itself before its variations: "Banana, raw" before "Banana split".
    if (f.head.length === q.length && f.head.every((w, i) => stems(q[i]).includes(w))) score += 25;
    if (f.words.some((w) => EVERYDAY.has(w))) score += 6; // the everyday version first
    found.push([score, f.row]);
  }
  return found.sort((a, b) => b[0] - a[0] || a[1][0].length - b[1][0].length).slice(0, limit).map(([, row]) => row);
}

// Portions to choose from: the food's own (e.g. "1 regular", "1 tablespoon"),
// then ounces and grams for weighing.
export function portionsFor(row) {
  return [...row[6], ["oz", 28.35], ["g", 1]];
}

// Nutrition for `grams` of a food, rounded for display.
export function nutritionFor(row, grams) {
  const f = grams / 100;
  const r1 = (n) => Math.round(n * f * 10) / 10;
  return { kcal: Math.round(row[1] * f), carbs: r1(row[2]), protein: r1(row[3]), fat: r1(row[4]), fiber: r1(row[5]) };
}

const PLURAL = Object.fromEntries(
  ["cup", "tablespoon", "teaspoon", "slice", "piece", "egg", "banana", "apple", "fl oz", "bagel", "cookie", "muffin", "pancake", "waffle", "tortilla", "link", "patty", "strip", "stick", "bar", "can", "bottle", "packet", "serving", "breast", "thigh", "drumstick", "wing", "fillet", "sandwich", "cake", "cracker", "chip", "pouch", "container", "pack", "scoop", "bowl"]
    .map((w) => [w, w === "fl oz" ? w : w.endsWith("ch") ? `${w}es` : `${w}s`]),
);

// "1 tablespoon" x 2 -> "2 tablespoons"; "1 regular" x 2 -> "2 regular"; "oz" x 3 -> "3 oz"; "1 cup" x 0.5 -> "0.5 cup"
export function portionLabel(desc, qty) {
  const q = Math.round(qty * 100) / 100;
  const m = desc.match(/^1\s+(.*)$/);
  if (m) return q === 1 ? desc : `${q} ${PLURAL[m[1]] || m[1]}`;
  return /^(oz|g)$/.test(desc) ? `${q} ${desc}` : `${q} × ${desc}`;
}

// Totals for a list of meal items.
export function sumItems(items) {
  const t = { kcal: 0, carbs: 0, protein: 0, fat: 0, fiber: 0 };
  for (const it of items) for (const k in t) t[k] += +it[k] || 0;
  for (const k in t) t[k] = k === "kcal" ? Math.round(t[k]) : Math.round(t[k] * 10) / 10;
  return t;
}
