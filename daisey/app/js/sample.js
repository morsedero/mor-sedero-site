// The sample day a new guest opens to (2026-10-11): a guest with nothing in
// it saw "Nothing to pick" and had no way to see what Daisey does. So a
// fresh guest gets five ordinary tasks, one with a real deadline, and the
// plan Daisey lays for them, approved, so the card has a pick and Today has
// a plan from the first second. "Reset sample" in Settings lays it again.
// Every field is given, none guessed, so the reasons on the card only say
// what's here (no "someone's waiting on it" from a title).
// PURE: no Firebase, no DOM.
import { createTask, localDate } from "./model.js";
import { proposeDay, withBreaks, daySig, timeline } from "./proposal.js";
import { planDate } from "./day.js";
import * as W from "./weights.js";

const DAY = 86400000;
const TASKS = [
  { title: "Draft the project proposal", area: "work", type: "deep", where: "computer", size: 60, due: 0, dateKind: "target" },
  { title: "Send the invoice", area: "admin", type: "admin", where: "computer", size: 15, due: 1, dateKind: "deadline" },
  { title: "Pay the electricity bill", area: "admin", type: "admin", where: "anywhere", size: 10, stakes: "money" },
  { title: "Grocery run", area: "home", type: "errand", where: "out", size: 30 },
  { title: "Tidy the desk", area: "home", type: "home", where: "home", size: 15 },
];
const base = { openHours: "anytime", stakes: "low", canSplit: false };

// → { tasks, plan } for guest storage. plan: today's approved plan, or null
// when nothing fits what's left of today (late at night).
export function sampleDay({ now = Date.now(), hours = W.DAY_HOURS } = {}){
  const tasks = TASKS.map(({ due, ...t }, i) => ({
    ...createTask({ ...base, ...t, ...(due != null ? { due: localDate(now + due * DAY) } : {}) }, { now }),
    id: `sample-${i + 1}`,
  }));
  const ctx = { tasks, events: [], now, hours };
  const items = withBreaks(proposeDay(ctx), ctx);
  const plan = items.some((it) => it.taskId) ? { date: planDate(now, hours), status: "approved", items, approvedAt: now,
    declined: [], mealsLaid: {}, sig: daySig([], hours, now), unfit: timeline(items, ctx).over.map((o) => o.taskId), at: now } : null;
  return { tasks, plan };
}
