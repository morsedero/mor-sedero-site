// The day's proposed schedule (proposal.js, 2026-10-07).
import test from "node:test";
import assert from "node:assert/strict";
process.env.TZ = "Asia/Jerusalem";
const { proposeDay, timeline, withBreaks, trimBreaks, nextPlanned, parseAsk, planProgress, refit, topUp, daySig, leftOf, fewerOf, moreOf, inProjectOrder } = await import("../../app/js/proposal.js");

const at = (h, m = 0) => Date.UTC(2026, 9, 7, h - 3, m);
const il = (h, m = 0) => new Date(at(h, m)).toISOString();
const t = (o) => ({ id: o.id || String(Math.random()), title: "Task", status: "ready", type: "deep", due: "2026-10-07", dateKind: "target", size: 30, spentMinutes: 0, createdAt: at(0), ...o });
const ev = (title, s, e) => ({ id: title, title, start: il(...s), end: il(...e), busy: true });

test("proposes open tasks once each, never the running one, within the free time", () => {
  const tasks = [t({ id: "a", size: 60 }), t({ id: "b", size: 30 }), t({ id: "c", size: 45 }), t({ id: "w", status: "waiting" }), t({ id: "h", onHold: { who: "Yuval", since: 1 } })];
  const run = { taskId: "c", startedAt: at(9) };
  const items = proposeDay({ tasks, events: [], now: at(9), run });
  const ids = items.map((i) => i.taskId);
  assert.deepEqual([...ids].sort(), ["a", "b"]);
  assert.equal(new Set(ids).size, ids.length);
});

test("timeline keeps the user's order and steps around meetings", () => {
  const tasks = [t({ id: "a", size: 60 }), t({ id: "b", size: 30 })];
  const events = [ev("Teaching", [10], [12])];
  const { rows, over } = timeline([{ taskId: "b", minutes: 30 }, { taskId: "a", minutes: 60 }], { tasks, events, now: at(9, 30) });
  assert.deepEqual(rows.map((r) => r.taskId), ["b", "a"]);
  assert.equal(rows[0].start, at(9, 30));
  assert.equal(rows[1].start, at(12, 10)); // 9:30-10:00 had room for b only; 2 h of teaching → a 10 min break (lunch waits for 13:00)
  assert.equal(over.length, 0);
});

test("an item that doesn't fit today is reported, not dropped silently", () => {
  const tasks = [t({ id: "a", size: 120 })];
  const { rows, over } = timeline([{ taskId: "a", minutes: 120 }], { tasks, events: [], now: at(21) });
  assert.equal(rows.length, 0);
  assert.deepEqual(over.map((o) => o.taskId), ["a"]);
});

test("approved plan: the card follows it in order, skipping what's done or on hold", () => {
  const tasks = [t({ id: "a", status: "done" }), t({ id: "b", onHold: { who: "", since: 1 } }), t({ id: "c" })];
  const plan = { date: "2026-10-07", status: "approved", items: [{ taskId: "a" }, { taskId: "b" }, { taskId: "c" }] };
  assert.equal(nextPlanned(plan, tasks, "2026-10-07", at(10)), "c");
  assert.equal(nextPlanned({ ...plan, status: "proposed" }, tasks, "2026-10-07", at(10)), null);
  assert.equal(nextPlanned(plan, tasks, "2026-10-08", at(10)), null);
  assert.deepEqual(planProgress(plan, tasks), { done: 1, total: 3 });
});

test("plan progress: a routine with a session logged on the plan's day counts as done", () => {
  const tasks = [t({ id: "r", routine: { per: 3, log: [{ day: "2026-10-10" }] }, notBefore: "2026-10-11" }), t({ id: "c" })];
  const plan = { date: "2026-10-10", status: "approved", items: [{ taskId: "r" }, { taskId: "c" }] };
  assert.deepEqual(planProgress(plan, tasks), { done: 1, total: 2 });
  assert.deepEqual(planProgress({ ...plan, date: "2026-10-11" }, tasks), { done: 0, total: 2 });
});

