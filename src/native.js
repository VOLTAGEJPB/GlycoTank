// Device features: exporting data and daily reminders. Uses Capacitor plugins
// on iOS/Android and browser fallbacks on the web.

import { Capacitor } from "@capacitor/core";
import { Filesystem, Directory, Encoding } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { LocalNotifications } from "@capacitor/local-notifications";

const native = Capacitor.isNativePlatform();

// Native: write to the cache folder and open the share sheet (save to Files,
// email, Drive…). Web: trigger a download.
export async function shareFile(filename, text, mime = "text/plain") {
  if (native) {
    const { uri } = await Filesystem.writeFile({ path: filename, data: text, directory: Directory.Cache, encoding: Encoding.UTF8 });
    await Share.share({ title: filename, url: uri });
    return;
  }
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const csvCell = (v) => {
  const t = String(v ?? "");
  return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

export function toCsv(rows, columns) {
  return [columns.join(","), ...rows.map((r) => columns.map((c) => csvCell(r[c])).join(","))].join("\n");
}

const REMINDERS = {
  log: { id: 101, title: "GlycoTank", body: "Log today's meals and training to keep your tank accurate." },
  checkin: { id: 102, title: "GlycoTank", body: "Morning check-in: how did you sleep?" },
};

export const remindersSupported = native;

// Schedules a daily notification for each reminder with a time set ("HH:MM").
// Returns false if the user declined notification permission.
export async function applyReminders(times) {
  if (!native) return false;
  const ids = Object.values(REMINDERS).map((r) => ({ id: r.id }));
  await LocalNotifications.cancel({ notifications: ids });
  const wanted = Object.entries(REMINDERS).filter(([k]) => times[k]);
  if (!wanted.length) return true;
  let perm = await LocalNotifications.checkPermissions();
  if (perm.display !== "granted") perm = await LocalNotifications.requestPermissions();
  if (perm.display !== "granted") return false;
  await LocalNotifications.schedule({
    notifications: wanted.map(([k, r]) => {
      const [hour, minute] = times[k].split(":").map(Number);
      // Exact by default: on Android 12+ the plugin opens the "Alarms & reminders"
      // setting if needed, and falls back to inexact timing if the user declines.
      return { ...r, schedule: { on: { hour, minute }, allowWhileIdle: true }, isExactMandatory: false };
    }),
  });
  return true;
}
