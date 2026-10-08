// Missed slots and the silence check (2026-10-08): one ladder, shared by the
// Now card's banner (miss.js) and the notification (notify.js "miss").
// Run: node --test "daisey/test/v1/*.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
process.env.TZ = "Asia/Jerusalem";
const M = await import("../../app/js/miss.js");
const P = await import("../../app/js/proposal.js");
const N = require("../../functions/_daisey-lib/notify.js");

const at = (h, m = 0) => Date.UTC(2026, 9, 6, h - 3, m); // Israel wall clock, 6 Oct
const il = (h, m = 0) => new Date(at(h, m)).toISOString();
const t = (o) => ({ id: String(Math.random()), title: "Task", status: "ready", due: "2026-10-06", dateKind: "target", size: 30, spentMinutes: 0, ...o });
const hours = { start: 480, end: 1320 };
const st = (o) => M.missState({ hours, events: [], ...o });
const rec = (o = {}) => ({ tz: "Asia/Jerusalem", dayStart: 480, dayEnd: 1320, subs: [{}], tasks: [], sentOn: "2026-10-06", ...o });
const types = (out) => out.map((m) => m.type);

test("missState: first slot ignored → miss, 10 minutes in, keyed to the slot", () => {
  const tasks = [t({ id: "a", touchedAt: at(9) })];
  assert.equal(st({ tasks, now: at(9, 5) }), null); // not yet
  const s = st({ tasks, now: at(9, 12) });
  assert.equal(s.kind, "miss");
  assert.equal(s.start, at(9));
  assert.equal(s.key, `miss|${at(9)}`);
  assert.equal(st({ tasks, now: at(9, 40) }).key, s.key); // same slot, same ask
});

test("missState: second slot in a row → silence, once a day; answered → quiet until activity", () => {
  const tasks = [t({ touchedAt: at(9) })];
  const s = st({ tasks, now: at(10, 15) }); // 9:00 and 10:00 both passed
  assert.equal(s.kind, "silence");
  assert.equal(s.key, "silence|2026-10-06");
  assert.equal(s.since, at(9));
  assert.equal(st({ tasks, now: at(11, 15), silenceOn: "2026-10-06" }), null);
  // Something done since: the ladder starts over, and the silence check stays used.
  const after = [t({ touchedAt: at(11) })];
  assert.equal(st({ tasks: after, now: at(11, 12), silenceOn: "2026-10-06" }).kind, "miss");
  assert.equal(st({ tasks: after, now: at(12, 12), silenceOn: "2026-10-06" }), null);
});

test("missState: never while a task runs, in or just before a meeting, or at night", () => {
  const tasks = [t({ id: "a", size: 60, touchedAt: at(9) })];
  assert.equal(st({ tasks, run: { taskId: "a", startedAt: at(9, 20), extra: 0 }, now: at(9, 30) }), null);
  const meet = { id: "m", title: "Meeting", start: il(9, 15), end: il(10), busy: true };
  assert.equal(st({ tasks, events: [meet], now: at(9, 12) }), null); // starts in 3 min
  assert.equal(st({ tasks, events: [meet], now: at(9, 30) }), null); // in it
  // After it: the stretch before it (15 min) was too short to count, so this is the first miss.
  assert.equal(st({ tasks, events: [meet], now: at(10, 11) }).kind, "miss");
  assert.equal(st({ tasks: [t({ touchedAt: at(21, 50) })], now: at(22, 30) }), null); // after the day
});

test("missState: a meeting resets the slot; an approved plan counts as activity", () => {
  const tasks = [t({ touchedAt: at(9) })];
  const meet = { id: "m", title: "Meeting", start: il(9, 30), end: il(11), busy: true };
  // The 9:00 miss isn't asked after the meeting: that slot is gone.
  assert.equal(st({ tasks, events: [meet], now: at(11, 5) }), null);
  assert.equal(st({ tasks: [t({ touchedAt: at(9) })], now: at(9, 59) }).kind, "miss");
  // 9:00 slot (30 min before the meeting) missed, then 11:00 → second in a row.
  assert.equal(st({ tasks, events: [meet], now: at(11, 12) }).kind, "silence");
  assert.equal(st({ tasks, events: [meet], now: at(11, 12), planAt: at(11, 5) }), null);
});

