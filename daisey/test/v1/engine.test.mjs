// Daisey v1 Now engine: three gates, one test per spec table row.
// Run: node --test "daisey/test/v1/*.test.mjs"
// Times are built in local time, like the engine reads them, so these pass
// in any timezone.
import test from "node:test";
import assert from "node:assert/strict";
import * as E from "../../app/js/engine.js";
import * as W from "../../app/js/weights.js";
import * as H from "../../app/js/holidays.js";
import * as C from "../../app/js/context.js";

const at = (d, h = 10, m = 0) => new Date(2026, 9, d, h, m).getTime(); // Oct 2026; the 5th is a Monday
const NOW = at(5);
let seq = 0;
const task = (o = {}) => ({
  id: `t${++seq}`, project: "P", title: "Task", size: 30, area: "work", type: "deep", where: "computer",
  openHours: "anytime", stakes: "low", 
  due: null, dueTime: null, dateKind: null, status: "ready", canSplit: false,
  createdAt: NOW, touchedAt: NOW, skipsSinceStart: 0, spentMinutes: 0, ...o,
});
const moment = (o = {}) => E.readMoment({ now: NOW, window: 60, ...o });
const parts = (t, o) => E.scoreTask(t, moment(o)).parts;
const pick = (ts, o) => E.rank(Array.isArray(ts) ? ts : [ts], { now: NOW, ...o }).pick;
const why = (t, o) => pick(t, o).why;
const dl = (due, o) => task({ due, dateKind: "deadline", ...o });
const tg = (due, o) => task({ due, dateKind: "target", ...o });

// ---------- Step 1: the moment ----------

const ev = (title, sh, sm, eh, em, d = 5, o = {}) => ({ title, start: new Date(at(d, sh, sm)).toISOString(), end: new Date(at(d, eh, em)).toISOString(), ...o });

test("calendar window: minutes to the next event; inside one → 0; none today → rest of day", () => {
  const next = E.freeWindow([ev("Teaching", 10, 45, 12, 0)], NOW);
  // 45 minutes to Teaching, less the 10-minute buffer before it (2026-10-06).
  assert.deepEqual([next.window, next.next.title, next.restOfDay], [45 - W.EVENT_BUFFER, "Teaching", false]);
  const inside = E.freeWindow([ev("Teaching", 9, 30, 11, 0), ev("Call", 12, 0, 13, 0)], NOW);
  assert.deepEqual([inside.window, inside.current.title], [0, "Teaching"]);
  const done = E.freeWindow([ev("Earlier", 8, 0, 9, 0)], NOW);
  assert.deepEqual([done.window, done.restOfDay], [W.WINDOW_CAP, true]);
  assert.equal(E.readMoment({ now: NOW, window: 660 }).window, W.WINDOW_CAP);
});

test("moment: no calendar → 60 min, window capped at 180; place anywhere by default", () => {
  const m = E.readMoment({ now: NOW });
  assert.equal(m.window, 60);
  assert.equal(m.place, "anywhere");
  assert.equal(E.readMoment({ now: NOW, window: 400 }).window, 180);
  assert.equal(E.readMoment({ now: NOW, window: 0 }).window, 0);
});

test("moment: time bucket edges, Friday + Saturday are the weekend", () => {
  assert.equal(E.timeBucket(at(5, 11, 59)).part, "morning");
  assert.equal(E.timeBucket(at(5, 12)).part, "afternoon");
  assert.equal(E.timeBucket(at(5, 17)).part, "evening");
  assert.equal(E.timeBucket(at(9)).weekend, true); // Fri
  assert.equal(E.timeBucket(at(11)).weekend, false); // Sun
});

test("office hours: Sun–Thu 9–16; closed Fri, Sat and holidays, worked out per year", () => {
  assert.equal(H.officeOpen(at(5, 9)), true);
  assert.equal(H.officeOpen(at(5, 15, 59)), true);
  assert.equal(H.officeOpen(at(5, 16)), false);
  assert.equal(H.officeOpen(at(5, 8, 59)), false);
  assert.equal(H.officeOpen(at(9, 10)), false); // Friday
  assert.equal(H.officeOpen(at(10, 10)), false); // Saturday
  assert.equal(H.officeOpen(at(11, 10)), true); // Sunday
  assert.equal(H.officeOpen(new Date(2026, 8, 21, 10).getTime()), false); // Yom Kippur 2026 (Mon)
  assert.ok(H.holidaysOf(2027).has("2027-10-11")); // Yom Kippur 2027
  assert.ok(H.holidaysOf(2026).has("2026-04-22")); // Independence Day 2026
  assert.equal(H.officeMinutesLeft(at(5, 15, 20)), 40);
});

