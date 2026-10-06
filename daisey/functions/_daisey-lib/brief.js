// The morning brief (2026-10-06, Mor: "as a morning message"): one
// notification at the start of the day hours saying how the day looks.
//   "3 h 20 min free today. 8 open, about 3 fit. Deadline today: Pay arnona.
//    First: Teaching at 10:00."
// PURE. The same sums as the app's day.js capacity() — free minutes left in
// the day hours between busy calendar events; open = ready tasks dated today
// or earlier (a passed target rolls to today), not held by a start date;
// fit = how many of those the free time holds, deadlines first, then
// smallest, each counted by the time it still needs. Re-done here because
// the server runs in UTC and must read "today" in the user's own zone.
const MIN = 60000;

// The wall clock in `tz`: { date: "YYYY-MM-DD", minutes: after midnight }.
function localParts(ms, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

// Epoch ms of `minutes` after midnight on `date` in `tz` (checked twice, so a
// DST change that day lands right).
function zoned(date, minutes, tz) {
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
function freeMinutes(events, from, end) {
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

// tasks: the app's snapshot (ready tasks with a date). events: today's
// agenda, or null when the calendar can't be read (then no free time is
// claimed). dayStart/dayEnd: minutes after midnight. Returns { title, body }.
function brief({ tasks = [], events = null, now = Date.now(), tz = "Asia/Jerusalem", dayStart = 480, dayEnd = 1320 } = {}) {
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
  if (!open.length) parts.push("Nothing due today.");
  else if (free != null) parts.push(`${open.length} open, about ${fit} fit.`);
  else parts.push(`${open.length} open today.`);
  const late = open.filter((t) => isDl(t) && t.due < today), dueToday = open.filter((t) => isDl(t) && t.due === today);
  parts.push(titled("Deadline passed", late), titled("Deadline today", dueToday));
  const first = (events || []).filter((e) => busy(e) && Date.parse(e.start) >= now && Date.parse(e.start) < end)
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))[0];
  if (first) parts.push(`First: ${first.title} at ${clock(Date.parse(first.start), tz)}.`);
  return { title: "Good morning", body: parts.filter(Boolean).join(" "), today };
}

module.exports = { brief, localParts, zoned, freeMinutes };
