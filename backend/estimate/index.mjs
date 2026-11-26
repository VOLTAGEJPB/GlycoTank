// POST /estimate { image: <base64 JPEG>, kind?: "meal" | "receipt" } -> { items: [...], note }
//
// Estimates the foods and nutrition in a photo of a meal, or the items ordered
// on a restaurant receipt, with Claude. The photo
// is only held in memory for the request; nothing is stored. Each user gets a
// daily limit so a stuck client (or someone abusing a token) can't run up the
// bill. The Anthropic API key lives in SSM Parameter Store (SecureString).

import Anthropic from "@anthropic-ai/sdk";
import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";

const MODEL = "claude-opus-5-5";
const DAILY_LIMIT = 3; // meal photos and receipt scans together, per user per day
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // the API's per-image limit
const KEY_PARAM = process.env.API_KEY_PARAM;

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const ssm = new SSMClient({});
let client; // created on first use, reused while the Lambda stays warm

const json = (statusCode, body) => ({ statusCode, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

async function anthropic() {
  if (client) return client;
  const res = await ssm.send(new GetParameterCommand({ Name: KEY_PARAM, WithDecryption: true }));
  client = new Anthropic({ apiKey: res.Parameter.Value, timeout: 45_000, maxRetries: 1 });
  return client;
}

// The user's calendar day, so the limit resets at their midnight. The app sends
// its UTC offset in minutes; older app versions don't, and get UTC.
export function quotaDay(tzOffset, now = Date.now()) {
  const tz = Number.isInteger(tzOffset) && Math.abs(tzOffset) <= 14 * 60 ? tzOffset : 0;
  return new Date(now + tz * 60_000).toISOString().slice(0, 10);
}

// Counts today's estimates for this user and returns the new count. The
// counter row has no `kind`, so sync never sends it to the app, and it's
// removed with the rest of the user's rows when the account is deleted.
async function countUse(userId, day, delta = 1) {
  const res = await db.send(new UpdateCommand({
    TableName: process.env.TABLE,
    Key: { userId, recordKey: `quota#estimate#${day}` },
    UpdateExpression: "ADD used :n SET expiresAt = if_not_exists(expiresAt, :exp)",
    ExpressionAttributeValues: { ":n": delta, ":exp": Math.floor(Date.now() / 1000) + 3 * 86400 },
    ReturnValues: "UPDATED_NEW",
  }));
  return res.Attributes.used;
}

const NUM = { type: "number" };
const SCHEMA = {
  type: "object",
  properties: {
    is_food: { type: "boolean" },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: { name: { type: "string" }, portion: { type: "string" }, kcal: NUM, carbs: NUM, protein: NUM, fat: NUM, fiber: NUM },
        required: ["name", "portion", "kcal", "carbs", "protein", "fat", "fiber"],
        additionalProperties: false,
      },
    },
    note: { type: "string" },
  },
  required: ["is_food", "items", "note"],
  additionalProperties: false,
};

const PROMPT = `This photo was taken by someone logging a meal in a nutrition tracker. Identify each food and drink you can see and estimate the portion and its nutrition, so they can log it.

- List each distinct item separately (for example a bagel and its cream cheese are two items).
- portion: a short, everyday description of the amount you estimated, such as "1 large bagel" or "about 2 tbsp".
- kcal, carbs, protein, fat and fiber (grams) are for that whole portion. Use typical values from standard food composition data for the food as prepared.
- Judge size from cues in the photo (plate, utensils, hands, packaging). When unsure, pick the most typical portion.
- note: one short sentence naming the biggest uncertainty (for example hidden oil or sauce, or portion size), so they know what to double-check.
- If the photo doesn't show food or drink, set is_food to false, return no items and say what you see in note.`;

