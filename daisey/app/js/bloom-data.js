// Bloom's numbers (Mor, 2026-10-08; daisey/STATS_PLAN.md): the dated work log
// and everything the page shows from it. PURE — no DOM, no store.
//
// The log is one doc per month, users/{uid}/state/log-YYYY-MM, { e: { id:
// entry } }, one entry per stretch of work:
//   { t: taskId, p: project, m: minutes, at: ms, d: 1 if it finished the task,
//     g: 1 if the minutes are Daisey's guess, ev: 1 if from a calendar event,
//     s: a Done's task length, what it counts at when no minutes were logged }
// (A Done logs no minutes since 2026-10-11, so the Week page counts its s.)
const minOf = (e) => e.m || e.s || 0;
// Weeks run Sunday to Saturday, as routines do.
import { dayOf, addDays, weekStart, cleanRoutine } from "./routine.js";
import { toMinutes, DEFAULT_SIZE, INBOX } from "./model.js";

const MIN = 60000;
export const PERIODS = ["today", "week", "month"];
export const monthKey = (ms) => dayOf(ms).slice(0, 7);
export const logDocKey = (ms) => `log-${monthKey(ms)}`;
const norm = (s) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const sameTitle = (a, b) => norm(a) !== "" && norm(a) === norm(b);

// { from, to } as YYYY-MM-DD, inclusive, for the period holding `now`.
export function periodRange(period, now = Date.now()){
  const day = dayOf(now);
  if (period === "today") return { from: day, to: day };
  if (period === "month") {
    const [y, m] = day.split("-").map(Number);
    return { from: `${y}-${String(m).padStart(2, "0")}-01`, to: dayOf(new Date(y, m, 0, 12).getTime()) };
  }
  const from = weekStart(day);
  return { from, to: addDays(from, 6) };
}
// The log docs a range reads (a week can straddle two months).
export const monthsOfRange = ({ from, to }) => [...new Set([from.slice(0, 7), to.slice(0, 7)])];
export const inRange = (at, { from, to }) => { const d = dayOf(at); return d >= from && d <= to; };

// ---------- the entries a period shows ----------
// Work done before the log existed, estimated from what tasks kept: a done
// task's spentMinutes (else its size) on its done day, a routine's sessions on
// theirs. A task, or a routine day, with real log entries is never estimated.
export function estimatedEntries(tasks = [], logged = []){
  const hasTask = new Set(logged.map((e) => e.t)), hasDay = new Set(logged.map((e) => `${e.t}|${dayOf(e.at)}`));
  const out = [];
  for (const t of tasks) {
    const size = toMinutes(t.size) ?? DEFAULT_SIZE, p = t.project || INBOX;
    if (cleanRoutine(t.routine)) {
      for (const s of t.routine.log || []) {
        if (hasDay.has(`${t.id}|${s.day}`)) continue;
        const [y, m, d] = s.day.split("-").map(Number);
        out.push({ id: `est-${t.id}-${s.day}`, t: t.id, p, m: s.min || size, at: new Date(y, m - 1, d, 12).getTime(), d: 1, g: 1, est: 1 });
      }
    } else if (t.status === "done" && t.doneAt && !hasTask.has(t.id)) {
      out.push({ id: `est-${t.id}`, t: t.id, p, m: t.spentMinutes > 0 ? t.spentMinutes : size, at: t.doneAt, d: 1, g: 1, est: 1 });
    }
  }
  return out;
}

// Calendar events that are project work Daisey never timed: past, timed, not a
// task's own slot, with a project's name in the title, and no logged work on
// that project around then. Marked guessed. Capped at 4 h.
export function eventEntries(events = [], { projects = [], tasks = [], logged = [], now = Date.now() } = {}){
  const names = projects.filter((n) => n && n !== INBOX && norm(n).length >= 3);
  const out = [];
  for (const e of events) {
    if (e.allDay || e.busy === false || !e.start || !e.end) continue;
    const s = Date.parse(e.start), z = Date.parse(e.end);
    if (!(z > s) || z > now) continue;
    if (e.taskId || tasks.some((t) => t.id === e.taskId || sameTitle(t.title, e.title))) continue;
    const name = names.find((n) => norm(e.title).includes(norm(n)));
    if (!name) continue;
    if (logged.some((x) => x.p === name && x.at >= s - 30 * MIN && x.at <= z + 30 * MIN)) continue;
    out.push({ id: `ev-${e.id || s}`, t: null, p: name, m: Math.min(240, Math.round((z - s) / MIN)), at: z, g: 1, ev: 1, title: e.title });
  }
  return out;
}

