// First-run setup: a full-screen, step-by-step walkthrough that explains the
// tank, collects the profile, shows the personalized plan, and offers reminders.

import { personalize, ACTIVITY } from "../model.js";
import { paceOptions, snapPace, paceLabel, paceSub, rateText, projectionText, floorText } from "./plan-text.js";
import { $, $$, esc, num, success, toast } from "../ui.js";
import { remindersSupported, applyReminders } from "../native.js";
import { haptic, countUp, reducedMotion } from "../motion.js";

const STEPS = ["welcome", "how", "about", "activity", "goal", "plan", "reminders", "done"].filter(
  (s) => s !== "reminders" || remindersSupported,
);

const TANK_ICON = `<svg viewBox="0 0 120 160" aria-hidden="true"><defs><clipPath id="obClip"><rect x="14" y="18" width="92" height="132" rx="24"/></clipPath></defs>
  <rect x="44" y="5" width="32" height="13" rx="5" fill="#3a4357"/><rect x="14" y="18" width="92" height="132" rx="24" fill="#20283a"/>
  <g clip-path="url(#obClip)"><g class="ob-fuel"><path class="ob-wave" d="M-120 70 q30 -9 60 0 t60 0 t60 0 t60 0 t60 0 t60 0 V220 H-120 Z" fill="#57cc99"/></g>
  <circle class="ob-bubble" cx="40" cy="140" r="4"/><circle class="ob-bubble" cx="66" cy="146" r="3"/><circle class="ob-bubble" cx="86" cy="138" r="5"/></g>
  <rect x="14" y="18" width="92" height="132" rx="24" fill="none" stroke="#e8ebf1" stroke-width="7"/></svg>`;

const choice = (name, value, label, sub, current) =>
  `<button type="button" class="choice" data-choice="${name}" data-value="${value}" aria-pressed="${String(value) === String(current)}">
    <strong>${label}</strong>${sub ? `<span>${sub}</span>` : ""}</button>`;

