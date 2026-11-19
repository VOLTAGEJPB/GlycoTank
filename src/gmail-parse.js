// Turns food order emails into a list of what was ordered. Everything here runs
// on the phone: email contents are never sent to the GlycoTank server.

import { searchFoods, nutritionFor } from "./foods.js";

// Only mail from these senders is ever requested from Gmail.
const SENDERS = {
  "doordash.com": "DoorDash",
  "uber.com": "Uber Eats",
  "ubereats.com": "Uber Eats",
  "grubhub.com": "Grubhub",
  "seamless.com": "Seamless",
  "postmates.com": "Postmates",
  "mcdonalds.com": "McDonald's",
  "chipotle.com": "Chipotle",
  "starbucks.com": "Starbucks",
  "dominos.com": "Domino's",
  "pizzahut.com": "Pizza Hut",
  "tacobell.com": "Taco Bell",
  "wendys.com": "Wendy's",
  "bk.com": "Burger King",
  "chick-fil-a.com": "Chick-fil-A",
  "panerabread.com": "Panera Bread",
  "subway.com": "Subway",
  "dunkindonuts.com": "Dunkin'",
  "kfc.com": "KFC",
  "popeyes.com": "Popeyes",
  "sweetgreen.com": "Sweetgreen",
  "shakeshack.com": "Shake Shack",
  "fiveguys.com": "Five Guys",
};
// Company names shown on the Email receipts page.
export const SENDER_NAMES = [...new Set(Object.values(SENDERS))];
const DELIVERY_APPS = new Set(["DoorDash", "Uber Eats", "Grubhub", "Seamless", "Postmates"]);

export function gmailQuery(days = 14) {
  const from = Object.keys(SENDERS).map((d) => `from:${d}`).join(" ");
  return `newer_than:${days}d {${from}} {subject:receipt subject:order subject:"thanks for"}`;
}

function senderName(from) {
  const domain = (String(from).match(/@([\w.-]+)/)?.[1] || "").toLowerCase();
  const key = Object.keys(SENDERS).find((d) => domain === d || domain.endsWith(`.${d}`));
  return key ? SENDERS[key] : "";
}

// "Your receipt from Shake Shack" -> Shake Shack (on delivery apps, the restaurant).
function merchantFor(from, subject) {
  const sender = senderName(from);
  if (!DELIVERY_APPS.has(sender)) return sender;
  const place = String(subject).match(/\b(?:from|at)\s+(.+?)(?:\s+(?:is|has|was|with)\b|[!.]|$)/i)?.[1]?.trim();
  return place && place.length <= 40 ? `${place} via ${sender}` : sender;
}

const ENTITIES = { amp: "&", nbsp: " ", quot: '"', apos: "'", lt: "<", gt: ">", times: "×", reg: "", trade: "", eacute: "é", egrave: "è", ntilde: "ñ", rsquo: "’" };

