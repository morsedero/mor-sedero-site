// The visual pieces the redesign shares (DAISEY_SPEC "Visual design"): the
// daisy, the area colours, the greeting and the free-time line. No state,
// nothing at import time touches the DOM (focus.js is imported by node tests).
import { localDate, logicalDate, LABELS, AREAS } from "./model.js";
import { weekStart, cleanRoutine } from "./routine.js";

const NS = "http://www.w3.org/2000/svg";
const svgEl = (tag, attrs = {}) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
};

// One petal per one-off task done, max 8, and never an empty slot: however
// many there are, they spread evenly round the heart, so any count reads as
// a whole flower rather than one with gaps.
const petalRing = (n) => {
  const g = svgEl("g", { class: "daisy-petals" });
  for (let i = 0; i < n; i++) {
    g.append(svgEl("ellipse", { cx: 20, cy: 9, rx: 4.2, ry: 8, transform: `rotate(${(360 / n) * i} 20 20)` }));
  }
  return g;
};
export function daisy(petals, { size = 30, cls = "daisy" } = {}){
  const n = Math.max(0, Math.min(8, petals | 0));
  const svg = svgEl("svg", { viewBox: "0 0 40 40", width: size, height: size, class: cls, "aria-hidden": "true" });
  svg.append(petalRing(n), svgEl("circle", { cx: 20, cy: 20, r: 6.5, class: "daisy-heart" }));
  return svg;
}

