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
      <div><strong>Connect ${esc(healthName())}</strong><span>Watch workouts, steps, sleep and heart rate.</span></div></div>
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
        <div><strong>${esc(name)}</strong><span>${on ? "Connected" : available ? "Not connected" : ios ? "Not available" : "Install Health Connect first"}</span></div></div>
      <p class="hint">Workouts, steps, sleep and heart rate. Read-only, never used for ads.</p>
      <div class="actions">
        ${available && !on ? `<button class="btn primary" id="hsConnect">Connect</button>` : ""}
        ${on ? `<button class="btn primary" id="hsSync">Sync now</button><button class="btn ghost" id="hsOff">Disconnect</button>` : ""}
        ${!available && !ios ? `<button class="btn" id="hsInstall">Open Health Connect</button>` : ""}
      </div>
    </section>
    ${on || t ? `<section class="card"><div class="card-head"><h2>Today</h2><span class="sub">${imported} ${imported === 1 ? "workout" : "workouts"} imported</span></div>${statsHtml(t || {})}</section>` : ""}
    <p class="hint health-tips">Oura, Garmin or Whoop? Turn on ${esc(name)} sharing in their app.${on ? ` ${ios ? "Change access in Health → Profile → Apps." : `<button type="button" class="link-btn" id="hsPerms">Change access</button>`}` : ""}</p>`;
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
