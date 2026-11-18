import { localDate, plateMath, parseMealText, mealSlot, slotForHour, MEAL_SLOTS } from "../model.js";
import { native, scanBarcode, lookupBarcode, scanLabel, ScanError } from "../scan.js";
import { loadFoods, searchFoods, portionsFor, nutritionFor, portionLabel, sumItems } from "../foods.js";
import { photoEstimates, estimateFromPhoto } from "../photo.js";
import { uid } from "../store.js";
import { $, $$, esc, num, field, select, toast, success, confirmDialog } from "../ui.js";

const EXERCISES = {
  Chest: ["Bench Press", "Incline Dumbbell Press", "Push-up", "Cable Fly", "Dip"],
  Back: ["Deadlift", "Pull-up", "Barbell Row", "Lat Pulldown", "Seated Cable Row"],
  Legs: ["Back Squat", "Front Squat", "Leg Press", "Romanian Deadlift", "Lunge", "Leg Curl", "Leg Extension", "Calf Raise"],
  Shoulders: ["Overhead Press", "Lateral Raise", "Rear Delt Fly", "Face Pull"],
  Arms: ["Barbell Curl", "Hammer Curl", "Triceps Pushdown", "Skull Crusher"],
  Core: ["Plank", "Hanging Leg Raise", "Cable Crunch", "Ab Wheel"],
};
const ALL_EXERCISES = Object.values(EXERCISES).flat();
const INTENSITY = [[1, "1 · very easy"], [2, "2 · easy"], [3, "3 · moderate"], [4, "4 · hard"], [5, "5 · very hard"]];

let mode = "meal"; // "meal" | "workout"
let shownMode = "meal"; // where the toggle's thumb was last drawn, so it can slide
let restInterval = null;

export function openLog(app, section, editing = null) {
  mode = section || mode;
  app.editing = editing;
}

export function renderLog(root, app) {
  const editing = app.editing;
  if (editing) mode = editing.kind;
  root.innerHTML = `
    <div class="segmented" role="tablist" style="--pos:${shownMode === "workout" ? 1 : 0}">
      <button role="tab" data-mode="meal" aria-selected="${mode === "meal"}">Meal</button>
      <button role="tab" data-mode="workout" aria-selected="${mode === "workout"}">Workout</button>
    </div>
    <div id="logBody"></div>
    <datalist id="exerciseList">${ALL_EXERCISES.map((e) => `<option value="${esc(e)}">`).join("")}</datalist>`;
  requestAnimationFrame(() => $(".segmented", root)?.style.setProperty("--pos", mode === "workout" ? 1 : 0));
  shownMode = mode;
  $$("[data-mode]", root).forEach((b) =>
    b.addEventListener("click", () => {
      mode = b.dataset.mode;
      app.editing = null;
      renderLog(root, app);
    }),
  );
  if (mode === "meal") renderMeal($("#logBody"), app);
  else renderWorkout($("#logBody"), app);
}

// ---------- Meals ----------

