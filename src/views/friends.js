// Friends screen: your profile, add friends, requests, and each friend's
// streak, shared streak and (if they share it) today's summary.
import { $, $$, esc, toast, success, confirmDialog } from "../ui.js";
import { loadSocial, socialData, socialAvailable, act, photoFor, enablePush, sendActivityNow, SocialError } from "../social.js";
import { pickPhoto } from "../photo.js";
import { streak, localDate } from "../model.js";
import { Capacitor } from "@capacitor/core";
import { renderFeed } from "./feed.js";
import { cropCircle } from "./crop.js";

const EMOJIS = ["💪", "🔥", "🏃", "🚴", "🏋️", "⚡", "🥑", "🍎", "🌱", "🏊", "🧘", "⭐", "🦁", "🐺", "🦅", "🐻", "🦊", "🐢", "🚀", "🎯"];
const COLORS = ["#57cc99", "#5cb8ff", "#ffb547", "#ff8f7e", "#b99cff", "#ff6b9a", "#4fd1c5", "#a3e635"];
let editing = false;
let draft = null;
let prefill = "";
let pane = "feed"; // "feed" | "friends"
let topRoot = null;

// Opened from an invite link (glycotank://add/<username>).
export const prefillFriend = (handle) => ((prefill = handle), (pane = "friends"));
export const showFriendsPane = (p) => (pane = p);

const fmt = (n) => Math.round(n).toLocaleString();
const avatar = (p, size = 48) =>
  `<span class="avatar-s" data-uid="${esc(p.uid || "")}" data-ver="${p.photoVer || 0}" style="--size:${size}px;background-color:${esc(p.color || COLORS[0])}">${esc(p.emoji || EMOJIS[0])}</span>`;

// Swaps emoji avatars for photos once they've loaded.
function fillPhotos(root) {
  $$(".avatar-s[data-ver]", root).forEach(async (el) => {
    const ver = +el.dataset.ver;
    if (!ver) return;
    const url = await photoFor(el.dataset.uid, ver);
    if (url && el.isConnected) {
      el.style.backgroundImage = `url("${url}")`;
      el.classList.add("photo");
      el.textContent = "";
    }
  });
}

export async function renderFriends(root, app) {
  if (!socialAvailable()) {
    root.innerHTML = `<section class="card"><h2>Friends</h2><p class="hint">Sign in to add friends and share streaks.</p></section>`;
    return;
  }
  if (!socialData()) root.innerHTML = `<p class="hint center pad">Loading…</p>`;
  try {
    await loadSocial(!socialData());
  } catch (e) {
    if (!socialData()) {
      root.innerHTML = `<section class="card"><h2>Friends</h2><p class="hint">${esc(e.message)}</p><button class="btn" id="frRetry">Try again</button></section>`;
      $("#frRetry").onclick = () => renderFriends(root, app);
      return;
    }
  }
  if (!root.isConnected) return;
  topRoot = root;
  shell(root, app);
  // Refresh quietly in the background so streaks are current.
  if (pane === "friends") loadSocial(true).then(() => root.isConnected && !editing && pane === "friends" && shell(root, app)).catch(() => {});
}

// Feed | Friends switch, or the profile editor when there's no profile yet.
function shell(root, app) {
  if (!app.state.settings.communityAgreed) return drawGuidelines(root, app);
  const d = socialData();
  if (!d?.me || editing) return drawEditor(root, app, d?.me);
  const n = d.incoming.length;
  root.innerHTML = `<div class="segmented fr-seg" style="--pos:${pane === "feed" ? 0 : 1}" role="tablist">
      <button role="tab" data-pane="feed" aria-selected="${pane === "feed"}">Feed</button>
      <button role="tab" data-pane="friends" aria-selected="${pane === "friends"}">Friends${n ? ` <span class="seg-badge">${n}</span>` : ""}</button>
    </div><div id="frPane"></div>`;
  $$("[data-pane]", root).forEach((b) =>
    b.addEventListener("click", () => {
      if (pane === b.dataset.pane) return;
      pane = b.dataset.pane;
      shell(root, app);
    }),
  );
  const host = $("#frPane", root);
  if (pane === "feed") renderFeed(host, app);
  else draw(host, app);
}

