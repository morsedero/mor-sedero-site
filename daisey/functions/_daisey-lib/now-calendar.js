// Reading a user's Google Calendar agenda: shared by daisey-now-calendar (the
// app's read) and daisey-now-morning (the morning brief, 2026-10-06). Moved
// here unchanged from daisey-now-calendar.js; see that file for the why.
const { openStore } = require("./blobs");
const { getGoogleAccessToken } = require("./tokens");

const MAX_CALENDARS = 12; // every calendar ticked in Google Calendar, within reason
const isDaiseyBlock = (e) => /\[(daisey|dayflow)\]/.test(e.description || ""); // old Daisey's own planning blocks

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
    // Only what the user can actually change offers Edit and Remove. A
    // repeating event counts (Mor, 2026-10-06: "schedule should be
    // editable"): its id here is the one occurrence, so a PATCH or DELETE on
    // it changes that day only, the way Google's "This event" does.
    editable: !!cal.editable && e.status !== "cancelled",
    recurring: !!e.recurringEventId,
    title: e.summary || (allDay ? "All day" : "Busy"),
    start: e.start.dateTime || e.start.date,
    end: e.end?.dateTime || e.end?.date || null,
    allDay,
    busy: isBusy(e),
    // Last edit: work logged before it can't overrule the event (reality.js).
    updated: e.updated || null,
    // Where it happens: an event with a place means you are Out (the Now
    // card's place guess).
    location: e.location || null,
    // An event Daisey made for a task names it: that task is booked (day.js).
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
//
// Kept PER ACCESS TOKEN, never shared (2026-10-07). It used to be one slot for
// the whole function instance, so once a second person connected, their
// requests read the first person's calendar list (ids, colours) — a new user
// saw the owner's calendars. A token belongs to exactly one Google account, and
// it refreshes about hourly, so entries age out on their own; the map is
// capped so it can't grow.
const cache = new Map(); // accessToken → { at, value }
const CACHE_MS = 10 * 60000;
const CACHE_MAX = 50;
// Which calendars to read: the ones the user picked in Daisey (`only`, a list
// of ids), else the ones ticked in Google Calendar. The cache holds every
// calendar, so a changed pick applies at once without asking Google again.
async function calendarsFor(accessToken, fresh = false, only = null) {
  const all = await allCalendars(accessToken, fresh);
  const chosen = Array.isArray(only) ? only : null;
  const picked = all.calendars.filter((c) => (chosen ? chosen.includes(c.id) : c.selected)).slice(0, MAX_CALENDARS);
  return { colors: all.colors, calendars: picked.length ? picked : (chosen ? [] : [{ id: "primary", color: null, editable: true }]) };
}

// Every calendar the user can read, for the picker and for reading.
async function allCalendars(accessToken, fresh = false) {
  const hit = cache.get(accessToken);
  if (!hit || fresh || Date.now() - hit.at > CACHE_MS) {
    const [colors, list] = await Promise.all([
      gJson("https://www.googleapis.com/calendar/v3/colors", accessToken),
      gJson("https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader&maxResults=50", accessToken),
    ]);
    if (!list) return { colors: null, calendars: [{ id: "primary", name: "", color: null, editable: true, selected: true }] };
    // `selected` is Google's own tick: an unticked calendar is one the user
    // has already said they don't want to look at, and the default here.
    const calendars = (list.items || []).filter((c) => !c.deleted)
      .map((c) => ({ id: c.id, name: c.summaryOverride || c.summary || "", color: c.backgroundColor || null, primary: !!c.primary,
        editable: ["owner", "writer"].includes(c.accessRole), selected: c.selected !== false }));
    const value = { colors, calendars: calendars.length ? calendars : [{ id: "primary", name: "", color: null, editable: true, selected: true }] };
    cache.delete(accessToken);
    cache.set(accessToken, { at: Date.now(), value });
    while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
    return value;
  }
  return hit.value;
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

// The Google access token for a Firebase user's Google `sub`, via old
// Daisey's stored grant. { error: "not_connected" | "needs_reauth" } if none.
async function accessForSub(sub) {
  if (!sub) return { error: "not_connected" };
  const userId = await openStore("daisey-users").get(`google-sub:${sub}`, { type: "text" });
  if (!userId) return { error: "not_connected" };
  const accessToken = await getGoogleAccessToken(userId);
  // `only`: the calendars this user picked in Daisey, or null for the default.
  return accessToken ? { accessToken, userId, only: await chosenCalendars(userId) } : { error: "needs_reauth" };
}

// The picked calendars, kept per user next to their tokens' user id. null =
// never picked, so Google's own ticks decide.
const prefs = () => openStore("daisey-prefs");
async function chosenCalendars(userId) {
  try {
    const rec = await prefs().get(`user:${userId}:calendars`, { type: "json" });
    return Array.isArray(rec?.ids) ? rec.ids : null;
  } catch (e) { console.error("daisey calendars pref", e.message); return null; }
}
async function saveChosenCalendars(userId, ids) {
  if (ids === null) return prefs().delete(`user:${userId}:calendars`);
  return prefs().setJSON(`user:${userId}:calendars`, { ids, at: Date.now() });
}

// Every ticked calendar's events in [from, to], merged and sorted. Throws
// { reauth: true } when Google says the grant is gone.
async function readAgenda(accessToken, from, to, fresh = false, only = null) {
  const { colors, calendars } = await calendarsFor(accessToken, fresh, only);
  const perCalendar = await Promise.all(calendars.map((c) => eventsFrom(c, from, to, accessToken, colors)));
  return perCalendar.flat().sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

module.exports = { accessForSub, readAgenda, calendarsFor, allCalendars, saveChosenCalendars };
