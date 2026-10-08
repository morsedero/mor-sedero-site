// Bloom (bloom-data.js, 2026-10-08): the work log's numbers.
import test from "node:test";
import assert from "node:assert/strict";
process.env.TZ = "Asia/Jerusalem";
const B = await import("../../app/js/bloom-data.js");

// Thursday 2026-10-08; its week runs Sunday 10-04 to Saturday 10-10.
const at = (day, h = 10, m = 0) => { const [y, mo, d] = day.split("-").map(Number); return new Date(y, mo - 1, d, h, m).getTime(); };
const NOW = at("2026-10-08", 15);
const task = (o = {}) => ({ id: "t1", title: "Mix", project: "Band", size: 30, spentMinutes: 0, ...o });

test("periods: week is Sunday to Saturday, month is the whole month", () => {
  assert.deepEqual(B.periodRange("today", NOW), { from: "2026-10-08", to: "2026-10-08" });
  assert.deepEqual(B.periodRange("week", NOW), { from: "2026-10-04", to: "2026-10-10" });
  assert.deepEqual(B.periodRange("month", NOW), { from: "2026-10-01", to: "2026-10-31" });
  assert.deepEqual(B.monthsOfRange({ from: "2026-09-27", to: "2026-10-03" }), ["2026-09", "2026-10"]);
});

test("Done guess: never more than the task still needs, however late", () => {
  // Last work 5 hours ago, size 30 → 30, not 300.
  const others = [{ id: "x", workedAt: NOW - 5 * 3600000 }];
  assert.equal(B.guessDoneMinutes(task(), { now: NOW, tasks: others }).minutes, 30);
  // Time already logged comes off.
  assert.equal(B.guessDoneMinutes(task({ spentMinutes: 20 }), { now: NOW }).minutes, 10);
  assert.equal(B.guessDoneMinutes(task({ spentMinutes: 45 }), { now: NOW }).minutes, 0);
});

test("Done guess: a short gap since the last work is that gap", () => {
  const others = [{ id: "x", workedAt: NOW - 12 * 60000 }];
  assert.equal(B.guessDoneMinutes(task(), { now: NOW, tasks: others }).minutes, 10);
  assert.equal(B.guessDoneMinutes(task(), { now: NOW }).minutes, 30);
});

test("Done guess: the task's own slot, logged at the slot's end", () => {
  const ev = { title: "Mix", start: new Date(at("2026-10-08", 11)).toISOString(), end: new Date(at("2026-10-08", 11, 20)).toISOString() };
  const g = B.guessDoneMinutes(task(), { now: NOW, events: [ev] });
  assert.equal(g.minutes, 20);
  assert.equal(g.at, at("2026-10-08", 11, 20));
  const long = { ...ev, end: new Date(at("2026-10-08", 14)).toISOString() };
  assert.equal(B.guessDoneMinutes(task(), { now: NOW, events: [long] }).minutes, 30); // capped at the size
});

test("estimates fill history; a task with real entries is not estimated twice", () => {
  const done = task({ id: "a", status: "done", doneAt: at("2026-10-05"), spentMinutes: 40 });
  const logged = task({ id: "b", status: "done", doneAt: at("2026-10-06") });
  const est = B.estimatedEntries([done, logged], [{ t: "b", p: "Band", m: 25, at: at("2026-10-06"), d: 1 }]);
  assert.deepEqual(est.map((e) => [e.t, e.m, e.g]), [["a", 40, 1]]);
});

test("routine sessions become entries unless that day is logged", () => {
  const r = task({ id: "r", routine: { per: 3, log: [{ day: "2026-10-05", min: 45 }, { day: "2026-10-06" }] } });
  const est = B.estimatedEntries([r], [{ t: "r", p: "Band", m: 30, at: at("2026-10-06"), d: 1 }]);
  assert.deepEqual(est.map((e) => [B.monthKey(e.at), e.m]), [["2026-10", 45]]);
});

