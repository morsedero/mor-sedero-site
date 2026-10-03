// The task popup: project, title, size, due — everything else is a default
// or a guess (model.js). Adding stays open so several can go in at once and
// the project is kept between adds; editing closes on save. Labels sit above
// the boxes.
import { watchTasks, addTask, updateTask } from "./store.js";
import { durText } from "./model.js";
import { h } from "./ui.js";

let n = 0;
const field = (label, input) => {
  input.id = `add-f${++n}`;
  return h("div", { className: "field" }, h("label", { htmlFor: input.id, textContent: label }), input);
};

export function mountAddTask(dialog, uid){
  let tasks = [];
  let editing = null; // the task being edited, or null when adding
  const projects = h("datalist", { id: "add-projects" });
  const f = {
    project: h("input", { dir: "auto", autocomplete: "off" }),
    title: h("input", { dir: "auto", required: true, autocomplete: "off" }),
    size: h("select", {}, ...["", 5, 15, 30, 60, 90, 120, 180, 240].map((v) => h("option", { value: v, textContent: v ? durText(v) : "Let Daisey guess" }))),
    due: h("input", { type: "date" }),
  };
  f.project.setAttribute("list", "add-projects");
  const msg = h("p", { className: "muted", role: "status" });
  const form = h("form", { className: "form-grid" },
    field("Project (empty = Inbox)", f.project),
    field("Task", f.title),
    field("Size", f.size),
    field("Due (optional)", f.due),
    h("button", { className: "btn primary", type: "submit", textContent: "Add" }));
  const submit = form.lastChild;
  const heading = h("h2", { id: "addTitle", textContent: "Add task" });

  form.onsubmit = (ev) => {
    ev.preventDefault();
    try {
      if (editing) {
        // Blank size hands it back to Daisey to guess; blank due clears it.
        const changes = { title: f.title.value, project: f.project.value, size: f.size.value, due: f.due.value };
        updateTask(uid, editing, changes, tasks).catch((e) => { console.error("[daisey] edit", e); msg.textContent = "Not saved: " + (e.code || e.message); });
        dialog.close();
        return;
      }
      const input = { title: f.title.value };
      for (const k of ["project", "size", "due"]) if (f[k].value) input[k] = f[k].value;
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
  dialog.replaceChildren(h("div", { className: "now-head" }, heading, close), form, msg, projects);
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
      heading.textContent = "Add task";
      submit.textContent = "Add";
      if (project !== undefined) f.project.value = project;
      if (!dialog.open) dialog.showModal();
      f.project.value || project === "" ? f.title.focus() : f.project.focus();
    },
    // The same popup, filled in: a wrong guess shouldn't be stuck forever.
    edit(task){
      msg.textContent = "";
      editing = task;
      heading.textContent = "Edit task";
      submit.textContent = "Save";
      f.project.value = task.project === "Inbox" ? "" : task.project;
      f.title.value = task.title;
      f.size.value = [...f.size.options].some((o) => o.value === String(task.size)) ? String(task.size) : "";
      f.due.value = task.due || "";
      if (!dialog.open) dialog.showModal();
      f.title.focus();
    },
    unmount(){ unsub(); if (dialog.open) dialog.close(); dialog.replaceChildren(); },
  };
}