test("rethink in plain words", () => {
  const tasks = [t({ id: "mix", title: "Mix review", project: "Reprise" }), t({ id: "inv", title: "Send invoice", type: "admin" }), t({ id: "call", title: "Call Dana", type: "call" })];
  assert.deepEqual(parseAsk("no calls", tasks).skipTypes, ["call"]);
  assert.deepEqual(parseAsk("start with the mix review", tasks).first, ["mix"]);
  assert.deepEqual(parseAsk("skip Reprise today", tasks).exclude, ["mix"]);
  assert.equal(parseAsk("only 2 hours", tasks).maxMinutes, 120);
  assert.equal(parseAsk("done by 5pm", tasks).until, 17 * 60);
  assert.equal(parseAsk("I'm tired, lighter please", tasks).fewer, true); // no energy: tired means fewer things
  assert.equal(parseAsk("blah", tasks).understood, false);
});

test("rethink changes the proposal: excluded types and names stay out, first goes first", () => {
  const tasks = [t({ id: "a", title: "Mix review", size: 60 }), t({ id: "b", title: "Call Dana", type: "call", size: 15 }), t({ id: "c", title: "Lesson prep", size: 30 })];
  const ask = parseAsk("no calls, start with lesson prep", tasks);
  const ids = proposeDay({ tasks, events: [], now: at(9), ask }).map((i) => i.taskId);
  assert.equal(ids[0], "c");
  assert.equal(ids.includes("b"), false);
  const fewer = proposeDay({ tasks: [...tasks, t({}), t({}), t({})], events: [], now: at(9), ask: { fewer: true } });
  assert.equal(fewer.length, 3);
  const deleted = proposeDay({ tasks, events: [], now: at(9), exclude: ["a"] }).map((i) => i.taskId);
  assert.equal(deleted.includes("a"), false);
});

test("breaks: 10 min after 90 min of work, never before the first task", () => {
  const tasks = [t({ id: "a", size: 90 }), t({ id: "b", size: 30 })];
  const { rows, breaks } = timeline([{ taskId: "a", minutes: 90 }, { taskId: "b", minutes: 30 }], { tasks, events: [], now: at(9) });
  assert.equal(breaks.length, 1);
  assert.equal(breaks[0].type, "short");
  assert.equal(breaks[0].start, rows[0].end);
  assert.equal(rows[1].start, breaks[0].end);
});

test("breaks: back-to-back meetings count as work", () => {
  const tasks = [t({ id: "a", size: 30 })];
  const events = [ev("M1", [8], [9]), ev("M2", [9], [10, 30])];
  const { rows, breaks } = timeline([{ taskId: "a", minutes: 30 }], { tasks, events, now: at(8) });
  assert.equal(breaks.length, 1);
  assert.equal(rows[0].start, breaks[0].end);
});

test("breaks: lunch 45 min inside 13-14, once; a 15 min idle gap resets the count", () => {
  const tasks = [t({ id: "a", size: 30 }), t({ id: "b", size: 30 })];
  const r = timeline([{ taskId: "a", minutes: 30 }, { taskId: "b", minutes: 30 }], { tasks, events: [], now: at(13, 5) });
  assert.deepEqual(r.breaks.map((b) => [b.type, b.name]), [["meal", "Lunch"]]);
  assert.equal(r.breaks[0].minutes, 45);
  assert.equal(r.rows[0].start, at(13, 5)); // not lunch first thing at one
  assert.equal(r.breaks[0].start, r.rows[0].end);
  const idle = timeline([{ taskId: "a", minutes: 60 }, { taskId: "b", minutes: 60 }], { tasks, events: [ev("X", [10], [10, 20])], now: at(9) });
  assert.equal(idle.breaks.length, 0);
});

