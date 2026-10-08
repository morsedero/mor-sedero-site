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
import { gapsToday, bookings, mealsOf } from "./day.js";
import { rank, fitsPlace } from "./engine.js";
import { routineCalendar } from "./routine.js";
import { workBase } from "./context.js";
import { overruled, eventKey } from "./reality.js";
import { LABELS, notYet, localDate } from "./model.js";
import * as W from "./weights.js";

const MIN = 60000;
const WORTH = 15; // minutes: a gap shorter than this holds nothing
export const MAX_ITEMS = 8;
const FEWER = 3;
const MORE = 10;

// What's left of a task: its size less the time already put in.
export const leftOf = (t) => Math.max(5, (t.size || 0) - (t.spentMinutes || 0));

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
export function proposeDay({ tasks = [], events = [], now = Date.now(), hours = W.DAY_HOURS, settings = {}, run = null, ask = {}, exclude = [] } = {}){
  const { evs, gaps: all } = freeGaps({ tasks, events, now, hours, run });
  const until = Number.isFinite(ask.until) ? atMin(now, ask.until) : Infinity;
  const cut = (gs) => gs.map((g) => ({ ...g, end: Math.min(g.end, until) })).filter((g) => g.end - g.start >= WORTH * MIN);
  const usable = cut(all.filter((g) => !g.place)), rides = cut(all.filter((g) => g.place));
  if (!usable.length && !rides.length) return [];
  let budget = usable.reduce((s, g) => s + Math.floor((g.end - g.start) / MIN), 0);
  if (Number.isFinite(ask.maxMinutes)) budget = Math.min(budget, ask.maxMinutes);
  const biggest = usable.length ? Math.max(...usable.map((g) => Math.floor((g.end - g.start) / MIN))) : 0;
  const cap = ask.fewer ? FEWER : ask.more ? MORE : MAX_ITEMS;
  const skipTypes = new Set(ask.skipTypes || []);
  const out = new Set([...exclude, ...(ask.exclude || []), ...(run?.batch || (run?.taskId ? [run.taskId] : []))]);
  // maxEach: only tasks this small (the lighter plan, miss.js) — a deadline due today still comes.
  const today = localDate(now);
  const pool = tasks.filter((t) => !skipTypes.has(t.type)
    && (!ask.maxEach || leftOf(t) <= ask.maxEach || (t.dateKind === "deadline" && t.due && t.due <= today)));
  const booked = Object.fromEntries([...bookings(tasks, evs, now)].map(([id, b]) => [id, b.start]));
  const routineCal = routineCalendar(tasks, evs, now); // routine sessions already on the calendar
  const items = [];
  const take = (t) => { items.push({ taskId: t.id, minutes: Math.min(leftOf(t), biggest) }); out.add(t.id); budget -= Math.min(leftOf(t), biggest); };

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
        sessionSkips: [...out], booked, routineCal });
      if (!r.pick) break;
      const m = Math.min(leftOf(r.pick.task), room);
      onRide.push({ it: { taskId: r.pick.task.id, minutes: m }, at: g.start });
      out.add(r.pick.task.id); room -= m;
    }
  }
  while (usable.length && items.length + onRide.length < cap && budget >= WORTH) {
    const r = rank(pool, {
      now: usable[0].start, window: biggest, nextEvent: null, ...workBase(tasks, now),
      sessionSkips: [...out], booked, routineCal,
    });
    if (!r.pick) break;
    take(r.pick.task);
  }
  if (ask.quickFirst) items.sort((a, b) => a.minutes - b.minutes);
  if (!onRide.length) return items;
  // In time order, so the timeline lays each where it was meant: the
  // others where they'd fall without the rides, the ride's own on the ride.
  const sim = timeline(items, { tasks, events, now, hours, run, rides: false });
  const at = (i) => sim.rows.find((q) => q.i === i)?.start ?? Infinity;
  return [...items.map((it, i) => ({ it, at: at(i) })), ...onRide]
    .map((x, k) => ({ ...x, k })).sort((a, b) => a.at - b.at || a.k - b.k).map((x) => x.it);
}

