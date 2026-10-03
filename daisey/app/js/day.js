// The day planner, under the Now card. You give one thing — hours free
// today — and Daisey shows its take on the day: urgent first, as much as
// fits, each with why. You don't pick (Mor: deciding what matters is the
// app's job). Live: it re-plans whenever tasks change. Read-only; the Now
// card still picks moment to moment. Hours are saved per day in
// users/{uid}/state/today, so the card and other devices use them too.
import { watchTasks, watchToday, saveToday } from "./store.js";
import { planDay } from "./engine.js";
import { localDate } from "./model.js";
import { h, chips, sizeText } from "./ui.js";

const HOURS = [[1, "1 h"], [2, "2 h"], [4, "4 h"], [6, "6 h"], [8, "8 h+"]];
const hm = (min) => (min >= 60 ? `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60}` : ""}` : `${min} min`);

// onCard: id of the task on the Now card, marked in the list.
export function mountDay(root, uid){
  let tasks = null, today = null, onCard = null;
  const fill = (...kids) => root.replaceChildren(...kids.filter(Boolean));

  function render(){
    const hours = today?.date === localDate() ? today.hours ?? null : null;
    const head = [
      h("h2", { className: "day-h", textContent: "Today" }),
      chips("Hours free today", HOURS, hours, (v) => {
        today = { date: localDate(), hours: v }; render(); // show it now; the snapshot follows
        saveToday(uid, today).catch((e) => console.error("[daisey] day save", e));
      }),
    ];
    if (tasks == null) { fill(...head, h("p", { className: "muted", textContent: "Loading tasks…" })); return; }
    if (!hours) { fill(...head, h("p", { className: "muted", textContent: "Pick your hours and Daisey will lay out the day." })); return; }

    const d = planDay(tasks, { hours });
    fill(...head,
      h("div", { className: "now-label", textContent: d.items.length ? `Daisey's take on today (${hm(d.minutes)})` : "Daisey's take on today" }),
      d.items.length === 0 && h("p", { className: "muted", textContent: tasks.some((t) => t.status === "ready")
        ? "Nothing fits in that time. Try more hours, or take it easy." : "No open tasks yet." }),
      d.items.length > 0 && h("ol", { className: "day-list" }, ...d.items.map((s) => h("li", { className: s.task.id === onCard ? "on-card" : "" },
        h("div", { className: "day-title", dir: "auto", textContent: s.task.title }),
        h("div", { className: "muted", dir: "auto", textContent: [s.task.project, sizeText(s.task.size)].join(" · ") +
          (s.task.id === onCard ? " — on the Now card" : s.why ? ` — ${s.why}` : "") })))),
      d.left > 0 && d.items.length > 0 && h("p", { className: "muted", textContent: `${d.left} more can wait.` }));
  }

  const fail = (e) => console.error("[daisey] day", e);
  const unsubs = [
    watchTasks(uid, (ts) => { tasks = ts; render(); }, fail),
    watchToday(uid, (t) => { today = t; render(); }, fail),
  ];
  const onVisible = () => { if (!document.hidden) render(); }; // a new day since the tab was hidden
  document.addEventListener("visibilitychange", onVisible);
  root.hidden = false;
  render();

  return {
    setCurrent(id){ onCard = id; render(); },
    unmount(){ unsubs.forEach((u) => u()); document.removeEventListener("visibilitychange", onVisible); root.replaceChildren(); root.hidden = true; },
  };
}
