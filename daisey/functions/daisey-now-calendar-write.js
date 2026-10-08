// What Daisey writes to Google Calendar: moving an event, deleting one, or
// creating one the user typed out (Mor, 2026-10-04 — so adding a meeting
// doesn't mean leaving for Google Calendar and coming back).
//
// "create" is a user's own words, written when they press the button. It is
// not the auto-scheduler the spec refuses to be: Daisey still never puts
// anything on the calendar by itself, and still never writes a task there.
//
// Accepting a pencil suggestion (DAISEY_SPEC "Pencil schedule") is the one
// write that starts with Daisey: still only on the user's tap, and always
// into a separate "Daisey" calendar — calendarId "daisey" means that one,
// created on first use — so its blocks are easy to hide or delete. The
// event carries the task's id (extendedProperties.private.daiseyTask).
//
// The other is the log (Mor, 2026-10-05): a task finished with Done is
// written, as the time actually spent on it, into its own "Daisey log"
// calendar (calendarId "daisey-log", created on first use), so Google
// Calendar becomes a lookback of what got done that can be shown or hidden
// with one tick. Log events are marked free, so they never block anything,
// and carry the task's id, so the calendar-task offer (caltask.js) skips
// them. The user can turn it off in the account menu.
//
// A routine's set days (the user picks the days and the time and Daisey
// writes them) are the third: one weekly event in the "Daisey" calendar.
//
// POST { action: "move" | "delete" | "create" | "rename", calendarId, eventId?, start?,
// end?, title?, taskId?, note?, timeZone?, recurrence? } with "Authorization: Bearer <Firebase ID token>". `start`
// and `end` are ISO strings with an offset, and only timed events can move.
//
// Auth is the read endpoint's: the Firebase sign-in's Google `sub` maps to
// old Daisey's stored token (Netlify Blobs), so a user only ever reaches
// their own calendars.
//
// Errors: 401 no_session · 404 not_connected · 409 needs_reauth ·
// 400 bad_request · 403 read_only (a calendar the user can't write to) ·
// 404 gone (the event is already deleted) · 502 google.
const { verifyIdToken } = require("./_daisey-lib/firebase-auth");
const { openStore } = require("./_daisey-lib/blobs");
const { getGoogleAccessToken } = require("./_daisey-lib/tokens");

const DAISY = "🌼";
const API ="https://www.googleapis.com/calendar/v3/calendars";

