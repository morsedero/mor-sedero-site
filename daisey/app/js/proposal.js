// The day's proposed schedule (Mor, 2026-10-07): at the start of the day, or
// whenever asked, the Now card becomes Daisey's proposal for the rest of
// today — an ordered list of tasks laid into the free time between calendar
// events. The user approves it as is, reorders it, deletes items, edits a
// task, or asks Daisey to rethink it ("lighter", "no calls", "start with the
// mix"). Once approved, the card follows the plan in order.
//
// This supersedes the 2026-10-03 "no clock times, no ordered list" call for
// this one view: Mor asked for a timeline they can rearrange. The picks are
// still the engine's (engine.rank), so the card and the plan agree until the
// user changes the order.
// PURE: no Firebase, no DOM.
import { gapsToday, bookings, mealsOf, planDate, answerDate } from "./day.js";
import { rank, fitsPlace } from "./engine.js";
import { phoneOkIds } from "./phone.js";
import { routineCalendar } from "./routine.js";
import { workBase } from "./context.js";
import { overruled, eventKey, runState } from "./reality.js";
import { LABELS, INBOX, notYet, localDate, leftMinutes, durText } from "./model.js";
import { officeDay } from "./holidays.js";
import * as W from "./weights.js";

const MIN = 60000;
// When a task with set hours (openHours) can start at or after `from`, for
// `need` ms, the same day — the card's rule (engine: "needs offices open",
// "evening"), so the plan never books what the card would block (user test
// 2026-10-11: "Book dentist" at 21:50). null: not today.
const hourAt = (ms, h) => new Date(ms).setHours(h, 0, 0, 0);
function openStart(task, from, need){
  if (task?.openHours === "evening") return Math.max(from, hourAt(from, W.EVENING_FROM));
  if (task?.openHours !== "office") return from;
  if (!officeDay(from)) return null;
  const s = Math.max(from, hourAt(from, W.OFFICE.open));
  return s + need <= hourAt(from, W.OFFICE.close) ? s : null;
}
const WORTH = 15; // minutes: a gap shorter than this holds nothing
export const MAX_ITEMS = 8;
const FEWER = 3;
const MORE = 10;

// What's left of a task: its size less what's done — the progress % once one
// is given, else the time already put in (model.leftMinutes). A 75%-done 2 h
// task gets a 30 min slot, not 2 h (user test 2026-10-11).
export const leftOf = (t) => leftMinutes(t);

// The free time left today, as gaps, with what reality overruled taken out
// (a meeting you worked through isn't busy). rides: the trips (trips.js) as
// gaps too, each with the place it is — only a task that fits it goes there.
function freeGaps({ tasks, events, now, hours, run, rides = true }){
  const over = overruled(events, { tasks, run, now });
  const evs = events.filter((e) => !over.has(eventKey(e)));
  const gaps = gapsToday(evs, now, hours).filter((g) => g.minutes >= WORTH);
  return { evs, gaps: rides ? [...gaps, ...rideGaps(evs, now)].sort((a, b) => a.start - b.start) : gaps };
}
// Today's rides still to come (or under way), as gaps with a place. A ride
// can start before the day hours: on the 06:10 train the day has begun.
function rideGaps(evs, now){
  const today = localDate(now);
  return evs.filter((e) => e.trip && Date.parse(e.end) > now && localDate(Date.parse(e.start)) === today)
    .map((e) => { const start = Math.max(now, Date.parse(e.start)), end = Date.parse(e.end);
      return { start, end, minutes: Math.floor((end - start) / MIN), next: null, place: e.trip.place || e.trip.mode, mode: e.trip.mode }; })
    .filter((g) => g.minutes >= WORTH);
}

