// Tiny DOM helpers shared by the Now card and the check-in.
export const h = (tag, props = {}, ...kids) => {
  const el = Object.assign(document.createElement(tag), props);
  el.append(...kids.filter((k) => k != null && k !== false));
  return el;
};

export const ENERGIES = [["low", "Low"], ["medium", "Medium"], ["high", "High"]];

// A row of single-choice chips. current = null → none selected.
export const chips = (label, options, current, pick) => h("div", { className: "now-group", role: "radiogroup", ariaLabel: label },
  label && h("div", { className: "now-label", textContent: label }),
  h("div", { className: "now-chips" }, ...options.map(([v, text]) => h("button", {
    type: "button", className: "chip", role: "radio", ariaChecked: String(v === current), textContent: text, onclick: () => pick(v),
  }))));

export const sizeText = (n) => `${n >= 90 ? "90+" : n} min`;

// Energy as a 3-stop horizontal slider. Shows "(guess)" until you move it;
// moving it is the correction (holds 3 h). The label follows the thumb while
// dragging; the choice is committed on release.
const LEVELS = ["low", "medium", "high"];
export function energySlider(energy, onSet){
  const id = `energy-${Math.random().toString(36).slice(2, 8)}`;
  const label = (i, guessed) => `Energy: ${LEVELS[i]}${guessed ? " (guess)" : ""}`;
  const out = h("label", { className: "now-label", htmlFor: id, textContent: label(LEVELS.indexOf(energy.level), energy.guessed) });
  const range = h("input", { type: "range", id, className: "energy-range", min: 0, max: 2, step: 1, value: LEVELS.indexOf(energy.level) });
  range.setAttribute("aria-valuetext", LEVELS[range.value]);
  range.oninput = () => { out.textContent = label(+range.value, false); range.setAttribute("aria-valuetext", LEVELS[range.value]); };
  range.onchange = () => onSet(LEVELS[+range.value]);
  return h("div", { className: "energy" + (energy.guessed ? " guessed" : "") }, out, range,
    h("div", { className: "energy-ticks", ariaHidden: "true" }, ...ENERGIES.map(([, t]) => h("span", { textContent: t }))));
}
