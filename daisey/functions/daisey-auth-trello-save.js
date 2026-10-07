// Receives the Trello token relayed by daisey-auth-trello-callback.js's
// client-side JS (the token itself never reaches a server via URL/redirect
// — Trello only ever puts it in a fragment). Requires an existing session:
// Trello links INTO an account, it never starts one — see mcp-shim.js's
// "Google first, Trello second" ordering.
const { getUserId } = require("./_daisey-lib/session");
const { saveTrelloToken } = require("./_daisey-lib/tokens");
const { verifyIdToken } = require("./_daisey-lib/firebase-auth");
const { userIdForGoogleSub } = require("./_daisey-lib/users");

const KEY = process.env.TRELLO_STANDALONE_API_KEY;

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "POST only" };
  }

  // Two ways in: old Daisey's session cookie, or Daisey v1's Firebase ID
  // token (Authorization: Bearer). The second maps the token's Google id to
  // the same stored-token user id the calendar uses (_daisey-lib/users).
  let userId = await getUserId(event);
  if (!userId) {
    const bearer = ((event.headers && (event.headers.authorization || event.headers.Authorization)) || "").replace(/^Bearer\s+/i, "");
    if (bearer) {
      let claims;
      try { claims = await verifyIdToken(bearer); } catch { return { statusCode: 401, body: "Signed out." }; }
      const sub = claims.firebase?.identities?.["google.com"]?.[0];
      if (!sub) return { statusCode: 400, body: "Sign in with Google to connect Trello." };
      userId = await userIdForGoogleSub(sub);
    }
  }
  if (!userId) {
    return { statusCode: 401, body: "Sign in with Google first." };
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch (e) {
    return { statusCode: 400, body: "Bad JSON" };
  }
  if (!body.token) return { statusCode: 400, body: "Missing token" };

  // Verify the token is real and usable before storing it — a bad or
  // revoked token stored silently would surface later as a confusing
  // tool_error instead of a clear failure right at connect time.
  const check = await fetch(`https://api.trello.com/1/members/me?key=${KEY}&token=${body.token}&fields=username`);
  if (!check.ok) {
    return { statusCode: 400, body: `Trello rejected the token: ${await check.text()}` };
  }

  await saveTrelloToken(userId, body.token);
  return { statusCode: 200, body: "ok" };
};
