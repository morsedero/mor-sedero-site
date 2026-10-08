// Day hours and booked tasks (DAISEY_SPEC "Day hours, booked tasks and
// calendar tasks"). Daisey plans only inside the waking day: free time is
// counted from now (or the day's start) to its end, and outside those hours
// the card goes to night mode. A task that already has a slot on the
// calendar waits for it. PURE: no Firebase, no DOM.
//
// Replaced the pencil schedule (dropped from the spec, 2026-10-05): this is
// what was left worth keeping from it — the free stretches and the capacity
// line — now bounded by the day hours.
import * as W from "./weights.js";
import { effectiveDue } from "./triage.js";
import { localDate, notYet } from "./model.js";

const MIN = 60000;
const pad = (n) => String(n).padStart(2, "0");

// "08:00" → 480. Anything else → null.
export function toMin(s){
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s ?? "").trim());
  return m && +m[1] < 24 && +m[2] < 60 ? +m[1] * 60 + +m[2] : null;
}
export const minText = (min) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;

// The user's day hours from state/settings ({ dayStart, dayEnd } as "HH:MM"),
// as minutes after midnight; the default when unset or nonsense.
// "My day can run until 23:00 today" (Tell Daisey): settings.dayEndToday =
// { date, end } stretches (or shortens) today's end only; tomorrow it's gone.
export function dayHours(settings = {}){
  const s = toMin(settings.dayStart), e = toMin(settings.dayEnd);
  const base = s != null && e != null && e > s ? { start: s, end: e } : { ...W.DAY_HOURS };
  const today = settings.dayEndToday, end = toMin(today?.end);
  if (today?.date === localDate() && end != null && end > base.start) base.end = end;
  base.meals = mealsOf(settings);
  return base;
}

// Meal breaks from state/settings (Mor, 2026-10-08): Breakfast, Lunch,
// Dinner, no others. settings.meals = [{ name, on, from, to, minutes }]
// (times "HH:MM"); a meal not saved there keeps its default (weights.js).
// → all three, in minutes; mealsOf → only the ones on.
export function mealPrefs(settings = {}){
  const saved = Array.isArray(settings.meals) ? settings.meals : [];
  return W.BREAKS.meals.map((d) => {
    const s = saved.find((x) => x?.name === d.name && typeof x.on === "boolean");
    if (!s) return { ...d };
    const from = toMin(s.from), to = toMin(s.to), ok = from != null && to != null && to > from;
    return { name: d.name, on: s.on, from: ok ? from : d.from, to: ok ? to : d.to,
      minutes: Math.max(5, Math.min(Math.round(Number(s.minutes) || d.minutes), 180)) };
  });
}
export const mealsOf = (settings = {}) => mealPrefs(settings).filter((m) => m.on).map(({ on, ...m }) => m);

const atMin = (ms, min) => new Date(ms).setHours(0, min, 0, 0);
export const dayStartAt = (now, hours = W.DAY_HOURS) => atMin(now, hours.start);
export const dayEndAt = (now, hours = W.DAY_HOURS) => atMin(now, hours.end);

export function isNight(now = Date.now(), hours = W.DAY_HOURS){
  const d = new Date(now), m = d.getHours() * 60 + d.getMinutes();
  return m < hours.start || m >= hours.end;
}

// When the day next starts: this morning if it hasn't yet, else tomorrow's.
export function nextMorning(now = Date.now(), hours = W.DAY_HOURS){
  const today = dayStartAt(now, hours);
  if (now < today) return today;
  const d = new Date(now); d.setDate(d.getDate() + 1); d.setHours(0, hours.start, 0, 0);
  return d.getTime();
}

// Minutes from now to the end of the day; 0 at night.
export const minutesLeft = (now = Date.now(), hours = W.DAY_HOURS) =>
  (isNight(now, hours) ? 0 : Math.floor((dayEndAt(now, hours) - now) / MIN));

// Free stretches left in today's day hours, between busy timed events —
// from max(now, start of day) to the end of the day. An event marked Free,
// or all-day, takes no time.
export function gapsToday(events, now = Date.now(), hours = W.DAY_HOURS){
  const from = Math.max(now, dayStartAt(now, hours)), end = dayEndAt(now, hours);
  if (from >= end) return [];
  const busy = events.filter((e) => !e.allDay && e.busy !== false && e.end)
    .map((e) => ({ ...e, s: Date.parse(e.start), e: Date.parse(e.end) }))
    .filter((e) => e.e > from && e.s < end)
    .sort((a, b) => a.s - b.s);
  const gaps = [];
  let cursor = from;
  for (const e of busy) {
    if (e.s > cursor) gaps.push({ start: cursor, end: e.s, next: e.title });
    if (e.e > cursor) cursor = e.e;
  }
  if (cursor < end) gaps.push({ start: cursor, end, next: null });
  return gaps.map((g) => ({ ...g, minutes: Math.floor((g.end - g.start) / MIN) }));
}

// The Schedule panel's line: "2 h free today, 8 open. Realistic: 3."
// free: every free minute left in today's day hours. open: ready tasks dated
// today or earlier. realistic: how many of those fit, deadlines first, then
// smallest. rest: the ones that don't — "Move the rest" sends them to the sweep.
export function capacity(tasks, events, now = Date.now(), hours = W.DAY_HOURS){
  const free = gapsToday(events, now, hours).reduce((s, g) => s + g.minutes, 0);
  const today = localDate(now);
  const open = tasks.filter((t) => t.status === "ready" && t.due && !notYet(t, now) && effectiveDue(t, now) <= today);
  const left = (t) => Math.max(5, (t.size || 0) - (t.spentMinutes || 0));
  const order = [...open].sort((a, b) => (b.dateKind === "deadline") - (a.dateKind === "deadline") || left(a) - left(b));
  const fit = [];
  let used = 0;
  for (const t of order) if (used + left(t) <= free) { fit.push(t); used += left(t); }
  const fitIds = new Set(fit.map((t) => t.id));
  return { free, open: open.length, realistic: fit.length, rest: order.filter((t) => !fitIds.has(t.id)) };
}

export const sameTitle = (a, b) => norm(a) !== "" && norm(a) === norm(b);
const norm = (s) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

// Booked tasks: an open task with a timed calendar event that hasn't ended —
// one Daisey made for it (the event carries its taskId) or one titled exactly
// like it. Map id → { start, end, title } for the soonest such slot. The
// engine keeps a booked task off the card until its slot starts; once it has,
// the slot is the current block and the task is the card.
export function bookings(tasks = [], events = [], now = Date.now()){
  const open = tasks.filter((t) => t.status !== "done" && t.status !== "dropped");
  const byId = new Map(open.map((t) => [t.id, t]));
  const out = new Map();
  for (const e of events) {
    if (e.allDay || !e.start || !e.end) continue;
    const start = Date.parse(e.start), end = Date.parse(e.end);
    if (!(end > now)) continue;
    const t = (e.taskId && byId.get(e.taskId)) || open.find((x) => sameTitle(x.title, e.title));
    if (!t) continue;
    const prev = out.get(t.id);
    if (!prev || start < prev.start) out.set(t.id, { start, end, title: e.title });
  }
  return out;
}
