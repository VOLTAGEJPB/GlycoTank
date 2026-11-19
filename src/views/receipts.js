// More > Email receipts: the linked Gmail account, the companies orders came
// from, and new food orders to log. Each order is logged on the day it was
// placed, in the meal that fits the time it was placed.

import { localDate, slotForHour, MEAL_SLOTS } from "../model.js";
import { loadFoods, searchFoods } from "../foods.js";
import { gmailAvailable, gmailLinked, gmailAccount, linkGmail, gmailOrders, skipOrder, unlinkGmail, ORDER_DAYS } from "../gmail.js";
import { matchFood, matchRow, SENDER_NAMES } from "../gmail-parse.js";
import { ScanError } from "../scan.js";
import { uid } from "../store.js";
import { haptic } from "../motion.js";
import { $, $$, esc, toast, success, confirmDialog, prettyDate } from "../ui.js";

const SHARES = [[1, "All"], [0.5, "Half"], [0.25, "A quarter"]];
const NUTRIENTS = ["kcal", "carbs", "protein", "fat", "fiber"];
const svg = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
const MAIL = "M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4-8 5-8-5V6l8 5 8-5v2z";
const PLATE = "M11 9H9V2H7v7H5V2H3v7c0 2.12 1.66 3.84 3.75 3.97V22h2.5v-9.03C11.34 12.84 13 11.12 13 9V2h-2v7zm5-3v8h2.5v8H21V2c-2.76 0-5 2.24-5 4z";
const CHECK = "M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z";

const timeOf = (ms) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const initials = (name) => name.replace(/[^\p{L}\s-]/gu, "").split(/[\s-]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
const hue = (name) => [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);

const report = (err) => {
  if (!(err instanceof ScanError)) console.error(err);
  toast(err instanceof ScanError ? err.message : "Something went wrong. Please try again.");
};

// A small picture of how it works: receipts travel from the inbox into the log.
const hero = (moving) => `
  <div class="link-hero ${moving ? "moving" : ""}" aria-hidden="true">
    <span class="lh-node">${svg(MAIL)}</span>
    <span class="lh-track">
      ${["DoorDash", "McDonald's", "Uber Eats"].map((n, i) => `<span class="lh-chip" style="--d:${i * 1.3}s">${esc(n)}</span>`).join("")}
    </span>
    <span class="lh-node lh-app">${svg(PLATE)}</span>
  </div>`;

export async function renderReceipts(root, app, justLinked = false) {
  if (!gmailAvailable()) {
    root.innerHTML = `
      <section class="card">
        ${hero(true)}
        <h2>Email receipts</h2>
        <p class="hint">Email receipts work in the GlycoTank iPhone app. Link Gmail there to log your restaurant and delivery orders.</p>
      </section>`;
    return;
  }
  const linked = await gmailLinked().catch(() => false);
  if (!root.isConnected) return;
  if (!linked) return renderUnlinked(root, app);

  const account = await gmailAccount().catch(() => "");
  root.innerHTML = `
    <section class="card">
      <h2>Linked accounts</h2>
      <div class="account-row linked ${justLinked ? "just" : ""}" style="--i:0">
        <span class="more-icon">${svg(MAIL)}<span class="linked-badge">${svg(CHECK)}</span></span>
        <span class="more-text"><strong>Gmail</strong><span>${esc(account || "Linked")} · last ${ORDER_DAYS} days</span></span>
        <button type="button" class="btn ghost small" id="rUnlink">Unlink</button>
      </div>
    </section>
    <section class="card">
      <div class="card-head"><h2>Companies</h2><span class="sub" id="rFound">Checking…</span></div>
      <div class="co-grid scanning" id="rCompanies">${companyTiles(new Map())}</div>
    </section>
    <section class="card">
      <div class="card-head"><h2>New orders</h2><button type="button" class="btn ghost small" id="rRefresh">Check again</button></div>
      <div id="rOrders"><p class="hint">Checking your Gmail…</p></div>
    </section>`;

  $("#rUnlink").addEventListener("click", async () => {
    if (!(await confirmDialog("Unlink Gmail? GlycoTank will stop checking your email for food orders.", "Unlink"))) return;
    await unlinkGmail();
    toast("Gmail unlinked");
    renderReceipts(root, app);
  });
  $("#rRefresh").addEventListener("click", () => load(root, app, true));
  load(root, app, justLinked);
}

function renderUnlinked(root, app) {
  root.innerHTML = `
    <section class="card link-card">
      ${hero(true)}
      <h2>Log restaurant orders from your email</h2>
      <ol class="link-steps">
        <li style="--i:0"><span>1</span>Link your Gmail account.</li>
        <li style="--i:1"><span>2</span>GlycoTank finds food orders from the last ${ORDER_DAYS} days.</li>
        <li style="--i:2"><span>3</span>Tick what you ate. It's logged on the day you ordered.</li>
      </ol>
      <button type="button" class="btn primary wide" id="rLink">Link Gmail</button>
      <p class="hint link-note">GlycoTank can only read your email, never send or delete it. Your emails stay on this phone and aren't sent to our servers. You can unlink anytime.</p>
    </section>`;
  $("#rLink").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = "Waiting for Google…";
    try {
      await linkGmail();
      haptic.success();
      renderReceipts(root, app, true);
    } catch (err) {
      report(err);
      btn.disabled = false;
      btn.textContent = "Link Gmail";
    }
  });
}

