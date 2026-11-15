// Daisey PC tracker (2026-11-15). The Windows tray app (github.com/morsedero/Daisey-Tracker)
// sends a summary of the day's app use here; Daisey's Activity screen reads it back.
// POST { action, … }:
//
//   From the tray app, no sign-in:
//     start    { device }  → { req }      a link request; the app opens
//                                          morsedero.com/daisey/now/?tracker=<req>
//     poll     { req }     → { status: "pending" | "approved" | "gone", token? }
//                                          the token is handed over once, then the request is gone
//   From the tray app, "Authorization: Bearer dtk_…" (its device token):
//     upload   { day, icons? } → { ok }  one PC's summary for one day; icons only when they changed
//
//   From Daisey, "Authorization: Bearer <Firebase ID token>":
//     info     { req }     → { device }   name shown on the Approve screen
//     approve  { req }     → { ok }
//     read     { dates }   → { days: { date: [summary per PC] }, icons, devices }
//     disconnect { deviceId? } → { ok }   one PC, or all of them; drops the data too
//
// Nothing here is a window title: the tray app sends app names, project names
// and site names it guessed, and minutes. Errors: 400 bad_input · 401 no_session /
// bad_device · 404 gone · 405 post_only.
const crypto = require("crypto");
const { openStore } = require("./_daisey-lib/blobs");
const { verifyIdToken } = require("./_daisey-lib/firebase-auth");

const STORE = "daisey-tracker";
const PENDING_MS = 15 * 60 * 1000; // a link request lives 15 min
const MAX_BODY = 600 * 1024;
const MAX_DATES = 14;

const reply = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  body: JSON.stringify(body),
});
const fail = (statusCode, code) => reply(statusCode, { error: code });

const store = () => openStore(STORE);
const rand = (n) => crypto.randomBytes(n).toString("base64url");
const hash = (s) => crypto.createHash("sha256").update(s).digest("hex");
const isDay = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isReq = (v) => typeof v === "string" && /^[A-Za-z0-9_-]{20,64}$/.test(v);
const name = (v) => (typeof v === "string" ? v.replace(/[^\w .-]/g, "").trim().slice(0, 40) : "") || "PC";
const bearer = (event) => (event.headers.authorization || event.headers.Authorization || "").replace(/^Bearer\s+/i, "");

const K = {
  pending: (req) => `pending:${req}`,
  token: (h) => `token:${h}`,
  devices: (uid) => `user:${uid}:devices`,
  icons: (uid) => `user:${uid}:icons`,
  day: (uid, date, id) => `user:${uid}:day:${date}:${id}`,
  dayPrefix: (uid, date) => `user:${uid}:day:${date}:`,
  userPrefix: (uid) => `user:${uid}:`,
};

// Only the fields the Activity screen draws, checked and capped.
const num = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : 0);
const str = (v, n = 120) => (typeof v === "string" ? v.slice(0, n) : null);
const minutesMap = (o, cap = 300) => {
  const out = {};
  if (o && typeof o === "object") for (const [k, v] of Object.entries(o).slice(0, cap)) if (str(k)) out[str(k)] = num(v);
  return out;
};
function cleanDay(d) {
  if (!d || typeof d !== "object" || !isDay(d.date)) return null;
  const detail = {};
  if (d.detailMinutes && typeof d.detailMinutes === "object")
    for (const [app, m] of Object.entries(d.detailMinutes).slice(0, 300)) if (str(app)) detail[str(app)] = minutesMap(m, 6);
  const timeline = (Array.isArray(d.timeline) ? d.timeline : []).slice(0, 3000)
    .filter((r) => Array.isArray(r) && Number.isInteger(r[0]) && Number.isInteger(r[1]) && r[1] > r[0] && r[0] >= 0 && r[1] <= 1500 && str(r[2]))
    .map((r) => [r[0], r[1], str(r[2]), str(r[3])]);
  return {
    date: d.date,
    dayStartMinute: Number.isInteger(d.dayStartMinute) ? d.dayStartMinute : 360,
    activeMinutes: num(d.activeMinutes),
    appMinutes: minutesMap(d.appMinutes),
    siteMinutes: minutesMap(d.siteMinutes),
    detailMinutes: detail,
    timeline,
    hourlyMinutes: (Array.isArray(d.hourlyMinutes) ? d.hourlyMinutes : []).slice(0, 24).map(num),
  };
}
// Icons are small PNG data URIs of exe icons.
function cleanIcons(o) {
  const out = {};
  if (o && typeof o === "object")
    for (const [k, v] of Object.entries(o).slice(0, 300))
      if (str(k) && typeof v === "string" && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(v) && v.length < 40000) out[str(k)] = v;
  return out;
}

async function signedIn(event) {
  try {
    const c = await verifyIdToken(bearer(event));
    return c.user_id || c.sub || null;
  } catch { return null; }
}

