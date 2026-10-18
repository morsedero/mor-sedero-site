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
import { localDate, getDayKey, notYet } from "./model.js";

const MIN = 60000;
// How far past midnight a day's END may run ("until 1am", a usual end of
// 02:00): up to 04:00. Not the day boundary (model.js getDayKey), which is the
// day's START — from midnight to then it is still last night.
export const LATE_END_MAX = 4 * 60;
const pad = (n) => String(n).padStart(2, "0");

// "08:00" → 480. Anything else → null.
export function toMin(s){
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s ?? "").trim());
  return m && +m[1] < 24 && +m[2] < 60 ? +m[1] * 60 + +m[2] : null;
}
// Wraps past midnight: a day stretched to 25:00 reads "01:00".
export const minText = (min) => { const m = ((min % 1440) + 1440) % 1440; return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`; };

// The user's day hours from state/settings ({ dayStart, dayEnd } as "HH:MM"),
// as minutes after midnight; the default when unset or nonsense.
// "My day can run until 23:00 today" (Tell Daisey): settings.dayEndToday =
// { date, end } stretches (or shortens) today's end only; tomorrow it's gone.
// date: the day it stretches, answerDate (the plan's day: after midnight,
// the morning you wake into unless last night's day is still on).
// An end before 04:00 runs past midnight ("until 1am"): before midnight
// the end reads 25:00; after it, until that end, the day is still on, as
// { start: 0, end, late: true } (late: the plan and today's Laters keep
// yesterday's date, now.js dayKey); after that end it's gone, and the
// morning you wake into has its usual end.
// The usual day can run past midnight too (night owls, Mor 2026-10-11): a
// dayEnd before 04:00 and before the start ("02:00") reads 26:00, the
// same way.
export function dayHours(settings = {}, now = Date.now()){
  // The start never goes below the day boundary (Settings' bar runs 04:00 to 03:59).
  const late = LATE_END_MAX, s0 = toMin(settings.dayStart), s = s0 == null ? null : Math.max(s0, LATE_END_MAX);
  let e = toMin(settings.dayEnd);
  if (s != null && e != null && e < late && e <= s) e += 1440;
  const base = s != null && e != null && e > s ? { start: s, end: e } : { ...W.DAY_HOURS };
  const today = settings.dayEndToday, end = toMin(today?.end);
  const d = new Date(now), m = d.getHours() * 60 + d.getMinutes();
  if (end != null && today?.date === localDate(now)) {
    if (end >= late) { if (end > base.start) base.end = end; }
    else base.end = end + 1440;
  } else if (end != null && end < late && m < end && today?.date === getDayKey(now)) {
    return { start: 0, end, late: true, meals: [] }; // last night's "until 1am", still on
  }
  if (m < late && base.end > 1440) {
    if (m < base.end - 1440) return { start: 0, end: base.end - 1440, late: true, meals: [] };
  }
  base.meals = mealsToday(settings, now);
  return base;
}

// The usual day, without today's stretch and not in its after-midnight form
// ({ start: 0, late }): what Settings shows and other days use. Read at noon.
export const usualHours = (settings = {}) => dayHours({ ...settings, dayEndToday: null }, new Date().setHours(12, 0, 0, 0));

// ONE day model (Mor, 2026-10-18). The day key switches at a FIXED 04:00
// (model.js getDayKey), whatever "My day" says. "My day" start/end only set
// the planning window; the Night pill is derived from them, never stored.
// The Night pill's range as clock text: [night starts, night ends].
export const nightRange = (hours = W.DAY_HOURS) => [minText(hours.end), minText(hours.start)];
// Ms until the next whole minute (+ a hair so the clock has turned): the top bar repaints then, not every second.
export const msToNextMinute = (now = Date.now()) => MIN - (now % MIN) + 20;
// The top bar's day and date: the day you're in (getDayKey), not the
// calendar's — at 00:22 it still shows yesterday's, so it never agrees with a
// page that calls the calendar's date "Tomorrow".
export const headerDay = (now = Date.now()) => new Date(`${getDayKey(now)}T12:00`);

// Meal breaks from state/settings (Mor, 2026-10-08): Breakfast, Lunch,
// Dinner, no others. settings.meals = [{ name, on, at, minutes }] (at:
// "HH:MM"; an older save's `from` reads as at); a meal not saved there keeps
// its default (weights.js). → all three, in minutes. mealsOf → only the ones
// on, each as the window the plan places it in: { name, from, to, minutes }.
export function mealPrefs(settings = {}){
  const saved = Array.isArray(settings.meals) ? settings.meals : [];
  return W.BREAKS.meals.map((d) => {
    const s = saved.find((x) => x?.name === d.name && typeof x.on === "boolean");
    if (!s) return { ...d };
    return { name: d.name, on: s.on, at: toMin(s.at ?? s.from) ?? d.at,
      minutes: Math.max(5, Math.min(Math.round(Number(s.minutes) || d.minutes), 180)) };
  });
}
export const mealsOf = (settings = {}) => mealPrefs(settings).filter((m) => m.on)
  .map(({ name, at, minutes }) => ({ name, from: at, to: Math.min(at + W.BREAKS.mealSlack, 1440), minutes }));

// Today's answer to the meal question (meals.js, Mor 2026-10-09):
// settings.mealToday = { date, [name]: "HH:MM" (moved, today only) | "there"
// (eaten at the event, so the plan adds none) }; date: answerDate. Tomorrow
// it's gone, like dayEndToday. Read only for a day that isn't last night's
// late one (dayHours), so that's the calendar's date.
export function mealsToday(settings = {}, now = Date.now()){
  const t = settings.mealToday?.date === localDate(now) ? settings.mealToday : {};
  return mealsOf(settings).flatMap((m) => {
    if (t[m.name] === "there") return [];
    const at = toMin(t[m.name]);
    return at == null ? [m] : [{ ...m, from: at, to: Math.min(at + W.BREAKS.mealSlack, 1440) }];
  });
}

const atMin = (ms, min) => new Date(ms).setHours(0, min, 0, 0);
// The Week grid's hour span: My day's hours, stretched to fit anything outside
// them ({ s, e } in minutes from midnight). The first hour is labelled too, so
// the grid's top row reads My day's start (08:00 → "08", not "09").
export function gridSpan(hrs = W.DAY_HOURS, timed = []){
  let h0 = Math.floor(hrs.start / 60), h1 = Math.ceil(hrs.end / 60);
  if (h1 <= h0) h1 = 24; // day hours past midnight: show to the end of the day
  for (const x of timed) { h0 = Math.min(h0, Math.floor(x.s / 60)); h1 = Math.max(h1, Math.ceil(x.e / 60)); }
  h0 = Math.max(0, h0); h1 = Math.min(24, Math.max(h1, h0 + 1));
  return { h0, h1 };
}

export const dayStartAt = (now, hours = W.DAY_HOURS) => atMin(now, hours.start);
export const dayEndAt = (now, hours = W.DAY_HOURS) => atMin(now, hours.end);
// The date the plan's free time belongs to: yesterday's while a day that ran
// past midnight is still on (late), else the calendar's — after midnight on
// the night page that's the day you wake into (now.js dayKey).
export const planDate = (now = Date.now(), hours = W.DAY_HOURS) => (hours.late ? getDayKey(now) : localDate(now));
// The date a "today only" answer belongs to (the meal question, "my day runs
// until 23:00 today"): the plan's day. At 06:00 that's the morning you wake
// into, not last night (night owls, Mor 2026-10-12).
export const answerDate = (settings = {}, now = Date.now()) => planDate(now, dayHours(settings, now));

// What a date is called (night owls, Mor 2026-10-12): counted from the day
// you're in (getDayKey, the day boundary in model.js), not the
// calendar's, so at 03:00 the coming morning is "tomorrow" — on the Now
// card, the Schedule and the plan alike. → "today" | "tomorrow" |
// "yesterday" | null (further off).
export function dayWord(ymd, now = Date.now()){
  const d = Math.round((Date.parse(`${ymd}T12:00`) - Date.parse(`${getDayKey(now)}T12:00`)) / 864e5);
  return d === 0 ? "today" : d === 1 ? "tomorrow" : d === -1 ? "yesterday" : null;
}

// The day a Done is filed under, as words ("Sat, Oct 17"): the day key of when
// it was done, the same grouping "Done today" uses (look.js doneToday), so a
// task finished at 01:11 is Saturday's, not Sunday's.
export const doneDayLabel = (doneAt, locale) => (doneAt
  ? new Date(`${getDayKey(doneAt)}T12:00`).toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short" }) : "");

// What a plan is called by where its slots fall (Mor, 2026-10-18): the day key
// of its first slot against the day you're in. At 01:10 a plan laid from 08:00
// is "tomorrow", the same word the Now card's "Tomorrow first" uses; one laid
// from now (01:30, "I'm free now") is still tonight's, "today". → "today" | "tomorrow".
export const slotsWord = (start, now = Date.now()) => (dayWord(getDayKey(start), now) === "tomorrow" ? "tomorrow" : "today");

// The day a plan screen names ("Proposed for …"): where its first slot falls
// when it has one; with nothing fitting, at night (and not "I'm free now") it is
// the coming morning, "tomorrow", the same word the Now card's "Tomorrow first"
// uses - never "today" (Mor, 2026-10-18). → "today" | "tomorrow".
export function planLabelDay({ rows = [], now = Date.now(), hours = W.DAY_HOURS, nightFree = false, fallback = "today" } = {}){
  if (rows.length) return slotsWord(rows[0].start, now);
  return !nightFree && isNight(now, hours) ? "tomorrow" : fallback;
}

// Every line of one plan screen names the plan's day with the SAME word (Mor,
// 2026-10-18): the label, the status line, the "don't fit" note, the empty line
// and the reasons. word: planLabelDay's answer.
export function planWords(word = "today", approved = false){
  const w = word === "tomorrow" ? "tomorrow" : "today", W_ = w === "today" ? "Today" : "Tomorrow";
  return {
    word: w,
    label: approved ? `${W_}'s plan` : `Proposed for ${w}`,
    empty: w === "today" ? "No open task fits the free time left today." : "No open task fits tomorrow.",
    nothingFits: w === "today" ? "Nothing fits what's left of today." : "Nothing fits tomorrow.",
    over: (n) => `${n === 1 ? "One doesn't" : `${n} don't`} fit ${w}. ↑ does one first, ✕ takes it off.`,
    why: (text = "") => String(text).replace(/\btoday\b/, w),
    takeOff: `Take off ${w}'s plan`,
  };
}

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
  const today = getDayKey(now);
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
