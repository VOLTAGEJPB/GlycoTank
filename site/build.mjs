// Builds the GlycoTank website (home, privacy policy, support) into site/public/.
// Deployed to https://glycotank.voltagejpb.com with `npx wrangler deploy` from site/.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "public");
const CONTACT = "joel.perez5588@gmail.com";
const UPDATED = "October 9, 2026";

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
<div class="card"><h3>Fast logging</h3><p>Favorites, full workout sessions, quick macro entry, a rest timer and plate math.</p></div>
<div class="card"><h3>Private by design</h3><p>No account, no ads, no tracking. Your data stays on your phone.</p></div>
</div>
<h2>Coming soon</h2>
<p>GlycoTank is coming to the App Store and Google Play. Questions? See <a href="/support/">support</a>.</p>`,
);

page(
  "privacy/index.html",
  "Privacy Policy | GlycoTank",
  "GlycoTank's privacy policy. GlycoTank does not collect, store or share any personal data.",
  `<h1>Privacy Policy</h1>
<p class="meta">Last updated: ${UPDATED}</p>
<p>GlycoTank is a fitness and nutrition tracking app for iPhone and Android made by Joel Perez ("we"). This policy explains how the app handles your information. In short: <strong>we don't collect any of it.</strong></p>

<h2>Information stored on your device</h2>
<p>Everything you enter in GlycoTank (meals, workouts, morning check-ins including sleep and resting heart rate, your profile details such as weight, height, age and sex, and your settings) is stored only on your device, in the app's private storage. It is never sent to us or to anyone else. We have no servers that receive app data and no way to see what you log.</p>

<h2>Information we collect</h2>
<p>None. GlycoTank has no user accounts, no analytics, no advertising, no crash reporting and no third-party tracking tools. The app works fully offline.</p>

<h2>Exports and backups</h2>
<p>You can export your data as a backup file or spreadsheet from Settings. The app hands the file to your phone's share sheet, and you choose where it goes (for example Files, email or a cloud drive). Once you share a file, it's handled by the app or service you chose under that service's privacy policy.</p>

<h2>Reminders</h2>
<p>If you turn on reminders, GlycoTank schedules notifications locally on your device. Nothing is sent to a server to deliver them. You can turn them off in the app or in your phone's settings at any time.</p>

<h2>Deleting your data</h2>
<p>You can delete all of your data at any time with <em>Settings → Your data → Delete all data</em>. Uninstalling the app also removes all of its data from your device.</p>

<h2>Children</h2>
<p>GlycoTank is not directed at children under 13 and we don't knowingly collect information from anyone, including children.</p>

<h2>Health information</h2>
<p>GlycoTank provides general fitness and nutrition estimates. It is not a medical device and does not provide medical advice, diagnosis or treatment.</p>

<h2>Changes to this policy</h2>
<p>If this policy changes, we'll update the date at the top of this page. If the app ever begins collecting information, we'll update this policy and the app store listings before that happens.</p>

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
<p>Your data is stored only on your phone, so it isn't backed up automatically. Go to <em>Settings → Your data → Back up (JSON)</em> and save the file somewhere safe, such as Files, email or a cloud drive.</p>

<h2>How do I move my data to a new phone?</h2>
<p>On your old phone, make a backup as described above. Install GlycoTank on the new phone, then use <em>Settings → Your data → Restore backup</em> and choose the backup file.</p>

<h2>Reminders aren't showing up</h2>
<p>Make sure reminder times are set in <em>Settings → Reminders</em> and that notifications are allowed for GlycoTank in your phone's settings. Some Android phones also stop notifications for apps with battery optimization turned on.</p>

<h2>How do I delete my data?</h2>
<p>Use <em>Settings → Your data → Delete all data</em>, or uninstall the app. See our <a href="/privacy/">privacy policy</a> for details.</p>

<div class="note">GlycoTank gives general fitness and nutrition estimates, not medical advice. Talk to a doctor or dietitian before making big changes to your diet or training, especially if you have diabetes or another health condition.</div>`,
);

fs.writeFileSync(path.join(out, "robots.txt"), "User-agent: *\nAllow: /\n");
console.log("Built GlycoTank site into site/public/");
