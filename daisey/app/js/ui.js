// Tiny DOM helpers shared by the Now card and the check-in.
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

