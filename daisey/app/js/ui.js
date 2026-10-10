// Tiny DOM helpers shared by the Now card and the Tasks board.
import { durText, leftMinutes, progressOf, toMinutes } from "./model.js";
import { isRoutine, doneThisWeek, weekLine } from "./routine.js";

// A routine's week as dots (Mor, 2026-10-08): ● ● ○ = 2 of 3 done. Read at a
// glance where "2 of 3 this week" had to be read. Sessions past the count
// are still dots. null for a task that isn't a routine.
export function weekDots(t){
  if (!isRoutine(t)) return null;
  const done = doneThisWeek(t), n = Math.max(t.routine.per, done);
  return h("span", { className: "wk-dots" + (done >= t.routine.per ? " met" : ""), role: "img", ariaLabel: weekLine(t) },
    ...Array.from({ length: n }, (_, i) => h("i", { className: i < done ? "on" : "" })));
}

export const h = (tag, props = {}, ...kids) => {
  const el = Object.assign(document.createElement(tag), props);
  el.append(...kids.filter((k) => k != null && k !== false));
  return el;
};

// Popups with a text box (Mor, 2026-10-08): on a computer the cursor lands in
// the box, ready to type; on a phone the box just opens and the keyboard
// waits for a tap. "Computer" = a mouse that can hover.
export const typeFirst = () => typeof matchMedia === "function" && matchMedia("(hover: hover) and (pointer: fine)").matches;
const TEXT = 'input:not([type]), input[type="text"], input[type="url"], input[type="search"], textarea';
export function focusField(el){
  if (!typeFirst() || !el?.isConnected || el.disabled || document.activeElement === el) return;
  el.focus();
  try { el.setSelectionRange(el.value.length, el.value.length); } catch {}
}
// Every dialog: after it opens, the first visible text box (if any) gets the
// cursor, on a computer only. A frame later so content painted on open is in.
if (typeof HTMLDialogElement === "function") {
  const show = HTMLDialogElement.prototype.showModal;
  HTMLDialogElement.prototype.showModal = function(){
    show.call(this);
    if (typeFirst()) requestAnimationFrame(() => {
      if (!this.open || this.contains(document.activeElement) && document.activeElement.matches(TEXT)) return;
      focusField([...this.querySelectorAll(TEXT)].find((f) => !f.disabled && f.getClientRects().length));
    });
  };
}


// A row of single-choice chips. current = null → none selected.
export const chips = (label, options, current, pick) => h("div", { className: "now-group", role: "radiogroup", ariaLabel: label },
  label && h("div", { className: "now-label", textContent: label }),
  h("div", { className: "now-chips" }, ...options.map(([v, text]) => h("button", {
    type: "button", className: "chip", role: "radio", ariaChecked: String(v === current), textContent: text, onclick: () => pick(v),
  }))));

// A size shows as what it is: a 4 h job must not read "90+ min".
export const sizeText = durText;


export const dur = durText;

// The one way a task's size reads, everywhere: "30 min" untouched, and once
// some is done "50% · 15 min left" (Mor, 2026-10-07: always know the %).
export function sizeChip(t){
  const p = progressOf(t), left = leftMinutes(t), size = toMinutes(t.size) ?? left;
  const lbl = left < size ? `${durText(left)} left` : durText(t.size);
  return p > 0 ? `${p}% · ${lbl}` : lbl;
}

// A thin bar along a card's bottom edge; nothing at 0%.
export const progressBar = (t) => {
  const p = progressOf(t);
  return p > 0 && h("div", { className: "task-bar", role: "img", ariaLabel: `${p}% done` }, h("span", { style: `inline-size:${p}%` }));
};

// Every piece of text that can be Hebrew or English goes in its own <bdi>,
// so a Hebrew project never drags "5 min" around it or flips it to "min 5".
export const bdi = (text) => h("bdi", { dir: "auto", textContent: text });

// A why line from the engine: plain strings, and { name } for anything the
// user typed — each name in its own <bdi>, so "keeps חתונה going" reads in
// order in both directions.
export const say = (pieces) => pieces.map((p) => (typeof p === "string" ? document.createTextNode(p) : bdi(p.name)));

// Those pieces joined by " · ", each isolated: "חתונה · 5 min" stays that way.
export const pieces = (...parts) => parts.filter(Boolean)
  .flatMap((p, i) => (i ? [document.createTextNode(" · "), bdi(p)] : [bdi(p)]));

// A floating toast with an optional Undo, for actions taken away from the Now
// card — completing a task from the list, mainly. The Now card has its own
// copy inside its render (it needs the toast to survive its re-renders); this
// one is for callers with no such loop, and it is why nothing in the task
// list has to fall back to the browser's own confirm().
export const UNDO_MS = 3500;
let livePop = null, liveTimer = null;

