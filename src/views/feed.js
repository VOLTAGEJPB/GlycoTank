// Friends > Feed: updates from you and your friends, with reactions and comments.
import { $, $$, esc, toast, success, confirmDialog } from "../ui.js";
import { loadFeed, post, postAction, postPhoto, postJpeg, photoFor, socialData, SocialError } from "../social.js";
import { pickPhoto } from "../photo.js";

const REACTIONS = ["🔥", "💪", "👏", "😋"];
const SLOT = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner", snack: "Snack" };
let feed = null; // { posts, next }
let draftText = "";
let draftPhoto = null; // base64
const openComments = new Set();

const fmt = (n) => Math.round(+n || 0).toLocaleString();
function ago(t) {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
const avatar = (p, size = 40) =>
  `<span class="avatar-s" data-uid="${esc(p?.uid || "")}" data-ver="${p?.photoVer || 0}" style="--size:${size}px;background:${esc(p?.color || "#57cc99")}">${esc(p?.emoji || "💪")}</span>`;

async function fillPhotos(root) {
  $$(".avatar-s[data-ver]", root).forEach(async (el) => {
    const ver = +el.dataset.ver;
    if (!ver || el.classList.contains("photo")) return;
    const url = await photoFor(el.dataset.uid, ver);
    if (url && el.isConnected) {
      el.style.backgroundImage = `url("${url}")`;
      el.classList.add("photo");
      el.textContent = "";
    }
  });
  $$("[data-post-photo]", root).forEach(async (el) => {
    if (el.dataset.loaded) return;
    el.dataset.loaded = "1";
    const [author, id] = el.dataset.postPhoto.split("/");
    const url = await postPhoto(author, id);
    if (url && el.isConnected) el.innerHTML = `<img src="${url}" alt="">`;
    else if (el.isConnected) el.remove();
  });
}

function itemHtml(p) {
  const it = p.item;
  if (!it) return "";
  if (p.kind === "meal") {
    return `<div class="post-item meal"><div class="post-item-head"><strong>${esc(it.name)}</strong>${it.slot ? `<span>${SLOT[it.slot]}</span>` : ""}</div>
      <div class="post-macros"><span><b>${fmt(it.kcal)}</b> kcal</span><span class="c"><b>${fmt(it.carbs)}</b>g carbs</span><span class="p"><b>${fmt(it.protein)}</b>g protein</span><span class="f"><b>${fmt(it.fat)}</b>g fat</span></div></div>`;
  }
  const u = it.units || "lb";
  const lines = it.exercises?.length
    ? it.exercises.map((e) => `<li><span>${esc(e.name)}</span><b>${e.sets ? `${e.sets}×${e.reps || "?"}` : ""}${e.weight ? ` @ ${fmt(e.weight)} ${u}` : ""}</b></li>`).join("")
    : it.type === "strength"
      ? `<li><span>${esc(it.name)}</span><b>${it.sets ? `${it.sets}×${it.reps || "?"}` : ""}${it.weight ? ` @ ${fmt(it.weight)} ${u}` : ""}</b></li>`
      : `<li><span>${esc(it.name)}</span><b>${it.mins ? `${fmt(it.mins)} min` : ""}</b></li>`;
  return `<div class="post-item workout"><div class="post-item-head"><strong>🏋️ ${esc(it.exercises?.length ? it.name : "Workout")}</strong></div><ul>${lines}</ul></div>`;
}

function postHtml(p) {
  const showAll = openComments.has(p.id);
  const comments = showAll ? p.comments : p.comments.slice(-2);
  const kindLabel = p.kind === "meal" ? "shared a meal" : p.kind === "workout" ? "shared a workout" : "";
  return `<article class="card post" data-post="${esc(p.id)}" data-author="${esc(p.author?.uid)}">
    <header class="post-head">${avatar(p.author)}
      <div><strong>${esc(p.author?.name || "")}</strong><span>${kindLabel ? `${kindLabel} · ` : ""}${ago(p.at)}</span></div>
      <button class="icon-btn post-more" data-more aria-label="More">⋯</button></header>
    ${p.text ? `<p class="post-text">${esc(p.text)}</p>` : ""}
    ${itemHtml(p)}
    ${p.photo ? `<div class="post-photo" data-post-photo="${esc(p.author.uid)}/${esc(p.id)}"></div>` : ""}
    <div class="post-react">${REACTIONS.map((e) => `<button data-react="${e}" aria-pressed="${p.mine === e}">${e}${p.reactions[e] ? `<b>${p.reactions[e]}</b>` : ""}</button>`).join("")}
      <button class="post-cbtn" data-focus-comment>💬${p.comments.length ? `<b>${p.comments.length}</b>` : ""}</button></div>
    ${p.comments.length > 2 && !showAll ? `<button class="link-btn post-all" data-all>View all ${p.comments.length} comments</button>` : ""}
    ${comments.length ? `<ul class="post-comments">${comments.map((c) => `<li data-cid="${esc(c.id)}">${avatar(c.by, 26)}<div><strong>${esc(c.by?.name || "")}</strong> ${esc(c.text)}<small>${ago(c.at)}${c.canDelete ? ` · <button class="link-btn" data-cdel>Delete</button>` : ` · <button class="link-btn" data-creport>Report</button>`}</small></div></li>`).join("")}</ul>` : ""}
    <form class="post-cform"><input maxlength="300" placeholder="Add a comment…" enterkeyhint="send"><button class="btn small" type="submit">Send</button></form>
  </article>`;
}

function composerHtml() {
  const me = socialData()?.me;
  return `<section class="card composer">
    <div class="composer-row">${avatar(me, 40)}<textarea id="postText" rows="2" maxlength="500" placeholder="Share an update with your friends…">${esc(draftText)}</textarea></div>
    ${draftPhoto ? `<div class="composer-photo"><img src="data:image/jpeg;base64,${draftPhoto}" alt=""><button class="icon-btn" id="postPhotoOff" aria-label="Remove photo">✕</button></div>` : ""}
    <div class="composer-actions"><button class="btn small ghost" id="postPhotoBtn">📷 Photo</button><span class="hint">Tip: share meals and workouts when you save them.</span><button class="btn small primary" id="postSend">Post</button></div>
  </section>`;
}

export async function renderFeed(host, app) {
  if (!feed) host.innerHTML = composerHtml() + `<p class="hint center pad">Loading posts…</p>`;
  try {
    feed = await loadFeed();
  } catch (e) {
    if (!feed) {
      host.innerHTML = composerHtml() + `<p class="hint center pad">${esc(e.message)}</p>`;
      wireComposer(host, app);
      return;
    }
  }
  if (host.isConnected) draw(host, app);
}

function draw(host, app) {
  host.innerHTML = composerHtml() +
    (feed.posts.length
      ? feed.posts.map(postHtml).join("") + (feed.next ? `<button class="btn wide" id="feedMore">Load more</button>` : "")
      : `<section class="card"><p class="hint">No posts yet. Share a meal or workout, or post an update, and your friends will see it here.</p></section>`);
  fillPhotos(host);
  wireComposer(host, app);
  wirePosts(host, app);
}

function wireComposer(host, app) {
  $("#postText", host)?.addEventListener("input", (e) => (draftText = e.target.value));
  $("#postPhotoBtn", host)?.addEventListener("click", async () => {
    try {
      const blob = await pickPhoto(true);
      if (!blob) return;
      draftPhoto = await postJpeg(blob);
      draw(host, app);
    } catch {
      toast("Couldn't open that photo.");
    }
  });
  $("#postPhotoOff", host)?.addEventListener("click", () => {
    draftPhoto = null;
    draw(host, app);
  });
  $("#postSend", host)?.addEventListener("click", async (e) => {
    const text = draftText.trim();
    if (!text && !draftPhoto) return toast("Write something or add a photo");
    const btn = e.target;
    btn.disabled = true;
    btn.textContent = draftPhoto ? "Checking photo…" : "Posting…";
    try {
      await post({ kind: "text", text, photo: draftPhoto || undefined });
      draftText = "";
      draftPhoto = null;
      success("Posted");
      await renderFeed(host, app);
    } catch (err) {
      toast(err instanceof SocialError ? err.message : "Couldn't post. Please try again.");
      if (btn.isConnected) {
        btn.disabled = false;
        btn.textContent = "Post";
      }
    }
  });
}

function wirePosts(host, app) {
  const find = (el) => {
    const card = el.closest("[data-post]");
    return { card, p: feed.posts.find((x) => x.id === card.dataset.post) };
  };
  const refresh = async () => {
    try {
      feed = await loadFeed();
      if (host.isConnected) draw(host, app);
    } catch {}
  };
  $$("[data-react]", host).forEach((b) =>
    b.addEventListener("click", async () => {
      const { p } = find(b);
      const emoji = p.mine === b.dataset.react ? null : b.dataset.react;
      // Update right away; the server catches up.
      if (p.mine) p.reactions[p.mine] = Math.max(0, (p.reactions[p.mine] || 1) - 1) || undefined;
      if (emoji) p.reactions[emoji] = (p.reactions[emoji] || 0) + 1;
      p.mine = emoji;
      draw(host, app);
      postAction("react", { author: p.author.uid, id: p.id, emoji }).catch((e) => toast(e.message));
    }),
  );
  $$("[data-focus-comment]", host).forEach((b) => b.addEventListener("click", () => find(b).card.querySelector(".post-cform input").focus()));
  $$("[data-all]", host).forEach((b) =>
    b.addEventListener("click", () => {
      openComments.add(find(b).p.id);
      draw(host, app);
    }),
  );
  $$(".post-cform", host).forEach((f) =>
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const { p } = find(f);
      const input = f.querySelector("input");
      const text = input.value.trim();
      if (!text) return;
      input.disabled = true;
      try {
        await postAction("comment", { author: p.author.uid, id: p.id, text });
        openComments.add(p.id);
        await refresh();
      } catch (err) {
        toast(err.message);
        input.disabled = false;
      }
    }),
  );
  $$("[data-cdel]", host).forEach((b) =>
    b.addEventListener("click", async () => {
      const { p } = find(b);
      if (!(await confirmDialog("Delete this comment?"))) return;
      await postAction("deleteComment", { author: p.author.uid, id: p.id, cid: b.closest("[data-cid]").dataset.cid }).catch((e) => toast(e.message));
      refresh();
    }),
  );
  $$("[data-creport]", host).forEach((b) =>
    b.addEventListener("click", async () => {
      const { p } = find(b);
      const reason = await pickReason();
      if (!reason) return;
      await postAction("reportPost", { author: p.author.uid, id: p.id, cid: b.closest("[data-cid]").dataset.cid, reason }).catch((e) => toast(e.message));
      toast("Thanks. We review reports within 24 hours.");
    }),
  );
  $$("[data-more]", host).forEach((b) =>
    b.addEventListener("click", async () => {
      const { p } = find(b);
      if (p.canDelete) {
        if (!(await confirmDialog("Delete this post?"))) return;
        await postAction("deletePost", { id: p.id }).catch((e) => toast(e.message));
        toast("Post deleted");
        return refresh();
      }
      const reason = await pickReason();
      if (!reason) return;
      await postAction("reportPost", { author: p.author.uid, id: p.id, reason }).catch((e) => toast(e.message));
      toast("Thanks. We review reports within 24 hours. You can also block them from the Friends list.");
    }),
  );
  $("#feedMore", host)?.addEventListener("click", async (e) => {
    e.target.disabled = true;
    try {
      const more = await loadFeed(feed.next);
      feed = { posts: [...feed.posts, ...more.posts], next: more.next };
      draw(host, app);
    } catch (err) {
      toast(err.message);
      e.target.disabled = false;
    }
  });
}

function pickReason() {
  return new Promise((resolve) => {
    const dlg = document.createElement("dialog");
    dlg.className = "sheet fr-sheet";
    const reasons = ["Offensive or inappropriate", "Harassment or bullying", "Spam", "Something else"];
    dlg.innerHTML = `<h2>Report this?</h2><div class="fr-sheet-actions">${reasons.map((r) => `<button class="btn" data-r="${esc(r)}">${esc(r)}</button>`).join("")}<button class="btn ghost" data-r="">Cancel</button></div>`;
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
