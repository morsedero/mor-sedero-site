// The morning brief's state and delivery, shared by daisey-now-push (sign-up,
// task snapshots, "Send a test") and daisey-now-morning (the 15-minute
// schedule). One Blobs record per Firebase user, store "daisey-push", key
// u:<uid>:
//   { sub, subs: [{ endpoint, keys }], tz, dayStart, dayEnd,
//     tasks: [{ title, status, due, dateKind, notBefore, size, spentMinutes }],
//     tasksAt, sentOn: "YYYY-MM-DD" }
// The server can't read Firestore (no service account), so the app sends a
// snapshot of its dated tasks whenever they change; the brief is as fresh as
// the last time Daisey was open, which is the night before at the latest on
// a normal day. The calendar is read live, with old Daisey's stored grant.
const { openStore } = require("./blobs");
const { accessForSub, readAgenda } = require("./now-calendar");
const { brief } = require("./brief");
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

// Builds today's brief for one record and sends it to every device on it.
// Returns { sent, subs } — subs without the ones the push service says are gone.
async function deliver(rec, now = Date.now()) {
  let events = null;
  try {
    const { accessToken } = await accessForSub(rec.sub);
    if (accessToken) events = await readAgenda(accessToken, now - 864e5, now + 864e5);
  } catch (e) { console.error("daisey-morning calendar", e.message); }
  const msg = brief({ tasks: rec.tasks || [], events, now, tz: rec.tz || "Asia/Jerusalem",
    dayStart: rec.dayStart ?? 480, dayEnd: rec.dayEnd ?? 1320 });
  const subs = rec.subs || [];
  const results = await Promise.all(subs.map((s) => send(s, { title: msg.title, body: msg.body, tag: `brief-${msg.today}` })
    .catch((e) => { console.error("daisey-morning push", e.message); return { ok: false }; })));
  return { sent: results.filter((r) => r.ok).length, subs: subs.filter((_, i) => !results[i].gone), msg };
}

module.exports = { store, keyFor, load, update, deliver };
