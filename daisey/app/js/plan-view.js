// How Plan my day looks (plan.js): one block per window — "Afternoon · 2 h
// free" — with the tasks Daisey would use it for, each a button that opens the
// task. Nothing here is booked; the line at the bottom says so.
import { h, bdi, progressBar } from "./ui.js";
import { durText, progressOf } from "./model.js";

// plan: planDay's result. onOpen(task). only: one window's key, or null for all.
export function planView(plan, { onOpen, only = null, title = null } = {}){
  const shown = only ? plan.filter((p) => p.key === only) : plan;
  if (!shown.length) return null;
  return h("section", { className: "plan", ariaLabel: "Daisey's plan" },
    h("h3", { className: "plan-h", textContent: title || (only ? "Plan" : "Plan for today") }),
    ...shown.map((p) => h("div", { className: "plan-win" },
      h("div", { className: "plan-head" }, h("span", { className: "plan-name", textContent: p.label }), h("span", { className: "plan-free", textContent: `${durText(p.minutes)} free` })),
      p.picks.length
        ? h("ul", { className: "plan-list" }, ...p.picks.map((k) => h("li", {},
          h("button", { type: "button", className: "plan-task", onclick: () => onOpen?.(k.task), ariaLabel: `${k.task.title}, about ${durText(k.minutes)}` },
            h("span", { className: "plan-title" }, bdi(k.task.title)),
            h("span", { className: "plan-size", textContent: (progressOf(k.task) ? `${progressOf(k.task)}% · ` : "") + durText(k.minutes) }),
            progressBar(k.task)))))
        : h("p", { className: "plan-none", textContent: "Nothing needs this time. Keep it." }))),
    h("p", { className: "plan-note", textContent: "Daisey's plan. Nothing here is in your calendar." }));
}