test("missState: a third of the day's free time ignored → silence after one slot (not a fixed hour)", () => {
  const tasks = [t({ touchedAt: at(7) })]; // before the day: nothing done today
  const morning = { id: "m1", title: "Workshop", start: il(8), end: il(12, 30), busy: true };
  const evening = { id: "m2", title: "Rehearsal", start: il(14), end: il(22), busy: true };
  // 90 free minutes all day: 11 ignored is a miss, 31 is a third of it.
  assert.equal(st({ tasks, events: [morning, evening], now: at(12, 41) }).kind, "miss");
  const s = st({ tasks, events: [morning, evening], now: at(13, 1) });
  assert.deepEqual([s.kind, s.why, s.since], ["silence", "time", null]);
  assert.equal(M.silenceText(s, () => "x"), "Nothing's started yet today. Want a lighter plan for the rest of today?");
  // The same 31 minutes on a day with a free afternoon is still just a miss.
  assert.equal(st({ tasks, events: [morning], now: at(13, 1) }).kind, "miss");
});

test("missState: today's work stopped fitting → silence after one slot", () => {
  const fits = [t({ size: 100, touchedAt: at(20) })]; // 120 free min left at 20:00
  const s = st({ tasks: fits, now: at(20, 25) }); // 95 left
  assert.deepEqual([s.kind, s.why, s.since], ["silence", "overload", at(20)]);
  assert.equal(M.silenceText(s, () => "20:00"), "What's due today doesn't fit any more. Want a lighter plan for the rest of today?");
  // Never fit to begin with: the miss didn't change that, so it's a plain miss.
  assert.equal(st({ tasks: [t({ size: 150, touchedAt: at(20) })], now: at(20, 25) }).kind, "miss");
});

test("proposeDay maxEach: only small tasks, but a deadline due today still comes", () => {
  const tasks = [t({ id: "big", size: 120 }), t({ id: "small", size: 15 }), t({ id: "dl", size: 90, dateKind: "deadline", due: "2026-10-06" })];
  const items = P.proposeDay({ tasks, events: [], now: at(14), hours, ask: { fewer: true, maxEach: 30 } });
  const ids = items.map((i) => i.taskId);
  assert.ok(ids.includes("small") && ids.includes("dl"));
  assert.ok(!ids.includes("big"));
});

test("decide: miss names the task with Start / Shorten, once; silence offers a lighter plan", () => {
  const task = t({ id: "mix", title: "Mix review", size: 60, touchedAt: at(9) });
  const r = rec({ tasks: [task] });
  const d = N.decide(r, [], at(9, 12));
  assert.deepEqual(types(d.out), ["miss"]);
  assert.equal(d.out[0].title, "Mix review");
  assert.equal(d.out[0].taskId, "mix");
  assert.match(d.out[0].body, /^Up since 09:00 and not started/);
  assert.deepEqual(d.out[0].actions.map((a) => a.action), ["start", "shorten"]);
  assert.equal(N.decide({ ...r, missSent: d.patch.missSent }, [], at(9, 17)).out.length, 0); // not twice

  const s = N.decide({ ...r, missSent: d.patch.missSent }, [], at(10, 12));
  assert.deepEqual(types(s.out), ["silence"]);
  assert.equal(s.out[0].url, "./?open=lighter");
  assert.equal(s.out[0].date, "2026-10-06");
  assert.deepEqual(s.out[0].actions.map((a) => a.action), ["lighter", "quiet"]);
  assert.match(s.out[0].body, /^Nothing's moved since 09:00\./);
});

test("decide: miss follows the approved plan; held when the app was on screen, off, or the calendar unreadable", () => {
  const a = t({ id: "a", title: "First by engine", size: 15, dateKind: "deadline", touchedAt: at(9) });
  const b = t({ id: "b", title: "Planned first", size: 30 });
  const plan = { date: "2026-10-06", at: 0, ids: ["b", "a"] };
  assert.equal(N.decide(rec({ tasks: [a, b], plan }), [], at(9, 12)).out[0].taskId, "b");
  const seen = N.decide(rec({ tasks: [a, b], seenAt: at(9, 11) }), [], at(9, 12));
  assert.equal(seen.out.length, 0);
  assert.ok(seen.patch.missSent.length); // the banner asked: not sent later either
  assert.equal(N.decide(rec({ tasks: [a, b], notify: { miss: false } }), [], at(9, 12)).out.length, 0);
  assert.equal(N.decide(rec({ tasks: [a, b] }), null, at(9, 12)).out.filter((m) => m.type === "miss").length, 0);
});