test("place guess: correction for 3 h, else Out at/after an event with a location, else Home", () => {
  assert.equal(C.placeNow({ now: NOW }).value, "home");
  assert.equal(C.placeNow({ events: [ev("Dentist", 9, 0, 9, 45, 5, { location: "Herzl 3" })], now: NOW }).value, "out");
  assert.equal(C.placeNow({ events: [ev("Dentist", 8, 0, 9, 0, 5, { location: "Herzl 3" })], now: NOW }).value, "home"); // 60 min ago
  assert.equal(C.placeNow({ correction: { value: "out", at: NOW - 3600e3 }, now: NOW }).value, "out");
});

// ---------- Gate 1: can it be done now? ----------

test("gate 1: waiting, done, someday, stale, not before, skipped this session", () => {
  const m = moment({ sessionSkips: ["skip"] });
  assert.equal(E.filterOut(task({ status: "waiting" }), m), "waiting");
  assert.equal(E.filterOut(task({ status: "done" }), m), "done");
  assert.equal(E.filterOut(task({ status: "someday" }), m), "someday");
  assert.equal(E.filterOut(task({ skipsSinceStart: W.STALE_SKIPS }), m), "stale");
  assert.equal(E.filterOut(task({ notBefore: "2026-10-07" }), m), "notyet");
  assert.equal(E.filterOut(task({ id: "skip" }), m), "skipped");
  assert.equal(E.filterOut(task(), m), null);
});

test("gate 1: where — Out rules out Home and Computer tasks; Home and Anywhere rule out nothing", () => {
  const out = moment({ place: "out" }), home = moment({ place: "home" });
  assert.equal(E.filterOut(task({ where: "home" }), out), "place");
  assert.equal(E.filterOut(task({ where: "computer" }), out), "place");
  assert.equal(E.filterOut(task({ where: "phone" }), out), null);
  assert.equal(E.filterOut(task({ where: "out" }), out), null);
  assert.equal(E.filterOut(task({ where: "out" }), home), null);
  assert.equal(E.filterOut(task({ where: "computer" }), moment()), null);
});

test("gate 1: office hours — closed rules it out; open, the window ends at 16:00", () => {
  const call = task({ openHours: "office", type: "call", where: "phone", size: 15 });
  assert.equal(E.filterOut(call, moment()), null);
  assert.equal(E.filterOut(call, E.readMoment({ now: at(9, 10), window: 60 })), "office"); // Friday
  assert.equal(E.filterOut(call, E.readMoment({ now: at(5, 17), window: 60 })), "office");
  assert.equal(E.filterOut({ ...call, size: 30 }, E.readMoment({ now: at(5, 15, 40), window: 60 })), "size"); // 20 min to close
  assert.equal(E.filterOut(task({ openHours: "evening" }), moment()), "evening");
  assert.equal(E.filterOut(task({ openHours: "evening" }), E.readMoment({ now: at(5, 18) })), null);
});

test("gate 1: window — too big is out, unless it can split and the window is 25+", () => {
  assert.equal(E.filterOut(task({ size: 60 }), moment()), null);
  assert.equal(E.filterOut(task({ size: 61 }), moment()), "size");
  assert.equal(E.filterOut(task({ size: 90, canSplit: true }), moment({ window: 25 })), null);
  assert.equal(E.filterOut(task({ size: 90, canSplit: true }), moment({ window: 24 })), "size");
});

test("gate 1: a calendar block named after a project keeps only that project", () => {
  const m = moment({ blockProject: "Daisey" });
  assert.equal(E.filterOut(task({ project: "daisey" }), m), null);
  assert.equal(E.filterOut(task({ project: "Reprise" }), m), "block");
});

