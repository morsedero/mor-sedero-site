// The tracker profile (profile.js) and what the planner does with it
// (proposal.js, 2026-11-15): focus hours, capacity, size correction, and
// ranking each pick at the slot it lands in.
import test from "node:test";
import assert from "node:assert/strict";
process.env.TZ = "Asia/Jerusalem";
const P = await import("../../app/js/profile.js");
const { proposeDay, timeline } = await import("../../app/js/proposal.js");

const at = (h, m = 0) => Date.UTC(2026, 9, 7, h - 3, m);
const il = (h, m = 0) => new Date(at(h, m)).toISOString();
const t = (o) => ({ id: o.id || String(Math.random()), title: "Task", status: "ready", type: "deep", due: "2026-10-30", dateKind: "target", size: 30, spentMinutes: 0, createdAt: at(0), ...o });
const ev = (title, s, e) => ({ id: title, title, start: il(...s), end: il(...e), busy: true });

// Fourteen days (2026-09-23 .. 2026-10-06) of tracker summaries. spans: [[fromHour, toHour, app, detail]].
const dates = Array.from({ length: 14 }, (_, i) => new Date(Date.UTC(2026, 8, 23 + i)).toISOString().slice(0, 10));
const day = (date, spans) => ({ date, dayStartMinute: 0, timeline: spans.map(([a, b, app = "Code.exe", det = "Reprise"]) => [a * 60, b * 60, app, det]) });
const week = (spans, n = 14) => Object.fromEntries(dates.slice(0, n).map((d) => [d, [day(d, spans)]]));
const build = (days, tasks = []) => P.buildProfile({ days, tasks, today: "2026-10-07", now: at(9) });
// Works 14:00–16:00 flat out, 09:00–09:30 a little: the peak is mid-afternoon.
const AFTERNOONER = [[9, 9.5], [14, 16]];

test("too little tracker data says nothing", () => {
  const p = build(week(AFTERNOONER, 2));
  assert.equal(p.ok, false);
  assert.equal(P.focusLevel(p, at(15)), null);
  assert.equal(P.capacityFor(p, at(15)), null);
  assert.equal(P.sizeFactor(p, t({ project: "Reprise" })), 1);
  assert.equal(P.focusFit(p, t({}), at(15), 60), 0);
  assert.equal(P.estimate(p, t({ project: "Reprise" }), 60), 60);
});

test("focus curve: the work hours peak, the thin ones are low, and the night is nothing", () => {
  const p = build(week(AFTERNOONER));
  assert.equal(p.ok, true);
  assert.ok(P.focusLevel(p, at(15)) >= 0.75);
  assert.equal(P.focusBand(p, at(15)), "peak");
  assert.equal(P.focusBand(p, at(9)), "low");
  assert.equal(P.focusLevel(p, at(3)), 0);
  // Deep work is worth more in the peak than in a thin hour; a quick task the reverse.
  const deep = t({ size: 90 }), quick = t({ size: 10, type: "admin" });
  assert.ok(P.focusFit(p, deep, at(15), 90) > 0 && P.focusFit(p, deep, at(9), 90) < 0);
  assert.ok(P.focusFit(p, quick, at(9), 10) > 0 && P.focusFit(p, quick, at(15), 10) < 0);
  assert.equal(P.whyHere(p, deep, at(15), 90), "peak");
  assert.equal(P.whyHere(p, quick, at(9), 10), "low");
  assert.equal(P.whyHere(p, deep, at(9), 90), null);
});

test("capacity: the median real work day, stretched, with the day so far taken off", () => {
  const p = build(week([[9, 13]])); // 240 min a day
  assert.equal(P.capacityFor(p, at(9)), Math.round(240 * 1.15));
  const busy = P.buildProfile({ days: { ...week([[9, 13]]), "2026-10-07": [day("2026-10-07", [[6.5, 10.5]])] }, today: "2026-10-07", now: at(11) });
  assert.equal(busy.worked, 240);
  assert.equal(P.capacityLeft(busy, at(11)), 45); // a full day still takes a light finish
  // A light week never asks under the floor.
  assert.equal(P.capacityFor(build(week([[9, 10]])), at(9)), 120);
});

