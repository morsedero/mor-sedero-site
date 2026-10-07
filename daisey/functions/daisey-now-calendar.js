// Daisey v1's calendar read: every calendar the user has ticked in Google
// Calendar, not just the primary one. GET ?from=ISO&to=ISO with
// "Authorization: Bearer <Firebase ID token>". Returns the primary
// calendar's agenda for that range:
//   { events: [{ id, calendarId, editable, title, start, end, allDay, busy, color }] }
// `color` is the hex the user sees in Google Calendar — the event's own
// colour if it has one, else its calendar's. Events from all the ticked
// calendars are merged and sorted by start.
// Everything the user would see in Google Calendar is listed, so the app can
// show the day; `busy` says whether it should also block Daisey's picks.
// All-day entries, events marked free and ones the user declined are listed
// with busy: false. Cancelled events and old Daisey's own planning blocks
// are dropped entirely — they are not part of anyone's day.
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
const { accessForSub, readAgenda, allCalendars, saveChosenCalendars } = require("./_daisey-lib/now-calendar");

const MAX_RANGE = 9 * 864e5; // today plus a week, with room for timezone edges

const reply = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  body: JSON.stringify(body),
});
const fail = (statusCode, code) => reply(statusCode, { error: code });

exports.handler = async (event) => {
  if (event.httpMethod !== "GET" && event.httpMethod !== "POST") return fail(405, "get_or_post");

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

  // The picker (Settings → Choose calendars). GET ?list → every calendar the
  // user can read, and which are in use; POST { ids: [...] | null } saves the
  // pick (null = back to Google's own ticks). Ids are checked against the
  // user's own list, so a pick can only ever name their calendars.
  if (event.httpMethod === "POST" || q.list !== undefined) {
    const { accessToken, userId, only, error } = await accessForSub(sub);
    if (error) return error === "needs_reauth" ? fail(409, error) : fail(404, error);
    let all;
    try { all = await allCalendars(accessToken, true); } catch (e) { console.error("daisey-now-calendar list", e); return fail(502, "google"); }
    if (event.httpMethod === "POST") {
      let body;
      try { body = JSON.parse(event.body || "{}"); } catch { return fail(400, "bad_request"); }
      let ids = null;
      if (body.ids !== null) {
        if (!Array.isArray(body.ids)) return fail(400, "bad_request");
        const known = new Set(all.calendars.map((c) => c.id));
        ids = [...new Set(body.ids.filter((id) => typeof id === "string" && known.has(id)))].slice(0, 20);
      }
      await saveChosenCalendars(userId, ids);
      return reply(200, { ok: true, ids });
    }
    return reply(200, { calendars: all.calendars.map(({ id, name, color, primary, selected }) => ({ id, name, color, primary, selected })), chosen: only });
  }

  const from = Date.parse(q.from), to = Date.parse(q.to);
  if (!(from < to) || to - from > MAX_RANGE) return fail(400, "bad_range");

  const { accessToken, only, error } = await accessForSub(sub);
  if (error) return error === "needs_reauth" ? fail(409, error) : fail(404, error);

  let events;
  try {
    events = await readAgenda(accessToken, from, to, q.fresh === "1", only);
  } catch (e) {
    if (e.reauth) return fail(409, "needs_reauth");
    console.error("daisey-now-calendar", e);
    return fail(502, "google");
  }
  return reply(200, { events });
};
