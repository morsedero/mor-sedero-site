// The Now engine: read the moment → filter → score → why line.
// PURE: no Firebase, no DOM. The clock is only read as a default, and all
// dates are local time, so the node tests in daisey/test/v1/ drive it with
// fixed moments. Every number lives in weights.js.
//
// Session 3 takes window and energy as plain inputs (the ?debug panel sets
// them). Later sessions fill the rest of the moment: calendar (8), energy
// guess (9), learned fit (10). Until then those parts score 0.
import * as W from "./weights.js";
import { toEnergy, localDate } from "./model.js";

const MIN = 60000;
const DAY = 86400000;
const LEVEL = { low: 0, medium: 1, high: 2 };
const FACTORS = ["urgency", "energy", "window", "momentum", "neglect", "learned"]; // why-line tie order
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const projectKey = (p) => String(p || "").trim().toLowerCase();

// ---------- step 1: the moment ----------

export function timeBucket(now = Date.now()){
  const d = new Date(now), h = d.getHours();
  return {
    part: h < W.AFTERNOON_FROM ? "morning" : h < W.EVENING_FROM ? "afternoon" : "evening",
    weekend: W.WEEKEND_DAYS.includes(d.getDay()),
  };
}

// Everything the engine knows about right now. All optional:
//   window          free minutes (no calendar yet → 60), capped at 180
//   energy          "low" | "medium" | "high" (→ medium)
//   lastProject     project last started or finished today
//   recentProjects  projects worked on in the last 2 days
//   sessionSkips    ids hidden by Not now this session
//   skipsToday      { id: count } — the skip penalty
//   learned         (task, moment) → −10…10, session 10
//   nextEvent       title of the next calendar event, session 8
export function readMoment(input = {}){
  const now = input.now ?? Date.now();
  const w = Number(input.window);
  return {
    now,
    today: localDate(now),
    window: clamp(Number.isFinite(w) && input.window !== "" && input.window != null ? Math.round(w) : W.NO_CALENDAR_WINDOW, 0, W.WINDOW_CAP),
    energy: toEnergy(input.energy) || "medium",
    bucket: timeBucket(now),
    lastProject: input.lastProject || null,
    recentProjects: (input.recentProjects || []).map(projectKey),
    sessionSkips: new Set(input.sessionSkips || []),
    skipsToday: input.skipsToday || {},
    learned: input.learned || null,
    nextEvent: input.nextEvent || null,
  };
}

// ---------- step 2: filter ----------

// Why a task can't be offered right now, or null if it can.
export function filterOut(task, m){
  if (task.status === "done") return "done";
  if (task.status === "waiting") return "waiting";
  if ((task.skipsSinceStart || 0) >= W.STALE_SKIPS) return "stale";
  if (m.sessionSkips.has(task.id)) return "skipped";
  if (task.energy === "high" && m.energy === "low") return "energy";
  if (task.size > m.window && !(task.canSplit && m.window >= W.SPLIT_MIN_WINDOW)) return "size";
  return null;
}

// ---------- urgency (with the computed hard due) ----------

const dateParts = (s) => s.split("-").map(Number);

export function daysUntil(due, now){
  const [y, mo, d] = dateParts(due), [ty, tm, td] = dateParts(localDate(now));
  return Math.round((Date.UTC(y, mo - 1, d) - Date.UTC(ty, tm - 1, td)) / DAY);
}

export function dueAt(task){
  const [y, mo, d] = dateParts(task.due);
  const [hh, mm] = task.dueTime ? task.dueTime.split(":").map(Number) : [W.TIGHT.dayEnd, 0];
  return new Date(y, mo - 1, d, hh, mm).getTime();
}

// Waking minutes (dayStart–dayEnd each day) between two moments.
export function wakingMinutes(from, to){
  let total = 0;
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  for (let i = 0; d.getTime() < to && i < 800; i++) {
    const start = new Date(d).setHours(W.TIGHT.dayStart, 0, 0, 0);
    const end = new Date(d).setHours(W.TIGHT.dayEnd, 0, 0, 0);
    total += Math.max(0, Math.min(end, to) - Math.max(start, from));
    d.setDate(d.getDate() + 1);
  }
  return total / MIN;
}

