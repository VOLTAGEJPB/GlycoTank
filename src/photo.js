// Meal photo (or restaurant receipt) -> estimated foods. The photo is shrunk on
// the phone, then sent to the GlycoTank server, which asks Claude (Anthropic) to
// estimate each food and its nutrition. Nothing is stored on the server.

import { Capacitor } from "@capacitor/core";
import { Camera } from "@capacitor/camera";
import { CLOUD } from "./cloud-config.js";
import { idToken } from "./auth.js";
import { ScanError } from "./scan.js";
import { localDate } from "./model.js";

// The server allows 3 photo scans (meal photos and receipts together) per
// account per day. The app remembers the count the server last reported, so it
// can show what's left; a new day starts back at 3.
export const DAILY_SCANS = 3;
const QUOTA_KEY = "glycotank.photoScans";
export function scansLeftToday() {
  try {
    const q = JSON.parse(localStorage.getItem(QUOTA_KEY));
    if (q?.day === localDate() && Number.isInteger(q.left)) return Math.max(0, Math.min(DAILY_SCANS, q.left));
  } catch {}
  return DAILY_SCANS;
}
const rememberLeft = (left) => {
  try { localStorage.setItem(QUOTA_KEY, JSON.stringify({ day: localDate(), left })); } catch {}
};

// Plenty to recognize food and keep the upload small; receipts get more pixels
// so their small print stays readable.
const MAX_SIDE = { meal: 1280, receipt: 2000 };
const isCancel = (e) => /cancel/i.test(String(e?.message || e));

export const photoEstimates = () => !!CLOUD.apiUrl;

// " · 2 photo scans left today", from the server's count after an estimate.
export const scansLeft = (res) =>
  Number.isInteger(res?.remaining) ? ` · ${res.remaining} photo ${res.remaining === 1 ? "scan" : "scans"} left today` : "";

// Lets the user take (or pick) a photo; resolves to a Blob, or null if they backed out.
export async function pickPhoto(fromGallery) {
  if (Capacitor.isNativePlatform()) {
    let uri;
    try {
      uri = fromGallery
        ? (await Camera.chooseFromGallery({ limit: 1 })).results[0]?.uri
        : (await Camera.takePhoto({ quality: 85, correctOrientation: true })).uri;
    } catch (e) {
      if (isCancel(e)) return null;
      throw e;
    }
    if (!uri) return null;
    const path = uri.startsWith("/") ? `file://${uri}` : uri;
    return (await fetch(Capacitor.convertFileSrc(path))).blob();
  }
  // Web: a file input (opens the camera on phones).
  return new Promise((resolve) => {
    const input = Object.assign(document.createElement("input"), { type: "file", accept: "image/*" });
    if (!fromGallery) input.capture = "environment";
    input.addEventListener("change", () => resolve(input.files[0] || null));
    input.addEventListener("cancel", () => resolve(null));
    input.click();
  });
}

// Decodes a photo as an <img>. Unlike createImageBitmap, WebKit always applies
// the photo's rotation (EXIF orientation) here, so its size and pixels match
// what the user sees on screen. `width`/`height` are the rotated size.
export function openImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      // Off-screen images report their natural (rotated) size.
      Object.defineProperty(img, "width", { value: img.naturalWidth });
      Object.defineProperty(img, "height", { value: img.naturalHeight });
      img.close = () => URL.revokeObjectURL(url);
      img.url = url;
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Couldn't open that photo."));
    };
    img.src = url;
  });
}

// Scales the photo down and re-encodes it as JPEG; returns base64 without the data: prefix.
async function shrink(blob, maxSide) {
  let bmp;
  try {
    bmp = await openImage(blob);
  } catch {
    throw new ScanError("Couldn't open that photo. Try another one.");
  }
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const canvas = Object.assign(document.createElement("canvas"), { width: Math.round(bmp.width * scale), height: Math.round(bmp.height * scale) });
  canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close?.();
  return canvas.toDataURL("image/jpeg", 0.82).split(",")[1];
}

// Resolves to { items: [{ name, portion, kcal, carbs, protein, fat, fiber }], note },
// or null if the user didn't pick a photo. `kind` is "meal" or "receipt";
// `onBusy` is called once a photo is chosen.
export async function estimateFromPhoto(fromGallery, onBusy, kind = "meal") {
  if (scansLeftToday() === 0) throw new ScanError(`You've used today's ${DAILY_SCANS} free photo scans. They reset at midnight.`);
  const blob = await pickPhoto(fromGallery);
  if (!blob) return null;
  onBusy?.();
  const image = await shrink(blob, MAX_SIDE[kind]);
  let res;
  try {
    res = await fetch(`${CLOUD.apiUrl}/estimate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${await idToken()}`, "Content-Type": "application/json" },
      // The daily photo limit resets at the user's midnight.
      body: JSON.stringify({ image, kind, tzOffset: -new Date().getTimezoneOffset() }),
    });
  } catch {
    throw new ScanError("Couldn't reach GlycoTank. Check your internet connection.");
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 429) rememberLeft(0);
  if (res.ok && Number.isInteger(data.remaining)) rememberLeft(data.remaining);
  if (res.status === 404) throw new ScanError("Photo estimates aren't available yet.");
  if (!res.ok) throw new ScanError(data.error || "Something went wrong reading this photo. Please try again.");
  return data;
}