const reply = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  body: JSON.stringify(body),
});
const fail = (statusCode, code) => reply(statusCode, { error: code });
const isoWithOffset = (v) => typeof v === "string" && !Number.isNaN(Date.parse(v)) && /[+-]\d{2}:\d{2}$|Z$/.test(v);

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return fail(405, "post_only");

  let claims;
  try {
    const token = (event.headers.authorization || event.headers.Authorization || "").replace(/^Bearer\s+/i, "");
    claims = await verifyIdToken(token);
  } catch (e) {
    return fail(401, "no_session");
  }
  const sub = claims.firebase?.identities?.["google.com"]?.[0];
  if (!sub) return fail(404, "not_connected");

  let req;
  try { req = JSON.parse(event.body || "{}"); } catch (e) { return fail(400, "bad_request"); }
  const { action, calendarId, eventId, start, end } = req;
  const title = typeof req.title === "string" ? req.title.trim().replace(/\s+/g, " ").slice(0, 300) : "";
  if (!["move", "delete", "create", "rename"].includes(action)) return fail(400, "bad_request");
  if (!calendarId) return fail(400, "bad_request");
  if (action !== "create" && !eventId) return fail(400, "bad_request");
  if ((action === "create" || action === "rename") && !title) return fail(400, "bad_request");
  if ((action === "create" || action === "move") && !(isoWithOffset(start) && isoWithOffset(end) && Date.parse(end) > Date.parse(start))) {
    return fail(400, "bad_request");
  }

  const userId = await openStore("daisey-users").get(`google-sub:${sub}`, { type: "text" });
  if (!userId) return fail(404, "not_connected");
  const accessToken = await getGoogleAccessToken(userId);
  if (!accessToken) return fail(409, "needs_reauth");

  const log = calendarId === "daisey-log";
  let calId = calendarId;
  if (OWN[calId]) {
    calId = await daiseyCalendar(accessToken, req.timeZone, OWN[calId]);
    if (!calId) return fail(502, "google");
  }
  const hasTask = typeof req.taskId === "string" && req.taskId !== "";
  const note = typeof req.note === "string" ? req.note.slice(0, 500) : "";
  const base = `${API}/${encodeURIComponent(calId)}/events`;
  const url = action === "create" ? base : `${base}/${encodeURIComponent(eventId)}`;
  const headers = { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" };
  // A routine's set days (app/js/routine.js, Mor 2026-10-08): one weekly
  // event, recurrence { days: ["MO", "TH"], until: "YYYY-MM-DD" | null },
  // into the "Daisey" calendar. Google needs the zone to repeat it at the
  // same local time across a clock change.
  const BYDAY = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
  const rec = action === "create" && req.recurrence && typeof req.recurrence === "object" ? req.recurrence : null;
  const recDays = rec && Array.isArray(rec.days) ? [...new Set(rec.days.filter((d) => BYDAY.includes(d)))] : [];
  if (rec && (!recDays.length || calendarId !== "daisey")) return fail(400, "bad_request");
  const recUntil = rec && typeof rec.until === "string" && /^\d{4}-\d{2}-\d{2}$/.test(rec.until) ? `;UNTIL=${rec.until.replace(/-/g, "")}T235959Z` : "";
  const zone = typeof req.timeZone === "string" && /^[A-Za-z_]+\/[A-Za-z_\/+-]+$/.test(req.timeZone) ? req.timeZone : "Asia/Jerusalem";
  const times = rec ? { start: { dateTime: start, timeZone: zone }, end: { dateTime: end, timeZone: zone } }
    : { start: { dateTime: start }, end: { dateTime: end } };
  const res = action === "delete" ? await fetch(url, { method: "DELETE", headers })
    : action === "create" ? await fetch(url, { method: "POST", headers, body: JSON.stringify({
      // A task's event wears a daisy and Banana yellow (colorId 5), so it reads
      // as Daisey's at a glance. Events the user typed (no taskId) stay plain.
      summary: hasTask ? `${DAISY} ${title}` : title, ...times,
      ...(rec ? { recurrence: [`RRULE:FREQ=WEEKLY;BYDAY=${recDays.join(",")}${recUntil}`] } : {}),
      ...(hasTask ? { colorId: "5" } : {}),
      ...(log ? { transparency: "transparent" } : {}),
      ...(hasTask ? { description: log ? note || "Done with Daisey." : "Planned with Daisey.",
        extendedProperties: { private: { daiseyTask: req.taskId.slice(0, 100), ...(log ? { daiseyLog: "1" } : {}) } } } : {}) }) })
    // PATCH, so nothing but the times (or the title) is touched — guests,
    // description and colour stay exactly as the user left them.
    : await fetch(url, { method: "PATCH", headers, body: JSON.stringify(action === "rename" ? { summary: title } : times) });

  if (res.status === 401) return fail(409, "needs_reauth");
  if (res.status === 403) return fail(403, "read_only");
  if (res.status === 404 || res.status === 410) return fail(404, "gone");
  if (!res.ok) { console.error("daisey-now-calendar-write", action, res.status, await res.text()); return fail(502, "google"); }

  // 204 on delete; the event itself on move and create. Only a created
  // event's id goes back (a routine keeps its weekly event's, to change or
  // delete it later); the client refetches the agenda so every view agrees.
  if (action === "create") { const made = await res.json().catch(() => ({})); return reply(200, { ok: true, id: made.id || null }); }
  return reply(200, { ok: true });
};

// The calendars Daisey makes for itself, by the calendarId the client sends.
const OWN = {
  daisey: { summary: "Daisey", description: "Blocks you accepted from Daisey's pencil schedule." },
  "daisey-log": { summary: "Daisey log", description: "Tasks you finished with Daisey, at the time you actually spent on them." },
};

// One of the user's own Daisey calendars: found by name among the calendars
// they own, or created. Returns its id, or null if Google refused.
async function daiseyCalendar(accessToken, timeZone, { summary, description }){
  const headers = { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" };
  const list = await fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=owner&maxResults=250", { headers });
  if (list.ok) {
    const { items = [] } = await list.json();
    const found = items.find((c) => c.summary === summary && !c.deleted);
    if (found) return found.id;
  }
  const tz = typeof timeZone === "string" && /^[A-Za-z_]+\/[A-Za-z_\/+-]+$/.test(timeZone) ? timeZone : "Asia/Jerusalem";
  const made = await fetch(API, { method: "POST", headers, body: JSON.stringify({ summary, description, timeZone: tz }) });
  if (!made.ok) { console.error("daisey-now-calendar-write", "make calendar", made.status, await made.text()); return null; }
  return (await made.json()).id;
}
