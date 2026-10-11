// GlycoTank sync API. API Gateway has already verified the Cognito JWT, so
// the user's ID comes from the token claims; a user can only ever touch
// their own records (partition key = Cognito `sub`).
//
//   GET    /sync?since=<cursor>   records changed since the cursor
//   POST   /sync { since, records } upload changes, get everyone else's back
//   DELETE /account               delete all data and the Cognito user

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand, BatchWriteCommand, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { CognitoIdentityProviderClient, AdminDeleteUserCommand } from "@aws-sdk/client-cognito-identity-provider";

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
const cognito = new CognitoIdentityProviderClient({});
const TABLE = process.env.TABLE;

const KINDS = new Set(["meal", "workout", "check", "doc"]);
const DOCS = new Set(["settings", "profile", "meta", "mealFavs", "workoutFavs"]);
const MAX_RECORDS = 500;
const MAX_RECORD_BYTES = 40_000;

const json = (statusCode, body) => ({ statusCode, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

async function allRecords(userId) {
  const items = [];
  let ExclusiveStartKey;
  do {
    const res = await db.send(new QueryCommand({ TableName: TABLE, KeyConditionExpression: "userId = :u", ExpressionAttributeValues: { ":u": userId }, ExclusiveStartKey }));
    items.push(...res.Items);
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

// `serverTime` is when the server stored a record; clients pass back the
// largest one they've seen as their cursor, so clock differences between
// devices can't make a device miss changes.
async function changesSince(userId, since) {
  return (await allRecords(userId))
    .filter((it) => it.serverTime > since)
    .map(({ kind, id, updatedAt, deleted, data, serverTime }) => ({ kind, id, updatedAt, deleted: !!deleted, data: data ?? null, serverTime }));
}

function validate(r) {
  if (!r || typeof r !== "object") return "record must be an object";
  if (!KINDS.has(r.kind)) return `unknown kind ${r.kind}`;
  if (typeof r.id !== "string" || !r.id || r.id.length > 80) return "bad id";
  if (r.kind === "doc" && !DOCS.has(r.id)) return `unknown doc ${r.id}`;
  if (!Number.isFinite(r.updatedAt)) return "bad updatedAt";
  if (JSON.stringify(r.data ?? null).length > MAX_RECORD_BYTES) return "record too large";
  return null;
}

async function upload(userId, records) {
  const now = Date.now();
  let stored = 0;
  for (const r of records) {
    const recordKey = `${r.kind}#${r.id}`;
    // Keep whichever version is newer (last write wins per record).
    const existing = (await db.send(new GetCommand({ TableName: TABLE, Key: { userId, recordKey } }))).Item;
    if (existing && existing.updatedAt >= r.updatedAt) continue;
    await db.send(new PutCommand({
      TableName: TABLE,
      Item: { userId, recordKey, kind: r.kind, id: r.id, updatedAt: r.updatedAt, deleted: !!r.deleted, data: r.deleted ? null : r.data, serverTime: now },
    }));
    stored++;
  }
  return { stored, serverTime: now };
}

async function deleteAccount(userId, username) {
  const items = await allRecords(userId);
  for (let i = 0; i < items.length; i += 25) {
    const batch = items.slice(i, i + 25).map(({ userId: u, recordKey }) => ({ DeleteRequest: { Key: { userId: u, recordKey } } }));
    let req = { RequestItems: { [TABLE]: batch } };
    while (Object.keys(req.RequestItems).length) {
      const res = await db.send(new BatchWriteCommand(req));
      req = { RequestItems: res.UnprocessedItems || {} };
    }
  }
  await cognito.send(new AdminDeleteUserCommand({ UserPoolId: process.env.USER_POOL_ID, Username: username }));
  return items.length;
}

export async function handler(event) {
  const claims = event.requestContext?.authorizer?.jwt?.claims;
  const userId = claims?.sub;
  if (!userId) return json(401, { error: "unauthorized" });
  const route = event.routeKey; // e.g. "GET /sync"
  try {
    if (route === "GET /sync") {
      const since = Number(event.queryStringParameters?.since || 0);
      const records = await changesSince(userId, since);
      return json(200, { records, cursor: Math.max(since, ...records.map((r) => r.serverTime)) });
    }
    if (route === "POST /sync") {
      const body = JSON.parse(event.body || "{}");
      const records = Array.isArray(body.records) ? body.records : [];
      if (records.length > MAX_RECORDS) return json(413, { error: `send at most ${MAX_RECORDS} records at a time` });
      for (const r of records) {
        const problem = validate(r);
        if (problem) return json(400, { error: problem });
      }
      const since = Number(body.since || 0);
      const { serverTime } = await upload(userId, records);
      // Return changes from other devices; the caller's own just-written
      // records come back too, which is harmless (they're not newer).
      const changes = await changesSince(userId, since);
      return json(200, { records: changes, cursor: Math.max(since, serverTime, ...changes.map((r) => r.serverTime)) });
    }
    if (route === "DELETE /account") {
      const removed = await deleteAccount(userId, claims["cognito:username"] || userId);
      return json(200, { deleted: true, records: removed });
    }
    return json(404, { error: "not found" });
  } catch (e) {
    console.error(e);
    return json(500, { error: "server error" });
  }
}