test("project blocks: an event titled after a project names it (whole words, longest, never Inbox)", () => {
  const ps = ["Daisey", "Monster", "Monster Punk", "Inbox", "חתונה"];
  assert.equal(E.matchProject("daisey", ps), "Daisey");
  assert.equal(E.matchProject("Daisey work session", ps), "Daisey");
  assert.equal(E.matchProject("Monster Punk audio", ps), "Monster Punk");
  assert.equal(E.matchProject("Daiseyland", ps), null); // not a whole word
  assert.equal(E.matchProject("Teaching", ps), null);
  assert.equal(E.matchProject("inbox zero", ps), null);
  assert.equal(E.matchProject("עבודה על חתונה", ps), "חתונה");
});

// ---------- Gate 2: what does leaving it cost? ----------

test("gate 2 deadline: past or today 35, within 2 days 25, within 7 days 12, later 0", () => {
  assert.equal(parts(dl("2026-10-01")).deadline, 35);
  assert.equal(parts(dl("2026-10-05")).deadline, 35);
  assert.equal(parts(dl("2026-10-07")).deadline, 25);
  assert.equal(parts(dl("2026-10-12")).deadline, 12);
  assert.equal(parts(dl("2026-10-13")).deadline, 0);
  assert.equal(parts(task()).deadline, 0);
  assert.equal(parts(tg("2026-10-05")).deadline, 0); // a target is never a deadline
});

test("gate 2 target: today or past 8, within 3 days 4, later 0 — never overdue", () => {
  assert.equal(parts(tg("2026-10-05")).target, 8);
  assert.equal(parts(tg("2026-09-20")).target, 8); // passed: rolls to today, no more
  assert.equal(parts(tg("2026-10-08")).target, 4);
  assert.equal(parts(tg("2026-10-09")).target, 0);
  assert.equal(parts(dl("2026-10-05")).target, 0);
});

test("gate 2 stakes: penalty 15, money 12, someone 10, low 0", () => {
  assert.equal(parts(task({ stakes: "penalty" })).stakes, 15);
  assert.equal(parts(task({ stakes: "money" })).stakes, 12);
  assert.equal(parts(task({ stakes: "someone" })).stakes, 10);
  assert.equal(parts(task({ stakes: "low" })).stakes, 0);
});

test("gate 2 area balance: least done this week gets 12; even weeks give nothing", () => {
  const job = task({ area: "job" }), work = task({ area: "work" });
  const sc = (o) => E.rank([job, work], { now: NOW, ...o }).ranked.reduce((m, s) => ({ ...m, [s.task.area]: s.parts.area }), {});
  assert.deepEqual(sc({ areaDone: { work: 4, job: 0 } }), { job: 12, work: 0 });
  assert.deepEqual(sc({ areaDone: { work: 2, job: 2 } }), { job: 0, work: 0 });
  assert.deepEqual(sc({}), { job: 0, work: 0 });
});

test("gate 2 neglect: +1 per whole day without real work, max 8", () => {
  assert.equal(parts(task()).neglect, 0);
  assert.equal(parts(task({ createdAt: NOW - 3.5 * 864e5 })).neglect, 3);
  assert.equal(parts(task({ createdAt: NOW - 20 * 864e5 })).neglect, 8);
  // Worked on yesterday: 1, however long ago it was added.
  assert.equal(parts(task({ createdAt: NOW - 20 * 864e5, workedAt: NOW - 1.2 * 864e5 })).neglect, 1);
  // A skip, Later or edit moves touchedAt — that isn't work (2026-10-06).
  assert.equal(parts(task({ createdAt: NOW - 5 * 864e5, touchedAt: NOW })).neglect, 5);
});

test("gate 1: a task told \"Not here\" is out where you said it, and only there", () => {
  const t = task({ where: "anywhere", notAt: ["home"] });
  assert.equal(E.filterOut(t, moment({ place: "home" })), "place");
  assert.equal(E.filterOut(t, moment({ place: "out" })), null);
});

// ---------- Gate 3: does it fit this gap? ----------

