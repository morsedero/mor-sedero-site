// A booked slot another event has run into (master spec §8–9, 2026-10-06).
// A booked slot is a prediction. Usually reality sorts it out silently: the
// task is back in the pool once its slot passes, and a slot you worked
// through is overruled (reality.js). The one case worth a question: the task
// has a REAL deadline, a busy event now overlaps its slot, and there is room
// to put the slot somewhere else today. Then Needs you asks, once, with the
// answer ready ("Move it to 18:00" / "Keep current plan"). No room, no
// question: moving it can't be offered, so nothing is asked.
// PURE: the header count, the brief and the server's notifications all use it.
import { gapsToday, sameTitle } from "./day.js";
import { DAY_HOURS, EVENT_BUFFER } from "./weights.js";

const MIN = 60000;
export const CLASH_MIN = 10; // minutes of overlap that count

const up5 = (ms) => Math.ceil(ms / (5 * MIN)) * 5 * MIN;

// → [{ key, task, slot, over, move: { start, end } }]
export function slotClashes(tasks = [], events = [], now = Date.now(), hours = DAY_HOURS){
  const busy = events.filter((e) => !e.allDay && e.busy !== false && e.start && e.end)
    .map((e) => ({ ev: e, s: Date.parse(e.start), e: Date.parse(e.end) }));
  const out = [];
  for (const slot of busy) {
    if (!(slot.e > now) || slot.ev.editable === false) continue;
    const t = tasks.find((x) => x.status === "ready" && x.dateKind === "deadline"
      && ((slot.ev.taskId && slot.ev.taskId === x.id) || (!slot.ev.taskId && sameTitle(x.title, slot.ev.title))));
    if (!t) continue;
    const over = busy.find((o) => o !== slot && o.e > now && Math.min(o.e, slot.e) - Math.max(o.s, slot.s) >= CLASH_MIN * MIN
      && !(o.ev.taskId && o.ev.taskId === t.id) && !sameTitle(o.ev.title, t.title));
    if (!over) continue;
    const length = slot.e - slot.s;
    const gap = gapsToday(busy.filter((o) => o !== slot).map((o) => o.ev), now + EVENT_BUFFER * MIN, hours)
      .map((g) => ({ start: up5(g.start), end: g.end })).find((g) => g.end - g.start >= length);
    if (!gap) continue;
    out.push({ key: `clash:${slot.ev.id}|${slot.s}`, task: t, slot: slot.ev, over: over.ev, move: { start: gap.start, end: gap.start + length } });
  }
  return out;
}
