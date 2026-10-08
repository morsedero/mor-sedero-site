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
import { gapsToday, bookings } from "./day.js";
import { rank } from "./engine.js";
import { workBase } from "./context.js";
import { overruled, eventKey } from "./reality.js";
import { LABELS, notYet } from "./model.js";
import * as W from "./weights.js";

const MIN = 60000;
const WORTH = 15; // minutes: a gap shorter than this holds nothing
export const MAX_ITEMS = 8;
const FEWER = 3;
const MORE = 10;

// What's left of a task: its size less the time already put in.
export const leftOf = (t) => Math.max(5, (t.size || 0) - (t.spentMinutes || 0));

// The free time left today, as gaps, with what reality overruled taken out
// (a meeting you worked through isn't busy).
function freeGaps({ tasks, events, now, hours, run }){
  const over = overruled(events, { tasks, run, now });
  const evs = events.filter((e) => !over.has(eventKey(e)));
  return { evs, gaps: gapsToday(evs, now, hours).filter((g) => g.minutes >= WORTH) };
}

// → [{ taskId, minutes }], in the order Daisey would do them.
// ask: parseAsk's hints (or {}). exclude: ids the user deleted from the plan.
export function proposeDay({ tasks = [], events = [], now = Date.now(), hours = W.DAY_HOURS, settings = {}, run = null, ask = {}, exclude = [] } = {}){
  const { evs, gaps } = freeGaps({ tasks, events, now, hours, run });
  if (!gaps.length) return [];
  const until = Number.isFinite(ask.until) ? atMin(now, ask.until) : Infinity;
  const usable = gaps.map((g) => ({ ...g, end: Math.min(g.end, until) })).filter((g) => g.end - g.start >= WORTH * MIN);
  if (!usable.length) return [];
  let budget = usable.reduce((s, g) => s + Math.floor((g.end - g.start) / MIN), 0);
  if (Number.isFinite(ask.maxMinutes)) budget = Math.min(budget, ask.maxMinutes);
  const biggest = Math.max(...usable.map((g) => Math.floor((g.end - g.start) / MIN)));
  const cap = ask.fewer ? FEWER : ask.more ? MORE : MAX_ITEMS;
  const skipTypes = new Set(ask.skipTypes || []);
  const out = new Set([...exclude, ...(ask.exclude || []), ...(run?.batch || (run?.taskId ? [run.taskId] : []))]);
  const pool = tasks.filter((t) => !skipTypes.has(t.type));
  const booked = Object.fromEntries([...bookings(tasks, evs, now)].map(([id, b]) => [id, b.start]));
  const items = [];
  const take = (t) => { items.push({ taskId: t.id, minutes: Math.min(leftOf(t), biggest) }); out.add(t.id); budget -= Math.min(leftOf(t), biggest); };

  // "Start with X": those go first, whatever the engine thinks, as long as
  // they're open and allowed today.
  for (const id of ask.first || []) {
    const t = pool.find((x) => x.id === id);
    if (t && !out.has(t.id) && t.status === "ready" && !t.onHold && !notYet(t, now) && items.length < cap) take(t);
  }
  while (items.length < cap && budget >= WORTH) {
    const r = rank(pool, {
      now: usable[0].start, window: biggest, nextEvent: null, ...workBase(tasks, now),
      sessionSkips: [...out], booked,
    });
    if (!r.pick) break;
    take(r.pick.task);
  }
  if (ask.quickFirst) items.sort((a, b) => a.minutes - b.minutes);
  return items;
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
// break of any kind; sinceLong: since the last long one or lunch.
export function breakDue({ worked, sinceLong, at, lunchDone, need = 0 }){
  const B = W.BREAKS, m = clockMin(at);
  // Lunch comes once something has been done (never first thing at noon), or
  // when the next item would carry past the window and lunch would be missed.
  const late = m + need >= B.lunch.to;
  if (!lunchDone && m >= B.lunch.from && m < B.lunch.to && (worked >= B.lunchAfter || late)) return { type: "lunch", minutes: B.lunch.minutes };
  if (sinceLong >= B.longEvery) return { type: "long", minutes: B.long };
  if (worked >= B.after) return { type: "short", minutes: B.short };
  return null;
}

export function timeline(items = [], { tasks = [], events = [], now = Date.now(), hours = W.DAY_HOURS, run = null } = {}){
  const { evs, gaps } = freeGaps({ tasks, events, now, hours, run });
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const rows = [], over = [], breaks = [];
  // The first start on a round five minutes: 15:55, not 15:52.
  let gi = 0, cursor = Math.ceil((gaps[0]?.start ?? now) / (5 * MIN)) * 5 * MIN;
  // Work since the last break, and since the last long one (lunch counts).
  let worked = 0, sinceLong = 0, lunchDone = false, lastEnd = null;
  for (const it of items) {
    const task = byId.get(it.taskId);
    if (!task || task.status === "done" || task.status === "dropped") continue;
    const need = Math.max(5, it.minutes || leftOf(task)) * MIN;
    let placed = false;
    for (let k = gi; k < gaps.length; k++) {
      const from = Math.max(cursor, gaps[k].start);
      // Same stretch as the last item, or a fresh one that starts with the
      // meetings just before it.
      const cont = lastEnd != null && from - lastEnd < W.BREAKS.reset * MIN;
      const w = cont ? worked : runBefore(evs, from), sl = cont ? sinceLong : w;
      const brk = breakDue({ worked: w, sinceLong: sl, at: from, lunchDone, need: need / MIN });
      const gap = (brk ? brk.minutes * MIN : 0) + need;
      if (gaps[k].end - from >= gap) {
        if (brk) {
          breaks.push({ kind: "break", type: brk.type, minutes: brk.minutes, start: from, end: from + brk.minutes * MIN });
          if (brk.type === "lunch") lunchDone = true;
        }
        const s = from + (brk ? brk.minutes * MIN : 0);
        rows.push({ taskId: it.taskId, task, minutes: need / MIN, start: s, end: s + need });
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
      over.push({ taskId: it.taskId, task, minutes: need / MIN, room: room >= WORTH ? room : 0 });
    }
  }
  return { rows, over, breaks };
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
