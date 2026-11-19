// Links the user's Gmail and finds their food order emails. The phone talks to
// Google directly: email contents never reach the GlycoTank server, and the
// sign-in token stays in the iOS Keychain.

import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";
import { SecureStorage, KeychainAccess } from "@aparajita/capacitor-secure-storage";
import { GMAIL_CLIENT_ID } from "./gmail-config.js";
import { gmailQuery, parseOrder } from "./gmail-parse.js";
import { ScanError } from "./scan.js";

const SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://gmail.googleapis.com/gmail/v1/users/me";
const TOKEN_KEY = "gmail-refresh-token";
const SKIPPED_KEY = "gmail-skipped-orders";
const FORM = { "Content-Type": "application/x-www-form-urlencoded" };
const CACHE_MS = 5 * 60 * 1000;

const REDIRECT = `${GMAIL_CLIENT_ID.split(".").reverse().join(".")}:/oauth2redirect`;
let access = null; // { token, expires }, kept in memory only
let cache = null; // { at, orders }

export const gmailAvailable = () => Capacitor.getPlatform() === "ios" && !!GMAIL_CLIENT_ID;
export const gmailLinked = async () => !!(await SecureStorage.getItem(TOKEN_KEY));

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const random = (n) => b64url(crypto.getRandomValues(new Uint8Array(n)));

const keepAccess = (t) => (access = { token: t.access_token, expires: Date.now() + (t.expires_in - 60) * 1000 });

async function post(url, data) {
  try {
    return await CapacitorHttp.post({ url, headers: FORM, data });
  } catch {
    throw new ScanError("Couldn't reach Google. Check your internet connection.");
  }
}

// Opens Google's sign-in. Resolves once linked; rejects with a ScanError otherwise.
export async function linkGmail() {
  const { Browser } = await import("@capacitor/browser");
  const { App } = await import("@capacitor/app");
  const verifier = random(48);
  const state = random(16);
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  const url = `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
    client_id: GMAIL_CLIENT_ID,
    redirect_uri: REDIRECT,
    response_type: "code",
    scope: SCOPE,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    access_type: "offline",
    prompt: "consent",
  })}`;

  const params = await new Promise((resolve, reject) => {
    let done = false;
    const finish = (fn, v) => {
      if (done) return;
      done = true;
      urlListener.then((l) => l.remove());
      closedListener.then((l) => l.remove());
      fn(v);
    };
    const urlListener = App.addListener("appUrlOpen", ({ url: back }) => {
      if (!back.startsWith(REDIRECT)) return;
      Browser.close().catch(() => {});
      finish(resolve, new URL(back.replace(REDIRECT, "https://app/gmail")).searchParams);
    });
    const closedListener = Browser.addListener("browserFinished", () =>
      setTimeout(() => finish(reject, new ScanError("Gmail wasn't linked.")), 1500),
    );
    Browser.open({ url }).catch(() => finish(reject, new ScanError("Couldn't open Google sign-in.")));
  });

  if (params.get("error") || params.get("state") !== state) throw new ScanError("Gmail wasn't linked.");
  const res = await post(TOKEN_URL, { client_id: GMAIL_CLIENT_ID, code: params.get("code"), code_verifier: verifier, grant_type: "authorization_code", redirect_uri: REDIRECT });
  if (res.status !== 200 || !res.data?.refresh_token) throw new ScanError("Couldn't link Gmail. Please try again.");
  await SecureStorage.set(TOKEN_KEY, res.data.refresh_token, false, false, KeychainAccess.whenUnlockedThisDeviceOnly);
  keepAccess(res.data);
  cache = null;
}

async function forget() {
  access = null;
  cache = null;
  await SecureStorage.removeItem(TOKEN_KEY);
}

async function accessToken() {
  if (access && Date.now() < access.expires) return access.token;
  const refresh_token = await SecureStorage.getItem(TOKEN_KEY);
  if (!refresh_token) throw new ScanError("Link Gmail first.");
  const res = await post(TOKEN_URL, { client_id: GMAIL_CLIENT_ID, grant_type: "refresh_token", refresh_token });
  if (res.status === 400 || res.status === 401) {
    await forget(); // access was removed or has expired
    throw new ScanError("Your Gmail link expired. Tap Email receipts to link it again.");
  }
  if (res.status !== 200) throw new ScanError("Couldn't reach Gmail. Please try again.");
  keepAccess(res.data);
  return access.token;
}

async function gmail(path) {
  let res;
  try {
    res = await CapacitorHttp.get({ url: `${API}${path}`, headers: { Authorization: `Bearer ${await accessToken()}` } });
  } catch (e) {
    if (e instanceof ScanError) throw e;
    throw new ScanError("Couldn't reach Gmail. Check your internet connection.");
  }
  if (res.status !== 200) throw new ScanError("Couldn't read your order emails. Please try again.");
  return res.data;
}

const skipped = async () => JSON.parse((await Preferences.get({ key: SKIPPED_KEY })).value || "[]");

// New food orders from the last two weeks, newest first.
export async function gmailOrders(fresh = false) {
  if (!fresh && cache && Date.now() - cache.at < CACHE_MS) return cache.orders;
  const list = await gmail(`/messages?${new URLSearchParams({ q: gmailQuery(14), maxResults: "20" })}`);
  const skip = new Set(await skipped());
  const ids = (list.messages || []).map((m) => m.id).filter((id) => !skip.has(id));
  const messages = await Promise.all(ids.map((id) => gmail(`/messages/${id}?format=full`)));
  const orders = messages.map(parseOrder).filter(Boolean).sort((a, b) => b.when - a.when);
  cache = { at: Date.now(), orders };
  return orders;
}

// Stops showing an order once it's been added or skipped. Only the email's ID is kept.
export async function skipOrder(id) {
  const ids = [id, ...(await skipped())].slice(0, 300);
  await Preferences.set({ key: SKIPPED_KEY, value: JSON.stringify(ids) });
  if (cache) cache.orders = cache.orders.filter((o) => o.id !== id);
}

// Removes GlycoTank's access at Google and on this phone.
export async function unlinkGmail() {
  const token = await SecureStorage.getItem(TOKEN_KEY);
  await forget();
  await Preferences.remove({ key: SKIPPED_KEY });
  if (token) await post("https://oauth2.googleapis.com/revoke", { token }).catch(() => {});
}
