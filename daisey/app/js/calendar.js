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

const subs = new Set();
let state = { status: "loading", events: [] };
let timer = null, loading = null;

async function fetchAgenda(){
  // From the start of today, so the panel can show what already happened, to
  // the end of the seventh day ahead — as far as the panel can step.
  const from = new Date(); from.setHours(0, 0, 0, 0);
  const end = new Date(); end.setDate(end.getDate() + 8); end.setHours(0, 0, 0, 0);
  const q = new URLSearchParams({ from: from.toISOString(), to: end.toISOString() });
  const res = await fetch(`${URL_}?${q}`, { headers: { Authorization: `Bearer ${await idToken()}` } });
  const body = await res.json().catch(() => ({}));
  if (res.ok) return { status: "ok", events: body.events || [] };
  return { status: ["not_connected", "needs_reauth"].includes(body.error) ? body.error : "error", events: [] };
}

function load(){
  if (loading) return loading; // a tab switch mid-fetch shouldn't start a second one
  loading = fetchAgenda()
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

// Moving and deleting are the only writes Daisey makes (daisey-now-calendar-write).
// Both refetch straight after, so the card and the panel show the new day
// rather than the one the user just changed.
async function write(body){
  const res = await fetch(WRITE_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${await idToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(out.error || `http ${res.status}`), { code: out.error });
  await load();
  return out;
}

// Keeps the length; only the start moves.
export function moveEvent(ev, minutes){
  const start = new Date(Date.parse(ev.start) + minutes * 60000);
  const end = new Date(Date.parse(ev.end) + minutes * 60000);
  return write({ action: "move", calendarId: ev.calendarId, eventId: ev.id, start: start.toISOString(), end: end.toISOString() });
}

// `at` is "HH:MM" on the event's own day; the length is kept.
export function moveEventTo(ev, at){
  const [hh, mm] = at.split(":").map(Number);
  const start = new Date(Date.parse(ev.start));
  start.setHours(hh, mm, 0, 0);
  const end = new Date(start.getTime() + (Date.parse(ev.end) - Date.parse(ev.start)));
  return write({ action: "move", calendarId: ev.calendarId, eventId: ev.id, start: start.toISOString(), end: end.toISOString() });
}

export const deleteEvent = (ev) => write({ action: "delete", calendarId: ev.calendarId, eventId: ev.id });
