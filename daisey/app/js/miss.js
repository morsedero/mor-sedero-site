// Missed slots and the silence check (Mor, 2026-10-08: "feels like the user
// can just ignore it and nothing happens"). One ladder that gets louder, so
// the two never overlap:
//   miss     MISS.after minutes into a free slot with nothing started: the
//            card's task, with Start / Shorten / Move
//   silence  a second slot ignored in a row, or a first one from MISS.midday
//            on with nothing done all day: "Rough day? Lighter plan?" —
//            once a day; after it, quiet until you do something
// A slot starts where a free stretch does (the day's start, a busy event's
// end) and every MISS.every minutes into a long one, counted from the last
// thing you did: a Start, a Done, any answer on the card (each one touches
// the task) or an approved plan. Nothing while a task runs, inside a busy
// event, just before one, or outside the day hours. Daisey asks; it never
// moves anything itself.
// Shared by the Now card (a banner, app open) and notify.js (a notification,
// app closed), so both name the same moment. PURE.
import { MISS } from "./weights.js";
import { runState, overruled, eventKey } from "./reality.js";
import { localDate } from "./model.js";
import { dayStartAt, dayEndAt } from "./day.js";

const MIN = 60000;
const ms = (v) => (typeof v === "number" ? v : Date.parse(v));

// The last time the user did anything Daisey can see.
export function lastActivity(tasks = [], run = null, planAt = 0){
  let a = Math.max(0, planAt || 0, run?.startedAt || 0);
  for (const t of tasks || []) a = Math.max(a, t.touchedAt || 0, t.workedAt || 0, t.doneAt || 0);
  return a;
}

const busyOf = (events, { tasks, run, now }) => {
  const over = overruled(events, { tasks, run, now });
  return (events || []).filter((e) => !e.allDay && e.busy !== false && e.start && e.end && !over.has(eventKey(e)))
    .map((e) => [ms(e.start), ms(e.end)]).sort((a, b) => a[0] - b[0]);
};

// The slots ignored since the last activity, oldest first: [{ start, at }],
// at: when it counted as missed.
export function missedSlots({ tasks = [], events = [], run = null, now = Date.now(), hours, planAt = 0 } = {}){
  const from = Math.max(lastActivity(tasks, run, planAt), dayStartAt(now, hours));
  const end = Math.min(now, dayEndAt(now, hours));
  const out = [];
  if (from >= end) return out;
  // A stretch closed by an event needs MISS.min minutes to have held a slot;
  // the open one (up to now) only needs to be MISS.after old.
  const stretch = (s, e, closed) => {
    for (let x = s; x + MISS.after * MIN <= e && (!closed || e - x >= MISS.min * MIN); x += MISS.every * MIN) out.push({ start: x, at: x + MISS.after * MIN });
  };
  let cursor = from;
  for (const [s, e] of busyOf(events, { tasks, run, now })) {
    if (e <= cursor) continue;
    if (s >= end) break;
    if (s > cursor) stretch(cursor, s, true);
    cursor = Math.max(cursor, e);
  }
  if (cursor < end) stretch(cursor, end, false);
  return out;
}

// Where the ladder stands right now: null, { kind: "miss", key, at, start }
// or { kind: "silence", key, at, since } (since: the last activity, or null
// when there was none today). silenceOn: the day the silence check was
// answered (settings.silenceOn).
export function missState({ tasks = [], events = [], run = null, now = Date.now(), hours, planAt = 0, silenceOn = null } = {}){
  if (now < dayStartAt(now, hours) || now >= dayEndAt(now, hours)) return null;
  if (runState(run, tasks, now)) return null;
  // In a busy event, or one about to start: not the moment to ask.
  const busy = busyOf(events, { tasks, run, now });
  if (busy.some(([s, e]) => s < now + MISS.after * MIN && e > now)) return null;
  const slots = missedSlots({ tasks, events, run, now, hours, planAt });
  if (!slots.length) return null;
  const today = localDate(now), act = lastActivity(tasks, run, planAt);
  const quietDay = act < dayStartAt(now, hours);
  const last = slots[slots.length - 1], noon = new Date(now).setHours(0, MISS.midday, 0, 0);
  if (slots.length >= 2 || (quietDay && last.at >= noon)) {
    if (silenceOn === today) return null;
    return { kind: "silence", key: `silence|${today}`, at: slots.length >= 2 ? slots[1].at : last.at, since: quietDay ? null : act };
  }
  // A miss is asked while its slot is still the one you're in: not hours
  // later, and not across a meeting since (the next slot will speak).
  if (now - last.start >= MISS.every * MIN || busy.some(([s, e]) => e > last.start && s < now)) return null;
  return { kind: "miss", key: `miss|${last.start}`, at: last.at, start: last.start };
}
