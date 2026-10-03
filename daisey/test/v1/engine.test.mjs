// Daisey v1 Now engine. Run: node --test "daisey/test/v1/*.test.mjs"
// Times are built in local time, like the engine reads them, so these pass
// in any timezone.
import test from "node:test";
import assert from "node:assert/strict";
import * as E from "../../app/js/engine.js";
import * as W from "../../app/js/weights.js";

const at = (d, h = 10, m = 0) => new Date(2026, 9, d, h, m).getTime(); // Oct 2026; the 5th is a Monday
const NOW = at(5);
let seq = 0;
const task = (o = {}) => ({
  id: `t${++seq}`, project: "P", title: "Task", size: 30, energy: "medium",
  due: null, dueTime: null, status: "ready", canSplit: false,
  createdAt: NOW, touchedAt: NOW, skipsSinceStart: 0, spentMinutes: 0, ...o,
});
const moment = (o = {}) => E.readMoment({ now: NOW, window: 60, energy: "medium", ...o });
const parts = (t, o) => E.scoreTask(t, moment(o)).parts;

// ---------- step 1 ----------

test("moment: no calendar → 60 min, energy defaults to medium, window capped at 180", () => {
  const m = E.readMoment({ now: NOW });
  assert.equal(m.window, 60);
  assert.equal(m.energy, "medium");
  assert.equal(E.readMoment({ now: NOW, window: 400 }).window, 180);
  assert.equal(E.readMoment({ now: NOW, window: 0 }).window, 0);
  assert.equal(E.readMoment({ now: NOW, window: "25" }).window, 25);
  assert.equal(E.readMoment({ now: NOW, energy: "LOW" }).energy, "low");
});

test("moment: time bucket edges, Friday + Saturday are the weekend", () => {
  assert.equal(E.timeBucket(at(5, 11, 59)).part, "morning");
  assert.equal(E.timeBucket(at(5, 12)).part, "afternoon");
  assert.equal(E.timeBucket(at(5, 16, 59)).part, "afternoon");
  assert.equal(E.timeBucket(at(5, 17)).part, "evening");
  assert.equal(E.timeBucket(at(5)).weekend, false); // Mon
  assert.equal(E.timeBucket(at(9)).weekend, true); // Fri
  assert.equal(E.timeBucket(at(10)).weekend, true); // Sat
  assert.equal(E.timeBucket(at(11)).weekend, false); // Sun
});

// ---------- step 2 ----------

test("filter: waiting, done, stale, skipped this session, high task on low energy", () => {
  const m = moment({ energy: "low", sessionSkips: ["skip"] });
  assert.equal(E.filterOut(task({ status: "waiting" }), m), "waiting");
  assert.equal(E.filterOut(task({ status: "done" }), m), "done");
  assert.equal(E.filterOut(task({ skipsSinceStart: W.STALE_SKIPS }), m), "stale");
  assert.equal(E.filterOut(task({ skipsSinceStart: W.STALE_SKIPS - 1 }), m), null);
  assert.equal(E.filterOut(task({ id: "skip" }), m), "skipped");
  assert.equal(E.filterOut(task({ energy: "high" }), m), "energy");
  assert.equal(E.filterOut(task({ energy: "high" }), moment()), null);
});

test("filter: bigger than the window is out, unless it can split and the window is 25+", () => {
  assert.equal(E.filterOut(task({ size: 60 }), moment({ window: 60 })), null);
  assert.equal(E.filterOut(task({ size: 61 }), moment({ window: 60 })), "size");
  assert.equal(E.filterOut(task({ size: 90, canSplit: true }), moment({ window: 25 })), null);
  assert.equal(E.filterOut(task({ size: 90, canSplit: true }), moment({ window: 24 })), "size");
});

// ---------- urgency, one test per table row ----------

test("urgency: overdue → 35 (past date, or today's due time passed)", () => {
  assert.equal(parts(task({ due: "2026-10-04" })).urgency, 35);
  assert.equal(parts(task({ due: "2026-10-05", dueTime: "09:00" })).urgency, 35);
});

test("urgency: due today and tight for its size → hard → 35", () => {
  // 20:30 → 90 waking min left × 0.25 = 22.5 < 30 min × 2
  assert.equal(parts(task({ due: "2026-10-05" }), { now: at(5, 20, 30) }).urgency, 35);
  // 11:00 deadline, 60 min away: 15 < 60
  assert.equal(parts(task({ due: "2026-10-05", dueTime: "11:00" })).urgency, 35);
});

