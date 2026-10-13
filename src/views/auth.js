// Sign-in / create-account screen shown before the app when an account is needed.

import * as auth from "../auth.js";
import { $, $$, esc, toast } from "../ui.js";
import { haptic } from "../motion.js";

const TANK = `<svg viewBox="0 0 120 160" aria-hidden="true"><defs><clipPath id="auClip"><rect x="14" y="18" width="92" height="132" rx="24"/></clipPath></defs>
  <rect x="44" y="5" width="32" height="13" rx="5" fill="#3a4357"/><rect x="14" y="18" width="92" height="132" rx="24" fill="#20283a"/>
  <g clip-path="url(#auClip)"><path class="ob-wave" d="M-120 70 q30 -9 60 0 t60 0 t60 0 t60 0 t60 0 t60 0 V220 H-120 Z" fill="#57cc99"/></g>
  <rect x="14" y="18" width="92" height="132" rx="24" fill="none" stroke="#e8ebf1" stroke-width="7"/></svg>`;

// Brand marks as required by Apple's and Google's sign-in button guidelines.
const APPLE = `<svg viewBox="0 0 17 20" aria-hidden="true"><path fill="currentColor" d="M14.1 10.6c0-2.6 2.1-3.8 2.2-3.9-1.2-1.8-3.1-2-3.7-2-1.6-.2-3.1.9-3.9.9-.8 0-2-.9-3.4-.9C3.6 4.8 2 5.8 1.1 7.4c-1.8 3.2-.5 7.9 1.3 10.5.9 1.3 1.9 2.7 3.2 2.6 1.3-.1 1.8-.8 3.3-.8s2 .8 3.4.8c1.4 0 2.3-1.3 3.1-2.6 1-1.5 1.4-2.9 1.4-3-.1 0-2.7-1-2.7-4.3zM11.6 3c.7-.9 1.2-2 1-3.1-1 0-2.2.7-2.9 1.5-.6.7-1.2 1.9-1 3 1.1.1 2.2-.6 2.9-1.4z"/></svg>`;
const GOOGLE = `<svg viewBox="0 0 18 18" aria-hidden="true"><path fill="#4285F4" d="M17.6 9.2c0-.6-.1-1.2-.2-1.7H9v3.3h4.8a4.1 4.1 0 0 1-1.8 2.7v2.2h2.9c1.7-1.6 2.7-3.9 2.7-6.5z"/><path fill="#34A853" d="M9 18c2.4 0 4.5-.8 5.9-2.2l-2.9-2.2c-.8.5-1.8.9-3 .9-2.3 0-4.3-1.6-5-3.7H1v2.3A9 9 0 0 0 9 18z"/><path fill="#FBBC05" d="M4 10.8a5.4 5.4 0 0 1 0-3.5V5H1a9 9 0 0 0 0 8.1l3-2.3z"/><path fill="#EA4335" d="M9 3.6c1.3 0 2.5.5 3.4 1.3l2.6-2.6A9 9 0 0 0 1 5l3 2.3c.7-2.1 2.7-3.7 5-3.7z"/></svg>`;

const passwordField = (id, label, autocomplete) => `
  <label class="field"><span>${label}</span>
    <div class="pw"><input id="${id}" type="password" autocomplete="${autocomplete}" minlength="8" placeholder="At least 8 characters, with a number">
    <button type="button" class="pw-toggle" data-toggle="${id}">Show</button></div></label>`;

