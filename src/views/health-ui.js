// Apple Health / Health Connect screens: the "Today's activity" card on Tank,
// the More > Apple Health page, and the Check-in prefill line.
import { $, esc, toast, success } from "../ui.js";
import { healthAvailable, healthConnected, connectHealth, disconnectHealth, openHealthSettings, syncHealth, healthToday, healthName } from "../health.js";
import { BASE_STEPS } from "../model.js";
import { Capacitor } from "@capacitor/core";

const hours = (mins) => `${Math.floor(mins / 60)}h ${String(Math.round(mins % 60)).padStart(2, "0")}m`;
const fmt = (n) => Math.round(n).toLocaleString();
const heartIcon = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.7 4.5c2 0 3.6 1.1 4.4 2.6l.9 1.5.9-1.5c.8-1.5 2.4-2.6 4.4-2.6 3.7 0 5.8 3.9 4.3 7.3C19.5 16.4 12 21 12 21z"/></svg>`;

function statsHtml(t) {
  const items = [
    t.steps != null && [fmt(t.steps), "steps", t.steps > BASE_STEPS ? `+${Math.round((t.steps - BASE_STEPS) * 0.003)} g used` : ""],
    t.activeKcal != null && [fmt(t.activeKcal), "active kcal", ""],
    t.sleep && [hours(t.sleep.asleep), "sleep", t.sleep.score != null ? `Score ${t.sleep.score}` : ""],
    t.rhr && [t.rhr, "resting bpm", t.hrv ? `HRV ${t.hrv} ms` : ""],
  ].filter(Boolean);
  return items.length
    ? `<div class="health-stats">${items.map(([v, l, sub]) => `<div><strong>${esc(String(v))}</strong><span>${esc(l)}</span>${sub ? `<small>${esc(sub)}</small>` : ""}</div>`).join("")}</div>`
    : `<p class="hint">No data for today yet. Wear your watch, or open the Health app once so it syncs.</p>`;
}

// Fills the Tank screen's #healthCard: today's numbers, or an offer to connect.
export async function fillHealthCard(app) {
  const card = $("#healthCard");
  if (!card) return;
  const t = healthToday(app.state);
  if (healthConnected() || t) {
    card.hidden = false;
    card.innerHTML = `<div class="card-head"><h2>Today's activity</h2><span class="sub">${esc(healthName())}</span></div>${statsHtml(t || {})}`;
    return;
  }
  if (!(await healthAvailable()) || app.state.meta.healthOfferDismissed) return;
  if (!card.isConnected) return;
  card.hidden = false;
  card.innerHTML = `
    <div class="health-offer"><span class="health-icon">${heartIcon}</span>
      <div><strong>Connect ${esc(healthName())}</strong><span>Log watch workouts automatically and see steps, sleep and heart rate here.</span></div></div>
    <div class="actions"><button class="btn primary" id="healthConnect">Connect</button><button class="btn ghost" id="healthLater">Not now</button></div>`;
  $("#healthConnect").onclick = () => connect(app);
  $("#healthLater").onclick = () => {
    app.state.meta.healthOfferDismissed = true;
    app.save();
    card.hidden = true;
  };
}

async function connect(app) {
  try {
    if (await connectHealth(app)) {
      success(`${healthName()} connected`);
      app.refresh();
    } else toast(`${healthName()} access wasn't allowed. You can turn it on in More > ${healthName()}.`);
  } catch (e) {
    console.error(e);
    toast(`Couldn't connect to ${healthName()}.`);
  }
}

// More > Apple Health (or Health Connect).
export async function renderHealthSettings(body, app) {
  const name = healthName();
  const ios = Capacitor.getPlatform() === "ios";
  body.innerHTML = `<p class="hint">Checking ${esc(name)}…</p>`;
  const available = await healthAvailable();
  const on = healthConnected();
  const t = healthToday(app.state);
  const imported = app.state.workouts.filter((w) => w.source === "health").length;
  body.innerHTML = `
    <section class="card">
      <div class="health-offer"><span class="health-icon">${heartIcon}</span>
        <div><strong>${esc(name)}</strong><span>${on ? "Connected on this phone" : available ? "Not connected" : `Not available on this device${ios ? "" : ". Install Health Connect from the Play Store."}`}</span></div></div>
      <p class="hint">GlycoTank reads your workouts, steps, sleep, resting heart rate, heart rate variability and active calories. Watch workouts are added to Training automatically, steps count toward your tank, and sleep and heart rate fill in your check-in. GlycoTank never writes to ${esc(name)}, and health data is never used for ads.</p>
      <div class="actions">
        ${available && !on ? `<button class="btn primary" id="hsConnect">Connect ${esc(name)}</button>` : ""}
        ${on ? `<button class="btn primary" id="hsSync">Sync now</button><button class="btn ghost" id="hsOff">Disconnect</button>` : ""}
        ${!available && !ios ? `<button class="btn" id="hsInstall">Open Health Connect</button>` : ""}
      </div>
    </section>
    <section class="card"><h2>Oura, Garmin, Whoop and other devices</h2><p class="hint">GlycoTank reads whatever your devices share with ${esc(name)}. In the Oura app, open Settings, then ${esc(name)}, and turn sharing on. Other rings and watches have the same switch in their own app.</p></section>
    ${on || t ? `<section class="card"><h2>Today</h2>${statsHtml(t || {})}<p class="hint">${imported} ${imported === 1 ? "workout" : "workouts"} imported so far.</p></section>` : ""}
    ${on ? `<section class="card"><h2>Choose what's shared</h2><p class="hint">${ios ? "Open the Health app, tap your profile picture, then Apps, then GlycoTank, to change what GlycoTank can read." : "Change what GlycoTank can read in Health Connect."}</p>${ios ? "" : `<button class="btn" id="hsPerms">Open Health Connect</button>`}</section>` : ""}`;
  $("#hsConnect")?.addEventListener("click", async () => {
    await connect(app);
    renderHealthSettings(body, app);
  });
  $("#hsSync")?.addEventListener("click", async (e) => {
    e.target.disabled = true;
    const changed = await syncHealth(app, { force: true }).catch(() => false);
    toast(changed ? "Updated" : "Already up to date");
    renderHealthSettings(body, app);
  });
  $("#hsOff")?.addEventListener("click", () => {
    disconnectHealth();
    toast(`${name} disconnected. ${ios ? "To remove access completely, turn GlycoTank off in the Health app too." : ""}`);
    renderHealthSettings(body, app);
  });
  $("#hsPerms")?.addEventListener("click", openHealthSettings);
  $("#hsInstall")?.addEventListener("click", openHealthSettings);
}

// Check-in: last night's sleep and this morning's heart numbers, if any.
export function checkinFromHealth(state) {
  const t = healthToday(state);
  if (!t || (!t.sleep && !t.rhr)) return null;
  return {
    sleep: t.sleep ? Math.round((t.sleep.asleep / 60) * 4) / 4 : null,
    rhr: t.rhr || null,
    line: [t.sleep && `${hours(t.sleep.asleep)} sleep${t.sleep.score != null ? ` (score ${t.sleep.score})` : ""}`, t.rhr && `${t.rhr} bpm resting`, t.hrv && `HRV ${t.hrv} ms`].filter(Boolean).join(" · "),
  };
}
