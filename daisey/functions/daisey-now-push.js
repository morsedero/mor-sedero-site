// The morning brief's endpoint (2026-10-06). GET → { configured, publicKey }
// for the browser to subscribe with. POST with "Authorization: Bearer
// <Firebase ID token>" and { action, … }:
//   subscribe    { subscription, tz, dayStart, dayEnd } — this device gets it
//   unsubscribe  { endpoint } — this device stops
//   snapshot     { tasks, tz, dayStart, dayEnd } — what the brief counts
//   test         sends today's brief now, to every device signed up
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

// Only the fields the brief reads, cleaned.
const cleanTask = (t) => ({
  title: str(t?.title, 200) || "Untitled", status: str(t?.status, 20), due: day(t?.due), dateKind: t?.dateKind === "deadline" ? "deadline" : "target",
  notBefore: day(t?.notBefore), size: Number(t?.size) || 30, spentMinutes: Number(t?.spentMinutes) || 0,
});
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
    await update(uid, () => ({ sub, tasks, tasksAt: Date.now(), ...where(b) }));
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
    const { sent, subs, msg } = await deliver(rec);
    await update(uid, () => ({ subs }));
    return reply(200, { sent, body: msg.body });
  }
  return fail(400, "bad_input");
};
