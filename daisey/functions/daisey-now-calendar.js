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
const { openStore } = require("./_daisey-lib/blobs");
const { getGoogleAccessToken } = require("./_daisey-lib/tokens");

const MAX_CALENDARS = 12; // every calendar ticked in Google Calendar, within reason
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

function shape(e, colors, cal) {
  const allDay = !e.start.dateTime;
  return {
    id: e.id,
    calendarId: cal.id,
    // Only what the user can actually change offers Move and Delete.
    editable: !!cal.editable && !e.recurringEventId && e.status !== "cancelled",
    title: e.summary || (allDay ? "All day" : "Busy"),
    start: e.start.dateTime || e.start.date,
    end: e.end?.dateTime || e.end?.date || null,
    allDay,
    busy: isBusy(e),
    // Where it happens: an event with a place means you are Out (the Now
    // card's place guess).
    location: e.location || null,
    // A block the user accepted from Daisey's pencil schedule names its task.
    taskId: e.extendedProperties?.private?.daiseyTask || null,
    // The colour the user sees in Google Calendar: the event's own if it has
    // one, otherwise the calendar's.
    color: (e.colorId && colors?.event?.[e.colorId]?.background) || cal.color || null,
  };
}

const gJson = async (url, accessToken) => {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  return res.ok ? res.json() : null;
};

// Which calendars to read, and the palette their colours come from. Both
// change about never, so one lookup per warm function instance is plenty.
// Kept 10 minutes, and skipped on ?fresh=1 — the client asks for that right
// after accepting a pencil block, since the first one creates the "Daisey"
// calendar, which a cached list wouldn't know.
let cached = null, cachedAt = 0;
const CACHE_MS = 10 * 60000;
async function calendarsFor(accessToken, fresh = false) {
  if (!cached || fresh || Date.now() - cachedAt > CACHE_MS) {
    const [colors, list] = await Promise.all([
      gJson("https://www.googleapis.com/calendar/v3/colors", accessToken),
      gJson("https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader&maxResults=50", accessToken),
    ]);
    if (!list) return { colors: null, calendars: [{ id: "primary", color: null, editable: true }] };
    // Only the ones ticked in Google Calendar: an unticked calendar is one
    // the user has already said they don't want to look at.
    const calendars = (list.items || []).filter((c) => c.selected !== false && !c.deleted)
      .slice(0, MAX_CALENDARS)
      .map((c) => ({ id: c.id, color: c.backgroundColor || null, editable: ["owner", "writer"].includes(c.accessRole) }));
    cached = { colors, calendars: calendars.length ? calendars : [{ id: "primary", color: null, editable: true }] };
    cachedAt = Date.now();
  }
  return cached;
}

// One calendar's events in the range, already shaped.
async function eventsFrom(cal, from, to, accessToken, colors) {
  const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events`);
  for (const [k, v] of Object.entries({ timeMin: new Date(from).toISOString(), timeMax: new Date(to).toISOString(),
    singleEvents: "true", orderBy: "startTime", maxResults: "250" })) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (res.status === 401) throw Object.assign(new Error("reauth"), { reauth: true });
  // One calendar failing (a share revoked, say) must not take the day's
  // schedule down with it.
  if (!res.ok) { console.error("daisey-now-calendar", cal.id, res.status); return []; }
  const { items = [] } = await res.json();
  return items.filter(listed).map((e) => shape(e, colors, cal));
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

  const { colors, calendars } = await calendarsFor(accessToken, q.fresh === "1");
  let events;
  try {
    const perCalendar = await Promise.all(calendars.map((c) => eventsFrom(c, from, to, accessToken, colors)));
    events = perCalendar.flat().sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  } catch (e) {
    if (e.reauth) return fail(409, "needs_reauth");
    console.error("daisey-now-calendar", e);
    return fail(502, "google");
  }
  return reply(200, { events });
};