test("meals from settings: own windows and lengths, several, or none", () => {
  const tasks = [t({ id: "a", size: 60 }), t({ id: "b", size: 60 }), t({ id: "c", size: 60 })];
  const items = [{ taskId: "a", minutes: 60 }, { taskId: "b", minutes: 60 }, { taskId: "c", minutes: 60 }];
  const two = { start: 480, end: 1320, meals: [{ name: "Brunch", from: 600, to: 660, minutes: 20 }, { name: "Dinner", from: 690, to: 780, minutes: 60 }] };
  const r = timeline(items, { tasks, events: [], now: at(9, 30), hours: two });
  assert.deepEqual(r.breaks.filter((b) => b.type === "meal").map((b) => [b.name, b.minutes]), [["Brunch", 20], ["Dinner", 60]]);
  const off = timeline(items, { tasks, events: [], now: at(11, 30), hours: { start: 480, end: 1320, meals: [] } });
  assert.equal(off.breaks.filter((b) => b.type === "meal").length, 0);
  // Switched off: a meal already in the plan goes too.
  const kept = timeline([items[0], { brk: "meal", name: "Lunch", minutes: 45 }, items[1]], { tasks, events: [], now: at(11, 30), hours: { start: 480, end: 1320, meals: [] } });
  assert.equal(kept.breaks.length, 0);
  // An old "lunch" item still reads as the meal it falls in.
  const old = timeline([items[0], { brk: "lunch", minutes: 45 }, items[1]], { tasks, events: [], now: at(11, 30) });
  assert.deepEqual(old.breaks.map((b) => [b.type, b.name]), [["meal", "Lunch"]]);
});

test("breaks become plan items once, then stay where they're put", () => {
  const tasks = [t({ id: "a", size: 90 }), t({ id: "b", size: 30 }), t({ id: "c", size: 30 })];
  const ctx = { tasks, events: [], now: at(9) };
  const items = withBreaks([{ taskId: "a", minutes: 90 }, { taskId: "b", minutes: 30 }, { taskId: "c", minutes: 30 }], ctx);
  assert.deepEqual(items.map((i) => i.taskId || i.brk), ["a", "short", "b", "c"]);
  assert.equal(withBreaks(items, ctx), items); // already has its breaks
  // Moved: the break goes where it's put, and no rule adds another.
  const moved = [items[0], items[2], items[1], items[3]];
  const r = timeline(moved, ctx);
  assert.deepEqual(r.breaks.map((b) => [b.type, b.i]), [["short", 2]]);
  assert.equal(r.breaks[0].start, r.rows[1].end);
  assert.deepEqual(r.rows.map((x) => x.i), [0, 1, 3]);
  // A plan never starts or ends on a break.
  const edge = [items[1], items[0], items[2], items[1]];
  assert.deepEqual(trimBreaks(edge).map((i) => i.taskId || i.brk), ["a", "b"]);
  const first = timeline([items[1], items[0]], ctx);
  assert.equal(first.breaks.length, 0);
  assert.equal(first.rows[0].start, at(9));
  assert.equal(timeline([items[0], items[1]], ctx).breaks.length, 0);
  // A break after finished work, with nothing laid since, was had.
  const done = tasks.map((x) => (x.id === "a" ? { ...x, status: "done" } : x));
  assert.equal(timeline(items, { ...ctx, tasks: done }).breaks.length, 0);
});

test("a break runs on through free time to the next item, up to a meeting; its own minutes stay", () => {
  const tasks = [t({ id: "a", size: 60 }), t({ id: "b", size: 90 })];
  const items = [{ taskId: "a", minutes: 60 }, { brk: "short", minutes: 10 }, { taskId: "b", minutes: 90 }];
  // b doesn't fit 10:10-11:00, so it goes after the meeting: the break holds to 11:00.
  const r = timeline(items, { tasks, events: [ev("Call", [11], [12])], now: at(9) });
  assert.deepEqual([r.breaks[0].start, r.breaks[0].end, r.breaks[0].minutes], [at(10), at(11), 10]);
  assert.equal(r.rows[1].start, at(12));
  // Nothing in the way: the break is its own length.
  assert.equal(timeline(items, { tasks, events: [], now: at(9) }).breaks[0].end, at(10, 10));
});

test("refit: when the day shrinks, what matters least goes, not what's last; the order of what stays is kept", () => {
  const tasks = [t({ id: "a", size: 60 }), t({ id: "b", size: 60, dateKind: "deadline" }), t({ id: "c", size: 20 })];
  const items = [{ taskId: "a", minutes: 60 }, { brk: "short", minutes: 10 }, { taskId: "b", minutes: 60 }, { taskId: "c", minutes: 20 }];
  const ctx = { tasks, events: [], now: at(20) }; // 20:00-22:00 left, 150 min planned
  assert.deepEqual(refit(items, ctx), { items: [{ taskId: "b", minutes: 60 }, { taskId: "c", minutes: 20 }], cut: ["a"] });
  // Nothing to do when it all fits.
  const roomy = { ...ctx, now: at(9) };
  assert.equal(refit(items, roomy).items, items);
  // Put back with Undo: never cut again, even when it means something else goes.
  assert.deepEqual(refit(items, ctx, ["a"]).cut, ["b"]);
  // The running task never goes.
  assert.ok(!refit(items, { ...ctx, run: { taskId: "a", startedAt: at(9) } }).cut.includes("a"));
});

