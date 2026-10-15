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

test("engine: a fresh week isn't behind; a Focus task comes before a Keep going routine", () => {
  // Mor, 2026-10-11 (a Sunday): a 4×-a-week routine came before a Focus task.
  const SUN = at("2026-10-11"), TUE = at("2026-10-13");
  const four = gym({ project: "Health", routine: { per: 4, until: null, log: [] } });
  assert.equal(rank([four], { now: SUN, window: 120 }).pick.parts.routine, 6, "day one: nothing missed yet");
  assert.equal(rank([four], { now: TUE, window: 120 }).pick.parts.routine, 14, "two days gone, none done: behind");
  const mix = { ...createTask({ title: "Mix", size: 45, project: "Album" }, { now: at("2026-10-01") }), id: "m" };
  const r = rank([four, mix], { now: SUN, window: 120, projectTiers: { Album: "focus", Health: "keep" } });
  assert.equal(r.pick.task.id, "m");
});

test("engine: not offered when the week is covered or a session is later today", () => {
  const t = gym({ routine: { per: 1, until: null, log: [{ day: "2026-10-05" }] } });
  assert.equal(rank([t], { now: THU }).out[0].reason, "routine");
  assert.equal(rank([gym()], { now: THU, routineCal: { g: { ahead: 1, today: true } } }).out[0].reason, "routine");
  assert.equal(rank([gym({ routine: { per: 3, until: "2026-10-07", log: [] } })], { now: THU }).pick, null); // past its end
});

// ---------- set days (2026-10-08) ----------
const own = (day, h, len = 60) => ev("🌼 Exercise", day, h, len, { id: `s_${day}`, taskId: "g" });

test("set days: per is how many days; time defaults", () => {
  const r = createTask({ title: "Exercise", routine: { days: [4, 1, 1], per: 5 } }).routine;
  assert.deepEqual(r.days, [1, 4]);
  assert.equal(r.per, 2);
  assert.equal(r.at, "18:00");
});

test("set days: a slot that's over is asked, not counted; counts as planned meanwhile", () => {
  const t = gym({ routine: { per: 2, days: [1, 4], at: "07:00", until: null, log: [] } });
  const evs = [own("2026-10-08", 7), own("2026-10-10", 7)];
  const now = at("2026-10-08", 12);
  assert.deepEqual(R.eventsToLog(t, evs, now), []); // never logged on its own
  assert.deepEqual(R.slotsToAsk(t, evs, now).map((e) => e.id), ["s_2026-10-08"]);
  assert.equal(R.calendarWeek(t, evs, now).ahead, 2); // Saturday + the unanswered one
  const skipped = { ...t, ...R.skipSlotPatch(t, "s_2026-10-08") };
  assert.deepEqual(R.slotsToAsk(skipped, evs, now), []);
  assert.equal(R.calendarWeek(skipped, evs, now).ahead, 1);
  const did = { ...t, ...R.sessionPatch(t, { ev: R.slotsToAsk(t, evs, now)[0], now }) };
  assert.deepEqual(R.slotsToAsk(did, evs, now), []);
});

test("set days: another task's Daisey block never counts, whatever its title", () => {
  assert.ok(!R.eventIsRoutine({ title: "🌼 Exercise", taskId: "other" }, gym()));
});

test("engine: a skipped slot → offered now despite the next booked one; a running slot is the card", () => {
  const t = gym({ routine: { per: 2, days: [1, 4], at: "07:00", until: null, log: [], skipped: ["s_2026-10-08"] } });
  const evs = [own("2026-10-08", 7), own("2026-10-10", 7)];
  const now = at("2026-10-08", 12);
  const m = { now, routineCal: R.routineCalendar([t], evs, now), booked: { g: at("2026-10-10", 7) } };
  assert.equal(rank([t], m).pick?.task.id, "g");
  const during = at("2026-10-10", 7, 20), t2 = gym({ routine: { per: 2, days: [1, 4], at: "07:00", until: null, log: [{ day: "2026-10-08" }] } });
  assert.equal(rank([t2], { now: during, routineCal: R.routineCalendar([t2], evs, during) }).pick?.task.id, "g");
});

test("seriesSig: null without set days; changes with time or title", () => {
  assert.equal(R.seriesSig(gym()), null);
  const t = gym({ routine: { per: 2, days: [1, 4], at: "07:00", log: [] } });
  assert.notEqual(R.seriesSig(t), R.seriesSig({ ...t, routine: { ...t.routine, at: "08:00" } }));
  assert.notEqual(R.seriesSig(t), R.seriesSig({ ...t, title: "Gym" }));
});

