// Daisey v1 pencil schedule. Run: node --test "daisey/test/v1/*.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import * as P from "../../app/js/pencil.js";

const at = (d, h = 10, m = 0) => new Date(2026, 9, d, h, m).getTime(); // Oct 2026; the 5th is a Monday
const NOW = at(5, 10);
const iso = (h, m = 0) => new Date(at(5, h, m)).toISOString();
const ev = (title, sh, sm, eh, em, o = {}) => ({ title, start: iso(sh, sm), end: iso(eh, em), ...o });
let seq = 0;
const task = (o = {}) => ({ id: `t${++seq}`, project: "P", title: "Task", size: 30, area: "work", type: "deep", where: "computer",
  openHours: "anytime", stakes: "low", energy: "medium", status: "ready", canSplit: false, createdAt: 1, touchedAt: NOW, ...o });

test("gaps: between busy events from now to 22:00; free and all-day events take no time", () => {
  const g = P.gapsToday([ev("Teaching", 11, 0, 13, 0), ev("Free thing", 14, 0, 15, 0, { busy: false }), ev("Week", 0, 0, 0, 0, { allDay: true }), ev("Rehearsal", 18, 0, 20, 0)], NOW);
  assert.deepEqual(g.map((x) => [new Date(x.start).getHours(), x.minutes, x.next]), [[10, 60, "Teaching"], [13, 300, "Rehearsal"], [20, 120, null]]);
  assert.equal(g[1].after.title, "Teaching");
  // Inside an event, the first gap starts when it ends.
  const inside = P.gapsToday([ev("Call", 9, 30, 10, 30)], NOW);
  assert.equal(new Date(inside[0].start).getMinutes(), 30);
});

test("sketch: one task per gap of 20+ min, none reused, the gap's own length and hours", () => {
  const events = [ev("Teaching", 10, 15, 13, 0), ev("Dinner", 13, 30, 22, 0)];
  const quick = task({ size: 10, title: "Reply" }), long = task({ size: 120, title: "Mix", canSplit: true });
  const s = P.sketch([quick, long], events, { now: NOW });
  // 10:00–10:15 is 15 min: too short; 13:00–13:30 fits the quick one.
  assert.deepEqual(s.map((p) => [p.key, p.task.title]), [["13:00", "Reply"]]);
  const roomy = P.sketch([quick, long], [ev("Teaching", 11, 0, 13, 0)], { now: NOW });
  assert.equal(new Set(roomy.map((p) => p.task.id)).size, roomy.length);
  for (const p of roomy) assert.equal(p.part, p.task.size > p.gap.minutes); // a split piece says so
  assert.ok(roomy.every((p) => p.minutes <= p.gap.minutes));
});

test("sketch: office-hours tasks only in gaps when offices are open", () => {
  const call = task({ type: "call", where: "phone", openHours: "office", size: 15, title: "Call bank" });
  const s = P.sketch([call], [ev("Busy", 10, 0, 16, 30)], { now: NOW });
  assert.equal(s.length, 0); // the only gap is 16:30–22:00, after offices close
});

test("sketch: the gap you're in shows the Now card's task; dismissed and swapped are skipped", () => {
  const a = task({ title: "A", size: 30, stakes: "money" }), b = task({ title: "B", size: 30 });
  const events = [ev("Lunch", 11, 0, 12, 0)];
  assert.equal(P.sketch([a, b], events, { now: NOW, currentId: b.id })[0].task.title, "B");
  assert.equal(P.sketch([a, b], events, { now: NOW, exclude: [a.id] })[0].task.title, "B");
  assert.equal(P.sketch([a, b], events, { now: NOW, swaps: { "10:00": [a.id] } })[0].task.title, "B");
  assert.equal(P.sketch([a, b], events, { now: NOW, currentId: a.id, swaps: { "10:00": [a.id] } })[0].task.title, "B"); // swapping the card's own pencil
});

test("block start: the gap's start, or the next 5-minute mark in the current gap", () => {
  const p = { isNow: true, gap: { start: NOW, end: at(5, 11) }, minutes: 30 };
  assert.equal(P.blockStart(p, at(5, 10, 2)), at(5, 10, 5));
  assert.equal(P.blockStart({ ...p, isNow: false, gap: { start: at(5, 13), end: at(5, 14) } }), at(5, 13));
});

test("capacity: free minutes, open dated tasks, how many fit, and the rest", () => {
  const events = [ev("Busy", 10, 0, 20, 0)]; // 2 h free: 20–22
  const ts = [
    task({ due: "2026-10-05", dateKind: "deadline", size: 60 }),
    task({ due: "2026-10-01", dateKind: "target", size: 45 }), // rolled to today
    task({ due: "2026-10-05", size: 90 }),
    task({ due: "2026-10-09", size: 5 }), // not today
    task({ size: 5 }), // undated
  ];
  const c = P.capacity(ts, events, NOW);
  assert.equal(c.free, 120);
  assert.equal(c.open, 3);
  assert.equal(c.realistic, 2); // 60 (deadline first) + 45
  assert.equal(c.rest.length, 1);
});