// → [{ taskId, minutes }], in the order Daisey would do them.
// ask: parseAsk's hints (or {}). exclude: ids the user deleted from the plan.
// phoneOk: Computer tasks the phone can do (phone.js) — on a bus or in the
// passenger seat they fit the ride.
export function proposeDay({ tasks = [], events = [], now = Date.now(), hours = W.DAY_HOURS, settings = {}, run = null, ask = {}, exclude = [], phoneOk = phoneOkIds(tasks) } = {}){
  const { evs, gaps: all } = freeGaps({ tasks, events, now, hours, run });
  const until = Number.isFinite(ask.until) ? atMin(now, ask.until) : Infinity;
  const cut = (gs) => gs.map((g) => ({ ...g, end: Math.min(g.end, until) })).filter((g) => g.end - g.start >= WORTH * MIN);
  const usable = cut(all.filter((g) => !g.place)), rides = cut(all.filter((g) => g.place));
  if (!usable.length && !rides.length) return [];
  let budget = usable.reduce((s, g) => s + Math.floor((g.end - g.start) / MIN), 0);
  if (Number.isFinite(ask.maxMinutes)) budget = Math.min(budget, ask.maxMinutes);
  const biggest = usable.length ? Math.max(...usable.map((g) => Math.floor((g.end - g.start) / MIN))) : 0;
  // Fewer picks as usual, then keeps the FEWER most pressing (fewerFirst).
  const cap = ask.more ? MORE : MAX_ITEMS;
  const skipTypes = new Set(ask.skipTypes || []);
  const out = new Set([...exclude, ...(ask.exclude || []), ...(run?.batch || (run?.taskId ? [run.taskId] : []))]);
  // maxEach: only tasks this small (the lighter plan, miss.js) — a deadline due today still comes.
  const today = planDate(now, hours);
  const pool = tasks.filter((t) => !skipTypes.has(t.type)
    && (!ask.maxEach || leftOf(t) <= ask.maxEach || (t.dateKind === "deadline" && t.due && t.due <= today)));
  const booked = Object.fromEntries([...bookings(tasks, evs, now)].map(([id, b]) => [id, b.start]));
  // A project's last step waits for its other open work (user test
  // 2026-10-11: "send rough mixes" came first, before any mix was done).
  const taken = new Set();
  const waiting = () => tasks.filter((t) => waitsOnSiblings(t, tasks, taken, today)).map((t) => t.id);
  const routineCal = routineCalendar(tasks, evs, now); // routine sessions already on the calendar
  const items = [];
  // A task longer than the longest free stretch goes in as a piece of it
  // (the engine only offers that when it can split), and the piece says so
  // (of: its whole length): 2 h never quietly reads 1 h 27 min (2026-10-11).
  const take = (t) => { const left = leftOf(t), m = Math.min(left, biggest);
    items.push({ taskId: t.id, minutes: m, ...(m < left ? { of: left } : {}) }); out.add(t.id); taken.add(t.id); budget -= m; };

  // "Start with X": those go first, whatever the engine thinks, as long as
  // they're open and allowed today.
  for (const id of ask.first || []) {
    const t = pool.find((x) => x.id === id);
    if (t && !out.has(t.id) && t.status === "ready" && !t.onHold && !notYet(t, now) && items.length < cap) take(t);
  }
  // Each ride first, filled with what fits it (a train with the laptop:
  // laptop and phone work; a car: calls), as the card would offer it there.
  const onRide = [];
  for (const g of rides) {
    let room = Math.floor((g.end - g.start) / MIN);
    while (items.length + onRide.length < cap && room >= WORTH) {
      const r = rank(pool, { now: g.start, window: room, place: g.place, nextEvent: null, ...workBase(tasks, now),
        sessionSkips: [...out, ...waiting()], booked, routineCal, phoneOk: [...phoneOk] });
      if (!r.pick) break;
      const m = Math.min(leftOf(r.pick.task), room);
      onRide.push({ it: { taskId: r.pick.task.id, minutes: m }, at: g.start });
      out.add(r.pick.task.id); taken.add(r.pick.task.id); room -= m;
    }
  }
  // Down to the last minutes: a 10-min task still goes in the last 10 free
  // (2026-10-11: it vanished with time left, the loop stopped under 15).
  while (usable.length && items.length + onRide.length < cap && budget >= 5) {
    const r = rank(pool, {
      now: usable[0].start, window: Math.min(biggest, budget), nextEvent: null, ...workBase(tasks, now),
      sessionSkips: [...out, ...waiting()], booked, routineCal,
    });
    if (!r.pick) break;
    take(r.pick.task);
  }
  if (ask.fewer) fewerFirst(items, tasks, today, new Set(ask.first || []));
  if (ask.quickFirst) items.sort((a, b) => a.minutes - b.minutes);
  inProjectOrder(items, tasks, new Set(ask.first || []));
  hoursFirst(items, { tasks, events, now, hours, run, rides: false });
  // Nothing due today is dropped without a word (2026-10-11): what the picks
  // left out goes on the end, laid if it fits after all, else No room with
  // its reason (lay). Not when the ask narrowed the plan on purpose.
  const narrowed = ask.fewer || ask.maxEach || Number.isFinite(ask.maxMinutes) || Number.isFinite(ask.until) || skipTypes.size;
  if (!narrowed) for (const t of tasks) {
    if (out.has(t.id) || t.status !== "ready" || t.onHold || t.routine || notYet(t, now) || !t.due || t.due > today || booked[t.id] > now
      || waitsOnSiblings(t, tasks, taken, today)) continue; // a last step still waits for its project's other work
    items.push({ taskId: t.id, minutes: leftOf(t) }); out.add(t.id);
  }
  if (!onRide.length) return items;
  // In time order, so the timeline lays each where it was meant: the
  // others where they'd fall without the rides, the ride's own on the ride.
  const sim = timeline(items, { tasks, events, now, hours, run, rides: false });
  const at = (i) => sim.rows.find((q) => q.i === i)?.start ?? Infinity;
  return [...items.map((it, i) => ({ it, at: at(i) })), ...onRide]
    .map((x, k) => ({ ...x, k })).sort((a, b) => a.at - b.at || a.k - b.k).map((x) => x.it);
}

// Inside one project the plan keeps the project's own order: as dragged in
// Projects (pos), else as added (createdAt), an obvious last step (send,
// deliver, submit…) after its siblings. Each project's items swap among the
// places they already hold, so other projects don't move. fixed: ids the user
// put first ("start with X"). Sorts items in place.
const LAST_STEP = /^\s*(send|deliver|submit|hand (in|over)|upload|publish|release|ship|file)\b/i;
const lastStep = (t) => LAST_STEP.test(String(t?.title || ""));
const inProject = (t) => !!t?.project && t.project !== INBOX && !t.routine;
const projectRank = (a, b) => lastStep(a) - lastStep(b)
  || (a.pos == null) - (b.pos == null) || (a.pos ?? 0) - (b.pos ?? 0)
  || (a.createdAt || 0) - (b.createdAt || 0);
export function inProjectOrder(items, tasks, fixed = new Set()){
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const groups = new Map();
  items.forEach((it, i) => {
    const t = byId.get(it.taskId);
    if (!inProject(t) || fixed.has(t.id)) return;
    if (!groups.has(t.project)) groups.set(t.project, []);
    groups.get(t.project).push(i);
  });
  for (const at of groups.values()) {
    const sorted = at.map((i) => items[i]).sort((a, b) => projectRank(byId.get(a.taskId), byId.get(b.taskId)));
    at.forEach((i, k) => { items[i] = sorted[k]; });
  }
  return items;
}
// A task with set hours the plan's order pushed out of them (an office call
// after 16:00) moves up to the first place it fits, rather than not at all.
function hoursFirst(items, ctx){
  const byId = new Map(ctx.tasks.map((t) => [t.id, t]));
  for (const o of timeline(items, ctx).over) {
    if (!byId.get(o.taskId)?.openHours) continue;
    const from = items.findIndex((it) => it.taskId === o.taskId);
    const rest = items.filter((_, i) => i !== from);
    for (let k = 0; k < from; k++) {
      const next = [...rest.slice(0, k), items[from], ...rest.slice(k)];
      if (!timeline(next, ctx).over.some((x) => x.taskId === o.taskId)) { items.splice(0, items.length, ...next); break; }
    }
  }
  return items;
}
// A last step with other open work in its project not in the plan yet waits
// for it — unless its deadline is today or passed (then it comes, after them).
function waitsOnSiblings(t, tasks, taken, today){
  if (!lastStep(t) || !inProject(t) || taken.has(t.id)) return false;
  if (t.dateKind === "deadline" && t.due && t.due <= today) return false;
  return tasks.some((x) => x.id !== t.id && x.project === t.project && x.status === "ready" && !x.routine && !lastStep(x) && !taken.has(x.id));
}

