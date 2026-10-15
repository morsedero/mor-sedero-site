// A tap-to-pick date box (Add task's look): the value or `empty` text, a ✕
// to clear, and the native date input laid invisibly over the whole box, so
// a tap anywhere opens the month table. Wraps an existing <input type=date>;
// programmatic .value sets repaint it too.
import { h, icon } from "./ui.js";

const show = (s) => new Date(`${s}T12:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });

export function dateBox(input, { empty = "No date", label = "date", clearable = true } = {}){
  input.classList.add("ts-date-in");
  input.addEventListener("click", () => { try { input.showPicker(); } catch { /* opened natively */ } });
  const value = h("span", { className: "ts-date-v" });
  const clear = h("button", { type: "button", className: "ts-date-x", ariaLabel: `Clear ${label}`,
    onclick: (e) => { e.preventDefault(); input.value = ""; input.dispatchEvent(new Event("change")); } }, icon("close"));
  const box = h("div", { className: "ts-date" }, value, ...(clearable ? [clear] : []), input);
  const paint = () => {
    value.textContent = input.value ? show(input.value) : empty;
    box.classList.toggle("set", !!input.value && clearable);
    clear.hidden = !input.value;
  };
  const base = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  Object.defineProperty(input, "value", { get: () => base.get.call(input), set: (v) => { base.set.call(input, v); paint(); } });
  input.addEventListener("change", paint);
  paint();
  return box;
}
