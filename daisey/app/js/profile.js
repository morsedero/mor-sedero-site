// What Daisey learns about you from the PC tracker (2026-11-15). The tracker
// (daisey-now-tracker, activity.js) sees which apps and projects you really
// worked in, minute by minute. Until now that only fed the Activity screen;
// the planner guessed your day from task sizes and a few start/skip counters.
// This turns the last two weeks of it into numbers the planner can use:
//
//   focus      minutes of real work per hour of the day (weekday-aware once a
//              weekday has enough days): where deep work belongs.
//   capacity   a typical day's real work minutes (the median): how much a plan
//              should ask of one day, whatever the calendar leaves free.
//   size       real minutes ÷ the size you gave, per project (from finished
//              tasks' logged time, else the tracker's minutes on that project):
//              "Mix review" takes 1.4× what you say, so it's planned that long.
//   switchCost how often you hop between projects (0..1): how much a run in
//              one project is worth.
//
// PURE: no DOM, no Firebase, no fetch. Give it the days (the shape
// daisey-now-tracker's `read` returns: { "YYYY-MM-DD": [summary per PC] }, or
// one summary per date) and the tasks. Every function answers null / 1 /
// false with too little data, so the planner falls back to what it did before.
import * as W from "./weights.js";

const P = W.PROFILE;
const DAY_MIN = 1440;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const median = (xs) => { const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const norm = (s) => String(s || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

// Apps and sites that aren't work. Everything else the tracker saw counts:
// it can't tell a mix from an email, but both are the desk.
const LEISURE_APPS = new Set(["spotify", "discord", "steam", "vlc", "whatsapp", "whatsapp.root", "microsoft.media.player", "netflix", "epicgameslauncher", "telegram"]);
const LEISURE_SITES = /\b(youtube|netflix|facebook|instagram|tiktok|reddit|twitch|twitter|9gag|primevideo|disneyplus)\b|(^|\s)x\.com\b/i;
const BROWSERS = new Set(["chrome", "msedge", "firefox", "brave", "opera", "vivaldi", "arc"]);
const appKey = (app) => String(app || "").replace(/\.exe$/i, "").toLowerCase();
export const isWork = (app, detail = "") => {
  const a = appKey(app);
  if (LEISURE_APPS.has(a)) return false;
  return !(BROWSERS.has(a) && LEISURE_SITES.test(String(detail || "")));
};

// One day's work as minutes: Map<minute since the date's midnight (06:00 is
// 360; 01:00 the next night is 1500), { app, det }>. Several PCs share it: a
// minute used on two counts once.
function marksOf(parts){
  const marks = new Map();
  for (const d of Array.isArray(parts) ? parts : parts ? [parts] : []) {
    const off = typeof d?.dayStartMinute === "number" ? d.dayStartMinute : 0;
    for (const r of Array.isArray(d?.timeline) ? d.timeline : []) {
      if (!Array.isArray(r) || typeof r[0] !== "number" || typeof r[1] !== "number" || !(r[1] > r[0]) || typeof r[2] !== "string") continue;
      if (!isWork(r[2], r[3])) continue;
      const det = typeof r[3] === "string" ? r[3] : "";
      for (let m = Math.floor(r[0] + off); m < Math.ceil(r[1] + off); m++) if (!marks.has(m)) marks.set(m, { app: r[2], det });
    }
  }
  return marks;
}

// Project hops in one day: a change of project (the tracker's guess at it, app
// windows only — a browser's detail is a site) between stretches of 3+ minutes
// with under 15 idle between them.
function hopsOf(marks){
  const mins = [...marks.keys()].sort((a, b) => a - b);
  const runs = [];
  for (const m of mins) {
    const { app, det } = marks.get(m), k = BROWSERS.has(appKey(app)) ? "" : norm(det), last = runs[runs.length - 1];
    if (last && last.k === k && m - last.e <= 2) last.e = m; else runs.push({ k, s: m, e: m });
  }
  let hops = 0, cur = null, end = null;
  for (const r of runs.filter((x) => x.e - x.s + 1 >= 3 && x.k)) {
    if (end != null && r.s - end >= 15) cur = null;
    if (cur != null && r.k !== cur) hops++;
    cur = r.k; end = r.e;
  }
  return hops;
}

const dowOf = (date) => { const [y, m, d] = String(date).split("-").map(Number); return new Date(y, m - 1, d).getDay(); };
const smooth = (hrs) => hrs.map((_, i) => P.smooth[0] * hrs[(i + 23) % 24] + P.smooth[1] * hrs[i] + P.smooth[2] * hrs[(i + 1) % 24]);
const avg = (rows) => Array.from({ length: 24 }, (_, h) => rows.reduce((a, r) => a + r[h], 0) / (rows.length || 1));

// days: { date: summaries }. tasks: all of the user's (done ones teach size).
// today: the logical date now ("YYYY-MM-DD", from model.logicalDate): that
// day is partial, so it counts toward `worked` and nothing else.
// → profile, or { ok: false } when there's too little to say anything.
export function buildProfile({ days = {}, tasks = [], today = null, now = Date.now() } = {}){
  const rows = [];
  let worked = 0;
  for (const [date, parts] of Object.entries(days || {})) {
    const marks = marksOf(parts);
    if (date === today) { worked = marks.size; continue; }
    if (marks.size < P.minActive) continue;
    const hours = Array(24).fill(0), proj = new Map();
    for (const [m, { det }] of marks) {
      hours[Math.floor((m % DAY_MIN) / 60)]++;
      const k = norm(det); if (k) proj.set(k, (proj.get(k) || 0) + 1);
    }
    rows.push({ date, dow: dowOf(date), minutes: marks.size, hours, proj, hops: hopsOf(marks) });
  }
  if (rows.length < P.minDays) return { ok: false, days: rows.length, worked };

  const byDow = {};
  for (const r of rows) (byDow[r.dow] ||= []).push(r);
  const focus = { all: smooth(avg(rows.map((r) => r.hours))), dow: {} };
  const capacity = { all: median(rows.map((r) => r.minutes)), dow: {} };
  for (const [d, rs] of Object.entries(byDow)) {
    if (rs.length < P.dowMinDays) continue;
    focus.dow[d] = smooth(avg(rs.map((r) => r.hours)));
    capacity.dow[d] = median(rs.map((r) => r.minutes));
  }
  const hours = rows.reduce((a, r) => a + r.minutes, 0) / 60;
  const switchCost = hours >= P.switchMinHours ? clamp(rows.reduce((a, r) => a + r.hops, 0) / hours / P.switchPerHour, 0, 1) : 0;
  const tracker = new Map();
  for (const r of rows) for (const [k, n] of r.proj) tracker.set(k, (tracker.get(k) || 0) + n);
  return { ok: true, days: rows.length, worked, focus, capacity, switchCost, size: sizeFactors(tasks, tracker, now), tracker };
}

// ---------- size: real minutes against the guess, per project ----------
// A project's key matches a tracker name when they are the same words, or one
// holds the other as whole words (4+ letters: "Monster Punk" ↔ "monster-punk").
export const sameProject = (a, b) => {
  const x = norm(a), y = norm(b);
  if (!x || !y) return false;
  return x === y || (Math.min(x.length, y.length) >= 4 && (` ${x} `.includes(` ${y} `) || ` ${y} `.includes(` ${x} `)));
};
function sizeFactors(tasks, tracker, now){
  const since = now - P.sizeDays * 86400000, by = new Map();
  for (const t of tasks) {
    if (t.status !== "done" || !t.project || t.routine || !(t.size > 0) || !(t.doneAt >= since)) continue;
    const k = norm(t.project), e = by.get(k) || { ratios: [], sizes: 0, n: 0 };
    e.n++; e.sizes += t.size;
    if (t.spentMinutes > 0) e.ratios.push(t.spentMinutes / t.size);
    by.set(k, e);
  }
  const out = {};
  for (const [k, e] of by) {
    let r = null, n = 0;
    if (e.ratios.length >= P.sizeSamples) { r = median(e.ratios); n = e.ratios.length; }
    else if (e.n >= P.sizeSamples) {
      const mins = [...tracker].filter(([name]) => sameProject(name, k)).reduce((a, [, v]) => a + v, 0);
      if (mins >= P.sizeTrackerMin) { r = mins / e.sizes; n = e.n; }
    }
    if (r == null || !isFinite(r)) continue;
    const f = clamp(1 + (r - 1) * n / (n + 2), P.sizeClamp[0], P.sizeClamp[1]);
    if (Math.abs(f - 1) >= P.sizeNoise) out[k] = Math.round(f * 100) / 100;
  }
  return out;
}

// ---------- what the planner asks ----------
const hourOf = (ms) => new Date(ms).getHours();
const curveAt = (p, ms) => p?.focus && (p.focus.dow[new Date(ms).getDay()] || p.focus.all);

// 0..1: how much of your busiest hour's work this hour usually holds. null
// when there's no profile (or no work at all, which says nothing).
export function focusLevel(p, ms){
  const c = p?.ok && curveAt(p, ms);
  if (!c) return null;
  const top = Math.max(...c);
  return top >= 5 ? clamp(c[hourOf(ms)] / top, 0, 1) : null;
}
// "peak" in your busiest hours, "low" in the thin ones, else null.
export const focusBand = (p, ms) => { const l = focusLevel(p, ms); return l == null ? null : l >= W.FOCUS.peak ? "peak" : l <= W.FOCUS.low ? "low" : null; };

// How deep a task is, 0 (quick) .. 1 (deep): by the minutes it needs; a deep
// type reads at least 0.8, a call or admin at most 0.3.
export function depthOf(task, minutes){
  const F = W.FOCUS, m = minutes ?? task?.size ?? 30;
  let d = clamp((m - F.quickTo) / (F.deepFrom - F.quickTo), 0, 1);
  if (task?.type === "deep") d = Math.max(d, 0.8);
  else if (["call", "admin", "errand"].includes(task?.type)) d = Math.min(d, 0.3);
  return d;
}

// Points for putting this task at this moment: deep work in a peak hour,
// quick work in a thin one; the reverse costs. 0 without a profile.
export function focusFit(p, task, ms, minutes){
  const lvl = focusLevel(p, ms);
  if (lvl == null || task?.routine) return 0;
  const centred = (depthOf(task, minutes) - 0.4) / 0.6; // -0.67 quick .. 1 deep
  return Math.round(W.FOCUS.points * (lvl - 0.5) * 2 * centred);
}

// A day's capacity: the weekday's median real work (the overall median with
// too few of that weekday), stretched, never under the floor. null: no profile.
export function capacityFor(p, ms){
  if (!p?.ok) return null;
  const c = p.capacity.dow[new Date(ms).getDay()] ?? p.capacity.all;
  return Math.round(Math.max(P.floor, c * P.stretch));
}
// What's left of it: less what the tracker saw today so far, never under
// `left` (a day already full still takes a light finish). null: no profile.
export function capacityLeft(p, ms){
  const c = capacityFor(p, ms);
  return c == null ? null : Math.max(P.left, c - (p.worked || 0));
}

// The size factor for this task's project: 1 when nothing is known.
export function sizeFactor(p, task){
  if (!p?.ok || !task?.project || task.routine) return 1;
  return p.size[norm(task.project)] ?? 1;
}
// The minutes to plan for it: what's left, times the factor, on a round five.
export function estimate(p, task, left){
  const f = sizeFactor(p, task);
  return f === 1 ? left : Math.max(5, Math.round(left * f / 5) * 5);
}

// The one-line "why here" for a task laid at `ms`, from the profile alone:
// "peak" (deep work in your focus hours), "low" (a quick one in a thin hour),
// "pace" (planned longer/shorter than you said, from real times) or null.
export function whyHere(p, task, ms, minutes){
  if (!p?.ok || !task || task.routine) return null;
  const band = focusBand(p, ms), d = depthOf(task, minutes);
  if (band === "peak" && d >= 0.7) return "peak";
  if (band === "low" && d <= 0.3) return "low";
  return null;
}