test("gate 3 window fit: 50–100% 12, 25–50% 8, under 25% 5, split piece 6; stand-in window 0", () => {
  assert.equal(parts(task({ size: 30 })).window, 12);
  assert.equal(parts(task({ size: 60 })).window, 12);
  assert.equal(parts(task({ size: 15 })).window, 8);
  assert.equal(parts(task({ size: 10 })).window, 5);
  assert.equal(parts(task({ size: 90, canSplit: true })).window, 6);
  assert.equal(parts(task({ size: 30 }), { realWindow: false }).window, 0);
});

test("gate 3 momentum: same project as last today 8, touched in last 2 days 4", () => {
  assert.equal(parts(task({ project: "Monster Punk" }), { lastProject: "monster punk" }).momentum, 8);
  assert.equal(parts(task({ project: "Reprise" }), { recentProjects: ["Reprise"] }).momentum, 4);
  assert.equal(parts(task(), { lastProject: "Other" }).momentum, 0);
});

test("gate 3 batch: 2+ calls/admin/errands that fit the window together get 10 each", () => {
  const calls = [15, 10, 5].map((size) => task({ type: "call", size, where: "phone" }));
  const r = E.rank([...calls, task({ type: "deep", size: 30 })], { now: NOW, window: 30 });
  const pts = Object.fromEntries(r.ranked.map((s) => [s.task.id, s.parts.batch]));
  assert.deepEqual(calls.map((c) => pts[c.id]), [10, 10, 10]); // 5+10+15 = 30 fits
  const tight = E.rank(calls, { now: NOW, window: 14 });
  assert.equal(tight.ranked.find((s) => s.task.size === 5).parts.batch, 0); // 5+10 = 15 > 14: no batch
  assert.deepEqual(E.rank([calls[0]], { now: NOW }).ranked.map((s) => s.parts.batch), [0]); // one is not a batch
  assert.deepEqual(E.rank([task({ type: "deep", size: 5 }), task({ type: "deep", size: 5 })], { now: NOW }).ranked.map((s) => s.parts.batch), [0, 0]);
});

test("gate 3 learned fit: starts vs skips for this type at this time of day, −10…10", () => {
  const t = task({ type: "call", where: "phone" });
  assert.equal(parts(t).learned, 0);
  assert.equal(parts(t, { learnStats: { "call|morning": { starts: 9, skips: 0 } } }).learned, 8); // 10×9/12
  assert.equal(parts(t, { learnStats: { "call|morning": { starts: 0, skips: 7 } } }).learned, -7);
  assert.equal(parts(t, { learnStats: { "call|evening": { starts: 9, skips: 0 } } }).learned, 0); // another bucket
});

test("gate 3 skip penalty: −8 per skip today; the score is the sum of all parts", () => {
  const t = task();
  const s = E.scoreTask(t, moment({ skipsToday: { [t.id]: 2 } }));
  assert.equal(s.parts.skips, -16);
  assert.equal(s.score, 12 /* window */ + W.TIER.keep /* no tier set */ - 16);
});

// ---------- ranking ----------

test("tie-break: real deadline first, then higher stakes, then smaller size", () => {
  // Same score: a deadline 8 days out scores 0, like no date.
  const a = task({ size: 30 }), b = dl("2026-10-20", { size: 30 });
  assert.equal(E.rank([a, b], { now: NOW }).ranked[0].score, E.rank([a, b], { now: NOW }).ranked[1].score);
  const big = task({ size: 60 }), small = task({ size: 30 });
  assert.equal(pick([big, small]).task.id, small.id);
  // Deadline 25 vs stakes 15 : compare ties directly.
  const s = (o) => ({ task: { size: 30, createdAt: 0 }, score: 50, parts: { deadline: 0, stakes: 0, ...o } });
  assert.ok(E.compare(s({ deadline: 12 }), s({ stakes: 15 })) < 0);
  assert.ok(E.compare(s({ stakes: 12 }), s({ stakes: 10 })) < 0);
});

test("something else: next by score, but another AREA within 15 points goes first", () => {
  const s = (area, score) => ({ task: { area, project: "same" }, score });
  const ranked = [s("work", 100), s("work", 95), s("job", 85), s("work", 80), s("home", 60)];
  assert.deepEqual(E.somethingElse(ranked).map((x) => x.task.area + x.score), ["job85", "work95", "work80"]);
  assert.deepEqual(E.somethingElse([]), []);
});

