// The sweep: old dates, one task at a time, four answers — Today · This week
// · Someday · Drop (DAISEY_SPEC "Overdue triage"). Offered from the Now tab
// when too many dates have passed (triage.shouldOffer), and later from the
// Schedule's "Move the rest" with a list of its own.
//
// "This week" puts the task on the day with the most room this week
// (triage.pickWeekDay: calendar events plus what's already dated there).
// Mor asked for Gemini to choose; until chat exists, the engine does.
//
// Each answer writes straight away and the next task slides in; Undo takes
// back the last one. The list is fixed when the sheet opens, so a task that
// changes meanwhile isn't asked about twice.
import { watchTasks, restoreTask, saveSettings } from "./store.js";
import { watchCalendar } from "./calendar.js";
import { sweepList, pickWeekDay, answer, answerSnapshot, isOpen } from "./triage.js";
import { localDate } from "./model.js";
import { h, bdi, pieces, sizeText } from "./ui.js";

const shortDate = (s) => new Date(`${s}T12:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });

export function mountSweep(dialog, uid){
  let tasks = [], events = [];
  let queue = [], i = 0, last = null; // last: { task, before, said }
  let stopCal = null;
  const fail = (e) => console.error("[daisey] sweep", e);
  const find = (id) => tasks.find((t) => t.id === id);

  function reply(kind){
    const t = find(queue[i]);
    if (!t) { i++; paint(); return; }
    const now = Date.now();
    const week = kind === "week" ? pickWeekDay(t, { events, tasks, now }) : null;
    const said = { today: "Today", week: `This week: ${week && shortDate(week)}`, someday: "Someday", drop: "Dropped" }[kind];
    last = { task: t, before: answerSnapshot(t), said };
    restoreTask(uid, t.id, answer(kind, t, { now, week })).catch(fail);
    i++;
    paint();
  }

  function undo(){
    if (!last) return;
    restoreTask(uid, last.task.id, last.before).catch(fail);
    // Put it back here too, before the snapshot lands, or paint would skip
    // it as already sorted.
    tasks = tasks.map((t) => (t.id === last.task.id ? { ...t, ...last.before } : t));
    i = Math.max(0, queue.indexOf(last.task.id));
    last = null;
    paint();
  }

  function paint(){
    // Skip anything sorted elsewhere while the sheet was open.
    while (i < queue.length && !(find(queue[i]) && isOpen(find(queue[i])))) i++;
    const head = h("div", { className: "now-head" },
      h("h2", { id: "swTitle", textContent: "Old dates" }),
      h("button", { className: "now-x", type: "button", ariaLabel: "Close", textContent: "✕", onclick: () => dialog.close() }));
    const undoLine = last && h("p", { className: "muted sw-last" }, `${last.said}: `, bdi(last.task.title), " ",
      h("button", { className: "linkish", type: "button", textContent: "Undo", onclick: undo }));
    if (i >= queue.length) {
      dialog.replaceChildren(head, h("p", { className: "sw-done", textContent: queue.length ? "All sorted." : "Nothing to sort." }), undoLine,
        h("div", { className: "sheet-actions" }, h("button", { className: "btn primary", type: "button", textContent: "Close", onclick: () => dialog.close() })));
      return;
    }
    const t = find(queue[i]);
    const was = `${t.dateKind === "deadline" ? "deadline was" : "planned for"} ${shortDate(t.due)}`;
    const btn = (kind, label, cls = "") => h("button", { className: "btn " + cls, type: "button", textContent: label, onclick: () => reply(kind) });
    dialog.replaceChildren(head,
      h("p", { className: "muted sw-count", textContent: `${i + 1} of ${queue.length}` }),
      h("div", { className: "sw-task" },
        h("div", { className: "now-meta" }, ...pieces(t.project, sizeText(t.size), was)),
        h("div", { className: "now-title", dir: "auto", textContent: t.title })),
      h("div", { className: "sw-answers" }, btn("today", "Today", "primary"), btn("week", "This week"), btn("someday", "Someday"), btn("drop", "Drop", "quiet danger")),
      undoLine);
  }

  const unsub = watchTasks(uid, (ts) => { tasks = ts; if (dialog.open) paint(); }, fail);
  dialog.addEventListener("close", () => { stopCal?.(); stopCal = null; });
  dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });

  return {
    // ids: what to go through (Schedule's "Move the rest"); default: every
    // passed date. Opening counts as answering today's offer.
    open(ids){
      queue = ids || sweepList(tasks).map((t) => t.id);
      i = 0; last = null;
      saveSettings(uid, { sweepAnswered: localDate() }).catch(fail);
      stopCal = watchCalendar((c) => { events = c.events || []; });
      paint();
      if (!dialog.open) dialog.showModal();
    },
    unmount(){ unsub(); stopCal?.(); if (dialog.open) dialog.close(); dialog.replaceChildren(); },
  };
}
