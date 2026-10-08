// Daisey v1 task model. Run: node --test "daisey/test/v1/*.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import * as M from "../../app/js/model.js";

const NOW = Date.UTC(2026, 9, 5, 9);
const opts = { now: NOW };

test("title only: Inbox, every field guessed, ready, counters zeroed", () => {
  const t = M.createTask({ title: "  Something   vague " }, opts);
  assert.equal(t.title, "Something vague");
  assert.equal(t.project, "Inbox");
  assert.equal(t.type, "deep");
  assert.equal(t.size, 60); // a Deep task's default, not a flat 30
  assert.equal(t.energy, undefined); // energy is gone
  assert.equal(t.status, "ready");
  assert.equal(t.waitingOn, null);
  assert.equal(t.canSplit, true);
  assert.equal(t.nextStep, null);
  assert.equal(t.dateKind, null);
  assert.equal(t.v, M.TASK_VERSION);
  assert.deepEqual(t.guessed, M.GUESSABLE);
  assert.equal(t.due, null);
  assert.equal(t.createdAt, NOW);
  assert.equal(t.touchedAt, NOW);
  assert.equal(t.skipCount, 0);
  assert.deepEqual(t.skipReasons, { tired: 0, notime: 0, mood: 0, blocked: 0 });
  assert.equal(t.spentMinutes, 0);
  assert.equal(t.starts, 0);
  assert.equal(t.stopsUnfinished, 0);
  // Firestore rejects undefined; every field must be a value or null.
  for (const [k, v] of Object.entries(t)) assert.notEqual(v, undefined, k);
});

test("project comes first in the stored task", () => {
  assert.deepEqual(Object.keys(M.createTask({ title: "x" }, opts)).slice(0, 2), ["project", "title"]);
});

test("title is required", () => {
  assert.throws(() => M.createTask({ title: "   " }, opts));
  assert.throws(() => M.createTask({}, opts));
});

test("given fields are kept, not marked as guesses", () => {
  const t = M.createTask({ title: "Mix review", project: "Reprise", size: 120, due: "2026-10-08" }, opts);
  assert.equal(t.project, "Reprise");
  assert.equal(t.size, 120);
  assert.equal(t.due, "2026-10-08");
  assert.equal(t.canSplit, true); // 60+ default
  assert.equal(t.dateKind, "target"); // a date is a wish until called a deadline
  assert.deepEqual(t.guessed, M.GUESSABLE.filter((k) => k !== "size"));
});

test("adding never takes status, waiting on, hard due or repeat", () => {
  const t = M.createTask({ title: "email Dana", size: 20, status: "waiting", waitingOn: "Yuval",
    hardDue: true, due: "2026-10-08", repeat: { every: 7 } }, opts);
  assert.equal(t.size, 20); // the user's own value
  assert.ok(!t.guessed.includes("size"));
  assert.equal(t.status, "ready");
  assert.equal(t.waitingOn, null);
  assert.equal("hardDue" in t, false);
  assert.equal("repeat" in t, false);
});

test("size guesses from words, English and Hebrew", () => {
  assert.equal(M.guessSize("Call Uri"), 15);
  assert.equal(M.guessSize("send invoices"), 15);
  assert.equal(M.guessSize("Lesson prep"), 60);
  assert.equal(M.guessSize("reply to Dana"), 5);
  assert.equal(M.guessSize("compose theme"), 90);
  assert.equal(M.guessSize("ולהתקשר לאורי"), 15); // prefix letter
  assert.equal(M.guessSize("הכנה לשיעור"), 60);
  assert.equal(M.guessSize("call about the mix"), 60); // bigger hint wins
  assert.equal(M.guessSize("something"), 30);
});

test("size guess prefers similar past tasks over words", () => {
  const history = [
    { title: "Lesson prep week 3", status: "done", spentMinutes: 25, size: 60, guessed: ["size"] },
    { title: "Lesson prep week 4", status: "done", spentMinutes: 35, size: 60, guessed: ["size"] },
    { title: "Unrelated", status: "done", spentMinutes: 200 },
  ];
  assert.equal(M.guessSize("Lesson prep", history), 30);
  // A guessed size that never finished teaches nothing.
  assert.equal(M.guessSize("Lesson prep", [{ title: "Lesson prep", size: 5, guessed: ["size"] }]), 60);
  // A size the user set does.
  assert.equal(M.guessSize("Lesson prep", [{ title: "Lesson prep", size: 15, guessed: [] }]), 15);
});

