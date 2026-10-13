// Account sign-in with Amazon Cognito, called directly over HTTPS (no SDK).
// Tokens are kept on the device; the ID token is refreshed automatically.

import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";
import { CLOUD } from "./cloud-config.js";

const KEY = "glycotank.auth";
const native = Capacitor.isNativePlatform();
let session = null; // { email, sub, idToken, accessToken, refreshToken, expiresAt }

export class AuthError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

// Friendly messages for Cognito's error types.
const MESSAGES = {
  UsernameExistsException: "An account with this email already exists. Try signing in instead.",
  UserNotFoundException: "Email or password is incorrect.",
  NotAuthorizedException: "Email or password is incorrect.",
  UserNotConfirmedException: "Please verify your email first. We've sent you a code.",
  CodeMismatchException: "That code isn't right. Check the email and try again.",
  ExpiredCodeException: "That code has expired. We've sent you a new one.",
  InvalidPasswordException: "Use at least 8 characters, including a lowercase letter and a number.",
  InvalidParameterException: "Check the email address and try again.",
  LimitExceededException: "Too many attempts. Please wait a few minutes and try again.",
  TooManyRequestsException: "Too many attempts. Please wait a few minutes and try again.",
  TooManyFailedAttemptsException: "Too many attempts. Please wait a few minutes and try again.",
};

async function cognito(action, body) {
  let res;
  try {
    res = await fetch(`https://cognito-idp.${CLOUD.region}.amazonaws.com/`, {
      method: "POST",
      headers: { "Content-Type": "application/x-amz-json-1.1", "X-Amz-Target": `AWSCognitoIdentityProviderService.${action}` },
      body: JSON.stringify({ ClientId: CLOUD.clientId, ...body }),
    });
  } catch {
    throw new AuthError("Can't reach the server. Check your internet connection.", "Network");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const type = String(data.__type || "").split("#").pop();
    throw new AuthError(MESSAGES[type] || data.message || "Something went wrong. Please try again.", type);
  }
  return data;
}

const decode = (jwt) => JSON.parse(atob(jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));

async function persist() {
  const value = session ? JSON.stringify(session) : null;
  if (native) value ? await Preferences.set({ key: KEY, value }) : await Preferences.remove({ key: KEY });
  else value ? localStorage.setItem(KEY, value) : localStorage.removeItem(KEY);
}

function fromTokens(t, refreshToken) {
  const claims = decode(t.IdToken);
  return {
    email: claims.email,
    sub: claims.sub,
    idToken: t.IdToken,
    accessToken: t.AccessToken,
    refreshToken: t.RefreshToken || refreshToken,
    expiresAt: Date.now() + (t.ExpiresIn || 3600) * 1000,
  };
}

export const configured = () => !!(CLOUD.clientId && CLOUD.apiUrl);

export async function restore() {
  try {
    const raw = native ? (await Preferences.get({ key: KEY })).value : localStorage.getItem(KEY);
    session = raw ? JSON.parse(raw) : null;
  } catch {
    session = null;
  }
  return session;
}

export const current = () => session;

export async function signUp(email, password) {
  await cognito("SignUp", { Username: email.trim(), Password: password, UserAttributes: [{ Name: "email", Value: email.trim() }] });
}

export async function confirmSignUp(email, code) {
  await cognito("ConfirmSignUp", { Username: email.trim(), ConfirmationCode: code.trim() });
}

export async function resendCode(email) {
  await cognito("ResendConfirmationCode", { Username: email.trim() });
}

export async function signIn(email, password) {
  const res = await cognito("InitiateAuth", { AuthFlow: "USER_PASSWORD_AUTH", AuthParameters: { USERNAME: email.trim(), PASSWORD: password } });
  if (!res.AuthenticationResult) throw new AuthError("Sign-in needs an extra step we don't support yet.", res.ChallengeName);
  session = fromTokens(res.AuthenticationResult);
  await persist();
  return session;
}

export async function forgotPassword(email) {
  await cognito("ForgotPassword", { Username: email.trim() });
}

export async function resetPassword(email, code, password) {
  await cognito("ConfirmForgotPassword", { Username: email.trim(), ConfirmationCode: code.trim(), Password: password });
}

