// The task popup: project, title, size, due — everything else is a default
// or a guess (model.js). Adding stays open so several can go in at once and
// the project is kept between adds; editing closes on save. Labels sit above
// the boxes.
//
// In edit mode it is the task SHEET (Mor, 2026-10-04): tapping a row in the
// Tasks view lands here, so everything you can do to one task is in one
// place. That is why "Waiting on" is a field rather than an action — typing
// into it sets the task Waiting, clearing it hands the task back (editTask
// already infers the first half; this file says the second half out loud) —
// and why Delete is a two-press button here instead of a confirm() dialog.
import { watchTasks, addTask, updateTask, removeTask } from "./store.js";
import { durText } from "./model.js";
import { h, flash } from "./ui.js";

let n = 0;
const field = (label, input, wide) => {
  input.id = `add-f${++n}`;
  return h("div", { className: "field" + (wide ? " wide" : "") }, h("label", { htmlFor: input.id, textContent: label }), input);
};

// onNow(id) puts the task on the Now card (now.js), so the sheet can answer
// "do this one next" without hunting for it through Switch.
export function mountAddTask(dialog, uid, { onNow } = {}){
  let tasks = [];
  let editing = null; // the task being edited, or null when adding
  const projects = h("datalist", { id: "add-projects" });
  const f = {
    project: h("input", { dir: "auto", autocomplete: "off" }),
    title: h("input", { dir: "auto", required: true, autocomplete: "off" }),
    size: h("select", {}, ...["", 5, 15, 30, 60, 90, 120, 180, 240].map((v) => h("option", { value: v, textContent: v ? durText(v) : "Let Daisey guess" }))),
    due: h("input", { type: "date" }),
    notBefore: h("input", { type: "date" }),
    waitingOn: h("input", { dir: "auto", autocomplete: "off", placeholder: "nobody" }),
    notes: h("textarea", { dir: "auto", rows: 2 }),
  };
  f.project.setAttribute("list", "add-projects");
  const msg = h("p", { className: "muted", role: "status" });
  // Waiting only exists for a task that already exists: you don't add one
  // already blocked (model.js's note on Waiting).
  const waitField = field("Waiting on", f.waitingOn);
  const form = h("form", { className: "form-grid" },
    field("Project (empty = Inbox)", f.project),
    field("Task", f.title),
    field("Size", f.size),
    field("Due (optional)", f.due),
    field("Not before (optional)", f.notBefore),
    waitField,
    field("Notes (optional)", f.notes, true),
    h("button", { className: "btn primary", type: "submit", textContent: "Add" }));
  const submit = form.lastChild;
  const heading = h("h2", { id: "addTitle", dir: "auto", textContent: "Add task" });

  // The sheet's own actions, under the fields and only when editing.
  let armed = false; // Delete pressed once; the next press does it
  const doNow = h("button", { className: "btn", type: "button", textContent: "Do this now",
    onclick: () => { if (editing) { onNow?.(editing.id); dialog.close(); } } });
  const del = h("button", { className: "btn quiet danger", type: "button", textContent: "Delete" });
  del.onclick = () => {
    if (!editing) return;
    if (!armed) { armed = true; del.textContent = "Really delete?"; del.classList.add("arm"); return; }
    const gone = editing;
    dialog.close();
    removeTask(uid, gone.id).catch((e) => { console.error("[daisey] delete", e); flash("Couldn't delete ", gone.title); });
    flash("Deleted ", gone.title);
  };
  const actions = h("div", { className: "sheet-actions" }, doNow, del);
  const disarm = () => { armed = false; del.textContent = "Delete"; del.classList.remove("arm"); };

  form.onsubmit = (ev) => {
    ev.preventDefault();
    try {
      if (editing) {
        // Blank size hands it back to Daisey to guess; blank due clears it.
        const changes = { title: f.title.value, project: f.project.value, size: f.size.value,
          due: f.due.value, notBefore: f.notBefore.value, notes: f.notes.value, waitingOn: f.waitingOn.value };
        // Emptying "Waiting on" is how a task stops waiting; filling it in is
        // handled by editTask. A done task's status is left alone — the
        // circle in the list is what reopens one.
        if (editing.status === "waiting" && !f.waitingOn.value.trim()) changes.status = "ready";
        updateTask(uid, editing, changes, tasks).catch((e) => { console.error("[daisey] edit", e); msg.textContent = "Not saved: " + (e.code || e.message); });
        dialog.close();
        return;
      }
      const input = { title: f.title.value };
      for (const k of ["project", "size", "due", "notBefore", "notes"]) if (f[k].value) input[k] = f[k].value;
      // Resolves on server ack, which never comes offline; the list already
      // shows the task locally, so don't wait.
      addTask(uid, input, tasks).catch((e) => { console.error("[daisey] add", e); msg.textContent = "Not saved: " + (e.code || e.message); });
      msg.textContent = `Added “${f.title.value.trim()}”.`;
      const project = f.project.value;
      form.reset();
      f.project.value = project; // usually adding several to one project
      f.title.focus();
    } catch (e) { msg.textContent = e.message || String(e); }
  };

  const close = h("button", { className: "now-x", type: "button", ariaLabel: "Close", textContent: "✕", onclick: () => dialog.close() });
  dialog.replaceChildren(h("div", { className: "now-head" }, heading, close), form, actions, msg, projects);
  dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });

  const unsub = watchTasks(uid, (ts) => {
    tasks = ts;
    const names = [...new Set(ts.map((t) => t.project))].sort();
    projects.replaceChildren(...names.map((p) => h("option", { value: p })));
  }, (e) => console.error("[daisey] add", e));

  return {
    // project: prefill from a Tasks column ("" = Inbox); omitted = keep the last one.
    open(project){
      msg.textContent = "";
      editing = null;
      disarm();
      heading.textContent = "Add task";
      submit.textContent = "Add";
      waitField.hidden = true;
      actions.hidden = true;
      if (project !== undefined) f.project.value = project;
      if (!dialog.open) dialog.showModal();
      f.project.value || project === "" ? f.title.focus() : f.project.focus();
    },
    // The same popup, filled in: a wrong guess shouldn't be stuck forever.
    edit(task){
      msg.textContent = "";
      editing = task;
      disarm();
      heading.textContent = task.title.length > 28 ? "Task" : task.title;
      submit.textContent = "Save";
      waitField.hidden = task.status === "done";
      actions.hidden = false;
      doNow.hidden = task.status === "done";
      f.waitingOn.value = task.waitingOn || "";
      f.project.value = task.project === "Inbox" ? "" : task.project;
      f.title.value = task.title;
      f.size.value = [...f.size.options].some((o) => o.value === String(task.size)) ? String(task.size) : "";
      f.due.value = task.due || "";
      f.notBefore.value = task.notBefore || "";
      f.notes.value = task.notes || "";
      if (!dialog.open) dialog.showModal();
      f.title.focus();
    },
    unmount(){ unsub(); if (dialog.open) dialog.close(); dialog.replaceChildren(); },
  };
}
