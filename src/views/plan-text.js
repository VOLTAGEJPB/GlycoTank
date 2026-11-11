// Wording shared by onboarding and Goals: pace options, the goal-date
// projection and the calorie-minimum note, all in the user's units.

import { personalize, maxRate, KG_PER_LB } from "../model.js";
import { esc } from "../ui.js";

const kg = (p) => p.weightUnits === "kg";
const fmt = (x) => String(Math.round(x * 100) / 100);

// "1.5 lb" or "0.75 kg" for a pace given in lb per week.
export function rateText(lb, p) {
  return kg(p) ? `${fmt(Math.abs(lb) * KG_PER_LB)} kg` : `${fmt(Math.abs(lb))} lb`;
}

export function weightLb(p) {
  const w = +p.weight || 0;
  return kg(p) ? w / KG_PER_LB : w;
}

// Pace choices for the goal, in lb per week, up to the safe maximum.
export function paceOptions(p) {
  const max = maxRate(p.goal, weightLb(p));
  if (!max) return [];
  const steps = kg(p)
    ? (p.goal === "gain" ? [0.1, 0.25, 0.4, 0.5] : [0.25, 0.5, 0.75, 1]).map((x) => x / KG_PER_LB)
    : p.goal === "gain" ? [0.25, 0.5, 0.75, 1] : [0.5, 1, 1.5, 2];
  const out = steps.filter((x) => x <= max + 1e-6);
  if (p.goal === "cut" && max - out[out.length - 1] > 0.1) out.push(max);
  return out.map((x) => Math.round(x * 10000) / 10000);
}

// Snaps the saved pace to the closest offered choice.
export function snapPace(p) {
  const opts = paceOptions(p);
  if (!opts.length) return;
  const cur = Math.abs(+p.lbPerWeek || 1);
  p.lbPerWeek = opts.reduce((best, x) => (Math.abs(x - cur) < Math.abs(best - cur) ? x : best), opts[0]);
}

const PACE_NAMES = { cut: ["Relaxed", "Steady", "Faster", "Fastest", "Fastest"], gain: ["Lean", "Steady", "Faster", "Fastest"] };

export function paceLabel(p, i) {
  return (PACE_NAMES[p.goal] || [])[i] || "";
}

// "1,847 kcal a day", or the minimum with the slower real pace.
export function paceSub(p, lb) {
  const r = personalize({ ...p, lbPerWeek: lb });
  if (!r) return "";
  if (r.calorieFloorApplied) return `${r.kcalTarget.toLocaleString()} kcal a day (the minimum), about ${rateText(r.actualLbPerWeek, p)} a week`;
  return `${r.kcalTarget.toLocaleString()} kcal a day`;
}

function dateIn(weeks) {
  const d = new Date();
  d.setDate(d.getDate() + weeks * 7);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

// "193 → 180 lb in about 13 weeks (around Feb 10, 2027)", or a hint when the goal
// weight doesn't match the goal.
export function projectionText(p, r) {
  if (!r || p.goal === "maintain" || !(+p.goalWeight > 0)) return "";
  const unit = kg(p) ? "kg" : "lb";
  if (!r.weeksToGoal) {
    const wrongWay = (p.goal === "cut") === (+p.goalWeight > +p.weight);
    return wrongWay
      ? `Your goal weight is ${p.goal === "cut" ? "above" : "below"} your current weight. Pick ${p.goal === "cut" ? "Build muscle" : "Lose fat"} instead, or check the number.`
      : "";
  }
  return `<strong>${esc(fmt(+p.weight))} → ${esc(fmt(+p.goalWeight))} ${unit}</strong> in about ${r.weeksToGoal} week${r.weeksToGoal === 1 ? "" : "s"}, around ${dateIn(r.weeksToGoal)}.`;
}

// Explains the calorie minimum in terms of the pace the user actually gets.
export function floorText(p, r) {
  if (!r?.calorieFloorApplied) return "";
  const verb = p.goal === "gain" ? "gain" : "lose";
  return `To ${verb} ${rateText(r.lbPerWeek, p)} a week you'd need about ${r.wantedKcal.toLocaleString()} calories a day. That's below the ${r.floor.toLocaleString()} minimum we use without professional guidance, so your plan uses ${r.floor.toLocaleString()} and you'll ${verb} about ${rateText(r.actualLbPerWeek, p)} a week. A more active day (more steps or training) raises your calories.`;
}