// A due is hard when overdue, or when the time one task can get before it is
// less than MARGIN × what it still needs.
export function isTight(task, now){
  if (!task.due) return false;
  const at = dueAt(task);
  if (now >= at) return true;
  const needs = Math.max((task.size || 0) - (task.spentMinutes || 0), W.TIGHT.minLeft);
  return wakingMinutes(now, at) * W.TIGHT.share < needs * W.TIGHT.margin;
}

function urgency(task, m){
  if (!task.due) return { points: W.URGENCY.none, detail: null };
  const days = daysUntil(task.due, m.now);
  const overdue = days < 0 || (days === 0 && !!task.dueTime && m.now >= dueAt(task));
  const hard = overdue || isTight(task, m.now);
  const detail = { days, overdue, hard };
  const u = W.URGENCY;
  const points = hard ? (days <= 0 ? u.hardToday : u.hardSoon)
    : days === 0 ? u.softToday : days <= 3 ? u.within3 : days <= 7 ? u.within7 : u.none;
  return { points, detail };
}

// ---------- step 3: score ----------

function energyFit(task, m){
  const gap = LEVEL[task.energy ?? "medium"] - LEVEL[m.energy];
  const fit = gap === 0 ? "same" : gap === -1 ? "easier" : gap < -1 ? "muchEasier" : "harder";
  return { points: W.ENERGY_FIT[fit], detail: { fit, task: task.energy, you: m.energy } };
}

function windowFit(task, m){
  const r = m.window > 0 ? task.size / m.window : Infinity;
  const fit = r > 1 ? "piece" : r >= 0.5 ? "full" : r >= 0.25 ? "half" : "small";
  return { points: W.WINDOW_FIT[fit], detail: { fit, window: m.window, nextEvent: m.nextEvent } };
}

function momentum(task, m){
  const p = projectKey(task.project);
  if (m.lastProject && p === projectKey(m.lastProject)) return { points: W.MOMENTUM.lastToday, detail: { kind: "today" } };
  if (m.recentProjects.includes(p)) return { points: W.MOMENTUM.recent, detail: { kind: "recent" } };
  return { points: 0, detail: null };
}

function neglect(task, m){
  const days = Math.max(0, Math.floor((m.now - (task.touchedAt ?? m.now)) / DAY));
  return { points: Math.min(W.NEGLECT_MAX, days * W.NEGLECT_PER_DAY), detail: { days } };
}

function learned(task, m){
  const v = m.learned ? Number(m.learned(task, m)) || 0 : 0;
  return { points: clamp(Math.round(v), W.LEARNED_MIN, W.LEARNED_MAX), detail: { bucket: m.bucket.part } };
}

// Score parts, total and the details the why line needs.
export function scoreTask(task, m){
  const f = { urgency: urgency(task, m), energy: energyFit(task, m), window: windowFit(task, m),
    momentum: momentum(task, m), neglect: neglect(task, m), learned: learned(task, m) };
  const parts = Object.fromEntries(FACTORS.map((k) => [k, f[k].points]));
  const details = Object.fromEntries(FACTORS.map((k) => [k, f[k].detail]));
  parts.skips = -W.SKIP_PENALTY * (m.skipsToday[task.id] || 0);
  const score = Object.values(parts).reduce((a, b) => a + b, 0);
  return { task, score, parts, details };
}

// Higher score first; tie → sooner due, then smaller size, then older.
export function compare(a, b){
  const due = (s) => (s.task.due ? dueAt(s.task) : Infinity);
  return b.score - a.score || due(a) - due(b) || a.task.size - b.task.size
    || (a.task.createdAt || 0) - (b.task.createdAt || 0);
}

// ---------- why line ----------

