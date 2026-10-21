// Daisey v1's Job Hunt read: the cards in jobs.json in the Job Hunt Drive
// folder. GET with "Authorization: Bearer <Firebase ID token>". Read only —
// Daisey never writes to Drive.
//   { cards: [...], modified: ISO | null }
//
// Same Google grant as the calendar (found by the Google `sub`, refreshed
// here), so the browser never holds a Drive token. One refresh on a 401.
//
// Errors: 401 no_session · 404 not_connected · 409 needs_reauth (grant gone
// or expired — Reconnect) · 409 needs_drive (grant predates the Drive scope —
// Reconnect) · 502 google (Drive failed, e.g. the Drive API isn't enabled).
const { verifyIdToken } = require("./_daisey-lib/firebase-auth");
const { accessForSub } = require("./_daisey-lib/now-calendar");
const { getGoogleAccessToken } = require("./_daisey-lib/tokens");
const { readJobs } = require("./_daisey-lib/jobs-drive");

const reply = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  body: JSON.stringify(body),
});
const fail = (statusCode, code) => reply(statusCode, { error: code });

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") return fail(405, "get");

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
      return reply(200, await readJobs(accessToken));
    } catch (e) {
      if (!e.reauth) throw e;
      const fresh = await getGoogleAccessToken(userId, true);
      if (!fresh) return fail(409, "needs_reauth");
      return reply(200, await readJobs(fresh));
    }
  } catch (e) {
    if (e.reauth) return fail(409, "needs_reauth");
    if (e.scope) return fail(409, "needs_drive");
    console.error("daisey-now-jobs", e.message);
    return fail(502, "google");
  }
};