test("leisure apps and sites are not work; two PCs count a minute once", () => {
  const spans = [[9, 11, "Code.exe", "Reprise"], [11, 13, "Spotify.exe", ""], [13, 15, "chrome.exe", "youtube.com"]];
  const days = Object.fromEntries(dates.map((d) => [d, [day(d, spans), day(d, [[9, 10, "Code.exe", "Reprise"]])]]));
  assert.equal(P.capacityFor(build(days), at(9)), 138); // 120 min, floored/stretched: 120 × 1.15
});

test("size factor: a project that takes longer than said is planned longer; few samples or noise change nothing", () => {
  const done = (project, size, spent, n) => Array.from({ length: n }, (_, i) => t({ id: `d${project}${i}`, project, size, spentMinutes: spent, status: "done", doneAt: at(9) - (i + 1) * 864e5 }));
  const p = build(week(AFTERNOONER), [...done("Reprise", 60, 90, 4), ...done("Admin", 30, 31, 5), ...done("Mix", 60, 120, 2), ...done("Huge", 10, 100, 6)]);
  assert.ok(P.sizeFactor(p, t({ project: "Reprise" })) > 1.2 && P.sizeFactor(p, t({ project: "Reprise" })) <= 1.6);
  assert.equal(P.sizeFactor(p, t({ project: "reprise" })), P.sizeFactor(p, t({ project: "Reprise" }))); // case-insensitive
  assert.equal(P.sizeFactor(p, t({ project: "Admin" })), 1); // noise
  assert.equal(P.sizeFactor(p, t({ project: "Mix" })), 1); // two samples
  assert.equal(P.sizeFactor(p, t({ project: "Huge" })), 1.6); // clamped
  assert.equal(P.estimate(p, t({ project: "Reprise" }), 60), Math.round(60 * P.sizeFactor(p, t({ project: "Reprise" })) / 5) * 5);
});

test("size factor falls back to the tracker's own minutes on the project", () => {
  // 4 finished tasks of 30 min with no logged time; the tracker saw 4 h a day on "Reprise".
  const done = Array.from({ length: 4 }, (_, i) => t({ id: `x${i}`, project: "Reprise", size: 30, status: "done", doneAt: at(9) - 864e5 }));
  const p = build(week([[9, 11, "Code.exe", "Reprise"]]), done);
  assert.equal(P.sizeFactor(p, t({ project: "Reprise" })), 1.6); // 28 h seen against 2 h said, clamped
});

test("switch cost: hopping between projects reads high, staying in one reads zero", () => {
  const hop = []; for (let h = 9; h < 13; h += 0.25) hop.push([h, h + 0.25, "Code.exe", h % 0.5 ? "Reprise" : "Monster Punk"]);
  assert.ok(build(week(hop)).switchCost > 0.5);
  assert.equal(build(week([[9, 13, "Code.exe", "Reprise"]])).switchCost, 0);
});

// ---------- the planner ----------

test("no tracker data: the plan is the one it was without a profile", () => {
  const tasks = [t({ id: "a", size: 60 }), t({ id: "b", size: 30, type: "admin" }), t({ id: "c", size: 45, due: "2026-10-09" })];
  const events = [ev("Teaching", [11], [12])];
  const plain = proposeDay({ tasks, events, now: at(9) });
  assert.deepEqual(proposeDay({ tasks, events, now: at(9), profile: build(week(AFTERNOONER, 1)) }), plain);
  assert.deepEqual(proposeDay({ tasks, events, now: at(9), profile: null }), plain);
  assert.equal(plain.length, 3);
});

