// Tiny DOM helpers shared by the Now card and the Tasks board.
import { durText } from "./model.js";

export const h = (tag, props = {}, ...kids) => {
  const el = Object.assign(document.createElement(tag), props);
  el.append(...kids.filter((k) => k != null && k !== false));
  return el;
};


// A row of single-choice chips. current = null → none selected.
export const chips = (label, options, current, pick) => h("div", { className: "now-group", role: "radiogroup", ariaLabel: label },
  label && h("div", { className: "now-label", textContent: label }),
  h("div", { className: "now-chips" }, ...options.map(([v, text]) => h("button", {
    type: "button", className: "chip", role: "radio", ariaChecked: String(v === current), textContent: text, onclick: () => pick(v),
  }))));

// A size shows as what it is: a 4 h job must not read "90+ min".
export const sizeText = durText;


export const dur = durText;

// Every piece of text that can be Hebrew or English goes in its own <bdi>,
// so a Hebrew project never drags "5 min" around it or flips it to "min 5".
export const bdi = (text) => h("bdi", { dir: "auto", textContent: text });

// Those pieces joined by " · ", each isolated: "חתונה · 5 min" stays that way.
export const pieces = (...parts) => parts.filter(Boolean)
  .flatMap((p, i) => (i ? [document.createTextNode(" · "), bdi(p)] : [bdi(p)]));

// A floating toast with an optional Undo, for actions taken away from the Now
// card — completing a task from the list, mainly. The Now card has its own
// copy inside its render (it needs the toast to survive its re-renders); this
// one is for callers with no such loop, and it is why nothing in the task
// list has to fall back to the browser's own confirm().
export const UNDO_MS = 5000;
let livePop = null, liveTimer = null;

export function dismissFlash(){ clearTimeout(liveTimer); livePop?.remove(); livePop = null; }

export function flash(label, title, { undo } = {}){
  dismissFlash();
  livePop = h("div", { className: "toast", role: "status" },
    h("span", { className: "toast-text" }, label, title ? bdi(title) : null),
    undo && h("button", { className: "toast-undo", type: "button", textContent: "Undo",
      onclick: () => { dismissFlash(); undo(); } }));
  document.body.append(livePop);
  liveTimer = setTimeout(dismissFlash, UNDO_MS);
}

// Inline icons for the card's three quiet actions. One path each, drawn on a
// 24-grid and stroked in currentColor so they follow the button's text colour.
const PATHS = {
  later: "M12 7v5l3 2M4 12a8 8 0 1 0 2.5-5.8M4 4v3.5h3.5",
  switch: "M4 8h13l-3-3M20 16H7l3 3",
  pending: "M7 3h10M7 21h10M8 3v3l4 4 4-4V3M8 21v-3l4-4 4 4v3",
};

export const icon = (name) => {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  for (const [k, v] of Object.entries({ viewBox: "0 0 24 24", "aria-hidden": "true", fill: "none",
    stroke: "currentColor", "stroke-width": "1.8", "stroke-linecap": "round", "stroke-linejoin": "round" })) svg.setAttribute(k, v);
  const path = document.createElementNS(NS, "path");
  path.setAttribute("d", PATHS[name]);
  svg.append(path);
  return svg;
};
