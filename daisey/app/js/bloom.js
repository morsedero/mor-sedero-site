// Bloom (Mor, 2026-10-08; daisey/STATS_PLAN.md): the progress page. Each
// project is a flower — taller with the time it got, a petal for every task
// finished, a closed bud when it got none. Routines under it, three small
// numbers, the week as seven little daisies. Calm on purpose: no red, no
// "behind", no goals that aren't the user's own. Read-only.
import { watchTasks, watchProjectNames, watchLog } from "./store.js";
import { fetchRange } from "./calendar.js";
import { projectsOf } from "./projects.js";
import {
  PERIODS, periodRange, monthsOfRange, summarize, flowers, routineRows, weekStrip, fmtMinutes, oneLine,
  estimatedEntries, eventEntries,
} from "./bloom-data.js";
import { h, bdi, icon } from "./ui.js";
import { dayOf, addDays } from "./routine.js";

const NS = "http://www.w3.org/2000/svg";
const svg = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.append(...kids.filter(Boolean));
  return el;
};
const PERIOD_TEXT = { today: "Today", week: "Week", month: "Month" };
const TIER_TEXT = { focus: "Focus", keep: "Keep going", background: "Background" };
const SEEN_KEY = "daisey.bloom.seen.v1";
const readSeen = () => { try { return JSON.parse(localStorage.getItem(SEEN_KEY)) || {}; } catch { return {}; } };
const writeSeen = (v) => { try { localStorage.setItem(SEEN_KEY, JSON.stringify(v)); } catch { /* private window */ } };

// One flower, 60 wide: stem up to `height`, petals around the head.
export function flowerSvg(f){
  const top = 100 - (14 + f.height * 58), cx = 30, root = svg("svg", { viewBox: "0 0 60 120", class: "bl-svg", "aria-hidden": "true" });
  root.append(svg("path", { d: `M30 118 C30 ${(118 + top) / 2} 30 ${(118 + top) / 2} 30 ${top + 6}`, class: "bl-stem" }),
    svg("path", { d: `M30 ${Math.min(top + 50, 106)} q-12 -2 -15 -12 q12 0 15 12z`, class: "bl-leaf" }));
  const head = svg("g", { class: "bl-head" });
  if (f.petals) {
    // Earned petals are filled; up to six slots show, so one task still reads as a flower.
    const slots = Math.max(f.petals, 6);
    for (let i = 0; i < slots; i++) {
      head.append(svg("ellipse", { cx, cy: top - 9, rx: slots > 8 ? 3.4 : 4.4, ry: 8.5, class: "bl-petal" + (i < f.petals ? "" : " empty"), transform: `rotate(${(i * 360) / slots} ${cx} ${top})` }));
    }
    head.append(svg("circle", { cx, cy: top, r: 5.5, class: "bl-heart" }));
  } else {
    // A bud: closed and plain with no time, in the project's tint once it has some.
    head.append(svg("ellipse", { cx, cy: top - 2, rx: 6, ry: 9, class: "bl-bud" + (f.bud ? "" : " warm") }),
      svg("path", { d: `M${cx - 6} ${top + 2} q6 6 12 0`, class: "bl-cup" }));
  }
  root.append(head);
  return root;
}

// A day's little daisy in the week row: size is that day's time.
function dayDaisy(min, peak){
  const r = min ? 5 + 7 * (min / peak) : 3.2, root = svg("svg", { viewBox: "0 0 32 32", class: "bl-day-svg" + (min ? "" : " none"), "aria-hidden": "true" });
  if (min) for (let i = 0; i < 6; i++) root.append(svg("ellipse", { cx: 16, cy: 16 - r * 0.62, rx: r * 0.34, ry: r * 0.6, class: "bl-petal", transform: `rotate(${i * 60} 16 16)` }));
  root.append(svg("circle", { cx: 16, cy: 16, r: min ? Math.max(2.2, r * 0.28) : r, class: min ? "bl-heart" : "bl-seed" }));
  return root;
}

