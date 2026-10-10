// Bloom, inside Projects (Mor, 2026-10-08: "both become one page";
// daisey/STATS_PLAN.md). The Projects page is the garden now: each project
// card carries its flower — taller with the time it got this period, a petal
// for every task finished, a closed bud when it got none — and the routines
// sit above the tiers. This file is the
// growing half: the work log, the calendar's past events, the period, and the
// pieces drawn from them. projects.js lays them out. Calm on purpose: no red,
// no "behind", no goals that aren't the user's own.
import { watchLog } from "./store.js";
import { fetchRange } from "./calendar.js";
import {
  PERIODS, periodRange, monthsOfRange, summarize, flowers, routineRows, fmtMinutes, oneLine,
  estimatedEntries, eventEntries,
} from "./bloom-data.js";
import { h, bdi, weekDots } from "./ui.js";

const NS = "http://www.w3.org/2000/svg";
const svg = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.append(...kids.filter(Boolean));
  return el;
};
const SEEN_KEY = "daisey.bloom.seen.v1";
const readSeen = () => { try { return JSON.parse(localStorage.getItem(SEEN_KEY)) || {}; } catch { return {}; } };
const writeSeen = (v) => { try { localStorage.setItem(SEEN_KEY, JSON.stringify(v)); } catch { /* private window */ } };

// One flower, 60 wide: stem up to `height`, petals around the head.
export function flowerSvg(f){
  // Ground at y 120; the head sits 26-100 above it by the project's time.
  // The viewBox is cropped to the flower, so a short one takes short space.
  const top = 120 - (26 + f.height * 74), cx = 30;
  const root = svg("svg", { viewBox: `0 ${top - 22} 60 ${148 - top}`, width: 60, height: Math.round(148 - top), class: "bl-svg", "aria-hidden": "true" });
  root.append(svg("ellipse", { cx, cy: 122, rx: 17, ry: 3.5, class: "bl-soil" }),
    svg("path", { d: `M30 121 C29 ${top + (120 - top) * 0.6} 31 ${top + (120 - top) * 0.3} 30 ${top + 4}`, class: "bl-stem" }));
  if (120 - top > 40) {
    const y = top + (120 - top) * 0.62;
    root.append(svg("path", { d: `M30 ${y} q-13 -1 -16 -11 q12 -1 16 11z`, class: "bl-leaf" }));
  }
  const head = svg("g", { class: "bl-head" });
  if (f.petals) {
    // Earned petals are filled; up to six slots show, so one task still reads as a flower.
    const slots = Math.max(f.petals, 6), rx = slots > 8 ? 4 : 5.4;
    for (let i = 0; i < slots; i++) {
      head.append(svg("ellipse", { cx, cy: top - 10, rx, ry: 10, class: "bl-petal" + (i < f.petals ? "" : " empty"), transform: `rotate(${(i * 360) / slots} ${cx} ${top})` }));
    }
    head.append(svg("circle", { cx, cy: top, r: 6.5, class: "bl-heart" }));
  } else {
    // A bud: closed and plain with no time, in the project's tint once it has some.
    head.append(svg("ellipse", { cx, cy: top - 3, rx: 7, ry: 10, class: "bl-bud" + (f.bud ? "" : " warm") }),
      svg("path", { d: `M${cx - 7} ${top + 1} q7 7 14 0`, class: "bl-cup" }));
  }
  root.append(head);
  return root;
}

// A project's time for the period, "" when it got none.
export const flowerTime = (f) => (f?.min ? `${f.guess ? "~" : ""}${fmtMinutes(f.min)}` : "");

