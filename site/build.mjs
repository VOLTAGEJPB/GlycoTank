// Builds the GlycoTank website (home, privacy policy, support) into site/public/.
// Deployed to https://glycotank.voltagejpb.com with `npx wrangler deploy` from site/.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "public");
const CONTACT = "joel.perez5588@gmail.com";
const UPDATED = "October 13, 2026";

const css = `
:root{--bg:#0f1115;--card:#161a23;--text:#e8ebf1;--muted:#98a2b3;--line:#262c3d;--accent:#57cc99}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--text);font:17px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,system-ui,sans-serif}
a{color:var(--accent)}
.wrap{max-width:760px;margin:0 auto;padding:0 20px}
header{border-bottom:1px solid var(--line)}
header .wrap{display:flex;align-items:center;justify-content:space-between;gap:12px;padding-top:14px;padding-bottom:14px}
.brand{display:flex;align-items:center;gap:10px;font-weight:800;font-size:20px;color:var(--text);text-decoration:none}
.brand img{width:34px;height:34px;border-radius:9px}
nav a{color:var(--muted);text-decoration:none;margin-left:18px;font-size:15px}
nav a:hover{color:var(--text)}
main{padding:40px 0 64px}
h1{font-size:clamp(30px,6vw,44px);line-height:1.15;letter-spacing:-.02em;margin:0 0 14px}
h2{font-size:22px;margin:34px 0 8px}
.lede{font-size:20px;color:var(--muted);margin:0 0 28px}
.hero{display:flex;gap:28px;align-items:center;margin-bottom:36px}
.hero img{width:120px;height:120px;border-radius:28px;flex:none}
@media (max-width:560px){.hero{flex-direction:column;align-items:flex-start}.hero img{width:88px;height:88px;border-radius:20px}}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:18px}
.card h3{margin:0 0 6px;font-size:17px}
.card p{margin:0;color:var(--muted);font-size:15px}
.meta{color:var(--muted);font-size:14px}
.note{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px;color:var(--muted);font-size:15px}
footer{border-top:1px solid var(--line);color:var(--muted);font-size:14px;padding:24px 0 40px}
footer a{color:var(--muted);margin-right:16px}
`;