// ---------- what a period adds up to ----------
export function summarize(entries = [], range){
  const rows = entries.filter((e) => inRange(e.at, range));
  const projects = new Map(), finished = new Set();
  for (const e of rows) {
    const name = e.p || INBOX;
    const p = projects.get(name) || { name, min: 0, done: 0, guess: false, tasks: new Map() };
    p.min += minOf(e);
    p.guess ||= !!e.g;
    const key = e.t || e.id, t = p.tasks.get(key) || { id: e.t, title: e.title || null, min: 0, done: false };
    t.min += minOf(e);
    // Every finish counts: a routine's three sessions are three done, not one.
    // A task finished twice the same day (Reopen, Done again) is one.
    const fin = `${key}|${dayOf(e.at)}`;
    if (e.d && !finished.has(fin)) { finished.add(fin); t.done = true; p.done++; }
    p.tasks.set(key, t);
    projects.set(name, p);
  }
  // A day counts when work happened in Daisey; a calendar event's guess doesn't.
  const days = new Set(rows.filter((e) => !e.ev && ((e.m || 0) > 0 || e.d)).map((e) => dayOf(e.at)));
  return {
    projects,
    total: rows.reduce((n, e) => n + minOf(e), 0),
    // Timed minutes only (Mor, 2026-10-12): no Done's length, no guesses.
    focused: rows.reduce((n, e) => n + (e.g ? 0 : e.m || 0), 0),
    done: [...projects.values()].reduce((s, p) => s + p.done, 0),
    days: days.size,
    guess: rows.some((e) => e.g),
  };
}

// One flower per project, Focus first, then Keep going, then Background; by
// time within a tier. height 0-1 against the biggest project of the period,
// petals = tasks finished (cap PETAL_MAX, the rest in `more`). No time and no
// tasks → a closed bud. Projects with nothing this period still show, so the
// garden doesn't change shape from day to day.
export const PETAL_MAX = 12;
const TIER_ORDER = { focus: 0, keep: 1, background: 2 };
export function flowers(summary, projectNames = [], tiers = {}){
  const names = [...new Set([...projectNames.filter((n) => n), ...summary.projects.keys()])];
  const top = Math.max(1, ...names.map((n) => summary.projects.get(n)?.min || 0));
  return names.map((name) => {
    const p = summary.projects.get(name), tier = TIER_ORDER[tiers[name]] === undefined ? "keep" : tiers[name];
    const min = p?.min || 0, done = p?.done || 0;
    return { name, tier, min, done, guess: !!p?.guess, height: min / top, petals: Math.min(done, PETAL_MAX), more: Math.max(0, done - PETAL_MAX),
      bud: !min && !done, tasks: p ? [...p.tasks.values()].sort((a, b) => b.min - a.min) : [] };
  }).sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier] || b.min - a.min || a.name.localeCompare(b.name));
}

// ---------- routines ----------
// Consecutive weeks (before this one, plus this one once it is met) in which a
// routine got its `per` sessions.
export function weekStreak(task, day = dayOf()){
  const r = cleanRoutine(task.routine);
  if (!r) return 0;
  const inWeek = (from) => r.log.filter((e) => e.day >= from && e.day <= addDays(from, 6)).length;
  let from = weekStart(day), n = 0;
  if (inWeek(from) >= r.per) n++;
  for (from = addDays(from, -7); n < 52 && inWeek(from) >= r.per; from = addDays(from, -7)) n++;
  return n;
}

// The routines, with the week as seven dots: "done" a logged session, "set"
// a set day still ahead, "none" otherwise.
export function routineRows(tasks = [], now = Date.now()){
  const day = dayOf(now), from = weekStart(day);
  return tasks.filter((t) => t.status !== "dropped" && cleanRoutine(t.routine)).map((t) => {
    const r = cleanRoutine(t.routine);
    const done = r.log.filter((e) => e.day >= from && e.day <= addDays(from, 6));
    const dots = Array.from({ length: 7 }, (_, i) => {
      const d = addDays(from, i);
      return { day: d, state: done.some((e) => e.day === d) ? "done" : d >= day && (r.days || []).includes(i) ? "set" : "none", today: d === day };
    });
    return { id: t.id, title: t.title, project: t.project || INBOX, per: r.per, count: done.length, met: done.length >= r.per, dots, streak: weekStreak(t, day), over: !!r.until && r.until < day };
  }).filter((r) => !r.over).sort((a, b) => Number(a.met) - Number(b.met) || a.title.localeCompare(b.title));
}

// ---------- words ----------
export function fmtMinutes(m){
  m = Math.round(m || 0);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}
const WHEN = { today: "today", week: "this week", month: "this month" };

// Daisey's one line: the most interesting true thing, never a list.
export function oneLine({ summary, flowers: fl = [], routines = [], period = "week" } = {}){
  const when = WHEN[period] || "this week";
  if (!summary || (!summary.total && !summary.done)) return period === "today" ? "Nothing planted yet today. Start any task and it shows up here." : `Nothing planted ${when} yet. Start any task and it shows up here.`;
  const top = [...fl].sort((a, b) => b.min - a.min)[0];
  const focus = fl.filter((f) => f.tier === "focus").reduce((s, f) => s + f.min, 0);
  const proj = summary.total ? `${top.name} got ${summary.guess ? "about " : ""}${fmtMinutes(top.min)} ${when}.` : `${summary.done} ${summary.done === 1 ? "task" : "tasks"} done ${when}.`;
  if (summary.total && fl.some((f) => f.tier === "focus") && focus / summary.total >= 0.5 && fl.length > 1) return `${proj} Your Focus projects had most of your time. 🌼`;
  const metAll = routines.length && routines.every((r) => r.met);
  if (metAll && period !== "today") return `${proj} Every routine is met.`;
  return proj;
}
