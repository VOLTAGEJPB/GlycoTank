// Sign-in / create-account screen shown before the app when an account is needed.

import * as auth from "../auth.js";
import { CLOUD } from "../cloud-config.js";
import { $, $$, esc, toast } from "../ui.js";
import { haptic } from "../motion.js";

const TANK = `<svg viewBox="0 0 120 160" aria-hidden="true"><defs><clipPath id="auClip"><rect x="14" y="18" width="92" height="132" rx="24"/></clipPath></defs>
  <rect x="44" y="5" width="32" height="13" rx="5" fill="#3a4357"/><rect x="14" y="18" width="92" height="132" rx="24" fill="#20283a"/>
  <g clip-path="url(#auClip)"><path class="ob-wave" d="M-120 70 q30 -9 60 0 t60 0 t60 0 t60 0 t60 0 t60 0 V220 H-120 Z" fill="#57cc99"/></g>
  <rect x="14" y="18" width="92" height="132" rx="24" fill="none" stroke="#e8ebf1" stroke-width="7"/></svg>`;

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

    let screen = "start";
    let email = "";
    let pendingPassword = "";

    const views = {
      start: () => `
        <div class="ob-hero">${TANK}</div>
        <h2>Welcome to GlycoTank</h2>
        <p class="ob-lead">Create a free account so your meals, training and progress are backed up and available on any device.</p>
        ${CLOUD.providers.includes("SignInWithApple") ? `<button class="btn social" data-provider="SignInWithApple"> Continue with Apple</button>` : ""}
        ${CLOUD.providers.includes("Google") ? `<button class="btn social" data-provider="Google">Continue with Google</button>` : ""}`,
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
      $$("[data-provider]", root).forEach((b) => b.addEventListener("click", () => toast("Coming soon")));
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
        btn.dataset.label = btn.textContent;
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
          btn.textContent = btn.dataset.label;
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
