// GlycoTank Friends. API Gateway has verified the Cognito JWT; the caller is
// the token's `sub`.
//
//   GET  /social                 my profile, friends, requests
//   GET  /social/photo?uid=…     a friend's (or my) profile photo
//   POST /social { action, … }   setProfile, photo, removePhoto, activity,
//                                pushToken, request, respond, remove, block,
//                                report, nudge, deleteAll
//   (scheduled hourly)           "your streak ends tonight" reminders
//
// Table rows (pk / sk):
//   U#uid / P          profile: handle, name, emoji, color, photoVer, share,
//                      days[], summary, tz, tokens[], warned
//   U#uid / PHOTO      photo: base64 JPEG
//   H#handle / H       uid (keeps usernames unique)
//   U#uid / F#other    friendship edge: state "friend" | "out" | "in"
//   U#uid / B#other    I blocked other
//   U#uid / N#other#day  nudge sent (expires)
//   REPORT / ts#uid    reports, reviewed by the owner

import http2 from "node:http2";
import { createSign } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, DeleteCommand, QueryCommand, UpdateCommand, BatchGetCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { RekognitionClient, DetectModerationLabelsCommand } from "@aws-sdk/client-rekognition";
import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";
import { cleanHandle, cleanName, EMOJIS, COLORS, todayIn, hourIn, runLength, sharedStreak, cleanDays, cleanSummary } from "./social-core.mjs";

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
const rek = new RekognitionClient({});
const ssm = new SSMClient({});
const TABLE = process.env.SOCIAL_TABLE;
const MAX_FRIENDS = 200;
const MAX_PHOTO_BYTES = 120_000;

