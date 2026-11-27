// GlycoTank Friends. API Gateway has verified the Cognito JWT; the caller is
// the token's `sub`.
//
//   GET  /social                 my profile, friends, requests
//   GET  /social/photo?uid=…     a friend's (or my) profile photo
//   POST /social { action, … }   setProfile, photo, removePhoto, activity,
//                                pushToken, request, respond, remove, block,
//                                report, nudge, deleteAll, post, deletePost,
//                                react, comment, deleteComment, reportPost
//   GET  /social/feed?before=…   posts from me and my friends, newest first
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
import { cleanHandle, cleanName, EMOJIS, COLORS, todayIn, hourIn, runLength, sharedStreak, cleanDays, cleanSummary, REACTIONS, cleanText, cleanItem, blockedText } from "./social-core.mjs";

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
    if (blockedText(handle.replace(/[._]/g, " "))) fail(400, "That username isn't available.");
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
  if (b.name !== undefined) {
    fields.name = cleanName(b.name);
    if (blockedText(fields.name)) fail(400, "Please choose a different name.");
  }
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

// ---------- Posts, reactions and comments ----------
// U#uid / POST#<13-digit ms>   post: kind, text, item, photo, reactions {uid: emoji}, comments []
// U#uid / PP#<id>              the post's photo (base64 JPEG)
const POSTS_PER_USER = 15;
const FEED_SIZE = 30;
const MAX_COMMENTS = 200;
const postKey = (id) => `POST#${id}`;
const newId = () => String(Date.now()).padStart(13, "0");

async function canSee(uid, author) {
  if (uid === author) return true;
  return (await get(`U#${uid}`, `F#${author}`))?.state === "friend";
}

async function moderatePhoto(b64) {
  const bytes = Buffer.from(String(b64 || ""), "base64");
  if (bytes.length < 500 || bytes.length > 200_000 || bytes[0] !== 0xff || bytes[1] !== 0xd8) fail(400, "That photo couldn't be used. Try another one.");
  const mod = await rek.send(new DetectModerationLabelsCommand({ Image: { Bytes: bytes }, MinConfidence: 60 }));
  if ((mod.ModerationLabels || []).some((l) => !l.ParentName)) fail(422, "That photo can't be posted. Please choose a different one.");
  return bytes.toString("base64");
}

async function createPost(uid, b) {
  await requireProfile(uid);
  const kind = ["meal", "workout", "text"].includes(b.kind) ? b.kind : "text";
  const { text, error } = cleanText(b.text);
  if (error) fail(400, error);
  const item = kind === "text" ? null : cleanItem(kind, b.item);
  if (!text && !item && !b.photo) fail(400, "Write something or add a photo.");
  const recent = await db.send(new QueryCommand({ TableName: TABLE, KeyConditionExpression: "pk = :p AND begins_with(sk, :s)", ExpressionAttributeValues: { ":p": `U#${uid}`, ":s": "POST#" }, ScanIndexForward: false, Limit: 1 }));
  if (recent.Items[0] && Date.now() - recent.Items[0].createdAt < 5000) fail(429, "Slow down a little.");
  const id = newId();
  const photo = b.photo ? await moderatePhoto(b.photo) : null;
  if (photo) await put({ pk: `U#${uid}`, sk: `PP#${id}`, data: photo });
  await put({ pk: `U#${uid}`, sk: postKey(id), id, kind, text, item, photo: !!photo, reactions: {}, comments: [], createdAt: Date.now() });
  return { ok: true, id };
}

async function deletePost(uid, b) {
  const id = String(b.id || "");
  await del(`U#${uid}`, postKey(id));
  await del(`U#${uid}`, `PP#${id}`);
  return { ok: true };
}

async function react(uid, b) {
  const author = String(b.author || ""), id = String(b.id || "");
  if (!(await canSee(uid, author))) fail(404, "Post not found");
  const emoji = REACTIONS.includes(b.emoji) ? b.emoji : null;
  try {
    await db.send(new UpdateCommand({
      TableName: TABLE, Key: { pk: `U#${author}`, sk: postKey(id) },
      UpdateExpression: emoji ? "SET reactions.#u = :e" : "REMOVE reactions.#u",
      ConditionExpression: "attribute_exists(pk)",
      ExpressionAttributeNames: { "#u": uid },
      ...(emoji ? { ExpressionAttributeValues: { ":e": emoji } } : {}),
    }));
  } catch (e) {
    if (e.name === "ConditionalCheckFailedException") fail(404, "That post was deleted.");
    throw e;
  }
  return { ok: true };
}

async function comment(uid, b) {
  const me = await requireProfile(uid);
  const author = String(b.author || ""), id = String(b.id || "");
  if (!(await canSee(uid, author))) fail(404, "Post not found");
  const { text, error } = cleanText(b.text, 300);
  if (error) fail(400, error);
  if (!text) fail(400, "Write a comment first.");
  const c = { id: `${Date.now()}${Math.floor(Math.random() * 1000)}`, uid, text, at: Date.now() };
  try {
    await db.send(new UpdateCommand({
      TableName: TABLE, Key: { pk: `U#${author}`, sk: postKey(id) },
      UpdateExpression: "SET comments = list_append(comments, :c)",
      ConditionExpression: "attribute_exists(pk) AND size(comments) < :max",
      ExpressionAttributeValues: { ":c": [c], ":max": MAX_COMMENTS },
    }));
  } catch (e) {
    if (e.name === "ConditionalCheckFailedException") fail(404, "That post was deleted or is full.");
    throw e;
  }
  if (author !== uid) await pushSafe(author, `${me.name || me.handle} commented`, text.slice(0, 120), { route: "friends" });
  return { ok: true, comment: c };
}

