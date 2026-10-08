// The day brief (2026-10-06, Mor): how today looks, in one paragraph. The
// morning notification sends it (functions/daisey-now-morning.js), and the
// header's Today chip shows it live (briefchip.js) — one copy of the sums
// for both, so the two never disagree.
//   "3 h 20 min free today. 8 open today. Plan ready: 3 tasks, 2 h, starting
//    with Pay arnona at 08:05. Open Daisey to approve it. Deadline today: Pay
//    arnona. First event: Teaching at 10:00."
// PURE. The same sums as the app's day.js capacity() — free minutes left in
// the day hours between busy calendar events; open = ready tasks dated today
// or earlier (a passed target rolls to today), not held by a start date;
// fit = how many of those the free time holds, deadlines first, then
// smallest, each counted by the time it still needs. Takes the time zone as
// an argument because the server runs in UTC and must read "today" in the
// user's own zone. PURE.
// The plan (Mor, 2026-10-08: "make the brief read from the plan"): with a
// plan for today the brief says the plan's own numbers, not its own sum —
// approved, how far along it is and what's next; not yet approved, the
// proposal (the saved one, else proposal.proposeDay's, as the card would
// show it). The "about N fit" sum stays only for a day with no plan to tell.
import { proposeDay, timeline, planProgress, nextPlanned } from "./proposal.js";
export const MIN = 60000;

