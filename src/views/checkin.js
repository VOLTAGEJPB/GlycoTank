import { localDate, readiness, readinessFor, baselineRhr } from "../model.js";
import { uid } from "../store.js";
import { $, esc, num, field, select, toast, prettyDate } from "../ui.js";

const MOODS = [["great", "Great"], ["ok", "OK"], ["tired", "Tired"], ["stressed", "Stressed"], ["sore", "Sore"]];

export function renderCheckin(root, app) {
  const { state } = app;
  const today = localDate();
  const existing = state.checks.find((c) => c.date === today);
  const v = existing || { mood: "ok" };
  const recent = [...state.checks].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 7);

  root.innerHTML = `
    <section class="card">
      <h2>Morning check-in</h2>
      <p class="hint">Takes 10 seconds. Your readiness score comes from your sleep, how your resting heart rate compares with your usual level, and how you feel.</p>
      <div class="row2">
        ${field("cDate", "Date", 'type="date"', v.date || today)}
        ${select("cMood", "How do you feel?", MOODS, v.mood)}
      </div>
      <div class="row2">
        ${field("cSleep", "Sleep (hours)", 'type="number" inputmode="decimal" min="0" max="16" step="0.5"', v.sleep ?? "")}
        ${field("cRhr", "Resting heart rate", 'type="number" inputmode="numeric" min="30" max="140" placeholder="optional"', v.rhr || "")}
      </div>
      ${field("cNotes", "Notes", 'placeholder="Optional"', v.notes)}
      <div class="plan-out"><span class="label">Readiness</span><span class="kpi" id="cScore">–</span></div>
      <div class="actions"><button class="btn primary" id="cSave">${existing ? "Update check-in" : "Save check-in"}</button></div>
    </section>
    ${recent.length ? `
    <section class="card">
      <h2>Recent check-ins</h2>
      <ul class="entries">${recent.map((c) => {
        const r = readinessFor(state, c);
        return `<li><div class="entry static"><span class="entry-main"><strong>${esc(prettyDate(c.date, today))}</strong><span class="entry-kcal">${r.score} · ${esc(r.label)}</span></span>
          <span class="entry-sub">${esc(MOODS.find(([k]) => k === c.mood)?.[1] || c.mood)} · ${c.sleep || "–"} h sleep${c.rhr ? ` · ${c.rhr} bpm` : ""}</span></div></li>`;
      }).join("")}</ul>
    </section>` : ""}`;

  const read = () => ({ date: $("#cDate").value || today, mood: $("#cMood").value, sleep: num($("#cSleep")), rhr: num($("#cRhr")), notes: $("#cNotes").value.trim() });
  const preview = () => {
    const data = read();
    const r = readiness(data, baselineRhr(state, data.date));
    $("#cScore").textContent = `${r.score} · ${r.label}`;
  };
  ["cMood", "cSleep", "cRhr"].forEach((id) => $("#" + id).addEventListener("input", preview));
  preview();

  $("#cSave").addEventListener("click", () => {
    const data = read();
    const i = state.checks.findIndex((c) => c.date === data.date);
    if (i >= 0) state.checks[i] = { ...state.checks[i], ...data };
    else state.checks.push({ id: uid(), ...data });
    app.save();
    toast("Check-in saved");
    app.go("today");
  });
}
