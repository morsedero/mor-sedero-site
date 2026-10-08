// Calendar read: the agenda from the start of today to a week ahead, via the
// daisey-now-calendar function (which reuses old Daisey's Google token — no
// separate calendar sign-in). The free window itself is worked out at each
// render (engine.freeWindow), so it counts down between the fetches.
//
// Every event the user would see is here, so the Schedule panel can show the
// day. `busy` marks the ones that should also stop Daisey picking a task —
// an all-day "ILLUSTRATION WEEK" shouldn't blank the card.
//
// One fetch feeds everything: the Now card and the Schedule panel subscribe
// to the same poller, so they can't disagree and can't double the calls.
import { idToken } from "./firebase.js";

const URL_ = "/.netlify/functions/daisey-now-calendar";
const WRITE_URL = "/.netlify/functions/daisey-now-calendar-write";
// A change made in Google Calendar should land here without anyone thinking
// about it: once a minute while the tab is in front, and again the moment it
// comes back. (Instant would mean Google push channels and a webhook to
// receive them — more machinery than a minute of lag is worth.)
const EVERY = 60000;
const GUEST_EVENTS_KEY = "daisey.guest.events.v1";

// Connect Google Calendar (2026-10-07). A full-page trip through Google's
// consent screen (functions/daisey-auth-google-start, return=now) that stores
// the grant under the account's Google id, then lands back here with
// ?calendar=connected. The hint preselects the account they're signed in
// with, so the grant matches the id the app's own sign-in carries.
let hint = "";
export const setCalendarHint = (email) => { hint = email || ""; };
export function connectCalendar(){
  location.href = `/.netlify/functions/daisey-auth-google-start?return=now${hint ? `&hint=${encodeURIComponent(hint)}` : ""}`;
}

const subs = new Set();
let state = { status: "loading", events: [] };
let timer = null, loading = null;

const localGuest = () => {
  try { return localStorage.getItem("daisey_guest_mode") === "1"; }
  catch { return false; }
};

function guestEvents(){
  let raw;
  try { raw = localStorage.getItem(GUEST_EVENTS_KEY); }
  catch(error){ throw new Error(`Guest events are unavailable: ${error.message || error}`); }
  if(!raw) return [];
  try {
    const events = JSON.parse(raw);
    if(!Array.isArray(events)) throw new Error("invalid event list");
    return events;
  } catch(error){
    throw new Error(`Guest events could not be read: ${error.message || error}`);
  }
}

function saveGuestEvents(events){
  try { localStorage.setItem(GUEST_EVENTS_KEY, JSON.stringify(events)); }
  catch(error){ throw new Error(`Guest events could not be saved: ${error.message || error}`); }
  publish({ status: "ok", events });
}

async function fetchAgenda(fresh = false){
  if(localGuest()) return { status: "ok", events: guestEvents() };
  // From the start of today, so the panel can show what already happened, to
  // the end of the seventh day ahead — as far as the panel can step.
  const from = new Date(); from.setHours(0, 0, 0, 0);
  const end = new Date(); end.setDate(end.getDate() + 8); end.setHours(0, 0, 0, 0);
  const q = new URLSearchParams({ from: from.toISOString(), to: end.toISOString(), ...(fresh ? { fresh: "1" } : {}) });
  const res = await fetch(`${URL_}?${q}`, { headers: { Authorization: `Bearer ${await idToken()}` } });
  const body = await res.json().catch(() => ({}));
  if (res.ok) return { status: "ok", events: body.events || [] };
  return { status: ["not_connected", "needs_reauth"].includes(body.error) ? body.error : "error", events: [] };
}

// Any other stretch of days (the Schedule stepping into last week, or past
// the week ahead): from/to in ms, at most 9 days apart (the function's cap).
// Not cached or shared; the caller keeps what it needs.
export async function fetchRange(from, to){
  if(localGuest()) return { status: "ok", events: guestEvents() };
  const q = new URLSearchParams({ from: new Date(from).toISOString(), to: new Date(to).toISOString() });
  const res = await fetch(`${URL_}?${q}`, { headers: { Authorization: `Bearer ${await idToken()}` } });
  const body = await res.json().catch(() => ({}));
  if (res.ok) return { status: "ok", events: body.events || [] };
  return { status: ["not_connected", "needs_reauth"].includes(body.error) ? body.error : "error", events: [] };
}

function load(fresh = false){
  if (loading && !fresh) return loading; // a tab switch mid-fetch shouldn't start a second one
  loading = fetchAgenda(fresh)
    .then(publish)
    .catch((e) => {
      console.error("[daisey] calendar", e);
      // Offline: keep the last good events rather than forgetting the calendar.
      if (state.status !== "ok") publish({ status: "error", events: [] });
    })
    .finally(() => { loading = null; });
  return loading;
}

function publish(next){
  state = next;
  for (const cb of subs) cb(state);
}

