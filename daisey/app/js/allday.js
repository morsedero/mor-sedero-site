// An all-day event today (Mor, 2026-11-05): Daisey can't tell "ILLUSTRATION
// WEEK, I'm working on it" from "Dad's birthday, I'm busy all day", so it
// asks once a day per event: are you free? Free = the day is unchanged (an
// all-day event never blocked picks). Busy = the day's waking hours are one
// block, so the plan and the Now card see nothing free.
// Read-only calendars (holidays, birthdays) aren't asked; they say nothing
// about whose time it is. The answer is today's only, in settings.allDayToday
// = { date, [event id]: "free" | "busy" }. PURE.
import { dayHours, answerDate } from "./day.js";

const atMin = (now, min) => new Date(now).setHours(0, min, 0, 0);

// An all-day event standing on this date (end is exclusive, as Google's).
const standsOn = (e, ymd) => e.allDay && e.start && String(e.start).slice(0, 10) <= ymd && ymd < String(e.end || e.start).slice(0, 10);
const mine = (e) => e.editable !== false && !/^\s*✓/u.test(e.title || "");
const said = (settings, today) => (settings.allDayToday?.date === today ? settings.allDayToday : {});

// → [{ key, id, ev }]: today's all-day events not yet answered.
export function allDayAsks(events = [], settings = {}, now = Date.now()){
  const today = answerDate(settings, now), done = said(settings, today);
  return events.filter((e) => standsOn(e, today) && mine(e) && !done[e.id])
    .map((ev) => ({ key: `allday:${today}:${ev.id}`, id: ev.id, ev }));
}

// The events with a "busy" all-day event made a timed block over the day's
// hours (kept beside the banner; `dayBlock` marks it).
export function withAllDay(events = [], settings = {}, now = Date.now()){
  const today = answerDate(settings, now), done = said(settings, today);
  const busy = events.filter((e) => standsOn(e, today) && done[e.id] === "busy");
  if (!busy.length) return events;
  const hrs = dayHours(settings, now), start = atMin(now, hrs.start), end = atMin(now, hrs.end);
  if (!(end > start)) return events;
  return [...events, ...busy.map((e) => ({ ...e, id: `${e.id}:day`, allDay: false, busy: true, editable: false, dayBlock: true,
    start: new Date(start).toISOString(), end: new Date(end).toISOString() }))];
}