function dueWords(task, days){
  const [y, mo, d] = dateParts(task.due);
  const when = days === 0 ? "today" + (task.dueTime ? " " + task.dueTime : "")
    : days === 1 ? "tomorrow"
    : days < 7 ? DAY_NAMES[new Date(y, mo - 1, d).getDay()]
    : `${MONTHS[mo - 1]} ${d}`;
  return "due " + when;
}

const sizeWords = (n) => n === 60 ? "hour" : n > 60 ? `${+(n / 60).toFixed(1)} h` : `${n} min`;

const PHRASES = {
  urgency: (s, d) => d.overdue ? "overdue" : dueWords(s.task, d.days) + (d.hard ? ", getting tight" : ""),
  energy: (s, d) => d.fit === "same"
    ? { low: "light one, you're low", medium: "matches your energy", high: "good for high energy" }[d.you]
    : d.fit === "harder" ? null : "easy on your energy",
  window: (s, d) => d.fit === "small" ? "quick one"
    : d.fit === "piece" ? `a piece fits your ${sizeWords(d.window)}`
    : d.nextEvent ? `fits before ${d.nextEvent}`
    : d.fit === "full" ? `fills your free ${sizeWords(d.window)}` : `fits your ${sizeWords(d.window)}`,
  momentum: (s, d) => d.kind === "today" ? `keeps ${s.task.project} going` : `back to ${s.task.project}`,
  neglect: (s, d) => `untouched for ${d.days} days`,
  learned: (s, d) => s.parts.learned > 0 ? `you usually do these in the ${d.bucket}` : null,
};

// The two or three factors that gave the most points, as one sentence.
export function whyLine(s){
  const phrases = FACTORS
    .filter((k) => s.parts[k] >= W.WHY_MIN_POINTS)
    .sort((a, b) => s.parts[b] - s.parts[a] || FACTORS.indexOf(a) - FACTORS.indexOf(b))
    .map((k) => PHRASES[k](s, s.details[k]))
    .filter(Boolean)
    .slice(0, W.WHY_PARTS);
  if (!phrases.length) return "";
  const line = phrases.join(", ");
  return line[0].toUpperCase() + line.slice(1) + ".";
}

// ---------- Something else ----------

// The next few by score, but no two from one project while another project
// scores within VARIETY_WITHIN of the next in line. The top pick's project
// counts as already shown.
export function somethingElse(ranked, count = W.ALTERNATIVES){
  if (!ranked.length) return [];
  const used = new Set([projectKey(ranked[0].task.project)]);
  const pool = ranked.slice(1), out = [];
  while (out.length < count && pool.length) {
    const next = pool[0];
    const choice = used.has(projectKey(next.task.project))
      ? pool.find((s) => !used.has(projectKey(s.task.project)) && s.score >= next.score - W.VARIETY_WITHIN) || next
      : next;
    out.push(choice);
    used.add(projectKey(choice.task.project));
    pool.splice(pool.indexOf(choice), 1);
  }
  return out;
}

// ---------- the whole pass ----------

// pick: the card. alternatives: Something else. ranked: every offerable task
// in order. out: open tasks filtered out, with the reason. stale: tasks to
// ask "keep, shrink, or drop?" about. empty: "none" (no open tasks — invite
// a brain dump) or "nofit" (nothing fits — take the break), else null.
export function rank(tasks, input = {}){
  const m = readMoment(input);
  const ranked = [], out = [];
  for (const t of tasks) {
    const reason = filterOut(t, m);
    if (reason === "done") continue;
    if (reason) out.push({ task: t, reason });
    else ranked.push(scoreTask(t, m));
  }
  ranked.sort(compare);
  for (const s of ranked) s.why = whyLine(s);
  const pick = ranked[0] || null;
  return {
    moment: m,
    pick,
    alternatives: somethingElse(ranked),
    ranked,
    out,
    stale: out.filter((o) => o.reason === "stale").map((o) => o.task),
    empty: pick ? null : out.length ? "nofit" : "none",
  };
}