test("topUp: when the day opens up, fresh picks go on the end; what's there stays in order and in today", () => {
  const tasks = [t({ id: "a", size: 60 }), t({ id: "b", size: 30 }), t({ id: "c", size: 30 }), t({ id: "d", size: 45 })];
  const items = [{ taskId: "b", minutes: 30 }, { taskId: "a", minutes: 60 }];
  // 19:30-22:00 left: 90 planned, a break, room for one 30 more.
  const { items: out, added } = topUp(items, { tasks, events: [], now: at(19, 30) });
  assert.deepEqual(out.slice(0, 2), items);
  assert.equal(added.length, 1);
  assert.ok(["c", "d"].includes(added[0]));
  assert.ok(!timeline(out, { tasks, events: [], now: at(19, 30) }).over.length);
  // A full day adds nothing and hands the same list back.
  const full = topUp(items, { tasks, events: [ev("Gig", [21], [22])], now: at(19, 30) });
  assert.deepEqual(full, { items, added: [] });
  // skip (taken off with Undo) never comes back; the running task never goes in.
  const r = topUp(items, { tasks, events: [], now: at(9), run: { taskId: "d", startedAt: at(9) } }, ["c"]);
  assert.deepEqual(r.added, []);
});

test("topUp after Later → Tomorrow (now.js fillFreed): the task's freed hour takes a fresh pick, the task itself never", () => {
  const tasks = [t({ id: "a", size: 60 }), t({ id: "b", size: 30 }), t({ id: "c", size: 30 }), t({ id: "d", size: 45 })];
  const items = [{ taskId: "b", minutes: 30 }, { taskId: "a", minutes: 60 }];
  const events = [ev("Gig", [21], [22])];
  assert.deepEqual(topUp(items, { tasks, events, now: at(19, 30) }).added, []); // full
  // fillFreed leaves "a" out of the day (its write hasn't landed) and skips it.
  const r = topUp(items, { tasks: tasks.filter((x) => x.id !== "a"), events, now: at(19, 30) }, ["a"]);
  assert.equal(r.added.length, 1);
  assert.ok(["c", "d"].includes(r.added[0]));
  assert.deepEqual(r.items.slice(0, 2), items);
});

test("daySig: changes with busy events and hours, not with the clock or free events", () => {
  const evs = [ev("Teaching", [10], [12])];
  const s = daySig(evs, { start: 480, end: 1320 }, at(9));
  assert.equal(daySig(evs, { start: 480, end: 1320 }, at(15)), s);
  assert.equal(daySig([...evs, { ...ev("Lunch", [13], [14]), busy: false }], { start: 480, end: 1320 }, at(9)), s);
  assert.notEqual(daySig([ev("Teaching", [10], [11])], { start: 480, end: 1320 }, at(9)), s);
  assert.notEqual(daySig([], { start: 480, end: 1320 }, at(9)), s);
  assert.notEqual(daySig(evs, { start: 480, end: 1380 }, at(9)), s);
});

