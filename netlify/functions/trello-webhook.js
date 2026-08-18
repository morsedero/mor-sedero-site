// Trello webhook receiver: syncs a card's native `start` date into its
// description as a `▶ Starts YYYY-MM-DD — ` marker, since the Trello MCP
// connector Daisey uses has no `start` field. Daisey reads the marker
// through its normal (already-working) description read path.
const crypto = require("crypto");

const TRELLO_KEY = process.env.TRELLO_API_KEY;
const TRELLO_TOKEN = process.env.TRELLO_API_TOKEN;
const TRELLO_SECRET = process.env.TRELLO_API_SECRET;
const CALLBACK_URL = "https://morsedero.com/.netlify/functions/trello-webhook";

const START_RE = /^▶ Starts \d{4}-\d{2}-\d{2} — ?/;

function validSignature(rawBody, headerSig) {
  if (!TRELLO_SECRET || !headerSig) return false;
  const hash = crypto
    .createHmac("sha1", TRELLO_SECRET)
    .update(rawBody + CALLBACK_URL)
    .digest("base64");
  // constant-time compare, same length required
  const a = Buffer.from(hash);
  const b = Buffer.from(headerSig);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

exports.handler = async (event) => {
  // Trello sends a HEAD (sometimes GET) to the callback URL to validate it
  // exists before it will accept a new webhook registration.
  if (event.httpMethod === "HEAD" || event.httpMethod === "GET") {
    return { statusCode: 200, body: "ok" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "method not allowed" };
  }

  const rawBody = event.body || "";
  const headerSig = event.headers && (event.headers["x-trello-webhook"] || event.headers["X-Trello-Webhook"]);
  if (!validSignature(rawBody, headerSig)) {
    return { statusCode: 403, body: "forbidden" };
  }

  let payload;
  try {
    payload = JSON.parse(rawBody || "{}");
  } catch {
    return { statusCode: 200, body: "ignored" };
  }

  const action = payload.action;
  const cardId = action && action.data && action.data.card && action.data.card.id;
  if (!cardId) return { statusCode: 200, body: "no card" };

  try {
    const cardRes = await fetch(
      `https://api.trello.com/1/cards/${cardId}?key=${TRELLO_KEY}&token=${TRELLO_TOKEN}&fields=desc,start`
    );
    if (!cardRes.ok) return { statusCode: 200, body: "card fetch failed" };
    const card = await cardRes.json();

    const desc = card.desc || "";
    const stripped = desc.replace(START_RE, "");
    const wantMarker = card.start ? `▶ Starts ${String(card.start).slice(0, 10)} — ` : "";
    const nextDesc = wantMarker + stripped;

    if (nextDesc === desc) return { statusCode: 200, body: "no change" };

    const putRes = await fetch(
      `https://api.trello.com/1/cards/${cardId}?key=${TRELLO_KEY}&token=${TRELLO_TOKEN}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ desc: nextDesc })
      }
    );
    if (!putRes.ok) return { statusCode: 200, body: "card write failed" };

    return { statusCode: 200, body: "synced" };
  } catch (err) {
    return { statusCode: 200, body: "error: " + err.message };
  }
};
