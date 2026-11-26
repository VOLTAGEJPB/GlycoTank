// GET /stats?tz=<minutes east of UTC>  ->  app-wide numbers for the owner's dashboard.
//
// Only the Cognito users listed in ADMIN_SUBS get an answer; everyone else gets
// 404, the same as a route that doesn't exist. Returns counts plus each
// account's email, sign-in methods, join date and last activity (no meal contents).

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { CognitoIdentityProviderClient, ListUsersCommand } from "@aws-sdk/client-cognito-identity-provider";

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const cognito = new CognitoIdentityProviderClient({});
const ADMINS = new Set((process.env.ADMIN_SUBS || "").split(",").map((s) => s.trim()).filter(Boolean));
const DAYS = 14;

const json = (statusCode, body) => ({ statusCode, headers: { "content-type": "application/json", "cache-control": "no-store" }, body: JSON.stringify(body) });

// Calendar day (YYYY-MM-DD) of a timestamp in the viewer's time zone.
export const dayOf = (ms, tz) => new Date(ms + tz * 60_000).toISOString().slice(0, 10);

// How someone signs in. Google and Apple logins are linked to an email account
// (see presignup.mjs), so they show up in the user's `identities` attribute.
export function providerOf(user = {}) {
  let ids = [];
  try { ids = JSON.parse(user.Attributes?.find((a) => a.Name === "identities")?.Value || "[]").map((i) => i.providerName); } catch {}
  const name = (user.Username || "").toLowerCase();
  if (ids.includes("SignInWithApple") || name.startsWith("signinwithapple_")) return "Apple";
  if (ids.includes("Google") || name.startsWith("google_")) return "Google";
  return "Email";
}

async function listUsers() {
  const users = [];
  let PaginationToken;
  do {
    const res = await cognito.send(new ListUsersCommand({ UserPoolId: process.env.USER_POOL_ID, Limit: 60, PaginationToken }));
    users.push(...res.Users);
    PaginationToken = res.PaginationToken;
  } while (PaginationToken);
  return users;
}

async function scanRows() {
  const rows = [];
  let ExclusiveStartKey;
  do {
    const res = await db.send(new ScanCommand({
      TableName: process.env.TABLE,
      ProjectionExpression: "userId, recordKey, kind, serverTime, deleted, used",
      ExclusiveStartKey,
    }));
    rows.push(...res.Items);
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return rows;
}

const attr = (u, name) => u.Attributes?.find((a) => a.Name === name)?.Value;

// Pure so it can be tested: users from Cognito, rows from DynamoDB.
// Cognito users with the same email are one person (one "account" here).
export function summarize(users, rows, tz, now = Date.now()) {
  const today = dayOf(now, tz);
  const days = Array.from({ length: DAYS }, (_, i) => dayOf(now - (DAYS - 1 - i) * 86_400_000, tz));
  const per = Object.fromEntries(days.map((d) => [d, { day: d, newUsers: 0, activeUsers: new Set(), meals: 0, scans: 0 }]));

  const people = new Map(); // email (or Cognito ID when there's none) -> account
  const personOf = new Map(); // Cognito sub -> account
  for (const u of users) {
    const sub = attr(u, "sub") || u.Username;
    const email = (attr(u, "email") || "").trim().toLowerCase();
    const key = email || sub;
    const joined = new Date(u.UserCreateDate).getTime();
    let p = people.get(key);
    if (!p) people.set(key, (p = { email, via: new Set(), joined, lastActive: 0, meals: 0, confirmed: false }));
    p.via.add(providerOf(u));
    p.joined = Math.min(p.joined, joined);
    if (u.UserStatus === "CONFIRMED" || u.UserStatus === "EXTERNAL_PROVIDER") p.confirmed = true;
    personOf.set(sub, p);
  }
  const accounts = [...people.values()];
  const providers = { Email: 0, Google: 0, Apple: 0 };
  for (const p of accounts) {
    for (const v of p.via) providers[v]++;
    const d = dayOf(p.joined, tz);
    if (per[d]) per[d].newUsers++;
  }

  let mealsTotal = 0;
  for (const r of rows) {
    if (r.recordKey?.startsWith("quota#estimate#")) {
      const d = r.recordKey.slice("quota#estimate#".length);
      if (per[d]) per[d].scans += Math.max(0, r.used || 0);
      continue;
    }
    if (!r.kind || !Number.isFinite(r.serverTime)) continue;
    const p = personOf.get(r.userId) || { lastActive: 0, meals: 0 }; // rows of deleted accounts still count as activity
    p.lastActive = Math.max(p.lastActive, r.serverTime);
    const d = dayOf(r.serverTime, tz);
    if (per[d]) per[d].activeUsers.add(p);
    if (r.kind === "meal" && !r.deleted) {
      mealsTotal++;
      p.meals++;
      if (per[d]) per[d].meals++;
    }
  }
  const since = (ms) => accounts.filter((p) => p.lastActive >= now - ms).length;
  const series = days.map((d) => ({ ...per[d], activeUsers: per[d].activeUsers.size }));
  const list = accounts
    .sort((a, b) => b.joined - a.joined)
    .map((p) => ({
      email: p.email || "(no email)",
      via: ["Apple", "Google", "Email"].filter((v) => p.via.has(v)),
      joined: new Date(p.joined).toISOString(),
      lastActive: p.lastActive ? new Date(p.lastActive).toISOString() : null,
      meals: p.meals,
      confirmed: p.confirmed,
    }));
  return {
    generatedAt: new Date(now).toISOString(),
    today,
    users: { total: accounts.length, logins: users.length, confirmed: accounts.filter((p) => p.confirmed).length, providers, newToday: per[today].newUsers, new7: series.slice(-7).reduce((s, x) => s + x.newUsers, 0) },
    active: { today: per[today].activeUsers.size, last7: since(7 * 86_400_000), last30: since(30 * 86_400_000) },
    meals: { total: mealsTotal, today: per[today].meals },
    scans: { today: per[today].scans },
    days: series,
    accounts: list,
  };
}

export async function handler(event) {
  const sub = event.requestContext?.authorizer?.jwt?.claims?.sub;
  if (!sub || !ADMINS.has(sub)) return json(404, { error: "not found" });
  const tzRaw = Number(event.queryStringParameters?.tz);
  const tz = Number.isInteger(tzRaw) && Math.abs(tzRaw) <= 14 * 60 ? tzRaw : 0;
  try {
    const [users, rows] = await Promise.all([listUsers(), scanRows()]);
    return json(200, summarize(users, rows, tz));
  } catch (e) {
    console.error(e);
    return json(500, { error: "Couldn't load stats." });
  }
}
