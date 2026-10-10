// Animation and haptics helpers. Everything here respects the system
// "Reduce motion" setting and does nothing harmful on the web.

import { Capacitor } from "@capacitor/core";
import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";

export const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

// Calls draw(progress 0..1) every frame for `ms` milliseconds (or once at 1).
export function animate(ms, draw) {
  if (reducedMotion() || ms <= 0) return draw(1);
  const start = performance.now();
  const frame = (now) => {
    const t = Math.min(1, (now - start) / ms);
    draw(easeOutCubic(t));
    if (t < 1) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

// Counts an element's number up from 0, keeping any text after it (e.g. " g").
export function countUp(el, to, ms = 900, format = (v) => Math.round(v).toLocaleString()) {
  if (!el) return;
  animate(ms, (p) => (el.firstChild.nodeValue = format(to * p)));
}

// Staggers the entrance of a screen's cards.
export function enterView(root) {
  if (reducedMotion()) return;
  root.classList.remove("view-enter");
  [...root.children].forEach((child, i) => child.style.setProperty("--i", Math.min(i, 8)));
  void root.offsetWidth; // restart the animation
  root.classList.add("view-enter");
}

const native = Capacitor.isNativePlatform();

export const haptic = {
  tap() {
    if (native) Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
  },
  success() {
    if (native) Haptics.notification({ type: NotificationType.Success }).catch(() => {});
  },
};