test("urgency: due today with room to spare → soft → 20", () => {
  // 10:00 → 720 waking min × 0.25 = 180 ≥ 60
  assert.equal(parts(task({ due: "2026-10-05" })).urgency, 20);
  // the same due goes hard as the day runs out
  assert.equal(parts(task({ due: "2026-10-05" }), { now: at(5, 18) }).urgency, 20); // 60 ≥ 60
  assert.equal(parts(task({ due: "2026-10-05" }), { now: at(5, 18, 30) }).urgency, 35);
});

test("urgency: due later but tight → hard → 25; bigger tasks go hard sooner", () => {
  // tomorrow 10:00: 780 waking min × 0.25 = 195 < 120 × 2
  const big = task({ size: 120, due: "2026-10-06", dueTime: "10:00" });
  assert.equal(parts(big).urgency, 25);
  assert.equal(parts({ ...big, size: 30 }).urgency, 12); // same due, small task: not tight
  // work already done counts: 120 − 90 spent = 30 left
  assert.equal(parts({ ...big, spentMinutes: 90 }).urgency, 12);
  // tight beats distance: 10 h of work due in 5 days
  assert.equal(parts(task({ size: 600, due: "2026-10-10" })).urgency, 25);
});

test("urgency: within 3 days → 12, within 7 → 6, later or none → 0", () => {
  assert.equal(parts(task({ due: "2026-10-06" })).urgency, 12);
  assert.equal(parts(task({ due: "2026-10-08" })).urgency, 12);
  assert.equal(parts(task({ due: "2026-10-09" })).urgency, 6);
  assert.equal(parts(task({ due: "2026-10-12" })).urgency, 6);
  assert.equal(parts(task({ due: "2026-10-13" })).urgency, 0);
  assert.equal(parts(task()).urgency, 0);
});

test("isTight and wakingMinutes count only 09:00–22:00", () => {
  assert.equal(E.wakingMinutes(at(5, 7), at(5, 23)), 13 * 60);
  assert.equal(E.wakingMinutes(at(5, 21), at(6, 10)), 60 + 60);
  assert.equal(E.isTight(task(), NOW), false); // no due
  assert.equal(E.isTight(task({ due: "2026-10-04" }), NOW), true);
});

// ---------- other factors ----------

test("energy fit: exact 25, one step easier 18, two steps easier 12, one step harder 5", () => {
  assert.equal(parts(task({ energy: "medium" })).energy, 25);
  assert.equal(parts(task({ energy: "low" })).energy, 18);
  assert.equal(parts(task({ energy: "low" }), { energy: "high" }).energy, 12);
  assert.equal(parts(task({ energy: "high" })).energy, 5);
  assert.equal(parts(task({ energy: "medium" }), { energy: "low" }).energy, 5);
});

test("window fit: 50–100% 15, 25–50% 10, under 25% 6, split piece 8", () => {
  assert.equal(parts(task({ size: 30 })).window, 15);
  assert.equal(parts(task({ size: 60 })).window, 15);
  assert.equal(parts(task({ size: 15 })).window, 10);
  assert.equal(parts(task({ size: 29 })).window, 10);
  assert.equal(parts(task({ size: 10 })).window, 6);
  assert.equal(parts(task({ size: 90, canSplit: true })).window, 8);
});

test("momentum: last project today 10 (any case), recent project 5, else 0", () => {
  assert.equal(parts(task({ project: "Monster Punk" }), { lastProject: "monster punk" }).momentum, 10);
  assert.equal(parts(task({ project: "Reprise" }), { recentProjects: ["Reprise"] }).momentum, 5);
  assert.equal(parts(task(), { lastProject: "Other", recentProjects: ["Else"] }).momentum, 0);
});

test("neglect: +1 per whole day untouched, max 10", () => {
  assert.equal(parts(task()).neglect, 0);
  assert.equal(parts(task({ touchedAt: NOW - 3.5 * 864e5 })).neglect, 3);
  assert.equal(parts(task({ touchedAt: NOW - 20 * 864e5 })).neglect, 10);
});