// An approved plan holds its times (Mor, 2026-10-10): idle past the next
// task's start, it stays there and the plan says it's late; activity lays it
// from now again; a running task follows the clock; "In 10 min" (at) holds it.
test("held plan: the next task's start doesn't slide while you're idle", () => {
  const tasks = [t({ id: "a", size: 30 }), t({ id: "b", size: 30 })];
  const items = [{ taskId: "a", minutes: 30 }, { taskId: "b", minutes: 30 }];
  const ctx = { tasks, events: [], hours: { start: 480, end: 1320 }, since: at(9, 2) };
  const before = timeline(items, { ...ctx, now: at(9, 3) });
  assert.equal(before.rows[0].start, at(9, 5)); assert.equal(before.late, undefined);
  const idle = timeline(items, { ...ctx, now: at(9, 17) });
  assert.equal(idle.rows[0].start, at(9, 5)); assert.equal(idle.rows[1].start, at(9, 35));
  assert.deepEqual(idle.late, { taskId: "a", start: at(9, 5), end: at(9, 35) });
  // Old behaviour, no since: laid from now.
  assert.equal(timeline(items, { ...ctx, since: undefined, now: at(9, 17) }).rows[0].start, at(9, 20));
  // Something done since: from then again.
  assert.equal(timeline(items, { ...ctx, since: at(9, 16), now: at(9, 17) }).late, undefined);
  // A task running: follows the clock.
  const run = { taskId: "b", startedAt: at(9, 10) };
  assert.equal(timeline(items, { ...ctx, run, now: at(9, 17) }).late, undefined);
  // In 10 min: not before its at, late again once that passes.
  const later = [{ ...items[0], at: at(9, 30) }, items[1]];
  assert.equal(timeline(later, { ...ctx, since: at(9, 20), now: at(9, 21) }).rows[0].start, at(9, 30));
  assert.equal(timeline(later, { ...ctx, since: at(9, 20), now: at(9, 31) }).late.start, at(9, 30));
});

test("held plan: a planned task whose whole time passed unstarted is missed, not over", () => {
  const tasks = [t({ id: "a", size: 30 }), t({ id: "b", size: 30 }), t({ id: "c", size: 30 })];
  const items = tasks.map((x) => ({ taskId: x.id, minutes: 30 }));
  const tl = timeline(items, { tasks, events: [], hours: { start: 480, end: 1320 }, since: at(9, 2), now: at(10, 10) });
  assert.deepEqual(tl.missed, ["a", "b"]); // 09:05–09:35, 09:35–10:05
  assert.deepEqual(tl.rows.map((r) => !!r.missed), [true, true, false]);
  assert.equal(timeline(items, { tasks, events: [], hours: { start: 480, end: 1320 }, since: at(10, 9), now: at(10, 10) }).missed, undefined);
});

// ---- user test 2026-10-11, part B ----

test("10b: a part-done task is booked for the time left, not its full size", () => {
  const tax = t({ id: "tax", size: 120, progress: 75 }), demo = t({ id: "demo", size: 180, progress: 50 });
  assert.equal(leftOf(tax), 30);
  assert.equal(leftOf(demo), 90);
  const items = proposeDay({ tasks: [tax, demo], events: [], now: at(9) });
  assert.deepEqual(Object.fromEntries(items.map((i) => [i.taskId, i.minutes])), { tax: 30, demo: 90 });
  // A plan saved before the progress: its slot shrinks to what's left.
  const { rows } = timeline([{ taskId: "tax", minutes: 120 }], { tasks: [tax], events: [], now: at(9) });
  assert.equal(rows[0].minutes, 30);
});

test("a task made longer after the plan was saved gets its new length; a piece keeps its own", () => {
  const grew = t({ id: "grew", size: 240 }), next = t({ id: "next", size: 30 });
  const { rows } = timeline([{ taskId: "grew", minutes: 30 }, { taskId: "next", minutes: 30 }], { tasks: [grew, next], events: [], now: at(9) });
  assert.equal(rows[0].minutes, 240);
  assert.ok(rows[1].start >= at(13));
  const piece = timeline([{ taskId: "grew", minutes: 60, of: 240 }], { tasks: [grew], events: [], now: at(9) }).rows[0];
  assert.equal(piece.minutes, 60);
  assert.equal(piece.of, 240);
});

test("12: inside a project the plan keeps the order tasks were added; a last step goes after its siblings", () => {
  const mk = (id, title, h) => t({ id, title, project: "Reprise", size: 30, createdAt: at(h) });
  const send = mk("send", "Send rough mixes", 1), m1 = mk("m1", "Mix song 1", 2), m2 = mk("m2", "Mix song 2", 3);
  const items = proposeDay({ tasks: [send, m2, m1], events: [], now: at(9) });
  const ids = items.map((i) => i.taskId);
  assert.ok(ids.indexOf("m1") < ids.indexOf("m2"));
  assert.ok(ids.indexOf("m2") < ids.indexOf("send"));
  // With a sibling not in the plan (it doesn't fit, or it's off today), the last step waits.
  const big = mk("big", "Mix song 3", 4); big.size = 900;
  const only = proposeDay({ tasks: [send, big], events: [], now: at(9) }).map((i) => i.taskId);
  assert.ok(!only.includes("send"));
  // A dragged order (pos) wins over when they were added; other projects keep their places.
  const a = t({ id: "a", project: "P", pos: 1, createdAt: at(1) }), b = t({ id: "b", project: "P", pos: 0, createdAt: at(2) }), x = t({ id: "x", project: "Q" });
  assert.deepEqual(inProjectOrder([{ taskId: "a" }, { taskId: "x" }, { taskId: "b" }], [a, b, x]).map((i) => i.taskId), ["b", "x", "a"]);
});

