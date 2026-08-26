// The one generic tool-call endpoint. Every one of daisey.html's ~27
// Trello/Google call sites, through the shim in tools/_standalone-src,
// ends up here as {server, tool, input}. Verify session -> get/refresh
// tokens -> dispatch -> shape the response -> return {payload}.
const { getUserId } = require("./_daisey-lib/session");
const { getGoogleAccessToken, getTrelloToken } = require("./_daisey-lib/tokens");
const trello = require("./_daisey-lib/trello");
const gcal = require("./_daisey-lib/gcal");

function fail(statusCode, code, message) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ error: { code, message } }),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return fail(405, "tool_error", "POST only");

  let req;
  try {
    req = JSON.parse(event.body || "{}");
  } catch (e) {
    return fail(400, "tool_error", "Bad JSON");
  }
  const { server, tool, input } = req;

  const userId = await getUserId(event);
  if (!userId) return fail(401, "no_session", "No session");

  // whoami: what checkStandaloneSession() calls to decide if the login
  // gate should show. A session existing is the only thing it checks —
  // getUserId() already returned non-null, so there's nothing left to do.
  if (server === "Session" && tool === "whoami") {
    return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ payload: {} }) };
  }

  try {
    let payload;
    if (server === "Trello") {
      const token = await getTrelloToken(userId);
      if (!token) return fail(200, "server_not_connected", "Trello isn't connected.");
      payload = await trello.call(tool, input, token);
    } else if (server === "Google Calendar") {
      const accessToken = await getGoogleAccessToken(userId);
      if (!accessToken) return fail(200, "needs_reauth", "Google session expired.");
      payload = await gcal.call(tool, input, accessToken);
    } else {
      return fail(400, "tool_error", `Unknown server: ${server}`);
    }
    return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ payload }) };
  } catch (e) {
    if (e.status === 401) {
      const code = server === "Trello" ? "needs_reauth" : "needs_reauth";
      return fail(200, code, e.message);
    }
    if (e.status === 429) return fail(200, "rate_limited", e.message);
    if (e.status >= 500) return fail(200, "server_unavailable", e.message);
    return fail(200, "tool_error", e.message);
  }
};
