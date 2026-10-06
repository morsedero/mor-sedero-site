// Daisey's notifications: state and delivery, shared by daisey-now-push
// (sign-up, task snapshots, "Send the brief now") and daisey-now-morning (the
// 5-minute schedule; what to send is notify.js). One Blobs record per
// Firebase user, store "daisey-push", key u:<uid>:
//   { sub, subs: [{ endpoint, keys }], tz, dayStart, dayEnd,
//     tasks: [snapshot], tasksAt, settings: { needsLater, calOffered,
//     somedayAsked }, notify: { brief, wrap, gap, booked },
//     sentOn, wrapOn, gapFor, bookedSent,      ← what was already sent
//     cal: { ok, error, at }, log: [{ type, at, body }] }   ← diagnostics
// The server can't read Firestore (no service account), so the app sends a
// snapshot of its open tasks whenever they change; a notification is as
// fresh as the last time Daisey was open. The calendar is read live, with
// old Daisey's stored grant.
const { openStore } = require("./blobs");
const { accessForSub, readAgenda } = require("./now-calendar");
const { brief } = require("../../app/js/brief.js");
const { collectNeeds } = require("../../app/js/needs-list.js");
const { send } = require("./webpush");

const STORE = "daisey-push";
const keyFor = (uid) => `u:${uid}`;
const store = () => openStore(STORE);

async function load(uid) {
  return (await store().get(keyFor(uid), { type: "json" })) || {};
}
// Read, change, write: a snapshot and a send landing together keep both.
async function update(uid, change) {
  const rec = await load(uid);
  const next = { ...rec, ...change(rec) };
  await store().setJSON(keyFor(uid), next);
  return next;
}

// The agenda from yesterday to tomorrow, and how the read went.
async function readEvents(rec, now = Date.now()) {
  try {
    const { accessToken, error } = await accessForSub(rec.sub);
    if (!accessToken) return { events: null, cal: { ok: false, error, at: now } };
    return { events: await readAgenda(accessToken, now - 864e5, now + 864e5), cal: { ok: true, at: now } };
  } catch (e) {
    return { events: null, cal: { ok: false, error: e.reauth ? "needs_reauth" : String(e.message).slice(0, 120), at: now } };
  }
}

// One message to every device. Returns { sent, subs } — subs without the
// ones the push service says are gone.
// opts.ttl: seconds the push service may hold it for a phone that's off.
async function sendAll(rec, message, { ttl } = {}) {
  const subs = rec.subs || [];
  const results = await Promise.all(subs.map((s) => send(s, message, ttl ? { ttl } : {})
    .catch((e) => { console.error("daisey push", e.message); return { ok: false }; })));
  return { sent: results.filter((r) => r.ok).length, subs: subs.filter((_, i) => !results[i].gone) };
}

const logged = (rec, msgs, now) => [...(rec.log || []), ...msgs.map((m) => ({ type: m.type, at: now, body: m.body }))].slice(-20);

// "Send the brief now": today's brief as it stands, whatever the hour.
async function deliver(rec, now = Date.now()) {
  if (rec.tz) process.env.TZ = rec.tz;
  const { events, cal } = await readEvents(rec, now);
  const needs = collectNeeds({ tasks: rec.tasks || [], events: events || [], calOk: !!events, settings: rec.settings || {}, now }).length;
  const msg = brief({ tasks: rec.tasks || [], events, now, tz: rec.tz || "Asia/Jerusalem",
    dayStart: rec.dayStart ?? 480, dayEnd: rec.dayEnd ?? 1320, needs });
  const { sent, subs } = await sendAll(rec, { title: msg.title, body: msg.body, tag: `brief-${msg.today}`, url: "./" });
  return { sent, subs, msg, cal };
}

module.exports = { store, keyFor, load, update, readEvents, sendAll, deliver, logged };