test("lunch: a long item across the whole lunch hour still gets lunch, before or right after it", () => {
  const tasks = [t({ id: "a", size: 120 }), t({ id: "b", size: 180 }), t({ id: "c", size: 60 })];
  const items = [{ taskId: "a", minutes: 120 }, { taskId: "b", minutes: 180 }, { taskId: "c", minutes: 60 }];
  const { breaks } = timeline(items, { tasks, events: [], now: at(9) });
  assert.ok(breaks.some((b) => b.type === "meal"), "lunch is in the plan");
  // And no 5 h stretch on one short break: a long one before a 3 h item after 2 h of work.
  assert.equal(breaks.find((b) => b.start === at(11)).type, "long");
});

test("Fewer keeps what's due soonest; More adds a little, not the whole day", () => {
  const tasks = [t({ id: "pass", title: "Passport renewal", due: "2026-11-15", dateKind: "deadline", size: 30 }),
    t({ id: "p1", title: "Tamar pack 1", due: "2026-10-09", size: 30 }), t({ id: "p2", title: "Tamar pack 2", due: "2026-10-09", size: 30 }),
    t({ id: "u", title: "Undated", due: null, dateKind: null, size: 30 }), t({ id: "e", title: "Extra", size: 30 })];
  const plan = [{ taskId: "pass", minutes: 30 }, { taskId: "p1", minutes: 30 }, { taskId: "p2", minutes: 30 }, { taskId: "u", minutes: 30 }];
  const kept = fewerOf(plan, { tasks, now: at(9) }).map((i) => i.taskId);
  assert.ok(kept.includes("p1") && kept.includes("p2") && !kept.includes("u"));
  const many = Array.from({ length: 12 }, (_, i) => t({ id: `m${i}`, size: 60 }));
  const more = moreOf([{ taskId: "m0", minutes: 60 }], { tasks: many, events: [], now: at(9) });
  const added = more.length - 1;
  assert.ok(added >= 1 && added <= 3, `added ${added}`);
  assert.ok(more.slice(1).reduce((s, i) => s + i.minutes, 0) <= 120);
});

test("openHours: the plan never books an office task after offices close, nor an evening one before 17:00", () => {
  const dentist = t({ id: "d", title: "Book dentist", openHours: "office", size: 15 });
  const late = timeline([{ taskId: "d", minutes: 15 }], { tasks: [dentist], events: [], now: at(21) });
  assert.equal(late.rows.length, 0);
  assert.deepEqual(late.over.map((o) => o.taskId), ["d"]);
  const early = timeline([{ taskId: "d", minutes: 15 }], { tasks: [dentist], events: [], now: at(8) });
  assert.equal(early.rows[0].start, at(9));
  const ev = t({ id: "v", openHours: "evening", size: 30 });
  assert.equal(timeline([{ taskId: "v", minutes: 30 }], { tasks: [ev], events: [], now: at(10) }).rows[0].start, at(17));
  // proposeDay moves an office task up rather than leaving it past 16:00.
  const work = [t({ id: "w1", size: 240 }), t({ id: "w2", size: 240 }), dentist];
  const items = [{ taskId: "w1", minutes: 240 }, { taskId: "w2", minutes: 240 }, { taskId: "d", minutes: 15 }];
  assert.equal(timeline(items, { tasks: work, events: [], now: at(9) }).over[0]?.taskId, "d");
});

test("Today list: a break with nothing after it isn't shown for the rest of the day", () => {
  const tasks = [t({ id: "a", size: 60 }), t({ id: "b", size: 60, status: "done" })];
  const { breaks } = timeline([{ taskId: "a", minutes: 60 }, { brk: "short", minutes: 10 }, { taskId: "b", minutes: 60 }], { tasks, events: [], now: at(9) });
  assert.equal(breaks.length, 0);
});

