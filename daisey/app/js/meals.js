// A meal the calendar leaves no room for (Mor, 2026-10-09: "a job until 1,
// I drive back until 2:20, my lunch is 1–2 — Daisey needs to see that and ask
// if I eat at work or move my lunch"). The plan only puts a meal in free time
// (proposal.js breakDue), so a window the events filled was dropped without a
// word. Now Needs you asks, once a day per meal, with the nearest free time
// ready: "Move lunch to 14:20" or "I'll eat there". The answer is today's
// only, in settings.mealToday (day.js mealsToday). PURE.
import { mealsOf, gapsToday, dayHours, minText } from "./day.js";
import { localDate } from "./model.js";

const MIN = 60000;
export const MEAL_MOVE_MAX = 180; // a move further than this from the meal's time isn't offered

const atMin = (now, min) => new Date(now).setHours(0, min, 0, 0);
const clockMin = (ms) => { const d = new Date(ms); return d.getHours() * 60 + d.getMinutes(); };

// Free stretches between busy events from a to b (day hours don't matter here).
function freeIn(busy, a, b){
  const out = [];
  let cursor = a;
  for (const e of busy) {
    if (e.e <= cursor || e.s >= b) continue;
    if (e.s > cursor) out.push([cursor, e.s]);
    cursor = Math.max(cursor, e.e);
  }
  if (cursor < b) out.push([cursor, b]);
  return out;
}

// → [{ key, name, at, minutes, by: [event], move: minutes after midnight | null }]
export function mealAsks(events = [], settings = {}, now = Date.now()){
  const today = localDate(now), answered = settings.mealToday?.date === today ? settings.mealToday : {};
  const busy = events.filter((e) => !e.allDay && e.busy !== false && e.start && e.end)
    .map((ev) => ({ ev, s: Date.parse(ev.start), e: Date.parse(ev.end) })).sort((a, b) => a.s - b.s);
  const out = [];
  for (const m of mealsOf(settings)) {
    if (answered[m.name]) continue;
    const from = atMin(now, m.from), to = atMin(now, m.to), need = m.minutes * MIN;
    if (to - need < now) continue; // its time is over
    if (freeIn(busy, Math.max(now, from), to).some(([a, b]) => b - a >= need)) continue;
    // The job that ends just as lunch starts is part of why, too.
    const by = busy.filter((x) => x.s < to && x.e >= from).map((x) => x.ev);
    if (!by.length) continue;
    // The nearest free time that holds it, before or after, on a round five.
    let move = null;
    for (const g of gapsToday(events, now, dayHours(settings))) {
      const after = Math.ceil(g.start / (5 * MIN)) * 5 * MIN, before = Math.floor((g.end - need) / (5 * MIN)) * 5 * MIN;
      for (const s of [after, before]) {
        if (s < g.start || s + need > g.end || Math.abs(s - from) > MEAL_MOVE_MAX * MIN) continue;
        if (move == null || Math.abs(s - from) < Math.abs(move - from)) move = s;
      }
    }
    out.push({ key: `meal:${today}:${m.name}`, name: m.name, at: minText(m.from), minutes: m.minutes, by, move: move == null ? null : clockMin(move) });
  }
  return out;
}
