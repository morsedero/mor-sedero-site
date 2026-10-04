// The task popup. Title first; everything else is optional (Mor, 2026-10-04).
// As the title is typed, Daisey's guesses for area, type, where, open hours,
// size, stakes and energy appear under it as chips (model.guessFields). A
// dashed chip is a guess; tap it to pick a value and it turns solid — yours.
// "Daisey guesses" in the picker hands it back. Adding stays open so several
// can go in at once and the project is kept between adds; editing closes on
// save. Labels sit above the boxes.
//
// In edit mode it is the task SHEET (Mor, 2026-10-04): tapping a row in the
// Tasks view lands here, so everything you can do to one task is in one
// place. That is why "Waiting on" is a field rather than an action — typing
// into it sets the task Waiting, clearing it hands the task back (editTask
// already infers the first half; this file says the second half out loud) —
// and why Delete is a two-press button here instead of a confirm() dialog.
import { watchTasks, addTask, updateTask, removeTask } from "./store.js";
import { durText, guessFields, validField, CHOICES, LABELS, INBOX } from "./model.js";
import { h, flash } from "./ui.js";

// The guessed fields shown as chips, in order. canSplit stays a quiet
// default with no chip of its own.
const CHIPS = ["area", "type", "where", "openHours", "size", "stakes", "energy"];
const NAMES = { area: "Area", type: "Type", where: "Where", openHours: "Open hours", size: "Size", stakes: "Stakes", energy: "Energy" };
const SIZE_OPTIONS = [5, 15, 30, 60, 90, 120, 180, 240];
const NEXT_STEP_FROM = 90; // minutes; a task this big gets asked for its first step
const valueText = (k, v) => (k === "size" ? durText(v) : LABELS[k][v] ?? "");
const optionsOf = (k) => (k === "size" ? SIZE_OPTIONS : CHOICES[k]);

let n = 0;
const field = (label, input, wide) => {
  input.id ||= `add-f${++n}`;
  return h("div", { className: "field" + (wide ? " wide" : "") }, h("label", { htmlFor: input.id, textContent: label }), input);
};

