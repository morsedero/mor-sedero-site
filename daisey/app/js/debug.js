// TEMPORARY debug list at ?debug (session 2). Add a task, see what Daisey
// filled in, mark it Waiting or Done. Open and Done are two tabs; Done is
// there for the satisfaction of seeing it. Goes away once the Now card
// (session 4) exists.
import { watchTasks, addTask, updateTask, finishTask, removeTask } from "./store.js";

const h = (tag, props = {}, ...kids) => {
  const el = Object.assign(document.createElement(tag), props);
  el.append(...kids.filter((k) => k != null && k !== false));
  return el;
};

// Label above the box, so it stays visible while typing.
let n = 0;
const field = (label, input) => {
  input.id = `dbg-f${++n}`;
  return h("div", { className: "dbg-field" }, h("label", { htmlFor: input.id, textContent: label }), input);
};

export function mountDebug(root, uid){
  let tasks = [];
  let tab = "open";
  let lastMeta = {};
  const msg = h("p", { className: "msg", role: "alert" });
  const fail = (e) => { console.error("[daisey] debug", e); msg.textContent = e.message || String(e); };

  const f = {
    project: h("input", { dir: "auto" }),
    title: h("input", { dir: "auto", required: true }),
    size: h("select", {}, ...["", 5, 15, 30, 60, 90, 120].map((v) => h("option", { value: v, textContent: v ? `${v} min` : "Let Daisey guess" }))),
    due: h("input", { type: "date" }),
  };
  const form = h("form", { className: "dbg-form" },
    field("Project (empty = Inbox)", f.project),
    field("Task", f.title),
    field("Size", f.size),
    field("Due (optional)", f.due),
    h("button", { className: "btn primary", type: "submit", textContent: "Add task" }));
  form.onsubmit = (ev) => {
    ev.preventDefault();
    msg.textContent = "";
    try {
      const input = { title: f.title.value };
      for (const k of ["project", "size", "due"]) if (f[k].value) input[k] = f[k].value;
      addTask(uid, input, tasks).catch(fail);
      const project = f.project.value;
      form.reset();
      f.project.value = project; // usually adding several to one project
      f.title.focus();
    } catch (e) { fail(e); }
  };

  const tabBtn = (id) => h("button", { type: "button", role: "tab", className: "dbg-tab", onclick: () => { tab = id; render(lastMeta); } });
  const tabs = { open: tabBtn("open"), done: tabBtn("done") };
  const offline = h("span", { className: "muted" });
  const list = h("ul", { className: "dbg-list" });
  root.replaceChildren(h("h2", { className: "label", textContent: "Tasks (debug)" }), form, msg,
    h("div", { className: "dbg-tabs", role: "tablist" }, tabs.open, tabs.done, offline), list);

  function row(t){
    const g = (field, v) => (t.guessed || []).includes(field) ? `${v} (guess)` : v;
    const meta = [
      g("size", `${t.size} min`), `energy ${g("energy", t.energy)}`,
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
