// Reality over plan (2026-10-06): a running task and real work beat the
// calendar, on the Now card (reality.js) and in the notifications
// (notify.js). Run: node --test "daisey/test/v1/*.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
process.env.TZ = "Asia/Jerusalem";
const R = await import("../../app/js/reality.js");
const N = require("../../functions/_daisey-lib/notify.js");

const at = (h, m = 0) => Date.UTC(2026, 9, 6, h - 3, m); // Israel wall clock, 6 Oct
const il = (h, m = 0) => new Date(at(h, m)).toISOString();
const t = (o) => ({ id: String(Math.random()), title: "Task", status: "ready", due: "2026-10-06", dateKind: "target", size: 30, spentMinutes: 0, ...o });
const rec = (o = {}) => ({ tz: "Asia/Jerusalem", dayStart: 480, dayEnd: 1320, subs: [{}], tasks: [], notify: { miss: false }, ...o }); // miss.test.mjs covers "miss"
const types = (out) => out.map((m) => m.type);

test("overruled: work during an event beats the event; the future is never overruled", () => {
  const meet = { id: "m", title: "Meeting", start: il(14), end: il(15), busy: true };
  const later = { id: "l", title: "Dinner", start: il(19), end: il(20), busy: true };
  const now = at(14, 30);
  assert.equal(R.overruled([meet, later], { tasks: [t({ workedAt: at(13) })], now }).size, 0); // worked before it
  const worked = R.overruled([meet, later], { tasks: [t({ workedAt: at(14, 10) })], now });
  assert.deepEqual([...worked], [R.eventKey(meet)]);
  assert.equal(R.overruled([{ ...meet, busy: false }], { tasks: [t({ workedAt: at(14, 10) })], now }).size, 0);
  // An event added after the work (2026-10-08): the newer statement wins.
  const added = { ...meet, updated: il(14, 20) };
  assert.equal(R.overruled([added], { tasks: [t({ workedAt: at(14, 10) })], now }).size, 0);
  assert.equal(R.overruled([added], { tasks: [t({ id: "a", size: 60, workedAt: at(13, 50) })], now }).size, 0);
  assert.equal(R.overruled([added], { tasks: [t({ workedAt: at(14, 25) })], now }).size, 1); // worked after adding it
});

test("decide: a people alert comes only close to the meeting", () => {
  const r = rec({ sentOn: "2026-10-06", tasks: [t({ id: "a", size: 120 }), t({ id: "c", title: "Pre-attack cue", status: "waiting", waitingOn: "Yuval" })] });
  const ev = { id: "m1", title: "Coffee with Yuval", start: il(14), end: il(15), busy: true };
  assert.equal(N.decide(r, [ev], at(13, 10)).out.length, 0);
  assert.deepEqual(types(N.decide(r, [ev], at(13, 47)).out), ["people"]);
  // Inside the meeting reminder's lead too: one notification carrying both.
  const both = N.decide(r, [ev], at(13, 50));
  assert.deepEqual(types(both.out), ["meeting"]);
  assert.equal(both.out[0].body, "Starts at 14:00, in 10 min. You're waiting on Yuval for: Pre-attack cue.");
  assert.ok(both.patch.peopleSent.length && both.patch.meetingSent.length);
});

test("decide: an event you worked through holds nothing back and isn't announced as over", () => {
  const meet = { id: "m", title: "Meeting", start: il(8), end: il(10), busy: true };
  const worked = [t({ title: "Lesson prep", workedAt: at(8, 20) })];
  // The brief waits for an event, unless you were plainly not in it.
  assert.deepEqual(types(N.decide(rec({ tasks: [t({})] }), [meet], at(8, 30)).out), []);
  assert.ok(types(N.decide(rec({ tasks: worked }), [meet], at(8, 30)).out).includes("brief"));
  // Its end isn't a gap.
  assert.deepEqual(types(N.decide(rec({ sentOn: "2026-10-06", tasks: [...worked, t({ title: "Invoice", size: 15 })] }), [meet], at(10, 5)).out), []);
});