// onNow(id) puts the task on the Now card (now.js), so the sheet can answer
// "do this one next" without hunting for it through Switch.
export function mountAddTask(dialog, uid, { onNow } = {}){
  let tasks = [];
  let editing = null; // the task being edited, or null when adding
  let vals = {}; // what each chip shows
  let mine = new Set(); // chips the user picked
  let startMine = new Set(); // …as they were when the sheet opened (edit)
  let openChip = null; // the chip whose picker is showing
  let kind = "target"; // the date's kind
  const projects = h("datalist", { id: "add-projects" });
  const f = {
    title: h("input", { id: "addName", dir: "auto", required: true, autocomplete: "off" }),
    project: h("input", { dir: "auto", autocomplete: "off" }),
    due: h("input", { id: "addDue", type: "date" }),
    nextStep: h("input", { dir: "auto", autocomplete: "off" }),
    notBefore: h("input", { type: "date" }),
    waitingOn: h("input", { dir: "auto", autocomplete: "off", placeholder: "nobody" }),
    notes: h("textarea", { dir: "auto", rows: 2 }),
  };
  f.project.setAttribute("list", "add-projects");
  const msg = h("p", { className: "muted", role: "status" });

  const chipRow = h("div", { className: "gchips", role: "group", ariaLabel: "Daisey's guesses — tap one to change it" });
  const picker = h("div", { className: "gpick", role: "radiogroup" });
  const guesses = h("div", { className: "guesses" }, chipRow, picker);

  // Date, and right under it whether the date is real.
  const kindRow = h("div", { className: "kind", role: "radiogroup", ariaLabel: "What kind of date" });
  const dueField = field("Date (optional)", f.due);
  const nextField = field("First step (optional)", f.nextStep, true);
  // Waiting only exists for a task that already exists: you don't add one
  // already blocked (model.js's note on Waiting).
  const waitField = field("Waiting on", f.waitingOn, true);
  const more = h("details", { className: "more wide" }, h("summary", { textContent: "More" }),
    h("div", { className: "form-grid" }, field("Not before (optional)", f.notBefore), field("Notes (optional)", f.notes, true)));
  const submit = h("button", { className: "btn primary", type: "submit", textContent: "Add" });
  const form = h("form", { className: "form-grid" },
    field("Task", f.title, true),
    guesses,
    field("Project (empty = Inbox)", f.project),
    dueField,
    kindRow,
    nextField,
    waitField,
    more,
    submit);
  const heading = h("h2", { id: "addTitle", dir: "auto", textContent: "Add task" });

  // Other tasks teach the guesses ("similar past tasks", the project's own
  // areas); the one being edited must not teach itself.
  const history = () => (editing ? tasks.filter((t) => t.id !== editing.id) : tasks);

  function reguess(){
    const title = f.title.value.trim();
    if (title) {
      const given = Object.fromEntries([...mine].map((k) => [k, vals[k]]));
      const g = guessFields(title, f.project.value.trim() || INBOX, given, history());
      for (const k of CHIPS) if (!mine.has(k)) vals[k] = g[k];
    }
    paint();
  }

  function pick(k, v){
    if (v === null) mine.delete(k); else { mine.add(k); vals[k] = v; }
    openChip = null;
    reguess(); // a picked type re-steers where, hours, size and energy
  }

  function paint(){
    guesses.hidden = !f.title.value.trim();
    chipRow.replaceChildren(...CHIPS.map((k) => {
      const own = mine.has(k);
      return h("button", { type: "button", className: "gchip" + (own ? " mine" : ""), ariaExpanded: String(openChip === k),
        ariaLabel: `${NAMES[k]}: ${valueText(k, vals[k])}, ${own ? "yours" : "Daisey's guess"}. Change`,
        onclick: () => { openChip = openChip === k ? null : k; paint(); } },
      h("span", { className: "gchip-k", textContent: NAMES[k] }), h("bdi", { textContent: valueText(k, vals[k]) }));
    }));
    picker.hidden = !openChip;
    if (openChip) {
      const k = openChip;
      picker.ariaLabel = NAMES[k];
      picker.replaceChildren(
        ...optionsOf(k).map((v) => h("button", { type: "button", className: "chip", role: "radio",
          ariaChecked: String(mine.has(k) && vals[k] === v), textContent: valueText(k, v), onclick: () => pick(k, v) })),
        h("button", { type: "button", className: "chip quiet", role: "radio", ariaChecked: String(!mine.has(k)),
          textContent: "Daisey guesses", onclick: () => pick(k, null) }));
    }
    kindRow.hidden = !f.due.value;
    kindRow.replaceChildren(...[["target", "Target (wish)"], ["deadline", "Deadline (real)"]].map(([v, text]) =>
      h("button", { type: "button", className: "chip", role: "radio", ariaChecked: String(kind === v), textContent: text,
        onclick: () => { kind = v; paint(); } })));
    nextField.hidden = !(vals.size >= NEXT_STEP_FROM || f.nextStep.value.trim());
  }

  f.title.addEventListener("input", reguess);
  f.project.addEventListener("input", reguess);
  f.due.addEventListener("input", paint);

  // The sheet's own actions, under the fields and only when editing.
  let armed = false; // Delete pressed once; the next press does it
  const doNow = h("button", { className: "btn", type: "button", textContent: "Do this now",
    onclick: () => { if (editing) { onNow?.(editing.id); dialog.close(); } } });
  // Someday parks a task off the card; the same button brings it back.
  const someday = h("button", { className: "btn", type: "button", onclick: () => {
    if (!editing) return;
    const back = editing.status === "someday";
    updateTask(uid, editing, { status: back ? "ready" : "someday" }, tasks).catch((e) => console.error("[daisey] someday", e));
    flash(back ? "Back from Someday: " : "Someday: ", editing.title);
    dialog.close();
  } });
  const del = h("button", { className: "btn quiet danger", type: "button", textContent: "Delete" });
  del.onclick = () => {
    if (!editing) return;
    if (!armed) { armed = true; del.textContent = "Really delete?"; del.classList.add("arm"); return; }
    const gone = editing;
    dialog.close();
    removeTask(uid, gone.id).catch((e) => { console.error("[daisey] delete", e); flash("Couldn't delete ", gone.title); });
    flash("Deleted ", gone.title);
  };
  const actions = h("div", { className: "sheet-actions" }, doNow, someday, del);
  const disarm = () => { armed = false; del.textContent = "Delete"; del.classList.remove("arm"); };

  form.onsubmit = (ev) => {
    ev.preventDefault();
    try {
      if (editing) {
        // Blank due clears it. A chip handed back goes back to a guess.
        const changes = { title: f.title.value, project: f.project.value, due: f.due.value, dateKind: kind,
          notBefore: f.notBefore.value, notes: f.notes.value, waitingOn: f.waitingOn.value, nextStep: f.nextStep.value };
        for (const k of CHIPS) {
          if (mine.has(k) && (!startMine.has(k) || vals[k] !== editing[k])) changes[k] = vals[k];
          else if (!mine.has(k) && startMine.has(k)) changes[k] = "";
        }
        // Emptying "Waiting on" is how a task stops waiting; filling it in is
        // handled by editTask. A done task's status is left alone — the
        // circle in the list is what reopens one.
        if (editing.status === "waiting" && !f.waitingOn.value.trim()) changes.status = "ready";
        updateTask(uid, editing, changes, tasks).catch((e) => { console.error("[daisey] edit", e); msg.textContent = "Not saved: " + (e.code || e.message); });
        dialog.close();
        return;
      }
      const input = { title: f.title.value };
      for (const k of ["project", "due", "notBefore", "notes", "nextStep"]) if (f[k].value.trim()) input[k] = f[k].value;
      if (input.due) input.dateKind = kind;
      for (const k of mine) input[k] = vals[k];
      // Resolves on server ack, which never comes offline; the list already
      // shows the task locally, so don't wait.
      addTask(uid, input, tasks).catch((e) => { console.error("[daisey] add", e); msg.textContent = "Not saved: " + (e.code || e.message); });
      msg.textContent = `Added “${f.title.value.trim()}”.`;
      const project = f.project.value;
      clear();
      f.project.value = project; // usually adding several to one project
      paint();
      f.title.focus();
    } catch (e) { msg.textContent = e.message || String(e); }
  };

  function clear(){
    form.reset();
    vals = {}; mine = new Set(); startMine = new Set(); openChip = null; kind = "target";
    more.open = false;
  }

  const close = h("button", { className: "now-x", type: "button", ariaLabel: "Close", textContent: "✕", onclick: () => dialog.close() });
  dialog.replaceChildren(h("div", { className: "now-head" }, heading, close), form, actions, msg, projects);
  dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });

  const unsub = watchTasks(uid, (ts) => {
    tasks = ts;
    const names = [...new Set(ts.map((t) => t.project))].sort();
    projects.replaceChildren(...names.map((p) => h("option", { value: p })));
  }, (e) => console.error("[daisey] add", e));

  return {
    // project: prefill ("" = Inbox); omitted = keep the last one.
    open(project){
      const keep = f.project.value;
      msg.textContent = "";
      editing = null;
      disarm();
      clear();
      f.project.value = project !== undefined ? project : keep;
      heading.textContent = "Add task";
      submit.textContent = "Add";
      waitField.hidden = true;
      actions.hidden = true;
      paint();
      if (!dialog.open) dialog.showModal();
      f.title.focus();
    },
    // The same popup, filled in: a wrong guess shouldn't be stuck forever.
    edit(task){
      msg.textContent = "";
      clear();
      editing = task;
      disarm();
      heading.textContent = task.title.length > 28 ? "Task" : task.title;
      submit.textContent = "Save";
      waitField.hidden = task.status === "done";
      actions.hidden = false;
      doNow.hidden = task.status === "done" || task.status === "someday";
      someday.hidden = task.status === "done";
      someday.textContent = task.status === "someday" ? "Back from Someday" : "Someday";
      f.waitingOn.value = task.waitingOn || "";
      f.project.value = task.project === INBOX ? "" : task.project;
      f.title.value = task.title;
      f.due.value = task.due || "";
      kind = task.dateKind === "deadline" ? "deadline" : "target";
      f.nextStep.value = task.nextStep || "";
      f.notBefore.value = task.notBefore || "";
      f.notes.value = task.notes || "";
      more.open = !!(task.notBefore || task.notes);
      const guessed = new Set(task.guessed || []);
      for (const k of CHIPS) if (validField(k, task[k])) { vals[k] = task[k]; if (!guessed.has(k)) mine.add(k); }
      startMine = new Set(mine);
      // Show the stored guesses as they are; only an old task missing a
      // field gets fresh ones. Typing a new title re-guesses, as saving will.
      if (CHIPS.some((k) => !(k in vals))) reguess(); else paint();
      if (!dialog.open) dialog.showModal();
      f.title.focus();
    },
    unmount(){ unsub(); if (dialog.open) dialog.close(); dialog.replaceChildren(); },
  };
}
