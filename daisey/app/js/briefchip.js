// The Today chip (Mor, 2026-10-06: "the brief can be shown all the time next
// to done tasks on top row as a message that can be opened and closed"). The
// same brief the morning notification sends (brief.js), worked out live from
// now: free time left, open vs fit, deadlines, Needs you's count, the next
// event. Tap the chip to open or close it; ✕, Escape or a tap elsewhere close it.
import { watchTasks, watchSettings } from "./store.js";
import { watchCalendar } from "./calendar.js";
import { brief } from "./brief.js";
import { collectNeeds } from "./needs-list.js";
import { dayHours } from "./day.js";
import { h } from "./ui.js";

export function mountBriefChip(chip, pop, uid){
  let tasks = [], settings = {}, cal = { status: "loading", events: [] }, timer = null;
  const fail = (e) => console.error("[daisey] brief chip", e);
  const isOpen = () => !pop.hidden;

  function paint(){
    if (!isOpen()) return;
    const hrs = dayHours(settings);
    const ok = cal.status === "ok";
    const needs = collectNeeds({ tasks, events: cal.events || [], calOk: ok, settings }).length;
    const b = brief({ tasks, events: ok ? cal.events : null, dayStart: hrs.start, dayEnd: hrs.end, needs, title: "Today" });
    pop.replaceChildren(
      h("div", { className: "brief-head" }, h("h2", { textContent: b.title }),
        h("button", { className: "brief-x", type: "button", ariaLabel: "Close", textContent: "✕", onclick: () => set(false) })),
      h("p", { textContent: b.body }));
  }
  function set(open){
    pop.hidden = !open;
    chip.ariaExpanded = String(open);
    clearInterval(timer);
    if (open) { paint(); timer = setInterval(paint, 60000); }
  }
  chip.onclick = (e) => { e.stopPropagation(); set(!isOpen()); };
  const outside = (e) => { if (isOpen() && !pop.contains(e.target) && e.target !== chip) set(false); };
  const esc = (e) => { if (e.key === "Escape" && isOpen()) set(false); };
  document.addEventListener("click", outside);
  document.addEventListener("keydown", esc);
  chip.hidden = false;

  const unsubs = [
    watchTasks(uid, (ts) => { tasks = ts; paint(); }, fail),
    watchSettings(uid, (s) => { settings = s || {}; paint(); }, fail),
    watchCalendar((c) => { cal = c; paint(); }),
  ];
  return { unmount(){ unsubs.forEach((u) => u()); clearInterval(timer); document.removeEventListener("click", outside);
    document.removeEventListener("keydown", esc); chip.onclick = null; chip.hidden = true; pop.hidden = true; } };
}