test("snapSize: nearest bucket, ties go up, 90+ stays 90", () => {
  assert.equal(M.snapSize(1), 5);
  assert.equal(M.snapSize(10), 15);
  assert.equal(M.snapSize(45), 60);
  assert.equal(M.snapSize(300), 90);
});

test("cleaning rejects junk without throwing", () => {
  const t = M.createTask({ title: "x", size: "lots", due: "2026-02-30", dueTime: "25:00", type: "nonsense" }, opts);
  assert.equal(t.size, 60);
  assert.equal(t.type, "deep");
  assert.equal(t.due, null);
  assert.equal(t.dueTime, null);
  assert.equal(M.toMinutes("90+"), 90);
});

test("due time kept only with a due date", () => {
  assert.equal(M.createTask({ title: "x", dueTime: "14:30" }, opts).dueTime, null);
  assert.equal(M.createTask({ title: "x", due: "2026-10-06", dueTime: "14:30" }, opts).dueTime, "14:30");
});

test("done goes to Done and leaves the available list", () => {
  const t = M.createTask({ title: "x" }, opts);
  const p = M.completeTask(t, opts);
  assert.equal(p.status, "done");
  assert.equal(p.doneAt, NOW);
  assert.equal(M.isAvailable(t), true);
  assert.equal(M.isAvailable({ ...t, ...p }), false);
});

test("durations always carry their unit: no decimal hours, no bare trailing number", () => {
  assert.equal(M.durText(45), "45 min");
  assert.equal(M.durText(60), "1 h");
  assert.equal(M.durText(90), "1 h 30 min");
  assert.equal(M.durText(245), "4 h 5 min"); // never "4 h 5"
  assert.equal(M.durText(0), "0 min");
  assert.equal(M.durText(-5), "0 min");
});

test("not now: the skip counts; the reason is a second patch; blocked waits", () => {
  const t = { ...M.createTask({ title: "x" }, opts), skipCount: 2, skipsSinceStart: 1 };
  assert.deepEqual(M.skipTask(t, opts), { skipCount: 3, skipsSinceStart: 2, touchedAt: NOW });
  const tired = M.skipReason(t, "tired", opts);
  assert.equal(tired.skipReasons.tired, 1);
  assert.equal(tired.status, undefined); // only "blocked" changes the task
  assert.equal(M.skipReason(t, "blocked", opts).status, "waiting");
  assert.deepEqual(M.skipReason(t, "nonsense", opts), {});
});

test("not now: Undo puts back exactly what the skip touched", () => {
  const t = { ...M.createTask({ title: "x" }, opts), skipCount: 2, skipsSinceStart: 1, touchedAt: NOW - 5 };
  const before = M.skipSnapshot(t);
  const after = { ...t, ...M.skipTask(t, opts), ...M.skipReason(t, "blocked", opts) };
  assert.equal(after.status, "waiting");
  assert.deepEqual({ ...after, ...before }, { ...t, notAt: [] }); // notAt: an empty list is "never taught"
});

test("skip lesson: Too big allows pieces, Not here hides it where you are; Undo takes both back", () => {
  const t = { ...M.createTask({ title: "Write the report", size: 20 }, opts), canSplit: false };
  const big = M.skipLesson(t, "toobig", { now: NOW });
  assert.equal(big.canSplit, true);
  assert.equal(big.skipReasons.toobig, 1);
  const here = M.skipLesson(t, "nothere", { place: "home", now: NOW });
  assert.deepEqual(here.notAt, ["home"]);
  // Said twice at the same place → still once; the list keeps the last 3 places.
  const twice = M.skipLesson({ ...t, ...here }, "nothere", { place: "home", now: NOW });
  assert.deepEqual(twice.notAt, ["home"]);
  let u = t;
  for (const p of ["home", "out", "spot", "walk"]) u = { ...u, ...M.skipLesson(u, "nothere", { place: p, now: NOW }) };
  assert.deepEqual(u.notAt, ["out", "spot", "walk"]);
  // "anywhere" is no place, an unknown reason does nothing.
  assert.equal(M.skipLesson(t, "nothere", { place: "anywhere" }).notAt, undefined);
  assert.deepEqual(M.skipLesson(t, "whatever"), {});
  // Undo: the snapshot taken before the skip restores what the lessons changed.
  const before = M.skipSnapshot(t);
  assert.deepEqual({ ...t, ...big, ...here, ...before }.notAt, []);
  assert.equal({ ...t, ...big, ...before }.canSplit, false);
});

