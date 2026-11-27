import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanHandle, runLength, sharedStreak, cleanDays, todayIn, addDays } from "../backend/src/social-core.mjs";

test("usernames", () => {
  assert.equal(cleanHandle("@Joel_P").handle, "joel_p");
  assert.ok(cleanHandle("ab").error);
  assert.ok(cleanHandle("has space").error);
  assert.ok(cleanHandle("admin").error);
  assert.ok(cleanHandle("glycotank_team").error);
});

test("personal streak counts back from today or yesterday", () => {
  const t = "2026-11-27";
  assert.equal(runLength(["2026-11-25", "2026-11-26", "2026-11-27"], t), 3);
  assert.equal(runLength(["2026-11-25", "2026-11-26"], t), 2); // today not logged yet
  assert.equal(runLength(["2026-11-24", "2026-11-25"], t), 0); // missed yesterday
  assert.equal(runLength([], t), 0);
});

test("shared streak needs both friends each day", () => {
  const t = "2026-11-27";
  const a = ["2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27"];
  const b = ["2026-11-24", "2026-11-25", "2026-11-26"];
  assert.equal(sharedStreak(a, b, t), 3);
  assert.equal(sharedStreak(a, ["2026-11-27"], t), 1);
  assert.equal(sharedStreak(a, [], t), 0);
});

test("days are cleaned and capped", () => {
  const many = Array.from({ length: 200 }, (_, i) => addDays("2026-01-01", i));
  const out = cleanDays([...many, "bad", 5, "2026-01-01"]);
  assert.equal(out.length, 120);
  assert.equal(out.at(-1), many.at(-1));
});

test("today in a time zone", () => {
  const now = new Date("2026-11-27T03:00:00Z");
  assert.equal(todayIn("America/New_York", now), "2026-11-26");
  assert.equal(todayIn("Asia/Tokyo", now), "2026-11-27");
  assert.equal(todayIn("Not/AZone", now), "2026-11-27");
});
