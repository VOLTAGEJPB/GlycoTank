// "Share with friends" switch shown above Save on the Log forms.
import { socialData, post as sharePost } from "../social.js";
import { toast } from "../ui.js";

const SHARE_KEY = "glycotank.shareDefault";

// Shown for new entries once a Friends profile exists. Remembers the last choice.
export function shareToggle(id, show) {
  if (!show || !socialData()?.me) return "";
  let on = false;
  try {
    on = localStorage.getItem(SHARE_KEY) === "1";
  } catch {}
  return `<label class="share-toggle"><input type="checkbox" id="${id}" ${on ? "checked" : ""}><span>Share with friends</span><input id="${id}Text" maxlength="500" placeholder="Add a caption (optional)" ${on ? "" : "hidden"}></label>`;
}

document.addEventListener("change", (e) => {
  if (!e.target.matches?.(".share-toggle input[type=checkbox]")) return;
  const caption = document.getElementById(e.target.id + "Text");
  if (caption) caption.hidden = !e.target.checked;
  try {
    localStorage.setItem(SHARE_KEY, e.target.checked ? "1" : "0");
  } catch {}
});

// Posts the entry to the Friends feed in the background if the switch is on.
export function shareIf(id, build) {
  const box = document.getElementById(id);
  if (!box?.checked) return;
  const text = document.getElementById(id + "Text")?.value.trim() || "";
  sharePost({ ...build(), text })
    .then(() => toast("Shared with friends"))
    .catch((e) => toast(e.message || "Couldn't share with friends"));
}