// A valid ID token for API calls, refreshing it if it's about to expire.
export async function idToken() {
  if (!session) throw new AuthError("Please sign in.", "SignedOut");
  if (Date.now() < session.expiresAt - 120_000) return session.idToken;
  try {
    const res = await cognito("InitiateAuth", { AuthFlow: "REFRESH_TOKEN_AUTH", AuthParameters: { REFRESH_TOKEN: session.refreshToken } });
    session = fromTokens(res.AuthenticationResult, session.refreshToken);
    await persist();
    return session.idToken;
  } catch (e) {
    if (e.code === "NotAuthorizedException") {
      // Refresh token revoked or expired: the user has to sign in again.
      session = null;
      await persist();
      throw new AuthError("Your session has expired. Please sign in again.", "SignedOut");
    }
    throw e;
  }
}

// ---- Google and Apple sign-in ------------------------------------------------
// Cognito's hosted sign-in, opened in the system browser (Custom Tabs /
// SFSafariViewController; Google refuses embedded web views). Authorization
// code flow with PKCE; the browser returns to the app via glycotank://auth.

const REDIRECT = "glycotank://auth";
const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const random = (n) => b64url(crypto.getRandomValues(new Uint8Array(n)));

export const socialProviders = () => (native && CLOUD.authDomain ? CLOUD.providers : []);

export async function signInWithProvider(provider, retried = false) {
  const { Browser } = await import("@capacitor/browser");
  const { App } = await import("@capacitor/app");
  const verifier = random(48);
  const state = random(16);
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  const url =
    `${CLOUD.authDomain}/oauth2/authorize?` +
    new URLSearchParams({
      identity_provider: provider,
      response_type: "code",
      client_id: CLOUD.clientId,
      redirect_uri: REDIRECT,
      scope: "openid email profile",
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
    });

  const params = await new Promise((resolve, reject) => {
    let done = false;
    const finish = (fn, v) => {
      if (done) return;
      done = true;
      urlListener.then((l) => l.remove());
      closedListener.then((l) => l.remove());
      fn(v);
    };
    const urlListener = App.addListener("appUrlOpen", ({ url }) => {
      if (!url.startsWith(REDIRECT)) return;
      Browser.close().catch(() => {});
      finish(resolve, new URL(url.replace(REDIRECT, "https://app/auth")).searchParams);
    });
    // The user closed the browser. On Android this can arrive just before the
    // redirect, so give the redirect a moment to win.
    const closedListener = Browser.addListener("browserFinished", () =>
      setTimeout(() => finish(reject, new AuthError("Sign-in was cancelled.", "Cancelled")), 1500),
    );
    Browser.open({ url }).catch((e) => finish(reject, e));
  });

  const error = params.get("error_description") || params.get("error");
  if (error) {
    // Cognito rejects the first sign-in right after linking a Google/Apple
    // login to an existing account; the second attempt succeeds.
    if (/already found an entry for username/i.test(error) && !retried) return signInWithProvider(provider, true);
    if (params.get("error") === "access_denied") throw new AuthError("Sign-in was cancelled.", "Cancelled");
    throw new AuthError("Couldn't sign in. Please try again.", "OAuth");
  }
  if (params.get("state") !== state) throw new AuthError("Couldn't sign in. Please try again.", "State");

  let res;
  try {
    res = await fetch(`${CLOUD.authDomain}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", client_id: CLOUD.clientId, code: params.get("code"), redirect_uri: REDIRECT, code_verifier: verifier }),
    });
  } catch {
    throw new AuthError("Can't reach the server. Check your internet connection.", "Network");
  }
  const t = await res.json().catch(() => ({}));
  if (!res.ok) throw new AuthError("Couldn't sign in. Please try again.", t.error || "Token");
  session = fromTokens({ IdToken: t.id_token, AccessToken: t.access_token, RefreshToken: t.refresh_token, ExpiresIn: t.expires_in });
  await persist();
  return session;
}

export async function signOut() {
  const token = session?.refreshToken;
  session = null;
  await persist();
  if (token) await cognito("RevokeToken", { Token: token }).catch(() => {});
}