async function dropDevice(s, uid, id) {
  const devices = (await s.get(K.devices(uid), { type: "json" })) || {};
  const d = devices[id];
  if (d?.tokenHash) await s.delete(K.token(d.tokenHash));
  delete devices[id];
  await s.setJSON(K.devices(uid), devices);
  const { blobs } = await s.list({ prefix: K.userPrefix(uid) });
  await Promise.all(blobs.filter((b) => b.key.startsWith(`user:${uid}:day:`) && b.key.endsWith(`:${id}`)).map((b) => s.delete(b.key)));
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return fail(405, "post_only");
  if ((event.body || "").length > MAX_BODY) return fail(400, "bad_input");
  let b;
  try { b = JSON.parse(event.body || "{}"); } catch { return fail(400, "bad_input"); }
  const s = store();

  // ---- tray app, before it has a token ----
  if (b.action === "start") {
    const req = rand(24);
    await s.setJSON(K.pending(req), { device: name(b.device), at: Date.now(), status: "pending" });
    return reply(200, { req });
  }
  if (b.action === "poll") {
    if (!isReq(b.req)) return fail(400, "bad_input");
    const p = await s.get(K.pending(b.req), { type: "json" });
    if (!p || Date.now() - p.at > PENDING_MS) { if (p) await s.delete(K.pending(b.req)); return reply(200, { status: "gone" }); }
    if (p.status !== "approved") return reply(200, { status: "pending" });
    await s.delete(K.pending(b.req)); // handed over once
    return reply(200, { status: "approved", token: p.token });
  }

  // ---- tray app with its device token ----
  if (b.action === "upload") {
    const tok = bearer(event);
    if (!tok.startsWith("dtk_")) return fail(401, "bad_device");
    const link = await s.get(K.token(hash(tok)), { type: "json" });
    if (!link) return fail(401, "bad_device");
    const day = cleanDay(b.day);
    if (!day) return fail(400, "bad_input");
    day.device = link.device;
    day.updatedAt = Date.now();
    await s.setJSON(K.day(link.uid, day.date, link.deviceId), day);
    if (b.icons) {
      const icons = { ...((await s.get(K.icons(link.uid), { type: "json" })) || {}), ...cleanIcons(b.icons) };
      await s.setJSON(K.icons(link.uid), icons);
    }
    // Last seen, at most once every 10 min (one write per upload is enough already).
    if (!link.seen || Date.now() - link.seen > 10 * 60 * 1000) {
      const devices = (await s.get(K.devices(link.uid), { type: "json" })) || {};
      if (devices[link.deviceId]) { devices[link.deviceId].seen = Date.now(); await s.setJSON(K.devices(link.uid), devices); }
      await s.setJSON(K.token(hash(tok)), { ...link, seen: Date.now() });
    }
    return reply(200, { ok: true });
  }

  // ---- Daisey, signed in ----
  const uid = await signedIn(event);
  if (!uid) return fail(401, "no_session");

  if (b.action === "info" || b.action === "approve") {
    if (!isReq(b.req)) return fail(400, "bad_input");
    const p = await s.get(K.pending(b.req), { type: "json" });
    if (!p || p.status !== "pending" || Date.now() - p.at > PENDING_MS) return fail(404, "gone");
    if (b.action === "info") return reply(200, { device: p.device });
    const token = "dtk_" + rand(32), deviceId = rand(9);
    await s.setJSON(K.token(hash(token)), { uid, deviceId, device: p.device, at: Date.now() });
    const devices = (await s.get(K.devices(uid), { type: "json" })) || {};
    devices[deviceId] = { name: p.device, at: Date.now(), tokenHash: hash(token) };
    await s.setJSON(K.devices(uid), devices);
    await s.setJSON(K.pending(b.req), { ...p, status: "approved", token });
    return reply(200, { ok: true, device: p.device });
  }

  if (b.action === "read") {
    const dates = (Array.isArray(b.dates) ? b.dates : []).filter(isDay).slice(0, MAX_DATES);
    const days = {};
    await Promise.all(dates.map(async (d) => {
      const { blobs } = await s.list({ prefix: K.dayPrefix(uid, d) });
      days[d] = (await Promise.all(blobs.map((x) => s.get(x.key, { type: "json" })))).filter(Boolean);
    }));
    const devices = Object.entries((await s.get(K.devices(uid), { type: "json" })) || {})
      .map(([id, d]) => ({ id, name: d.name, at: d.at, seen: d.seen || null }));
    const icons = b.icons === false ? undefined : (await s.get(K.icons(uid), { type: "json" })) || {};
    return reply(200, { days, icons, devices });
  }

  if (b.action === "disconnect") {
    if (typeof b.deviceId === "string") { await dropDevice(s, uid, b.deviceId); return reply(200, { ok: true }); }
    const devices = (await s.get(K.devices(uid), { type: "json" })) || {};
    await Promise.all(Object.values(devices).map((d) => d.tokenHash && s.delete(K.token(d.tokenHash))));
    const { blobs } = await s.list({ prefix: K.userPrefix(uid) });
    await Promise.all(blobs.map((x) => s.delete(x.key)));
    return reply(200, { ok: true });
  }

  return fail(400, "bad_input");
};