// Every .toast is fixed to the same spot (the card's own Undo/why toasts, the
// plan-cut one, flash()), so two at once used to hide each other. Stack them:
// the first sits where CSS puts it, each later one lifts above those below.
// Runs after any DOM change, once per frame; a lift is a `translate`, so it
// never fights the toast's own position or animation.
const GAP = 8;
let stackQueued = false;
function stackToasts(){
  stackQueued = false;
  let lift = 0;
  for (const t of document.querySelectorAll(".toast")){
    t.style.translate = lift ? `0 ${-lift}px` : "";
    lift += t.offsetHeight + GAP;
  }
}
if (typeof MutationObserver !== "undefined" && typeof document !== "undefined"){
  new MutationObserver(() => {
    if (stackQueued) return;
    stackQueued = true;
    requestAnimationFrame(stackToasts);
  }).observe(document.body, { childList: true, subtree: true });
}

export function dismissFlash(){ clearTimeout(liveTimer); livePop?.remove(); livePop = null; }

// `adjust` { minutes, set(m) }: "Counted ~30 min" with − / + (15 min a tap).
export function flash(label, title, { undo, adjust } = {}){
  dismissFlash();
  let mins = adjust?.minutes ?? 0;
  const count = adjust && h("span", { className: "toast-count" }, `Counted ~${mins} min`);
  const step = (d) => h("button", { className: "toast-step", type: "button", textContent: d < 0 ? "−" : "+", ariaLabel: `${d < 0 ? "Less" : "More"} time`,
    onclick: () => {
      mins = Math.max(0, mins + d); count.textContent = `Counted ${mins} min`; adjust.set(mins);
      clearTimeout(liveTimer); liveTimer = setTimeout(dismissFlash, UNDO_MS);
    } });
  livePop = h("div", { className: adjust ? "toast" : "toast timed", role: "status" },
    h("span", { className: "toast-text" }, label, title ? bdi(title) : null),
    adjust && h("span", { className: "toast-adj" }, step(-15), count, step(15)),
    undo && h("button", { className: "toast-undo", type: "button", textContent: "Undo",
      onclick: () => { dismissFlash(); undo(); } }));
  document.body.append(livePop);
  liveTimer = setTimeout(dismissFlash, adjust ? UNDO_MS + 3000 : UNDO_MS);
}

// Inline icons: the card's three quiet actions, and one per guessed field so
// the guess line can say "Work" without also spelling out "Area". One path
// each, drawn on a 24-grid and stroked in currentColor so they follow the
// text colour and read in both themes.
const PATHS = {
  later: "M12 7v5l3 2M4 12a8 8 0 1 0 2.5-5.8M4 4v3.5h3.5",
  switch: "M4 8h13l-3-3M20 16H7l3 3",
  pending: "M7 3h10M7 21h10M8 3v3l4 4 4-4V3M8 21v-3l4-4 4 4v3",
  area: "M3.5 12.5 11.5 4.5H20v8L12 20.5l-8.5-8ZM16 8.5h.01",
  type: "M12 3.5l2.1 6 6 2.1-6 2.1-2.1 6-2.1-6-6-2.1 6-2.1 2.1-6Z",
  where: "M12 21s6.5-5.8 6.5-10.2A6.5 6.5 0 0 0 5.5 10.8C5.5 15.2 12 21 12 21ZM9.6 10.6a2.4 2.4 0 1 0 4.8 0 2.4 2.4 0 1 0-4.8 0",
  openHours: "M12 4v2M5 12H3M19 12h2M6.3 6.3 4.9 4.9M17.7 6.3l1.4-1.4M7 16.5a5 5 0 1 1 10 0M3 20h18",
  size: "M12 7.5V12l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
  stakes: "M12 4 2.5 20h19L12 4ZM12 10v4M12 16.8h.01",
  energy: "M13 3.5 5.5 14H10l-1 6.5L18 10h-4.5l1-6.5Z",
  lighter: "M5 19 14 10M20 4c-7 0-12 4-12 11v4h4c7 0 11-5 11-12V4h-3Z", // a leaf: something lighter
  home: "M3 11l9-7 9 7M5 10v10h14V10",
  globe: "M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3",
  check: "M5 12l5 5 9-10",
  focus: "M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15",
  plus: "M12 5v14M5 12h14",
  bloom: "M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 1 0 0-5ZM12 9.5c-2-1-2.6-3.6 0-6 2.6 2.4 2 5 0 6ZM14.5 12c1-2 3.6-2.6 6 0-2.4 2.6-5 2-6 0ZM12 14.5c2 1 2.6 3.6 0 6-2.6-2.4-2-5 0-6ZM9.5 12c-1 2-3.6 2.6-6 0 2.4-2.6 5-2 6 0Z",
  edit: "M4 20h4L19 9l-4-4L4 16v4ZM13.5 6.5l4 4", // a pencil: the task's settings
  play: "M7 4.5v15l13-7.5z", // filled, not stroked (FILLED)
  pause: "M7 5h3.5v14H7zM13.5 5H17v14h-3.5z", // filled
  stop: "M8 6h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z", // filled
  more: "M4 12a2 2 0 1 0 4 0 2 2 0 1 0-4 0ZM10 12a2 2 0 1 0 4 0 2 2 0 1 0-4 0ZM16 12a2 2 0 1 0 4 0 2 2 0 1 0-4 0Z", // ⋯, filled
  back: "M15 6l-6 6 6 6",
  inbox: "M4 13l3-8h10l3 8v6H4zM4 13h5l1 2h4l1-2h5",
  chev: "M9 6l6 6-6 6",
  close: "M6 6l12 12M18 6L6 18",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  details: "M4 7h10M18 7h2M4 17h4M12 17h8M14 7a2 2 0 1 0 4 0 2 2 0 1 0-4 0M8 17a2 2 0 1 0 4 0 2 2 0 1 0-4 0",
  calendar: "M3.5 8a3 3 0 0 1 3-3h11a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3h-11a3 3 0 0 1-3-3ZM3.5 10h17M8 3v4M16 3v4",
  folder: "M3.5 7.5a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z",
  someday: "M7 18a4.5 4.5 0 0 1-.6-9A6 6 0 0 1 18 9.5a4 4 0 0 1-1 8.5Z", // a cloud: parked
  pin: "M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11ZM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z",
  repeat: "M17 2.5l3 3-3 3M4 11.5v-1a5 5 0 0 1 5-5h11M7 21.5l-3-3 3-3M20 12.5v1a5 5 0 0 1-5 5H4",
};
const FILLED = new Set(["play", "pause", "stop", "more"]);