// The plan on the clock: each item, in the user's order, in the first free
// gap from where the previous one ended that holds all of it. Order wins over
// packing — a gap left too short for the next item stays empty rather than
// pulling a later item forward. A ride is the exception: it's a side slot,
// and any item that fits it goes there when that's sooner than its place in
// order (Mor, 2026-10-09: a laptop task first sent the whole plan past the
// ride and left it empty). Rows come back in time order. → { rows: [{ taskId, task, minutes, start,
// end }], over: [{ taskId, task, minutes, room }] } (over: doesn't fit today;
// room: the most minutes a shorter version could still have today, on a round
// five, when that's at least WORTH — the plan offers to shorten it to that).
// Minutes of back-to-back calendar events ending at `t` (gaps under
// BREAKS.reset between them still count as one run).
function runBefore(evs, t){
  const spans = evs.map((e) => [Date.parse(e.start), Date.parse(e.end)]).filter(([s, e]) => e <= t + MIN).sort((a, b) => b[1] - a[1]);
  let edge = t, total = 0;
  for (const [s, e] of spans) {
    if (edge - e >= W.BREAKS.reset * MIN) break;
    total += Math.max(0, (e - s) / MIN);
    edge = Math.min(edge, s);
  }
  return total;
}
const clockMin = (ms) => { const d = new Date(ms); return d.getHours() * 60 + d.getMinutes(); };

// The break due before the next item, or null. worked: minutes since the last
// break of any kind; sinceLong: since the last long one or meal. meals: the
// user's (day.js mealsOf); mealsDone: names of those already had today.
// prevStart: when the item just before started, if it runs straight into
// this one.
export function breakDue({ worked, sinceLong, at, mealsDone = new Set(), meals = mealsOf(), need = 0, prevStart = null }){
  const B = W.BREAKS, m = clockMin(at);
  // A meal comes once something has been done (never first thing at noon), or
  // when the next item would carry past its window and the meal would be missed.
  // A long item across the whole window (user test 2026-10-11: no lunch on 3
  // of 9 days) gets it up to an hour early, before it, or else up to an hour
  // late, right after it.
  for (const meal of meals) {
    if (mealsDone.has(meal.name)) continue;
    const meal_ = { type: "meal", name: meal.name, minutes: meal.minutes };
    if (m >= meal.from && m < meal.to) {
      if (worked >= B.lunchAfter || m + need >= meal.to) return meal_;
    } else if (m < meal.from && m >= meal.from - B.mealSlack && m + need > meal.to && worked >= B.lunchAfter) return meal_;
    else if (m >= meal.to && m < meal.to + B.mealSlack && prevStart != null && clockMin(prevStart) < meal.to) return meal_;
  }
  // A long break is due after longEvery, or before an item that would take a
  // stretch already past after well over it (no 4 h blocks on one short break).
  if (sinceLong >= B.longEvery || (sinceLong >= B.after && sinceLong + need > B.longEvery + B.long)) {
    // A long break due just before a meal is the meal, not one then the other.
    const soon = meals.find((meal) => !mealsDone.has(meal.name) && m < meal.from && meal.from - m <= B.long);
    return soon ? { type: "meal", name: soon.name, minutes: soon.minutes } : { type: "long", minutes: B.long };
  }
  if (worked >= B.after) return { type: "short", minutes: B.short };
  return null;
}

// A break in the plan is an item of its own, { brk: "short" | "long" |
// "meal", minutes, name (meals only) } — "lunch" is the old meal, read as one.
// (Mor, 2026-10-08: so a drag can put a task anywhere,
// breaks included). A plan with none yet gets them from the rules here
// (breakDue) once, where they'd fall; after that they're the user's and
// move only when dragged.
export const isBreak = (it) => !!it?.brk;
const isMeal = (it) => it?.brk === "meal" || it?.brk === "lunch";
// A meal item's name: its own, else the meal whose window it falls in (an old
// "lunch" item), else Lunch.
function mealName(it, meals, at){
  if (it.name) return it.name;
  const m = clockMin(at);
  return meals.find((x) => m >= x.from && m < x.to)?.name || "Lunch";
}
// A plan never starts or ends on a break: those go (Mor, 2026-10-08).
export function trimBreaks(items = []){
  let a = 0, z = items.length;
  while (a < z && isBreak(items[a])) a++;
  while (z > a && isBreak(items[z - 1])) z--;
  return a === 0 && z === items.length ? items : items.slice(a, z);
}
export function withBreaks(items = [], ctx = {}){
  items = trimBreaks(items);
  if (items.some(isBreak)) return items;
  const { rows, breaks } = timeline(items, ctx);
  const out = [];
  items.forEach((it, i) => {
    const r = rows.find((q) => q.i === i), b = r && breaks.find((q) => q.end === r.start);
    if (b) out.push({ brk: b.type, minutes: b.minutes, ...(b.name ? { name: b.name } : {}) });
    out.push(it);
  });
  return out;
}