test("calendar events: project work nobody timed counts, with a ~", () => {
  const ev = (o) => ({ id: "e1", title: "Band rehearsal", start: new Date(at("2026-10-07", 18)).toISOString(), end: new Date(at("2026-10-07", 20)).toISOString(), ...o });
  const opts = { projects: ["Band", "Inbox"], tasks: [], logged: [], now: NOW };
  const got = B.eventEntries([ev()], opts);
  assert.deepEqual(got.map((e) => [e.p, e.m, e.g]), [["Band", 120, 1]]);
  assert.equal(B.eventEntries([ev({ allDay: true })], opts).length, 0);
  assert.equal(B.eventEntries([ev({ taskId: "t9" })], opts).length, 0);
  assert.equal(B.eventEntries([ev()], { ...opts, logged: [{ p: "Band", at: at("2026-10-07", 19) }] }).length, 0);
  assert.equal(B.eventEntries([ev({ title: "Dentist" })], opts).length, 0);
});

test("summary and flowers: time grows the stem, done tasks are petals, none is a bud", () => {
  const range = B.periodRange("week", NOW);
  const list = [
    { t: "1", p: "Band", m: 60, at: at("2026-10-05"), d: 1 },
    { t: "2", p: "Band", m: 30, at: at("2026-10-06") },
    { t: "3", p: "Home", m: 30, at: at("2026-10-06"), d: 1, g: 1 },
    { t: "4", p: "Band", m: 99, at: at("2026-09-20"), d: 1 }, // out of the week
  ];
  const s = B.summarize(list, range);
  assert.equal(s.total, 120);
  assert.equal(s.done, 2);
  assert.equal(s.days, 2);
  const fl = B.flowers(s, ["Band", "Home", "Garden"], { Home: "focus", Garden: "background" });
  assert.deepEqual(fl.map((f) => f.name), ["Home", "Band", "Garden"]); // Focus first
  const band = fl.find((f) => f.name === "Band");
  assert.equal(band.height, 1); assert.equal(band.petals, 1); assert.equal(band.guess, false);
  assert.equal(fl.find((f) => f.name === "Home").guess, true);
  assert.equal(fl.find((f) => f.name === "Garden").bud, true);
});

test("petals cap at 12 with the rest counted", () => {
  const list = Array.from({ length: 15 }, (_, i) => ({ t: `t${i}`, p: "Band", m: 5, at: NOW, d: 1 }));
  const f = B.flowers(B.summarize(list, B.periodRange("today", NOW)), ["Band"])[0];
  assert.equal(f.petals, 12); assert.equal(f.more, 3);
});

test("routines: dots, count, and the weeks-in-a-row streak", () => {
  const r = task({ id: "r", title: "Exercise", routine: { per: 2, days: [1, 4], log: [
    { day: "2026-09-21" }, { day: "2026-09-22" }, { day: "2026-09-28" }, { day: "2026-09-29" }, { day: "2026-10-05" }] } });
  const [row] = B.routineRows([r], NOW);
  assert.equal(row.count, 1); assert.equal(row.met, false);
  assert.equal(row.streak, 2); // the two weeks before; this one not met yet
  assert.deepEqual(row.dots.map((d) => d.state), ["none", "done", "none", "none", "set", "none", "none"]);
  const met = B.routineRows([{ ...r, routine: { ...r.routine, log: [...r.routine.log, { day: "2026-10-07" }] } }], NOW)[0];
  assert.equal(met.met, true); assert.equal(met.streak, 3);
});

test("words", () => {
  assert.equal(B.fmtMinutes(45), "45 min"); assert.equal(B.fmtMinutes(90), "1h 30m"); assert.equal(B.fmtMinutes(240), "4h");
  const empty = B.summarize([], B.periodRange("week", NOW));
  assert.match(B.oneLine({ summary: empty, period: "week" }), /Nothing planted this week/);
  const s = B.summarize([{ t: "1", p: "Band", m: 240, at: NOW, d: 1 }], B.periodRange("week", NOW));
  const fl = B.flowers(s, ["Band", "Home"], { Band: "focus" });
  assert.match(B.oneLine({ summary: s, flowers: fl, period: "week" }), /Band got 4h this week\./);
});
