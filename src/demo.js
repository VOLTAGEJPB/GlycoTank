// Sample data for screenshots and testing. Only loaded when the page URL
// contains ?demo, which can't happen inside the installed app.
import { localDate, addDays, personalize } from "./model.js";
import { emptyState } from "./store.js";

const MEALS = [
  ["Greek yogurt & berries", 320, 38, 24, 6, 5],
  ["Chicken rice bowl", 680, 82, 48, 16, 7],
  ["Protein shake", 210, 9, 40, 3, 1],
  ["Salmon, potatoes & greens", 720, 64, 46, 28, 9],
  ["Oatmeal with banana", 410, 72, 14, 8, 9],
  ["Turkey sandwich", 480, 52, 34, 14, 6],
  ["Pasta with meat sauce", 760, 96, 38, 22, 8],
];

export function demoState() {
  const st = emptyState();
  st.meta = { introSeen: true, personalized: true };
  st.profile = { weight: 185, weightUnits: "lb", heightUnits: "ftin", heightFt: 5, heightIn: 11, age: 32, sex: "m", goal: "maintain", daysPerWeek: 4, setsPerSession: 14, cardioMinsPerWeek: 90, cardioIntensity: 3 };
  const t = personalize(st.profile);
  for (const k of ["kcalTarget", "proteinTarget", "carbGuide", "fiberTarget", "glycoCap", "uptakePct", "setCost", "cardioGpm", "dailyUse"]) st.settings[k] = t[k];
  st.settings.units = "lb";
  const today = localDate();
  let id = 0;
  for (let d = 13; d >= 0; d--) {
    const date = addDays(today, -d);
    const picks = d === 0 ? [0, 1, 2] : [d % 7, (d + 2) % 7, (d + 4) % 7];
    picks.forEach((i, n) => {
      const [name, kcal, carbs, protein, fat, fiber] = MEALS[i];
      const slot = d === 0 ? ["breakfast", "lunch", "snack"][n] : ["breakfast", "lunch", "dinner"][n];
      st.meals.push({ id: "m" + id++, date, slot, name, kcal, carbs, protein, fat, fiber, notes: "" });
    });
    if (d % 7 === 1 || d % 7 === 4) {
      st.workouts.push({ id: "w" + id++, date, type: "strength", name: "Back Squat", sets: 5, reps: 5, weight: 225, sessionName: "Leg day", notes: "" });
      st.workouts.push({ id: "w" + id++, date, type: "strength", name: "Romanian Deadlift", sets: 4, reps: 8, weight: 185, sessionName: "Leg day", notes: "" });
    } else if (d % 7 === 2 || d % 7 === 5 || d === 0) {
      st.workouts.push({ id: "w" + id++, date, type: "strength", name: "Bench Press", sets: 5, reps: 5, weight: 185, sessionName: "Upper A", notes: "" });
      st.workouts.push({ id: "w" + id++, date, type: "strength", name: "Pull-up", sets: 4, reps: 8, weight: 0, sessionName: "Upper A", notes: "" });
    } else if (d % 7 === 3) {
      st.workouts.push({ id: "w" + id++, date, type: "cardio", name: "Run", mins: 40, intensity: 4, notes: "" });
    }
    st.checks.push({ id: "c" + id++, date, mood: d % 4 === 0 ? "great" : "ok", sleep: 7 + (d % 3) * 0.5, rhr: 54 + (d % 4), notes: "" });
  }
  st.profile.name = "Alex";
  st.profile.measurements = [13, 10, 7, 4, 1].map((d, i) => ({ date: addDays(today, -d), weight: 188 - i * 0.8, waist: 34.5 - i * 0.2 }));
  st.workoutFavs = [
    { type: "routine", name: "Upper A", exercises: [{ name: "Bench Press", sets: 5, reps: 5, weight: 185 }, { name: "Pull-up", sets: 4, reps: 8, weight: 0 }, { name: "Overhead Press", sets: 3, reps: 8, weight: 115 }] },
    { type: "routine", name: "Leg day", exercises: [{ name: "Back Squat", sets: 5, reps: 5, weight: 225 }, { name: "Romanian Deadlift", sets: 4, reps: 8, weight: 185 }] },
    { type: "cardio", name: "Run", mins: 40, intensity: 4 },
  ];
  return st;
}
