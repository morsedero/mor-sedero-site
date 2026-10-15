// Routines (Mor, 2026-10-08; supersedes "no repeating tasks" of 10-03): a
// task that comes back every week, so many times a week — "Exercise, 45 min,
// 3× a week", or "Practice, 1 h, 2× a week, in Band, until the show". It is an
// ordinary task with one more field, `routine: { per, until, log }`:
//
//   per    sessions a week, 1-7. A week is Sunday to Saturday, as everywhere
//          else in Daisey (context.js, schedule.js).
//   until  the last day it runs (the show), or null for open-ended. A routine
//          in a project with a due date gets that date when it's made.
//   log    the sessions done, oldest first: { day, min? , ev? }. `ev` is the
//          calendar event that counted as one (Gym on the calendar, done
//          outside Daisey). Kept to LOG_MAX.
//
// Set days (Mor, 2026-10-08: "what if the user wants specific days and
// hours?"), all optional — without them Daisey finds the time:
//   days     weekdays, 0 = Sunday ([1, 4] = Mon and Thu); per = how many
//   at       the time on each, "18:00"
//   series   the weekly event Daisey wrote for them in the "Daisey"
//            calendar: { id, sig } (slots.js; sig says what it was made from)
//   skipped  ids of those events the user said they skipped ("Did it?" → No)
// A set-days slot is the task's booked slot (day.js bookings): the card and
// the "booked" push at its start. Once it's over it is NOT counted on its
// own — a booked slot isn't proof — Needs you asks "Did it?" (slotsToAsk).
//
// Done never closes it: it logs a session, clears the time spent on it, and
// keeps it off the card until tomorrow — or till Sunday once the week is met.
// A missed week isn't carried over: every Sunday starts again at 0 of per.
// Past `until` it is finished for good (status done).
//
// Daisey offers it the way it offers anything (engine.js, factor "routine"),
// leaning harder the further behind the week is. Sessions already on the
// calendar count as planned: the user scheduled ahead, Daisey only tracks.
//
// Monthly (Mor, 2026-10-12: "a monthly task, not only weekly"): `every:
// "month"` counts a calendar month (1st to last), not a week. Set by one
// date (Mor, same day: "just with a date choice"): `on` "YYYY-MM-DD", the
// first one; its day of the month is every month's (the 31st is a short
// month's last day). Once a month, waiting till that day (notBefore). A
// month without `on` (made before that, the hour it existed) is N× a month.
// Everything below that says "week" means the routine's period.
//
// PURE and self-contained (model.js imports it, so it can't import model.js).
export const PER_MAX = 7;
export const PER_MAX_MONTH = 20;
const LOG_MAX = 60;