// The wall clock in `tz`: { date: "YYYY-MM-DD", minutes: after midnight }.
export function localParts(ms, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

// Epoch ms of `minutes` after midnight on `date` in `tz` (checked twice, so a
// DST change that day lands right).
export function zoned(date, minutes, tz) {
  const [y, m, d] = date.split("-").map(Number);
  const want = Date.UTC(y, m - 1, d, 0, minutes);
  let ms = want;
  for (let i = 0; i < 2; i++) {
    const p = localParts(ms, tz), [py, pm, pd] = p.date.split("-").map(Number);
    ms += want - Date.UTC(py, pm - 1, pd, 0, p.minutes);
  }
  return ms;
}

const clock = (ms, tz) => { const m = localParts(ms, tz).minutes; return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; };
const durText = (min) => { const m = Math.max(0, Math.round(min)); if (m < 60) return `${m} min`; const r = m % 60; return `${Math.floor(m / 60)} h` + (r ? ` ${r} min` : ""); };
const left = (t) => Math.max(5, (Number(t.size) || 30) - (Number(t.spentMinutes) || 0));
const busy = (e) => !e.allDay && e.busy !== false && e.start && e.end;

// Free minutes from max(now, day start) to the day's end, between busy events.
export function freeMinutes(events, from, end) {
  if (from >= end) return 0;
  const spans = events.filter(busy).map((e) => [Date.parse(e.start), Date.parse(e.end)])
    .filter(([s, e]) => e > from && s < end).sort((a, b) => a[0] - b[0]);
  let cursor = from, free = 0;
  for (const [s, e] of spans) {
    if (s > cursor) free += s - cursor;
    if (e > cursor) cursor = e;
  }
  if (cursor < end) free += end - cursor;
  return Math.floor(free / MIN);
}

const titled = (label, list) => !list.length ? null
  : `${label}: ${list[0].title}${list.length > 1 ? ` and ${list.length - 1} more` : ""}.`;

const count = (n) => (n === 1 ? "1 task" : `${n} tasks`);

// The plan in a sentence or two, or null when there's none to tell (dismissed
// today, or nothing to propose). Clock times only when the calendar was read.
function planLine({ tasks, events, now, tz, today, dayStart, dayEnd, dayplan, run }) {
  const ctx = { tasks, events: events || [], now, hours: { start: dayStart, end: dayEnd }, run };
  const at = (ms) => (events ? ` at ${clock(ms, tz)}` : "");
  const saved = dayplan?.date === today ? dayplan : null;
  if (saved?.status === "dismissed") return null;
  if (saved?.status === "approved") {
    const items = saved.items || [];
    const { done, total } = planProgress({ items }, tasks);
    if (!total) return null;
    const nextId = nextPlanned({ status: "approved", date: today, items }, tasks, today, now);
    if (!nextId) return done === total ? `Plan done: ${done} of ${total}.` : `Plan: ${done} of ${total} done.`;
    const { rows, over } = timeline(items, ctx);
    const row = rows.find((r) => r.taskId === nextId);
    const next = tasks.find((t) => t.id === nextId);
    return `Plan: ${done} of ${total} done. Next: ${next.title}${row ? at(row.start) : ""}.`
      + (events && over.length ? ` ${over.length} no longer ${over.length === 1 ? "fits" : "fit"} today.` : "");
  }
  const open = (it) => !it.taskId || tasks.some((t) => t.id === it.taskId && t.status === "ready");
  // Without the calendar Daisey can't know the free time, so it doesn't make one up.
  const items = saved?.items?.length ? saved.items.filter(open) : events ? proposeDay(ctx) : [];
  const { rows } = timeline(items, ctx);
  if (!rows.length) return null;
  const mins = rows.reduce((s, r) => s + r.minutes, 0);
  return `Plan ready: ${count(rows.length)}, ${durText(mins)}, starting with ${rows[0].task.title}${at(rows[0].start)}. Open Daisey to approve it.`;
}

// tasks: the user's tasks (any status). events: today's agenda, or null when
// the calendar can't be read (then no free time is claimed). dayStart/dayEnd:
// minutes after midnight. needs: how many Needs you questions are waiting.
// dayplan: the saved plan (store.watchDayPlan's { date, status, items }) or
// null. run: the running task (state/now) or null.
// Returns { title, body, today }.
export function brief({ tasks = [], events = null, now = Date.now(), tz = Intl.DateTimeFormat().resolvedOptions().timeZone,
  dayStart = 480, dayEnd = 1320, needs = 0, title = "Good morning", dayplan = null, run = null } = {}) {
  const today = localParts(now, tz).date;
  const from = Math.max(now, zoned(today, dayStart, tz)), end = zoned(today, dayEnd, tz);
  const open = tasks.filter((t) => t.status === "ready" && t.due && t.due <= today && !(t.notBefore && t.notBefore > today));
  const isDl = (t) => t.dateKind === "deadline";
  const order = [...open].sort((a, b) => isDl(b) - isDl(a) || left(a) - left(b));
  const free = events ? freeMinutes(events, from, end) : null;
  let fit = 0, used = 0;
  if (free != null) for (const t of order) if (used + left(t) <= free) { fit++; used += left(t); }

  const parts = [];
  if (free != null) parts.push(free > 0 ? `${durText(free)} free today.` : "No free time today.");
  const plan = planLine({ tasks, events, now, tz, today, dayStart, dayEnd, dayplan, run });
  if (!open.length) parts.push("Nothing due today.");
  else if (plan) parts.push(`${open.length} open today.`);
  else if (free != null) parts.push(`${open.length} open, about ${fit} fit.`);
  else parts.push(`${open.length} open today.`);
  parts.push(plan);
  const late = open.filter((t) => isDl(t) && t.due < today), dueToday = open.filter((t) => isDl(t) && t.due === today);
  parts.push(titled("Deadline passed", late), titled("Deadline today", dueToday));
  // Tomorrow's deadline, not started yet: the one worth knowing a day early.
  const tomorrow = localParts(zoned(today, 36 * 60, tz), tz).date;
  parts.push(titled("Deadline tomorrow, not started", tasks.filter((t) => t.status === "ready" && isDl(t) && t.due === tomorrow
    && !(t.starts > 0) && !(t.spentMinutes > 0))));
  if (needs > 0) parts.push(needs === 1 ? "1 thing needs you." : `${needs} things need you.`);
  const first = (events || []).filter((e) => busy(e) && Date.parse(e.start) >= now && Date.parse(e.start) < end)
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))[0];
  if (first) parts.push(`First event: ${first.title} at ${clock(Date.parse(first.start), tz)}.`);
  return { title, body: parts.filter(Boolean).join(" "), today };
}