// Stats' flower on its stalk (Mor, 2026-10-19): petals for one-off things
// done, and a leaf off the stalk for each routine session. `leaves` are keys
// (strings); a leaf's side, height, size and tilt come from its own key, so
// it never moves when another leaf is added or the page repaints. Same
// flower as daisy(), same coordinates, in a taller box.
const LEAF_MAX = 14;
function seeded(key){ // mulberry32 over an FNV-1a hash of the key
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; // keys differ in their last characters: mix them through
  return () => {
    h = (h + 0x6D2B79F5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function stalkDaisy(petals, leaves = [], { size = 96, cls = "daisy" } = {}){
  const n = Math.max(0, Math.min(8, petals | 0));
  const svg = svgEl("svg", { viewBox: "-8 0 56 72", width: Math.round(size * 56 / 72), height: size, class: cls, "aria-hidden": "true" });
  svg.append(svgEl("path", { d: "M20 26 C 20 40, 21 56, 20 71", class: "stem" }));
  for (const key of leaves.slice(0, LEAF_MAX)) {
    const rnd = seeded(String(key)), side = rnd() < 0.5 ? -1 : 1;
    const y = 36 + rnd() * 30, k = 0.7 + rnd() * 0.7, tilt = (rnd() - 0.5) * 30;
    svg.append(svgEl("path", { d: "M0 0 C 5 -4, 11 -4, 15 -8 C 12 0, 6 4, 0 0z", class: "leaf",
      transform: `translate(20 ${y.toFixed(1)}) rotate(${tilt.toFixed(1)}) scale(${side * k} ${k.toFixed(2)})` }));
  }
  svg.append(petalRing(n), svgEl("circle", { cx: 20, cy: 20, r: 6.5, class: "daisy-heart" }));
  return svg;
}

// One key per routine session logged this week (Sunday on), for stalkDaisy.
export const routineLeaves = (tasks = [], now = Date.now()) => {
  const from = weekStart(logicalDate(now)), to = logicalDate(now), out = [];
  for (const t of tasks) {
    const r = cleanRoutine(t.routine);
    if (!r) continue;
    r.log.filter((e) => e.day >= from && e.day <= to).forEach((e, i) => out.push(`${t.id}:${e.day}:${i}`));
  }
  return out.sort();
};

// The empty state's daisy on a stem, which sways (CSS).
export function stemDaisy(){
  const svg = svgEl("svg", { viewBox: "0 0 40 48", width: 64, height: 76, class: "stem-daisy", "aria-hidden": "true" });
  svg.append(svgEl("path", { d: "M20 26 C 20 34, 22 40, 20 47", class: "stem" }),
    svgEl("path", { d: "M21 38 C 26 35, 29 36, 31 33 C 27 33, 24 34, 21 38z", class: "leaf" }));
  const g = svgEl("g", { class: "daisy-petals" });
  for (let i = 0; i < 6; i++) g.append(svgEl("ellipse", { cx: 20, cy: 7, rx: 3.6, ry: 6.5, transform: `rotate(${i * 60} 20 16)` }));
  svg.append(g, svgEl("circle", { cx: 20, cy: 16, r: 5, class: "daisy-heart" }));
  return svg;
}

// Nothing fits the time (design round 4, 2026-10-18): a small sprout, two
// leaves, not yet a flower.
export function sprout(){
  const svg = svgEl("svg", { viewBox: "0 0 40 40", width: 76, height: 76, class: "sprout", "aria-hidden": "true" });
  svg.append(svgEl("path", { d: "M20 36 C 20 28, 20 24, 20 18", class: "stem" }),
    svgEl("path", { d: "M20 24 C 13 24, 9 19, 9 13 C 15 13, 20 17, 20 24z", class: "leaf" }),
    svgEl("path", { d: "M20 20 C 26 20, 31 16, 31 10 C 25 10, 20 14, 20 20z", class: "leaf" }),
    svgEl("path", { d: "M12 36 H 28", class: "ground" }));
  return svg;
}

// Night: a moon with a sleeping daisy in front of it.
export function moonDaisy(){
  const svg = svgEl("svg", { viewBox: "0 0 40 40", width: 96, height: 96, class: "moon-daisy", "aria-hidden": "true" });
  svg.append(svgEl("path", { d: "M29 6a10 10 0 1 0 5 15A8 8 0 0 1 29 6z", class: "moon" }));
  const g = svgEl("g", { class: "daisy-petals" });
  for (const r of [-60, 0, 60]) g.append(svgEl("ellipse", { cx: 14, cy: 26, rx: 3, ry: 5.5, transform: `rotate(${r} 14 30)` }));
  svg.append(g, svgEl("circle", { cx: 14, cy: 30, r: 3.6, class: "daisy-heart" }));
  return svg;
}

// Each project's colour, as the Projects page assigned it (projects.js
// colorize). A task wears its project's colour so the card and the project
// match (Mor, 2026-10-06); the Projects page publishes, cards listen.
let projColors = {};
const colorSubs = new Set();
export function setProjectColors(map){
  const same = Object.keys(map).length === Object.keys(projColors).length && Object.entries(map).every(([k, v]) => projColors[k] === v);
  if (same) return;
  projColors = map;
  colorSubs.forEach((cb) => cb());
}
export function watchProjectColors(cb){ colorSubs.add(cb); return () => colorSubs.delete(cb); }

// The class that colours a card: its project's .pc-<colour>, else its
// area's .area-admin etc. Neither → none, and the card keeps the neutral
// card colours.
export const areaClass = (task) => {
  const c = task?.project && projColors[task.project];
  return c ? ` pc-${c}` : AREAS.includes(task?.area) ? ` area-${task.area}` : "";
};
export const areaName = (task) => LABELS.area[task?.area] || "";
// The project, where it adds something: not the Inbox, and not a project
// named after its own area ("Admin · Admin" says nothing twice).
export function projectShown(task){
  const p = String(task?.project || "").trim();
  return !p || p === "Inbox" || p.toLowerCase() === areaName(task).toLowerCase() ? "" : p;
}

// Tasks finished today (local day).
export const doneToday = (tasks = [], now = Date.now()) =>
  tasks.filter((t) => t.status === "done" && t.doneAt && logicalDate(t.doneAt) === logicalDate(now));

// Tasks finished this week (Sunday on, the routines' week), Stats' list (Mor, 2026-10-18).
export const doneThisWeek = (tasks = [], now = Date.now()) => {
  const from = weekStart(logicalDate(now));
  return tasks.filter((t) => t.status === "done" && t.doneAt && logicalDate(t.doneAt) >= from && logicalDate(t.doneAt) <= logicalDate(now));
};

export function greeting(name, now = Date.now()){
  // The real clock, whatever night mode says: after midnight it isn't
  // morning yet, even with "I'm free now" on (Mor, 2026-10-06).
  const hr = new Date(now).getHours();
  if (hr < 5) return `Up late${name ? `, ${name}` : ""}`;
  const part = hr < 12 ? "morning" : hr < 18 ? "afternoon" : "evening";
  return `Good ${part}${name ? `, ${name}` : ""}`;
}

// "4 h 44", "45 min", "3 h": the free-time line is short on purpose.
export function freeDur(min){
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60}` : ""}`;
}

// No row flips for Hebrew any more (Mor, 2026-10-10): every name starts at
// the left edge; app.css [dir="auto"] keeps the text itself reading right.