test("focus mode: starting counts a start and clears the stale-skip count", () => {
  const t = { ...M.createTask({ title: "x" }, opts), starts: 1, skipsSinceStart: 3 };
  assert.deepEqual(M.startedTask(t, opts), { starts: 2, skipsSinceStart: 0, pushes: 0, touchedAt: NOW, workedAt: NOW });
});

test("focus mode: real minutes always count; finishing completes, stopping is recorded", () => {
  const t = { ...M.createTask({ title: "x" }, opts), spentMinutes: 10, stopsUnfinished: 1 };
  const more = M.workedTask(t, 12.4, opts);
  assert.deepEqual(more, { spentMinutes: 22, stopsUnfinished: 2, touchedAt: NOW, workedAt: NOW });
  const done = M.workedTask(t, 12.6, { ...opts, finished: true });
  assert.equal(done.spentMinutes, 23);
  assert.equal(done.status, "done");
  assert.equal(done.stopsUnfinished, undefined); // finishing isn't a stop
  assert.equal(M.workedTask(t, -5, opts).spentMinutes, 10); // a clock skew never takes time away
});

test("edit: only changed fields, user values stop being guesses", () => {
  const t = { id: "a", ...M.createTask({ title: "thing" }, opts) };
  assert.deepEqual(M.editTask(t, { title: "thing" }, opts), {});
  const p = M.editTask(t, { size: 15 }, { now: NOW + 1 });
  assert.equal(p.size, 15);
  assert.equal(p.canSplit, false); // still a default, follows size
  assert.deepEqual(p.guessed, M.GUESSABLE.filter((k) => k !== "size"));
  assert.equal(p.touchedAt, NOW + 1);
});

test("edit: clearing size hands it back to the guess", () => {
  const t = { id: "a", ...M.createTask({ title: "Call Uri", size: 60 }, opts) };
  const p = M.editTask(t, { size: "" }, opts);
  assert.equal(p.size, 15);
  assert.ok(p.guessed.includes("size"));
});

test("edit: waiting on an existing task, then back to ready", () => {
  const t = { id: "a", ...M.createTask({ title: "cue" }, opts) };
  const w = M.editTask(t, { waitingOn: "Yuval" }, opts);
  assert.equal(w.status, "waiting");
  assert.equal(w.waitingOn, "Yuval");
  const r = M.editTask({ ...t, ...w }, { status: "ready" }, opts);
  assert.equal(r.waitingOn, null);
});

test("edit: clearing due clears due time", () => {
  const t = { id: "a", ...M.createTask({ title: "x", due: "2026-10-06", dueTime: "10:00" }, opts) };
  const p = M.editTask(t, { due: null }, opts);
  assert.equal(p.due, null);
  assert.equal(p.dueTime, null);
});

test("reopening a done task clears doneAt", () => {
  const t = { id: "a", ...M.createTask({ title: "x" }, opts) };
  const d = { ...t, ...M.completeTask(t, opts) };
  const p = M.editTask(d, { status: "ready" }, opts);
  assert.equal(p.status, "ready");
  assert.equal(p.doneAt, null);
  assert.equal(M.isAvailable({ ...d, ...p }), true);
});

test("guesses: type, where, open hours, size from the title", () => {
  const g = (title, project = "Inbox") => M.guessFields(title, project);
  assert.deepEqual(pick(g("call the bank")), { type: "call", where: "phone", openHours: "office", size: 15 });
  assert.equal(g("call mom").openHours, "anytime"); // a person, not an office
  assert.deepEqual(pick(g("buy strings")), { type: "errand", where: "out", openHours: "anytime", size: 45 });
  assert.equal(g("לקנות מתנה לאבא").type, "errand");
  assert.equal(g("ולהתקשר לרופא").type, "call"); // Hebrew prefix letters
  assert.equal(g("ולהתקשר לרופא").openHours, "office");
  assert.equal(g("whatsapp Dana").where, "phone");
  assert.equal(g("send invoice to Uri").type, "admin");
  assert.equal(g("send invoice to Uri").where, "computer");
  assert.equal(g("post office: pick up parcel").openHours, "office");
  assert.equal(g("laundry").where, "home");
  assert.equal(g("dinner with Sofi").type, "social");
  assert.equal(g("fix the boss loop").type, "deep"); // "fix" is too broad to mean Home
  assert.equal(g("practice scales").where, "home");
  assert.equal(g("Lesson prep").size, 60);
});