const pad = (n) => String(n).padStart(2, "0");
const validDay = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
// The day you're in: before 04:00 it's still yesterday (model.js LATE_HOUR,
// night owls, Mor 2026-10-11), so 01:00's work counts for the night it was.
export const dayOf = (ms = Date.now()) => { const d = new Date(ms); if (d.getHours() < 4) d.setDate(d.getDate() - 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const noon = (day) => { const [y, m, d] = day.split("-").map(Number); return new Date(y, m - 1, d, 12); };
export const addDays = (day, n) => { const d = noon(day); d.setDate(d.getDate() + n); return dayOf(d.getTime()); };
export const weekStart = (day) => addDays(day, -noon(day).getDay());
const monthEnd = (day) => { const [y, m] = day.split("-").map(Number); return `${y}-${pad(m)}-${pad(new Date(y, m, 0).getDate())}`; };
export const monthly = (r) => r?.every === "month";
// The routine's period around `day`: { from, to, len } (days, both ends in).
export function periodOf(r, day = dayOf()){
  if (monthly(r)) { const from = day.slice(0, 8) + "01", to = monthEnd(day); return { from, to, len: Number(to.slice(8)) }; }
  const from = weekStart(day);
  return { from, to: addDays(from, 6), len: 7 };
}
// "week" | "month", for the words.
export const periodWord = (task) => (monthly(task?.routine) ? "month" : "week");
// A monthly routine's day in the month `day` is in ("YYYY-MM-DD"), or null.
export function onDayIn(r, day){
  if (!monthly(r) || !validDay(r.on)) return null;
  const last = Number(monthEnd(day).slice(8));
  return day.slice(0, 8) + pad(Math.min(Number(r.on.slice(8)), last));
}

const validTime = (v) => typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
export const DEFAULT_AT = "18:00";

export function cleanRoutine(r){
  if (!r || typeof r !== "object") return null;
  const month = monthly(r);
  const days = month ? [] : [...new Set((Array.isArray(r.days) ? r.days : []).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
  const on = month && validDay(r.on) ? r.on : null;
  const per = on ? 1 : days.length || Math.round(Number(r.per));
  if (!(per >= 1)) return null;
  const log = (Array.isArray(r.log) ? r.log : []).filter((e) => e && validDay(e.day)).map((e) => ({
    day: e.day,
    ...(Number(e.min) > 0 ? { min: Math.round(Number(e.min)) } : {}),
    ...(e.ev ? { ev: String(e.ev) } : {}),
  }));
  return {
    per: Math.min(month ? PER_MAX_MONTH : PER_MAX, per), ...(month ? { every: "month", ...(on ? { on } : {}) } : {}), until: validDay(r.until) ? r.until : null, log: log.slice(-LOG_MAX),
    ...(days.length ? { days, at: validTime(r.at) ? r.at : DEFAULT_AT } : {}),
    ...(r.series?.id ? { series: { id: String(r.series.id), sig: String(r.series.sig || "") } } : {}),
    ...(Array.isArray(r.skipped) && r.skipped.length ? { skipped: r.skipped.map(String).slice(-30) } : {}),
  };
}

export const isRoutine = (task) => !!cleanRoutine(task?.routine);

// A repeat said in words, from capture (Tell Daisey, the Add form's title;
// 2026-10-15: "water plants every weekday" was saved as a one-off). →
// { routine, title } with the words taken out of the title, or null.
// Weekdays are the work week, Sunday to Thursday (weights.WEEKEND_DAYS).
// Named days are set days, as the form's Set days makes them, at the time
// said or DEFAULT_AT. "on Monday" is a date, not a repeat: only "every
// Monday" or "on Mondays".
export const WORK_WEEK = [0, 1, 2, 3, 4];
const DAY_RE = [/sun(?:day)?s?/, /mon(?:day)?s?/, /tue(?:s|sday)?s?/, /wed(?:nesday)?s?/, /thu(?:rs?|rsday)?s?/, /fri(?:day)?s?/, /sat(?:urday)?s?/];
const DAY_WORD = "(?:sun|mon|tue|wed|thu|fri|sat)[a-z]*";
const HE_DAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי"];
const HE_DAY = `(?:${HE_DAYS.join("|")}|שבת)`;
const COUNT = { once: 1, twice: 2, thrice: 3, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
const HE_COUNT = { "פעם": 1, "פעמיים": 2 };
export function repeatFrom(text, now = Date.now()){
  const s = String(text || "");
  const found = (re, make) => { const m = s.match(re), r = m && make(m); return r ? { m, r } : null; };
  const hit =
    found(/(?:^|\s)(?:every|each|on)?\s*week[\s-]?days?\b/i, () => ({ per: 5, days: WORK_WEEK }))
    || found(/(?:^|\s)(?:(?:כל\s+)?יום\s+חול|ב?ימי\s+חול)(?=\s|$|[,.])/, () => ({ per: 5, days: WORK_WEEK }))
    || found(new RegExp(`(?:^|\\s)(?:every|each)\\s+(${DAY_WORD}(?:\\s*(?:,|and|&)\\s*${DAY_WORD})*)\\b|(?:^|\\s)on\\s+(${DAY_WORD}s(?:\\s*(?:,|and|&)\\s*${DAY_WORD}s)*)\\b`, "i"), (m) => {
      const days = (m[1] || m[2]).toLowerCase().split(/\s*(?:,|and|&)\s*/).map((w) => DAY_RE.findIndex((re) => new RegExp(`^${re.source}$`).test(w))).filter((d) => d >= 0);
      return days.length ? { per: days.length, days } : null;
    })
    || found(new RegExp(`(?:^|\\s)כל\\s+(?:יום\\s+)?(${HE_DAY}(?:\\s*(?:,|ו)\\s*(?:יום\\s+)?${HE_DAY})*)(?=\\s|$|[,.])`), (m) => {
      const days = m[1].split(/\s*,\s*|\s+ו|^ו/).map((w) => w.replace(/^(?:יום\s+)/, "").trim()).filter(Boolean).map((w) => (w === "שבת" ? 6 : HE_DAYS.indexOf(w))).filter((d) => d >= 0);
      return days.length ? { per: days.length, days } : null;
    })
    || found(/(?:^|\s)(?:every\s*day\b|each\s*day\b|daily(?=\s*(?:$|[,.;]|(?:on|at|until|from)\b)))/i, () => ({ per: 7 }))
    || found(/(?:^|\s)כל\s+יום(?=\s|$|[,.])/, () => ({ per: 7 }))
    || found(/(?:^|\s)(?:every\s+month|each\s+month|monthly(?=\s*(?:$|[,.;]|(?:on|at|until|from)\b))|once\s+a\s+month)(?:\s+on\s+the\s+(\d{1,2})(?:st|nd|rd|th)?)?\b/i, (m) => ({ every: "month", onDay: Number(m[1]) || null }))
    || found(/(?:^|\s)(?:כל\s+חודש|פעם\s+בחודש)(?:\s+ב-?(\d{1,2})\s+לחודש)?(?=\s|$|[,.])/, (m) => ({ every: "month", onDay: Number(m[1]) || null }))
    || found(/(?:^|\s)(\d|once|twice|thrice|one|two|three|four|five|six)\s*(?:x|×|times)?\s*(?:a|per|\/)\s*week\b/i, (m) => ({ per: Number(m[1]) || COUNT[m[1].toLowerCase()] }))
    || found(/(?:^|\s)(?:every\s+week\b|each\s+week\b|weekly(?=\s*(?:$|[,.;]|(?:on|at|until|from)\b)))/i, () => ({ per: 1 }))
    || found(/(?:^|\s)(?:(\d)\s+פעמים|(פעמיים|פעם))\s+בשבוע(?=\s|$|[,.])/, (m) => ({ per: Number(m[1]) || HE_COUNT[m[2]] }))
    || found(/(?:^|\s)כל\s+שבוע(?=\s|$|[,.])/, () => ({ per: 1 }));
  if (!hit) return null;
  let { r, m } = hit, rest = s.slice(0, m.index) + " " + s.slice(m.index + m[0].length);
  if (r.every === "month") {
    const today = dayOf(now);
    let on = today;
    if (r.onDay >= 1 && r.onDay <= 31) { on = onDayIn({ every: "month", on: `2000-01-${pad(r.onDay)}` }, today); if (on < today) on = onDayIn({ every: "month", on: `2000-01-${pad(r.onDay)}` }, addDays(monthEnd(today), 1)); }
    r = { per: 1, every: "month", on };
  } else if (r.days) {
    // Set days have a time; one said beside the repeat is it.
    const t = rest.match(/(?:^|\s)(?:at|ב-?|בשעה)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?=\s|$|[,.])/i);
    if (t) {
      let hr = Number(t[1]); const min = Number(t[2] || 0), ap = (t[3] || "").toLowerCase();
      if (ap === "pm" && hr < 12) hr += 12; if (ap === "am" && hr === 12) hr = 0;
      if (hr <= 23 && min <= 59) { r = { ...r, at: `${pad(hr)}:${pad(min)}` }; rest = rest.slice(0, t.index) + " " + rest.slice(t.index + t[0].length); }
    }
  }
  const title = rest.replace(/\s+/g, " ").replace(/\s+([,.])/g, "$1").replace(/^[\s,.\-–—]+|[\s,\-–—]+$/g, "").trim();
  return { routine: cleanRoutine(r), title };
}
// The repeat in a few words, for a card: "every weekday", "every Mon, Thu
// at 18:00", "3× a week", "every month on the 12th".
export function repeatWords(r){
  r = cleanRoutine(r);
  if (!r) return "";
  const ord = (n) => n + (n > 10 && n < 14 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th");
  if (monthly(r)) return r.on ? `every month on the ${ord(Number(r.on.slice(8)))}` : `${r.per}× a month`;
  if (r.days) {
    const names = r.days.join() === WORK_WEEK.join() ? "weekday" : r.days.length === 7 ? "day"
      : r.days.map((d) => new Date(2026, 9, 4 + d).toLocaleDateString("en", { weekday: "short" })).join(", ");
    return `every ${names} at ${r.at}`;
  }
  return r.per >= 7 ? "every day" : r.per === 1 ? "every week" : `${r.per}× a week`;
}

// Sessions logged in the week (or month) `day` falls in.
export function doneThisWeek(task, day = dayOf()){
  const { from, to } = periodOf(task.routine, day);
  return (task.routine?.log || []).filter((e) => e.day >= from && e.day <= to).length;
}

// Days left in this week, today included, cut short by `until`.
export function daysLeft(task, day = dayOf()){
  let end = periodOf(task.routine, day).to;
  const until = task.routine?.until;
  if (until && until < end) end = until;
  return end < day ? 0 : Math.round((noon(end) - noon(day)) / 86400000) + 1;
}

// ---------- the calendar ----------

const tokens = (s) => String(s || "").toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
// Words that name the same routine, so "Gym" counts for Exercise and
// "Rehearsal" for Practice.
const ALIKE = [
  ["exercise", "workout", "gym", "run", "running", "training", "train", "yoga", "pilates", "swim", "swimming", "fitness", "crossfit", "spinning", "sport", "hike", "ספורט", "אימון", "חדר", "כושר", "ריצה", "יוגה", "פילאטיס", "שחייה"],
  ["practice", "practise", "rehearsal", "rehearse", "jam", "חזרה", "חזרות", "תרגול"],
];
const alikeOf = (w) => ALIKE.find((g) => g.includes(w)) || null;

// An event that is a session of this routine: its title holds every word of
// the routine's title, or a word that means the same. Daisey's own log
// entries ("✓ Exercise") and all-day events never count.
export function eventIsRoutine(ev, task){
  if (!ev || ev.allDay || /^\s*✓/.test(ev.title || "")) return false;
  if (ev.taskId) return ev.taskId === task.id; // Daisey's own block: whose it is, not its title
  const et = tokens(ev.title), tt = tokens(task.title);
  if (!et.length || !tt.length) return false;
  if (tt.every((w) => et.includes(w))) return true;
  return tt.some((w) => { const g = alikeOf(w); return !!g && et.some((x) => g.includes(x)); });
}

// This routine's events this week: `past` already over (sessions that
// happened, to log), `ahead` still to come (planned by the user), and
// `today` — one of the ahead ones is later today. `ask`: its own set-days
// slots that are over but not answered yet ("Did it?"); they count as
// planned until answered, so Daisey doesn't push a second one meanwhile.
export function calendarWeek(task, events = [], now = Date.now()){
  const today = dayOf(now), { from, to } = periodOf(task.routine, today);
  const out = { past: [], ahead: 0, today: false, ask: [] };
  const log = task.routine?.log || [], skipped = new Set(task.routine?.skipped || []);
  for (const ev of events) {
    if (!eventIsRoutine(ev, task)) continue;
    const start = Date.parse(ev.start), end = Date.parse(ev.end), day = dayOf(start);
    if (!(day >= from && day <= to)) continue;
    const e = { id: ev.id, day, min: Math.round((end - start) / 60000), start, end };
    if (start > now) { out.ahead++; if (day === today) out.today = true; }
    else if (end > now) continue; // on now: this is the session, the card offers it
    else if (!ev.taskId) out.past.push(e);
    else if (!skipped.has(ev.id) && !log.some((x) => x.ev === ev.id || x.day === day)) { out.ask.push(e); out.ahead++; }
  }
  return out;
}

// The set-days slots to ask about: over, not answered, no session that day.
export const slotsToAsk = (task, events, now = Date.now()) =>
  (isRoutine(task) && task.status === "ready" ? calendarWeek(task, events, now).ask : []);

// The calendar sessions not logged yet. One per day at most, and none on a
// day that already has a session — Gym on the calendar while the timer ran
// in Daisey is one workout, not two.
export function eventsToLog(task, events, now = Date.now()){
  const log = task.routine?.log || [];
  const days = new Set(log.map((e) => e.day)), seen = new Set(log.map((e) => e.ev).filter(Boolean));
  const out = [];
  for (const e of calendarWeek(task, events, now).past) {
    if (seen.has(e.id) || days.has(e.day)) continue;
    days.add(e.day);
    out.push(e);
  }
  return out;
}

// What engine.readMoment needs: { [taskId]: { ahead, today } }.
export function routineCalendar(tasks, events, now = Date.now()){
  const out = {};
  for (const t of tasks) if (isRoutine(t) && t.status === "ready") {
    const c = calendarWeek(t, events, now);
    if (c.ahead) out[t.id] = { ahead: c.ahead, today: c.today };
  }
  return out;
}

// Where the week stands: done, planned on the calendar, still needed, days left.
export function weekState(task, day = dayOf(), cal = null){
  const r = cleanRoutine(task.routine), per = r?.per || 0, p = periodOf(r, day);
  const done = doneThisWeek(task, day), ahead = cal?.ahead || 0;
  // gone: whole days of the period already over (Sunday, or the 1st: 0).
  // A dated month is due on its day: from then on it's the last day for it.
  const on = onDayIn(r, day);
  return { per, done, ahead, need: Math.max(0, per - done - ahead), daysLeft: on && day >= on ? 1 : daysLeft(task, day),
    gone: Math.round((noon(day) - noon(p.from)) / 86400000), len: p.len, word: periodWord(task), ...(on ? { on } : {}) };
}

// "1 of 3 this week", "3 of 3 this week ✓" — for the task sheet and the lists.
export function weekLine(task, day = dayOf()){
  const per = cleanRoutine(task.routine)?.per;
  if (!per) return "";
  const done = doneThisWeek(task, day);
  return `${done} of ${per} this ${periodWord(task)}${done >= per ? " ✓" : ""}`;
}

// ---------- the nag ----------

// One line over the card (Mor, 2026-10-15: "every time I see it I think
// there's something more urgent, even though it's 15 minutes... just a
// nagger"). A weekly routine behind an even pace shows up every NAG_GAP
// days; from Thursday, once what's left barely fits the days left, it comes
// every day and says so. Set-days routines have their own slot,
// monthly ones their own day: not nagged.
// `seen`: settings.routineNag, { day, off }: the day it last showed, the day
// Later shut it. `skip`: the one on the card. Returns { task, late, s }
// (s = weekState) or null.
export const NAG_GAP = 2;
export function nagFor(tasks, { day = dayOf(), cal = {}, seen = null, skip = null } = {}){
  if (seen?.off === day) return null;
  const gap = seen?.day ? Math.round((noon(day) - noon(seen.day)) / 86400000) : Infinity;
  const all = (tasks || []).map((task) => {
    const r = cleanRoutine(task.routine);
    if (task.id === skip || task.status !== "ready" || !r || r.days || monthly(r) || cal[task.id]?.today || r.log.some((e) => e.day === day)) return null;
    const s = weekState(task, day, cal[task.id]);
    if (!s.need || !s.daysLeft) return null;
    const short = Math.floor(s.per * s.gone / s.len) - s.done - s.ahead;
    const late = s.daysLeft <= 3 && s.need * 2 >= s.daysLeft; // Thursday on, and tight
    return short > 0 || late ? { task, late, s, short } : null;
  }).filter(Boolean);
  const n = all.sort((a, b) => b.late - a.late || b.short - a.short || b.s.need / b.s.daysLeft - a.s.need / a.s.daysLeft)[0];
  if (!n || !(n.late || gap === 0 || gap >= NAG_GAP)) return null;
  return { task: n.task, late: n.late, s: n.s };
}

// The nag's words, apart, so a Hebrew title sits in its own <bdi> and the
// English around it keeps its order: { title, len: "15 min", tail }.
// tail: "1 of 3 this week"; late: "2 to go, 3 days left" / "1 to go, last day".
export function nagParts({ task, late, s }){
  const m = Number(task.size) || 0;
  return {
    title: String(task.title || "").trim(),
    len: m ? (m < 60 ? `${m} min` : `${+(m / 60).toFixed(1)} h`) : "",
    tail: !late ? `${s.done} of ${s.per} this week`
      : `${s.need} to go, ${s.daysLeft === 1 ? "last day" : `${s.daysLeft} days left`}`,
  };
}
// One string, for the tests and the aria label: "Portuguese, 15 min · 1 of 3 this week".
export function nagText(n){
  const p = nagParts(n);
  return `${p.title}${p.len ? `, ${p.len}` : ""} · ${p.tail}`;
}

// ---------- a session ----------

// The patch for one session done. `minutes`: the time it took, if timed.
// `ev`: { id, day, min } when a calendar event is what's being logged.
export function sessionPatch(task, { now = Date.now(), minutes = 0, ev = null } = {}){
  const r = cleanRoutine(task.routine);
  const today = dayOf(now);
  const min = ev ? ev.min : Math.round(minutes);
  const log = [...r.log, { day: ev?.day || today, ...(min > 0 ? { min } : {}), ...(ev ? { ev: ev.id } : {}) }].slice(-LOG_MAX);
  const nextPeriod = addDays(periodOf(r, today).to, 1);
  const met = doneThisWeek({ routine: { ...r, log } }, today) >= r.per;
  // Set days: the next one of its days, not tomorrow (2026-10-15: "every
  // weekday" done on Thursday came back Friday).
  const nextSet = (from) => { for (let i = 1; i <= 7; i++) { const d = addDays(from, i); if (r.days.includes(noon(d).getDay())) return d; } return addDays(from, 1); };
  const next = r.days ? nextSet(met ? addDays(nextPeriod, -1) : today) : !met ? addDays(today, 1) : onDayIn(r, nextPeriod) || nextPeriod;
  // A session logged from the calendar never pulls the next one closer.
  const notBefore = task.notBefore && task.notBefore > next ? task.notBefore : next;
  const over = !!r.until && notBefore > r.until;
  return {
    routine: { ...r, log },
    status: over ? "done" : "ready",
    notBefore: over ? task.notBefore ?? null : notBefore,
    doneAt: now, spentMinutes: 0, progress: over ? 100 : 0,
    skipsSinceStart: 0, stopsUnfinished: 0, onHold: null, touchedAt: now,
    ...(task.steps ? { steps: task.steps.map((s) => ({ ...s, done: false })), nextStep: task.steps[0]?.text || null } : {}),
  };
}

// "Did it?" → No: that slot is answered, and the week needs one more again
// (so the engine offers another time).
export const skipSlotPatch = (task, evId, { now = Date.now() } = {}) => {
  const r = cleanRoutine(task.routine);
  return { routine: { ...r, skipped: [...(r.skipped || []), String(evId)].slice(-30) }, touchedAt: now };
};

// What the weekly event is made from; a change in any means rewriting it.
// null: no set days, so no event should exist.
export function seriesSig(task){
  const r = cleanRoutine(task.routine);
  if (!r?.days) return null;
  return JSON.stringify([r.days, r.at, r.until, task.title, Number(task.size) || 30]);
}

// Making a task a routine, changing how often or till when: the log stays.
// null / false makes it a one-off task again.
export function routineChange(task, change){
  if (change == null || change === false) return { routine: null };
  // A log comes in only when Repeats is switched back on (addtask.js setPer).
  const r = cleanRoutine({ ...(task.routine || {}), ...change, log: (Array.isArray(change.log) && !task.routine ? change.log : task.routine?.log) || [] });
  return r ? { routine: r } : { routine: null };
}