// Each row and break carries i, its index in items.
//
// An approved plan holds its times (Mor, 2026-10-10: "when task time arrives
// the task moves 5 minutes forward"). Laid from now, a task you haven't
// started slid forward with the clock forever. ctx.since: when you last did
// anything (miss.lastActivity). The plan is laid from then; when its next
// task's start has come with nothing started, it stays there, the whole plan
// with it, and the result says late: { taskId, start } so the card can ask
// (Start / In 10 min / Move); once a planned row's whole time has passed
// it's missed. Any activity lays it from now again. While a
// task runs the plan follows the clock as before. An item's at (ms): not
// before then ("In 10 min").
const up5 = (ms) => Math.ceil(ms / (5 * MIN)) * 5 * MIN;
export function timeline(items = [], ctx = {}){
  const now = ctx.now ?? Date.now();
  if (ctx.since == null || runState(ctx.run, ctx.tasks || [], now)) return lay(items, ctx);
  const from = Math.min(now, up5(ctx.since));
  const held = from < now ? lay(items, { ...ctx, now: from }) : null;
  const head = held?.rows.filter((r) => !r.ride).sort((a, b) => a.i - b.i)[0];
  if (!head || head.start >= now) return lay(items, ctx);
  // Planned, its time over, never started (Mor, 2026-10-10: not "as if they
  // happened"): row.missed, and missed lists their ids in plan order.
  const missed = held.rows.filter((r) => !r.ride && r.end <= now).sort((a, b) => a.i - b.i);
  for (const r of missed) r.missed = true;
  return { ...held, late: { taskId: head.taskId, start: head.start }, missed: missed.map((r) => r.taskId) };
}
function lay(items = [], { tasks = [], events = [], now = Date.now(), hours = W.DAY_HOURS, run = null, rides = true, phoneOk = phoneOkIds(tasks) } = {}){
  const { evs, gaps } = freeGaps({ tasks, events, now, hours, run, rides });
  const meals = hours.meals ?? mealsOf();
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const rows = [], over = [], breaks = [];
  // The first start on a round five minutes: 15:55, not 15:52.
  let gi = 0, cursor = Math.ceil((gaps[0]?.start ?? now) / (5 * MIN)) * 5 * MIN;
  // Work since the last break, and since the last long one (a meal counts).
  let worked = 0, sinceLong = 0, lastEnd = null, lastStart = null;
  const mealsDone = new Set(), rideAt = {}; // rideAt: where each ride's next task starts
  const gapEnd = new Map(); // each break → the end of the free gap it's in
  // Breaks are the plan's own items: none are added here.
  const fixed = items.some(isBreak);
  let afterDone = false; // the last item looked at was finished work
  let doneAt = 0; // when that work was finished
  // Put off with "Later today" (it.hold, ms): laid once its time comes, the
  // rest moving up meanwhile (Mor, 2026-10-10: the Today list kept it where
  // it was while the card had moved on).
  const later = [];
  // A meal the plan carried past its time (Mor, 2026-10-12: lunch at 20:30,
  // its tasks before it slid): not laid there; Needs you asks if you ate
  // (now.js mealLateAsk). Late: an hour past its window, breakDue's own limit.
  const lateMeals = [];
  const isLate = (meal, at) => {
    const w = meal && meals.find((x) => x.name === meal);
    return !!w && at >= new Date(now).setHours(0, w.to + W.BREAKS.mealSlack, 0, 0);
  };
  const lo = items.findIndex((it) => !isBreak(it)), hi = items.findLastIndex((it) => !isBreak(it));
  for (const [i, it] of items.entries()) {
    if (isBreak(it)) {
      if (i < lo || i > hi) continue; // never first or last
      if (isMeal(it) && !meals.length) continue; // meals switched off in Settings
      const len = Math.max(5, it.minutes || 10) * MIN;
      // A break right after finished work, with nothing laid since, runs from
      // when the work was finished: had once that's over, until then it's
      // now (it vanished the moment Done was tapped).
      if (afterDone && !rows.length) {
        if (!doneAt || doneAt + len <= now) continue;
        const g = gaps.findIndex((x) => !x.place && x.end > now);
        if (g < 0 || (isMeal(it) && !meals.length)) continue;
        const meal = isMeal(it) ? mealName(it, meals, doneAt) : null;
        if (isLate(meal, doneAt)) { lateMeals.push(meal); continue; }
        breaks.push({ kind: "break", type: meal ? "meal" : it.brk, minutes: len / MIN, start: doneAt, end: doneAt + len, i, ...(meal ? { name: meal } : {}) });
        gapEnd.set(breaks[breaks.length - 1], gaps[g].end);
        worked = 0; if (it.brk !== "short") sinceLong = 0;
        if (meal) mealsDone.add(meal);
        lastEnd = doneAt + len; gi = g; cursor = Math.max(cursor, Math.ceil((doneAt + len) / (5 * MIN)) * 5 * MIN);
        continue;
      }
      for (let k = gi; k < gaps.length; k++) {
        if (gaps[k].place) continue; // no break on the train: the ride is one
        const from = Math.max(cursor, gaps[k].start);
        if (gaps[k].end - from < len) continue;
        const meal = isMeal(it) ? mealName(it, meals, from) : null;
        if (isLate(meal, from)) { lateMeals.push(meal); break; }
        breaks.push({ kind: "break", type: meal ? "meal" : it.brk, minutes: len / MIN, start: from, end: from + len, i, ...(meal ? { name: meal } : {}) });
        gapEnd.set(breaks[breaks.length - 1], gaps[k].end);
        worked = 0; if (it.brk !== "short") sinceLong = 0;
        if (meal) mealsDone.add(meal);
        lastEnd = from + len; gi = k; cursor = from + len;
        break;
      }
      continue;
    }
    const task = byId.get(it.taskId);
    if (!task || task.status === "done" || task.status === "dropped") { afterDone = !!task; doneAt = task?.doneAt || 0; continue; }
    // Pending, Not now, Tomorrow, This week: off today's plan.
    if (task.status !== "ready" || notYet(task, now)) continue;
    if (it.hold > cursor) { later.push({ it: { ...it, at: Math.max(it.at || 0, it.hold) }, i }); continue; }
    while (later.length && later[0].it.at <= cursor) { const d = later.shift(); place(d.it, d.i, byId.get(d.it.taskId)); }
    afterDone = false;
    place(it, i, task);
  }
  for (const d of later) place(d.it, d.i, byId.get(d.it.taskId));
  function place(it, i, task){
    // What the item was saved with, but never more than is left: progress
    // made since the plan was saved shrinks its slot.
    const need = Math.max(5, Math.min(it.minutes || Infinity, leftOf(task))) * MIN;
    let placed = false;
    // The soonest ride that fits it (engine.fitsPlace) and still has room.
    const ride = gaps.map((g, k) => ({ g, k, from: rideAt[k] ?? Math.ceil(g.start / (5 * MIN)) * 5 * MIN }))
      .find(({ g, from }) => g.place && fitsPlace(task, g.place, phoneOk) && g.end - from >= need && openStart(task, from, need) === from);
    for (let k = gi; k < gaps.length; k++) {
      if (gaps[k].place) continue; // rides: above
      let from = Math.max(cursor, gaps[k].start, up5(it.at || 0));
      if (ride && ride.from <= from) break;
      if (task.openHours) { const o = openStart(task, from, need); if (o == null) continue; from = up5(o); }
      // Same stretch as the last item, or a fresh one that starts with the
      // meetings just before it.
      const cont = lastEnd != null && from - lastEnd < W.BREAKS.reset * MIN;
      const w = cont ? worked : runBefore(evs, from), sl = cont ? sinceLong : w;
      const brk = !fixed && !gaps[k].place && breakDue({ worked: w, sinceLong: sl, at: from, mealsDone, meals, need: need / MIN, prevStart: cont ? lastStart : null });
      const gap = (brk ? brk.minutes * MIN : 0) + need;
      if (gaps[k].end - from >= gap && (!brk || openStart(task, from + brk.minutes * MIN, need) != null)) {
        if (brk) {
          breaks.push({ kind: "break", type: brk.type, minutes: brk.minutes, start: from, end: from + brk.minutes * MIN, i: null, ...(brk.name ? { name: brk.name } : {}) });
          gapEnd.set(breaks[breaks.length - 1], gaps[k].end);
          if (brk.name) mealsDone.add(brk.name);
        }
        const s = from + (brk ? brk.minutes * MIN : 0);
        rows.push({ taskId: it.taskId, task, minutes: need / MIN, start: s, end: s + need, i, ...(leftOf(task) > need / MIN ? { of: leftOf(task) } : {}) });
        worked = (brk ? 0 : w) + need / MIN;
        sinceLong = (brk && brk.type !== "short" ? 0 : sl) + need / MIN;
        lastEnd = s + need; lastStart = s;
        gi = k; cursor = s + need; placed = true;
        break;
      }
    }
    // On the ride: its own clock, and the rest of the plan carries on as if
    // it weren't there (no break on a ride: the ride is one).
    if (!placed && ride) {
      rows.push({ taskId: it.taskId, task, minutes: need / MIN, start: ride.from, end: ride.from + need, i, ...(leftOf(task) > need / MIN ? { of: leftOf(task) } : {}), ride: ride.g.mode === "car" && ride.g.place !== "car" ? "passenger" : ride.g.mode });
      rideAt[ride.k] = ride.from + need; placed = true;
    }
    if (!placed) {
      let room = 0;
      for (let k = gi; k < gaps.length; k++) room = Math.max(room, gaps[k].end - Math.max(cursor, gaps[k].start));
      room = Math.floor(room / (5 * MIN)) * 5;
      // Would it fit with nothing else in the plan? If not, ↑ can't help
      // and "free in one stretch" reads as if other tasks took the time
      // (Mor, 2026-10-12: 3 h task alone at 01:00, "2 h 50 min free in one
      // stretch", ↑ offered on the only item).
      const open = gaps.filter((g) => !g.place);
      const most = Math.floor(Math.max(0, ...open.map((g, k) => g.end - (k ? g.start : up5(g.start)))) / (5 * MIN)) * 5;
      const never = most * MIN < need;
      // Why there's no room, in plain facts (2026-10-11: never dropped unsaid).
      const hoursShut = task.openHours && task.openHours !== "anytime"
        && !gaps.slice(gi).some((g) => !g.place && openStart(task, Math.max(cursor, g.start), need) != null);
      const why = hoursShut ? (task.openHours === "office" ? "needs office hours, none left today" : "evening only, no evening time left")
        : never && most >= 5 ? `needs ${durText(need / MIN)}, ${open.length > 1 ? `longest free stretch today is ${durText(most)}` : `only ${durText(most)} left today`}`
        : room >= 5 ? `needs ${durText(need / MIN)}, ${durText(room)} free in one stretch after the rest` : "no free time left today";
      over.push({ taskId: it.taskId, task, minutes: need / MIN, room: room >= WORTH ? room : 0, i, why, ...(never && !hoursShut ? { never: true } : {}) });
    }
  }
  // A break runs on to whatever comes next, up to the next meeting: free time
  // after it is part of it, not a hole (Mor, 2026-10-10: "break shows 10 min
  // although there's a free hour there"). end moves; minutes stays the
  // item's own length, so saving the plan doesn't grow the break.
  // A break with no work after it today (what came after is done, or no
  // longer fits) goes: it read "☕ Breather · 7 h 40 min" for the rest of the
  // day (user test 2026-10-11).
  const lastWork = Math.max(-Infinity, ...rows.filter((r) => !r.ride).map((r) => r.start));
  const kept = breaks.filter((b) => b.start < lastWork);
  const starts = [...rows.filter((r) => !r.ride).map((r) => r.start), ...kept.map((b) => b.start)];
  for (const b of kept) {
    const next = Math.min(gapEnd.get(b), ...starts.filter((s) => s >= b.end));
    if (next > b.end) b.end = next;
  }
  return { rows: rows.sort((a, b) => a.start - b.start), over, breaks: kept, lateMeals };
}

