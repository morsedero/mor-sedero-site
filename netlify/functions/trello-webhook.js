// Trello webhook receiver: syncs a card's native `start` date into its
// description as a hidden `<!-- daisey-start:YYYY-MM-DD -->` HTML comment,
// since the Trello MCP connector Daisey uses has no `start` field. Daisey
// reads the marker through its normal (already-working) description read
// path. An HTML comment, not visible text (2026-08-18) — the original
// `▶ Starts YYYY-MM-DD — ` prefix showed up as real clutter in the card's
// actual Trello description, right next to Trello's own native Start Date
// badge that already shows the same thing. Trello's description renderer
// drops HTML comments, same as GitHub's does. Appended at the *end* of the
// description rather than prepended, so a user's own text is never pushed
// down by it.
const crypto = require("crypto");

const TRELLO_KEY = process.env.TRELLO_API_KEY;
const TRELLO_TOKEN = process.env.TRELLO_API_TOKEN;
const TRELLO_SECRET = process.env.TRELLO_API_SECRET;
const CALLBACK_URL = "https://morsedero.com/.netlify/functions/trello-webhook";

const START_RE = /<!--\s*daisey-start:\d{4}-\d{2}-\d{2}\s*-->/g;
const marker = date => `<!-- daisey-start:${date} -->`;

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
    // Global flag on START_RE strips every occurrence, not just a leading
    // one — belt and suspenders against a stray duplicate ever surviving.
    const stripped = desc.replace(START_RE, "").replace(/\n{3,}/g, "\n\n").trim();
    const wantMarker = card.start ? marker(String(card.start).slice(0, 10)) : "";
    const nextDesc = wantMarker ? (stripped ? `${stripped}\n\n${wantMarker}` : wantMarker) : stripped;

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
