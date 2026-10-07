// Plan my day (master spec §10, §15; Mor, 2026-10-06): a Daisey plan, not a
// Google Calendar schedule. The free time left today, in three flexible
// windows (morning, afternoon, evening), each with what Daisey would use it
// for. No times for tasks, no minute-by-minute timetable, nothing written
// anywhere: it's worked out from the tasks and the calendar every time it is
// shown, so when a meeting runs over or you start something else it simply
// comes out different — nothing to maintain (reality.js decides what counts
// as busy). The picks are the Now card's own (engine.rank), one window at a
// time, so the plan and the card can't disagree.
// PURE: no Firebase, no DOM.
import { gapsToday, bookings } from "./day.js";
import { rank } from "./engine.js";
import { workBase } from "./context.js";
import { overruled, eventKey } from "./reality.js";
import * as W from "./weights.js";

const MIN = 60000;
export const PARTS = [
  { key: "morning", label: "Morning", from: 0 },
  { key: "afternoon", label: "Afternoon", from: 12 * 60 },
  { key: "evening", label: "Evening", from: 17 * 60 },
];
const WORTH = 15; // minutes: a window shorter than this isn't one
const MAX_PICKS = 3;

const atMin = (now, m) => { const d = new Date(now); d.setHours(0, m, 0, 0); return d.getTime(); };
const left = (t) => Math.max(5, (t.size || 0) - (t.spentMinutes || 0));

// → [{ key, label, minutes, from, picks: [{ task, why, minutes }] }], only the
// windows with time left, in order. run: the running task (state/now): the
// plan leaves it out, it's already being done.
export function planDay({ tasks = [], events = [], now = Date.now(), hours = W.DAY_HOURS, settings = {}, run = null } = {}){
  const over = overruled(events, { tasks, run, now });
  const evs = events.filter((e) => !over.has(eventKey(e)));
  const gaps = gapsToday(evs, now, hours).filter((g) => g.minutes >= WORTH);
  const booked = Object.fromEntries([...bookings(tasks, evs, now)].map(([id, b]) => [id, b.start]));
  const taken = new Set(run?.batch || (run?.taskId ? [run.taskId] : []));
  const out = [];
  for (const part of PARTS) {
    const lo = atMin(now, part.from), hi = atMin(now, PARTS[PARTS.indexOf(part) + 1]?.from ?? 24 * 60);
    const pieces = gaps.map((g) => ({ start: Math.max(g.start, lo), end: Math.min(g.end, hi) }))
      .filter((p) => p.end - p.start >= WORTH * MIN);
    if (!pieces.length) continue;
    const minutes = pieces.reduce((s, p) => s + Math.floor((p.end - p.start) / MIN), 0);
    const biggest = Math.max(...pieces.map((p) => Math.floor((p.end - p.start) / MIN)));
    const at = pieces[0].start;
    const picks = [];
    let room = minutes;
    while (picks.length < MAX_PICKS && room >= WORTH) {
      const r = rank(tasks, {
        now: at, window: biggest, nextEvent: null, ...workBase(tasks, now),
        sessionSkips: [...taken], booked,
      });
      if (!r.pick) break;
      const t = r.pick.task, need = Math.min(left(t), biggest);
      taken.add(t.id);
      picks.push({ task: t, why: r.pick.whyParts, minutes: left(t) });
      room -= need;
    }
    out.push({ key: part.key, label: part.label, minutes, from: at, picks });
  }
  return out;
}