async function load(root, app, fresh) {
  const btn = $("#rRefresh");
  if (btn) btn.disabled = true;
  $("#rCompanies")?.classList.add("scanning");
  try {
    const [orders, foods] = await Promise.all([gmailOrders(fresh), loadFoods()]);
    if (!root.isConnected) return;
    const withFoods = orders.map((o) => ({ ...o, items: o.items.map((it) => ({ ...it, match: matchFood(foods, it.name) })) }));
    showCompanies(withFoods);
    showOrders(root, app, withFoods, foods);
  } catch (err) {
    if (!root.isConnected) return;
    // An expired link is cleared by gmail.js, so show the link screen again.
    if (!(await gmailLinked().catch(() => false))) return renderUnlinked(root, app);
    $("#rOrders").innerHTML = `<p class="hint">${esc(err instanceof ScanError ? err.message : "Couldn't check your Gmail. Please try again.")}</p>`;
    $("#rCompanies").classList.remove("scanning");
    $("#rFound").textContent = "";
  } finally {
    if (btn?.isConnected) btn.disabled = false;
  }
}

// Every company GlycoTank looks for. Ones with new orders light up, first.
function companyTiles(counts) {
  const names = [...new Set([...counts.keys(), ...SENDER_NAMES])].sort((a, b) => (counts.get(b) || 0) - (counts.get(a) || 0));
  return names.map((name, i) => {
    const n = counts.get(name) || 0;
    return `
      <div class="co ${n ? "found" : ""}" style="--i:${i};--h:${hue(name)}">
        <span class="co-badge">${esc(initials(name))}${n ? `<b>${n}</b>` : ""}</span>
        <span class="co-name">${esc(name)}</span>
      </div>`;
  }).join("");
}

function showCompanies(orders) {
  const counts = new Map();
  for (const o of orders) counts.set(o.source || o.merchant, (counts.get(o.source || o.merchant) || 0) + 1);
  const grid = $("#rCompanies");
  grid.classList.remove("scanning");
  grid.innerHTML = companyTiles(counts);
  $("#rFound").textContent = counts.size ? `${counts.size} with new orders` : `No new orders in ${ORDER_DAYS} days`;
}

