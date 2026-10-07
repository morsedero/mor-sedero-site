// Forget this user's Google Calendar and Trello connections (Settings →
// Reset Daisey, 2026-10-07), so both are read from scratch the next time they
// connect. POST with "Authorization: Bearer <Firebase ID token>"; body
// { google?: true, trello?: true } (both by default).
//
// Deletes the stored tokens only. The Google-id → user-id link stays, so
// reconnecting lands on the same user. It does not revoke the grant at Google
// (the user can do that in their Google account) and it never touches the
// calendar, Trello, or Firestore. Note the tokens are shared with old Daisey:
// whoever resets here reconnects there as well.
//
// Errors: 401 no_session · 404 not_connected (no Google id, or nothing ever
// stored) · 405 post_only.
const { verifyIdToken } = require("./_daisey-lib/firebase-auth");
const { openStore } = require("./_daisey-lib/blobs");

const reply = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  body: JSON.stringify(body),
});

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return reply(405, { error: "post_only" });
  let claims;
  try {
    const token = (event.headers.authorization || event.headers.Authorization || "").replace(/^Bearer\s+/i, "");
    claims = await verifyIdToken(token);
  } catch {
    return reply(401, { error: "no_session" });
  }
  const sub = claims.firebase?.identities?.["google.com"]?.[0];
  if (!sub) return reply(404, { error: "not_connected" });
  const userId = await openStore("daisey-users").get(`google-sub:${sub}`, { type: "text" });
  if (!userId) return reply(404, { error: "not_connected" });

  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch { /* both, by default */ }
  const tokens = openStore("daisey-tokens");
  const gone = [];
  if (body.google !== false) { await tokens.delete(`user:${userId}:google`); gone.push("google"); }
  if (body.trello !== false) { await tokens.delete(`user:${userId}:trello`); gone.push("trello"); }
  return reply(200, { ok: true, disconnected: gone });
};
