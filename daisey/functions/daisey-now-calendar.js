// Daisey v1's calendar read: GET ?from=ISO&to=ISO with
// "Authorization: Bearer <Firebase ID token>". Returns the busy timed
// events on the primary calendar in that range: { events: [{ title, start, end }] }.
//
// No calendar sign-in of its own: it reuses the Google token old Daisey
// already stores (Netlify Blobs, user:<id>:google, keyed by the Google
// account's `sub`). A Firebase Google sign-in carries that same `sub`, so
// the signed-in user only ever reaches their own token.
//
// Errors: 401 no_session · 404 not_connected (never signed into old Daisey)
// · 409 needs_reauth (old Daisey's grant expired — sign in there again) ·
// 400 bad_range · 502 google.
const { verifyIdToken } = require("./_daisey-lib/firebase-auth");
const { openStore } = require("./_daisey-lib/blobs");
const { getGoogleAccessToken } = require("./_daisey-lib/tokens");

const MAX_RANGE = 3 * 864e5;
const isDaiseyBlock = (e) => /\[(daisey|dayflow)\]/.test(e.description || ""); // old Daisey's own planning blocks

const reply = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  body: JSON.stringify(body),
});
const fail = (statusCode, code) => reply(statusCode, { error: code });

// Busy, timed, not cancelled, not declined, not Daisey's own block.
function busy(e) {
  if (e.status === "cancelled" || !e.start?.dateTime || !e.end?.dateTime) return false;
  if (e.transparency === "transparent" || isDaiseyBlock(e)) return false;
  return !(e.attendees || []).some((a) => a.self && a.responseStatus === "declined");
}

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") return fail(405, "get_only");

  let claims;
  try {
    const token = (event.headers.authorization || event.headers.Authorization || "").replace(/^Bearer\s+/i, "");
    claims = await verifyIdToken(token);
  } catch (e) {
    return fail(401, "no_session");
  }
  const sub = claims.firebase?.identities?.["google.com"]?.[0];
  if (!sub) return fail(404, "not_connected");

  const q = event.queryStringParameters || {};
  const from = Date.parse(q.from), to = Date.parse(q.to);
  if (!(from < to) || to - from > MAX_RANGE) return fail(400, "bad_range");

  const userId = await openStore("daisey-users").get(`google-sub:${sub}`, { type: "text" });
  if (!userId) return fail(404, "not_connected");
  const accessToken = await getGoogleAccessToken(userId);
  if (!accessToken) return fail(409, "needs_reauth");

  const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
  for (const [k, v] of Object.entries({ timeMin: new Date(from).toISOString(), timeMax: new Date(to).toISOString(),
    singleEvents: "true", orderBy: "startTime", maxResults: "100" })) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (res.status === 401) return fail(409, "needs_reauth");
  if (!res.ok) { console.error("daisey-now-calendar google", res.status, await res.text()); return fail(502, "google"); }

  const { items = [] } = await res.json();
  return reply(200, { events: items.filter(busy).map((e) => ({ title: e.summary || "Busy", start: e.start.dateTime, end: e.end.dateTime })) });
};