// One-time agreement before anyone can see or post social content (App Store rule 1.2).
function drawGuidelines(root, app) {
  root.innerHTML = `<section class="card fr-rules">
      <h2>Community guidelines</h2>
      <p>Friends and Feed are for cheering each other on. To use them, you agree to these rules:</p>
      <ul>
        <li>No hate, harassment, bullying or threats.</li>
        <li>No nudity, sexual content or graphic violence.</li>
        <li>No spam, scams or pretending to be someone else.</li>
        <li>Only post photos you have the right to share.</li>
      </ul>
      <p>There is <strong>no tolerance</strong> for objectionable content or abusive users. Text and photos are checked automatically. You can report or block anyone from their profile or a post. We review reports within 24 hours, remove content that breaks these rules and remove the accounts that posted it.</p>
      <p class="hint">These rules are part of the <a href="https://glycotank.com/terms/#community" target="_blank" rel="noopener">Terms of Use</a>.</p>
      <button class="btn primary wide" id="frAgree">I agree</button>
    </section>`;
  $("#frAgree", root).addEventListener("click", () => {
    app.state.settings = { ...app.state.settings, communityAgreed: new Date().toISOString() };
    app.save();
    shell(root, app);
  });
}

function draw(root, app) {
  const d = socialData();
  if (!d?.me || editing) return shell(topRoot, app);
  const me = d.me;
  const myStreak = streak(app.state, localDate());
  root.innerHTML = `
    <section class="card fr-me">
      <div class="fr-me-row">
        ${avatar(me, 64)}
        <div class="fr-me-text"><strong>${esc(me.name)}</strong><span>@${esc(me.handle)}</span></div>
        <div class="fr-flame"><b>${myStreak}</b><span>🔥 day streak</span></div>
      </div>
      <div class="actions"><button class="btn" id="frEdit">Edit profile</button><button class="btn primary" id="frInvite">Invite friends</button></div>
    </section>

    <section class="card">
      <h2>Add a friend</h2>
      <form class="fr-add" id="frAddForm"><span class="at">@</span><input id="frHandle" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="username" value="${esc(prefill)}"><button class="btn primary" type="submit">Add</button></form>
    </section>

    ${d.incoming.length ? `<section class="card"><h2>Friend requests</h2><ul class="fr-list">${d.incoming.map((p) => `
      <li class="fr-row">${avatar(p)}<div class="fr-text"><strong>${esc(p.name)}</strong><span>@${esc(p.handle)}</span></div>
        <div class="fr-btns"><button class="btn small primary" data-accept="${esc(p.uid)}">Accept</button><button class="btn small ghost" data-decline="${esc(p.uid)}">Decline</button></div></li>`).join("")}</ul></section>` : ""}

    <section class="card">
      <div class="card-head"><h2>Friends</h2><span class="sub">${d.friends.length}</span></div>
      ${d.friends.length ? `<ul class="fr-list">${d.friends.map((p) => `
        <li class="fr-row" data-friend="${esc(p.uid)}">
          <span class="fr-av ${p.loggedToday ? "done" : ""}">${avatar(p)}</span>
          <div class="fr-text"><strong>${esc(p.name)}</strong>
            <span>🔥 ${p.streak} · 🤝 ${p.shared} together</span>
            ${p.summary ? `<small>${fmt(p.summary.kcal)} kcal · ${fmt(p.summary.protein)} g protein${p.summary.workouts ? ` · ${p.summary.workouts} workout${p.summary.workouts > 1 ? "s" : ""}` : ""}</small>` : ""}
          </div>
          ${p.loggedToday ? `<span class="fr-done">✓ Logged</span>` : `<button class="btn small" data-nudge="${esc(p.uid)}">👋 Nudge</button>`}
        </li>`).join("")}</ul>` : `<p class="hint">Add friends by username, or invite them. You'll see each other's streaks, and a 🤝 shared streak grows every day you both log.</p>`}
    </section>

    ${d.outgoing.length ? `<section class="card"><h2>Sent requests</h2><ul class="fr-list">${d.outgoing.map((p) => `
      <li class="fr-row">${avatar(p, 40)}<div class="fr-text"><strong>${esc(p.name)}</strong><span>@${esc(p.handle)} · pending</span></div>
        <button class="btn small ghost" data-cancel="${esc(p.uid)}">Cancel</button></li>`).join("")}</ul></section>` : ""}`;
  fillPhotos(root);

  const busy = async (btn, fn) => {
    if (btn) btn.disabled = true;
    try {
      await fn();
    } catch (e) {
      toast(e instanceof SocialError ? e.message : "Something went wrong. Please try again.");
    } finally {
      if (btn?.isConnected) btn.disabled = false;
    }
  };
  const redraw = () => root.isConnected && draw(root, app);

  $("#frEdit").onclick = () => {
    editing = true;
    draft = null;
    draw(root, app);
  };
  $("#frInvite").onclick = () => invite(me.handle);
  $("#frAddForm").onsubmit = (e) => {
    e.preventDefault();
    const handle = $("#frHandle").value.trim();
    if (!handle) return;
    busy(e.submitter, async () => {
      await act("request", { handle });
      prefill = "";
      success("Friend request sent");
      redraw();
    });
  };
  $$("[data-accept]", root).forEach((b) => (b.onclick = () => busy(b, async () => (await act("respond", { uid: b.dataset.accept, accept: true }), success("You're now friends"), redraw()))));
  $$("[data-decline]", root).forEach((b) => (b.onclick = () => busy(b, async () => (await act("respond", { uid: b.dataset.decline, accept: false }), redraw()))));
  $$("[data-cancel]", root).forEach((b) => (b.onclick = () => busy(b, async () => (await act("remove", { uid: b.dataset.cancel }), redraw()))));
  $$("[data-nudge]", root).forEach(
    (b) =>
      (b.onclick = (e) => {
        e.stopPropagation();
        busy(b, async () => {
          await act("nudge", { uid: b.dataset.nudge });
          b.textContent = "Nudged";
          b.disabled = true;
          toast("Nudge sent 👋");
        });
      }),
  );
  $$("[data-friend]", root).forEach((row) =>
    row.addEventListener("click", () => {
      const p = socialData().friends.find((f) => f.uid === row.dataset.friend);
      if (p) friendMenu(p, root, app);
    }),
  );
}

