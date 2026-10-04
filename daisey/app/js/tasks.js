// The Tasks view: two ways to look at the same tasks, and a toggle between
// them (Mor, 2026-10-04 — "both, toggled").
//
//   List     — one vertical scroll, grouped by WHEN: Overdue, Today, This
//              week, Later, Anytime, Waiting. The project is a chip on the
//              row, and a chip row at the top filters to one project. This is
//              the deciding view: the dimension that matters when you're
//              choosing is time, not which project a thing belongs to.
//   Projects — a column per project, the old Google-Tasks/Trello shape, for
//              looking at one body of work whole. It gets what it was
//              missing: a sticky project header and a row of dots, so you
//              can see that a fourth column exists and jump to it.
//
// The chosen view is remembered in localStorage, so a reload lands back where
// you were (the pane's tab already does this through the hash).
//
// Tapping a row ANYWHERE opens the task sheet (addtask.js in edit mode) —
// fields, Waiting on, Delete, "Do this now". There is no ⋯ menu any more and
// nothing here calls prompt() or confirm(); the one instant action left is
// the circle, and that gets an Undo toast.
//
// The task on the Now card stays in place, marked "now", and still counts in
// its project's total (Mor, 2026-10-03: it shouldn't vanish from the list
// while it's on the card).
import { watchTasks, finishTask, restoreTask } from "./store.js";
import { INBOX, notYet, localDate } from "./model.js";
import { h, bdi, pieces, sizeText, flash } from "./ui.js";

const VIEW_KEY = "daisey.tasksView";
const readView = () => { try { return localStorage.getItem(VIEW_KEY) === "projects" ? "projects" : "list"; } catch { return "list"; } };
const saveView = (v) => { try { localStorage.setItem(VIEW_KEY, v); } catch { /* private window */ } };