test("learned fit is clamped to −10…10 and 0 until session 10 supplies it", () => {
  assert.equal(parts(task()).learned, 0);
  assert.equal(parts(task(), { learned: () => 25 }).learned, 10);
  assert.equal(parts(task(), { learned: () => -30 }).learned, -10);
});

test("skip penalty: −8 per skip today; the score is the sum of all parts", () => {
  const t = task();
  const s = E.scoreTask(t, moment({ skipsToday: { [t.id]: 2 } }));
  assert.equal(s.parts.skips, -16);
  assert.equal(s.score, 0 + 25 + 15 + 0 + 0 + 0 - 16);
  assert.equal(s.parts.today, 0);
});

// ---------- ranking ----------

test("tie-break: sooner due first, then smaller size", () => {
  const later = task({ due: "2026-10-20" }), sooner = task({ due: "2026-10-14" }); // both 0 urgency
  assert.deepEqual(E.rank([later, sooner], { now: NOW }).ranked.map((s) => s.task.id), [sooner.id, later.id]);
  const big = task({ size: 60 }), small = task({ size: 30 }); // both fill 50–100% of 60
  assert.deepEqual(E.rank([big, small], { now: NOW }).ranked.map((s) => s.task.id), [small.id, big.id]);
  const dated = task({ due: "2026-10-20" }), undated = task();
  assert.equal(E.rank([undated, dated], { now: NOW }).pick.task.id, dated.id);
});

test("something else: next by score, but another project within 15 points goes first", () => {
  const s = (project, score) => ({ task: { project }, score });
  const ranked = [s("A", 100), s("A", 95), s("B", 85), s("A", 80), s("C", 60)];
  assert.deepEqual(E.somethingElse(ranked).map((x) => x.task.project + x.score), ["B85", "A95", "A80"]);
  // nothing else close enough → plain score order
  const far = [s("A", 100), s("A", 95), s("B", 70)];
  assert.deepEqual(E.somethingElse(far).map((x) => x.task.project + x.score), ["A95", "B70"]);
  assert.deepEqual(E.somethingElse([]), []);
  assert.equal(E.somethingElse(ranked, 2).length, 2);
});

test("rank: stale tasks are listed for the keep/shrink/drop question", () => {
  const stale = task({ skipsSinceStart: 5 });
  const r = E.rank([stale, task()], { now: NOW });
  assert.deepEqual(r.stale.map((t) => t.id), [stale.id]);
  assert.equal(r.ranked.length, 1);
});

test("empty states: no open tasks → none; nothing fits → nofit", () => {
  assert.equal(E.rank([], { now: NOW }).empty, "none");
  assert.equal(E.rank([task({ status: "done" })], { now: NOW }).empty, "none");
  const r = E.rank([task({ size: 30 }), task({ status: "waiting" })], { now: NOW, window: 10 });
  assert.equal(r.empty, "nofit");
  assert.equal(r.pick, null);
  assert.deepEqual(r.out.map((o) => o.reason), ["size", "waiting"]);
  assert.equal(E.rank([task()], { now: NOW }).empty, null);
});

// ---------- why line ----------

const why = (t, o) => E.rank([t], { now: NOW, ...o }).pick.why;

test("why: top factors in points order, as one sentence", () => {
  // energy 25, window 15 (15 of 20 min), urgency 12
  assert.equal(why(task({ size: 15, energy: "low", due: "2026-10-07" }), { window: 20, energy: "low" }),
    "Light one, you're low, fills your free 20 min, due Wednesday.");
  assert.equal(why(task({ size: 45, energy: "high" }), { energy: "high" }), "Good for high energy, fills your free hour.");
});

test("why: urgency phrases — overdue, today, tomorrow, weekday, date, getting tight", () => {
  assert.match(why(task({ due: "2026-10-01" })), /^Overdue, /);
  assert.match(why(task({ due: "2026-10-05" })), /due today/);
  assert.match(why(task({ due: "2026-10-05", dueTime: "11:00" })), /^Due today 11:00, getting tight, /);
  assert.match(why(task({ due: "2026-10-06" })), /due tomorrow/);
  assert.match(why(task({ size: 120, canSplit: true, due: "2026-10-06", dueTime: "10:00" }), { window: 180 }), /due tomorrow, getting tight/i);
  assert.match(why(task({ size: 600, canSplit: true, due: "2026-10-09" }), { window: 180 }), /^Due Friday, getting tight/);
  assert.doesNotMatch(why(task({ due: "2026-10-13" })), /due/i); // 0 points, not a reason
});

