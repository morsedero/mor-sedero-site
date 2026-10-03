// TEMPORARY debug list at ?debug (session 2). See what Daisey filled in
// for each task, mark it Waiting or Done. Adding is the "+ Add task" popup. Open and Done are two tabs; Done is
// there for the satisfaction of seeing it. Goes away once the Now card
// (session 4) exists.
import { watchTasks, updateTask, finishTask, removeTask } from "./store.js";

const h = (tag, props = {}, ...kids) => {
  const el = Object.assign(document.createElement(tag), props);
  el.append(...kids.filter((k) => k != null && k !== false));
  return el;
};

export function mountDebug(root, uid){
  let tasks = [];
  let tab = "open";
  let lastMeta = {};
  const msg = h("p", { className: "msg", role: "alert" });
  const fail = (e) => { console.error("[daisey] debug", e); msg.textContent = e.message || String(e); };

  const tabBtn = (id) => h("button", { type: "button", role: "tab", className: "dbg-tab", onclick: () => { tab = id; render(lastMeta); } });
  const tabs = { open: tabBtn("open"), done: tabBtn("done") };
  const offline = h("span", { className: "muted" });
  const list = h("ul", { className: "dbg-list" });
  root.replaceChildren(h("h2", { className: "label", textContent: "Tasks (debug)" }), msg,
    h("div", { className: "dbg-tabs", role: "tablist" }, tabs.open, tabs.done, offline), list);

  function row(t){
    const g = (field, v) => (t.guessed || []).includes(field) ? `${v} (guess)` : v;
    const meta = [
      g("size", `${t.size} min`),
      t.due && `due ${t.due}${t.dueTime ? " " + t.dueTime : ""}`,
      t.status === "waiting" && `waiting${t.waitingOn ? " on " + t.waitingOn : ""}`,
      t.canSplit && "can split",
    ].filter(Boolean).join(" · ");
    const act = (label, fn) => h("button", { className: "btn small", type: "button", textContent: label, onclick: () => fn()?.catch(fail) });
    return h("li", { className: "dbg-task" + (t.status === "waiting" ? " off" : "") },
      h("div", { className: "dbg-project", dir: "auto", textContent: t.project }),
      h("div", { className: "dbg-title", dir: "auto", textContent: t.title }),
      h("div", { className: "muted", textContent: meta }),
      h("div", { className: "dbg-actions" },
        act("Done", () => finishTask(uid, t)),
        t.status === "ready" && act("Waiting…", () => {
          const who = prompt("Waiting on who or what?");
          return who == null ? null : updateTask(uid, t, { waitingOn: who || "something", status: "waiting" }, tasks);
        }),
        t.status === "waiting" && act("Ready", () => updateTask(uid, t, { status: "ready" }, tasks)),
        act("Delete", () => removeTask(uid, t.id))));
  }

  function doneRow(t){
    const when = t.doneAt ? new Date(t.doneAt).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }) : "";
    const act = (label, fn) => h("button", { className: "btn small", type: "button", textContent: label, onclick: () => fn().catch(fail) });
    return h("li", { className: "dbg-task" },
      h("div", { className: "dbg-project", dir: "auto", textContent: t.project }),
      h("div", { className: "dbg-title done", dir: "auto", textContent: "✓ " + t.title }),
      h("div", { className: "muted", textContent: `done ${when}` }),
      h("div", { className: "dbg-actions" },
        act("Reopen", () => updateTask(uid, t, { status: "ready" }, tasks)),
        act("Delete", () => removeTask(uid, t.id))));
  }

  function render(meta = {}){
    lastMeta = meta;
    const open = tasks.filter((t) => t.status !== "done")
      .sort((a, b) => (a.status === "waiting") - (b.status === "waiting") || b.createdAt - a.createdAt);
    const done = tasks.filter((t) => t.status === "done").sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
    tabs.open.textContent = `Open ${open.length}`;
    tabs.done.textContent = `Done ${done.length}`;
    for (const id of ["open", "done"]) tabs[id].setAttribute("aria-selected", String(tab === id));
    offline.textContent = meta.fromCache ? "offline copy" : "";
    list.replaceChildren(...(tab === "open" ? open.map(row) : done.map(doneRow)));
  }

  root.hidden = false;
  const unsub = watchTasks(uid, (ts, meta) => { tasks = ts; render(meta); }, fail);
  return () => { unsub(); root.hidden = true; root.replaceChildren(); };
}
