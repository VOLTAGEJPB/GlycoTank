import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gmailQuery, htmlToText, parseItems, parseOrder, matchFood } from "../src/gmail-parse.js";
import { indexFood } from "../src/foods.js";

const foods = JSON.parse(readFileSync(new URL("../public/foods.json", import.meta.url))).foods.map(indexFood);
const b64 = (s) => Buffer.from(s, "utf8").toString("base64url");
const message = (from, subject, parts) => ({
  id: "m1",
  internalDate: "1763500000000",
  payload: { mimeType: "multipart/alternative", headers: [{ name: "From", value: from }, { name: "Subject", value: subject }], parts },
});

test("the Gmail search only asks for food senders and order emails", () => {
  const q = gmailQuery(7);
  assert.match(q, /^newer_than:7d /);
  assert.match(q, /from:doordash\.com/);
  assert.match(q, /from:mcdonalds\.com/);
  assert.match(q, /subject:receipt/);
  assert.doesNotMatch(q, /from:gmail\.com/);
});

test("reads items and quantities, skipping totals and fees", () => {
  const items = parseItems(["2 x Big Mac $11.98", "1 Large Fries $4.29", "McFlurry $3.99", "+ Extra sauce $0.50", "Subtotal $20.76", "Delivery Fee $2.99", "Tax $1.80", "Dasher Tip $4.00", "Total $29.55", "Visa ending 1234 $29.55"].join("\n"));
  assert.deepEqual(items, [{ name: "Big Mac", qty: 2 }, { name: "Large Fries", qty: 1 }, { name: "McFlurry", qty: 1 }]);
});

test("joins table cells that arrive on separate lines", () => {
  assert.deepEqual(parseItems("1\nChicken Burrito\n$9.75\nTotal\n$9.75"), [{ name: "Chicken Burrito", qty: 1 }]);
});

test("turns receipt HTML into readable rows", () => {
  const text = htmlToText("<style>td{}</style><table><tr><td>1x</td><td>Caf&eacute; Latte &amp; Scone</td><td>&#36;7.50</td></tr></table>");
  assert.match(text, /1x Café Latte & Scone \$7\.50/);
});

test("parses a delivery app email and names the restaurant", () => {
  const html = "<table><tr><td>2</td><td>Spicy Chicken Sandwich</td><td>$15.00</td></tr><tr><td>Subtotal</td><td>$15.00</td></tr></table>";
  const order = parseOrder(message("DoorDash <no-reply@doordash.com>", "Your receipt from Shake Shack", [{ mimeType: "text/html", body: { data: b64(html) } }]));
  assert.equal(order.merchant, "Shake Shack via DoorDash");
  assert.equal(order.source, "DoorDash");
  assert.deepEqual(order.items, [{ name: "Spicy Chicken Sandwich", qty: 2 }]);
});

test("reads back 30 days when asked", () => {
  assert.match(gmailQuery(30), /newer_than:30d/);
});

test("ignores other senders and emails with no food items", () => {
  const body = [{ mimeType: "text/plain", body: { data: b64("1 x Big Mac $5.99") } }];
  assert.equal(parseOrder(message("Someone <a@example.com>", "Your order", body)), null);
  const none = [{ mimeType: "text/plain", body: { data: b64("Your order is on the way!") } }];
  assert.equal(parseOrder(message("McDonald's <x@us.mcdonalds.com>", "Your order", none)), null);
});

test("matches menu names to everyday foods", () => {
  assert.match(matchFood(foods, "Big Mac").food, /cheeseburger/i);
  assert.match(matchFood(foods, "Large Fries").food, /french fries/i);
  assert.ok(matchFood(foods, "Big Mac").kcal > 150);
  assert.equal(matchFood(foods, "Zzqx Wibble"), null);
  assert.equal(matchFood(foods, "Zzqx Special"), null);
  assert.match(matchFood(foods, "Zzqx Burrito").food, /^burrito/i);
});

test("sizes fast food sides and drinks like a restaurant serves them", () => {
  const large = matchFood(foods, "Large Fries");
  const small = matchFood(foods, "Small Fries");
  assert.equal(large.portion, "large");
  assert.ok(large.kcal >= 350 && large.kcal <= 600, `large fries: ${large.kcal}`);
  assert.ok(small.kcal < large.kcal);
  assert.match(matchFood(foods, "Medium Coke").food, /^soft drink, cola/i);
  assert.ok(matchFood(foods, "Large Diet Coke").kcal < 30);
  assert.match(matchFood(foods, "Egg McMuffin").food, /^egg/i);
});
