import "./styles.css";
import { App as NativeApp } from "@capacitor/app";
import { loadState, saveState, saveQuietly, resetState, flush, emptyState, onSaved } from "./store.js";
import * as auth from "./auth.js";
import { initSync, scheduleSync, syncNow } from "./sync.js";
import { openAuth } from "./views/auth.js";
import { $, $$ } from "./ui.js";
import { enterView, haptic, reducedMotion } from "./motion.js";
import { glycoSeries, localDate } from "./model.js";
import { renderToday } from "./views/today.js";
import { renderLog, openLog } from "./views/log.js";
import { renderCheckin } from "./views/checkin.js";
import { renderHistory } from "./views/history.js";
import { renderSettings } from "./views/settings.js";
import { openOnboarding } from "./views/onboarding.js";

// Accounts are required once the cloud backend is configured (see cloud-config.js).
const ACCOUNT_REQUIRED = true;

const VIEWS = {
  today: { title: "GlycoTank", render: renderToday },
  log: { title: "Log", render: renderLog },
  checkin: { title: "Check-in", render: renderCheckin },
  history: { title: "History", render: renderHistory },
  settings: { title: "Settings", render: renderSettings },
};

const app = {
  version: __APP_VERSION__,
  state: null,
  current: "today",
  editing: null,
  save() {
    saveState(app.state);
  },
  saveQuietly() {
    saveQuietly(app.state);
  },
  // Re-render the current screen after data changed in the background (sync).
  refresh() {
    if (!app.editing && !document.querySelector("#onboard, #auth")) app.go(app.current);
  },
  go(view, section) {
    if (view === "log") openLog(app, section, app.editing);
    app.current = view;
    const tabs = $$("#tabs button");
    tabs.forEach((b) => b.setAttribute("aria-current", b.dataset.view === view ? "page" : "false"));
    $("#tabs").style.setProperty("--tab", tabs.findIndex((b) => b.dataset.view === view));
    $("#title").textContent = VIEWS[view].title;
    const root = $("#view");
    VIEWS[view].render(root, app);
    if (!app.launching) enterView(root);
    window.scrollTo(0, 0);
    if (section && view === "settings") $("#" + section)?.scrollIntoView({ block: "start" });
  },
  replaceState(next) {
    app.state = next;
    saveState(next);
    flush();
    app.go("today");
  },
  // Sign out: clear this device and show the sign-in screen again.
  async signOut() {
    await syncNow();
    await auth.signOut();
    app.state = emptyState();
    resetState(app.state);
    await flush();
    app.go("today");
    await requireAccount();
  },
  showIntro,
};

// Tabs and any element with data-go / data-edit anywhere in the app.
document.addEventListener("click", (e) => {
  const edit = e.target.closest("[data-edit]");
  if (edit) {
    app.editing = { kind: edit.dataset.edit, id: edit.dataset.id };
    return app.go("log", edit.dataset.edit);
  }
  const go = e.target.closest("[data-go]");
  if (go) {
    e.preventDefault();
    app.editing = null;
    app.go(go.dataset.go, go.dataset.section);
  }
});
$$("#tabs button").forEach((b) =>
  b.addEventListener("click", () => {
    if (b.dataset.view !== app.current) haptic.tap();
    app.editing = null;
    app.go(b.dataset.view);
  }),
);

// ---------- First-run setup ----------
function showIntro(options) {
  if (document.getElementById("onboard")) return;
  openOnboarding(app, { ...options, onFinish: () => app.go("today") });
}

// Android back button: close any open dialog, then go back to Today, then exit.
NativeApp.addListener("backButton", () => {
  const open = document.querySelector("dialog[open]");
  if (open) return open.close();
  if (document.getElementById("auth")) return; // sign-in can't be skipped
  const back = document.querySelector("#onboard .ob-back:not([hidden])");
  if (back) return back.click();
  const close = document.querySelector("#onboard .ob-close");
  if (close) return close.click();
  if (document.getElementById("onboard")) return;
  if (app.current !== "today" || app.editing) {
    app.editing = null;
    return app.go("today");
  }
  NativeApp.exitApp();
});

// ---------- Launch animation ----------
// The tank outline draws, fuel rises to today's real level, then the overlay
// fades out as the first screen's cards rise in. Skipped for Reduce Motion.
function playLaunch(fraction) {
  const el = $("#launch");
  if (reducedMotion()) {
    el.remove();
    return Promise.resolve();
  }
  // The wave's crest sits at y=60; the tank's inside spans y=18..150.
  const level = Math.min(0.97, Math.max(0.08, fraction));
  el.style.setProperty("--fuel-to", `${18 + 132 * (1 - level) - 60}px`);
  el.classList.add("play");
  return new Promise((resolve) =>
    setTimeout(() => {
      el.classList.add("out");
      resolve();
      setTimeout(() => el.remove(), 500);
    }, 1550),
  );
}

// ---------- Accounts ----------
// Shows sign-in until there's a session, then pulls the account's data. A
// different account than the one this device last synced starts from empty.
async function requireAccount() {
  if (!auth.configured()) return;
  let session = auth.current();
  if (!session && ACCOUNT_REQUIRED) session = await openAuth();
  if (!session) return;
  const st = app.state;
  if (st.sync?.owner && st.sync.owner !== session.sub) {
    app.state = emptyState();
    resetState(app.state);
  }
  app.state.sync = { ...(app.state.sync || { cursor: 0, pushedAt: 0 }), owner: session.sub };
  app.saveQuietly();
  await syncNow();
  app.go(app.current);
}

// ---------- Start ----------
(async () => {
  app.state = location.search.includes("demo") ? (await import("./demo.js")).demoState() : await loadState();
  if (location.search.includes("demo")) app.save = () => {}; // never overwrite real data with the sample
  const params = new URLSearchParams(location.search);
  const skipLaunch = params.has("demo") && !params.has("launch");
  if (skipLaunch) $("#launch").remove();
  app.launching = !skipLaunch;
  app.go(params.has("demo") && VIEWS[params.get("view")] ? params.get("view") : "today", params.get("section") || undefined);
  if (app.launching) {
    const today = localDate();
    await playLaunch(glycoSeries(app.state, today)[today].end / app.state.settings.glycoCap);
    app.launching = false;
    enterView($("#view"));
    app.revealToday?.();
  }
  if (!params.has("demo")) {
    await auth.restore();
    initSync(app);
    onSaved(scheduleSync);
    await requireAccount();
  }
  if (!app.state.meta.introSeen || params.has("intro")) showIntro({ startAt: +(params.get("intro") || 0) });
  if (params.has("demo") && params.get("scroll")) document.querySelectorAll(".card")[+params.get("scroll")]?.scrollIntoView({ block: "start" });
  // Demo only: pre-fill fields for screenshots, e.g. &fill=mName:Chicken bowl|mQuick:650 cal 70c
  if (params.has("demo") && params.get("fill")) {
    for (const pair of params.get("fill").split("|")) {
      const [id, value] = pair.split(/:(.*)/s);
      const el = document.getElementById(id);
      if (!el) continue;
      el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }
  // Re-render when the app comes back to the foreground on a new day.
  let lastDay = new Date().toDateString();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && new Date().toDateString() !== lastDay) {
      lastDay = new Date().toDateString();
      if (!app.editing) app.go(app.current);
    }
  });
})();
