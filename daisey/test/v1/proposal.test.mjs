// The day's proposed schedule (proposal.js, 2026-10-07).
import test from "node:test";
import assert from "node:assert/strict";
process.env.TZ = "Asia/Jerusalem";
const { proposeDay, timeline, nextPlanned, parseAsk, planProgress } = await import("../../app/js/proposal.js");

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
  assert.equal(rows[1].start, at(12)); // 9:30-10:00 had room for b only
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
