// Needs you's question list, apart from its screen (needs.js): PURE, so the
// header count, the day brief and the server's notifications (functions/
// daisey-now-morning.js) all count the same questions. Moved out of needs.js
// unchanged, 2026-10-06.
import { nextOffer } from "./caltask.js";
import { sweepList, isOverdue, shouldOffer } from "./triage.js";
import { localDate, notYet } from "./model.js";
import { deadlineWithin } from "./engine.js";
import { STALE_SKIPS, SOMEDAY_DEADLINE_DAYS, PUSHES_ASK } from "./weights.js";
import { slotClashes } from "./clash.js";
import { slotsToAsk } from "./routine.js";

const STAKES_FIRST = { penalty: 0, money: 1, someone: 2, low: 3 };

// The Someday pick's rule (DAISEY_SPEC "Someday comes back"): Sunday
// morning, or whenever fewer than 3 tasks are active, at most once a day.
export function somedayDue(tasks = [], settings = {}, now = Date.now()){
  if (!tasks.some((t) => t.status === "someday")) return false;
  if (settings.somedayAsked === localDate(now)) return false;
  const d = new Date(now);
  const active = tasks.filter((t) => t.status === "ready" && !notYet(t, now)).length;
  return (d.getDay() === 0 && d.getHours() < 12) || active < 3;
}
const somedayTop = (tasks) => tasks.filter((t) => t.status === "someday")
  .sort((a, b) => (STAKES_FIRST[a.stakes] ?? 3) - (STAKES_FIRST[b.stakes] ?? 3) || (a.createdAt || 0) - (b.createdAt || 0))[0];

// Everything waiting on an answer right now, as { key, kind, … }. PURE apart
// from reading the clock: now.js calls it for the count on the home screen.
export function collectNeeds({ tasks = [], events = [], calOk = false, settings = {}, now = Date.now() } = {}){
  const later = settings.needsLater?.date === localDate(now) ? new Set(settings.needsLater.keys || []) : new Set();
  const out = [];
  const add = (item) => { if (!later.has(item.key)) out.push(item); };
  const parked = tasks.filter((t) => t.status === "someday" && deadlineWithin(t, now, SOMEDAY_DEADLINE_DAYS))
    .sort((a, b) => a.due.localeCompare(b.due));
  parked.forEach((t) => add({ key: `parked:${t.id}`, kind: "parked", id: t.id }));
  if (calOk) {
    const offered = [...(settings.calOffered || [])];
    for (let i = 0; i < 5; i++) {
      const ev = nextOffer(events, tasks, offered);
      if (!ev) break;
      offered.push(ev.id);
      add({ key: `cal:${ev.id}`, kind: "cal", ev });
    }
  }
  // A booked slot a meeting ran into, for a real deadline (clash.js): asked once, with the move ready.
  if (calOk) slotClashes(tasks, events, now).forEach((c) => add({ key: c.key, kind: "clash", id: c.task.id, clash: c }));
  // A routine's set-days slot that's over (routine.js): "Did it?" — a booked
  // slot isn't counted until the user says so.
  if (calOk) for (const t of tasks) slotsToAsk(t, events, now).forEach((e) => add({ key: `slot:${e.id}`, kind: "slot", id: t.id, slot: e }));
  const today = localDate(now);
  tasks.filter((t) => t.status === "waiting" && t.checkOn && t.checkOn <= today)
    .sort((a, b) => a.checkOn.localeCompare(b.checkOn))
    .forEach((t) => add({ key: `pend:${t.id}`, kind: "pending", id: t.id }));
  tasks.filter((t) => t.status === "ready" && (t.skipsSinceStart || 0) >= STALE_SKIPS)
    .forEach((t) => add({ key: `stale:${t.id}`, kind: "stale", id: t.id }));
  // Pushed to a later day PUSHES_ASK times without a start (2026-10-06).
  tasks.filter((t) => t.status === "ready" && (t.pushes || 0) >= PUSHES_ASK && (t.skipsSinceStart || 0) < STALE_SKIPS)
    .forEach((t) => add({ key: `pushed:${t.id}`, kind: "pushed", id: t.id }));
  if (somedayDue(tasks, settings, now)) {
    const t = somedayTop(tasks.filter((x) => !parked.includes(x))); // a parked deadline is already asked about
    if (t) add({ key: "someday", kind: "someday", id: t.id });
  }
  // Passed deadlines always; passed targets only once they pile up (the
  // sweep's old threshold) — a target that slipped sits quietly under today.
  const targets = shouldOffer(tasks, now, {});
  sweepList(tasks, now).filter((t) => isOverdue(t, now) || targets)
    .forEach((t) => add({ key: `sweep:${t.id}`, kind: "sweep", id: t.id }));
  return out;
}
