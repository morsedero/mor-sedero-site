// Daisey's notifications endpoint (2026-10-06). GET → { configured, publicKey }
// for the browser to subscribe with. POST with "Authorization: Bearer
// <Firebase ID token>" and { action, … }:
//   subscribe    { subscription, tz, dayStart, dayEnd } — this device gets it
//   unsubscribe  { endpoint } — this device stops
//   snapshot     { tasks, settings, notify, run, plan, tz, dayStart, dayEnd } —
//                what the notifications count, which kinds are on, the
//                running task (app/js/reality.js: it beats the calendar) and
//                today's approved plan ({ date, at, ids }: app/js/miss.js),
//                and the saved plan of any status for the brief (dayplan)
//   seen         Daisey is on screen now: a missed slot is asked in the app,
//                not as a notification (notify.js "miss")
//   test         sends today's brief now, to every device signed up; returns
//                { sent, body, cal } so the menu can show what went
// State lives in Blobs (_daisey-lib/morning.js); daisey-now-morning sends.
//
// Errors: 401 no_session · 400 bad_input · 503 not_configured (VAPID keys
// not in Netlify's environment yet).
const { verifyIdToken } = require("./_daisey-lib/firebase-auth");
const { configured, vapidKeys } = require("./_daisey-lib/webpush");
const { load, update, deliver } = require("./_daisey-lib/morning");

const MAX_TASKS = 300;
const MAX_SUBS = 5; // phones and laptops, within reason

const reply = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  body: JSON.stringify(body),
});
const fail = (statusCode, code) => reply(statusCode, { error: code });