async function deleteComment(uid, b) {
  const author = String(b.author || ""), id = String(b.id || ""), cid = String(b.cid || "");
  const post = await get(`U#${author}`, postKey(id));
  if (!post) fail(404, "That post was deleted.");
  const c = (post.comments || []).find((x) => x.id === cid);
  if (!c) return { ok: true };
  if (c.uid !== uid && author !== uid) fail(403, "You can only delete your own comments.");
  const i = post.comments.indexOf(c);
  await db.send(new UpdateCommand({
    TableName: TABLE, Key: { pk: `U#${author}`, sk: postKey(id) },
    UpdateExpression: `REMOVE comments[${i}]`,
    ConditionExpression: `comments[${i}].id = :cid`,
    ExpressionAttributeValues: { ":cid": cid },
  }));
  return { ok: true };
}

async function reportPost(uid, b) {
  const author = String(b.author || ""), id = String(b.id || ""), cid = b.cid ? String(b.cid) : null;
  const post = await get(`U#${author}`, postKey(id));
  if (!post) fail(404, "That post was deleted.");
  const c = cid ? (post.comments || []).find((x) => x.id === cid) : null;
  const target = c ? c.uid : author;
  const p = await profile(target);
  await put({ pk: "REPORT", sk: `${Date.now()}#${uid}`, reporter: uid, target, handle: p?.handle, reason: String(b.reason || "").slice(0, 300), post: { author, id, cid, text: (c ? c.text : post.text || "").slice(0, 300), photo: !c && post.photo } });
  return { ok: true };
}

async function getPostPhoto(uid, author, id) {
  if (!(await canSee(uid, author))) fail(404, "Not found");
  const p = await get(`U#${author}`, `PP#${id}`);
  if (!p) fail(404, "Not found");
  return { data: p.data };
}

// Newest posts from me and my friends; `before` pages back in time.
async function feed(uid, before) {
  const me = await profile(uid);
  if (!me) return { posts: [], next: null };
  const edges = await query(`U#${uid}`, "F#");
  const blocked = new Set((await query(`U#${uid}`, "B#")).map((b) => b.sk.slice(2)));
  const authors = [uid, ...edges.filter((e) => e.state === "friend").map((e) => e.sk.slice(2))];
  const upper = before && /^\d{13}$/.test(before) ? postKey(before) : "POST#~";
  const lists = await Promise.all(authors.map((a) =>
    db.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "pk = :p AND sk BETWEEN :lo AND :hi",
      ExpressionAttributeValues: { ":p": `U#${a}`, ":lo": "POST#", ":hi": upper },
      ScanIndexForward: false,
      Limit: POSTS_PER_USER,
    })).then((r) => r.Items.filter((it) => it.sk !== upper)),
  ));
  const posts = lists.flat().sort((a, b) => b.createdAt - a.createdAt).slice(0, FEED_SIZE);
  const people = new Set(posts.map((p) => p.pk.slice(2)));
  for (const p of posts) for (const c of p.comments || []) people.add(c.uid);
  const cards = await profiles([...people]);
  const who = (u) => {
    const p = cards.get(u);
    return p ? { uid: u, handle: p.handle, name: p.name || p.handle, emoji: p.emoji, color: p.color, photoVer: p.photoVer || 0 } : null;
  };
  const out = posts.map((p) => {
    const author = p.pk.slice(2);
    const counts = {};
    for (const [u, e] of Object.entries(p.reactions || {})) if (!blocked.has(u)) counts[e] = (counts[e] || 0) + 1;
    return {
      id: p.id,
      author: who(author),
      kind: p.kind,
      text: p.text,
      item: p.item,
      photo: !!p.photo,
      at: p.createdAt,
      reactions: counts,
      mine: p.reactions?.[uid] || null,
      comments: (p.comments || [])
        .filter((c) => !blocked.has(c.uid) && cards.has(c.uid))
        .map((c) => ({ id: c.id, text: c.text, at: c.at, by: who(c.uid), canDelete: c.uid === uid || author === uid })),
      canDelete: author === uid,
    };
  });
  return { posts: out, next: posts.length === FEED_SIZE ? posts.at(-1).id : null };
}

const ACTIONS = { post: createPost, deletePost, react, comment, deleteComment, reportPost, setProfile, photo: setPhoto, removePhoto, activity, pushToken, request, respond, remove, block, report, nudge, deleteAll };

export async function handler(event) {
  if (event.source === "aws.events" || event["detail-type"] === "Scheduled Event") return streakReminders();
  const uid = event.requestContext?.authorizer?.jwt?.claims?.sub;
  if (!uid) return json(401, { error: "Not signed in" });
  try {
    const method = event.requestContext.http.method;
    const path = event.rawPath || "";
    const q = event.queryStringParameters || {};
    if (method === "GET" && path.endsWith("/social/photo"))
      return json(200, q.post ? await getPostPhoto(uid, String(q.uid || ""), String(q.post)) : await getPhoto(uid, String(q.uid || "")));
    if (method === "GET" && path.endsWith("/social/feed")) return json(200, await feed(uid, q.before));
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
