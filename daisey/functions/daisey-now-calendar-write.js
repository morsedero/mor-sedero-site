// The only thing Daisey writes to Google Calendar: moving an event, or
// deleting one. Both are reactions to a day that changed — the spec keeps
// Daisey out of auto-scheduling, so there is deliberately no "create".
//
// POST { action: "move" | "delete", calendarId, eventId, start?, end? }
// with "Authorization: Bearer <Firebase ID token>". `start` and `end` are
// ISO strings with an offset, and only timed events can move.
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

const API = "https://www.googleapis.com/calendar/v3/calendars";

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
  if (!calendarId || !eventId) return fail(400, "bad_request");
  if (action === "move" && !(isoWithOffset(start) && isoWithOffset(end) && Date.parse(end) > Date.parse(start))) {
    return fail(400, "bad_request");
  }
  if (!["move", "delete"].includes(action)) return fail(400, "bad_request");

  const userId = await openStore("daisey-users").get(`google-sub:${sub}`, { type: "text" });
  if (!userId) return fail(404, "not_connected");
  const accessToken = await getGoogleAccessToken(userId);
  if (!accessToken) return fail(409, "needs_reauth");

  const url = `${API}/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`;
  const headers = { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" };
  const res = action === "delete"
    ? await fetch(url, { method: "DELETE", headers })
    // PATCH, so nothing but the times is touched — guests, description and
    // colour stay exactly as the user left them.
    : await fetch(url, { method: "PATCH", headers, body: JSON.stringify({ start: { dateTime: start }, end: { dateTime: end } }) });

  if (res.status === 401) return fail(409, "needs_reauth");
  if (res.status === 403) return fail(403, "read_only");
  if (res.status === 404 || res.status === 410) return fail(404, "gone");
  if (!res.ok) { console.error("daisey-now-calendar-write", action, res.status, await res.text()); return fail(502, "google"); }

  // 204 on delete; the patched event on move, which the client doesn't need —
  // it refetches the whole agenda so every view agrees.
  return reply(200, { ok: true });
};