test("rank: stale tasks listed for keep/shrink/drop; empty states", () => {
  const stale = task({ skipsSinceStart: 5 });
  const r = E.rank([stale, task()], { now: NOW });
  assert.deepEqual(r.stale.map((t) => t.id), [stale.id]);
  assert.equal(E.rank([], { now: NOW }).empty, "none");
  assert.equal(E.rank([task({ size: 30 })], { now: NOW, window: 10 }).empty, "nofit");
});

// ---------- why line ----------

test("why: the strongest 2 factors, first person on the card", () => {
  const s = pick(dl("2026-10-05", { stakes: "money", size: 30 }));
  assert.equal(s.why, "Deadline today, costs money if late.");
  assert.equal(E.whyText(E.whySaid(s)), "I'd do this now: deadline today, costs money if late.");
  assert.equal(E.whyText(E.whySaid(pick(task({ size: 120, canSplit: true }), { realWindow: false }) || { whyParts: [] })), "I'd do this one next.");
});

test("why: phrase table — deadline, stakes, office, area, batch, window, momentum", () => {
  assert.match(why(dl("2026-10-06")), /deadline tomorrow/i);
  assert.match(why(dl("2026-10-08")), /deadline Thursday/i);
  assert.match(why(dl("2026-10-01")), /deadline passed/i);
  assert.match(why(task({ stakes: "someone", title: "Send the stems to Sofi" })), /Sofi is waiting on it/i);
  assert.match(why(task({ stakes: "penalty" })), /penalty if late/i);
  assert.match(why(task({ openHours: "office", type: "admin", size: 30 }), { now: at(5, 14), window: 60 }), /offices close at 16:00/i);
  assert.match(why([task({ area: "job" }), task({ area: "work", size: 61 })], { areaDone: { work: 3 } }), /Job search hasn't moved this week/i);
  const calls = [10, 5].map((size) => task({ type: "call", size, where: "phone" }));
  assert.match(why(calls, {}), /2 calls, done together/i);
  assert.match(why(task({ size: 40 }), { nextEvent: "teaching" }), /fits before teaching/i);
  assert.match(why(task({ project: "Monster Punk" }), { lastProject: "Monster Punk" }), /keeps Monster Punk going/i);
});

test("why: names are their own pieces, so the UI can isolate them (bidi)", () => {
  const s = pick(task({ project: "חתונה" }), { lastProject: "חתונה" });
  assert.ok(s.whyParts.some((p) => typeof p === "object" && p.name === "חתונה"));
  const he = pick(task({ title: "Send it to Sofi", stakes: "someone", project: "מסים" }));
  assert.ok(he.whyParts.some((p) => p.name === "Sofi"));
  assert.ok(pick(task({ title: "לשלוח את הסטמס ל-Yuval", stakes: "someone" })).whyParts.some((p) => p.name === "Yuval"));
});

test("why: the card and its alternatives never share a why line", () => {
  // Five same-shaped tasks in three areas: identical factors everywhere.
  const ts = ["work", "job", "home", "work"].map((area, i) => dl("2026-10-05", { area, stakes: "money", title: "T" + i }));
  const r = E.rank(ts, { now: NOW });
  const lines = [r.pick, ...r.alternatives].map((s) => s.why);
  assert.equal(new Set(lines).size, lines.length, lines.join(" | "));
  // …and the second one leads with its next factor.
  assert.match(r.alternatives[0].why, /^Costs money/);
});

// ---------- scenario ----------

test("scenario: Friday morning the calls vanish; Sunday they come back as a batch", () => {
  const tasks = [
    task({ title: "Call the bank", type: "call", where: "phone", openHours: "office", size: 15, stakes: "money" }),
    task({ title: "Call Bituach Leumi", type: "call", where: "phone", openHours: "office", size: 15 }),
    task({ title: "Boss loop fix", project: "Monster Punk", size: 60 }),
  ];
  const fri = E.rank(tasks, { now: at(9, 10), window: 90 });
  assert.equal(fri.pick.task.title, "Boss loop fix");
  assert.ok(fri.out.every((o) => o.reason === "office"));
  const sun = E.rank(tasks, { now: at(11, 10), window: 90 });
  assert.equal(sun.pick.task.title, "Call the bank");
  assert.deepEqual(sun.pick.batch.ids.length, 2);
});

test("gate 1: stale doesn't hide a real deadline within a week (2026-10-06)", () => {
  const m = moment();
  assert.equal(E.filterOut(dl("2026-10-12", { skipsSinceStart: W.STALE_SKIPS }), m), null);
  assert.equal(E.filterOut(dl("2026-10-01", { skipsSinceStart: W.STALE_SKIPS }), m), null); // passed
  assert.equal(E.filterOut(dl("2026-10-13", { skipsSinceStart: W.STALE_SKIPS }), m), "stale");
  assert.equal(E.filterOut(tg("2026-10-06", { skipsSinceStart: W.STALE_SKIPS }), m), "stale"); // a target isn't a deadline
});

test("time left, not full size: fits, scores and batches what's still to do (2026-10-06)", () => {
  const big = task({ size: 90, spentMinutes: 80 });
  assert.equal(E.filterOut(big, moment({ window: 20 })), null); // 10 min left fits 20
  assert.equal(E.filterOut(task({ size: 90 }), moment({ window: 20 })), "size");
  assert.equal(E.filterOut(task({ size: 30, spentMinutes: 45 }), moment({ window: 10 })), null); // ran over: 5 min floor
});

test("deadline lead: big work left counts the deadline days earlier (2026-10-06)", () => {
  // 10 days out: nothing for a small task; 6 h left → 2 days early, still > 7.
  assert.equal(parts(dl("2026-10-15", { size: 30 })).deadline, 0);
  assert.equal(parts(dl("2026-10-15", { size: 360 })).deadline, 0);
  // 9 days out: 6 h left reads as 7 → 12.
  assert.equal(parts(dl("2026-10-14", { size: 360 })).deadline, W.DEADLINE.within7);
  assert.equal(parts(dl("2026-10-14", { size: 30 })).deadline, 0);
  // 4 days out: 6 h left reads as 2 → 25; with 5 h already done, 1 h left → 12.
  assert.equal(parts(dl("2026-10-09", { size: 360 })).deadline, W.DEADLINE.within2);
  assert.equal(parts(dl("2026-10-09", { size: 360, spentMinutes: 300 })).deadline, W.DEADLINE.within7);
  assert.match(why(dl("2026-10-09", { size: 360, canSplit: true })), /6 h still to do/);
});

test("tiers: Focus scores most, Background waits unless a date pulls it up", () => {
  const tiers = { Top: "focus", Mid: "keep", Low: "background" };
  assert.equal(parts(task({ project: "top" }), { projectTiers: tiers }).priority, W.TIER.focus);
  assert.equal(parts(task({ project: "Mid" }), { projectTiers: tiers }).priority, W.TIER.keep);
  assert.equal(parts(task({ project: "Low" }), { projectTiers: tiers }).priority, W.TIER.background);
  assert.equal(parts(task({ project: "New" }), { projectTiers: tiers }).priority, W.TIER.keep); // no tier yet
  assert.equal(parts(task({ project: "Inbox" }), { projectTiers: { Inbox: "focus" } }).priority, W.TIER.keep); // Inbox isn't ranked
  const low = task({ project: "Low", title: "Low one", size: 30 }), mid = task({ project: "Mid", title: "Mid one", size: 45, createdAt: NOW + 1 });
  assert.equal(pick([mid, task({ project: "Top", title: "Top one" })], { projectTiers: tiers }).task.title, "Top one");
  // Background waits behind any other offerable task, even a worse fit…
  assert.equal(pick([low, mid], { projectTiers: tiers, skipsToday: { [mid.id]: 3 } }).task.title, "Mid one");
  // …but leads when it's all there is, or a deadline pulls it up.
  assert.equal(pick([low], { projectTiers: tiers }).task.title, "Low one");
  assert.equal(pick([mid, dl("2026-10-05", { project: "Low", title: "Due" })], { projectTiers: tiers }).task.title, "Due");
  assert.match(why([task({ project: "Top" })], { projectTiers: tiers }), /Top is in Focus/);
});

test("tiers: workBase hands every caller the published tiers", () => {
  C.setProjectTiers({ A: "focus" });
  assert.deepEqual(C.workBase([], NOW).projectTiers, { A: "focus" });
  C.setProjectTiers({});
});