test("Later today: a held task leaves its old slot; the rest move up", () => {
  const tasks = [t({ id: "a", size: 30 }), t({ id: "b", size: 30 })];
  const { rows } = timeline([{ taskId: "a", minutes: 30, hold: at(12) }, { taskId: "b", minutes: 30 }], { tasks, events: [], now: at(9) });
  assert.equal(rows.find((r) => r.taskId === "b").start, at(9));
  assert.ok(rows.find((r) => r.taskId === "a").start >= at(12));
});

test("typed 'lighter' (a fresh fewer plan) keeps what's due soonest too", () => {
  const tasks = [t({ id: "pass", title: "Passport renewal", due: "2026-11-15", dateKind: "deadline", size: 30, createdAt: at(0) }),
    t({ id: "p1", due: "2026-10-09", size: 30 }), t({ id: "p2", due: "2026-10-09", size: 30 }),
    t({ id: "u1", due: null, dateKind: null }), t({ id: "u2", due: null, dateKind: null })];
  const ids = proposeDay({ tasks, events: [], now: at(9), ask: parseAsk("lighter please") }).map((i) => i.taskId);
  assert.equal(ids.length, 3);
  assert.ok(ids.includes("p1") && ids.includes("p2"));
  assert.ok(!ids.includes("u1") && !ids.includes("u2"));
});

test("a Done ahead of time lays the rest of the plan again from now (round 2 #3)", () => {
  // A 60-min task done a minute in: the next item takes its place, not its
  // old slot, so the free time after the plan grows by what was freed.
  const tasks = [t({ id: "a", size: 60 }), t({ id: "b", size: 5 }), t({ id: "c", size: 30 })];
  const items = tasks.map((x) => ({ taskId: x.id, minutes: x.size }));
  const before = timeline(items, { tasks, events: [], now: at(10), since: at(10) });
  const done = tasks.map((x) => (x.id === "a" ? { ...x, status: "done", doneAt: at(10, 1) } : x));
  const after = timeline(items, { tasks: done, events: [], now: at(10, 1), since: at(10, 1) });
  const row = (tl, id) => tl.rows.find((r) => r.taskId === id);
  assert.equal(row(after, "a"), undefined);
  assert.equal(row(after, "b").start, at(10, 5));
  assert.ok(row(after, "c").end <= row(before, "c").end - 55 * 60000);
});

test("No room: a task too long for the whole day left says so, offers no ↑; Fewer drops it before what fits (Mor, 2026-10-12)", () => {
  const big = t({ id: "big", title: "Social video", size: 180, dateKind: "deadline" }), a = t({ id: "a", size: 30 }), b = t({ id: "b", size: 30 });
  const ctx = { tasks: [big, a, b], events: [ev("Late", [21], [23, 59])], now: at(18, 30) };
  const alone = timeline([{ taskId: "big", minutes: 180 }], ctx).over[0];
  assert.ok(alone.never, "↑ can't help");
  assert.match(alone.why, /only 2 h 30 min left today|longest free stretch today is 2 h 30 min/);
  const after = timeline([{ taskId: "a", minutes: 30 }, { taskId: "b", minutes: 30 }, { taskId: "big", minutes: 120, of: 180 }], ctx).over[0];
  assert.ok(after && !after.never && /after the rest/.test(after.why), after?.why);
  const kept = fewerOf([{ taskId: "big", minutes: 180 }, { taskId: "a", minutes: 30 }, { taskId: "b", minutes: 30 }], ctx).map((i) => i.taskId);
  assert.ok(!kept.includes("big"), kept.join());
});

test("flow: a project's tasks run back to back instead of mixing (Mor, 2026-10-12)", () => {
  const tasks = [
    t({ id: "m1", project: "Monster Punk", createdAt: at(0, 1) }), t({ id: "r1", project: "Reprise", createdAt: at(0, 2) }),
    t({ id: "m2", project: "Monster Punk", createdAt: at(0, 3) }), t({ id: "r2", project: "Reprise", createdAt: at(0, 4) }),
  ];
  const ids = proposeDay({ tasks, events: [], now: at(9) }).map((i) => i.taskId);
  assert.deepEqual(ids, ["m1", "m2", "r1", "r2"]);
});