test("guesses: stakes, worst first", () => {
  const s = (t) => M.guessStakes(t);
  assert.equal(s("submit grant application"), "penalty");
  assert.equal(s("pay the electricity bill"), "money");
  assert.equal(s("send invoice to Uri"), "money"); // money beats someone
  assert.equal(s("send the stems to Yuval"), "someone");
  assert.equal(s("reply to Dana"), "someone");
  assert.equal(s("notes for Sofi"), "someone");
  assert.equal(s("לשלם ארנונה"), "money");
  assert.equal(s("להגיש טופס"), "penalty");
  assert.equal(s("fix the boss loop"), "low");
});

test("guesses: area from words, then the project's own areas, then type", () => {
  assert.equal(M.guessArea("update CV", "Inbox", "deep"), "job");
  assert.equal(M.guessArea("send it", "Job search", "admin"), "job"); // the project's name
  assert.equal(M.guessArea("dentist", "Inbox", "call"), "personal");
  const history = [{ project: "Reprise", area: "work", guessed: [] }, { project: "Reprise", area: "social", guessed: ["area"] }];
  assert.equal(M.guessArea("pay hall", "reprise", "admin", history), "work"); // only areas the user set count
  assert.equal(M.guessArea("pay hall", "Inbox", "admin", history), "admin");
  assert.equal(M.guessArea("laundry", "Inbox", "home"), "home");
  assert.equal(M.guessArea("Fix the boss loop", "Monster Punk", "deep"), "work");
});

test("a picked type steers the rest of the guesses", () => {
  const t = M.createTask({ title: "Uri about the mix", type: "call" }, opts);
  assert.equal(t.where, "phone");
  assert.equal(t.openHours, "office");
  assert.ok(!t.guessed.includes("type"));
});

test("edit: a picked field stays put; handing it back re-guesses", () => {
  const t = { id: "a", ...M.createTask({ title: "Call Uri" }, opts) };
  const p = M.editTask(t, { where: "computer" }, opts);
  assert.equal(p.where, "computer");
  assert.ok(!p.guessed.includes("where"));
  const t2 = { ...t, ...p };
  assert.equal(M.editTask(t2, { title: "Call Uri again" }, opts).where, undefined); // still the user's
  assert.equal(M.editTask(t2, { where: "" }, opts).where, "phone");
  // Editing notes alone re-guesses nothing.
  assert.deepEqual(Object.keys(M.editTask(t, { notes: "hi" }, opts)).sort(), ["notes", "touchedAt"]);
});

test("edit: date kind is Target by default, Deadline on request, gone with the date", () => {
  const t = { id: "a", ...M.createTask({ title: "x", due: "2026-10-06" }, opts) };
  assert.equal(t.dateKind, "target");
  assert.equal(M.editTask(t, { dateKind: "deadline" }, opts).dateKind, "deadline");
  assert.equal(M.editTask(t, { due: "" }, opts).dateKind, null);
  assert.equal(M.editTask({ ...t, due: null, dateKind: null }, { due: "2026-10-09" }, opts).dateKind, "target");
});

test("migrate: an old task gets every field, real guesses, Targets, and keeps touchedAt", () => {
  const old = { id: "o", project: "Inbox", title: "call the bank", size: 30, guessed: ["size", "canSplit"],
    canSplit: false, due: "2026-10-01", status: "ready", touchedAt: 123, createdAt: 100 };
  const p = M.migrateTask(old, [old]);
  assert.equal(p.size, 15); // the flat 30 was a guess: re-guessed
  assert.equal(p.type, "call");
  assert.equal(p.where, "phone");
  assert.equal(p.openHours, "office");
  assert.equal(p.dateKind, "target");
  assert.equal(p.nextStep, null);
  assert.equal(p.v, M.TASK_VERSION);
  assert.deepEqual(p.guessed, M.GUESSABLE);
  assert.equal("touchedAt" in p, false);
  for (const [k, v] of Object.entries(p)) assert.notEqual(v, undefined, k);
  assert.deepEqual(M.migrateTask({ ...old, ...p }), {}); // once only
});