test("each pick is ranked at the slot it lands in: a type you do in the evening lands in the evening", () => {
  // Morning gap fits one 30; evening fits one 30. C leads in the morning; A (a call) is what you
  // do in the evening and skip in the morning; B is plain but a little ahead of A on points.
  const tasks = [t({ id: "C", size: 30, due: "2026-10-08", dateKind: "deadline" }),
    t({ id: "A", size: 30, type: "call" }), t({ id: "B", size: 30, type: "deep", due: "2026-10-12" })];
  const events = [ev("Teaching", [9, 45], [18])];
  const learnStats = { "call|morning": { starts: 0, skips: 30, at: at(9) }, "call|evening": { starts: 30, skips: 0, at: at(9) } };
  const items = proposeDay({ tasks, events, now: at(9), learnStats });
  const rows = timeline(items, { tasks, events, now: at(9) }).rows;
  // Scored all at the first free minute, A (−9 in the morning) came after B; at its own slot it leads.
  assert.deepEqual(rows.map((r) => r.taskId), ["C", "A", "B"]);
  assert.ok(rows[1].start >= at(18));
});

test("the morning is filled: deep work isn't held back for the focus peak, and fits whole", () => {
  const p = build(week(AFTERNOONER));
  const tasks = [t({ id: "deep", size: 90, title: "Mix review" }), t({ id: "q1", size: 10, type: "admin" }), t({ id: "q2", size: 15, type: "admin" })];
  const items = proposeDay({ tasks, events: [], now: at(9), profile: p });
  const rows = timeline(items, { tasks, events: [], now: at(9) }).rows;
  // No hole at the start: the first task begins right at the first free minute.
  assert.ok(Math.min(...rows.map((r) => r.start)) <= at(9) + 5 * 60000, "morning not left empty");
  // Every task is laid back to back, none left for later: no gap between rows beyond a break.
  const sorted = [...rows].sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i].start - sorted[i - 1].end <= 15 * 60000, "no hole between tasks");
  // The deep task is whole, not cut to a piece.
  const deep = items.find((i) => i.taskId === "deep");
  assert.ok(deep && deep.minutes === 90 && !deep.of, "deep task whole");
});

test("a plan asks no more than a day of yours holds", () => {
  const tasks = Array.from({ length: 8 }, (_, i) => t({ id: `k${i}`, size: 30, type: "admin", title: `T${i}` }));
  const free = proposeDay({ tasks, events: [], now: at(9) }).reduce((s, i) => s + i.minutes, 0);
  const capped = proposeDay({ tasks, events: [], now: at(9), profile: build(week([[9, 11, "Code.exe", "x"]])) }).reduce((s, i) => s + i.minutes, 0);
  assert.equal(free, 240);
  assert.ok(capped <= 138 && capped >= 90, `capped ${capped}`); // median 120 min, stretched to 138
  const more = proposeDay({ tasks, events: [], now: at(9), profile: build(week([[9, 11, "Code.exe", "x"]])), ask: { more: true } }).reduce((s, i) => s + i.minutes, 0);
  assert.ok(more > capped);
});

test("a deadline due today still comes when the day is full", () => {
  const tasks = [...Array.from({ length: 4 }, (_, i) => t({ id: `k${i}`, size: 30 })), t({ id: "due", size: 30, due: "2026-10-07", dateKind: "deadline" })];
  const items = proposeDay({ tasks, events: [], now: at(9), profile: build(week([[9, 10, "Code.exe", "x"]])) });
  assert.ok(items.some((i) => i.taskId === "due"));
});

test("a size correction plans the task longer, and the timeline lays it that long", () => {
  const done = Array.from({ length: 4 }, (_, i) => t({ id: `d${i}`, project: "Reprise", size: 60, spentMinutes: 90, status: "done", doneAt: at(9) - 864e5 }));
  const p = build(week(AFTERNOONER), done);
  const tasks = [...done, t({ id: "m", project: "Reprise", size: 60, title: "Mix" })];
  const items = proposeDay({ tasks, events: [], now: at(9), profile: p });
  const it = items.find((i) => i.taskId === "m");
  assert.ok(it.minutes > 60 && it.k > 1, JSON.stringify(it));
  const row = timeline(items, { tasks, events: [], now: at(9) }).rows.find((r) => r.taskId === "m");
  assert.equal(row.minutes, it.minutes);
  assert.equal(row.of, undefined); // longer than said, not "shortened from"
});