const RECEIPT_PROMPT = `This is a photo of a restaurant or takeout receipt, taken by someone logging what they ate in a nutrition tracker. List the food and drink items that were ordered, so they can tick the ones they ate.

- One entry per item. If an item was ordered more than once (a quantity of 2, or repeated lines), list it once per unit so each can be ticked separately.
- Fold modifiers and add-ons (extra cheese, add bacon, large size, no sauce) into the item they belong to, adjusting its nutrition. Skip tax, tip, fees, discounts, utensils, bags and other non-food lines.
- name: a readable name for the dish, expanding receipt abbreviations ("CHKN SNDWCH" becomes "Chicken sandwich"). Include the restaurant's name for its signature items when that helps (for example "Chipotle burrito bowl").
- portion: the serving as ordered, such as "1 sandwich", "large" or "12 oz".
- kcal, carbs, protein, fat and fiber (grams) are for one unit as served. If you know the restaurant's published nutrition for that item, use it; otherwise use typical values for that dish at a restaurant.
- note: one short sentence on what was hardest to read or estimate.
- If the photo isn't a receipt or no food or drink items can be read, set is_food to false, return no items and say what you see in note.`;

export async function handler(event) {
  const userId = event.requestContext?.authorizer?.jwt?.claims?.sub;
  if (!userId) return json(401, { error: "unauthorized" });
  let image, kind, tzOffset;
  try {
    ({ image, kind, tzOffset } = JSON.parse(event.body || "{}"));
  } catch {
    return json(400, { error: "bad request" });
  }
  if (typeof image !== "string" || !image) return json(400, { error: "send a photo" });
  if ((image.length * 3) / 4 > MAX_IMAGE_BYTES) return json(413, { error: "That photo is too large." });

  const day = quotaDay(tzOffset);
  let used = 0;
  // A failure on our side (or Claude's) gives the try back.
  const refund = () => (used ? countUse(userId, day, -1).catch((e) => console.error("refund failed", e)) : undefined);
  try {
    used = await countUse(userId, day);
    if (used > DAILY_LIMIT) {
      used = 0; // nothing to give back: this one never ran
      return json(429, { error: `You've used today's ${DAILY_LIMIT} free photo scans (meal photos and receipts). They reset at midnight.` });
    }
    const api = await anthropic();
    const msg = await api.beta.messages.create({
      model: MODEL,
      max_tokens: 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: image } },
          { type: "text", text: kind === "receipt" ? RECEIPT_PROMPT : PROMPT },
        ],
      }],
    });
    if (msg.stop_reason === "refusal") return json(422, { error: "Couldn't estimate this photo. Try another one." });
    if (msg.stop_reason === "max_tokens") return (await refund(), json(502, { error: "The estimate was cut short. Please try again." }));
    const text = msg.content.find((b) => b.type === "text")?.text;
    const out = JSON.parse(text);
    if (!out.is_food || !out.items.length) return json(422, { error: out.note || (kind === "receipt" ? "Couldn't find any food items on this receipt." : "No food found in this photo.") });
    const round = (n) => Math.max(0, Math.round((+n || 0) * 10) / 10);
    const items = out.items.slice(0, 24).map((i) => ({
      name: String(i.name).slice(0, 80),
      portion: String(i.portion).slice(0, 60),
      kcal: Math.round(round(i.kcal)), carbs: round(i.carbs), protein: round(i.protein), fat: round(i.fat), fiber: round(i.fiber),
    }));
    return json(200, { items, note: String(out.note || "").slice(0, 200), remaining: Math.max(0, DAILY_LIMIT - used) });
  } catch (e) {
    console.error(e);
    await refund();
    if (e instanceof Anthropic.RateLimitError) return json(503, { error: "Photo estimates are busy right now. Try again in a minute." });
    if (e instanceof Anthropic.BadRequestError) return json(400, { error: "Couldn't read that photo. Try another one." });
    if (e?.name === "ParameterNotFound") return json(503, { error: "Photo estimates aren't set up yet." });
    return json(500, { error: "Something went wrong estimating this photo. Please try again." });
  }
}
