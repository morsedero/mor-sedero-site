// The Tasks view: every task, one column per project, like Google Tasks.
// Tap the circle to complete; completed tasks fold into "Completed (n)" at
// the bottom of their column (the Done list "for satisfaction"), and
// tapping the circle there reopens one. ⋯ holds Waiting and Delete.
// The task on the Now card is set aside while it's there (Mor: it's
// "physically" on the card) and comes back when the card moves on or it's
// done.
import { watchTasks, updateTask, finishTask, removeTask } from "./store.js";
import { INBOX } from "./model.js";
import { h, bdi, pieces, sizeText } from "./ui.js";

const shortDate = (s) => new Date(`${s}T12:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });

export function mountTasks(root, uid, { onAdd } = {}){
  let tasks = null, onCard = null, menuFor = null;
  const openDone = new Set(); // projects whose Completed fold is open (survives re-renders)
  const fail = (e) => console.error("[daisey] tasks", e);

  function circle(t, done){
    return h("button", { type: "button", className: "tk-check" + (done ? " done" : ""), ariaLabel: done ? `Reopen ${t.title}` : `Complete ${t.title}`,
      textContent: done ? "✓" : "", onclick: () => (done ? updateTask(uid, t, { status: "ready" }, tasks) : finishTask(uid, t)).catch(fail) });
  }

  function menu(t){
    const act = (label, fn) => h("button", { type: "button", className: "tk-menu-item", textContent: label,
      onclick: () => { menuFor = null; render(); fn()?.catch(fail); } });
    return h("div", { className: "tk-menu" },
      t.status === "ready" && act("Waiting on…", () => {
        const who = prompt("Waiting on who or what?");
        return who == null ? null : updateTask(uid, t, { waitingOn: who || "something", status: "waiting" }, tasks);
      }),
      t.status === "waiting" && act("Not waiting any more", () => updateTask(uid, t, { status: "ready" }, tasks)),
      act("Delete", () => (confirm(`Delete “${t.title}”?`) ? removeTask(uid, t.id) : null)));
  }

  function row(t){
    const meta = pieces(sizeText(t.size), t.due && `due ${shortDate(t.due)}${t.dueTime ? " " + t.dueTime : ""}`,
      t.status === "waiting" && `waiting${t.waitingOn ? " on " + t.waitingOn : ""}`);
    return h("li", { className: "tk-row" + (t.status === "waiting" ? " waiting" : "") },
      circle(t, false),
      h("div", { className: "tk-text" },
        h("div", { className: "tk-title", dir: "auto", textContent: t.title }),
        h("div", { className: "muted tk-meta" }, ...meta)),
      h("button", { type: "button", className: "tk-more", ariaLabel: `More for ${t.title}`, ariaExpanded: String(menuFor === t.id), textContent: "⋯",
        onclick: (e) => { e.stopPropagation(); menuFor = menuFor === t.id ? null : t.id; render(); } }),
      menuFor === t.id && menu(t));
  }

  function doneRow(t){
    return h("li", { className: "tk-row done" }, circle(t, true),
      h("div", { className: "tk-text" }, h("div", { className: "tk-title", dir: "auto", textContent: t.title }),
        t.doneAt && h("div", { className: "muted tk-meta", textContent: `done ${new Date(t.doneAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}` })),
      h("button", { type: "button", className: "tk-more", ariaLabel: `Delete ${t.title}`, textContent: "✕",
        onclick: () => { if (confirm(`Delete “${t.title}”?`)) removeTask(uid, t.id).catch(fail); } }));
  }

  function render(){
    if (tasks == null) { root.replaceChildren(h("p", { className: "muted", textContent: "Loading tasks…" })); return; }
    const byProject = new Map();
    for (const t of tasks) {
      if (!byProject.has(t.project)) byProject.set(t.project, []);
      byProject.get(t.project).push(t);
    }
    const names = [...byProject.keys()].sort((a, b) => (b === INBOX) - (a === INBOX) || a.localeCompare(b));
    if (!names.length) {
      root.replaceChildren(h("div", { className: "tk-empty card" }, h("p", { textContent: "No tasks yet." }),
        h("button", { className: "btn primary", type: "button", textContent: "+ Add task", onclick: () => onAdd?.() })));
      return;
    }
    const cols = names.map((name) => {
      const all = byProject.get(name);
      const open = all.filter((t) => t.status !== "done" && t.id !== onCard)
        .sort((a, b) => (a.status === "waiting") - (b.status === "waiting") || (a.due || "9999").localeCompare(b.due || "9999") || b.createdAt - a.createdAt);
      const done = all.filter((t) => t.status === "done").sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
      const carded = all.some((t) => t.id === onCard && t.status !== "done");
      return h("section", { className: "tk-col", ariaLabel: name },
        h("header", { className: "tk-head" },
          h("h3", { dir: "auto", textContent: name }),
          h("span", { className: "muted", textContent: String(open.length) })),
        h("button", { type: "button", className: "tk-add", textContent: "+ Add a task", onclick: () => onAdd?.(name === INBOX ? "" : name) }),
        carded && h("p", { className: "muted tk-note", textContent: "1 on the Now card" }),
        open.length ? h("ul", { className: "tk-list" }, ...open.map(row))
          : !carded && h("p", { className: "muted tk-note", textContent: "All done here." }),
        done.length > 0 && h("details", { className: "tk-done", open: openDone.has(name),
          ontoggle: (e) => { e.currentTarget.open ? openDone.add(name) : openDone.delete(name); } },
          h("summary", { textContent: `Completed (${done.length})` }),
          h("ul", { className: "tk-list" }, ...done.map(doneRow))));
    });
    const x = root.querySelector(".tk-board")?.scrollLeft || 0; // keep the horizontal scroll
    const board = h("div", { className: "tk-board" }, ...cols);
    root.replaceChildren(board);
    board.scrollLeft = x;
  }

  // Tap anywhere else closes an open ⋯ menu.
  const closeMenu = (e) => { if (menuFor && !e.target.closest?.(".tk-menu")) { menuFor = null; render(); } };
  document.addEventListener("click", closeMenu);
  const unsub = watchTasks(uid, (ts) => { tasks = ts; render(); }, fail);
  render();

  return {
    setCurrent(id){ onCard = id; render(); },
    unmount(){ unsub(); document.removeEventListener("click", closeMenu); root.replaceChildren(); },
  };
}