// The growing half. onChange: the log, the events or the period moved, so
// the page should redraw.
export function mountGrowth(uid, { onChange } = {}){
  // Week only (Mor, 2026-10-10: the Week/Month switch is gone).
  const period = "week";
  let entries = [], events = [], shown = false;
  let unLog = null, logKey = "", evSeq = 0;
  const evCache = new Map();
  const fail = (e) => console.error("[daisey] bloom", e);
  // The period plus this week: the week row shows under any period.
  const span = () => {
    const p = periodRange(period), w = periodRange("week");
    return { from: p.from < w.from ? p.from : w.from, to: p.to > w.to ? p.to : w.to };
  };

  // The calendar's past events for the span (project work Daisey never timed).
  // At most 9 days a call; kept per span so a period switch doesn't refetch.
  async function loadEvents(){
    const range = span(), now = Date.now(), key = `${range.from}|${range.to}`, seq = ++evSeq;
    const cached = evCache.get(key);
    if (cached && now - cached.at < 5 * 60000) { events = cached.events; return; }
    try {
      const from = new Date(`${range.from}T00:00:00`).getTime(), to = Math.min(now, new Date(`${range.to}T23:59:59`).getTime());
      const got = [];
      for (let a = from; a < to; a += 9 * 864e5) {
        const r = await fetchRange(a, Math.min(to, a + 9 * 864e5));
        if (r.status !== "ok") return;
        got.push(...r.events);
      }
      evCache.set(key, { at: now, events: got });
      if (seq === evSeq) { events = got; onChange?.(); }
    } catch (e) { fail(e); }
  }

  function watchPeriod(){
    const keys = monthsOfRange(span()).map((m) => `log-${m}`);
    if (keys.join() === logKey) return;
    unLog?.();
    logKey = keys.join();
    unLog = watchLog(uid, keys, (list) => { entries = list; onChange?.(); }, fail);
  }

  // What the page shows: tasks, the project names, their tiers by name.
  function read(tasks = [], names = [], tiers = {}){
    const range = periodRange(period), now = Date.now();
    const list = [...entries, ...estimatedEntries(tasks, entries), ...eventEntries(events, { projects: names, tasks, logged: entries })];
    const summary = summarize(list, range), fl = flowers(summary, names, tiers);
    const routines = routineRows(tasks, now);
    // A flower with more done than last time it was seen opens once.
    const seen = readSeen(), pops = new Set();
    // Pops only on Week, the period `seen` is kept for: Month's bigger counts
    // would pop every flower on each switch.
    if (period === "week") for (const f of fl) if (f.done > (seen[f.name] ?? f.done)) pops.add(f.name);
    if (shown && period === "week") writeSeen(Object.fromEntries(fl.map((f) => [f.name, f.done])));
    return { period, summary, routines, pops,
      flowers: new Map(fl.map((f) => [f.name, f])), line: oneLine({ summary, flowers: fl, routines, period }) };
  }

  return {
    read,
    show(){ if (shown) return; shown = true; watchPeriod(); loadEvents(); },
    hide(){ shown = false; unLog?.(); unLog = null; logKey = ""; },
    unmount(){ this.hide(); },
  };
}

// The week's numbers, in the avatar menu (Mor, 2026-10-10: off the Projects
// page, week only). Three quiet figures in one box, like the theme switch
// beside them; a bee line once a routine has a streak.
export function statsCard(g){
  const s = g.summary, best = g.routines.filter((r) => r.streak >= 2).sort((a, b) => b.streak - a.streak)[0];
  const fig = (v, word) => h("div", { className: "ms-fig" }, h("strong", {}, v), h("span", {}, word));
  return [
    h("p", { className: "ms-h", textContent: "This week" }),
    h("div", { className: "ms-figs" },
      fig(s.total ? `${s.guess ? "~" : ""}${fmtMinutes(s.total)}` : "0", "focused"),
      fig(String(s.done), "done"),
      fig(String(s.days), s.days === 1 ? "day" : "days")),
    best && h("p", { className: "ms-line" }, h("span", { ariaHidden: "true", textContent: "🐝" }), bdi(best.title), ` · ${best.streak} weeks in a row`),
  ].filter(Boolean);
}

// Routines, minimal (Mor, 2026-10-08): one quiet line each in one card —
// the project's colour dot, the title, the week's dots, a bee once met.
// colors: project name -> its colour ("" when none).
export function routinesSection(rows, tasks, colors){
  if (!rows.length) return null;
  return h("section", { className: "bl-card bl-routines", ariaLabel: "Routines" },
    // Dots alone didn't read when empty (Mor, 2026-10-08): "this week" on the
    // header, the count in words beside each row's dots.
    h("h3", { className: "bl-h" }, "Routines", h("span", { className: "bl-h-sub", textContent: " · this week" })),
    ...rows.map((r) => h("div", { className: "bl-routine" + (r.met ? " met" : "") + (colors.get(r.project) ? ` pc-${colors.get(r.project)}` : ""),
      title: `${r.project} · ${r.count} of ${r.per}${r.streak >= 2 ? ` · ${r.streak} weeks in a row` : ""}` },
      h("span", { className: "bl-r-dot", ariaHidden: "true" }),
      h("span", { className: "bl-r-title" }, bdi(r.title)),
      h("span", { className: "bl-dots", ariaLabel: `${r.count} of ${r.per} this week` }, weekDots(tasks.find((t) => t.id === r.id)),
        h("span", { className: "bl-r-n", ariaHidden: "true", textContent: `${r.count}/${r.per}` })),
      h("span", { className: "bl-bee", ariaHidden: "true" }, r.met ? "🐝" : ""))));
}