test("monthly: N times a calendar month, met waits for the 1st", () => {
  const t = gym({ routine: R.cleanRoutine({ per: 2, every: "month", days: [1], log: [{ day: "2026-10-02" }] }) });
  assert.equal(t.routine.every, "month");
  assert.equal(t.routine.days, undefined); // set days are a weekly thing
  assert.equal(R.doneThisWeek(t, "2026-10-08"), 1);
  assert.equal(R.daysLeft(t, "2026-10-08"), 24);
  assert.equal(R.weekLine(t, "2026-10-08"), "1 of 2 this month");
  const s = R.weekState(t, "2026-10-08");
  assert.deepEqual([s.need, s.gone, s.len, s.word], [1, 7, 31, "month"]);
  const p = R.sessionPatch(t, { now: THU });
  assert.equal(p.notBefore, "2026-11-01");
  assert.equal(p.routine.every, "month");
  assert.equal(R.routineChange(t, { per: 3 }).routine.every, "month"); // a partial change keeps the month
  assert.equal(R.routineChange(t, { per: 3, every: null }).routine.every, undefined);
  assert.equal(R.cleanRoutine({ per: 30, every: "month" }).per, R.PER_MAX_MONTH);
});

test("event repeat: the write function builds only known RRULEs", async () => {
  const { createRequire } = await import("node:module");
  const req = createRequire(import.meta.url);
  const Module = req("node:module");
  const load = Module._load;
  Module._load = function (name, ...rest) { return /blobs|firebase-auth|tokens/.test(name) ? {} : load.call(this, name, ...rest); };
  const { recurrenceRule } = req("../../functions/daisey-now-calendar-write.js");
  Module._load = load;
  assert.equal(recurrenceRule({ days: ["MO", "TH"], until: "2026-12-01" }), "RRULE:FREQ=WEEKLY;BYDAY=MO,TH;UNTIL=20261201T235959Z");
  assert.equal(recurrenceRule({ freq: "DAILY" }), "RRULE:FREQ=DAILY");
  assert.equal(recurrenceRule({ freq: "MONTHLY", nth: 2, days: ["TH"] }), "RRULE:FREQ=MONTHLY;BYDAY=2TH");
  assert.equal(recurrenceRule({ freq: "MONTHLY", nth: -1, days: ["TH"] }), "RRULE:FREQ=MONTHLY;BYDAY=-1TH");
  assert.equal(recurrenceRule({ freq: "MONTHLY", monthDay: 12 }), "RRULE:FREQ=MONTHLY;BYMONTHDAY=12");
  assert.equal(recurrenceRule({ freq: "YEARLY" }), "RRULE:FREQ=YEARLY");
  assert.equal(recurrenceRule({ freq: "MONTHLY" }), null);
  assert.equal(recurrenceRule({ freq: "WEEKLY", days: ["XX"] }), null);
});

test("monthly by date: once a month on its day, waits till next month's", () => {
  const t = gym({ notBefore: "2026-10-31", routine: R.cleanRoutine({ per: 5, every: "month", on: "2026-10-31", log: [] }) });
  assert.equal(t.routine.per, 1);
  assert.equal(R.onDayIn(t.routine, "2026-11-05"), "2026-11-30"); // a short month: its last day
  assert.equal(R.weekState(t, "2026-10-20").daysLeft, 12);
  assert.equal(R.weekState(t, "2026-10-31").daysLeft, 1);
  assert.equal(R.weekState(t, "2026-10-31").on, "2026-10-31");
  const p = R.sessionPatch(t, { now: at("2026-10-31") });
  assert.equal(p.notBefore, "2026-11-30");
  assert.equal(p.routine.on, "2026-10-31");
});

