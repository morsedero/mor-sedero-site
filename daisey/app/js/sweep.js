// The sweep: old dates, one task at a time, four answers — Today · This week
// · Someday · Drop (DAISEY_SPEC "Overdue triage"). Offered from the Now tab
// when too many dates have passed (triage.shouldOffer), and later from the
// Schedule's "Move the rest" with a list of its own.
//
// "This week" puts the task on the day with the most room this week
// (triage.pickWeekDay: calendar events plus what's already dated there).
// Mor asked for Gemini to choose; until chat exists, the engine does.
//
// Each answer writes straight away and the next unanswered task slides in.
// ‹ › (or a sideways swipe, or the arrow keys) skim the list without
// answering; an answered task shows its answer, which can be changed or
// undone. The list is fixed when the sheet opens.
import { watchTasks, restoreTask, saveSettings } from "./store.js";
import { watchCalendar } from "./calendar.js";
import { sweepList, pickWeekDay, answer, answerSnapshot } from "./triage.js";
import { localDate } from "./model.js";
import { h, bdi, pieces, sizeText } from "./ui.js";

const shortDate = (s) => new Date(`${s}T12:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });

export function mountSweep(dialog, uid){
  let tasks = [], events = [];
  let queue = [], i = 0;
  // id → { said, before }: what each task was answered, and how it was
  // before, so Undo — or a second answer — starts from the original.
  let answered = new Map();
  let lastId = null; // the most recent answer, for the Undo line
  let stopCal = null;
  const fail = (e) => console.error("[daisey] sweep", e);
  const find = (id) => tasks.find((t) => t.id === id);

  // The next task still unanswered after `from`, wrapping round; -1 if none.
  function nextOpen(from){
    for (let k = 1; k <= queue.length; k++) {
      const j = (from + k) % queue.length;
      if (!answered.has(queue[j])) return j;
    }
    return -1;
  }

  function reply(kind){
    const t = find(queue[i]);
    if (!t) return;
    const now = Date.now();
    const week = kind === "week" ? pickWeekDay(t, { events, tasks, now }) : null;
    const said = { today: "Today", week: `This week: ${week && shortDate(week)}`, someday: "Someday", drop: "Dropped" }[kind];
    // Answering again changes the answer; Undo still goes back to the start.
    const before = answered.get(t.id)?.before ?? answerSnapshot(t);
    const base = { ...t, ...before };
    answered.set(t.id, { said, before });
    lastId = t.id;
    restoreTask(uid, t.id, { ...before, ...answer(kind, base, { now, week }) }).catch(fail);
    const j = nextOpen(i);
    i = j < 0 ? queue.length : j; // past the end = the summary
    paint("next");
  }

  function undo(id = lastId){
    const a = answered.get(id);
    if (!a) return;
    restoreTask(uid, id, a.before).catch(fail);
    tasks = tasks.map((t) => (t.id === id ? { ...t, ...a.before } : t));
    answered.delete(id);
    if (lastId === id) lastId = null;
    i = Math.max(0, queue.indexOf(id));
    paint();
  }

  // Skim: back and forth through the list without answering.
  function go(step){
    const j = Math.min(queue.length - 1, Math.max(0, (i >= queue.length ? queue.length : i) + step));
    if (j === i) return;
    const dir = step > 0 ? "next" : "prev";
    i = j;
    paint(dir);
  }

  const fill = (...kids) => dialog.replaceChildren(...kids.filter(Boolean));

  function paint(dir){
    queue = queue.filter((id) => find(id)); // deleted elsewhere: gone from the list
    if (i > queue.length) i = queue.length;
    const head = h("div", { className: "now-head" },
      h("h2", { id: "swTitle", textContent: "Old dates" }),
      h("button", { className: "now-x", type: "button", ariaLabel: "Close", textContent: "✕", onclick: () => dialog.close() }));
    const lastT = lastId && find(lastId);
    const undoLine = lastT && answered.has(lastId) && h("p", { className: "muted sw-last" }, `${answered.get(lastId).said}: `, bdi(lastT.title), " ",
      h("button", { className: "linkish", type: "button", textContent: "Undo", onclick: () => undo() }));
    const left = queue.length - answered.size;
    if (i >= queue.length) {
      fill(head,
        h("p", { className: "sw-done", textContent: !queue.length ? "Nothing to sort." : left ? `${left} left as they are.` : "All sorted." }),
        undoLine,
        h("div", { className: "sheet-actions" },
          queue.length > 0 && h("button", { className: "btn", type: "button", textContent: "Look again", onclick: () => { i = 0; paint("prev"); } }),
          h("button", { className: "btn primary", type: "button", textContent: "Close", onclick: () => dialog.close() })));
      return;
    }
    const t = find(queue[i]);
    const a = answered.get(t.id);
    const was = `${t.dateKind === "deadline" ? "deadline was" : "planned for"} ${shortDate(a?.before.due ?? t.due)}`;
    const btn = (kind, label, cls = "") => h("button", { className: "btn " + cls, type: "button", textContent: label, onclick: () => reply(kind) });
    const nav = (step, label, glyph) => h("button", { className: "sw-nav", type: "button", ariaLabel: label, textContent: glyph,
      disabled: step < 0 ? i === 0 : i >= queue.length - 1, onclick: () => go(step) });
    const card = h("div", { className: "sw-task" + (dir ? " in-" + dir : "") + (a ? " answered" : "") },
      h("div", { className: "now-meta" }, ...pieces(t.project, sizeText(t.size), was)),
      h("div", { className: "now-title", dir: "auto", textContent: t.title }),
      a && h("p", { className: "sw-said" }, `✓ ${a.said} `,
        h("button", { className: "linkish", type: "button", textContent: "Undo", onclick: () => undo(t.id) })));
    swipe(card);
    fill(head,
      h("div", { className: "sw-bar" }, nav(-1, "Previous task", "‹"),
        h("p", { className: "muted sw-count", textContent: `${i + 1} of ${queue.length}` + (answered.size ? ` · ${answered.size} sorted` : "") }),
        nav(1, "Next task", "›")),
      card,
      h("div", { className: "sw-answers" }, btn("today", "Today", "primary"), btn("week", "This week"), btn("someday", "Someday"), btn("drop", "Drop", "quiet danger")),
      lastId !== t.id && undoLine);
  }

  // A sideways swipe on the card skims, like the arrows. Vertical moves are
  // left to the page (there's nothing to scroll behind the sheet anyway).
  function swipe(el){
    let x0 = null, y0 = 0;
    el.addEventListener("pointerdown", (e) => { x0 = e.clientX; y0 = e.clientY; });
    el.addEventListener("pointerup", (e) => {
      if (x0 == null) return;
      const dx = e.clientX - x0, dy = e.clientY - y0;
      x0 = null;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
    });
    el.addEventListener("pointercancel", () => { x0 = null; });
  }

  dialog.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") { go(1); e.preventDefault(); }
    if (e.key === "ArrowLeft") { go(-1); e.preventDefault(); }
  });

  const unsub = watchTasks(uid, (ts) => { tasks = ts; if (dialog.open) paint(); }, fail);
  dialog.addEventListener("close", () => { stopCal?.(); stopCal = null; });
  dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });

  return {
    // ids: what to go through (Schedule's "Move the rest"); default: every
    // passed date. Opening counts as answering today's offer.
    open(ids){
      queue = ids || sweepList(tasks).map((t) => t.id);
      i = 0; answered = new Map(); lastId = null;
      saveSettings(uid, { sweepAnswered: localDate() }).catch(fail);
      stopCal = watchCalendar((c) => { events = c.events || []; });
      paint();
      if (!dialog.open) dialog.showModal();
    },
    unmount(){ unsub(); stopCal?.(); if (dialog.open) dialog.close(); dialog.replaceChildren(); },
  };
}