export const icon = (name) => {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  const filled = FILLED.has(name);
  for (const [k, v] of Object.entries({ viewBox: "0 0 24 24", "aria-hidden": "true", fill: filled ? "currentColor" : "none",
    stroke: filled ? "none" : "currentColor", "stroke-width": "1.8", "stroke-linecap": "round", "stroke-linejoin": "round" })) svg.setAttribute(k, v);
  const path = document.createElementNS(NS, "path");
  path.setAttribute("d", PATHS[name]);
  svg.append(path);
  return svg;
};

// The night divider (DAISEY_SPEC "Visual design"): a thin line with a cream
// pill in the middle, "Night · 22:00 – 08:00", and a closed daisy bud. Used
// wherever today meets tomorrow. from/to: "HH:MM".
export function nightDivider(from, to){
  const NS = "http://www.w3.org/2000/svg";
  const el = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
  const bud = el("svg", { viewBox: "0 0 24 24", width: 14, height: 14, "aria-hidden": "true", class: "bud" });
  const g = el("g", { class: "bud-petals" });
  g.append(el("ellipse", { cx: 9.5, cy: 9, rx: 2.4, ry: 6, transform: "rotate(-14 12 17)" }),
    el("ellipse", { cx: 12, cy: 8, rx: 2.4, ry: 6.5 }),
    el("ellipse", { cx: 14.5, cy: 9, rx: 2.4, ry: 6, transform: "rotate(14 12 17)" }));
  bud.append(g, el("circle", { cx: 12, cy: 17, r: 3, class: "bud-heart" }));
  return h("div", { className: "night-div", role: "separator", ariaLabel: `Night, ${from} to ${to}` },
    h("span", { className: "night-pill" }, bud, h("span", { textContent: `Night · ${from} – ${to}` })));
}

// Done pressed (Mor, 2026-10-07): "how much did you finish?". 100 → onFull().
// Less → "when do you want to come back to it?" → onPartial(pct, when), where
// when is today | tomorrow | week | someday. Closing the sheet does nothing.
export function askProgress(task, { onFull, onPartial, start = 50 }){
  const d = h("dialog", { className: "now", ariaLabel: "How much is done?" });
  const close = () => { d.close(); d.remove(); };
  const head = (t) => h("div", { className: "now-head" }, h("h2", { textContent: t }),
    h("button", { className: "now-x", type: "button", ariaLabel: "Close", textContent: "✕", onclick: close }));
  const out = h("output", { className: "pj-pct", textContent: `${start}%` });
  const range = h("input", { type: "range", min: "5", max: "95", step: "5", value: String(start), ariaLabel: "Percent finished",
    oninput: () => { out.textContent = `${range.value}%`; } });
  const when = (pct) => {
    d.replaceChildren(head("Back to it when?"),
      h("div", { className: "now-chips" }, ...[["today", "Later today"], ["tomorrow", "Tomorrow"], ["week", "This week"], ["someday", "On hold"]].map(([w, text]) =>
        h("button", { className: "chip", type: "button", textContent: text, onclick: () => { close(); onPartial(pct, w); } }))));
  };
  d.replaceChildren(head("How much is done?"),
    h("p", { className: "muted", dir: "auto", textContent: task.title }),
    h("div", { className: "sheet-stack" }, out, range,
      h("div", { className: "sheet-actions" },
        h("button", { className: "btn primary", type: "button", textContent: "All done · 100%", onclick: () => { close(); onFull(); } }),
        h("button", { className: "btn", type: "button", textContent: "Save this %", onclick: () => when(Number(range.value)) }))));
  d.onclick = (e) => { if (e.target === d) close(); };
  document.body.append(d);
  d.showModal();
}