// The nag (2026-10-15): behind pace every NAG_GAP days; Thursday on, tight, every day.
test("nag: behind pace every other day, late every day, Later shuts it", () => {
  const pt = (log = [], over = {}) => ({ id: "p", ...createTask({ title: "Portuguese", size: 15, routine: { per: 3, log } }, { now: at("2026-10-01") }), ...over });
  const d = (n) => ({ day: `2026-10-0${n}` }); // 4 = Sunday
  // Mon, Tue at 0 of 3: not behind yet.
  assert.equal(R.nagFor([pt()], { day: "2026-10-05" }), null);
  assert.equal(R.nagFor([pt()], { day: "2026-10-06" }), null);
  // Wed at 0 of 3: behind, not late; every NAG_GAP days.
  const wed = R.nagFor([pt()], { day: "2026-10-07" });
  assert.equal(wed.late, false);
  assert.equal(R.nagText(wed), "Portuguese, 15 min · 0 of 3 this week");
  assert.equal(R.nagFor([pt()], { day: "2026-10-07", seen: d(6) }), null);
  assert.ok(R.nagFor([pt()], { day: "2026-10-07", seen: d(5) }));
  assert.ok(R.nagFor([pt()], { day: "2026-10-07", seen: d(7) })); // today's stays
  // On pace: nothing.
  assert.equal(R.nagFor([pt([d(5)])], { day: "2026-10-07" }), null);
  // Thu at 1 of 3: 2 left in 3 days, late, daily.
  const thu = R.nagFor([pt([d(5)])], { day: "2026-10-08", seen: d(7) });
  assert.equal(thu.late, true);
  assert.equal(R.nagText(thu), "Portuguese, 15 min · 2 to go, 3 days left");
  assert.equal(R.nagText(R.nagFor([pt([d(5), d(7)])], { day: "2026-10-10" })), "Portuguese, 15 min · 1 to go, last day");
  // Later shuts it for today; done today or on today's calendar, none.
  assert.equal(R.nagFor([pt([d(5)])], { day: "2026-10-08", seen: { day: "2026-10-08", off: "2026-10-08" } }), null);
  assert.equal(R.nagFor([pt([d(8)])], { day: "2026-10-08" }), null);
  assert.equal(R.nagFor([pt()], { day: "2026-10-08", cal: { p: { today: true, ahead: 1 } } }), null);
  // Met, set days, done for good: none.
  assert.equal(R.nagFor([pt([d(4), d(5), d(6)])], { day: "2026-10-09" }), null);
  assert.equal(R.nagFor([pt([], { routine: { per: 2, days: [1, 4], log: [] } })], { day: "2026-10-09" }), null);
  assert.equal(R.nagFor([pt([], { status: "done" })], { day: "2026-10-09" }), null);
  assert.equal(R.nagFor([pt()], { day: "2026-10-07", skip: "p" }), null); // the one on the card
  assert.equal(R.nagText({ task: { title: "Read", size: 90 }, late: false, s: { done: 0, per: 2 } }), "Read, 1.5 h · 0 of 2 this week");
});

// Capture (2026-10-15): "water plants every weekday" was saved as a one-off.
test("repeatFrom reads a repeat out of captured words", () => {
  const r = (s) => R.repeatFrom(s, THU);
  assert.deepEqual(r("water plants every weekday").routine.days, [0, 1, 2, 3, 4]);
  assert.equal(r("water plants every weekday").title, "water plants");
  assert.deepEqual(r("gym every Monday and Thursday at 7pm").routine, { per: 2, until: null, log: [], days: [1, 4], at: "19:00" });
  assert.equal(r("gym every Monday and Thursday at 7pm").title, "gym");
  assert.deepEqual(r("השקיה כל יום שני וחמישי").routine.days, [1, 4]);
  assert.deepEqual(r("להשקות עציצים כל יום חול").routine.days, [0, 1, 2, 3, 4]);
  assert.equal(r("stretch daily").routine.per, 7);
  assert.equal(r("guitar 3 times a week").routine.per, 3);
  assert.equal(r("guitar twice a week").routine.per, 2);
  assert.equal(r("גיטרה פעמיים בשבוע").routine.per, 2);
  assert.deepEqual(r("pay rent every month on the 1st").routine, { per: 1, every: "month", on: "2026-11-01", until: null, log: [] });
  assert.equal(r("review budget monthly").routine.on, "2026-10-08");
  // A date, not a repeat.
  assert.equal(r("call the bank on Monday"), null);
  // "monthly report" names the task; "… monthly" at the end is the repeat.
  assert.equal(r("monthly report draft"), null);
  assert.equal(r("daily standup notes"), null);
  assert.equal(r("water the garden weekly").routine.per, 1);
  assert.equal(r("fix the monitor"), null);
  assert.equal(R.repeatWords(r("water plants every weekday").routine), "every weekday at 18:00");
  assert.equal(R.repeatWords({ per: 3 }), "3× a week");
});

test("a set-days routine comes back on its next day, not tomorrow", () => {
  const plants = { id: "p", ...createTask({ title: "Water plants", size: 5, routine: { per: 5, days: [0, 1, 2, 3, 4] } }, { now: at("2026-10-01") }) };
  // Done Thursday: Friday and Saturday aren't its days, so Sunday.
  assert.equal(completeTask(plants, { now: THU }).notBefore, "2026-10-11");
  // Done Monday: Tuesday.
  assert.equal(completeTask(plants, { now: at("2026-10-05") }).notBefore, "2026-10-06");
});
