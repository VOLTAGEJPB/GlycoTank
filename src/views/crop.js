// Circle crop for profile photos: drag to move, pinch or slide to zoom.
// Resolves to a 256 px square JPEG (base64), or null if cancelled.
import { esc } from "../ui.js";
import { openImage } from "../photo.js";

export async function cropCircle(blob) {
  // The same decoded image is shown and cropped, so the crop matches the preview.
  // Copy it into a moderate-size canvas first: iOS mis-crops full-size camera
  // photos when drawing part of them, so we only ever draw whole images.
  const img0 = await openImage(blob);
  const k0 = Math.min(1, 1600 / Math.max(img0.width, img0.height));
  const bmp = Object.assign(document.createElement("canvas"), { width: Math.round(img0.width * k0), height: Math.round(img0.height * k0) });
  bmp.getContext("2d").drawImage(img0, 0, 0, bmp.width, bmp.height);
  img0.close();
  const url = URL.createObjectURL(await new Promise((r) => bmp.toBlob(r, "image/jpeg", 0.9)));
  bmp.close = () => URL.revokeObjectURL(url);
  return new Promise((resolve) => {
    const dlg = document.createElement("dialog");
    dlg.className = "crop-dlg";
    dlg.innerHTML = `
      <h2>Move and scale</h2>
      <div class="crop-stage" id="cropStage"><img src="${esc(url)}" alt="" draggable="false"><div class="crop-mask"></div></div>
      <label class="crop-zoom"><span aria-hidden="true">−</span><input type="range" id="cropZoom" min="1" max="4" step="0.01" value="1" aria-label="Zoom"><span aria-hidden="true">+</span></label>
      <div class="actions"><button class="btn ghost" data-a="cancel">Cancel</button><button class="btn primary" data-a="ok">Use photo</button></div>`;
    document.body.appendChild(dlg);
    dlg.showModal();
    const stage = dlg.querySelector("#cropStage");
    const img = stage.querySelector("img");
    const zoomEl = dlg.querySelector("#cropZoom");
    const S = stage.clientWidth;
    const base = S / Math.min(bmp.width, bmp.height); // smallest scale that covers the circle
    let z = 1, x = 0, y = 0;

    const clamp = () => {
      const w = bmp.width * base * z, h = bmp.height * base * z;
      x = Math.min(0, Math.max(S - w, x));
      y = Math.min(0, Math.max(S - h, y));
    };
    const paint = () => {
      clamp();
      img.style.width = `${bmp.width * base * z}px`;
      img.style.height = `${bmp.height * base * z}px`;
      img.style.transform = `translate(${x}px, ${y}px)`;
    };
    // Zoom around a point in the stage (the center for the slider).
    const zoomTo = (nz, cx = S / 2, cy = S / 2) => {
      nz = Math.min(4, Math.max(1, nz));
      x = cx - ((cx - x) * nz) / z;
      y = cy - ((cy - y) * nz) / z;
      z = nz;
      zoomEl.value = z;
      paint();
    };
    // Start centered.
    x = (S - bmp.width * base) / 2;
    y = (S - bmp.height * base) / 2;
    paint();

    const pts = new Map();
    let last = null; // { x, y, dist }
    const state = () => {
      const p = [...pts.values()];
      if (p.length === 1) return { x: p[0].x, y: p[0].y, dist: 0 };
      const [a, b] = p;
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, dist: Math.hypot(a.x - b.x, a.y - b.y) };
    };
    stage.addEventListener("pointerdown", (e) => {
      stage.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      last = state();
    });
    stage.addEventListener("pointermove", (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const now = state();
      x += now.x - last.x;
      y += now.y - last.y;
      if (now.dist && last.dist) {
        const r = stage.getBoundingClientRect();
        zoomTo(z * (now.dist / last.dist), now.x - r.left, now.y - r.top);
      } else paint();
      last = now;
    });
    const up = (e) => {
      pts.delete(e.pointerId);
      last = pts.size ? state() : null;
    };
    stage.addEventListener("pointerup", up);
    stage.addEventListener("pointercancel", up);
    stage.addEventListener("wheel", (e) => {
      e.preventDefault();
      const r = stage.getBoundingClientRect();
      zoomTo(z * (e.deltaY < 0 ? 1.08 : 1 / 1.08), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    zoomEl.addEventListener("input", () => zoomTo(+zoomEl.value));

    const done = (value) => {
      dlg.close();
      dlg.remove();
      bmp.close();
      resolve(value);
    };
    dlg.addEventListener("cancel", (e) => (e.preventDefault(), done(null)));
    dlg.addEventListener("click", (e) => {
      const a = e.target.closest("[data-a]")?.dataset.a;
      if (a === "cancel") done(null);
      if (a === "ok") {
        // Draw the whole image exactly as positioned in the stage, scaled to 256 px.
        const k = 256 / S;
        const canvas = Object.assign(document.createElement("canvas"), { width: 256, height: 256 });
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, 256, 256);
        ctx.drawImage(bmp, x * k, y * k, bmp.width * base * z * k, bmp.height * base * z * k);
        done(canvas.toDataURL("image/jpeg", 0.85).split(",")[1]);
      }
    });
  });
}