// One ordered item: tick it, say how much you ate, or change what it's matched to.
function itemRow(n, i, it) {
  const m = it.match;
  const what = m ? `${m.custom ? "Your calories" : `Closest match: ${esc(m.food)}`} · ${Math.round(m.kcal * it.qty)} kcal` : "No match yet. Tap Find to pick a food.";
  return `
    <li data-item="${n}-${i}"><label class="receipt-item"><input type="checkbox" data-e="${n}-${i}" ${m ? "checked" : "disabled"}>
      <span class="mi-name"><strong>${it.qty > 1 ? `${it.qty} × ` : ""}${esc(it.name)}</strong><small>${what}</small></span></label>
      ${m ? `<select data-eshare="${n}-${i}" aria-label="How much of ${esc(it.name)} you ate">${SHARES.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select>` : ""}
      <button type="button" class="item-change" data-echange="${n}-${i}" aria-expanded="false">${m ? "Change" : "Find"}</button>
    </li>`;
}

// Search the food list, or type in the calories from the restaurant's menu.
function pickerFor(n, i, it) {
  const dish = String(it.name).split(/\s+[-–—]\s+|:\s+/)[0];
  return `
    <li class="item-pick" data-pick="${n}-${i}">
      <input type="search" data-pq="${n}-${i}" value="${esc(dish)}" placeholder="Search foods" aria-label="Search foods for ${esc(it.name)}" enterkeyhint="search">
      <div class="pick-results" data-pr="${n}-${i}"></div>
      <div class="pick-own"><span>Know the calories? Check the restaurant's menu.</span>
        <div><input type="number" inputmode="numeric" min="1" max="5000" data-pown="${n}-${i}" placeholder="kcal" aria-label="Calories for one ${esc(it.name)}"><button type="button" class="btn ghost small" data-puse="${n}-${i}">Use</button></div></div>
    </li>`;
}

function showOrders(root, app, orders, foods) {
  const box = $("#rOrders");
  const today = localDate();
  if (!orders.length) {
    box.innerHTML = `<p class="hint">You're all caught up. New orders show up here after you place them.</p>`;
    return;
  }
  box.innerHTML = orders.map((o, n) => {
    const when = new Date(o.when);
    const slot = slotForHour(when.getHours());
    return `
    <div class="email-order" style="--i:${n}">
      <div class="email-order-head"><strong>${esc(o.merchant)}</strong><small>${esc(prettyDate(localDate(when), today))} at ${esc(timeOf(o.when))}</small></div>
      <ul class="receipt-list">${o.items.map((it, i) => itemRow(n, i, it)).join("")}</ul>
      <label class="field email-slot"><span>Log to ${esc(prettyDate(localDate(when), today))}</span>
        <select data-eslot="${n}">${MEAL_SLOTS.map(([k, l]) => `<option value="${k}" ${k === slot ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <div class="actions"><button type="button" class="btn primary" data-eadd="${n}">Add to log</button><button type="button" class="btn ghost" data-eskip="${n}">Skip</button></div>
    </div>`;
  }).join("");

  // The order card slides away before the list redraws.
  const done = async (n, added) => {
    await skipOrder(orders[n].id);
    const card = $$(".email-order", box)[n];
    card?.classList.add(added ? "leaving added" : "leaving");
    setTimeout(() => {
      if (!box.isConnected) return;
      const rest = orders.filter((_, i) => i !== n);
      showCompanies(rest);
      showOrders(root, app, rest, foods);
    }, card ? 380 : 0);
  };

  $$("[data-eadd]", box).forEach((b) => b.addEventListener("click", async () => {
    const n = +b.dataset.eadd;
    const o = orders[n];
    const items = [];
    o.items.forEach((it, i) => {
      if (!it.match || !$(`[data-e="${n}-${i}"]`, box).checked) return;
      const share = +$(`[data-eshare="${n}-${i}"]`, box).value;
      const amount = it.qty * share;
      const scaled = Object.fromEntries(NUTRIENTS.map((k) => [k, Math.round(it.match[k] * amount * 10) / 10]));
      const label = share === 1 ? "" : `${SHARES.find(([v]) => v === share)[1].toLowerCase()} of `;
      items.push({ name: it.name, short: it.name, ...scaled, kcal: Math.round(scaled.kcal), portion: `${label}${it.qty > 1 ? `${it.qty} × ` : ""}${it.match.portion}`, source: "email" });
    });
    if (!items.length) return toast("Tick at least one item");
    const totals = Object.fromEntries(NUTRIENTS.map((k) => [k, Math.round(items.reduce((sum, it) => sum + (it[k] || 0), 0) * 10) / 10]));
    totals.kcal = Math.round(totals.kcal);
    const date = localDate(new Date(o.when));
    const slot = $(`[data-eslot="${n}"]`, box).value;
    app.state.meals.push({ id: uid(), name: o.merchant, ...totals, notes: "From an email receipt. Nutrition is estimated.", items, slot, date });
    app.save();
    success(`Added to ${MEAL_SLOTS.find(([k]) => k === slot)[1]}, ${prettyDate(date, localDate())}`);
    await done(n, true);
  }));
  $$("[data-eskip]", box).forEach((b) => b.addEventListener("click", () => done(+b.dataset.eskip, false)));

  // Changing a match swaps just that item's row, so other choices stay as they are.
  const itemOf = (key) => { const [n, i] = key.split("-").map(Number); return [n, i, orders[n].items[i]]; };
  const closePick = (key) => {
    $(`[data-pick="${key}"]`, box)?.remove();
    $(`[data-echange="${key}"]`, box)?.setAttribute("aria-expanded", "false");
  };
  const results = new Map();
  const showResults = (key) => {
    const q = $(`[data-pq="${key}"]`, box).value.trim();
    // "Grilled Cheese Burrito" finds nothing, so drop words from the front until something matches.
    const words = q.split(/\s+/).filter(Boolean);
    let rows = [];
    for (let k = 0; k < words.length && !rows.length; k++) rows = searchFoods(foods, words.slice(k).join(" "), 6);
    // Nothing by that name? Show foods like the current match, e.g. other gordita fillings.
    const like = itemOf(key)[2].match;
    if (!rows.length && like && !like.custom && words.length) rows = searchFoods(foods, like.food.split(",")[0], 6);
    results.set(key, rows);
    $(`[data-pr="${key}"]`, box).innerHTML = rows.length
      ? rows.map((row, r) => { const m = matchRow(row); return `<button type="button" class="pick-food" data-prow="${key}" data-r="${r}"><span>${esc(m.food)}</span><small>${esc(m.portion)} · ${m.kcal} kcal</small></button>`; }).join("")
      : `<p class="hint">${q ? "No foods found. Try a simpler word, like burrito." : "Type a food to search."}</p>`;
  };
  const setMatch = (key, match) => {
    const [n, i, it] = itemOf(key);
    it.match = match;
    closePick(key);
    const li = $(`[data-item="${key}"]`, box);
    li.insertAdjacentHTML("afterend", itemRow(n, i, it));
    li.remove();
    haptic.tap();
  };
  box.onclick = (e) => {
    const change = e.target.closest("[data-echange]");
    if (change) {
      const key = change.dataset.echange;
      if ($(`[data-pick="${key}"]`, box)) return closePick(key);
      $$(".item-pick", box).forEach((p) => closePick(p.dataset.pick));
      const [n, i, it] = itemOf(key);
      $(`[data-item="${key}"]`, box).insertAdjacentHTML("afterend", pickerFor(n, i, it));
      change.setAttribute("aria-expanded", "true");
      showResults(key);
      return;
    }
    const pick = e.target.closest("[data-prow]");
    if (pick) return setMatch(pick.dataset.prow, matchRow(results.get(pick.dataset.prow)[+pick.dataset.r]));
    const use = e.target.closest("[data-puse]");
    if (use) {
      const kcal = Math.round(+$(`[data-pown="${use.dataset.puse}"]`, box).value);
      if (!(kcal > 0 && kcal <= 5000)) return toast("Type the calories for one, like 690");
      setMatch(use.dataset.puse, { food: "Your calories", portion: "1 item", kcal, carbs: 0, protein: 0, fat: 0, fiber: 0, custom: true });
    }
  };
  let typing;
  box.oninput = (e) => {
    const key = e.target.dataset?.pq;
    if (!key) return;
    clearTimeout(typing);
    typing = setTimeout(() => box.isConnected && $(`[data-pq="${key}"]`, box) && showResults(key), 150);
  };
}
