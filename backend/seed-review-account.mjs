// Creates the App Store / Google Play review account and fills it with sample data.
// Usage: node backend/seed-review-account.mjs <email> <password> [--data-only]
// Credentials are kept outside the repo in %LOCALAPPDATA%/GlycoTank-signing/app-review-account.txt.
// Rerun with --data-only before submitting to move the sample data up to today.
import { execFileSync } from "node:child_process";

// store.js expects a browser; give it just enough to load in Node.
globalThis.window = globalThis;
globalThis.document = { addEventListener() {}, visibilityState: "visible" };
globalThis.addEventListener = () => {};
const mem = new Map();
globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) };

const root = new URL("../src/", import.meta.url).href;
const { CLOUD } = await import(root + "cloud-config.js");
const { demoState } = await import(root + "demo.js");
const { stampChanges, toRecords } = await import(root + "sync-model.js");

const [email, password] = process.argv.slice(2);
const aws = (...a) => execFileSync("aws", [...a, "--region", CLOUD.region, "--output", "text"], { encoding: "utf8" }).trim();

if (!process.argv.includes("--data-only")) aws("cognito-idp", "admin-create-user", "--user-pool-id", CLOUD.userPoolId, "--username", email, "--message-action", "SUPPRESS",
  "--user-attributes", `Name=email,Value=${email}`, "Name=email_verified,Value=true", "--query", "User.Username");
if (!process.argv.includes("--data-only")) aws("cognito-idp", "admin-set-user-password", "--user-pool-id", CLOUD.userPoolId, "--username", email, "--password", password, "--permanent");

const r = await fetch(`https://cognito-idp.${CLOUD.region}.amazonaws.com/`, {
  method: "POST",
  headers: { "Content-Type": "application/x-amz-json-1.1", "X-Amz-Target": "AWSCognitoIdentityProviderService.InitiateAuth" },
  body: JSON.stringify({ ClientId: CLOUD.clientId, AuthFlow: "USER_PASSWORD_AUTH", AuthParameters: { USERNAME: email, PASSWORD: password } }),
});
const token = (await r.json()).AuthenticationResult.IdToken;

const state = demoState();
state.meta = { ...state.meta, introSeen: true, personalized: true };
// An empty "previous" snapshot marks every doc as edited now, so the sample
// settings and profile beat a fresh install's untouched defaults.
stampChanges(state, {}, Date.now());
const records = toRecords(state, 0);
const res = await fetch(CLOUD.apiUrl + "/sync", {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ since: 0, records }),
});
console.log("upload:", res.status, "records:", records.length, "meals:", state.meals.length, "workouts:", state.workouts.length, "check-ins:", state.checks.length);

process.exit(0);
