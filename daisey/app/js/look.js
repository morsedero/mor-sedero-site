// The visual pieces the redesign shares (DAISEY_SPEC "Visual design"): the
// daisy, the area colours, the greeting and the free-time line. No state,
// nothing at import time touches the DOM (focus.js is imported by node tests).
import { localDate, LABELS, AREAS } from "./model.js";

const NS = "http://www.w3.org/2000/svg";
const svgEl = (tag, attrs = {}) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
};

// One petal per task done today, max 8, and never an empty slot: however
// many there are, they spread evenly round the heart, so any count reads as
// a whole flower rather than one with gaps.
export function daisy(petals, { size = 30, cls = "daisy" } = {}){
  const n = Math.max(0, Math.min(8, petals | 0));
  const svg = svgEl("svg", { viewBox: "0 0 40 40", width: size, height: size, class: cls, "aria-hidden": "true" });
  const g = svgEl("g", { class: "daisy-petals" });
  for (let i = 0; i < n; i++) {
    g.append(svgEl("ellipse", { cx: 20, cy: 9, rx: 4.2, ry: 8, transform: `rotate(${(360 / n) * i} 20 20)` }));
  }
  svg.append(g, svgEl("circle", { cx: 20, cy: 20, r: 6.5, class: "daisy-heart" }));
  return svg;
}

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

// Night: a moon with a sleeping daisy in front of it.
export function moonDaisy(){
  const svg = svgEl("svg", { viewBox: "0 0 40 40", width: 96, height: 96, class: "moon-daisy", "aria-hidden": "true" });
  svg.append(svgEl("path", { d: "M29 6a10 10 0 1 0 5 15A8 8 0 0 1 29 6z", class: "moon" }));
  const g = svgEl("g", { class: "daisy-petals" });
  for (const r of [-60, 0, 60]) g.append(svgEl("ellipse", { cx: 14, cy: 26, rx: 3, ry: 5.5, transform: `rotate(${r} 14 30)` }));
  svg.append(g, svgEl("circle", { cx: 14, cy: 30, r: 3.6, class: "daisy-heart" }));
  return svg;
}

// The area class that colours a card: .area-admin etc. Unknown → none, and
// the card keeps the neutral card colours.
export const areaClass = (task) => (AREAS.includes(task?.area) ? ` area-${task.area}` : "");
export const areaName = (task) => LABELS.area[task?.area] || "";
// The project, where it adds something: not the Inbox, and not a project
// named after its own area ("Admin · Admin" says nothing twice).
export function projectShown(task){
  const p = String(task?.project || "").trim();
  return !p || p === "Inbox" || p.toLowerCase() === areaName(task).toLowerCase() ? "" : p;
}

// Tasks finished today (local day).
export const doneToday = (tasks = [], now = Date.now()) =>
  tasks.filter((t) => t.status === "done" && t.doneAt && localDate(t.doneAt) === localDate(now));

export function greeting(name, now = Date.now()){
  const hr = new Date(now).getHours();
  const part = hr < 12 ? "morning" : hr < 18 ? "afternoon" : "evening";
  return `Good ${part}${name ? `, ${name}` : ""}`;
}

// "4 h 44", "45 min", "3 h": the free-time line is short on purpose.
export function freeDur(min){
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60}` : ""}`;
}

// Which way a piece of text reads, from its first strong letter — for rows
// that have to flip as a whole (checkbox on the right for Hebrew). dir=auto
// can't do it there: it skips <bdi>, which is where the titles live.
const RTL_FIRST = /^[^\p{L}]*[֐-ࣿיִ-﷿ﹰ-﻿]/u;
export const dirOf = (text) => (RTL_FIRST.test(String(text || "")) ? "rtl" : "ltr");