// When the day shrinks under an approved plan (an event added, or running
// late), this is what Daisey proposes to cut; since 2026-10-10 it asks
// first and saves only on approval (now.js behindView: "it needs to always
// ask and get approval", superseding 2026-10-08's cut-then-tell).
// What stays is decided by how much it matters, not by position: each task,
// most important first, stays if the plan still fits with it in; the user's
// order is kept for what stays. keep: ids that never go (the running task,
// ones the user put back with Undo). → { items, cut: [taskId] }, cut empty
// when nothing had to go.
const DAY = 86400000;
function weight(t, now){
  if (!t?.due) return 0;
  const days = (Date.parse(`${t.due}T23:59`) - now) / DAY;
  if (t.dateKind === "deadline") return days < 1 ? 4 : days < 3 ? 3 : 1;
  return days < 1 ? 2 : 0;
}
// No break first, last, or right after another one.
function tidy(items){
  return trimBreaks(items.filter((it, i) => !(isBreak(it) && isBreak(items[i + 1]))));
}
export function refit(items = [], ctx = {}, keep = []){
  const now = ctx.now ?? Date.now();
  const byId = new Map((ctx.tasks || []).map((t) => [t.id, t]));
  const stays = new Set([...keep, ...(ctx.run?.batch || (ctx.run?.taskId ? [ctx.run.taskId] : []))]);
  const fits = (list) => !timeline(list, ctx).over.some((o) => !stays.has(o.taskId));
  if (fits(items)) return { items, cut: [] };
  const open = (it) => byId.get(it.taskId)?.status === "ready";
  const kept = new Set(items.map((it, i) => (isBreak(it) || !open(it) || stays.has(it.taskId) ? i : -1)).filter((i) => i >= 0));
  const order = items.map((it, i) => ({ it, i })).filter(({ i }) => !kept.has(i))
    .sort((a, b) => weight(byId.get(b.it.taskId), now) - weight(byId.get(a.it.taskId), now) || a.i - b.i);
  const cut = [];
  for (const { it, i } of order) {
    kept.add(i);
    if (!fits(tidy(items.filter((_, k) => kept.has(k))))) { kept.delete(i); cut.push(it.taskId); }
  }
  return { items: tidy(items.filter((_, k) => kept.has(k))), cut };
}

