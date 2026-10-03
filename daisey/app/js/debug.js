// TEMPORARY debug list at ?debug (session 2). Add a task with any subset of
// fields, see what Daisey filled in, mark Done, watch a repeat come back once
// per cycle. Goes away once the Now card (session 4) exists.
import { watchTasks, addTask, updateTask, finishTask, removeTask } from "./store.js";
import { isAvailable, localDate, WEEKDAYS } from "./model.js";

const h = (tag, props = {}, ...kids) => {
  const el = Object.assign(document.createElement(tag), props);
  el.append(...kids.filter((k) => k != null && k !== false));
  return el;
};

// "" → none · "7" → every 7 days · "daily"/"weekly" · "mon thu" → weekdays.
function parseRepeat(s){
  s = s.trim().toLowerCase();
  if (!s) return null;
  if (s === "daily") return { every: 1 };
  if (s === "weekly") return { every: 7 };
  if (/^\d+$/.test(s)) return { every: Number(s) };
  const days = s.split(/[\s,]+/).map((w) => WEEKDAYS.indexOf(w.slice(0, 3)));
  if (days.length && !days.includes(-1)) return { weekdays: days };
  throw new Error(`Repeat "${s}" not understood. Try 7, weekly, or mon thu.`);
}

const repeatText = (r) => !r ? "" : r.weekdays ? "every " + r.weekdays.map((d) => WEEKDAYS[d]).join(", ")
  : r.every === 1 ? "daily" : `every ${r.every} days`;

export function mountDebug(root, uid){
  let tasks = [];
  let showDone = false;
  const msg = h("p", { className: "msg", role: "alert" });
  const fail = (e) => { console.error("[daisey] debug", e); msg.textContent = e.message || String(e); };

  const f = {
    title: h("input", { placeholder: "Title (only required field)", dir: "auto", required: true }),
    project: h("input", { placeholder: "Project", dir: "auto" }),
    size: h("select", {}, ...["", 5, 15, 30, 60, 90, 120].map((v) => h("option", { value: v, textContent: v ? `${v} min` : "size: guess" }))),
    energy: h("select", {}, ...["", "low", "medium", "high"].map((v) => h("option", { value: v, textContent: v || "energy: guess" }))),
    due: h("input", { type: "date" }),
    hardDue: h("input", { type: "checkbox" }),
    repeat: h("input", { placeholder: "Repeat: 7 · weekly · mon thu" }),
    waitingOn: h("input", { placeholder: "Waiting on", dir: "auto" }),
  };
  const form = h("form", { className: "dbg-form" },
    f.title, f.project, f.size, f.energy, f.due,
    h("label", { className: "dbg-check" }, f.hardDue, " hard due"),
    f.repeat, f.waitingOn,
    h("button", { className: "btn primary", type: "submit", textContent: "Add task" }));
  form.onsubmit = (ev) => {
    ev.preventDefault();
    msg.textContent = "";
    try {
      const input = { title: f.title.value };
      for (const k of ["project", "size", "energy", "due", "waitingOn"]) if (f[k].value) input[k] = f[k].value;
      if (f.hardDue.checked) input.hardDue = true;
      const repeat = parseRepeat(f.repeat.value);
      if (repeat) input.repeat = repeat;
      addTask(uid, input, tasks).catch(fail);
      form.reset();
      f.title.focus();
    } catch (e) { fail(e); }
  };

  const doneToggle = h("input", { type: "checkbox", onchange: (e) => { showDone = e.target.checked; render(); } });
  const summary = h("span", { className: "muted" });
  const list = h("ul", { className: "dbg-list" });

  root.replaceChildren(
    h("h2", { className: "label", textContent: "Tasks (debug)" }),
    form, msg,
    h("div", { className: "row" }, summary, h("label", { className: "dbg-check" }, doneToggle, " show done")),
    list);

  function row(t, today){
    const g = (field, v) => (t.guessed || []).includes(field) ? `${v} (guess)` : v;
    const back = t.availableFrom && t.availableFrom > today ? `hidden until ${t.availableFrom}` : null;
    const meta = [
      t.project, g("size", `${t.size} min`), g("energy", t.energy),
      t.due && `due ${t.due}${t.dueTime ? " " + t.dueTime : ""}${t.hardDue ? " (hard)" : ""}`,
      t.status + (t.waitingOn ? `: ${t.waitingOn}` : ""),
      t.canSplit && "can split", repeatText(t.repeat), t.doneCount && `done ×${t.doneCount}`, back,
    ].filter(Boolean).join(" · ");
    const act = (label, fn) => h("button", { className: "btn small", type: "button", textContent: label, onclick: () => fn().catch(fail) });
    return h("li", { className: "dbg-task" + (isAvailable(t, today) ? "" : " off") },
      h("div", { className: "dbg-title", dir: "auto", textContent: t.title }),
      h("div", { className: "muted", textContent: meta }),
      h("div", { className: "dbg-actions" },
        t.status !== "done" && act("Done", () => finishTask(uid, t)),
        t.status === "ready" && act("Wait", () => updateTask(uid, t, { status: "waiting" }, tasks)),
        t.status !== "ready" && act("Ready", () => updateTask(uid, t, { status: "ready" }, tasks)),
        act("Delete", () => removeTask(uid, t.id))));
  }

  function render(meta = {}){
    const today = localDate();
    const shown = tasks.filter((t) => showDone || t.status !== "done")
      .sort((a, b) => isAvailable(b, today) - isAvailable(a, today) || b.createdAt - a.createdAt);
    const avail = tasks.filter((t) => isAvailable(t, today)).length;
    summary.textContent = `${tasks.length} tasks · ${avail} available today` + (meta.fromCache ? " · offline copy" : "");
    list.replaceChildren(...shown.map((t) => row(t, today)));
  }

  root.hidden = false;
  const unsub = watchTasks(uid, (ts, meta) => { tasks = ts; render(meta); }, fail);
  return () => { unsub(); root.hidden = true; root.replaceChildren(); };
}