const shortDate = (s) => new Date(`${s}T12:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
const dayFrom = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return localDate(d.getTime()); };

// Which section of the List view a task falls in. Waiting outranks a date:
// a task you can't act on isn't due today however its date reads.
function bucketOf(t, today, weekEnd){
  if (t.status === "waiting" || notYet(t)) return "waiting";
  if (!t.due) return "anytime";
  if (t.due < today) return "overdue";
  if (t.due === today) return "today";
  return t.due <= weekEnd ? "week" : "later";
}
const SECTIONS = [
  ["overdue", "Overdue"],
  ["today", "Today"],
  ["week", "This week"],
  ["later", "Later"],
  ["anytime", "Anytime"],
  ["waiting", "Waiting"],
];

export function mountTasks(root, uid, { onAdd, onOpen } = {}){
  let tasks = null, onCard = null;
  let view = readView();
  let project = null; // the List view's project filter; null = all
  let doneOpen = false; // the List view's Completed fold
  const openDone = new Set(); // same, per column, in the Projects view
  const fail = (e) => console.error("[daisey] tasks", e);

  // Completing is the one thing that happens without the sheet, so it is the
  // one thing that needs taking back. Reopening needs no undo: it's the same
  // circle again.
  function complete(t){
    const before = { status: t.status || "ready", doneAt: t.doneAt ?? null, skipsSinceStart: t.skipsSinceStart ?? 0 };
    finishTask(uid, t).catch(fail);
    flash("Done: ", t.title, { undo: () => restoreTask(uid, t.id, before).catch(fail) });
  }

  function circle(t, done){
    return h("button", { type: "button", className: "tk-check" + (done ? " done" : ""),
      ariaLabel: done ? `Reopen ${t.title}` : `Complete ${t.title}`, textContent: done ? "✓" : "",
      onclick: (e) => { e.stopPropagation(); done ? restoreTask(uid, t.id, { status: "ready", doneAt: null }).catch(fail) : complete(t); } });
  }

  // One row shape for both views. `withProject` only in the List view, where
  // the column header isn't there to say it.
  function row(t, { withProject } = {}){
    const isNow = t.id === onCard;
    const meta = pieces(sizeText(t.size),
      t.due && `due ${shortDate(t.due)}${t.dueTime ? " " + t.dueTime : ""}`,
      notYet(t) && `not before ${shortDate(t.notBefore)}`,
      t.status === "waiting" && `waiting${t.waitingOn ? " on " + t.waitingOn : ""}`);
    return h("li", { className: "tk-row" + (t.status === "waiting" || notYet(t) ? " waiting" : "") + (isNow ? " is-now" : "") },
      circle(t, false),
      h("button", { type: "button", className: "tk-open", ariaLabel: `Open ${t.title}`, onclick: () => onOpen?.(t) },
        h("div", { className: "tk-title" }, bdi(t.title),
          isNow && h("span", { className: "tk-now", title: "On the Now card", textContent: "now" })),
        h("div", { className: "tk-meta" },
          withProject && t.project !== INBOX && h("span", { className: "tk-tag" }, bdi(t.project)),
          h("span", { className: "muted" }, ...meta)),
        t.notes && h("div", { className: "muted tk-notes", dir: "auto", textContent: t.notes })));
  }

  const doneRow = (t) => h("li", { className: "tk-row done" }, circle(t, true),
    h("button", { type: "button", className: "tk-open", ariaLabel: `Open ${t.title}`, onclick: () => onOpen?.(t) },
      h("div", { className: "tk-title", dir: "auto", textContent: t.title }),
      t.doneAt && h("div", { className: "muted tk-meta", textContent: `done ${new Date(t.doneAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}` })));

  // On the card first, then waiting last, then by due, newest last.
  const order = (a, b) => (b.id === onCard) - (a.id === onCard)
    || (a.status === "waiting") - (b.status === "waiting")
    || (a.due || "9999").localeCompare(b.due || "9999")
    || b.createdAt - a.createdAt;

  const fold = (label, kids, open, onToggle) => h("details", { className: "tk-done", open,
    ontoggle: (e) => onToggle(e.currentTarget.open) },
    h("summary", { textContent: label }), h("ul", { className: "tk-list" }, ...kids));

  // ---------- the two views ----------

  function listView(open, done){
    const names = [...new Set(open.map((t) => t.project))].sort((a, b) => (b === INBOX) - (a === INBOX) || a.localeCompare(b));
    const shown = project ? open.filter((t) => t.project === project) : open;
    const today = localDate(), weekEnd = dayFrom(7);
    const groups = new Map(SECTIONS.map(([k]) => [k, []]));
    for (const t of shown) groups.get(bucketOf(t, today, weekEnd)).push(t);

    const chip = (name, label, count) => h("button", { type: "button", className: "chip", role: "radio",
      ariaChecked: String(project === name), onclick: () => { project = name; render(); } },
      bdi(label), h("span", { className: "chip-n", textContent: String(count) }));

    const sections = SECTIONS.filter(([k]) => groups.get(k).length).map(([k, label]) => {
      const items = groups.get(k).sort(order);
      return h("section", { className: "tk-sec" + (k === "waiting" ? " quiet" : ""), ariaLabel: label },
        h("h3", { className: "tk-sec-h" }, h("span", { textContent: label }), h("span", { className: "muted", textContent: String(items.length) })),
        h("ul", { className: "tk-list" }, ...items.map((t) => row(t, { withProject: !project }))));
    });

    return h("div", { className: "tk-single" },
      names.length > 1 && h("div", { className: "tk-filters", role: "radiogroup", ariaLabel: "Filter by project" },
        chip(null, "All", open.length), ...names.map((n) => chip(n, n, open.filter((t) => t.project === n).length))),
      sections.length ? h("div", { className: "tk-secs" }, ...sections)
        : h("p", { className: "muted tk-note", textContent: project ? "Nothing open in this project." : "Nothing open. All done." }),
      h("button", { type: "button", className: "tk-add", textContent: "+ Add a task", onclick: () => onAdd?.(project ?? undefined) }),
      done.length > 0 && fold(`Completed (${done.length})`, done.sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0)).slice(0, 50).map(doneRow),
        doneOpen, (o) => { doneOpen = o; }));
  }

  function columns(open, done){
    const byProject = new Map();
    for (const t of [...open, ...done]) {
      if (!byProject.has(t.project)) byProject.set(t.project, []);
      byProject.get(t.project).push(t);
    }
    const names = [...byProject.keys()].sort((a, b) => (b === INBOX) - (a === INBOX) || a.localeCompare(b));
    const cols = names.map((name) => {
      const all = byProject.get(name);
      const live = all.filter((t) => t.status !== "done").sort(order);
      const over = all.filter((t) => t.status === "done").sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
      return h("section", { className: "tk-col", ariaLabel: name },
        h("header", { className: "tk-head" },
          h("h3", { dir: "auto", textContent: name }),
          h("span", { className: "muted", textContent: String(live.length) })),
        live.length ? h("ul", { className: "tk-list" }, ...live.map((t) => row(t)))
          : h("p", { className: "muted tk-note", textContent: "All done here." }),
        h("button", { type: "button", className: "tk-add", textContent: "+ Add a task", onclick: () => onAdd?.(name === INBOX ? "" : name) }),
        over.length > 0 && fold(`Completed (${over.length})`, over.map(doneRow), openDone.has(name),
          (o) => { o ? openDone.add(name) : openDone.delete(name); }));
    });

    // The dots say how many columns there are and which one you're on —
    // sideways scroll with nothing beyond the edge is invisible otherwise.
    const dots = h("div", { className: "tk-dots", role: "tablist", ariaLabel: "Projects" },
      ...names.map((n, i) => h("button", { type: "button", className: "tk-dot", ariaLabel: n, ariaSelected: String(i === 0),
        onclick: () => { const b = board.children[i]; b?.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" }); } })));
    const board = h("div", { className: "tk-board" }, ...cols);
    const mark = () => {
      const i = Math.round(Math.abs(board.scrollLeft) / (board.scrollWidth / Math.max(1, names.length)));
      for (const [j, d] of [...dots.children].entries()) d.setAttribute("aria-selected", String(j === Math.min(i, names.length - 1)));
    };
    board.onscroll = mark;
    return h("div", { className: "tk-wrap" }, board, names.length > 1 && dots);
  }

  // ---------- frame ----------

  const tabs = () => {
    const seg = (v, label) => h("button", { type: "button", className: "seg-btn", role: "tab", ariaSelected: String(view === v),
      textContent: label, onclick: () => { view = v; saveView(v); render(); } });
    return h("div", { className: "seg", role: "tablist", ariaLabel: "How to arrange tasks" }, seg("list", "List"), seg("projects", "Projects"));
  };

  // Keeps the scroll position of whichever view is being redrawn.
  function fill(body){
    const old = root.querySelector(".tk-board, .tk-single");
    const x = old?.scrollLeft || 0, y = old?.scrollTop || 0;
    root.replaceChildren(h("div", { className: "tk-top" }, tabs()), body);
    const next = root.querySelector(".tk-board, .tk-single");
    if (next) { next.scrollLeft = x; next.scrollTop = y; }
  }

  function render(){
    if (tasks == null) { root.replaceChildren(h("p", { className: "muted", textContent: "Loading tasks…" })); return; }
    if (!tasks.length) {
      root.replaceChildren(h("div", { className: "tk-empty card" }, h("p", { textContent: "No tasks yet." }),
        h("button", { className: "btn primary", type: "button", textContent: "+ Add task", onclick: () => onAdd?.() })));
      return;
    }
    const open = tasks.filter((t) => t.status !== "done");
    const done = tasks.filter((t) => t.status === "done");
    if (project && !open.some((t) => t.project === project)) project = null; // the filtered project emptied out
    fill(view === "projects" ? columns(open, done) : listView(open, done));
  }

  const unsub = watchTasks(uid, (ts) => { tasks = ts; render(); }, fail);
  render();

  return {
    setCurrent(id){ onCard = id; render(); },
    unmount(){ unsub(); root.replaceChildren(); },
  };
}
