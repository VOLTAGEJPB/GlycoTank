import "./styles.css";
import { App as NativeApp } from "@capacitor/app";
import { loadState, saveState, flush } from "./store.js";
import { $, $$ } from "./ui.js";
import { enterView, haptic, reducedMotion } from "./motion.js";
import { glycoSeries, localDate } from "./model.js";
import { renderToday } from "./views/today.js";
import { renderLog, openLog } from "./views/log.js";
import { renderCheckin } from "./views/checkin.js";
import { renderHistory } from "./views/history.js";
import { renderSettings } from "./views/settings.js";

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

// ---------- Intro ----------
function showIntro() {
  const dlg = $("#intro");
  const slides = $$(".slide", dlg);
  let i = 0;
  const show = (dir = "") => {
    slides.forEach((s, n) => {
      s.hidden = n !== i;
      s.classList.remove("from-right", "from-left");
      if (n === i && dir) s.classList.add(dir);
    });
    $$(".dots span", dlg).forEach((d, n) => d.classList.toggle("on", n === i));
    $("#introBack").disabled = i === 0;
    $("#introNext").textContent = i === slides.length - 1 ? "Get started" : "Next";
  };
  $("#introBack").onclick = () => {
    i = Math.max(0, i - 1);
    show("from-left");
  };
  $("#introNext").onclick = () => {
    if (i < slides.length - 1) {
      i++;
      return show("from-right");
    }
    dlg.close();
  };
  dlg.onclose = () => {
    if (!app.state.meta.introSeen) {
      app.state.meta.introSeen = true;
      app.save();
      app.go("settings", "personalize");
    }
  };
  show();
  dlg.showModal();
}

// Android back button: close any open dialog, then go back to Today, then exit.
NativeApp.addListener("backButton", () => {
  const open = document.querySelector("dialog[open]");
  if (open) return open.close();
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
  if (!app.state.meta.introSeen || params.has("intro")) showIntro();
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