export function htmlToText(html) {
  return String(html)
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(head|style|script)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(tr|p|div|li|h[1-6]|table)>|<br\s*\/?>/gi, "\n")
    .replace(/<\/t[dh]>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

const NOT_FOOD = /\b(sub-?total|total|tax|taxes|tip|gratuity|fees?|delivery|service|discount|promo|promotion|coupon|savings?|saved|credits?|refund|balance|payment|paid|charged?|visa|mastercard|amex|discover|apple pay|google pay|paypal|gift card|dasher|driver|courier|rewards?|points|membership|dashpass|uber one|adjustment|bag|bags|utensils?|napkins?|order\s*(#|number|no\b)|receipt)\b/i;
const PRICE_ONLY = /^\$\s?\d+(\.\d{2})?$/;
const QTY_ONLY = /^(\d{1,2})\s*[x×]?$/i;
const PRICED = /^(?:(\d{1,2})\s*[x×]?\s+|[x×]\s*(\d{1,2})\s+)?(.+?)(?:\s*[x×]\s*(\d{1,2}))?\s+\$\s?\d+(?:\.\d{2})?$/i;
const COUNTED = /^(\d{1,2})\s*[x×]\s+(.+)$/i;

// Cells of one row can arrive on separate lines: "1", "Big Mac", "$5.99".
function joinCells(text) {
  const lines = String(text).split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const out = [];
  for (const line of lines) {
    const prev = out[out.length - 1];
    if (prev !== undefined && QTY_ONLY.test(prev)) out[out.length - 1] = `${prev} ${line}`;
    else if (prev !== undefined && PRICE_ONLY.test(line) && !PRICE_ONLY.test(prev)) out[out.length - 1] = `${prev} ${line}`;
    else out.push(line);
  }
  return out;
}

export function parseItems(text) {
  const items = [];
  for (const line of joinCells(text)) {
    if (line.length > 90 || /^[+\-–•*]/.test(line) || NOT_FOOD.test(line)) continue; // add-ons start with a mark
    const priced = line.match(PRICED);
    const counted = priced ? null : line.match(COUNTED);
    if (!priced && !counted) continue;
    const name = (priced ? priced[3] : counted[2]).replace(/[\s:;,.-]+$/, "").trim();
    const qty = Math.min(12, +(priced ? priced[1] || priced[2] || priced[4] || 1 : counted[1]) || 1);
    if (name.length >= 2 && /[a-z]/i.test(name)) items.push({ name, qty });
  }
  return items;
}

const decode = (data) => {
  const bin = atob(String(data).replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
};

function bodies(part, found = { plain: "", html: "" }) {
  if (!part) return found;
  const data = part.body?.data;
  if (data && part.mimeType === "text/plain" && !found.plain) found.plain = decode(data);
  if (data && part.mimeType === "text/html" && !found.html) found.html = decode(data);
  (part.parts || []).forEach((p) => bodies(p, found));
  return found;
}

// A Gmail API message (format=full) -> { id, merchant, source, when, items }, or null if
// no food items could be read from it.
export function parseOrder(message) {
  const header = (name) => message.payload?.headers?.find((h) => h.name.toLowerCase() === name)?.value || "";
  const merchant = merchantFor(header("from"), header("subject"));
  if (!merchant) return null;
  const { plain, html } = bodies(message.payload);
  const fromPlain = parseItems(plain);
  const fromHtml = parseItems(htmlToText(html));
  const items = fromHtml.length > fromPlain.length ? fromHtml : fromPlain;
  return items.length ? { id: message.id, merchant, source: senderName(header("from")), when: +message.internalDate || Date.parse(header("date")) || 0, items } : null;
}

// Menu names the food list doesn't know, mapped to the closest everyday food.
// Fast food sides and drinks also get typical restaurant serving weights (grams).
const FRIES = { small: 75, medium: 115, large: 150 };
const SODA = { small: 350, medium: 500, large: 700 };
const ALIASES = [
  [/big mac|whopper|quarter pounder|mcdouble|baconator|double cheeseburger/i, "cheeseburger"],
  [/mcchicken|chicken sandwich/i, "chicken sandwich"],
  [/nugget/i, "chicken nuggets"],
  [/mcmuffin|breakfast sandwich/i, "egg sandwich on english muffin"],
  [/\bfries\b/i, "potato french fries fast food", FRIES],
  [/mcflurry|blizzard/i, "ice cream"],
  [/\b(diet|zero)\b.*\b(coke|coca-cola|pepsi|sprite)\b|\b(coke|coca-cola|pepsi|sprite)\b.*\b(diet|zero)\b/i, "soft drink cola diet", SODA],
  [/\b(coke|coca-cola|pepsi|sprite)\b/i, "soft drink cola", SODA],
  [/frappuccino|latte/i, "latte"],
  [/burrito bowl/i, "burrito"],
];
const SIZE_WORDS = /\b(small|medium|large|regular|kids?|classic|original|signature|meal|combo|pc|piece)\b|\(.*?\)|\d+/gi;

// The closest food in the built-in list, with nutrition for its usual portion.
export function matchFood(foods, name) {
  const [, alias, sizes] = ALIASES.find(([re]) => re.test(name)) || [];
  const words = String(name).replace(SIZE_WORDS, " ").replace(/[^\p{L}\s'-]/gu, " ").split(/\s+/).filter(Boolean);
  const last = words[words.length - 1] || "";
  const tries = [alias, words.join(" "), words.length > 2 ? words.slice(-2).join(" ") : ""];
  let row = null;
  for (const q of tries) row ||= q ? searchFoods(foods, q, 1)[0] : null;
  // Last resort: "Zzqx Burrito" is a burrito, but only if the food is named for that word.
  if (!row && last.length >= 4) {
    const hit = searchFoods(foods, last, 1)[0];
    if (hit?.[0].toLowerCase().startsWith(last.toLowerCase().replace(/s$/, ""))) row = hit;
  }
  if (!row) return null;
  if (sizes) {
    const size = String(name).match(/\b(small|medium|large)\b/i)?.[1]?.toLowerCase() || "medium";
    return { food: row[0], portion: size, ...nutritionFor(row, sizes[size]) };
  }
  const [portion, grams] = row[6][0] || ["100 g", 100];
  return { food: row[0], portion, ...nutritionFor(row, grams) };
}