test("migrate: a size the user set survives (any but the old flat 30)", () => {
  const old = { project: "Inbox", title: "call the bank", size: 60, guessed: [], canSplit: false, status: "ready" };
  const p = M.migrateTask(old);
  assert.equal("size" in p, false);
  assert.equal(p.dateKind, null); // no date: no kind
});

function pick(g){ return { type: g.type, where: g.where, openHours: g.openHours, size: g.size }; }

test("cancel after real work: minutes kept, no stop counted", () => {
  const t = { spentMinutes: 10, stopsUnfinished: 1 };
  assert.deepEqual(M.keptTime(t, 7.4, { now: 5 }), { spentMinutes: 17, touchedAt: 5, workedAt: 5 });
});

// ---------- layout round 2 (2026-10-05): steps, links, Pending's check date ----------

test("steps: the first unticked one is the next step; blanks drop out", () => {
  const t = M.createTask({ title: "Mix the trailer", steps: [{ text: "Bounce", done: true }, { text: "  ", done: false }, { text: "Layer  impacts" }] }, opts);
  assert.deepEqual(t.steps, [{ text: "Bounce", done: true }, { text: "Layer impacts", done: false }]);
  assert.equal(t.nextStep, "Layer impacts");
  const p = M.editTask(t, { steps: [{ text: "Bounce", done: true }, { text: "Layer impacts", done: true }] }, opts);
  assert.equal(p.nextStep, null); // all ticked: nothing next
  assert.equal(M.editTask(t, { steps: [] }, opts).steps, null);
});

test("links: a bare address gets https, the label is the file or the site", () => {
  const t = M.createTask({ title: "x", links: [{ url: "drive.google.com/file/d/1/cue-sheet.pdf" }, { url: "https://www.example.com/a/b" }, { url: "" }] }, opts);
  assert.deepEqual(t.links, [
    { url: "https://drive.google.com/file/d/1/cue-sheet.pdf", label: "cue-sheet.pdf" },
    { url: "https://www.example.com/a/b", label: "example.com" },
  ]);
  assert.equal(M.createTask({ title: "y" }, opts).links, null);
});

test("pending: a check date three days on; leaving Pending clears it", () => {
  const t = M.createTask({ title: "x" }, opts);
  const day3 = M.dayAfter(M.PENDING_CHECK_DAYS, NOW);
  assert.equal(M.skipReason(t, "blocked", opts).checkOn, day3);
  const waiting = { ...t, status: "waiting", checkOn: day3 };
  assert.equal(M.editTask(t, { status: "waiting" }, opts).checkOn, day3);
  assert.equal(M.editTask(waiting, { checkOn: "2026-10-20" }, opts).checkOn, "2026-10-20");
  assert.equal(M.editTask(waiting, { status: "ready" }, opts).checkOn, null);
});

test("migrate v4: a next step becomes step 1; a pending task gets a check date", () => {
  const old = { ...M.createTask({ title: "x" }, opts), v: 3, nextStep: "Call Yuval", status: "waiting", touchedAt: NOW };
  delete old.steps; delete old.links; delete old.checkOn;
  const p = M.migrateTask(old);
  assert.deepEqual(p.steps, [{ text: "Call Yuval", done: false }]);
  assert.equal(p.links, null);
  assert.equal(p.checkOn, M.dayAfter(M.PENDING_CHECK_DAYS, NOW));
  assert.deepEqual(M.migrateTask({ ...old, ...p }), {});
});

test("pendingCheck: 3 days on, but the day before a real deadline, never before tomorrow (2026-10-06)", () => {
  const now = new Date(2026, 9, 5, 10).getTime(); // Mon 5 Oct
  assert.equal(M.pendingCheck({}, now), "2026-10-08");
  assert.equal(M.pendingCheck({ due: "2026-10-20", dateKind: "deadline" }, now), "2026-10-08");
  assert.equal(M.pendingCheck({ due: "2026-10-08", dateKind: "deadline" }, now), "2026-10-07");
  assert.equal(M.pendingCheck({ due: "2026-10-06", dateKind: "deadline" }, now), "2026-10-06");
  assert.equal(M.pendingCheck({ due: "2026-10-05", dateKind: "deadline" }, now), "2026-10-06");
  assert.equal(M.pendingCheck({ due: "2026-10-06", dateKind: "target" }, now), "2026-10-08");
  // Blocked via Not now, and Pending set by an edit, both use it.
  assert.equal(M.skipReason({ due: "2026-10-07", dateKind: "deadline" }, "blocked", { now }).checkOn, "2026-10-06");
  const t = { ...M.createTask({ title: "Mix review", due: "2026-10-07", dateKind: "deadline" }, { now }), id: "a" };
  assert.equal(M.editTask(t, { waitingOn: "Yuval" }, { now }).checkOn, "2026-10-06");
});