// The other half of refit (Mor, 2026-10-09): the day opened up (a meeting
// gone, the day made longer), so fresh picks go on the end of the plan —
// never before or between what's there, so nothing already in it moves
// later, and nothing in it is pushed out of today. The timeline lays the
// plan from now, so freed time earlier in the day is already used by the
// items after it and what's left is at the end. skip: ids never to add (the
// user took them off with Undo). → { items, added: [taskId] }.
export function topUp(items = [], ctx = {}, skip = []){
  const byId = new Map((ctx.tasks || []).map((t) => [t.id, t]));
  const open = items.filter((it) => !isBreak(it) && byId.get(it.taskId)?.status === "ready").length;
  const room = MAX_ITEMS - open;
  if (room <= 0) return { items, added: [] };
  const overBefore = timeline(items, ctx).over.length;
  const picks = proposeDay({ ...ctx, exclude: [...items.filter((it) => it.taskId).map((it) => it.taskId), ...skip] });
  let out = items;
  const added = [];
  for (const p of picks) {
    if (added.length >= room) break;
    const next = [...out, p];
    if (timeline(next, ctx).over.length > overBefore) continue; // doesn't fit, or pushes one out
    out = next; added.push(p.taskId);
  }
  return { items: out, added };
}

// The plan's one-tap Fewer tasks / More tasks (user test 2026-10-11: More
// jumped 2 h 35 to 10 h, until 21:55; Fewer kept a passport renewal due in a
// month and dropped two packs due Friday). Both work on the plan as it is.
// Fewer keeps the most pressing ~60% of its tasks — the nearest date first, a
// deadline counted two days nearer, undated last — in their order. More adds
// up to MORE_ADD tasks or MORE_MIN minutes, whichever comes first, on the end.
const MORE_ADD = 3, MORE_MIN = 120;
const pressing = (t, today) => {
  if (!t?.due) return Infinity;
  const days = (Date.parse(`${t.due}T12:00`) - Date.parse(`${today}T12:00`)) / DAY;
  return days - (t.dateKind === "deadline" ? 2 : 0);
};
// A fresh lighter plan: the FEWER most pressing of the picks (those the user
// put first always stay), in the order they were picked. Sorts in place.
function fewerFirst(items, tasks, today, fixed){
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const keep = new Set(items.map((it, i) => ({ it, i }))
    .sort((a, b) => fixed.has(b.it.taskId) - fixed.has(a.it.taskId)
      || pressing(byId.get(a.it.taskId), today) - pressing(byId.get(b.it.taskId), today) || a.i - b.i)
    .slice(0, FEWER).map(({ it }) => it));
  items.splice(0, items.length, ...items.filter((it) => keep.has(it)));
  return items;
}
export function fewerOf(items = [], ctx = {}){
  const now = ctx.now ?? Date.now(), today = planDate(now, ctx.hours ?? W.DAY_HOURS);
  const byId = new Map((ctx.tasks || []).map((t) => [t.id, t]));
  const tasks = items.map((it, i) => ({ it, i })).filter(({ it }) => !isBreak(it));
  if (tasks.length < 2) return items;
  const keep = Math.max(1, Math.min(tasks.length - 1, Math.round(tasks.length * 0.6)));
  // What has No room goes first: it wasn't happening today anyway, and
  // keeping it left a "lighter" plan of one task that doesn't fit (Mor, 2026-10-12).
  const over = new Set(timeline(items, ctx).over.map((o) => o.i));
  const kept = new Set(tasks.sort((a, b) => over.has(a.i) - over.has(b.i) || pressing(byId.get(a.it.taskId), today) - pressing(byId.get(b.it.taskId), today) || a.i - b.i)
    .slice(0, keep).map(({ i }) => i));
  return tidy(items.filter((it, i) => isBreak(it) || kept.has(i)));
}
export function moreOf(items = [], ctx = {}){
  const plan = items.filter((it) => !isBreak(it));
  const picks = proposeDay({ ...ctx, exclude: [...(ctx.exclude || []), ...plan.map((it) => it.taskId)] });
  let out = plan, added = 0, mins = 0;
  const overBefore = timeline(out, ctx).over.length;
  for (const p of picks) {
    if (added >= MORE_ADD || mins >= MORE_MIN) break;
    if (mins + p.minutes > MORE_MIN && (added || p.minutes > MORE_MIN * 1.5)) continue;
    const next = [...out, p];
    if (timeline(next, ctx).over.length > overBefore) continue;
    out = next; added++; mins += p.minutes;
  }
  return out;
}

