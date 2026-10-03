// Receives the Trello token relayed by daisey-auth-trello-callback.js's
// client-side JS (the token itself never reaches a server via URL/redirect
// — Trello only ever puts it in a fragment). Requires an existing session:
// Trello links INTO an account, it never starts one — see mcp-shim.js's
// "Google first, Trello second" ordering.
const { getUserId } = require("./_daisey-lib/session");
const { saveTrelloToken } = require("./_daisey-lib/tokens");

const KEY = process.env.TRELLO_STANDALONE_API_KEY;

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "POST only" };
  }

  const userId = await getUserId(event);
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
