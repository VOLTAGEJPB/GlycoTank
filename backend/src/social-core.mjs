// Pure helpers for the Friends feature (no AWS calls), shared by social.mjs
// and the tests.

export const HANDLE_RE = /^[a-z0-9_.]{3,20}$/;
const RESERVED = new Set(["admin", "glycotank", "support", "help", "official", "staff", "moderator", "root", "system", "apple", "google"]);
export const EMOJIS = ["💪", "🔥", "🏃", "🚴", "🏋️", "⚡", "🥑", "🍎", "🌱", "🏊", "🧘", "⭐", "🦁", "🐺", "🦅", "🐻", "🦊", "🐢", "🚀", "🎯"];
export const COLORS = ["#57cc99", "#5cb8ff", "#ffb547", "#ff8f7e", "#b99cff", "#ff6b9a", "#4fd1c5", "#a3e635"];
export const MAX_DAYS = 120;

export function cleanHandle(raw) {
  const h = String(raw || "").trim().replace(/^@/, "").toLowerCase();
  if (!HANDLE_RE.test(h)) return { error: "Usernames are 3–20 letters, numbers, dots or underscores." };
  if (RESERVED.has(h) || h.startsWith("glycotank")) return { error: "That username isn't available." };
  return { handle: h };
}

export const cleanName = (raw) => String(raw || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 30);

const pad = (n) => String(n).padStart(2, "0");
export function addDays(date, n) {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

// Today's date (YYYY-MM-DD) in an IANA time zone; UTC if the zone is unknown.
export function todayIn(tz, now = new Date()) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}
export function hourIn(tz, now = new Date()) {
  try {
    return +new Intl.DateTimeFormat("en-US", { timeZone: tz || "UTC", hour: "numeric", hourCycle: "h23" }).format(now);
  } catch {
    return now.getUTCHours();
  }
}

// Days in a row ending today (or yesterday, if today isn't logged yet).
export function runLength(days, today) {
  const set = days instanceof Set ? days : new Set(days || []);
  let day = set.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (set.has(day)) {
    n++;
    day = addDays(day, -1);
  }
  return n;
}

// A shared streak counts the days both friends logged, in a row.
export function sharedStreak(a, b, today) {
  const bs = new Set(b || []);
  return runLength(new Set((a || []).filter((d) => bs.has(d))), today);
}

export function cleanDays(days) {
  if (!Array.isArray(days)) return [];
  return [...new Set(days.filter((d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort().slice(-MAX_DAYS);
}

export function cleanSummary(s) {
  if (!s || typeof s !== "object" || typeof s.date !== "string") return null;
  const num = (v) => (Number.isFinite(+v) ? Math.max(0, Math.min(99999, Math.round(+v))) : 0);
  return { date: s.date.slice(0, 10), kcal: num(s.kcal), protein: num(s.protein), carbs: num(s.carbs), workouts: num(s.workouts) };
}