async function invite(handle) {
  const url = `https://glycotank.com/add/?u=${encodeURIComponent(handle)}`;
  const text = `Add me on GlycoTank so we can keep our streaks going! My username is @${handle}`;
  try {
    if (Capacitor.isNativePlatform()) {
      const { Share } = await import("@capacitor/share");
      await Share.share({ title: "Add me on GlycoTank", text, url });
    } else if (navigator.share) await navigator.share({ title: "Add me on GlycoTank", text, url });
    else {
      await navigator.clipboard.writeText(`${text} ${url}`);
      toast("Invite link copied");
    }
  } catch {}
}

// Remove, block or report a friend.
function friendMenu(p, root, app) {
  const dlg = document.createElement("dialog");
  dlg.className = "sheet fr-sheet";
  dlg.innerHTML = `
    <div class="fr-sheet-head">${avatar(p, 56)}<div><strong>${esc(p.name)}</strong><span>@${esc(p.handle)}</span></div></div>
    <p class="hint">🔥 ${p.streak}-day streak · 🤝 ${p.shared} days together${p.loggedToday ? " · logged today" : ""}</p>
    <div class="fr-sheet-actions">
      <button class="btn" data-a="remove">Remove friend</button>
      <button class="btn danger" data-a="block">Block</button>
      <button class="btn danger" data-a="report">Report</button>
      <button class="btn ghost" data-a="close">Close</button>
    </div>`;
  document.body.appendChild(dlg);
  fillPhotos(dlg);
  dlg.showModal();
  const close = () => {
    dlg.close();
    dlg.remove();
  };
  dlg.addEventListener("click", async (e) => {
    const a = e.target.closest("[data-a]")?.dataset.a;
    if (!a) return;
    if (a === "close") return close();
    close();
    try {
      if (a === "remove" && (await confirmDialog(`Remove ${p.name} from your friends?`, "Remove"))) {
        await act("remove", { uid: p.uid });
        toast("Removed");
      } else if (a === "block" && (await confirmDialog(`Block @${p.handle}? They'll be removed and can't find or add you.`, "Block"))) {
        await act("block", { uid: p.uid });
        toast("Blocked");
      } else if (a === "report") {
        const reason = await reportReason();
        if (!reason) return;
        await act("report", { uid: p.uid, reason });
        if (await confirmDialog("Thanks. We review reports within 24 hours. Do you also want to block this person?", "Block")) await act("block", { uid: p.uid });
      }
      if (root.isConnected) draw(root, app);
    } catch (err) {
      toast(err.message || "Something went wrong.");
    }
  });
}

function reportReason() {
  return new Promise((resolve) => {
    const dlg = document.createElement("dialog");
    dlg.className = "sheet fr-sheet";
    const reasons = ["Offensive photo", "Offensive name or username", "Harassment or spam", "Pretending to be someone else", "Something else"];
    dlg.innerHTML = `<h2>Why are you reporting this account?</h2><div class="fr-sheet-actions">${reasons.map((r) => `<button class="btn" data-r="${esc(r)}">${esc(r)}</button>`).join("")}<button class="btn ghost" data-r="">Cancel</button></div>`;
    document.body.appendChild(dlg);
    dlg.showModal();
    dlg.addEventListener("click", (e) => {
      const b = e.target.closest("[data-r]");
      if (!b) return;
      dlg.close();
      dlg.remove();
      resolve(b.dataset.r);
    });
  });
}

