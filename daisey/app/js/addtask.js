// "Add task" popup: project, title, size, due — everything else is a default
// or a guess (model.js). Stays open after adding so several can go in at
// once; the project is kept between adds. Labels sit above the boxes.
import { watchTasks, addTask } from "./store.js";
import { h } from "./ui.js";

let n = 0;
const field = (label, input) => {
  input.id = `add-f${++n}`;
  return h("div", { className: "field" }, h("label", { htmlFor: input.id, textContent: label }), input);
};

export function mountAddTask(dialog, uid){
  let tasks = [];
  const projects = h("datalist", { id: "add-projects" });
  const f = {
    project: h("input", { dir: "auto", autocomplete: "off" }),
    title: h("input", { dir: "auto", required: true, autocomplete: "off" }),
    size: h("select", {}, ...["", 5, 15, 30, 60, 90, 120].map((v) => h("option", { value: v, textContent: v ? `${v} min` : "Let Daisey guess" }))),
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

  form.onsubmit = (ev) => {
    ev.preventDefault();
    try {
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
  dialog.replaceChildren(h("div", { className: "now-head" }, h("h2", { id: "addTitle", textContent: "Add task" }), close), form, msg, projects);
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
      if (project !== undefined) f.project.value = project;
      if (!dialog.open) dialog.showModal();
      f.project.value || project === "" ? f.title.focus() : f.project.focus();
    },
    unmount(){ unsub(); if (dialog.open) dialog.close(); dialog.replaceChildren(); },
  };
}
