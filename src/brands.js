// Store products (Walmart's Great Value, Target's Good & Gather, Quaker and
// other brands) from Open Food Facts, shaped like rows of the USDA food list:
// [name, kcal, carbs, protein, fat, fiber, [[serving, grams]], {brand, code}]
// with nutrition per 100 g, so the same serving picker works for both.

import { Capacitor, CapacitorHttp } from "@capacitor/core";

const SEARCH = "https://world.openfoodfacts.org/cgi/search.pl";
const BACKUP = "https://search.openfoodfacts.org/search";
const FIELDS = "code,product_name,brands,serving_size,serving_quantity,nutriments";
// Open Food Facts allows about 10 searches a minute from one phone.
const PER_MINUTE = 8;
const sent = [];
const cache = new Map();

export class BrandSearchError extends Error {}

const num = (v) => (v == null || v === "" || !isFinite(parseFloat(v)) ? null : parseFloat(v));
const r1 = (n) => Math.round(n * 10) / 10;
const caps = (s) => (s === s.toUpperCase() ? s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()) : s);

// "1 cake (9 g)" -> ["1 cake", 9]; "18 pieces (31g)" -> ["18 pieces", 31]; "12g" -> ["1 serving", 12]
export function servingOf(text, quantity) {
  const grams = num(quantity) ?? num(String(text || "").match(/([\d.]+)\s*(g|ml)\b/i)?.[1]);
  if (!(grams > 0)) return null;
  let desc = String(text || "").replace(/\(.*?\)/g, "").replace(/\s+/g, " ").trim().toLowerCase()
    .replace(/[,\s]+[\d.]+\s*(g|ml|gr|grams?)$/, ""); // "13 pieces, 30 g"
  if (!desc || /^[\d.]+\s*(g|ml|gr|grams?)$/.test(desc)) desc = "1 serving";
  desc = desc.replace(/^1 portion\b/, "1 serving");
  if (!/^[\d./]+\s/.test(desc)) desc = `1 ${desc}`;
  return [desc, r1(grams)];
}

// One Open Food Facts product as a food-list row, or null when it has no calories.
export function brandRow(p) {
  const nu = p?.nutriments || {};
  const serving = servingOf(p?.serving_size, p?.serving_quantity);
  // Per 100 g, or worked out from the per-serving numbers.
  const per100 = (key) => {
    const v = num(nu[`${key}_100g`]);
    if (v != null) return v;
    const s = num(nu[`${key}_serving`]);
    return s != null && serving ? (s * 100) / serving[1] : null;
  };
  let kcal = per100("energy-kcal");
  if (kcal == null) {
    const kj = per100("energy");
    kcal = kj == null ? null : kj / 4.184;
  }
  if (kcal == null || kcal < 0 || kcal > 900) return null;
  const brand = caps(String([].concat(p.brands || "")[0] || "").split(",")[0].trim());
  const title = caps(
    String(p.product_name || "")
      .trim()
      .replace(/\s+[\d.]+\s*(ounce|oz|fl oz|lb|count|ct)\b.*$/i, "") // "... 4.47 Ounce Plastic Bag"
      .replace(/\s+-\s+.*$/, ""), // "Rice Cakes - Quaker - Quaker"
  );
  if (!title && !brand) return null;
  const name = brand && title && !title.toLowerCase().includes(brand.toLowerCase()) ? `${brand} ${title}` : title || brand;
  const v = (k) => r1(Math.max(0, per100(k) ?? 0));
  return [name, Math.round(kcal), v("carbohydrates"), v("proteins"), v("fat"), v("fiber"), serving ? [serving] : [], { brand, code: p.code || "" }];
}

const words = (s) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1);

// Products for a search, best matches first. Throws BrandSearchError when
// Open Food Facts can't be reached or is busy.
export async function searchBrands(query, limit = 15) {
  const key = words(query).join(" ");
  if (key.length < 3) return [];
  if (cache.has(key)) return cache.get(key);
  const url = `${SEARCH}?search_terms=${encodeURIComponent(key)}&search_simple=1&json=1&page_size=40&sort_by=unique_scans_n&countries_tags_en=united-states&fields=${FIELDS}`;
  const getJson = async (u) => {
    // In the app the request goes out natively: the newer search doesn't allow
    // web pages to call it, and Open Food Facts asks apps to name themselves.
    if (Capacitor.isNativePlatform()) {
      const res = await CapacitorHttp.get({ url: u, headers: { "User-Agent": "GlycoTank/1.0 (iOS and Android app)" }, connectTimeout: 10000, readTimeout: 10000 });
      if (res.status !== 200 || typeof res.data !== "object") throw new Error(`status ${res.status}`);
      return res.data;
    }
    const res = await fetch(u, { signal: AbortSignal.timeout?.(10000) });
    if (!res.ok || !/json/.test(res.headers.get("content-type") || "")) throw new Error(`status ${res.status}`);
    return res.json();
  };
  let products = null;
  // The main search has serving sizes but often turns a request away, so it
  // gets three tries.
  for (const wait of [0, 1000, 2500]) {
    const now = Date.now();
    while (sent.length && now - sent[0] > 60000) sent.shift();
    if (sent.length >= PER_MINUTE) break;
    if (wait) await new Promise((r) => setTimeout(r, wait));
    sent.push(Date.now());
    try {
      products = (await getJson(url)).products || [];
      break;
    } catch {}
  }
  // Then Open Food Facts' newer search: no serving sizes (ounces and grams
  // only), and US products picked out here.
  if (!products) {
    try {
      const hits = (await getJson(`${BACKUP}?q=${encodeURIComponent(key)}&page_size=40&fields=${FIELDS},countries_tags`)).hits || [];
      const us = hits.filter((p) => (p.countries_tags || []).includes("en:united-states"));
      products = us.length ? us : hits;
    } catch (e) {
      throw new BrandSearchError(String(e?.message || e));
    }
  }
  const rows = rankBrands(products, key).slice(0, limit);
  cache.set(key, rows);
  return rows;
}

// Products whose name or brand has every typed word come first; the rest keep
// Open Food Facts' order (most scanned first). Repeats are dropped.
export function rankBrands(products, query) {
  const q = words(query);
  const seen = new Set();
  const scored = [];
  products.forEach((p, i) => {
    const row = brandRow(p);
    if (!row) return;
    const id = `${row[0].toLowerCase()}|${row[6][0]?.[1] ?? ""}|${row[1]}`;
    if (seen.has(id)) return;
    seen.add(id);
    const have = words(row[0]);
    const hits = q.filter((w) => have.some((h) => h.startsWith(w) || h.startsWith(w.replace(/s$/, "")))).length;
    scored.push([hits === q.length ? 0 : hits ? 1 : 2, i, row]);
  });
  return scored.sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(([, , row]) => row);
}