// The plan on the clock: each item, in the user's order, in the first free
// gap from where the previous one ended that holds all of it. Order wins over
// packing — a gap left too short for the next item stays empty rather than
// pulling a later item forward. → { rows: [{ taskId, task, minutes, start,
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
export function breakDue({ worked, sinceLong, at, mealsDone = new Set(), meals = mealsOf(), need = 0 }){
  const B = W.BREAKS, m = clockMin(at);
  // A meal comes once something has been done (never first thing at noon), or
  // when the next item would carry past its window and the meal would be missed.
  for (const meal of meals) {
    if (mealsDone.has(meal.name) || m < meal.from || m >= meal.to) continue;
    if (worked >= B.lunchAfter || m + need >= meal.to) return { type: "meal", name: meal.name, minutes: meal.minutes };
  }
  if (sinceLong >= B.longEvery) return { type: "long", minutes: B.long };
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
export function timeline(items = [], { tasks = [], events = [], now = Date.now(), hours = W.DAY_HOURS, run = null, rides = true } = {}){
  const { evs, gaps } = freeGaps({ tasks, events, now, hours, run, rides });
  const meals = hours.meals ?? mealsOf();
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const rows = [], over = [], breaks = [];
  // The first start on a round five minutes: 15:55, not 15:52.
  let gi = 0, cursor = Math.ceil((gaps[0]?.start ?? now) / (5 * MIN)) * 5 * MIN;
  // Work since the last break, and since the last long one (a meal counts).
  let worked = 0, sinceLong = 0, lastEnd = null;
  const mealsDone = new Set();
  // Breaks are the plan's own items: none are added here.
  const fixed = items.some(isBreak);
  let afterDone = false; // the last item looked at was finished work
  const lo = items.findIndex((it) => !isBreak(it)), hi = items.findLastIndex((it) => !isBreak(it));
  for (const [i, it] of items.entries()) {
    if (isBreak(it)) {
      if (i < lo || i > hi) continue; // never first or last
      if (isMeal(it) && !meals.length) continue; // meals switched off in Settings
      // A break right after finished work, with nothing laid since, was had.
      if (afterDone && !rows.length) continue;
      const len = Math.max(5, it.minutes || 10) * MIN;
      for (let k = gi; k < gaps.length; k++) {
        if (gaps[k].place) continue; // no break on the train: the ride is one
        const from = Math.max(cursor, gaps[k].start);
        if (gaps[k].end - from < len) continue;
        const meal = isMeal(it) ? mealName(it, meals, from) : null;
        breaks.push({ kind: "break", type: meal ? "meal" : it.brk, minutes: len / MIN, start: from, end: from + len, i, ...(meal ? { name: meal } : {}) });
        worked = 0; if (it.brk !== "short") sinceLong = 0;
        if (meal) mealsDone.add(meal);
        lastEnd = from + len; gi = k; cursor = from + len;
        break;
      }
      continue;
    }
    const task = byId.get(it.taskId);
    if (!task || task.status === "done" || task.status === "dropped") { afterDone = !!task; continue; }
    afterDone = false;
    const need = Math.max(5, it.minutes || leftOf(task)) * MIN;
    let placed = false;
    for (let k = gi; k < gaps.length; k++) {
      // A ride takes only what can be done on it (engine.fitsPlace).
      if (gaps[k].place && !fitsPlace(task, gaps[k].place)) continue;
      const from = Math.max(cursor, gaps[k].start);
      // Same stretch as the last item, or a fresh one that starts with the
      // meetings just before it.
      const cont = lastEnd != null && from - lastEnd < W.BREAKS.reset * MIN;
      const w = cont ? worked : runBefore(evs, from), sl = cont ? sinceLong : w;
      const brk = !fixed && !gaps[k].place && breakDue({ worked: w, sinceLong: sl, at: from, mealsDone, meals, need: need / MIN });
      const gap = (brk ? brk.minutes * MIN : 0) + need;
      if (gaps[k].end - from >= gap) {
        if (brk) {
          breaks.push({ kind: "break", type: brk.type, minutes: brk.minutes, start: from, end: from + brk.minutes * MIN, i: null, ...(brk.name ? { name: brk.name } : {}) });
          if (brk.name) mealsDone.add(brk.name);
        }
        const s = from + (brk ? brk.minutes * MIN : 0);
        rows.push({ taskId: it.taskId, task, minutes: need / MIN, start: s, end: s + need, i, ...(gaps[k].place ? { ride: gaps[k].mode } : {}) });
        worked = (brk ? 0 : w) + need / MIN;
        sinceLong = (brk && brk.type !== "short" ? 0 : sl) + need / MIN;
        lastEnd = s + need;
        gi = k; cursor = s + need; placed = true;
        break;
      }
    }
    if (!placed) {
      let room = 0;
      for (let k = gi; k < gaps.length; k++) room = Math.max(room, gaps[k].end - Math.max(cursor, gaps[k].start));
      room = Math.floor(room / (5 * MIN)) * 5;
      over.push({ taskId: it.taskId, task, minutes: need / MIN, room: room >= WORTH ? room : 0, i });
    }
  }
  return { rows, over, breaks };
}

// When the day shrinks under an approved plan (an event added, or running
// late), Daisey refits it itself and says so after (Mor, 2026-10-08: "act on
// its smartest way behind the scenes, tell the user, ask following
// questions"). Supersedes "an approved plan never changes itself" for this.
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
export function planProgress(plan, tasks = []){
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const items = (plan?.items || []).filter((it) => byId.has(it.taskId));
  return { done: items.filter((it) => byId.get(it.taskId).status === "done").length, total: items.length };
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
