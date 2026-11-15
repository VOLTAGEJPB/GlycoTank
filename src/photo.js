// Meal photo -> estimated foods. The photo is shrunk on the phone, then sent to
// the GlycoTank server, which asks Claude (Anthropic) to estimate each food and
// its nutrition. Nothing is stored on the server.

import { Capacitor } from "@capacitor/core";
import { Camera } from "@capacitor/camera";
import { CLOUD } from "./cloud-config.js";
import { idToken } from "./auth.js";
import { ScanError } from "./scan.js";

const MAX_SIDE = 1280; // plenty to recognize food; keeps the upload small
const isCancel = (e) => /cancel/i.test(String(e?.message || e));

export const photoEstimates = () => !!CLOUD.apiUrl;

// Lets the user take (or pick) a photo; resolves to a Blob, or null if they backed out.
async function pickPhoto(fromGallery) {
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

// Scales the photo down and re-encodes it as JPEG; returns base64 without the data: prefix.
async function shrink(blob) {
  let bmp;
  try {
    bmp = await createImageBitmap(blob, { imageOrientation: "from-image" });
  } catch {
    throw new ScanError("Couldn't open that photo. Try another one.");
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const canvas = Object.assign(document.createElement("canvas"), { width: Math.round(bmp.width * scale), height: Math.round(bmp.height * scale) });
  canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close?.();
  return canvas.toDataURL("image/jpeg", 0.82).split(",")[1];
}

// Resolves to { items: [{ name, portion, kcal, carbs, protein, fat, fiber }], note },
// or null if the user didn't pick a photo. `onBusy` is called once a photo is chosen.
export async function estimateFromPhoto(fromGallery, onBusy) {
  const blob = await pickPhoto(fromGallery);
  if (!blob) return null;
  onBusy?.();
  const image = await shrink(blob);
  let res;
  try {
    res = await fetch(`${CLOUD.apiUrl}/estimate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${await idToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ image }),
    });
  } catch {
    throw new ScanError("Couldn't reach GlycoTank. Check your internet connection.");
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 404) throw new ScanError("Photo estimates aren't available yet.");
  if (!res.ok) throw new ScanError(data.error || "Something went wrong estimating this photo. Please try again.");
  return data;
}