test("why: window, momentum, neglect, learned, next event phrases", () => {
  assert.match(why(task({ size: 5 })), /quick one/);
  assert.match(why(task({ size: 90, canSplit: true }), { window: 45 }), /a piece fits your 45 min/);
  assert.match(why(task({ size: 30 }), { window: 90 }), /fits your 1.5 h/);
  assert.match(why(task({ size: 30, energy: "high", project: "Monster Punk" }), { lastProject: "Monster Punk" }), /keeps Monster Punk going/);
  assert.match(why(task({ energy: "high", size: 5, touchedAt: NOW - 6 * 864e5 })), /untouched for 6 days/);
  assert.match(why(task({ energy: "high", size: 5 }), { learned: () => 9 }), /you usually do these in the morning/i);
  assert.match(why(task({ size: 40 }), { nextEvent: "teaching" }), /fits before teaching/);
});

test("why: weak factors (a stretch on energy, a little neglect) are never reasons; max 3 parts", () => {
  const w = why(task({ energy: "high", size: 5, touchedAt: NOW - 2 * 864e5 }));
  assert.equal(w, "Quick one."); // energy 5 (harder) has no phrase, neglect 2 < 5
  const full = why(task({ size: 30, due: "2026-10-05", project: "X", touchedAt: NOW - 8 * 864e5 }), { lastProject: "X" });
  assert.equal(full.split(", ").length, 3);
});

// ---------- Mor's session-3 check, as a test ----------

test("scenario: '20 min, low' picks a light short task; '2 h, high' picks the deep work", () => {
  const tasks = [
    task({ title: "Mix review for Reprise", project: "Reprise", size: 90, energy: "high", canSplit: true, due: "2026-10-08" }),
    task({ title: "Reply to Uri", project: "Admin", size: 5, energy: "low" }),
    task({ title: "Invoice for September", project: "Admin", size: 15, energy: "low", due: "2026-10-06" }),
    task({ title: "Boss loop fix", project: "Monster Punk", size: 60, energy: "medium" }),
    task({ title: "Lesson prep", project: "Teaching", size: 30, energy: "medium", due: "2026-10-07" }),
  ];
  const low = E.rank(tasks, { now: NOW, window: 20, energy: "low" });
  assert.equal(low.pick.task.title, "Invoice for September");
  assert.ok(low.out.some((o) => o.task.title === "Mix review for Reprise" && o.reason === "energy"));
  assert.ok(low.out.some((o) => o.task.title === "Boss loop fix" && o.reason === "size"));

  const high = E.rank(tasks, { now: NOW, window: 120, energy: "high" });
  assert.equal(high.pick.task.title, "Mix review for Reprise");
  assert.ok(high.alternatives.every((s) => s.task.project !== "Reprise"));
});

// ---------- energy (session 3/4 version) ----------

import { currentEnergy, CORRECTION_HOLD } from "../../app/js/energy.js";

test("energy: a correction wins for 3 hours, then it's a Medium guess again", () => {
  assert.deepEqual(currentEnergy({ now: NOW }), { level: "medium", guessed: true });
  const correction = { level: "low", at: NOW };
  assert.deepEqual(currentEnergy({ now: NOW + CORRECTION_HOLD - 1, correction }), { level: "low", guessed: false });
  assert.deepEqual(currentEnergy({ now: NOW + CORRECTION_HOLD, correction }), { level: "medium", guessed: true });
  assert.deepEqual(currentEnergy({ now: NOW, correction: { level: "wrecked", at: NOW } }), { level: "medium", guessed: true });
});

test("today's picks: +20 and a why phrase; a picked task beats an equal unpicked one", () => {
  const a = task(), b = task();
  const r = E.rank([a, b], { now: NOW, todayPicks: [b.id] });
  assert.equal(r.pick.task.id, b.id);
  assert.equal(r.pick.parts.today, W.TODAY_PICK);
  assert.match(r.pick.why, /on today's list/);
  // an overdue task still outranks a plain pick
  const late = task({ due: "2026-10-01" });
  assert.equal(E.rank([b, late], { now: NOW, todayPicks: [b.id] }).pick.task.id, late.id);
});
