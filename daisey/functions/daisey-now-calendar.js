// Daisey v1's calendar read: GET ?from=ISO&to=ISO with
// "Authorization: Bearer <Firebase ID token>". Returns the primary
// calendar's agenda for that range:
//   { events: [{ title, start, end, allDay, busy, color }] }
// `color` is the hex the user sees in Google Calendar — the event's own
// colour if it has one, else the calendar's.
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
const { openStore } = require("./_daisey-lib/blobs");
const { getGoogleAccessToken } = require("./_daisey-lib/tokens");

const MAX_RANGE = 9 * 864e5; // today plus a week, with room for timezone edges
const isDaiseyBlock = (e) => /\[(daisey|dayflow)\]/.test(e.description || ""); // old Daisey's own planning blocks

const reply = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  body: JSON.stringify(body),
});
const fail = (statusCode, code) => reply(statusCode, { error: code });

const listed = (e) => e.status !== "cancelled" && !isDaiseyBlock(e) && (e.start?.dateTime || e.start?.date);

// Blocks Daisey's picks: timed, not marked free, not declined.
function isBusy(e) {
  if (!e.start?.dateTime || !e.end?.dateTime) return false;
  if (e.transparency === "transparent") return false;
  return !(e.attendees || []).some((a) => a.self && a.responseStatus === "declined");
}

function shape(e, colors, calendarColor) {
  const allDay = !e.start.dateTime;
  return {
    title: e.summary || (allDay ? "All day" : "Busy"),
    start: e.start.dateTime || e.start.date,
    end: e.end?.dateTime || e.end?.date || null,
    allDay,
    busy: isBusy(e),
    // The colour the user sees in Google Calendar: the event's own if it has
    // one, otherwise the calendar's.
    color: (e.colorId && colors?.event?.[e.colorId]?.background) || calendarColor || null,
  };
}

const gJson = async (url, accessToken) => {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  return res.ok ? res.json() : null;
};

// The palette and the calendar's own colour change about never; one lookup
// per warm function instance is plenty.
let palette = null;
async function colorsFor(accessToken) {
  if (!palette) {
    const [colors, primary] = await Promise.all([
      gJson("https://www.googleapis.com/calendar/v3/colors", accessToken),
      gJson("https://www.googleapis.com/calendar/v3/users/me/calendarList/primary", accessToken),
    ]);
    if (colors) palette = { colors, calendarColor: primary?.backgroundColor || null };
  }
  return palette || { colors: null, calendarColor: null };
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
    singleEvents: "true", orderBy: "startTime", maxResults: "250" })) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (res.status === 401) return fail(409, "needs_reauth");
  if (!res.ok) { console.error("daisey-now-calendar google", res.status, await res.text()); return fail(502, "google"); }

  const { items = [] } = await res.json();
  const { colors, calendarColor } = await colorsFor(accessToken);
  return reply(200, { events: items.filter(listed).map((e) => shape(e, colors, calendarColor)) });
};
