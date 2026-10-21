// The shared shell of Daisey's Drive calls (daisey-now-jobs, daisey-now-cv):
// GET (or POST, for a function that lists it in `methods`) with
// "Authorization: Bearer <Firebase ID token>", the Google grant found by the
// Google `sub` and refreshed here, so the browser never holds a Drive token.
// run(accessToken, body) does the Drive call (body: a POST's JSON
// object, else 400 bad_body); one refresh on a 401. A run that throws {bad}
// is a 400 bad_updates.
//
// Errors: 401 no_session · 404 not_connected · 409 needs_reauth (grant gone
// or expired — Reconnect) · 409 needs_drive (grant predates the Drive scope —
// Reconnect) · 502 google (Drive failed, e.g. the Drive API isn't enabled).
const { verifyIdToken } = require("./firebase-auth");
const { accessForSub } = require("./now-calendar");
const { getGoogleAccessToken } = require("./tokens");

const reply = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  body: JSON.stringify(body),
});
const fail = (statusCode, code) => reply(statusCode, { error: code });

async function driveHandler(event, run, name, methods = ["GET"]){
  if (!methods.includes(event.httpMethod)) return fail(405, methods.join(",").toLowerCase());
  let input = null;
  if (event.httpMethod === "POST") {
    try { input = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body || "", "base64").toString() : event.body || ""); } catch { /* checked next */ }
    if (!input || typeof input !== "object" || Array.isArray(input)) return fail(400, "bad_body");
  }

  let claims;
  try {
    const token = (event.headers.authorization || event.headers.Authorization || "").replace(/^Bearer\s+/i, "");
    claims = await verifyIdToken(token);
  } catch (e) {
    return fail(401, "no_session");
  }
  const sub = claims.firebase?.identities?.["google.com"]?.[0];
  if (!sub) return fail(404, "not_connected");

  const { accessToken, userId, error } = await accessForSub(sub);
  if (error) return error === "needs_reauth" ? fail(409, error) : fail(404, error);

  try {
    try {
      return reply(200, await run(accessToken, input));
    } catch (e) {
      if (!e.reauth) throw e;
      const fresh = await getGoogleAccessToken(userId, true);
      if (!fresh) return fail(409, "needs_reauth");
      return reply(200, await run(fresh, input));
    }
  } catch (e) {
    if (e.reauth) return fail(409, "needs_reauth");
    if (e.scope) return fail(409, "needs_drive");
    if (e.notFound) return fail(404, "no_file");
    if (e.bad) return fail(400, "bad_updates");
    console.error(name, e.message);
    return fail(502, "google");
  }
}

module.exports = { driveHandler, fail };