const str = (v, n = 300) => (typeof v === "string" ? v.slice(0, n) : null);
const day = (v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const mins = (v, dflt) => (Number.isInteger(v) && v >= 0 && v < 1440 ? v : dflt);
const validTz = (tz) => { try { new Intl.DateTimeFormat("en", { timeZone: tz }); return tz; } catch { return null; } };

// Only the fields the engine, the brief, the wrap and the people alert read,
// cleaned. No notes, links or steps. (waitingOn since 2026-10-06: the
// "before a meeting" alert names who a task waits on.)
const TEXT = ["id", "title", "project", "area", "type", "where", "openHours", "stakes", "status", "dateKind", "waitingOn", "again"];
const DAYS = ["due", "notBefore", "checkOn"];
const NUMS = ["size", "spentMinutes", "starts", "skipsSinceStart", "skipCount", "pushes", "createdAt", "touchedAt", "workedAt", "doneAt"];
const cleanTask = (t) => {
  const o = {};
  for (const k of TEXT) { const v = str(t?.[k], k === "title" || k === "project" ? 200 : 40); if (v != null) o[k] = v; }
  for (const k of DAYS) o[k] = day(t?.[k]);
  for (const k of NUMS) if (Number.isFinite(t?.[k])) o[k] = t[k];
  o.dueTime = typeof t?.dueTime === "string" && /^\d{2}:\d{2}$/.test(t.dueTime) ? t.dueTime : null;
  o.canSplit = !!t?.canSplit;
  // Places this task was said not to suit ("Not here" on a skip): the engine hides it there.
  if (Array.isArray(t?.notAt)) o.notAt = t.notAt.slice(0, 5).map((k) => str(k, 20)).filter(Boolean);
  // A routine (app/js/routine.js): how often, till when, and the last
  // sessions' days — enough for the engine to know how the week stands.
  if (t?.routine && Number(t.routine.per) >= 1) o.routine = { per: Math.min(7, Math.round(Number(t.routine.per))), until: day(t.routine.until),
    log: (Array.isArray(t.routine.log) ? t.routine.log.slice(-14) : []).map((e) => ({ day: day(e?.day) })).filter((e) => e.day),
    skipped: (Array.isArray(t.routine.skipped) ? t.routine.skipped.slice(-14) : []).map((x) => str(x, 200)).filter(Boolean) };
  o.title ||= "Untitled";
  return o;
};
// Needs you's own memory (what was answered or put off), for its count.
const cleanSettings = (s) => ({
  needsLater: s?.needsLater && typeof s.needsLater === "object" ? { date: day(s.needsLater.date), keys: (s.needsLater.keys || []).slice(0, 100).map((k) => str(k, 120)) } : null,
  calOffered: Array.isArray(s?.calOffered) ? s.calOffered.slice(-200).map((k) => str(k, 200)) : [],
  somedayAsked: day(s?.somedayAsked),
  silenceOn: day(s?.silenceOn), // the silence check answered that day (miss.js)
});
// The running task (state/now), or null: ids and times only.
const at = (v) => (Number.isFinite(v) && v > 0 ? v : null);
const ids = (v) => (Array.isArray(v) ? v.slice(0, 20).map((x) => str(x, 40)).filter(Boolean) : null);
const cleanRun = (r) => {
  const taskId = str(r?.taskId, 40), startedAt = at(r?.startedAt);
  if (!taskId || !startedAt) return null;
  const o = { taskId, startedAt, extra: Number.isFinite(r.extra) ? Math.max(0, Math.min(r.extra, 1440)) : 0 };
  if (at(r.pausedAt)) o.pausedAt = r.pausedAt;
  if (ids(r.batch)) { o.batch = ids(r.batch); o.done = ids(r.done) || []; }
  return o;
};
const KINDS = ["brief", "wrap", "gap", "booked", "people", "meeting", "miss"];
// Today's approved plan: its day, when it was saved, its tasks in order.
const cleanPlan = (p) => (day(p?.date) ? { date: p.date, at: at(p.at) || 0, ids: ids(p.ids) || [] } : null);
// The saved plan, any status, as the brief reads it: { date, status, items:
// [{ taskId, minutes } | { brk, minutes }] }.
const PLAN_STATUS = ["proposed", "approved", "dismissed"], BRKS = ["short", "long", "lunch"];
const planMins = (v) => (Number.isFinite(v) && v > 0 ? Math.min(Math.round(v), 1440) : undefined);
const cleanDayPlan = (p) => (day(p?.date) && PLAN_STATUS.includes(p.status) ? {
  date: p.date, status: p.status,
  items: (Array.isArray(p.items) ? p.items : []).slice(0, 30).map((it) => (BRKS.includes(it?.brk)
    ? { brk: it.brk, minutes: planMins(it.minutes) } : { taskId: str(it?.taskId, 40), minutes: planMins(it?.minutes) }))
    .filter((it) => it.brk || it.taskId),
} : null);
const cleanNotify =(n) => Object.fromEntries(KINDS.map((k) => [k, n?.[k] !== false]));
// Minutes before a meeting its reminder goes (the menu offers 5–30).
const cleanLead = (v) => (Number.isInteger(v) && v >= 5 && v <= 60 ? v : 10);
const where = (b) => ({
  ...(validTz(b.tz) ? { tz: b.tz } : {}),
  ...(Number.isInteger(b.dayStart) ? { dayStart: mins(b.dayStart, 480) } : {}),
  ...(Number.isInteger(b.dayEnd) ? { dayEnd: mins(b.dayEnd, 1320) } : {}),
});

exports.handler = async (event) => {
  if (event.httpMethod === "GET") return reply(200, { configured: configured(), publicKey: vapidKeys().publicKey || null });
  if (event.httpMethod !== "POST") return fail(405, "get_or_post");

  let claims;
  try {
    const token = (event.headers.authorization || event.headers.Authorization || "").replace(/^Bearer\s+/i, "");
    claims = await verifyIdToken(token);
  } catch (e) {
    return fail(401, "no_session");
  }
  const uid = claims.user_id || claims.sub;
  const sub = claims.firebase?.identities?.["google.com"]?.[0] || null;

  let b;
  try { b = JSON.parse(event.body || "{}"); } catch { return fail(400, "bad_input"); }

  if (b.action === "snapshot") {
    if (!Array.isArray(b.tasks)) return fail(400, "bad_input");
    const tasks = b.tasks.slice(0, MAX_TASKS).map(cleanTask);
    await update(uid, () => ({ sub, tasks, tasksAt: Date.now(), settings: cleanSettings(b.settings), notify: cleanNotify(b.notify),
      meetingLead: cleanLead(b.meetingLead), run: cleanRun(b.run), plan: cleanPlan(b.plan), dayplan: cleanDayPlan(b.dayplan), ...where(b) }));
    return reply(200, { ok: true });
  }
  if (b.action === "seen") {
    await update(uid, () => ({ seenAt: Date.now() }));
    return reply(200, { ok: true });
  }
  if (b.action === "unsubscribe") {
    const endpoint = str(b.endpoint, 2000);
    await update(uid, (rec) => ({ subs: (rec.subs || []).filter((s) => s.endpoint !== endpoint) }));
    return reply(200, { ok: true });
  }

  if (!configured()) return fail(503, "not_configured");

  if (b.action === "subscribe") {
    const s = b.subscription || {};
    const endpoint = str(s.endpoint, 2000), p256dh = str(s.keys?.p256dh, 200), auth = str(s.keys?.auth, 100);
    if (!endpoint || !/^https:\/\//.test(endpoint) || !p256dh || !auth) return fail(400, "bad_input");
    await update(uid, (rec) => ({
      sub,
      subs: [...(rec.subs || []).filter((x) => x.endpoint !== endpoint), { endpoint, keys: { p256dh, auth } }].slice(-MAX_SUBS),
      ...where(b),
    }));
    return reply(200, { ok: true });
  }
  if (b.action === "test") {
    const rec = await load(uid);
    if (!(rec.subs || []).length) return fail(400, "no_devices");
    const { sent, subs, msg, cal } = await deliver(rec);
    await update(uid, () => ({ subs, cal }));
    return reply(200, { sent, body: msg.body, cal: cal.ok ? "ok" : cal.error });
  }
  return fail(400, "bad_input");
};
