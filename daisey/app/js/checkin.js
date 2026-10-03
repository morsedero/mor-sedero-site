// The daily check-in: a popup on the first visit each day, reopened from
// "Replan today". You give one thing — hours free today — and Daisey shows
// its take on the day: what's urgent first, as much as fits, each with why.
// You don't pick (Mor: deciding what matters is the app's job). Read-only;
// the Now card still picks moment to moment. Saved in users/{uid}/state/today.
import { watchTasks, watchToday, saveToday } from "./store.js";
import { planDay } from "./engine.js";
import { localDate } from "./model.js";
import { h, chips, sizeText } from "./ui.js";

const HOURS = [[1, "1 h"], [2, "2 h"], [4, "4 h"], [6, "6 h"], [8, "8 h+"]];
const hm = (min) => (min >= 60 ? `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60}` : ""}` : `${min} min`);

export function mountCheckin(dialog, uid, { onSaved } = {}){
  let tasks = null, today = undefined; // undefined until the first snapshot
  let hours = null; // the draft while open
  let autoChecked = false;

  const body = h("div", { className: "now-body" });
  const fill = (...kids) => body.replaceChildren(...kids.filter(Boolean));
  const close = h("button", { className: "now-x", type: "button", ariaLabel: "Close", textContent: "✕", onclick: () => dialog.close() });
  const title = h("h2", { id: "checkinTitle", textContent: "Plan today" });
  dialog.replaceChildren(h("div", { className: "now-head" }, title, close), body);
  dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });

  const planned = () => today?.date === localDate();

  function render(){
    const head = chips("Hours free today", HOURS, hours, (v) => { hours = v; render(); });
    const actions = h("div", { className: "now-actions one" },
      h("button", { className: "btn primary", type: "button", textContent: "Start the day", disabled: !hours, onclick: () => save(hours) }));
    if (tasks == null) { fill(head, h("p", { className: "muted", textContent: "Loading tasks…" }), actions); return; }
    if (!hours) { fill(head, h("p", { className: "muted", textContent: "Pick your hours and Daisey will lay out the day." }), actions); return; }

    const d = planDay(tasks, { hours });
    fill(head,
      h("div", { className: "now-label", textContent: d.items.length ? `Daisey's take on today (${hm(d.minutes)})` : "Daisey's take on today" }),
      d.items.length === 0 && h("p", { className: "muted", textContent: tasks.some((t) => t.status === "ready")
        ? "Nothing fits in that time. Try more hours, or take it easy." : "No open tasks yet." }),
      d.items.length > 0 && h("ol", { className: "day-list" }, ...d.items.map((s) => h("li", {},
        h("div", { className: "day-title", dir: "auto", textContent: s.task.title }),
        h("div", { className: "muted", dir: "auto", textContent: [s.task.project, sizeText(s.task.size)].join(" · ") + (s.why ? ` — ${s.why}` : "") })))),
      d.left > 0 && d.items.length > 0 && h("p", { className: "muted", textContent: `${d.left} more can wait.` }),
      actions);
  }

  function save(hrs){
    saveToday(uid, { date: localDate(), hours: hrs }).catch((e) => console.error("[daisey] checkin save", e));
    dialog.close();
    onSaved?.();
  }

  function open(){
    const same = planned();
    hours = same ? today.hours ?? null : null;
    title.textContent = same ? "Replan today" : "Plan today";
    render();
    if (!dialog.open) dialog.showModal();
  }

  // First visit of the day: open once both snapshots are in.
  const maybeAuto = () => {
    if (autoChecked || tasks == null || today === undefined) return;
    autoChecked = true;
    if (!planned()) open();
  };
  const fail = (e) => console.error("[daisey] checkin", e);
  const unsubs = [
    watchTasks(uid, (ts) => { tasks = ts; maybeAuto(); if (dialog.open) render(); }, fail),
    watchToday(uid, (t) => { today = t; maybeAuto(); }, fail),
  ];

  return {
    open,
    unmount(){ unsubs.forEach((u) => u()); if (dialog.open) dialog.close(); dialog.replaceChildren(); },
  };
}