// A meal answered in Needs you (meals.js, Mor 2026-10-09: "it asked, but
// didn't rearrange my schedule"). A plan's breaks are its own items and
// don't move by themselves, so the answer moves them, once per answer:
// "there" takes that meal out; a new time puts it before the first item
// that would start at or after that time (a break right before it goes,
// the meal is one). laid: { [name]: answer } already done on this plan, so a
// later drag isn't undone. → { items, laid }, the same items when nothing to do.
export function relayMeals(items = [], ctx = {}, laid = {}){
  const now = ctx.now ?? Date.now(), today = ctx.hours ? planDate(now, ctx.hours) : answerDate(ctx.settings, now);
  const said = ctx.settings?.mealToday?.date === today ? ctx.settings.mealToday : {};
  const meals = ctx.hours?.meals ?? mealsOf(ctx.settings);
  let out = items;
  const done = { ...laid };
  for (const [name, answer] of Object.entries(said)) {
    if (name === "date" || done[name] === answer) continue;
    done[name] = answer;
    const ours = (it) => isMeal(it) && (it.name === name || (!it.name && name === "Lunch"));
    const old = out.find(ours);
    out = out.filter((it) => !ours(it));
    const meal = meals.find((m) => m.name === name);
    if (answer === "there" || !meal) continue;
    const from = atMin(now, meal.from);
    const { rows } = timeline(out, ctx);
    let k = rows.filter((r) => r.start >= from).sort((a, b) => a.start - b.start)[0]?.i;
    if (k == null) continue; // the plan's over by then: no meal in it
    let j = k;
    while (j > 0 && isBreak(out[j - 1])) j--;
    out = [...out.slice(0, j), { brk: "meal", minutes: old?.minutes || meal.minutes, name }, ...out.slice(k)];
  }
  out = trimBreaks(out);
  return { items: out.length === items.length && out.every((it, j) => it === items[j]) ? items : out, laid: done };
}

