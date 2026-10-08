// Routines (routine.js, 2026-10-08): so many times a week, Done logs a session.
import test from "node:test";
import assert from "node:assert/strict";
process.env.TZ = "Asia/Jerusalem";
const R = await import("../../app/js/routine.js");
const { createTask, completeTask, workedTask, editTask, doneSnapshot } = await import("../../app/js/model.js");
const { rank } = await import("../../app/js/engine.js");

// Thursday 2026-10-08; its week runs Sunday 10-04 to Saturday 10-10.
const at = (day, h = 10, m = 0) => { const [y, mo, d] = day.split("-").map(Number); return new Date(y, mo - 1, d, h, m).getTime(); };
const THU = at("2026-10-08");
const gym = (over = {}) => ({ id: "g", ...createTask({ title: "Exercise", size: 45, routine: { per: 3 } }, { now: at("2026-10-01") }), ...over });
const ev = (title, day, h, len = 60, extra = {}) => ({ id: `${title}@${day}${h}`, title, start: new Date(at(day, h)).toISOString(), end: new Date(at(day, h, len)).toISOString(), busy: true, ...extra });

test("week math: Sunday start, days left, until cuts it short", () => {
  assert.equal(R.weekStart("2026-10-08"), "2026-10-04");
  assert.equal(R.weekStart("2026-10-04"), "2026-10-04");
  assert.equal(R.daysLeft(gym(), "2026-10-08"), 3); // Thu, Fri, Sat
  assert.equal(R.daysLeft(gym({ routine: { per: 2, until: "2026-10-09", log: [] } }), "2026-10-08"), 2);
});

test("a new routine is cleaned; a bad one isn't a routine", () => {
  assert.deepEqual(gym().routine, { per: 3, until: null, log: [] });
  assert.equal(createTask({ title: "x", routine: { per: 0 } }).routine, null);
  assert.equal(createTask({ title: "x" }).routine, null);
  assert.equal(createTask({ title: "x", routine: { per: 12 } }).routine.per, 7);
});

test("Done logs a session and keeps it open; off the card till tomorrow", () => {
  const p = completeTask(gym(), { now: THU });
  assert.equal(p.status, "ready");
  assert.equal(p.notBefore, "2026-10-09");
  assert.deepEqual(p.routine.log, [{ day: "2026-10-08" }]);
  assert.equal(p.progress, 0);
});

test("the week met: off till Sunday; a missed week isn't carried", () => {
  const t = gym({ routine: { per: 3, until: null, log: [{ day: "2026-10-05" }, { day: "2026-10-06" }] } });
  const p = completeTask(t, { now: THU });
  assert.equal(p.notBefore, "2026-10-11");
  assert.equal(R.doneThisWeek({ ...t, ...p }, "2026-10-11"), 0);
});

test("timed session: minutes go in the log, spent time resets", () => {
  const p = workedTask(gym({ spentMinutes: 10 }), 40, { finished: true, now: THU });
  assert.equal(p.spentMinutes, 0);
  assert.equal(p.routine.log[0].min, 50);
});

test("past until: finished for good", () => {
  const t = gym({ routine: { per: 1, until: "2026-10-09", log: [] } });
  const p = completeTask(t, { now: THU }); // week met → Sunday, past the end
  assert.equal(p.status, "done");
});

test("Undo snapshot puts the routine back as it was", () => {
  const t = gym({ notBefore: null });
  const p = completeTask(t, { now: THU });
  const back = { ...t, ...p, ...doneSnapshot(t) };
  assert.deepEqual(back.routine, t.routine);
  assert.equal(back.notBefore, null);
});

test("editTask: make it a routine, change per, keep the log, turn it off", () => {
  const plain = createTask({ title: "Band practice" }, { now: THU });
  const on = editTask(plain, { routine: { per: 2, until: "2026-11-20" } }, { now: THU });
  assert.deepEqual(on.routine, { per: 2, until: "2026-11-20", log: [] });
  const t = { ...plain, ...on, routine: { ...on.routine, log: [{ day: "2026-10-05" }] } };
  assert.deepEqual(editTask(t, { routine: { per: 3 } }, { now: THU }).routine.log, [{ day: "2026-10-05" }]);
  assert.equal(editTask(t, { routine: null }, { now: THU }).routine, null);
});

test("calendar: Gym counts for Exercise, Rehearsal for Practice; Daisey's log and all-day don't", () => {
  const t = gym();
  assert.ok(R.eventIsRoutine({ title: "Gym" }, t));
  assert.ok(R.eventIsRoutine({ title: "Morning exercise" }, t));
  assert.ok(R.eventIsRoutine({ title: "Rehearsal" }, { title: "Band practice" }));
  assert.ok(!R.eventIsRoutine({ title: "✓ Exercise" }, t));
  assert.ok(!R.eventIsRoutine({ title: "Gym", allDay: true }, t));
  assert.ok(!R.eventIsRoutine({ title: "Dentist" }, t));
});

test("calendar: past sessions logged once a day, upcoming ones count as planned", () => {
  const t = gym({ routine: { per: 3, until: null, log: [{ day: "2026-10-06" }] } });
  const evs = [ev("Gym", "2026-10-06", 7), ev("Gym", "2026-10-08", 7), ev("Gym", "2026-10-08", 18), ev("Gym", "2026-10-10", 9), ev("Gym", "2026-10-12", 9)];
  const now = at("2026-10-08", 12);
  assert.deepEqual(R.eventsToLog(t, evs, now).map((e) => e.day), ["2026-10-08"]); // 10-06 already has one
  const c = R.calendarWeek(t, evs, now);
  assert.equal(c.ahead, 2); // today 18:00 and Saturday; next week's doesn't count
  assert.equal(c.today, true);
  const p = R.sessionPatch(t, { now, ev: R.eventsToLog(t, evs, now)[0] });
  assert.equal(p.routine.log.at(-1).ev, "Gym@2026-10-087");
  assert.equal(p.routine.log.at(-1).min, 60);
});

test("engine: behind on the week leans harder, with a why", () => {
  const base = { now: THU, window: 120 };
  const r0 = rank([gym()], base);
  assert.equal(r0.pick.parts.routine, 25); // 3 needed, 3 days left
  assert.match(r0.pick.why, /3 more this week, 3 days left/);
  const onPace = gym({ routine: { per: 3, until: null, log: [{ day: "2026-10-05" }, { day: "2026-10-06" }] } });
  const r1 = rank([onPace], base);
  assert.equal(r1.pick.parts.routine, 6); // 1 needed, 3 days left
  assert.match(r1.pick.why, /keeps your 3× a week going/i);
});

test("engine: not offered when the week is covered or a session is later today", () => {
  const t = gym({ routine: { per: 1, until: null, log: [{ day: "2026-10-05" }] } });
  assert.equal(rank([t], { now: THU }).out[0].reason, "routine");
  assert.equal(rank([gym()], { now: THU, routineCal: { g: { ahead: 1, today: true } } }).out[0].reason, "routine");
  assert.equal(rank([gym({ routine: { per: 3, until: "2026-10-07", log: [] } })], { now: THU }).pick, null); // past its end
});
