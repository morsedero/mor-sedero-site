// Never drop or shrink a task without saying so (proposal.js, 2026-10-11).
import test from "node:test";
import assert from "node:assert/strict";
process.env.TZ = "Asia/Jerusalem";
const { proposeDay, timeline, withBreaks } = await import("../../app/js/proposal.js");

const at = (h, m = 0) => Date.UTC(2026, 9, 12, h - 3, m); // a Monday
const il = (h, m = 0) => new Date(at(h, m)).toISOString();
const t = (o) => ({ title: "Task", status: "ready", type: "admin", area: "work", where: "anywhere", openHours: "anytime", stakes: "low", due: "2026-10-12", dateKind: "target", size: 30, spentMinutes: 0, canSplit: false, createdAt: at(0), guessed: [], ...o });
const ev = (title, s, e) => ({ id: title, title, start: il(...s), end: il(...e), busy: true });
const lay = (tasks, events, now) => { const ctx = { tasks, events, now }; return timeline(withBreaks(proposeDay(ctx), ctx), ctx); };

test("a 10-min task goes in the last 10 free minutes; what doesn't fit is No room with a reason, never gone", () => {
  const tasks = [t({ id: "a", size: 30 }), t({ id: "b", size: 30 }), t({ id: "small", size: 10 })];
  const { rows, over } = lay(tasks, [ev("Teaching", [9, 40], [23])], at(9)); // 40 min free
  const laid = rows.map((r) => r.taskId);
  assert.ok(laid.includes("small"), `laid ${laid}`);
  const seen = new Set([...laid, ...over.map((o) => o.taskId)]);
  assert.deepEqual([...seen].sort(), ["a", "b", "small"]);
  for (const o of over) assert.match(o.why, /needs 30 min|no free time/);
});

test("a task too long for any free stretch is listed, with why", () => {
  const tasks = [t({ id: "long", size: 50 }), t({ id: "small", size: 10 })];
  const { rows, over } = lay(tasks, [ev("Teaching", [9, 40], [23])], at(9));
  assert.deepEqual(rows.map((r) => r.taskId), ["small"]);
  assert.equal(over.length, 1);
  assert.equal(over[0].taskId, "long");
  assert.equal(over[0].minutes, 50); // not shrunk to fit
  assert.equal(over[0].why, "needs 50 min, only 40 min left today"); // too long even alone (2026-10-12)
  assert.ok(over[0].never);
});

test("office hours over: No room says so", () => {
  const tasks = [t({ id: "bank", size: 15, openHours: "office" })];
  const { rows, over } = lay(tasks, [], at(20));
  assert.equal(rows.length, 0);
  assert.equal(over[0]?.why, "needs office hours, none left today");
});

test("a task shortened to fit says by how much (of: its whole length)", () => {
  const tasks = [t({ id: "big", size: 120, canSplit: true })];
  const ctx = { tasks, events: [ev("Teaching", [10, 27], [23])], now: at(9) }; // 87 min free
  const items = proposeDay(ctx);
  assert.deepEqual(items, [{ taskId: "big", minutes: 85, of: 120 }].map((x) => ({ ...x, minutes: items[0].minutes })));
  assert.ok(items[0].minutes < 120);
  const row = timeline(items, ctx).rows[0];
  assert.equal(row.of, 120);
  // Whole: no "of".
  assert.equal(timeline([{ taskId: "big", minutes: 120 }], { ...ctx, events: [] }).rows[0].of, undefined);
});

test("a narrowed ask (fewer, lighter) doesn't pull the rest back in", () => {
  const tasks = Array.from({ length: 6 }, (_, i) => t({ id: "t" + i, size: 20 }));
  const items = proposeDay({ tasks, events: [], now: at(9), ask: { fewer: true } });
  assert.ok(items.length < 6);
});
