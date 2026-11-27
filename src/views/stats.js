// Owner's dashboard (More > Stats): how many people use GlycoTank. The server
// only answers GET /stats for the owner's account; for everyone else it's a
// 404, and the Stats row never shows up.
import { CLOUD } from "../cloud-config.js";
import * as auth from "../auth.js";
import { $, esc } from "../ui.js";

let checked = null; // promise of the first answer, shared for this app session

async function load() {
  const res = await fetch(`${CLOUD.apiUrl}/stats?tz=${-new Date().getTimezoneOffset()}`, {
    headers: { Authorization: `Bearer ${await auth.idToken()}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`stats ${res.status}`);
  return res.json();
}

// Resolves to the stats if this account may see them, else null. Asked once per session.
export function ownerStats() {
  if (/[?&]demo/.test(location.search)) return Promise.resolve(/[?&]owner/.test(location.search) ? demoStats() : null);
  if (!CLOUD.apiUrl || !auth.current()) return Promise.resolve(null);
  checked ??= load().catch(() => ((checked = null), null));
  return checked;
}

// Sample numbers for the web preview (?demo&owner).
function demoStats() {
  const day = (i) => new Date(Date.now() - i * 864e5).toLocaleDateString("en-CA");
  const days = Array.from({ length: 14 }, (_, k) => {
    const i = 13 - k;
    return { day: day(i), newUsers: [0, 1, 0, 2, 1, 0, 3, 1, 2, 4, 2, 3, 5, 2][k], activeUsers: [2, 3, 3, 4, 4, 5, 6, 6, 7, 8, 9, 9, 11, 10][k], meals: 0, scans: 0 };
  });
  const ago = (h) => new Date(Date.now() - h * 36e5).toISOString();
  return {
    generatedAt: new Date().toISOString(), today: day(0),
    users: { total: 31, confirmed: 29, providers: { Apple: 14, Google: 9, Email: 8 }, newToday: 2, new7: 18 },
    active: { today: 10, last7: 17, last30: 24 }, meals: { total: 412, today: 23 }, scans: { today: 9 }, days,
    accounts: [["sam.r@example.com", ["Apple"], 1, 0.5, 2], ["lee.fit@example.com", ["Google", "Email"], 3, 2, 6], ["maria.k@example.com", ["Apple"], 20, 5, 11], ["dev.test@example.com", ["Email"], 26, null, 0]]
      .map(([email, via, h, a, meals]) => ({ email, via, joined: ago(h), lastActive: a == null ? null : ago(a), meals, confirmed: true })),
  };
}

const fmtDay = (d) => new Date(d + "T12:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
const ago = (iso) => {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (mins < 60) return `${Math.max(1, mins)} min ago`;
  if (mins < 24 * 60) return `${Math.round(mins / 60)} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

function bars(days, key, label) {
  const max = Math.max(1, ...days.map((d) => d[key]));
  const total = days.reduce((s, d) => s + d[key], 0);
  return `
    <section class="card stat-chart">
      <div class="stat-chart-head"><h2>${label}</h2><span class="hint">${key === "activeUsers" ? `Busiest day: ${max}` : `${total} in 14 days`}</span></div>
      <div class="stat-bars" role="img" aria-label="${esc(label)} per day for the last 14 days">
        ${days.map((d, i) => `<div class="bar${i === days.length - 1 ? " today" : ""}" title="${esc(fmtDay(d.day))}: ${d[key]}"><span style="height:${Math.round((d[key] / max) * 100)}%"></span>${d[key] ? `<em>${d[key]}</em>` : ""}</div>`).join("")}
      </div>
      <div class="stat-axis"><span>${esc(fmtDay(days[0].day))}</span><span>Today</span></div>
    </section>`;
}

function draw(body, s) {
  const p = s.users.providers;
  const total = Math.max(1, p.Email + p.Google + p.Apple);
  body.innerHTML = `
    <div class="stat-tiles">
      <div class="stat-tile big"><span class="label">Total users</span><strong>${s.users.total}</strong><small>+${s.users.new7} this week · +${s.users.newToday} today · ${s.active.last30} active this month</small></div>
      <div class="stat-tile"><span class="label">Active today</span><strong>${s.active.today}</strong><small>${s.active.last7} this week</small></div>
      <div class="stat-tile"><span class="label">Meals today</span><strong>${s.meals.today}</strong><small>${s.meals.total} all time</small></div>
      <div class="stat-tile"><span class="label">Scans today</span><strong>${s.scans.today}</strong><small>Photos + receipts</small></div>
    </div>
    ${bars(s.days, "newUsers", "New sign-ups")}
    ${bars(s.days, "activeUsers", "Active users")}
    <section class="card">
      <h2>How people sign in</h2>
      <div class="stat-split">${["Apple", "Google", "Email"].map((k) => `<span class="seg ${k.toLowerCase()}" style="flex:${p[k]}"></span>`).join("")}</div>
      <div class="stat-legend">${["Apple", "Google", "Email"].map((k) => `<span><i class="${k.toLowerCase()}"></i>${k} <b>${p[k]}</b> <small>${Math.round((p[k] / total) * 100)}%</small></span>`).join("")}</div>
    </section>
    <section class="card">
      <div class="stat-chart-head"><h2>Accounts</h2><span class="hint">Newest first</span></div>
      ${s.accounts?.length ? `<ul class="stat-accounts">${s.accounts.map((a) => `
        <li><strong>${esc(a.email)}</strong>
          <small>${esc(a.via.join(" + "))} · joined ${esc(ago(a.joined))} · ${a.lastActive ? `active ${esc(ago(a.lastActive))}` : "never synced"} · ${a.meals} ${a.meals === 1 ? "meal" : "meals"}${a.confirmed ? "" : " · not confirmed"}</small></li>`).join("")}</ul>` : `<p class="hint">No accounts yet.</p>`}
    </section>
    ${s.social ? `<section class="card">
      <div class="stat-chart-head"><h2>Friends</h2><span class="hint">${s.social.profiles} ${s.social.profiles === 1 ? "profile" : "profiles"}</span></div>
      ${s.social.reports.length ? `<p class="hint">Reports to review (Apple expects action within 24 hours). Ask Claude to remove a photo or ban an account.</p><ul class="stat-accounts">${s.social.reports.map((r) => `
        <li><strong>@${esc(r.handle || "?")}</strong><small>${esc(r.reason || "No reason")} · ${esc(ago(r.at))}</small></li>`).join("")}</ul>` : `<p class="hint">No reports.</p>`}
    </section>` : ""}
    <p class="hint stat-foot">Updated ${new Date(s.generatedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })} · Users with the same email count once. Active means the app synced that day. Only your account can see this. <button type="button" class="link-btn" id="statsRefresh">Refresh</button></p>`;
}

export async function renderStats(body) {
  body.innerHTML = `<p class="hint">Loading stats…</p>`;
  const show = async (fresh) => {
    if (fresh) checked = null;
    try {
      const s = await ownerStats();
      if (!body.isConnected) return;
      if (!s) return (body.innerHTML = `<p class="hint">Stats aren't available for this account.</p>`);
      draw(body, s);
      $("#statsRefresh").onclick = () => show(true);
    } catch {
      body.innerHTML = `<p class="hint">Couldn't load stats. Check your connection.</p>`;
    }
  };
  await show(false);
}