// Which of the user's Google calendars Daisey reads (Settings → Choose
// calendars, 2026-10-07). list: every calendar they can read and which are in
// use; chosen is null until they pick, and Google's own ticks apply till then.
export async function listCalendars(){
  const res = await fetch(`${URL_}?list=1`, { headers: { Authorization: `Bearer ${await idToken()}` } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error || `http ${res.status}`), { code: body.error });
  return body; // { calendars: [{ id, name, color, primary, selected }], chosen: ids | null }
}
// ids: the calendars to read; null goes back to Google's ticks.
export async function saveCalendars(ids){
  const res = await fetch(URL_, { method: "POST", headers: { Authorization: `Bearer ${await idToken()}`, "Content-Type": "application/json" }, body: JSON.stringify({ ids }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error || `http ${res.status}`), { code: body.error });
  await load(true); // the day now shows the new pick
  return body.ids;
}

const onVisible = () => { if (!document.hidden) load(); };

// cb({ status, events }) — status: loading · ok · not_connected · needs_reauth · error.
export function watchCalendar(cb){
  subs.add(cb);
  cb(state);
  if (subs.size === 1) {
    timer = setInterval(() => { if (!document.hidden) load(); }, EVERY);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible); // back from the calendar in another window
    load();
  } else if (state.status !== "loading") {
    load(); // a late subscriber still gets fresh data, not just the last copy
  }
  return () => {
    subs.delete(cb);
    if (subs.size === 0) {
      clearInterval(timer);
      timer = null;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      state = { status: "loading", events: [] }; // next sign-in starts clean
    }
  };
}

// Moving, deleting and creating are the writes Daisey makes
// (daisey-now-calendar-write). Each refetches straight after, so the card and
// the panel show the new day rather than the one the user just changed.
async function write(body){
  if(localGuest()){
    const events = guestEvents();
    const event = events.find((item) => item.id === body.eventId);
    if(body.action === "create"){
      const created = {
        id: globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `guest-event-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        title: body.title,
        start: body.start,
        end: body.end,
        calendarId: "guest-local",
        color: null,
        busy: true,
        editable: true,
        updated: new Date().toISOString(),
      };
      saveGuestEvents([...events, created]);
      return created;
    }
    if(!event) throw Object.assign(new Error("That event no longer exists."), { code: "gone" });
    if(body.action === "delete"){
      saveGuestEvents(events.filter((item) => item.id !== event.id));
      return { status: "deleted" };
    }
    if(body.action === "rename") event.title = body.title;
    if(body.action === "move"){ event.start = body.start; event.end = body.end; event.updated = new Date().toISOString(); }
    saveGuestEvents(events);
    return event;
  }
  const res = await fetch(WRITE_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${await idToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(out.error || `http ${res.status}`), { code: out.error });
  await load(body.calendarId.startsWith("daisey")); // a new Daisey calendar isn't in a cached list yet
  return out;
}

// Both ends at once: a dragged block, or a typed Start and End. The length is
// whatever the two say, so this is how an event is moved AND resized.
export function retime(ev, start, end){
  return write({ action: "move", calendarId: ev.calendarId, eventId: ev.id,
    start: new Date(start).toISOString(), end: new Date(end).toISOString() });
}

export const deleteEvent = (ev) => write({ action: "delete", calendarId: ev.calendarId, eventId: ev.id });

// A routine's set days (routine.js): one weekly event in the "Daisey"
// calendar, from the first of those days on or after today. days: 0 =
// Sunday; at: "HH:MM"; until: "YYYY-MM-DD" or null. Resolves { id }, or
// null for a guest (no Google calendar to write to).
const BYDAY = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
export function createSeries({ title, taskId, days, at, minutes, until }){
  if(localGuest()) return Promise.resolve(null);
  const d = new Date();
  for (let i = 0; i < 7 && !days.includes(d.getDay()); i++) d.setDate(d.getDate() + 1);
  const [hh, mm] = at.split(":").map(Number);
  d.setHours(hh, mm, 0, 0);
  return write({ action: "create", calendarId: "daisey", title, taskId,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    start: d.toISOString(), end: new Date(d.getTime() + minutes * 60000).toISOString(),
    recurrence: { days: days.map((n) => BYDAY[n]), until: until || null } });
}
// The whole weekly event, every day of it. Already gone counts as done.
export const deleteSeries = (id) => (localGuest() ? Promise.resolve()
  : write({ action: "delete", calendarId: "daisey", eventId: id }).catch((e) => { if (e.code !== "gone") throw e; }));

// A new title; times, guests and description stay as they are.
export const renameEvent = (ev, title) => write({ action: "rename", calendarId: ev.calendarId, eventId: ev.id, title });

// A finished task, into the "Daisey log" calendar (made on first use): the
// time actually spent, ending now, marked free so it never blocks a pick.
// A lookback in Google Calendar; the write function has the why.
// `end`: when it really ended, if not now ("Finished earlier").
export function logDone({ title, minutes, taskId, note, end = Date.now() }){
  if(localGuest()) return Promise.resolve({ skipped: true });
  const start = end - minutes * 60000;
  return write({ action: "create", calendarId: "daisey-log", title: `✓ ${title}`, taskId, note,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    start: new Date(start).toISOString(), end: new Date(end).toISOString() });
}

// An event the user typed: a day ("YYYY-MM-DD"), a start ("HH:MM") and a
// length in minutes, read in the browser's own zone. It goes in the main
// Google calendar — the one "primary" means — because that's where a thing
// you're adding by hand belongs, and picking between calendars is a question
// nobody wants asked at the moment they're writing "dentist".
//
// calendarId and taskId are for the undo behind Remove (addevent.js), which
// puts a removed event back where it was rather than in the main calendar.
export function createEvent({ title, date, at, minutes, calendarId = "primary", taskId }){
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = at.split(":").map(Number);
  const start = new Date(y, m - 1, d, hh, mm, 0, 0);
  const end = new Date(start.getTime() + minutes * 60000);
  return write({ action: "create", calendarId, title, ...(taskId ? { taskId } : {}), start: start.toISOString(), end: end.toISOString() });
}
