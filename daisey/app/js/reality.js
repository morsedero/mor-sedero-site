// Reality over plan (Mor, 2026-10-06; DAISEY_SPEC "Reality over plan").
// A calendar event, a booked slot or a Daisey plan is a prediction. What you
// actually do — a task running, real work logged on a task — is evidence, and
// evidence wins. The Now card (now.js) and the notifications (notify.js, on
// the server, from the run in the push snapshot) read the day through these,
// so both adapt to what really happened without asking you.
import { RUN_ASK, RUN_PAUSE_STALE } from "./weights.js";

const MIN = 60000;
const ms = (v) => (typeof v === "number" ? v : Date.parse(v));

// A paused run's clock stands still at pausedAt.
export const elapsedMinutes = (run, now = Date.now()) => Math.max(0, ((run.pausedAt ?? now) - run.startedAt) / MIN);
// A forgotten timer (weights RUN_ASK): past this, focus mode asks "Still on it?".
export const runCap = (target) => Math.max((target || 0) * RUN_ASK.factor, (target || 0) + RUN_ASK.extra);

// What the running task (the state/now doc) says about right now:
//   "running"  you're on it: the strongest signal there is
//   "paused"   you stepped away, but it's still your focus: nothing should
//              compete with it, though it says nothing about where you are
//   null       nothing running, or a forgotten timer: past the point where
//              focus mode asks "Still on it?", or paused RUN_PAUSE_STALE
//              minutes. A timer nobody touches isn't evidence of anything.
export function runState(run, tasks, now = Date.now()){
  if (!run?.taskId || !Number.isFinite(run.startedAt)) return null;
  if (run.pausedAt != null) return now - run.pausedAt < RUN_PAUSE_STALE * MIN ? "paused" : null;
  const ids = run.batch || [run.taskId];
  const size = (tasks || []).filter((t) => ids.includes(t.id)).reduce((s, t) => s + (t.size || 0), 0);
  return elapsedMinutes(run, now) <= runCap(size + (run.extra || 0)) ? "running" : null;
}

// The calendar events reality has overruled, by eventKey. A busy timed event
// that has started stops counting as "what's happening" when you're working
// during it: a task running now, or real work logged after it began (a Start,
// Done or kept time sets the task's workedAt). Then the Now card doesn't wait
// behind it, its time counts as free, and its end isn't announced as "X is
// over". Events still ahead are never overruled: a plan for later is still
// the best guess about later.
// Evidence older than the event's last edit (`updated`) doesn't count
// (Mor, 2026-10-08): an event added or moved onto time already worked says
// what the user is doing NOW, so it's newer than the work and wins.
export const eventKey = (e) => `${e.id || e.title}|${ms(e.start)}`;
export function overruled(events, { tasks = [], run = null, now = Date.now() } = {}){
  const live = runState(run, tasks, now) === "running";
  const work = Math.max(0, ...(tasks || []).map((t) => t.workedAt || 0));
  const out = new Set();
  for (const e of events || []) {
    if (e.allDay || e.busy === false) continue;
    const s = ms(e.start), end = ms(e.end), edit = e.updated ? ms(e.updated) || 0 : 0;
    if (!(s <= now)) continue;
    if ((live && end > now && run.startedAt >= edit) || (work >= Math.max(s, edit) && work < end)) out.add(eventKey(e));
  }
  return out;
}