// Create or edit your profile.
function drawEditor(root, app, me) {
  draft ??= { name: me?.name || "", handle: me?.handle || "", emoji: me?.emoji || EMOJIS[0], color: me?.color || COLORS[0], share: !!me?.share };
  const isNew = !me;
  root.innerHTML = `
    <section class="card fr-edit">
      <h2>${isNew ? "Set up your profile" : "Edit profile"}</h2>
      ${isNew ? `<p class="hint">Add friends, see each other's streaks, and keep each other on track.</p>` : ""}
      <div class="fr-preview">${avatar({ ...me, ...draft, uid: me?.uid, photoVer: me?.photoVer }, 88)}
        ${me ? `<div class="fr-photo-btns"><button class="btn small" id="frPhoto">${me.photoVer ? "Change photo" : "Add photo"}</button>${me.photoVer ? `<button class="btn small ghost" id="frPhotoOff">Remove photo</button>` : ""}</div>` : `<p class="hint">You can add a photo after this step.</p>`}
      </div>
      <label class="field"><span>Name</span><input id="frName" maxlength="30" value="${esc(draft.name)}" placeholder="Your first name"></label>
      <label class="field"><span>Username</span><div class="fr-add"><span class="at">@</span><input id="frUser" maxlength="20" autocomplete="off" autocapitalize="none" spellcheck="false" value="${esc(draft.handle)}" placeholder="username"></div></label>
      <div class="field"><span>Emoji</span><div class="fr-emojis">${EMOJIS.map((e) => `<button type="button" data-emoji="${e}" aria-pressed="${e === draft.emoji}">${e}</button>`).join("")}</div></div>
      <div class="field"><span>Color</span><div class="fr-colors">${COLORS.map((c) => `<button type="button" data-color="${c}" style="background:${c}" aria-label="Color" aria-pressed="${c === draft.color}"></button>`).join("")}</div></div>
      <label class="fr-toggle"><input type="checkbox" id="frShare" ${draft.share ? "checked" : ""}><span><strong>Share my daily summary</strong><em>Friends see today's calories, protein, carbs and workouts. Your streak is always shared.</em></span></label>
      <p class="ob-fine">Be kind. Names, usernames and photos that are offensive are removed, and accounts can be blocked or reported. Photos are checked automatically before friends can see them.</p>
      <div class="actions">${isNew ? "" : `<button class="btn ghost" id="frCancel">Cancel</button>`}<button class="btn primary" id="frSave">${isNew ? "Create profile" : "Save"}</button></div>
    </section>`;
  fillPhotos(root);
  const sync = () => {
    draft.name = $("#frName").value;
    draft.handle = $("#frUser").value;
    draft.share = $("#frShare").checked;
  };
  $$("[data-emoji]", root).forEach((b) => (b.onclick = () => (sync(), (draft.emoji = b.dataset.emoji), drawEditor(root, app, me))));
  $$("[data-color]", root).forEach((b) => (b.onclick = () => (sync(), (draft.color = b.dataset.color), drawEditor(root, app, me))));
  $("#frCancel")?.addEventListener("click", () => {
    editing = false;
    draft = null;
    shell(root, app);
  });
  $("#frPhoto")?.addEventListener("click", async (e) => {
    sync();
    const btn = e.target;
    try {
      const blob = await pickPhoto(true);
      if (!blob) return;
      const data = await cropCircle(blob);
      if (!data) return;
      btn.disabled = true;
      btn.textContent = "Checking photo…";
      await act("photo", { data });
      success("Photo updated");
      drawEditor(root, app, socialData().me);
    } catch (err) {
      toast(err.message || "Couldn't use that photo.");
      if (btn.isConnected) {
        btn.disabled = false;
        btn.textContent = "Add photo";
      }
    }
  });
  $("#frPhotoOff")?.addEventListener("click", async () => {
    sync();
    try {
      await act("removePhoto");
      drawEditor(root, app, socialData().me);
    } catch (err) {
      toast(err.message);
    }
  });
  $("#frSave").onclick = async (e) => {
    sync();
    if (!draft.name.trim()) return toast("Add your name");
    const btn = e.target;
    btn.disabled = true;
    try {
      await act("setProfile", { ...draft, tz: Intl.DateTimeFormat().resolvedOptions().timeZone });
      editing = false;
      draft = null;
      await sendActivityNow(app);
      await loadSocial(true);
      success(isNew ? "Profile created" : "Saved");
      if (isNew) pane = "friends";
      shell(root, app);
      if (isNew) enablePush(app).catch(() => {});
    } catch (err) {
      toast(err.message || "Couldn't save.");
      if (btn.isConnected) btn.disabled = false;
    }
  };
}
