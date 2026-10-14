// Scan-to-fill for meals: barcode lookup (Open Food Facts) and on-device
// reading of Nutrition Facts labels (ML Kit text recognition).

import { Capacitor } from "@capacitor/core";
import { BarcodeScanner, BarcodeFormat, GoogleBarcodeScannerModuleInstallState as InstallState } from "@capacitor-mlkit/barcode-scanning";
import { TextRecognition } from "@capacitor-mlkit/text-recognition";
import { Camera } from "@capacitor/camera";
import { fromOpenFoodFacts, parseNutritionLabel } from "./model.js";

// Demo screenshots can add &native to show the phone's scan buttons on the web.
const demoNative = (() => {
  const q = new URLSearchParams(globalThis.location?.search);
  return q.has("demo") && q.has("native");
})();
export const native = Capacitor.isNativePlatform() || demoNative;

export class ScanError extends Error {
  constructor(message, { unavailable = false } = {}) {
    super(message);
    this.unavailable = unavailable; // the scanner can't run on this device; offer typing the barcode
  }
}

const isCancel = (e) => /cancel/i.test(String(e?.message || e));

// On Android, Google's scanner screen is a small Play Services module that may
// need a one-time download. Waits for it (up to a minute) so the scan can start.
async function ensureAndroidScanner(onWaiting) {
  const { available } = await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable();
  if (available) return;
  onWaiting?.();
  await new Promise((resolve, reject) => {
    let handle;
    const done = (fn, arg) => {
      clearTimeout(timer);
      handle?.remove();
      fn(arg);
    };
    const timer = setTimeout(() => done(reject, new ScanError("The barcode scanner is still downloading. Try again in a minute.")), 60000);
    BarcodeScanner.addListener("googleBarcodeScannerModuleInstallProgress", ({ state }) => {
      if (state === InstallState.COMPLETED) done(resolve);
      if (state === InstallState.FAILED || state === InstallState.CANCELED) {
        done(reject, new ScanError("The barcode scanner isn't available on this device right now. You can type the barcode number instead.", { unavailable: true }));
      }
    }).then((h) => (handle = h));
    BarcodeScanner.installGoogleBarcodeScannerModule().catch((e) => done(reject, e));
  });
}

// Opens the system barcode scanner and returns the barcode digits, or null if
// the user closed it. On Android this uses Google's scanner, which needs no
// camera permission but may download a small module the first time.
export async function scanBarcode(onWaiting) {
  if (Capacitor.getPlatform() === "android") await ensureAndroidScanner(onWaiting);
  try {
    const { barcodes } = await BarcodeScanner.scan({
      formats: [BarcodeFormat.UpcA, BarcodeFormat.UpcE, BarcodeFormat.Ean13, BarcodeFormat.Ean8],
      autoZoom: true,
    });
    return barcodes[0]?.rawValue || barcodes[0]?.displayValue || null;
  } catch (e) {
    if (isCancel(e)) return null;
    throw e;
  }
}

// Looks a barcode up in Open Food Facts, a free, open food database.
// Only the barcode number is sent.
export async function lookupBarcode(code) {
  const digits = String(code).replace(/\D/g, "");
  if (digits.length < 8) throw new ScanError("That doesn't look like a product barcode.");
  const fields = "product_name,brands,serving_size,nutriments";
  let res;
  try {
    res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${digits}.json?fields=${fields}`);
  } catch {
    throw new ScanError("Couldn't reach the food database. Check your internet connection.");
  }
  if (res.status === 404) throw new ScanError("This product isn't in the database yet. Try scanning its nutrition label instead.");
  if (!res.ok) throw new ScanError("The food database isn't responding right now. Try again in a moment.");
  const data = await res.json();
  const item = data.status === 1 ? fromOpenFoodFacts(data.product) : null;
  if (!item || (item.kcal == null && item.carbs == null && item.protein == null)) {
    throw new ScanError("This product has no nutrition info in the database. Try scanning its nutrition label instead.");
  }
  return { ...item, barcode: digits, source: "Open Food Facts" };
}

// Takes (or picks) a photo of a Nutrition Facts panel and reads it on the device.
export async function scanLabel(fromGallery = false) {
  let uri;
  try {
    if (fromGallery) {
      const { results } = await Camera.chooseFromGallery({ limit: 1 });
      uri = results[0]?.uri;
    } else {
      uri = (await Camera.takePhoto({ quality: 90, correctOrientation: true })).uri;
    }
  } catch (e) {
    if (isCancel(e)) return null;
    throw e;
  }
  if (!uri) return null;
  // The camera plugin returns a plain file path on Android; ML Kit needs a URI.
  const path = uri.startsWith("/") ? `file://${uri}` : uri;
  const { text } = await TextRecognition.processImage({ path });
  const label = parseNutritionLabel(text || "");
  const found = ["kcal", "carbs", "protein", "fat", "fiber"].filter((k) => label[k] != null).length;
  if (found < 2) throw new ScanError("Couldn't read the label. Try again with the Nutrition Facts panel flat, well lit and filling the frame.");
  return { ...label, name: "", source: "nutrition label" };
}