// What the plan was laid against: today's busy events and the day's hours,
// as a short key. The plan is redone (refit / topUp) when it changes, not
// when the clock moves; renames and free events don't count.
export function daySig(events = [], hours = W.DAY_HOURS, now = Date.now()){
  const today = localDate(now);
  const spans = events.filter((e) => !e.allDay && e.busy !== false
    && (localDate(Date.parse(e.start)) === today || localDate(Date.parse(e.end)) === today))
    .map((e) => `${Date.parse(e.start)}-${Date.parse(e.end)}${e.trip ? `@${e.trip.place}` : ""}`).sort(); // a ride's place counts: passenger opens it up
  const s = `${hours.start}-${hours.end}|${JSON.stringify(hours.meals ?? null)}|${spans.join(",")}`;
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

// The approved plan's next item that's still open and allowed now: the card
// follows it (now.js). null when the plan is done or isn't today's.
export function nextPlanned(plan, tasks = [], date, now = Date.now()){
  if (!plan || plan.status !== "approved" || plan.date !== date) return null;
  const byId = new Map(tasks.map((t) => [t.id, t]));
  for (const it of plan.items || []) {
    const t = byId.get(it.taskId);
    if (t && t.status === "ready" && !t.onHold && !notYet(t, now)) return t.id;
  }
  return null;
}
// unfit: ids the plan had No room for (unfitOf) — never scheduled, so not
// counted (2026-10-11: "Plan 0/3" with two tasks laid), unless done anyway.
export function planProgress(plan, tasks = [], unfit = []){
  const byId = new Map(tasks.map((t) => [t.id, t]));
  // A routine isn't closed by Done (routine.sessionPatch): it's back to ready
  // with a session logged for the day, so that counts too (2026-10-11: two
  // routines done, the chip read 0/5).
  const done = (t) => t.status === "done" || (!!plan?.date && (t.routine?.log || []).some((l) => l.day === plan.date));
  const skip = new Set(unfit);
  const items = (plan?.items || []).filter((it) => byId.has(it.taskId) && (!skip.has(it.taskId) || done(byId.get(it.taskId))));
  return { done: items.filter((it) => done(byId.get(it.taskId))).length, total: items.length };
}

// What the plan had No room for when it was approved: saved then (plan.unfit),
// or, for a plan saved before that was kept, laid again from its approval time.
export function unfitOf(plan, ctx = {}){
  if (Array.isArray(plan?.unfit)) return plan.unfit;
  const now = plan?.approvedAt ? Math.min(plan.approvedAt, ctx.now ?? Date.now()) : ctx.now;
  return lay(plan?.items || [], { ...ctx, now }).over.map((o) => o.taskId);
}

// Is the approved plan behind? (2026-10-11: a task with No room from the
// start showed "Running late" and "Your plan slipped" the moment the plan
// was approved.) Only the clock against the plan's own slots and what's
// actually done count: late — the next slot's time came with nothing
// started; missed — slots whose whole time passed, not done; cut — tasks
// that had a slot and no longer fit what's left of today. Something that
// never fit is none of these. since: the last activity (miss.lastActivity).
// → { late, missed, cut, items (the refit), unfit, behind }.
export function planStatus(plan, ctx = {}, since = null){
  const unfit = unfitOf(plan, ctx), items = plan?.items || [];
  const held = timeline(items, { ...ctx, since });
  const fit = refit(items, ctx, [...(plan?.kept || []), ...unfit]);
  const late = held.late || null, missed = held.missed || [];
  return { late, missed, cut: fit.cut, items: fit.items, unfit, behind: !!late || missed.length > 0 || fit.cut.length > 0 };
}

// "Rethink" in plain words, read here so it works offline and for guests;
// Gemini reads it first when it's set up (rethink.js), and this is the
// fallback. Understands, in English and a little Hebrew:
//   fewer / less / tired / easy · more — how many items
//   no calls / without admin / skip <task or project> — leave out
//   start with <task> / <task> first — put first
//   quick first / small things first — shortest first
//   only 2 hours / 90 min — total time · until 15:00 / by 5pm — end time
// → { fewer, more, quickFirst, skipTypes, exclude, first,
//     maxMinutes, until, understood } (understood: false when nothing matched).
export function parseAsk(text = "", tasks = []){
  const s = ` ${String(text).toLowerCase().replace(/[.,!?;]+/g, " ").replace(/\s+/g, " ").trim()} `;
  const has = (re) => re.test(s);
  const ask = { skipTypes: [], exclude: [], first: [] };
  if (has(/\b(fewer|less|smaller day|lighter day|not so much|light(er)?|easy|easier|tired|wrecked|chill)\b|פחות|עייף|קל/)) ask.fewer = true;
  if (has(/\b(more tasks|more things|fill (it|the day)|pack)\b|יותר/)) ask.more = true;
  if (has(/\b(quick|small|short)( (ones?|things|tasks|stuff))? first\b|start (small|easy)/)) ask.quickFirst = true;

  const hours = s.match(/\b(\d+(?:\.\d+)?)\s*(h|hr|hrs|hours?)\b/);
  const mins = s.match(/\b(\d+)\s*(m|min|mins|minutes)\b/);
  if (hours || mins) ask.maxMinutes = Math.round((hours ? parseFloat(hours[1]) * 60 : 0) + (mins ? parseInt(mins[1], 10) : 0));
  const until = s.match(/\b(?:until|till|til|by|done by|stop at|finish by|עד)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
  if (until) {
    let h = parseInt(until[1], 10);
    if (until[3] === "pm" && h < 12) h += 12;
    if (!until[3] && h < 8) h += 12; // "until 5" in a working day means 17:00
    ask.until = h * 60 + (until[2] ? parseInt(until[2], 10) : 0);
  }

  // Types: "no calls", "without errands", "skip admin".
  for (const [type, label] of Object.entries(LABELS.type)) {
    const word = label.toLowerCase();
    if (new RegExp(`\\b(no|without|skip|not|drop|avoid)\\s+(any\\s+)?${word}s?\\b`).test(s)) ask.skipTypes.push(type);
  }
  // Tasks and projects by name.
  const open = tasks.filter((t) => t.status !== "done" && t.status !== "dropped");
  const named = (phrase) => {
    const p = phrase.trim();
    if (p.length < 3) return [];
    return open.filter((t) => {
      const title = String(t.title || "").toLowerCase(), proj = String(t.project || "").toLowerCase();
      return title.includes(p) || (proj.length > 2 && (proj.includes(p) || p.includes(proj))) || (title.length > 3 && p.includes(title));
    }).map((t) => t.id);
  };
  const STOP = "(?=\\s(?:and|then|but|also|first|today|please|start|begin|skip|no|without|only|until|by)\\b|\\s*$)";
  for (const m of s.matchAll(new RegExp(`\\b(?:no|without|skip|drop|not|leave out|remove)\\s+(?:the\\s+)?(.+?)${STOP}`, "g"))) {
    for (const id of named(m[1])) if (!ask.exclude.includes(id)) ask.exclude.push(id);
  }
  for (const m of s.matchAll(/בלי\s+(.+?)(?=\s+ו|\s*$)/g)) for (const id of named(m[1])) if (!ask.exclude.includes(id)) ask.exclude.push(id);
  const firsts = [...s.matchAll(new RegExp(`\\b(?:start with|begin with|first)\\s+(?:the\\s+)?(.+?)${STOP}`, "g"))].map((m) => m[1])
    .concat([...s.matchAll(/\b(?:do\s+)?(?:the\s+)?(.+?)\s+first\b/g)].map((m) => m[1]))
    .concat([...s.matchAll(/(?:קודם|להתחיל עם)\s+(.+?)(?=\s+ו|\s*$)/g)].map((m) => m[1]));
  for (const f of firsts) for (const id of named(f)) if (!ask.first.includes(id) && !ask.exclude.includes(id)) ask.first.push(id);

  ask.understood = !!(ask.fewer || ask.more || ask.quickFirst || ask.maxMinutes || ask.until != null
    || ask.skipTypes.length || ask.exclude.length || ask.first.length);
  return ask;
}

const atMin = (now, m) => { const d = new Date(now); d.setHours(0, m, 0, 0); return d.getTime(); };