function renderMeal(root, app) {
  const { state } = app;
  const m = app.editing ? state.meals.find((x) => x.id === app.editing.id) : null;
  const v = m || { date: localDate(), ...app.prefill };
  app.prefill = null;
  const slot = m ? mealSlot(m) : v.slot || slotForHour(new Date().getHours());
  const quick = m ? [] : quickMeals(state);
  root.innerHTML = `
    <section class="card">
      <h2>${m ? "Edit food" : "Add food"}</h2>
      ${select("mSlot", "Meal", MEAL_SLOTS, slot)}
      <div class="food-search">
        <label class="field"><span>Search foods</span><input id="foodQ" type="search" enterkeyhint="search" placeholder="e.g. bagel, cream cheese, banana" autocomplete="off" autocorrect="off" spellcheck="false"></label>
        <ul id="foodResults" class="food-results" hidden></ul>
        <div id="foodPick" class="scan-result food-pick" hidden></div>
      </div>
      ${m ? "" : `
      <div class="label">Or add with</div>
      <div class="add-tiles">
        ${photoEstimates() ? `<button type="button" class="add-tile" id="mealPhoto"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3 7.2 5H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3.2L15 3H9zm3 5a5 5 0 1 1 0 10 5 5 0 0 1 0-10zm0 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/></svg>Photo</button>` : ""}
        <button type="button" class="add-tile" id="scanBarcode"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h2v14H3V5zm3 0h1v14H6V5zm2 0h2v14H8V5zm3 0h1v14h-1V5zm3 0h2v14h-2V5zm3 0h1v14h-1V5zm2 0h2v14h-2V5z"/></svg>Barcode</button>
        ${native ? `<button type="button" class="add-tile" id="scanLabel"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h6v2H6v4H4V4zm10 0h6v6h-2V6h-4V4zM4 14h2v4h4v2H4v-6zm14 0h2v6h-6v-2h4v-4zM8 9h8v2H8V9zm0 4h6v2H8v-2z"/></svg>Label</button>` : ""}
        ${photoEstimates() ? `<button type="button" class="add-tile" id="scanReceipt"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 2v20l2.33-1.5L9.67 22 12 20.5 14.33 22l2.34-1.5L19 22V2l-2.33 1.5L14.33 2 12 3.5 9.67 2 7.33 3.5 5 2zm3 6h8v2H8V8zm0 4h8v2H8v-2z"/></svg>Receipt</button>` : ""}
      </div>
      <div id="barcodeEntry" class="barcode-entry" hidden>
        <input id="barcodeInput" inputmode="numeric" placeholder="Barcode number" aria-label="Barcode number">
        <button type="button" class="btn small" id="barcodeGo">Look up</button>
      </div>
      <dialog id="addSheet" class="add-sheet" aria-labelledby="addSheetTitle">
        <h3 id="addSheetTitle"></h3>
        <p id="addSheetHint" class="hint"></p>
        <div id="addSheetOptions" class="add-sheet-options"></div>
        <button type="button" class="btn ghost" id="addSheetCancel">Cancel</button>
      </dialog>
      <div id="scanResult" class="scan-result" hidden></div>
      <div id="receiptPick" class="scan-result receipt-pick" hidden></div>`}
      <div id="mealItems" class="meal-items" hidden></div>
      ${quick.length ? `<div class="label mt">Favorites &amp; recent</div>
      <div class="chips">${quick.map((q, i) => `<button class="chip" data-quick="${i}">${q.fav ? "★ " : ""}${esc(q.name)}<small>${Math.round(q.kcal || 0)} kcal</small></button>`).join("")}</div>` : ""}
      <div class="row2">
        ${field("mDate", "Date", 'type="date"', v.date)}
        ${field("mName", "Food", 'placeholder="e.g. Chicken rice bowl" autocomplete="off"', v.name)}
      </div>
      <label class="field"><span>Quick entry</span><input id="mQuick" placeholder="e.g. 650 cal 70c 45p 18f 8 fiber" autocomplete="off"></label>
      <div class="row5">
        ${field("mKcal", "Calories", 'type="number" inputmode="numeric" min="0"', v.kcal ?? "")}
        ${field("mCarbs", "Carbs g", 'type="number" inputmode="decimal" min="0"', v.carbs ?? "")}
        ${field("mProtein", "Protein g", 'type="number" inputmode="decimal" min="0"', v.protein ?? "")}
        ${field("mFat", "Fat g", 'type="number" inputmode="decimal" min="0"', v.fat ?? "")}
        ${field("mFiber", "Fiber g", 'type="number" inputmode="decimal" min="0"', v.fiber ?? "")}
      </div>
      <p class="hint" id="mEstimate"></p>
      ${field("mNotes", "Notes", 'placeholder="Optional"', v.notes)}
      <div class="actions">
        <button class="btn primary" id="mSave">${m ? "Update" : "Save"}</button>
        <button class="btn ghost" id="mFavSave">Save as favorite</button>
        ${m ? `<button class="btn danger" id="mDelete">Delete</button>` : ""}
      </div>
    </section>`;

  const ids = { kcal: "mKcal", carbs: "mCarbs", protein: "mProtein", fat: "mFat", fiber: "mFiber" };
  const estimate = () => {
    const est = num($("#mCarbs")) * 4 + num($("#mProtein")) * 4 + num($("#mFat")) * 9;
    $("#mEstimate").textContent = est && !num($("#mKcal")) ? `Calories from macros: about ${Math.round(est)}. Leave Calories blank to use this.` : "";
  };
  Object.values(ids).forEach((id) => $("#" + id).addEventListener("input", estimate));
  estimate();

  // ----- Foods in this meal -----
  // Foods added from search or a photo (plus a scanned product) add up into the
  // fields below, which stay editable. The meal name follows the foods until
  // the user types their own.
  const items = (m?.items || []).filter((it) => it.source !== "scan").map((it) => ({ ...it }));
  let scanItem = m?.items?.find((it) => it.source === "scan") || null;
  let photoNote = "";
  let nameAuto = !v.name || !!m?.items?.length;
  $("#mName").addEventListener("input", () => (nameAuto = false));
  const allItems = () => (scanItem ? [...items, scanItem] : items);
  const refreshItems = (applyTotals = true) => {
    const box = $("#mealItems");
    box.hidden = !items.length;
    box.innerHTML = items.length ? `
      <div class="label">In this meal</div>
      <ul>${items.map((it, i) => `
        <li><span class="mi-name"><strong>${esc(it.name)}</strong><small>${esc(it.portion)}${it.source === "photo" ? " · estimated from photo" : it.source === "receipt" ? " · from receipt" : ""}</small></span>
          <span class="mi-kcal">${Math.round(it.kcal)} kcal</span>
          <button class="drink-del" data-item-del="${i}" aria-label="Remove ${esc(it.name)}">✕</button></li>`).join("")}</ul>
      ${photoNote ? `<p class="hint">${esc(photoNote)}</p>` : ""}` : "";
    $$("[data-item-del]", box).forEach((b) =>
      b.addEventListener("click", () => {
        items.splice(+b.dataset.itemDel, 1);
        if (!items.some((it) => it.source === "photo")) photoNote = "";
        refreshItems();
      }),
    );
    if (!applyTotals) return; // opening a saved meal keeps its saved numbers
    const all = allItems();
    const t = sumItems(all);
    for (const [k, id] of Object.entries(ids)) $("#" + id).value = all.length ? t[k] : "";
    if (nameAuto) $("#mName").value = all.map((it) => it.short ?? it.name).filter(Boolean).join(" + ");
    estimate();
  };
  if (items.length) refreshItems(false);

  // ----- Search foods -----
  let foodList = null;
  let searchTimer;
  const foodQ = $("#foodQ");
  const runSearch = async () => {
    const text = foodQ.value.trim();
    const ul = $("#foodResults");
    if (text.length < 2) return (ul.hidden = true);
    try {
      foodList ??= await loadFoods();
    } catch (e) {
      console.error(e);
      ul.hidden = false;
      ul.innerHTML = `<li class="hint">Couldn't load the food list. Please try again.</li>`;
      return;
    }
    if (foodQ.value.trim() !== text) return; // the user kept typing
    const rows = searchFoods(foodList, text, 15);
    ul.hidden = false;
    ul.innerHTML = rows.length
      ? rows.map((r, i) => {
          const [desc, grams] = portionsFor(r)[0];
          return `<li><button data-food="${i}"><strong>${esc(r[0])}</strong><small>${nutritionFor(r, grams).kcal} kcal · ${esc(desc)}</small></button></li>`;
        }).join("")
      : `<li class="hint">No matches. Try a simpler word, or enter the numbers below.</li>`;
    $$("[data-food]", ul).forEach((b) => b.addEventListener("click", () => pickFood(rows[b.dataset.food])));
  };
  foodQ.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(runSearch, 120);
  });
  foodQ.addEventListener("keydown", (e) => e.key === "Enter" && (e.preventDefault(), foodQ.blur()));
  const pickFood = (row) => {
    $("#foodResults").hidden = true;
    const ps = portionsFor(row);
    const short = row[0].split(",")[0];
    const box = $("#foodPick");
    box.hidden = false;
    box.innerHTML = `
      <div class="scan-head"><strong>${esc(row[0])}</strong><span>USDA FoodData Central</span></div>
      <div class="pick-row">
        <label class="field"><span>Amount</span><input id="fpQty" type="number" inputmode="decimal" min="0" step="any" value="1"></label>
        <label class="field"><span>Portion</span><select id="fpPortion">${ps.map(([d, g], i) => `<option value="${i}">${esc(d)}${/^(oz|g)$/.test(d) ? "" : ` (${g} g)`}</option>`).join("")}</select></label>
      </div>
      <p class="hint" id="fpInfo"></p>
      <div class="actions"><button class="btn primary" id="fpAdd">Add to meal</button><button class="btn ghost" id="fpCancel">Cancel</button></div>`;
    const qty = $("#fpQty");
    const sel = $("#fpPortion");
    const grams = () => ps[sel.value][1] * (num(qty) || 0);
    const calc = () => {
      const n = nutritionFor(row, grams());
      $("#fpInfo").textContent = `${n.kcal} kcal · ${n.carbs} g carbs · ${n.protein} g protein · ${n.fat} g fat`;
    };
    sel.addEventListener("change", () => {
      // Switching to grams starts at 100 g; switching back starts at 1.
      if (ps[sel.value][0] === "g") qty.value = 100;
      else if (num(qty) >= 50) qty.value = 1;
      calc();
    });
    qty.addEventListener("input", calc);
    calc();
    $("#fpAdd").addEventListener("click", () => {
      const amount = num(qty);
      if (!(amount > 0)) return toast("Enter an amount");
      items.push({ name: row[0], short, portion: portionLabel(ps[sel.value][0], amount), grams: Math.round(grams()), ...nutritionFor(row, grams()), source: "usda" });
      box.hidden = true;
      foodQ.value = "";
      refreshItems();
      success(`${short} added`);
    });
    $("#fpCancel").addEventListener("click", () => {
      box.hidden = true;
      foodQ.focus();
    });
    box.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };

  $("#mQuick").addEventListener("input", (e) => {
    const p = parseMealText(e.target.value);
    for (const [k, id] of Object.entries(ids)) if (p[k] != null) $("#" + id).value = p[k];
    estimate();
  });
  // ----- Scan to fill -----
  let scanned = null; // values for one serving, as scanned
  const fillFromScan = (servings) => {
    const scaled = Object.fromEntries(Object.keys(ids).map((k) => [k, Math.round((scanned[k] || 0) * servings * 10) / 10]));
    scanItem = { name: scanned.name || "Scanned food", short: scanned.name || "", portion: `${servings} × ${scanned.serving || "serving"}`, ...scaled, source: "scan" };
    refreshItems();
  };
  const showScan = (item) => {
    scanned = item;
    const box = $("#scanResult");
    box.hidden = false;
    box.innerHTML = `
      <div class="scan-head"><strong>${esc(item.name || "Nutrition label")}</strong>
        <span>Per ${esc(item.serving || "serving")} · from ${item.source === "Open Food Facts" ? `<a href="https://world.openfoodfacts.org/product/${esc(item.barcode)}" target="_blank" rel="noopener">Open Food Facts</a>` : "the label"}</span></div>
      <div class="servings"><span>Servings</span>
        <button class="icon-btn" data-serv="-0.5" aria-label="Fewer servings">−</button>
        <input id="servings" type="number" inputmode="decimal" min="0.25" step="0.25" value="1" aria-label="Servings">
        <button class="icon-btn" data-serv="0.5" aria-label="More servings">+</button></div>
      <p class="hint">Check the numbers below match your package.</p>`;
    const input = $("#servings");
    const apply = () => fillFromScan(Math.max(0.25, num(input) || 1));
    input.addEventListener("input", apply);
    box.querySelectorAll("[data-serv]").forEach((b) =>
      b.addEventListener("click", () => {
        input.value = Math.max(0.25, (num(input) || 1) + +b.dataset.serv);
        apply();
      }),
    );
    apply();
    box.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };
  const busy = (btn, on, label) => {
    if (!btn) return;
    btn.disabled = on;
    btn.dataset.label ??= btn.lastChild.nodeValue;
    btn.lastChild.nodeValue = on ? label : btn.dataset.label;
  };
  const report = (e) => {
    if (e instanceof ScanError) toast(e.message);
    else {
      console.error(e);
      toast("Something went wrong while scanning. Please try again.");
    }
  };
  const lookup = async (code, btn) => {
    busy(btn, true, "Finding…");
    try {
      showScan(await lookupBarcode(code));
      success("Found it");
    } catch (e) {
      report(e);
    } finally {
      busy(btn, false);
    }
  };
  const typeBarcode = () => {
    $("#barcodeEntry").hidden = false;
    $("#barcodeInput").focus();
  };
  const startBarcodeScan = async () => {
    const btn = $("#scanBarcode");
    try {
      const code = await scanBarcode(() => busy(btn, true, "Starting…"));
      busy(btn, false);
      if (code) await lookup(code, btn);
    } catch (err) {
      busy(btn, false);
      report(err);
      if (err instanceof ScanError && err.unavailable) {
        $("#barcodeEntry").hidden = false;
        // Not focused from code here: it runs after an await, outside the tap, so
        // Android would focus the field without opening the keyboard.
        $("#barcodeInput").scrollIntoView({ block: "center", behavior: "smooth" });
      }
    }
  };
  const readLabel = async (fromGallery) => {
    const btn = $("#scanLabel");
    try {
      busy(btn, true, "Reading…");
      const item = await scanLabel(fromGallery);
      if (item) {
        showScan(item);
        success("Label read");
      }
    } catch (err) {
      report(err);
    } finally {
      busy(btn, false);
    }
  };
  $("#barcodeGo")?.addEventListener("click", (e) => lookup($("#barcodeInput").value, e.currentTarget));
  // ----- Meal photo estimate -----
  const photoConsent = async () => {
    if (state.settings.photoConsent) return true;
    const ok = await confirmDialog("To estimate your meal, the photo is sent to the GlycoTank server and to Claude, an AI from Anthropic. Photos aren't saved. Estimates can be off, so check the numbers before saving.", "Continue", false);
    if (ok) {
      state.settings.photoConsent = true;
      app.save();
    }
    return ok;
  };
  const fromPhoto = async (fromGallery) => {
    if (!(await photoConsent())) return;
    const btn = $("#mealPhoto");
    try {
      const res = await estimateFromPhoto(fromGallery, () => busy(btn, true, "Reading…"));
      if (!res) return;
      for (const it of res.items) items.push({ ...it, short: it.name, source: "photo" });
      photoNote = res.note || "";
      refreshItems();
      success(`Found ${res.items.length} ${res.items.length === 1 ? "food" : "foods"}`);
      $("#mealItems").scrollIntoView({ block: "nearest", behavior: "smooth" });
    } catch (err) {
      report(err);
    } finally {
      busy(btn, false);
    }
  };

  // ----- Restaurant receipt: tick what you ate -----
  const SHARES = [[1, "All"], [0.5, "Half"], [0.25, "A quarter"]];
  const showReceipt = (res) => {
    const box = $("#receiptPick");
    box.hidden = false;
    box.innerHTML = `
      <div class="scan-head"><strong>Receipt</strong><span>Tick what you ate. Nutrition is estimated.</span></div>
      <ul class="receipt-list">${res.items.map((it, i) => `
        <li><label class="receipt-item"><input type="checkbox" data-r="${i}" checked>
          <span class="mi-name"><strong>${esc(it.name)}</strong><small>${esc(it.portion)} · ${Math.round(it.kcal)} kcal</small></span></label>
          <select data-share="${i}" aria-label="How much of ${esc(it.name)} you ate">${SHARES.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select></li>`).join("")}</ul>
      ${res.note ? `<p class="hint">${esc(res.note)}</p>` : ""}
      <div class="actions"><button class="btn primary" id="receiptAdd">Add to meal</button><button class="btn ghost" id="receiptCancel">Cancel</button></div>`;
    $("#receiptAdd").addEventListener("click", () => {
      let added = 0;
      res.items.forEach((it, i) => {
        if (!$(`[data-r="${i}"]`, box).checked) return;
        const share = +$(`[data-share="${i}"]`, box).value;
        const scaled = Object.fromEntries(Object.keys(ids).map((k) => [k, Math.round(it[k] * share * 10) / 10]));
        const label = SHARES.find(([v]) => v === share)[1].toLowerCase();
        items.push({ ...it, ...scaled, kcal: Math.round(scaled.kcal), short: it.name, portion: share === 1 ? it.portion : `${label} of ${it.portion}`, source: "receipt" });
        added++;
      });
      if (!added) return toast("Tick at least one item");
      photoNote = "";
      box.hidden = true;
      refreshItems();
      success(`Added ${added} ${added === 1 ? "item" : "items"}`);
      $("#mealItems").scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
    $("#receiptCancel").addEventListener("click", () => (box.hidden = true));
    box.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };
  const readReceipt = async (fromGallery) => {
    if (!(await photoConsent())) return;
    const btn = $("#scanReceipt");
    try {
      const res = await estimateFromPhoto(fromGallery, () => busy(btn, true, "Reading…"), "receipt");
      if (res) showReceipt(res);
    } catch (err) {
      report(err);
    } finally {
      busy(btn, false);
    }
  };

  // ----- The four "Or add with" tiles: each asks where the food comes from -----
  const fromCamera = (run) => [["Take a photo", () => run(false)], ["Choose from library", () => run(true)]];
  const SHEETS = {
    mealPhoto: { title: "Photo of your meal", hint: "We'll estimate the foods and their nutrition.", options: fromCamera(fromPhoto) },
    scanBarcode: { title: "Barcode", hint: "Find a packaged food by its barcode.", options: [["Scan barcode", startBarcodeScan], ["Type the number", typeBarcode]] },
    scanLabel: { title: "Nutrition label", hint: "We'll read the numbers from the label.", options: fromCamera(readLabel) },
    scanReceipt: { title: "Restaurant receipt", hint: "Tick what you ate from the items on it.", options: fromCamera(readReceipt) },
  };
  const sheet = $("#addSheet");
  Object.entries(SHEETS).forEach(([id, { title, hint, options }]) => {
    $(`#${id}`)?.addEventListener("click", () => {
      // Only the camera needs a choice; a browser can't scan, so go straight to typing.
      if (id === "scanBarcode" && !native) return typeBarcode();
      $("#addSheetTitle").textContent = title;
      $("#addSheetHint").textContent = hint;
      const box = $("#addSheetOptions");
      box.replaceChildren(...options.map(([label, run]) => {
        const b = Object.assign(document.createElement("button"), { type: "button", className: "btn", textContent: label });
        b.addEventListener("click", () => {
          sheet.close();
          run();
        });
        return b;
      }));
      sheet.showModal();
    });
  });
  $("#addSheetCancel")?.addEventListener("click", () => sheet.close());
  sheet?.addEventListener("click", (e) => e.target === sheet && sheet.close()); // tap outside

  // Scan buttons on Today land here and start the scan straight away.
  if (app.autoScan) {
    if (app.autoScan === "label") readLabel(false);
    else if (native) startBarcodeScan();
    else typeBarcode();
    app.autoScan = null;
  }
  $("#barcodeInput")?.addEventListener("keydown", (e) => e.key === "Enter" && lookup(e.target.value, $("#barcodeGo")));

  // Tapping a favorite or recent food fills the form; Save logs it.
  $$("[data-quick]", root).forEach((b) =>
    b.addEventListener("click", () => {
      const f = quick[b.dataset.quick];
      items.length = 0;
      scanItem = null;
      photoNote = "";
      refreshItems();
      nameAuto = false;
      $("#mName").value = f.name;
      for (const [k, id] of Object.entries(ids)) $("#" + id).value = f[k] ?? "";
      $$("[data-quick]", root).forEach((c) => c.classList.toggle("picked", c === b));
      estimate();
    }),
  );

  const read = () => {
    const vals = Object.fromEntries(Object.entries(ids).map(([k, id]) => [k, num($("#" + id))]));
    if (!vals.kcal) vals.kcal = Math.round(vals.carbs * 4 + vals.protein * 4 + vals.fat * 9);
    return { name: $("#mName").value.trim() || "Meal", ...vals, notes: $("#mNotes").value.trim() };
  };

  $("#mSave").addEventListener("click", () => {
    const all = allItems();
    const data = { ...read(), items: all.length ? all : undefined, slot: $("#mSlot").value, date: $("#mDate").value || localDate() };
    if (m) Object.assign(m, data);
    else state.meals.push({ id: uid(), ...data });
    app.editing = null;
    app.save();
    success(m ? "Updated" : `Added to ${MEAL_SLOTS.find(([k]) => k === data.slot)[1]}`);
    app.go("meals");
  });
  $("#mFavSave").addEventListener("click", () => {
    const { notes, ...fav } = read();
    state.mealFavs = state.mealFavs.filter((f) => f.name !== fav.name);
    state.mealFavs.push(fav);
    app.save();
    toast(`Saved "${fav.name}" to favorites`);
    renderMeal(root, app);
  });
  $("#mDelete")?.addEventListener("click", async () => {
    if (!(await confirmDialog("Delete this meal?"))) return;
    state.meals = state.meals.filter((x) => x.id !== m.id);
    app.editing = null;
    app.save();
    toast("Meal deleted");
    app.go("meals");
  });
}

// ---------- Workouts ----------

function renderWorkout(root, app) {
  const { state } = app;
  const s = state.settings;
  const w = app.editing ? state.workouts.find((x) => x.id === app.editing.id) : null;
  const v = w || { date: localDate(), type: "strength", sets: 3, reps: 8, intensity: 3, mins: 30 };
  const units = s.units;

  root.innerHTML = `
    <section class="card">
      <h2>${w ? "Edit workout" : "Log training"}</h2>
      ${!w && state.workoutFavs.length ? select("wFav", "Routines & favorites", [["", "Choose one…"], ...state.workoutFavs.map((f, i) => [i, f.type === "routine" ? `${f.name} (routine, ${f.exercises.length} exercises)` : f.name])], "") : ""}
      <div class="row2">
        ${field("wDate", "Date", 'type="date"', v.date)}
        ${select("wType", "Type", [["strength", "Strength"], ["cardio", "Cardio"], ["sport", "Sport"], ["other", "Other"]], v.type)}
      </div>
      ${w ? "" : select("wMode", "Log", [["single", "One exercise"], ["session", "A full session (several exercises)"]], "single")}

      <div id="strengthBox">
        ${field("wName", "Exercise", 'list="exerciseList" placeholder="e.g. Bench Press" autocomplete="off"', v.type === "strength" ? v.name : "")}
        <div class="row3">
          ${field("wSets", "Hard sets", 'type="number" inputmode="numeric" min="1"', v.sets ?? "")}
          ${field("wReps", "Reps", 'type="number" inputmode="numeric" min="1"', v.reps ?? "")}
          ${field("wWeight", `Weight (${units})`, 'type="number" inputmode="decimal" min="0" step="0.5"', v.weight ?? "")}
        </div>
      </div>

      <div id="sessionBox" hidden>
        ${field("wSessionName", "Session name", 'placeholder="e.g. Upper A, Leg day"')}
        <div id="sessRows"></div>
        <button class="btn small" id="addRow">+ Add exercise</button>
      </div>

      <div id="cardioBox" hidden>
        ${field("wCardioName", "Activity", 'placeholder="e.g. Run, Bike, Rower"', v.type === "cardio" ? v.name : "")}
        <div class="row2">
          ${field("wMins", "Minutes", 'type="number" inputmode="numeric" min="1"', v.mins ?? 30)}
          ${select("wIntensity", "Intensity", INTENSITY, v.intensity ?? 3)}
        </div>
      </div>

      <div id="otherBox" hidden>
        ${field("wOtherName", "Activity", 'placeholder="e.g. Basketball"', v.type === "sport" || v.type === "other" ? v.name : "")}
      </div>

      ${field("wNotes", "Notes", 'placeholder="Optional"', v.notes)}
      <div class="actions">
        <button class="btn primary" id="wSave">${w ? "Update workout" : "Save"}</button>
        ${w ? "" : `<button class="btn ghost" id="wFavSave">Save as favorite</button>`}
        ${w ? `<button class="btn danger" id="wDelete">Delete</button>` : ""}
      </div>
    </section>

    <section class="card">
      <h2>Rest timer</h2>
      <div class="timer"><span id="restClock">0:00</span>
        <div class="actions"><button class="btn small" data-rest="60">60s</button><button class="btn small" data-rest="90">90s</button><button class="btn small" data-rest="120">2 min</button><button class="btn small ghost" data-rest="0">Stop</button></div>
      </div>
    </section>

    <section class="card">
      <h2>Plate math</h2>
      <div class="row2">
        ${field("pmTarget", `Target (${units})`, 'type="number" inputmode="decimal" min="0"', "")}
        ${field("pmBar", `Bar (${units})`, 'type="number" inputmode="decimal" min="0"', units === "kg" ? 20 : 45)}
      </div>
      <p class="kpi-sm" id="pmOut">Enter a target weight.</p>
    </section>`;

  const showBoxes = () => {
    const type = $("#wType").value;
    const session = $("#wMode")?.value === "session" && type === "strength";
    $("#strengthBox").hidden = type !== "strength" || session;
    $("#sessionBox").hidden = !session;
    $("#cardioBox").hidden = type !== "cardio";
    $("#otherBox").hidden = type !== "sport" && type !== "other";
    if ($("#wFavSave")) $("#wFavSave").textContent = session ? "Save as routine" : "Save as favorite";
    if (session && !$("#sessRows").children.length) addRow();
  };
  const addRow = (pref = {}) => {
    const row = document.createElement("div");
    row.className = "sess-row";
    row.innerHTML = `
      <input class="sName" list="exerciseList" placeholder="Exercise" value="${esc(pref.name || "")}" aria-label="Exercise">
      <input class="sSets" type="number" inputmode="numeric" min="1" placeholder="Sets" value="${esc(pref.sets ?? "")}" aria-label="Sets">
      <input class="sReps" type="number" inputmode="numeric" min="1" placeholder="Reps" value="${esc(pref.reps ?? "")}" aria-label="Reps">
      <input class="sWeight" type="number" inputmode="decimal" min="0" step="0.5" placeholder="${units}" value="${esc(pref.weight || "")}" aria-label="Weight">
      <button class="icon-btn" aria-label="Remove exercise">✕</button>`;
    row.querySelector("button").addEventListener("click", () => row.remove());
    $("#sessRows").appendChild(row);
  };
  $("#wType").addEventListener("change", showBoxes);
  $("#wMode")?.addEventListener("change", showBoxes);
  $("#addRow").addEventListener("click", () => addRow());
  showBoxes();

  // A routine fills a full session; any other favorite fills one exercise.
  const loadRoutine = (r) => {
    $("#wType").value = "strength";
    $("#wMode").value = "session";
    $("#sessRows").innerHTML = "";
    $("#wSessionName").value = r.name;
    for (const ex of r.exercises) addRow(ex);
    showBoxes();
  };
  if (app.startRoutine != null && !w) {
    const r = state.workoutFavs[app.startRoutine];
    if (r?.type === "routine") {
      loadRoutine(r);
      if ($("#wFav")) $("#wFav").value = app.startRoutine;
    }
  }
  app.startRoutine = null;
  // "+ New" on Workout routines opens an empty session ready to save.
  if (app.newRoutine && !w) {
    $("#wType").value = "strength";
    $("#wMode").value = "session";
    showBoxes();
    $("#wSessionName").placeholder = "Routine name, e.g. Upper A";
  }
  app.newRoutine = false;

  $("#wFav")?.addEventListener("change", (e) => {
    const f = state.workoutFavs[e.target.value];
    if (!f) return;
    if (f.type === "routine") return loadRoutine(f);
    $("#wType").value = f.type;
    if ($("#wMode")) $("#wMode").value = "single";
    showBoxes();
    if (f.type === "strength") {
      $("#wName").value = f.name;
      $("#wSets").value = f.sets ?? "";
      $("#wReps").value = f.reps ?? "";
      $("#wWeight").value = f.weight ?? "";
    } else if (f.type === "cardio") {
      $("#wCardioName").value = f.name;
      $("#wMins").value = f.mins ?? "";
      $("#wIntensity").value = f.intensity ?? 3;
    } else $("#wOtherName").value = f.name;
  });

  const readRows = () =>
    $$(".sess-row", root)
      .map((r) => ({ name: $(".sName", r).value.trim(), sets: num($(".sSets", r)), reps: num($(".sReps", r)), weight: num($(".sWeight", r)) }))
      .filter((r) => r.name || r.sets);
  const readOne = () => {
    const type = $("#wType").value;
    if (type === "strength") return { type, name: $("#wName").value.trim() || "Strength", sets: num($("#wSets")), reps: num($("#wReps")), weight: num($("#wWeight")) };
    if (type === "cardio") return { type, name: $("#wCardioName").value.trim() || "Cardio", mins: num($("#wMins")), intensity: +$("#wIntensity").value };
    return { type, name: $("#wOtherName").value.trim() || (type === "sport" ? "Sport" : "Other") };
  };

  $("#wSave").addEventListener("click", () => {
    const date = $("#wDate").value || localDate();
    const notes = $("#wNotes").value.trim();
    if (!$("#sessionBox").hidden) {
      const rows = readRows();
      if (!rows.length) return toast("Add at least one exercise");
      const sessionId = uid();
      const sessionName = $("#wSessionName").value.trim() || "Session";
      for (const r of rows) state.workouts.push({ id: uid(), date, type: "strength", ...r, name: r.name || "Strength", sessionId, sessionName, notes });
      app.save();
      success(`Session saved (${rows.length} exercise${rows.length === 1 ? "" : "s"})`);
      return app.go("tank");
    }
    const data = { ...readOne(), date, notes };
    if (w) {
      for (const k of ["sets", "reps", "weight", "mins", "intensity"]) delete w[k];
      Object.assign(w, data);
    } else state.workouts.push({ id: uid(), ...data });
    app.editing = null;
    app.save();
    success(w ? "Workout updated" : "Workout saved");
    app.go("tank");
  });
  $("#wFavSave")?.addEventListener("click", () => {
    if (!$("#sessionBox").hidden) {
      const exercises = readRows();
      if (!exercises.length) return toast("Add at least one exercise");
      const routine = { type: "routine", name: $("#wSessionName").value.trim() || "Routine", exercises };
      state.workoutFavs = state.workoutFavs.filter((f) => f.name !== routine.name);
      state.workoutFavs.push(routine);
      app.save();
      return toast(`Saved routine "${routine.name}"`);
    }
    const fav = readOne();
    state.workoutFavs = state.workoutFavs.filter((f) => f.name !== fav.name);
    state.workoutFavs.push(fav);
    app.save();
    toast(`Saved "${fav.name}" to favorites`);
  });
  $("#wDelete")?.addEventListener("click", async () => {
    if (!(await confirmDialog("Delete this workout?"))) return;
    state.workouts = state.workouts.filter((x) => x.id !== w.id);
    app.editing = null;
    app.save();
    toast("Workout deleted");
    app.go("tank");
  });

  // Rest timer
  const clock = (t) => `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
  $$("[data-rest]", root).forEach((b) =>
    b.addEventListener("click", () => {
      clearInterval(restInterval);
      let left = +b.dataset.rest;
      $("#restClock").textContent = clock(left);
      if (!left) return;
      restInterval = setInterval(() => {
        left--;
        const el = $("#restClock");
        if (!el) return clearInterval(restInterval);
        el.textContent = clock(left);
        if (left <= 0) {
          clearInterval(restInterval);
          navigator.vibrate?.([200, 100, 200]);
          toast("Rest over. Next set!");
        }
      }, 1000);
    }),
  );

  // Plate math
  const plates = () => {
    const target = num($("#pmTarget")), bar = num($("#pmBar"));
    if (!target) return ($("#pmOut").textContent = "Enter a target weight.");
    if (target <= bar) return ($("#pmOut").textContent = "Just the bar.");
    const r = plateMath(target, bar, units);
    $("#pmOut").textContent = `Each side: ${r.plates.join(" + ") || "—"} ${units}${r.remainder ? ` (${r.remainder} ${units} short)` : ""}`;
  };
  ["pmTarget", "pmBar"].forEach((id) => $("#" + id).addEventListener("input", plates));
  $("#wWeight")?.addEventListener("input", () => {
    $("#pmTarget").value = $("#wWeight").value;
    plates();
  });
}

// Favorites first, then the most recent other foods, by name, up to eight.
function quickMeals(state) {
  const out = state.mealFavs.map((f) => ({ ...f, fav: true }));
  const seen = new Set(out.map((q) => q.name.toLowerCase()));
  for (const m of [...state.meals].reverse()) {
    if (out.length >= 8) break;
    const key = (m.name || "").toLowerCase();
    if (!key || key === "meal" || seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out.slice(0, 8);
}