// Resolves once the user is signed in.
export function openAuth() {
  return new Promise((resolve) => {
    const root = document.createElement("section");
    root.id = "auth";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", "Sign in to GlycoTank");
    document.body.appendChild(root);
    document.body.classList.add("onboarding");

    const social = auth.socialProviders();
    let screen = "start";
    let email = "";
    let pendingPassword = "";

    const views = {
      start: () => `
        <div class="ob-hero">${TANK}</div>
        <h2>Welcome to GlycoTank</h2>
        <p class="ob-lead">Create a free account so your meals, training and progress are backed up and available on any device.</p>
        ${social.length ? `<div class="social-list">
          ${social.includes("SignInWithApple") ? `<button class="btn social apple" data-provider="SignInWithApple">${APPLE}<span>Continue with Apple</span></button>` : ""}
          ${social.includes("Google") ? `<button class="btn social google" data-provider="Google">${GOOGLE}<span>Continue with Google</span></button>` : ""}
          <p class="or"><span>or use your email</span></p></div>` : ""}`,
      signup: () => `
        <h2>Create your account</h2>
        <p class="ob-sub">We'll email you a code to confirm it's you.</p>
        <label class="field"><span>Email</span><input id="auEmail" type="email" inputmode="email" autocomplete="email" value="${esc(email)}" placeholder="you@example.com"></label>
        ${passwordField("auPassword", "Password", "new-password")}
        <p class="ob-fine">By creating an account you agree to our <a href="https://glycotank.voltagejpb.com/privacy/" target="_blank" rel="noopener">privacy policy</a>.</p>`,
      verify: () => `
        <h2>Check your email</h2>
        <p class="ob-sub">Enter the 6-digit code we sent to <strong>${esc(email)}</strong>.</p>
        <label class="field"><span>Verification code</span><input id="auCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" class="code-input" placeholder="123456"></label>
        <p class="ob-sub"><a href="#" id="auResend">Send a new code</a></p>`,
      signin: () => `
        <h2>Welcome back</h2>
        <label class="field"><span>Email</span><input id="auEmail" type="email" inputmode="email" autocomplete="email" value="${esc(email)}" placeholder="you@example.com"></label>
        ${passwordField("auPassword", "Password", "current-password")}
        <p class="ob-sub"><a href="#" id="auForgot">Forgot password?</a></p>`,
      forgot: () => `
        <h2>Reset your password</h2>
        <p class="ob-sub">We'll email you a code to set a new password.</p>
        <label class="field"><span>Email</span><input id="auEmail" type="email" inputmode="email" autocomplete="email" value="${esc(email)}" placeholder="you@example.com"></label>`,
      reset: () => `
        <h2>Choose a new password</h2>
        <p class="ob-sub">Enter the code we sent to <strong>${esc(email)}</strong> and your new password.</p>
        <label class="field"><span>Code</span><input id="auCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" class="code-input" placeholder="123456"></label>
        ${passwordField("auPassword", "New password", "new-password")}`,
    };
    const buttons = {
      start: [["signin", "I have an account", "ghost"], ["toSignup", "Create account", "primary"]],
      signup: [["toSignin", "Sign in instead", "ghost"], ["signup", "Create account", "primary"]],
      verify: [["toStart", "Back", "ghost"], ["verify", "Verify", "primary"]],
      signin: [["toSignup", "New here?", "ghost"], ["signin", "Sign in", "primary"]],
      forgot: [["toSignin", "Back", "ghost"], ["forgot", "Send code", "primary"]],
      reset: [["toSignin", "Back", "ghost"], ["reset", "Save password", "primary"]],
    };

    function render(dir = "from-right") {
      root.innerHTML = `
        <header class="ob-top"><span></span></header>
        <form class="ob-body ${dir}" novalidate>${views[screen]()}<p class="form-error" role="alert" hidden></p><button type="submit" hidden></button></form>
        <footer class="ob-foot">${buttons[screen].map(([a, label, kind]) => `<button class="btn ${kind}" data-act="${a}">${label}</button>`).join("")}</footer>`;
      $$("[data-toggle]", root).forEach((b) =>
        b.addEventListener("click", () => {
          const input = $("#" + b.dataset.toggle, root);
          input.type = input.type === "password" ? "text" : "password";
          b.textContent = input.type === "password" ? "Show" : "Hide";
        }),
      );
      $$("[data-act]", root).forEach((b) => b.addEventListener("click", () => act(b.dataset.act, b)));
      $("form", root).addEventListener("submit", (e) => {
        e.preventDefault();
        const primary = $(".btn.primary", root);
        act(primary.dataset.act, primary);
      });
      $("#auResend", root)?.addEventListener("click", (e) => {
        e.preventDefault();
        run(null, async () => {
          await auth.resendCode(email);
          toast("New code sent");
        });
      });
      $("#auForgot", root)?.addEventListener("click", (e) => {
        e.preventDefault();
        email = $("#auEmail", root).value;
        go("forgot");
      });
      $$("[data-provider]", root).forEach((b) =>
        b.addEventListener("click", () =>
          run(b, async () => {
            try {
              await auth.signInWithProvider(b.dataset.provider);
            } catch (e) {
              if (e.code === "Cancelled") return;
              throw e;
            }
            done();
          }),
        ),
      );
      // On the start screen, the ghost button means "go to sign in".
      if (screen === "start") $('[data-act="signin"]', root).dataset.act = "toSignin";
      // Only on mouse devices: on Android, focusing a field from code leaves it
      // focused without a keyboard, and tapping it then doesn't open one.
      if (matchMedia("(pointer: fine)").matches) $("input", root)?.focus({ preventScroll: true });
    }

    const go = (next, dir) => {
      screen = next;
      render(dir);
    };
    const showError = (msg) => {
      const el = $(".form-error", root);
      el.textContent = msg;
      el.hidden = !msg;
      if (msg) haptic.tap();
    };
    const val = (id) => $("#" + id, root)?.value || "";

    async function run(btn, fn) {
      showError("");
      if (btn) {
        btn.disabled = true;
        btn.dataset.label = btn.innerHTML; // keeps the Apple/Google logo
        btn.textContent = "Please wait…";
      }
      try {
        await fn();
      } catch (e) {
        if (e.code === "UserNotConfirmedException") {
          await auth.resendCode(email).catch(() => {});
          go("verify");
          showError(e.message);
        } else showError(e.message || "Something went wrong. Please try again.");
      } finally {
        if (btn && btn.isConnected) {
          btn.disabled = false;
          btn.innerHTML = btn.dataset.label;
        }
      }
    }

    const done = () => {
      root.classList.add("out");
      document.body.classList.remove("onboarding");
      setTimeout(() => root.remove(), 350);
      resolve(auth.current());
    };

    function act(a, btn) {
      if (a === "toSignup") return go("signup");
      if (a === "toSignin") return go("signin", screen === "start" ? "from-right" : "from-left");
      if (a === "toStart") return go("start", "from-left");
      if (a === "signup")
        return run(btn, async () => {
          email = val("auEmail").trim();
          pendingPassword = val("auPassword");
          if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("Enter a valid email address.");
          if (pendingPassword.length < 8 || !/\d/.test(pendingPassword) || !/[a-z]/.test(pendingPassword)) throw new Error("Use at least 8 characters, including a lowercase letter and a number.");
          await auth.signUp(email, pendingPassword);
          go("verify");
        });
      if (a === "verify")
        return run(btn, async () => {
          await auth.confirmSignUp(email, val("auCode"));
          if (pendingPassword) {
            await auth.signIn(email, pendingPassword);
            pendingPassword = "";
            return done();
          }
          toast("Email verified. Please sign in.");
          go("signin");
        });
      if (a === "signin")
        return run(btn, async () => {
          email = val("auEmail").trim();
          const password = val("auPassword");
          if (!email || !password) throw new Error("Enter your email and password.");
          pendingPassword = password;
          await auth.signIn(email, password);
          pendingPassword = "";
          done();
        });
      if (a === "forgot")
        return run(btn, async () => {
          email = val("auEmail").trim();
          await auth.forgotPassword(email);
          go("reset");
        });
      if (a === "reset")
        return run(btn, async () => {
          const password = val("auPassword");
          await auth.resetPassword(email, val("auCode"), password);
          await auth.signIn(email, password);
          toast("Password updated");
          done();
        });
    }

    render("");
  });
}