export function mountBloom(root, uid, { onProject } = {}){
  let tasks = null, made = [], order = [], tiers = {};
  let period = "week", entries = [], events = [], open = null, shown = false;
  let unLog = null, logKey = "", evSeq = 0;
  const evCache = new Map();
  const fail = (e) => console.error("[daisey] bloom", e);

  const colorOf = () => {
    const m = new Map();
    for (const p of projectsOf(tasks || [], null, made, order)) m.set(p.name, p);
    return m;
  };

  // The calendar's past events for the period (project work Daisey never timed).
  // At most 9 days a call; kept per period so a tab switch doesn't refetch.
  async function loadEvents(){
    const range = periodRange(period), now = Date.now(), key = `${range.from}|${range.to}`, seq = ++evSeq;
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
      if (seq === evSeq) { events = got; render(); }
    } catch (e) { fail(e); }
  }

  function watchPeriod(){
    const keys = monthsOfRange(periodRange(period)).map((m) => `log-${m}`);
    if (keys.join() === logKey) return;
    unLog?.();
    logKey = keys.join();
    unLog = watchLog(uid, keys, (list) => { entries = list; render(); }, fail);
  }

  function all(range){
    const names = [...colorOf().keys()];
    const real = entries;
    return [...real, ...estimatedEntries(tasks || [], real), ...eventEntries(events, { projects: names, tasks: tasks || [], logged: real })];
  }

  function pill(p){
    return h("button", { type: "button", className: "bl-pill", role: "radio", ariaChecked: String(p === period), textContent: PERIOD_TEXT[p],
      onclick: () => { if (p === period) return; period = p; open = null; events = []; watchPeriod(); loadEvents(); render(); } });
  }

  function detail(f, info){
    const left = info?.open?.length || 0, due = (info?.open || []).map((t) => t.due).filter(Boolean).sort()[0];
    return h("div", { className: "bl-detail" + (info ? ` pc-${info.color}` : "") },
      h("div", { className: "bl-detail-top" },
        h("strong", {}, bdi(f.name)),
        h("span", { className: "bl-detail-time" }, f.min ? `${f.guess ? "~" : ""}${fmtMinutes(f.min)}` : "No time yet")),
      f.tasks.length ? h("ul", { className: "bl-tasks" }, ...f.tasks.slice(0, 8).map((t) => h("li", { className: t.done ? "done" : "" },
        h("span", { className: "bl-tick", "aria-hidden": "true" }, t.done ? "✓" : "·"), bdi(t.title || (tasks || []).find((x) => x.id === t.id)?.title || "Work"),
        t.min ? h("span", { className: "bl-min" }, fmtMinutes(t.min)) : null)))
        : h("p", { className: "bl-note" }, "Nothing here yet. Start a task in this project and it grows."),
      h("p", { className: "bl-note" }, left ? `${left} still open${due ? `, next due ${due}` : ""}.` : "Nothing left open."),
      onProject ? h("button", { type: "button", className: "bl-link", textContent: "Open project", onclick: () => onProject(f.name) }) : null);
  }

  function render(){
    if (!shown || !tasks) return;
    const range = periodRange(period), now = Date.now(), list = all(range), colors = colorOf();
    const summary = summarize(list, range), fl = flowers(summary, [...colors.keys()], tiers);
    const rows = routineRows(tasks, now), strip = weekStrip(list, now), peak = Math.max(1, ...strip.map((d) => d.min));
    const seen = readSeen(), pops = new Set();
    for (const f of fl) if (f.done > (seen[f.name] ?? f.done)) pops.add(f.name);
    if (period === "week") writeSeen(Object.fromEntries(fl.map((f) => [f.name, f.done])));

    const tierGroups = ["focus", "keep", "background"].map((t) => [t, fl.filter((f) => f.tier === t)]).filter(([, g]) => g.length);
    const bed = tierGroups.length ? h("section", { className: "bl-bed", ariaLabel: "Your projects" }, ...tierGroups.map(([t, g]) =>
      h("div", { className: `bl-tier ${t}` },
        tierGroups.length > 1 ? h("h3", { className: "bl-h", textContent: TIER_TEXT[t] }) : null,
        h("div", { className: "bl-row" }, ...g.map((f, i) => {
          const info = colors.get(f.name), cls = info ? ` pc-${info.color}` : "";
          const btn = h("button", { type: "button", className: `bl-flower${cls}${f.bud ? " bud" : ""}${pops.has(f.name) ? " pop" : ""}${open === f.name ? " on" : ""}`,
            style: `--d:-${(i * 0.9).toFixed(1)}s`, ariaExpanded: String(open === f.name),
            ariaLabel: `${f.name}: ${f.min ? fmtMinutes(f.min) : "no time yet"}, ${f.done} done`,
            onclick: () => { open = open === f.name ? null : f.name; render(); } },
          flowerSvg(f),
          h("span", { className: "bl-name" }, bdi(f.name)),
          h("span", { className: "bl-sub" }, f.min ? `${f.guess ? "~" : ""}${fmtMinutes(f.min)}` : "resting", f.more ? ` · +${f.more}` : ""));
          return btn;
        })))),
    open && fl.find((f) => f.name === open) ? detail(fl.find((f) => f.name === open), colors.get(open) && { open: colors.get(open).open, color: colors.get(open).color }) : null)
      : h("p", { className: "bl-note center" }, "Make a project and it plants itself here.");

    const routines = rows.length ? h("section", { className: "bl-routines", ariaLabel: "Routines" },
      h("h3", { className: "bl-h", textContent: "Routines" }),
      ...rows.map((r) => h("div", { className: "bl-routine" + (r.met ? " met" : "") },
        h("div", { className: "bl-r-main" },
          h("span", { className: "bl-r-title" }, bdi(r.title)),
          h("span", { className: "bl-r-count" }, `${r.count} of ${r.per}`, r.met ? h("span", { className: "bl-bee", role: "img", ariaLabel: "met" }, " 🐝") : null)),
        h("div", { className: "bl-dots", role: "img", ariaLabel: `${r.count} of ${r.per} this week` },
          ...r.dots.map((d) => h("i", { className: `${d.state}${d.today ? " today" : ""}` }))),
        r.streak >= 2 ? h("div", { className: "bl-streak" }, `${r.streak} weeks in a row`) : null))) : null;

    const tiles = h("section", { className: "bl-tiles", ariaLabel: "Totals" },
      tile(summary.total ? `${summary.guess ? "~" : ""}${fmtMinutes(summary.total)}` : "0", "focused time"),
      tile(String(summary.done), summary.done === 1 ? "task done" : "tasks done"),
      tile(String(summary.days), summary.days === 1 ? "day showed up" : "days showed up"));
    const week = h("div", { className: "bl-week", role: "img", ariaLabel: "This week, day by day" },
      ...strip.map((d) => h("div", { className: "bl-wd" + (d.today ? " today" : "") + (d.future ? " future" : "") },
        dayDaisy(d.min, peak), h("span", {}, new Date(`${d.day}T12:00`).toLocaleDateString(undefined, { weekday: "narrow" })))));

    root.replaceChildren(
      h("div", { className: "bl" },
        h("div", { className: "bl-top" },
          h("h2", { className: "bl-title" }, icon("bloom"), "Bloom"),
          h("div", { className: "bl-pills", role: "radiogroup", ariaLabel: "Period" }, ...PERIODS.map(pill))),
        h("p", { className: "bl-line" }, oneLine({ summary, flowers: fl, routines: rows, period })),
        bed, routines, tiles, week));
  }
  const tile = (n, label) => h("div", { className: "bl-tile" }, h("strong", {}, n), h("span", {}, label));

  const unsubs = [
    watchTasks(uid, (ts) => { tasks = ts; render(); }, fail),
    watchProjectNames(uid, (ns, _rs, od, tr) => { made = ns; order = od || []; tiers = tr || {}; render(); }, fail),
  ];

  return {
    show(){ shown = true; open = null; watchPeriod(); loadEvents(); render(); },
    hide(){ shown = false; unLog?.(); unLog = null; logKey = ""; },
    unmount(){ this.hide(); unsubs.forEach((u) => u()); root.replaceChildren(); },
  };
}
