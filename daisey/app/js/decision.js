// The one decision card (design round 4, 2026-10-18): everything Daisey asks
// — Needs you's questions, the routine nudge under the Now card — in one
// layout: a kicker, the question, the thing it's about, one line of why, the
// main answer (yellow, like Done), the other answer, and More for the rest,
// which opens as a list under them. Only text and tint change. The callers
// build the buttons (needs.js arms "Really delete?"), this lays them out.
import { h, icon } from "./ui.js";

// q: { tone, ico, kicker, q, item, why }; field: an <input> or null;
// yes, no: buttons; more: buttons for the More list ([] = no More key);
// open: whether More's list is showing; onMore: toggles it.
// rows: [{ text, aria, go }] in place of item, each its own "?" to answer
// one at a time (Mor, 2026-10-20: the slipped plan's tasks, like the
// schedule's "?").
export function decisionCard({ tone = "", ico, kicker, q, item, rows = [], why, field = null, yes, no, tail = null, more = [], open = false, onMore }){
  return h("section", { className: `dc-card ${tone}`.trim(), ariaLabel: "Question" },
    (ico || kicker) && h("div", { className: "dc-kick" },
      ico && h("span", { className: "dc-ico", ariaHidden: "true" }, icon(ico)),
      kicker && h("span", { className: "dc-kicker", dir: "auto", textContent: kicker })),
    h("h2", { className: "dc-q", dir: "auto", textContent: q }),
    rows.length > 0 ? h("div", { className: "dc-rows", role: "group" }, ...rows.map((r) =>
      h("button", { className: "dc-row", type: "button", ariaLabel: r.aria || r.text, onclick: r.go },
        h("span", { className: "dc-row-t", dir: "auto", textContent: r.text }),
        h("span", { className: "dc-row-q", ariaHidden: "true", textContent: "?" }))))
      : item && h("div", { className: "dc-item", dir: "auto", textContent: item }),
    why && h("p", { className: "dc-why", textContent: why }),
    field,
    h("div", { className: "dc-btns" }, yes, no || null, tail,
      more.length > 0 && h("button", { className: "dc-more", type: "button", ariaExpanded: String(open), textContent: "More", onclick: onMore })),
    open && more.length > 0 && h("div", { className: "dc-list", role: "group", ariaLabel: "More answers" }, ...more));
}