function page(rel, title, description, body) {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<meta name="description" content="${description}">
<meta name="color-scheme" content="dark">
<link rel="icon" href="/icon-192.png">
<style>${css}</style>
</head>
<body>
<header><div class="wrap">
<a class="brand" href="/"><img src="/icon-192.png" alt="">GlycoTank</a>
<nav><a href="/support/">Support</a><a href="/privacy/">Privacy</a></nav>
</div></header>
<main><div class="wrap">
${body}
</div></main>
<footer><div class="wrap">
<p><a href="/">Home</a><a href="/support/">Support</a><a href="/privacy/">Privacy policy</a></p>
<p>&copy; 2026 Joel Perez. GlycoTank provides general fitness estimates and is not medical advice.</p>
</div></footer>
</body>
</html>`;
  const file = path.join(out, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, html);
}

page(
  "index.html",
  "GlycoTank: know your fuel tank",
  "GlycoTank tracks your meals and training and estimates your glycogen 'fuel tank', so you can plan carbs, train smarter and recover better. Private and offline.",
  `<div class="hero"><img src="/icon-512.png" alt="GlycoTank app icon">
<div><h1>Know your fuel tank</h1>
<p class="lede">GlycoTank tracks your meals and training and estimates your glycogen, the carbohydrate fuel stored in your muscles and liver. Plan your carbs, train when you're ready, and recover better.</p></div></div>
<div class="grid">
<div class="card"><h3>Glycogen tank</h3><p>See an estimate of your fuel level rise with meals and drain with training, with a trend over 7 to 30 days.</p></div>
<div class="card"><h3>Carb planner</h3><p>Enter tomorrow's training and get a suggestion for how many carbs to eat today.</p></div>
<div class="card"><h3>Readiness</h3><p>A 10-second morning check-in scores your readiness from sleep, resting heart rate and mood.</p></div>
<div class="card"><h3>Personal targets</h3><p>Calories, protein, carbs, fat and fiber set from your body, goal and training.</p></div>
<div class="card"><h3>Scan to log</h3><p>Scan a barcode or snap the Nutrition Facts label and your meal fills itself in.</p></div>
<div class="card"><h3>Fast logging</h3><p>Favorites, full workout sessions, quick macro entry, a rest timer and plate math.</p></div>
<div class="card"><h3>Private by design</h3><p>No ads, no tracking, never sold. Your data is backed up privately to your account so it follows you to a new phone.</p></div>
</div>
<h2>Coming soon</h2>
<p>GlycoTank is coming to the App Store and Google Play. Questions? See <a href="/support/">support</a>.</p>`,
);

page(
  "privacy/index.html",
  "Privacy Policy | GlycoTank",
  "GlycoTank's privacy policy: what we store, why, and how to delete it.",
  `<h1>Privacy Policy</h1>
<p class="meta">Last updated: ${UPDATED}</p>
<p>GlycoTank is a fitness and nutrition tracking app for iPhone and Android made by Joel Perez ("we"). This policy explains what information the app stores, why, and how you can delete it. In short: <strong>we store your data only to back it up and sync it between your devices. We never sell it, share it or use it for advertising.</strong></p>

<h2>Your account</h2>
<p>To use GlycoTank you create an account with your email address and a password. We use your email address to sign you in, to send you a verification code when you sign up and to help you reset your password. We don't send marketing email. Your password is handled by our sign-in provider and is never visible to us.</p>

<h2>Information we store</h2>
<p>Everything you enter in GlycoTank is saved on your device and backed up to your account so it's available when you sign in on another phone. This includes meals, workouts, morning check-ins (sleep, resting heart rate, mood), your profile details (such as weight, height, age, sex and goal) and your settings.</p>
<p>We use this information only to provide the app to you: to keep your devices in sync and to restore your data when you sign in. We don't use it for advertising, we don't sell it, and we don't share it with anyone, except the service providers that run the app for us as described below or where required by law.</p>

<h2>Where it's stored and how it's protected</h2>
<p>Your account and data are stored with Amazon Web Services (AWS) in the United States. Data is encrypted in transit (HTTPS) and at rest. Only you can access your data through the app, after signing in. We keep automatic backups for a limited time to protect against data loss.</p>

<h2>What we don't collect</h2>
<p>GlycoTank has no advertising, no analytics, no crash reporting and no third-party tracking tools. We don't collect your location, contacts or photos.</p>

<h2>Scanning food</h2>
<p><strong>Nutrition label scans</strong> are read entirely on your device. The photo is not uploaded anywhere.</p>
<p><strong>Barcode lookups</strong> send only the product's barcode number to <a href="https://world.openfoodfacts.org">Open Food Facts</a>, a free, open food database, to fetch the product's name and nutrition information. No other information about you or your data is sent. Open Food Facts receives the request like any website visit, under <a href="https://world.openfoodfacts.org/privacy">its own privacy policy</a>.</p>

<h2>Exports and backups</h2>
<p>You can export your data as a backup file or spreadsheet from Settings. The app hands the file to your phone's share sheet, and you choose where it goes (for example Files, email or a cloud drive). Once you share a file, it's handled by the app or service you chose under that service's privacy policy.</p>

<h2>Reminders</h2>
<p>If you turn on reminders, GlycoTank schedules notifications locally on your device. Nothing is sent to a server to deliver them. You can turn them off in the app or in your phone's settings at any time.</p>

<h2>Deleting your account and data</h2>
<p>You can delete your account at any time in the app with <em>Settings → Account → Delete account</em>. This permanently deletes your account and all the data stored with it from our servers, and removes it from your device. Copies in our automatic backups are deleted within 35 days. You can also email us to ask for your account to be deleted.</p>
<p><em>Settings → Your data → Delete all data</em> deletes your meals, workouts, check-ins and settings from your device and your account but keeps your account. Uninstalling the app removes the data from that device only.</p>

<h2>Children</h2>
<p>GlycoTank is not directed at children under 13 and we don't knowingly collect information from children under 13. If you believe a child has created an account, contact us and we'll delete it.</p>

<h2>Health information</h2>
<p>GlycoTank provides general fitness and nutrition estimates. It is not a medical device and does not provide medical advice, diagnosis or treatment.</p>

<h2>Changes to this policy</h2>
<p>If this policy changes, we'll update the date at the top of this page. If we make significant changes to what we collect or how we use it, we'll tell you in the app before they take effect.</p>

<h2>Contact</h2>
<p>Questions about privacy? Email <a href="mailto:${CONTACT}">${CONTACT}</a>.</p>`,
);

page(
  "support/index.html",
  "Support | GlycoTank",
  "Help and frequently asked questions for the GlycoTank app.",
  `<h1>Support</h1>
<p class="lede">Need help, found a bug, or have an idea? Email <a href="mailto:${CONTACT}">${CONTACT}</a> and we'll get back to you.</p>

<h2>How does the glycogen tank work?</h2>
<p>GlycoTank keeps a running estimate of the carbohydrate stored in your muscles and liver. Meals add about 85% of their carbs. Strength training uses a set amount per hard set and cardio uses an amount per minute based on intensity. Your body also uses some every day, more when the tank is full and less as it empties. You can adjust every value in <em>Settings → Targets &amp; tank</em>, or let <em>Personalize</em> set them for you.</p>

<h2>Is my data backed up?</h2>
<p>Yes. Everything you log is backed up to your GlycoTank account automatically whenever you're online. You can see when it last synced in <em>Settings → Account</em>. You can also save your own copy any time with <em>Settings → Your data → Back up (JSON)</em>.</p>

<h2>How do I move my data to a new phone?</h2>
<p>Install GlycoTank on the new phone and sign in with the same email and password. Your data downloads automatically.</p>

<h2>I forgot my password</h2>
<p>On the sign-in screen, tap <em>I have an account</em>, then <em>Forgot password?</em>. We'll email you a code to set a new one.</p>

<h2>Reminders aren't showing up</h2>
<p>Make sure reminder times are set in <em>Settings → Reminders</em> and that notifications are allowed for GlycoTank in your phone's settings. Some Android phones also stop notifications for apps with battery optimization turned on.</p>

<h2>How do I delete my account?</h2>
<p>Use <em>Settings → Account → Delete account</em>. This permanently deletes your account and all your data. See our <a href="/privacy/">privacy policy</a> for details.</p>

<div class="note">GlycoTank gives general fitness and nutrition estimates, not medical advice. Talk to a doctor or dietitian before making big changes to your diet or training, especially if you have diabetes or another health condition.</div>`,
);

fs.writeFileSync(path.join(out, "robots.txt"), "User-agent: *\nAllow: /\n");
console.log("Built GlycoTank site into site/public/");
