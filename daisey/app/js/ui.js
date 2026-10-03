// Tiny DOM helpers shared by the Now card and the Tasks board.
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

export const sizeText = (n) => `${n >= 90 ? "90+" : n} min`;


// Minutes as "45 min", "1 h", "1 h 30 min" — never "1.5 h" or "4 h 5".
export const dur = (m) => {
  m = Math.round(m);
  if (m < 60) return `${m} min`;
  const r = m % 60;
  return `${Math.floor(m / 60)} h` + (r ? ` ${r} min` : "");
};

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