export function openOnboarding(app, { startAt = 0, onFinish, onClose } = {}) {
  const s = app.state.settings;
  // Working copy of the answers; only saved when the user reaches the plan step.
  const p = {
    weightUnits: s.units,
    heightUnits: s.units === "kg" ? "cm" : "ftin",
    sex: "m",
    goal: "maintain",
    lbPerWeek: 1,
    activity: "desk",
    daysPerWeek: 3,
    setsPerSession: 12,
    cardioMinsPerWeek: 60,
    cardioIntensity: 3,
    ...app.state.profile,
  };
  const reminders = { checkin: "07:00", log: "20:00" };
  let step = Math.min(startAt, STEPS.length - 1);
  // Replays (from Settings) can be closed at any time without changing anything.
  const dismissible = !!app.state.meta.introSeen;

  const root = document.createElement("section");
  root.id = "onboard";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-label", "Set up GlycoTank");
  document.body.appendChild(root);
  document.body.classList.add("onboarding");

  const body = {
    welcome: () => `
      <div class="ob-hero">${TANK_ICON}</div>
      <h2>Know your fuel tank</h2>
      <p class="ob-lead">GlycoTank estimates your <strong>glycogen</strong>, the carbohydrate fuel stored in your muscles and liver, from what you eat and how you train.</p>
      <p class="ob-lead">Let's take a minute to explain the basics and set up targets made for you.</p>`,
    how: () => `
      <h2>How it works</h2>
      <ul class="ob-points">
        <li><span class="ob-ico"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 2v9a2 2 0 0 0 2 2v9h2v-9a2 2 0 0 0 2-2V2h-2v7h-1V2H9v7H8V2H7zm10 0c-1.7 0-3 2.2-3 5v6h2v9h2V2h-1z"/></svg></span><div><strong>Meals fill the tank</strong><p>Carbs you eat refill your glycogen.</p></div></li>
        <li><span class="ob-ico"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 10h2V7h3v10H4v-3H2v-4zm5 1h10v2H7v-2zm10-4h3v3h2v4h-2v3h-3V7z"/></svg></span><div><strong>Training drains it</strong><p>Every hard set and cardio minute uses fuel, and your body uses some every day.</p></div></li>
        <li><span class="ob-ico"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3h2v16h16v2H3V3zm4 12 4-5 3 3 5-7 1.6 1.2-6.4 9-3-3-2.8 3.5L7 15z"/></svg></span><div><strong>Plan ahead</strong><p>Tell GlycoTank tomorrow's training and it suggests how many carbs to eat.</p></div></li>
        <li><span class="ob-ico"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10zm-1-6h2v3h-2V1zm0 19h2v3h-2v-3zM1 11h3v2H1v-2zm19 0h3v2h-3v-2zM4.2 5.6l1.4-1.4 2.1 2.1-1.4 1.4-2.1-2.1zm12.1 12.1 1.4-1.4 2.1 2.1-1.4 1.4-2.1-2.1zM18.4 4.2l1.4 1.4-2.1 2.1-1.4-1.4 2.1-2.1zM6.3 16.3l1.4 1.4-2.1 2.1-1.4-1.4 2.1-2.1z"/></svg></span><div><strong>Check in each morning</strong><p>Sleep, resting heart rate and mood give you a readiness score: train, go easy or rest.</p></div></li>
      </ul>`,
    about: () => `
      <h2>About you</h2>
      <p class="ob-sub">Used to estimate your energy needs. Saved privately to your account and never shared.</p>
      <div class="ob-label">Units</div>
      <div class="choices two">${choice("units", "lb", "Pounds & feet", "", p.weightUnits)}${choice("units", "kg", "Kilograms & cm", "", p.weightUnits)}</div>
      <div class="row2">
        <label class="field"><span>Weight (${p.weightUnits})</span><input id="obWeight" type="number" inputmode="decimal" min="30" value="${esc(p.weight ?? "")}" placeholder="${p.weightUnits === "lb" ? "e.g. 180" : "e.g. 80"}"></label>
        <label class="field"><span>Age</span><input id="obAge" type="number" inputmode="numeric" min="14" max="100" value="${esc(p.age ?? "")}" placeholder="e.g. 30"></label>
      </div>
      ${p.heightUnits === "ftin"
        ? `<div class="row2"><label class="field"><span>Height (ft)</span><input id="obFt" type="number" inputmode="numeric" min="3" max="8" value="${esc(p.heightFt ?? "")}" placeholder="5"></label>
           <label class="field"><span>(in)</span><input id="obIn" type="number" inputmode="numeric" min="0" max="11" value="${esc(p.heightIn ?? "")}" placeholder="10"></label></div>`
        : `<label class="field"><span>Height (cm)</span><input id="obCm" type="number" inputmode="numeric" min="100" max="240" value="${esc(p.heightCm ?? "")}" placeholder="e.g. 178"></label>`}
      <div class="ob-label">Sex</div>
      <div class="choices two">${choice("sex", "m", "Male", "", p.sex)}${choice("sex", "f", "Female", "", p.sex)}</div>`,
    activity: () => `
      <h2>Your activity</h2>
      <p class="ob-sub">Outside of workouts, how much do you move on a typical day?</p>
      <div class="choices">${Object.entries(ACTIVITY).map(([k, a]) => choice("activity", k, a.label, a.sub, p.activity)).join("")}</div>
      <div class="ob-label">Your training in a typical week</div>
      <div class="row2">
        <label class="field"><span>Training days / week</span><input id="obDays" type="number" inputmode="numeric" min="0" max="7" value="${esc(p.daysPerWeek)}"></label>
        <label class="field"><span>Hard sets / session</span><input id="obSets" type="number" inputmode="numeric" min="0" value="${esc(p.setsPerSession)}"></label>
      </div>
      <div class="row2">
        <label class="field"><span>Cardio minutes / week</span><input id="obCardio" type="number" inputmode="numeric" min="0" value="${esc(p.cardioMinsPerWeek)}"></label>
        <label class="field"><span>Cardio intensity</span><select id="obInt">${[[1, "Very easy"], [2, "Easy"], [3, "Moderate"], [4, "Hard"], [5, "Very hard"]]
          .map(([v, t]) => `<option value="${v}"${+v === +p.cardioIntensity ? " selected" : ""}>${t}</option>`).join("")}</select></label>
      </div>
      <label class="check"><input type="checkbox" id="obLowCarb" ${p.lowCarb ? "checked" : ""}> I prefer lower carb</label>`,
    goal: () => {
      snapPace(p);
      const unit = p.weightUnits;
      return `
      <h2>Where do you want to be?</h2>
      <div class="choices">
        ${choice("goal", "cut", "Lose fat", "A steady calorie deficit with high protein", p.goal)}
        ${choice("goal", "maintain", "Maintain", "Keep your weight and fuel your training", p.goal)}
        ${choice("goal", "gain", "Build muscle", "A small surplus to support growth", p.goal)}
      </div>
      ${p.goal === "maintain" ? "" : `
        <div class="row2">
          <div class="field"><span>Current weight</span><div class="ob-now">${p.weight ? `${esc(p.weight)} ${unit}` : "–"}</div></div>
          <label class="field"><span>Goal weight (${unit})</span><input id="obGoalWeight" type="number" inputmode="decimal" min="30" value="${esc(p.goalWeight ?? "")}" placeholder="${unit === "lb" ? "e.g. 175" : "e.g. 78"}"></label>
        </div>
        <div class="ob-label">Pace</div>
        <div class="choices">${paceOptions(p).map((lb, i) => choice("lbPerWeek", lb, `${paceLabel(p, i)} · ${rateText(lb, p)} / week`, paceSub(p, lb), p.lbPerWeek)).join("")}</div>
        <p class="ob-proj" id="obProj">${projectionText(p, personalize(p))}</p>
        <p class="ob-sub">${p.goal === "cut" ? "0.5 to 1% of your body weight a week is sustainable for most people." : "0.25 to 0.5 lb a week keeps fat gain low."}</p>`}`;
    },
    plan: () => {
      const r = personalize(p);
      if (!r) return `<h2>Your plan</h2><p class="ob-lead">Add your weight and height on the "About you" step to get personal targets, or continue with the standard defaults.</p>`;
      return `
        <h2>Your daily plan</h2>
        <div class="ob-plan">
          <div class="ob-kcal"><span class="label">Calories</span><strong data-count="${r.kcalTarget}">${r.kcalTarget}</strong></div>
          <div class="ob-macros">
            <div class="m-protein"><span class="label">Protein</span><strong data-count="${r.proteinTarget}" data-suffix=" g">${r.proteinTarget} g</strong></div>
            <div class="m-carbs"><span class="label">Carbs</span><strong data-count="${r.carbGuide}" data-suffix=" g">${r.carbGuide} g</strong></div>
            <div class="m-fat"><span class="label">Fat</span><strong data-count="${r.fatTarget}" data-suffix=" g">${r.fatTarget} g</strong></div>
            <div class="m-fiber"><span class="label">Fiber</span><strong data-count="${r.fiberTarget}" data-suffix=" g">${r.fiberTarget} g</strong></div>
          </div>
          <div class="ob-tank"><span class="label">Your glycogen tank</span><strong data-count="${r.glycoCap}" data-suffix=" g">${r.glycoCap} g</strong></div>
        </div>
        ${projectionText(p, r) ? `<p class="ob-proj">${projectionText(p, r)}</p>` : ""}
        ${r.calorieFloorApplied ? `<p class="ob-sub">${floorText(p, r)}</p>` : ""}
        <p class="ob-fine">Estimates based on the Mifflin-St Jeor equation and your training. GlycoTank gives general fitness guidance, not medical advice. Check with a doctor or dietitian before big changes, especially if you have a health condition.</p>`;
    },
    reminders: () => `
      <h2>Stay on track</h2>
      <p class="ob-sub">Two gentle daily nudges. You can change them later in Settings.</p>
      <label class="ob-toggle"><input type="checkbox" id="obRemCheckin" checked><span><strong>Morning check-in</strong><em>Score your readiness</em></span><input type="time" id="obRemCheckinAt" value="${reminders.checkin}"></label>
      <label class="ob-toggle"><input type="checkbox" id="obRemLog" checked><span><strong>Evening log</strong><em>Keep your tank accurate</em></span><input type="time" id="obRemLogAt" value="${reminders.log}"></label>`,
    done: () => `
      <div class="ob-hero">${TANK_ICON}</div>
      <h2>You're all set!</h2>
      <ul class="ob-tips">
        <li><strong>Log</strong> meals and workouts with the + tab. Try typing "650 cal 70c 45p".</li>
        <li><strong>Check in</strong> each morning for your readiness score.</li>
        <li>Your tank gets more accurate the more consistently you log.</li>
      </ul>`,
  };

  const nextLabel = { welcome: "Get started", plan: "Use this plan", reminders: "Turn on reminders", done: "Start tracking" };
  const canSkip = { about: "Skip", activity: "Skip", goal: "Skip", reminders: "Not now" };

  let picked = null;

  // A short burst of colored confetti from the top of the screen.
  function confetti() {
    if (reducedMotion()) return;
    const colors = ["#57cc99", "#ffb547", "#5cb8ff", "#ff8f7e", "#b99cff", "#e8ebf1"];
    const burst = document.createElement("div");
    burst.className = "ob-confetti";
    burst.setAttribute("aria-hidden", "true");
    for (let i = 0; i < 46; i++) {
      const bit = document.createElement("i");
      bit.style.cssText = `--x:${Math.round((Math.random() - 0.5) * 340)}px;--up:${-Math.round(80 + Math.random() * 140)}px;--r:${Math.round((Math.random() - 0.5) * 900)}deg;--d:${Math.round(Math.random() * 180)}ms;--c:${colors[i % colors.length]};--w:${6 + Math.round(Math.random() * 5)}px`;
      burst.appendChild(bit);
    }
    root.appendChild(burst);
    haptic.success();
    setTimeout(() => burst.remove(), 2400);
  }

  function readInputs() {
    const v = (id) => $("#" + id, root);
    if (v("obWeight")) {
      p.weight = num(v("obWeight"));
      p.age = num(v("obAge"));
      if (v("obFt")) Object.assign(p, { heightFt: num(v("obFt")), heightIn: num(v("obIn")) });
      if (v("obCm")) p.heightCm = num(v("obCm"));
    }
    if (v("obGoalWeight")) p.goalWeight = num(v("obGoalWeight"));
    if (v("obDays")) {
      Object.assign(p, { daysPerWeek: num(v("obDays")), setsPerSession: num(v("obSets")), cardioMinsPerWeek: num(v("obCardio")), cardioIntensity: +v("obInt").value, lowCarb: v("obLowCarb").checked });
    }
    if (v("obRemCheckin")) {
      reminders.checkin = v("obRemCheckin").checked ? v("obRemCheckinAt").value : "";
      reminders.log = v("obRemLog").checked ? v("obRemLogAt").value : "";
    }
  }

  function render(dir = "") {
    const name = STEPS[step];
    root.innerHTML = `
      <header class="ob-top">
        <button class="icon-btn ob-back" aria-label="Back" ${step === 0 ? "hidden" : ""}>‹</button>
        <div class="ob-progress" role="progressbar" aria-valuemin="1" aria-valuemax="${STEPS.length}" aria-valuenow="${step + 1}"><div style="width:${((step + 1) / STEPS.length) * 100}%"></div></div>
        ${dismissible ? `<button class="icon-btn ob-close" aria-label="Close">✕</button>` : `<span class="ob-count">${step + 1}/${STEPS.length}</span>`}
      </header>
      <div class="ob-body ${dir}" data-step="${name}">${body[name]()}</div>
      <footer class="ob-foot">
        ${canSkip[name] ? `<button class="btn ghost" data-ob="skip">${canSkip[name]}</button>` : ""}
        <button class="btn primary" data-ob="next">${nextLabel[name] || "Continue"}</button>
      </footer>`;
    wire(name);
    if (dir) {
      // Each step's content rises in, one piece after another.
      const stepBody = $(".ob-body", root);
      let i = 0;
      for (const el of stepBody.children) {
        if (el.classList.contains("choices") || el.classList.contains("ob-points")) for (const c of el.children) c.style.setProperty("--i", Math.min(i++, 10));
        else el.style.setProperty("--i", Math.min(i++, 10));
      }
      stepBody.classList.add("ob-stagger");
      $$("[data-count]", root).forEach((el) => countUp(el, +el.dataset.count, 1100, (v) => `${Math.round(v).toLocaleString()}${el.dataset.suffix || ""}`));
      if (name === "done") confetti();
    }
    root.scrollTop = 0;
    $(".ob-body", root).scrollTop = 0;
  }

  function wire(name) {
    if (picked) {
      $(`[data-choice="${picked.key}"][data-value="${picked.value}"]`, root)?.classList.add("picked");
      picked = null;
    }
    $(".ob-back", root).onclick = () => go(-1);
    $(".ob-close", root)?.addEventListener("click", close);
    $$("[data-choice]", root).forEach((b) =>
      b.addEventListener("click", () => {
        readInputs();
        const { choice: key, value } = b.dataset;
        haptic.tap();
        picked = { key, value };
        if (key === "units") Object.assign(p, { weightUnits: value, heightUnits: value === "kg" ? "cm" : "ftin" });
        else if (key === "lbPerWeek") p.lbPerWeek = +value;
        else p[key] = value;
        render();
      }),
    );
    $("#obGoalWeight", root)?.addEventListener("input", () => {
      readInputs();
      const proj = $("#obProj", root);
      const html = projectionText(p, personalize(p));
      if (proj.innerHTML !== html) {
        proj.innerHTML = html;
        proj.classList.toggle("bump", false);
        void proj.offsetWidth; // restart the pulse
        proj.classList.add("bump");
      }
    });
    const next = $('[data-ob="next"]', root);
    if (name === "about") {
      const valid = () => {
        readInputs();
        next.disabled = !personalize(p);
      };
      $$("input", root).forEach((el) => el.addEventListener("input", valid));
      valid();
    }
    next.onclick = async () => {
      readInputs();
      if (name === "plan") applyPlan();
      if (name === "reminders") {
        app.state.settings.reminders = { ...reminders };
        app.save();
        try {
          const ok = await applyReminders(reminders);
          if (!ok) toast("Notifications are off for GlycoTank. You can turn them on in Settings.");
        } catch (e) {
          console.error(e);
        }
      }
      if (name === "done") return finish();
      go(1);
    };
    $('[data-ob="skip"]', root)?.addEventListener("click", () => {
      readInputs();
      go(1);
    });
  }

  function applyPlan() {
    const r = personalize(p);
    app.state.profile = { ...p };
    app.state.settings.units = p.weightUnits;
    if (r) {
      for (const k of ["kcalTarget", "proteinTarget", "carbGuide", "fiberTarget", "glycoCap", "uptakePct", "setCost", "cardioGpm", "dailyUse"]) app.state.settings[k] = r[k];
      app.state.meta.personalized = true;
    }
    app.save();
  }

  function go(delta) {
    const to = Math.max(0, Math.min(STEPS.length - 1, step + delta));
    if (to !== step) haptic.tap();
    step = to;
    render(delta > 0 ? "from-right" : "from-left");
  }

  // Leave a replay without saving anything further.
  function close() {
    root.classList.add("out");
    document.body.classList.remove("onboarding");
    setTimeout(() => {
      root.remove();
      onClose?.();
    }, 350);
  }

  function finish() {
    app.state.meta.introSeen = true;
    app.save();
    success("Welcome to GlycoTank");
    root.classList.add("out");
    document.body.classList.remove("onboarding");
    setTimeout(() => {
      root.remove();
      onFinish?.();
    }, 350);
  }

  render();
  return { close: dismissible ? close : finish };
}
