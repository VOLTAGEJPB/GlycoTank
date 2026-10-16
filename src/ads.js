// Banner ad across the top of the app (Android and iOS only; the web build
// shows no ads). Android uses GlycoTank's real AdMob banner. iOS still uses
// Google's test unit (a "Test Ad" banner that never pays) until the iOS app is
// added in AdMob: then put its app ID in Info.plist and its banner unit below,
// and set ios to false in TESTING. Emulators always get test ads.
import { Capacitor } from "@capacitor/core";
import { AdMob, BannerAdPosition, BannerAdSize, BannerAdPluginEvents } from "@capacitor-community/admob";

const BANNER_ID = {
  android: "ca-app-pub-1749311923941430/7720753433", // "Top banner"
  ios: "ca-app-pub-3940256099942544/2435281174", // Google's test banner
};
const IS_TEST = { android: false, ios: true };

const platform = Capacitor.getPlatform();
const TESTING = IS_TEST[platform] ?? true;
export const adsSupported = Capacitor.isNativePlatform() && !!BANNER_ID[platform];

let started = false;
let showing = false;
let paused = false;

const setHeight = (h) => document.documentElement.style.setProperty("--ad-h", `${Math.round(h)}px`);

// The banner sits just under the status bar; the app's top bar moves down by
// the banner's height (--ad-h) so nothing is hidden behind it.
function safeTop() {
  const probe = document.createElement("div");
  probe.style.cssText = "position:fixed;top:0;height:var(--safe-top);visibility:hidden";
  document.body.appendChild(probe);
  const h = probe.getBoundingClientRect().height;
  probe.remove();
  return Math.round(h);
}

async function show() {
  if (showing || paused) return;
  showing = true;
  try {
    await AdMob.showBanner({
      adId: BANNER_ID[platform],
      adSize: BannerAdSize.ADAPTIVE_BANNER,
      position: BannerAdPosition.TOP_CENTER,
      margin: safeTop(),
      isTesting: TESTING,
    });
  } catch (e) {
    showing = false;
    console.warn("Banner ad failed", e);
  }
}

// Asks for ad consent where the law requires it (EEA, UK, some US states),
// then starts the banner. Safe to call more than once.
export async function startAds() {
  if (!adsSupported || started) return;
  started = true;
  try {
    AdMob.addListener(BannerAdPluginEvents.SizeChanged, (size) => setHeight(showing && !paused ? size.height : 0));
    AdMob.addListener(BannerAdPluginEvents.FailedToLoad, () => setHeight(0));
    // If the consent check itself fails (no privacy message set up in AdMob
    // yet, or no network), still start ads; Google then limits what it serves
    // where consent is required.
    let canRequest = true;
    try {
      const consent = await AdMob.requestConsentInfo();
      canRequest = consent.canRequestAds;
      if (!canRequest && consent.isConsentFormAvailable) canRequest = (await AdMob.showConsentForm()).canRequestAds;
    } catch (e) {
      console.warn("Ad consent check failed", e);
    }
    if (!canRequest) return;
    await AdMob.initialize({ initializeForTesting: TESTING });
    await show();
  } catch (e) {
    console.warn("Ads unavailable", e);
  }
}

// Full-screen flows (intro, sign-in) hide the banner while they're open.
export async function pauseAds() {
  paused = true;
  if (!showing) return;
  showing = false;
  setHeight(0);
  await AdMob.removeBanner().catch(() => {});
}

export async function resumeAds() {
  paused = false;
  if (started) await show();
}