test("bringBack: a passed wish date goes, a deadline stays (2026-10-06)", () => {
  const now = new Date(2026, 9, 6, 10).getTime();
  assert.deepEqual(M.bringBack({ due: "2026-10-01", dateKind: "target" }, { now }),
    { status: "ready", notBefore: null, touchedAt: now, due: null, dueTime: null, dateKind: null });
  assert.deepEqual(M.bringBack({ due: "2026-10-01", dateKind: "deadline" }, { now }), { status: "ready", notBefore: null, touchedAt: now });
  assert.deepEqual(M.bringBack({ due: "2026-10-09", dateKind: "target" }, { now }), { status: "ready", notBefore: null, touchedAt: now });
  assert.deepEqual(M.pushedTo({ pushes: 1 }, { notBefore: "2026-10-07" }, { now }), { notBefore: "2026-10-07", pushes: 2, touchedAt: now });
});

test("againInput: next week / next month copy keeps the user's choices, unticks steps, moves the date (2026-10-06)", () => {
  const now = new Date(2026, 9, 6, 10).getTime(); // Tue 6 Oct
  const done = { ...M.createTask({ title: "Lesson prep", project: "Teaching", size: 60, due: "2026-10-08", dateKind: "deadline",
    steps: [{ text: "Slides", done: true }], notes: "Room 4" }, { now }), status: "done" };
  const w = M.againInput(done, "week", { now });
  assert.equal(w.size, 60); // the user's own
  assert.ok(!("type" in w)); // a guess, guessed again
  assert.deepEqual([w.due, w.notBefore, w.dateKind, w.again], ["2026-10-15", "2026-10-13", "deadline", "week"]);
  assert.deepEqual(w.steps, [{ text: "Slides", done: false }]);
  const copy = M.createTask(w, { now });
  assert.deepEqual([copy.again, copy.notBefore, copy.notes], ["week", "2026-10-13", "Room 4"]);
  // A month on, clamped to the month's last day.
  assert.equal(M.shiftDay("2026-01-31", "month"), "2026-02-28");
  assert.equal(M.againInput({ title: "Invoices", project: "Admin" }, "month", { now }).notBefore, "2026-11-06");
});

test("project range: outsideRange and clampDate keep a date inside start..due", async () => {
  const { outsideRange, clampDate, cleanRange } = await import("../../app/js/model.js");
  const r = cleanRange({ start: "2026-10-10", due: "2026-10-20" });
  assert.equal(outsideRange(r, "2026-10-09"), "before");
  assert.equal(outsideRange(r, "2026-10-21"), "after");
  assert.equal(outsideRange(r, "2026-10-15"), null);
  assert.equal(clampDate(r, "2026-10-01"), "2026-10-10");
  assert.equal(clampDate(r, "2026-11-01"), "2026-10-20");
  assert.equal(clampDate({ start: null, due: "2026-10-20" }, "2026-01-01"), "2026-01-01");
  assert.equal(cleanRange({ start: "x", due: "" }), null);
});

test("progress: done is 100, partial is kept, left shrinks", () => {
  assert.equal(M.progressOf({ status: "done" }), 100);
  assert.equal(M.progressOf({ status: "ready", progress: 40 }), 40);
  assert.equal(M.progressOf({ status: "ready" }), 0);
  assert.equal(M.progressPatch(150).progress, 99);
  assert.equal(M.completeTask({}).progress, 100);
  assert.ok(M.leftMinutes({ size: 60, progress: 50 }) <= 30);
});

test("editTask: progress sets the task's % (clamped), no-op when unchanged", () => {
  const t = M.createTask({ title: "Write report", size: 60 }, opts);
  const p = M.editTask(t, { progress: 40 }, { now: NOW + 1 });
  assert.equal(p.progress, 40);
  assert.equal(M.progressOf({ ...t, ...p }), 40);
  assert.equal(M.editTask(t, { progress: 150 }, opts).progress, 99);
  assert.deepEqual(M.editTask({ ...t, ...p }, { progress: 40 }, opts), {});
});
