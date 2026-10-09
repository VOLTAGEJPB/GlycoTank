import "./styles.css";
import { loadState, saveState, flush } from "./store.js";
import { $, $$ } from "./ui.js";
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
    $$("#tabs button").forEach((b) => b.setAttribute("aria-current", b.dataset.view === view ? "page" : "false"));
    $("#title").textContent = VIEWS[view].title;
    const root = $("#view");
    VIEWS[view].render(root, app);
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
    app.editing = null;
    app.go(b.dataset.view);
  }),
);

// ---------- Intro ----------
function showIntro() {
  const dlg = $("#intro");
  const slides = $$(".slide", dlg);
  let i = 0;
  const show = () => {
    slides.forEach((s, n) => (s.hidden = n !== i));
    $$(".dots span", dlg).forEach((d, n) => d.classList.toggle("on", n === i));
    $("#introBack").disabled = i === 0;
    $("#introNext").textContent = i === slides.length - 1 ? "Get started" : "Next";
  };
  $("#introBack").onclick = () => {
    i = Math.max(0, i - 1);
    show();
  };
  $("#introNext").onclick = () => {
    if (i < slides.length - 1) {
      i++;
      return show();
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

// ---------- Start ----------
(async () => {
  app.state = location.search.includes("demo") ? (await import("./demo.js")).demoState() : await loadState();
  if (location.search.includes("demo")) app.save = () => {}; // never overwrite real data with the sample
  const params = new URLSearchParams(location.search);
  app.go(params.has("demo") && VIEWS[params.get("view")] ? params.get("view") : "today", params.get("section") || undefined);
  if (!app.state.meta.introSeen || params.has("intro")) showIntro();
  // Re-render when the app comes back to the foreground on a new day.
  let lastDay = new Date().toDateString();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && new Date().toDateString() !== lastDay) {
      lastDay = new Date().toDateString();
      if (!app.editing) app.go(app.current);
    }
  });
})();