const json = (statusCode, body) => ({ statusCode, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const fail = (status, message) => {
  throw new HttpError(status, message);
};

const get = async (pk, sk) => (await db.send(new GetCommand({ TableName: TABLE, Key: { pk, sk } }))).Item;
const put = (Item, extra = {}) => db.send(new PutCommand({ TableName: TABLE, Item, ...extra }));
const del = (pk, sk) => db.send(new DeleteCommand({ TableName: TABLE, Key: { pk, sk } }));
async function query(pk, prefix) {
  const items = [];
  let ExclusiveStartKey;
  do {
    const r = await db.send(new QueryCommand(prefix
      ? { TableName: TABLE, KeyConditionExpression: "pk = :p AND begins_with(sk, :s)", ExpressionAttributeValues: { ":p": pk, ":s": prefix }, ExclusiveStartKey }
      : { TableName: TABLE, KeyConditionExpression: "pk = :p", ExpressionAttributeValues: { ":p": pk }, ExclusiveStartKey }));
    items.push(...r.Items);
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}
async function profiles(uids) {
  const out = new Map();
  const list = [...new Set(uids)];
  for (let i = 0; i < list.length; i += 100) {
    const r = await db.send(new BatchGetCommand({ RequestItems: { [TABLE]: { Keys: list.slice(i, i + 100).map((u) => ({ pk: `U#${u}`, sk: "P" })) } } }));
    for (const p of r.Responses?.[TABLE] || []) out.set(p.pk.slice(2), p);
  }
  return out;
}
const profile = (uid) => get(`U#${uid}`, "P");
async function requireProfile(uid) {
  const p = await profile(uid);
  if (!p) fail(400, "Pick a username first.");
  return p;
}

// What another user sees about someone.
function card(p, viewer, edge) {
  const today = todayIn(p.tz);
  const days = p.days || [];
  const out = {
    uid: p.pk.slice(2),
    handle: p.handle,
    name: p.name || p.handle,
    emoji: p.emoji,
    color: p.color,
    photoVer: p.photoVer || 0,
  };
  if (edge === "friend") {
    out.streak = runLength(days, today);
    out.loggedToday = days.includes(today);
    out.shared = viewer ? sharedStreak(days, viewer.days, todayIn(viewer.tz)) : 0;
    if (p.share && p.summary?.date === today) out.summary = p.summary;
  }
  return out;
}

// ---------- Push (APNs) ----------
let apnsJwt = null; // { token, at }
let apnsKey = null;
async function apnsToken() {
  if (apnsJwt && Date.now() - apnsJwt.at < 40 * 60_000) return apnsJwt.token;
  if (!apnsKey) {
    try {
      apnsKey = (await ssm.send(new GetParameterCommand({ Name: process.env.APNS_KEY_PARAM, WithDecryption: true }))).Parameter.Value;
    } catch {
      return null; // push not set up yet
    }
  }
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const data = b64({ alg: "ES256", kid: process.env.APNS_KEY_ID }) + "." + b64({ iss: process.env.APNS_TEAM, iat: Math.floor(Date.now() / 1000) });
  const token = data + "." + createSign("SHA256").update(data).sign({ key: apnsKey, dsaEncoding: "ieee-p1363" }).toString("base64url");
  apnsJwt = { token, at: Date.now() };
  return token;
}

function sendOne(client, jwt, device, payload) {
  return new Promise((resolve) => {
    const req = client.request({
      ":method": "POST",
      ":path": `/3/device/${device}`,
      authorization: `bearer ${jwt}`,
      "apns-topic": process.env.APNS_TOPIC,
      "apns-push-type": "alert",
    });
    let status = 0, body = "";
    req.setTimeout(5000, () => req.close());
    req.on("response", (h) => (status = h[":status"]));
    req.on("data", (d) => (body += d));
    req.on("end", () => resolve({ status, body }));
    req.on("error", () => resolve({ status: 0, body: "" }));
    req.end(JSON.stringify(payload));
  });
}

// Sends an alert to every iPhone the user registered; drops dead tokens.
async function push(uid, title, body, data = {}) {
  const p = await profile(uid);
  const tokens = (p?.tokens || []).filter((t) => t.platform === "ios");
  if (!tokens.length) return;
  const jwt = await apnsToken();
  if (!jwt) return;
  const client = http2.connect("https://api.push.apple.com");
  client.on("error", () => {});
  const dead = [];
  try {
    for (const t of tokens) {
      const r = await sendOne(client, jwt, t.token, { aps: { alert: { title, body }, sound: "default" }, ...data });
      if (r.status === 410 || /BadDeviceToken|Unregistered/.test(r.body)) dead.push(t.token);
    }
  } finally {
    client.close();
  }
  if (dead.length) {
    await db.send(new UpdateCommand({
      TableName: TABLE, Key: { pk: `U#${uid}`, sk: "P" },
      UpdateExpression: "SET tokens = :t", ExpressionAttributeValues: { ":t": (p.tokens || []).filter((t) => !dead.includes(t.token)) },
    }));
  }
}
const pushSafe = (...a) => push(...a).catch((e) => console.error("push failed", e));

// ---------- Actions ----------
async function overview(uid) {
  const me = await profile(uid);
  if (!me) return { me: null, friends: [], incoming: [], outgoing: [] };
  const edges = await query(`U#${uid}`, "F#");
  const others = await profiles(edges.map((e) => e.sk.slice(2)));
  const pick = (state) =>
    edges
      .filter((e) => e.state === state && others.has(e.sk.slice(2)))
      .map((e) => card(others.get(e.sk.slice(2)), me, state));
  const friends = pick("friend").sort((a, b) => Number(a.loggedToday) - Number(b.loggedToday) || b.shared - a.shared || a.name.localeCompare(b.name));
  return {
    me: { ...card(me, me, "friend"), share: !!me.share },
    friends,
    incoming: pick("in"),
    outgoing: pick("out"),
  };
}

async function setProfile(uid, b) {
  const me = await profile(uid);
  const fields = {};
  if (b.handle !== undefined) {
    const { handle, error } = cleanHandle(b.handle);
    if (error) fail(400, error);
    if (handle !== me?.handle) {
      try {
        await put({ pk: `H#${handle}`, sk: "H", uid }, { ConditionExpression: "attribute_not_exists(pk)" });
      } catch (e) {
        if (e.name === "ConditionalCheckFailedException") fail(409, "That username is taken.");
        throw e;
      }
      if (me?.handle) await del(`H#${me.handle}`, "H");
    }
    fields.handle = handle;
  } else if (!me) fail(400, "Pick a username.");
  if (b.name !== undefined) fields.name = cleanName(b.name);
  if (b.emoji !== undefined) fields.emoji = EMOJIS.includes(b.emoji) ? b.emoji : EMOJIS[0];
  if (b.color !== undefined) fields.color = COLORS.includes(b.color) ? b.color : COLORS[0];
  if (b.share !== undefined) fields.share = !!b.share;
  if (typeof b.tz === "string") fields.tz = b.tz.slice(0, 64);
  const next = { emoji: EMOJIS[0], color: COLORS[0], share: false, days: [], tokens: [], photoVer: 0, ...me, ...fields, pk: `U#${uid}`, sk: "P", updatedAt: Date.now() };
  await put(next);
  return overview(uid);
}

async function setPhoto(uid, b) {
  await requireProfile(uid);
  const bytes = Buffer.from(String(b.data || ""), "base64");
  if (bytes.length < 500 || bytes.length > MAX_PHOTO_BYTES || bytes[0] !== 0xff || bytes[1] !== 0xd8) fail(400, "That photo couldn't be used. Try another one.");
  const mod = await rek.send(new DetectModerationLabelsCommand({ Image: { Bytes: bytes }, MinConfidence: 60 }));
  const flagged = (mod.ModerationLabels || []).filter((l) => !l.ParentName); // top-level categories only
  if (flagged.length) fail(422, "That photo can't be used. Please choose a different one.");
  const ver = Date.now();
  await put({ pk: `U#${uid}`, sk: "PHOTO", data: bytes.toString("base64"), ver });
  await db.send(new UpdateCommand({ TableName: TABLE, Key: { pk: `U#${uid}`, sk: "P" }, UpdateExpression: "SET photoVer = :v", ExpressionAttributeValues: { ":v": ver } }));
  return overview(uid);
}

async function removePhoto(uid) {
  await del(`U#${uid}`, "PHOTO");
  await db.send(new UpdateCommand({ TableName: TABLE, Key: { pk: `U#${uid}`, sk: "P" }, UpdateExpression: "SET photoVer = :v", ExpressionAttributeValues: { ":v": 0 } }));
  return overview(uid);
}

async function getPhoto(uid, other) {
  if (other !== uid) {
    const edge = await get(`U#${uid}`, `F#${other}`);
    if (!edge) fail(404, "Not found");
  }
  const p = await get(`U#${other}`, "PHOTO");
  if (!p) fail(404, "Not found");
  return { data: p.data, ver: p.ver };
}

// The app reports which days have something logged, today's totals and the time zone.
async function activity(uid, b) {
  const me = await profile(uid);
  if (!me) return { ok: true };
  const days = cleanDays(b.days);
  const summary = cleanSummary(b.summary);
  const tz = typeof b.tz === "string" ? b.tz.slice(0, 64) : me.tz;
  await db.send(new UpdateCommand({
    TableName: TABLE, Key: { pk: `U#${uid}`, sk: "P" },
    UpdateExpression: "SET #d = :d, summary = :s, tz = :tz, activeAt = :now",
    ExpressionAttributeNames: { "#d": "days" },
    ExpressionAttributeValues: { ":d": days, ":s": summary, ":tz": tz, ":now": Date.now() },
  }));
  return { ok: true };
}

async function pushToken(uid, b) {
  const me = await requireProfile(uid);
  const token = String(b.token || "");
  if (!/^[0-9a-fA-F]{32,200}$/.test(token)) fail(400, "bad token");
  const tokens = [{ token, platform: b.platform === "android" ? "android" : "ios", at: Date.now() }, ...(me.tokens || []).filter((t) => t.token !== token)].slice(0, 5);
  await db.send(new UpdateCommand({ TableName: TABLE, Key: { pk: `U#${uid}`, sk: "P" }, UpdateExpression: "SET tokens = :t", ExpressionAttributeValues: { ":t": tokens } }));
  return { ok: true };
}

const blockedEither = async (a, b) => !!((await get(`U#${a}`, `B#${b}`)) || (await get(`U#${b}`, `B#${a}`)));

async function request(uid, b) {
  const me = await requireProfile(uid);
  const { handle, error } = cleanHandle(b.handle);
  if (error) fail(404, "No one has that username.");
  const target = await get(`H#${handle}`, "H");
  if (!target) fail(404, "No one has that username.");
  const other = target.uid;
  if (other === uid) fail(400, "That's you!");
  if (await blockedEither(uid, other)) fail(404, "No one has that username.");
  const existing = await get(`U#${uid}`, `F#${other}`);
  if (existing?.state === "friend") fail(409, "You're already friends.");
  if (existing?.state === "out") fail(409, "Request already sent.");
  if ((await query(`U#${uid}`, "F#")).length >= MAX_FRIENDS) fail(400, "You've reached the friend limit.");
  const now = Date.now();
  if (existing?.state === "in") {
    // They already asked me: adding them back accepts.
    await put({ pk: `U#${uid}`, sk: `F#${other}`, state: "friend", at: now });
    await put({ pk: `U#${other}`, sk: `F#${uid}`, state: "friend", at: now });
    await pushSafe(other, "New friend", `${me.name || me.handle} accepted your friend request.`, { route: "friends" });
    return overview(uid);
  }
  await put({ pk: `U#${uid}`, sk: `F#${other}`, state: "out", at: now });
  await put({ pk: `U#${other}`, sk: `F#${uid}`, state: "in", at: now });
  await pushSafe(other, "Friend request", `${me.name || me.handle} (@${me.handle}) wants to be friends on GlycoTank.`, { route: "friends" });
  return overview(uid);
}

async function respond(uid, b) {
  const me = await requireProfile(uid);
  const other = String(b.uid || "");
  const edge = await get(`U#${uid}`, `F#${other}`);
  if (edge?.state !== "in") fail(404, "That request is no longer open.");
  if (b.accept) {
    const now = Date.now();
    await put({ pk: `U#${uid}`, sk: `F#${other}`, state: "friend", at: now });
    await put({ pk: `U#${other}`, sk: `F#${uid}`, state: "friend", at: now });
    await pushSafe(other, "New friend", `${me.name || me.handle} accepted your friend request.`, { route: "friends" });
  } else {
    await del(`U#${uid}`, `F#${other}`);
    await del(`U#${other}`, `F#${uid}`);
  }
  return overview(uid);
}

async function remove(uid, b) {
  const other = String(b.uid || "");
  await del(`U#${uid}`, `F#${other}`);
  await del(`U#${other}`, `F#${uid}`);
  return overview(uid);
}

async function block(uid, b) {
  const other = String(b.uid || "");
  if (!other || other === uid) fail(400, "bad user");
  await put({ pk: `U#${uid}`, sk: `B#${other}`, at: Date.now() });
  return remove(uid, b);
}

async function report(uid, b) {
  const other = String(b.uid || "");
  const target = await profile(other);
  if (!target) fail(404, "Not found");
  await put({ pk: "REPORT", sk: `${Date.now()}#${uid}`, reporter: uid, target: other, handle: target.handle, reason: String(b.reason || "").slice(0, 300), photoVer: target.photoVer || 0 });
  return { ok: true };
}

async function nudge(uid, b) {
  const me = await requireProfile(uid);
  const other = String(b.uid || "");
  const edge = await get(`U#${uid}`, `F#${other}`);
  if (edge?.state !== "friend") fail(404, "Not friends");
  const day = todayIn(me.tz);
  try {
    await put({ pk: `U#${uid}`, sk: `N#${other}#${day}`, expiresAt: Math.floor(Date.now() / 1000) + 3 * 86400 }, { ConditionExpression: "attribute_not_exists(pk)" });
  } catch (e) {
    if (e.name === "ConditionalCheckFailedException") fail(429, "You already nudged them today.");
    throw e;
  }
  await pushSafe(other, `${me.emoji || "👋"} ${me.name || me.handle} nudged you`, "Log today to keep your streak going.", { route: "friends" });
  return { ok: true };
}

// Removes everything about the user: profile, photo, username, friendships.
async function deleteAll(uid) {
  const me = await profile(uid);
  const rows = await query(`U#${uid}`, "");
  for (const r of rows) {
    if (r.sk.startsWith("F#")) await del(`U#${r.sk.slice(2)}`, `F#${uid}`);
    await del(r.pk, r.sk);
  }
  if (me?.handle) await del(`H#${me.handle}`, "H");
  return { ok: true };
}

// ---------- Hourly: streak reminders at 8 pm local time ----------
async function streakReminders() {
  let ExclusiveStartKey, sent = 0;
  do {
    const r = await db.send(new ScanCommand({ TableName: TABLE, FilterExpression: "sk = :p AND size(tokens) > :z", ExpressionAttributeValues: { ":p": "P", ":z": 0 }, ExclusiveStartKey }));
    for (const p of r.Items) {
      if (hourIn(p.tz) !== 20) continue;
      const today = todayIn(p.tz);
      const days = p.days || [];
      const streak = runLength(days, today);
      if (streak < 2 || days.includes(today) || p.warned === today) continue;
      await db.send(new UpdateCommand({ TableName: TABLE, Key: { pk: p.pk, sk: "P" }, UpdateExpression: "SET warned = :d", ExpressionAttributeValues: { ":d": today } }));
      await pushSafe(p.pk.slice(2), `🔥 ${streak}-day streak`, "Your streak ends at midnight. Log a meal, workout or check-in to keep it going.", { route: "log" });
      sent++;
    }
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return { sent };
}

const ACTIONS = { setProfile, photo: setPhoto, removePhoto, activity, pushToken, request, respond, remove, block, report, nudge, deleteAll };

export async function handler(event) {
  if (event.source === "aws.events" || event["detail-type"] === "Scheduled Event") return streakReminders();
  const uid = event.requestContext?.authorizer?.jwt?.claims?.sub;
  if (!uid) return json(401, { error: "Not signed in" });
  try {
    const method = event.requestContext.http.method;
    const path = event.rawPath || "";
    if (method === "GET" && path.endsWith("/social/photo")) return json(200, await getPhoto(uid, String(event.queryStringParameters?.uid || "")));
    if (method === "GET") return json(200, await overview(uid));
    const body = JSON.parse(event.body || "{}");
    const fn = ACTIONS[body.action];
    if (!fn) return json(400, { error: "Unknown action" });
    return json(200, await fn(uid, body));
  } catch (e) {
    if (e instanceof HttpError) return json(e.status, { error: e.message });
    console.error(e);
    return json(500, { error: "Something went wrong. Please try again." });
  }
}
