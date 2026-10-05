// The task popup. Title first; everything else is optional (Mor, 2026-10-04).
// Daisey guesses area, type, where, open hours, size, stakes and energy from
// the title (model.guessFields).
//
// The guesses stay OUT OF THE WAY while you type (Mor, 2026-10-05: they used
// to open roughly, re-laying the form out on every keystroke). Two things fix
// that: they wait for the typing to stop (SETTLE ms of quiet, and at least
// MIN_CHARS characters) and then fade in, and what fades in is ONE QUIET LINE
// — an icon and a value for the four that matter, no field names. Tapping the
// line opens the full set of chips, where a dashed chip is a guess, a solid
// one is yours. Each chip drops its own little MENU over the form (Mor,
// 2026-10-05: a shared row of options below the chips pushed everything down
// every time one was tapped), and "Daisey guesses" at the foot of the menu
// hands the field back. The line never disappears again once it is up,
// because vanishing is its own jump.
//
// Every field is shown, with room between them (Mor, 2026-10-04: "no need for
// More, just show everything, not dense"). Add closes the popup; so does
// saving an edit.
//
// The order is the order you think in (Mor, 2026-10-05): the project sits in
// the heading row, not in the stack, because it is context rather than a
// question; then Task, then Description; the two dates share a row. "First
// step" is gone — a step is a task of its own.
//
// The project is a list: Inbox, the projects already there, and "+ New
// project…", which asks for the name.
//
// In edit mode it is the task SHEET (Mor, 2026-10-04): tapping a row in the
// Tasks view lands here, so everything you can do to one task is in one
// place. That is why waiting is handled here rather than as an action, and why
// Delete is a two-press button instead of a confirm() dialog.
//
// Waiting is one press, not a blank box (Mor, 2026-10-05): PENDING is a
// toggle, and it sits in the action row beside "Do this now" and Someday,
// because parking a task is that kind of act. Turning it on reveals "Waiting
// on" for who or what. The name is optional — pending with nobody named is
// still pending. Turning it off hands the task back to ready and forgets the
// name.
import { watchTasks, addTask, updateTask, removeTask } from "./store.js";
import { durText, guessFields, validField, CHOICES, LABELS, INBOX } from "./model.js";
import { h, flash, icon } from "./ui.js";

// The guessed fields shown as chips, in order. canSplit stays a quiet
// default with no chip of its own.
const CHIPS = ["area", "type", "where", "openHours", "size", "stakes", "energy"];
const NAMES = { area: "Area", type: "Type", where: "Where", openHours: "Open hours", size: "Size", stakes: "Stakes", energy: "Energy" };
const SIZE_OPTIONS = [5, 15, 30, 60, 90, 120, 180, 240];
const NEW_PROJECT = "__new"; // the project list's "+ New project…" entry
// The ones shown on the collapsed line; open hours and stakes joined it
// (Mor, 2026-10-05) since they decide when a task can come up and how hard
// it pushes. Type is one tap away.
const SUMMARY = ["area", "where", "openHours", "size", "stakes", "energy"];
const SETTLE = 450; // ms of quiet typing before the guesses appear or change
const MIN_CHARS = 3; // a title shorter than this isn't worth guessing from
const valueText = (k, v) => (k === "size" ? durText(v) : LABELS[k][v] ?? "");
// On a chip the icon already says which field it is, so "Low energy" is just
// "Low" and "Office hours" is just "Office".
const shortText = (k, v) => valueText(k, v).replace(/ (energy|stakes|hours)$/, "");
const optionsOf = (k) => (k === "size" ? SIZE_OPTIONS : CHOICES[k]);

let n = 0;
const field = (label, input) => {
  input.id ||= `add-f${++n}`;
  return h("div", { className: "field" }, h("label", { htmlFor: input.id, textContent: label }), input);
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
  let pending = false; // the Pending toggle: the task is waiting on something
  let shown = false; // the guess line is up (and stays up)
  let expanded = false; // the full chip set is open
  let settle = 0; // the "typing stopped" timer
  let kind = "target"; // the date's kind
  const projectSel = h("select", { className: "head-project", ariaLabel: "Project" });
  const f = {
    title: h("input", { id: "addName", dir: "auto", required: true, autocomplete: "off" }),
    newProject: h("input", { dir: "auto", autocomplete: "off", placeholder: "e.g. Website redesign" }),
    due: h("input", { id: "addDue", type: "date" }),
    notBefore: h("input", { type: "date" }),
    waitingOn: h("input", { dir: "auto", autocomplete: "off", placeholder: "who or what?" }),
    notes: h("textarea", { dir: "auto", rows: 3 }),
  };
  const msg = h("p", { className: "muted", role: "status" });

  const chipRow = h("div", { className: "gchips", role: "group", ariaLabel: "Daisey's guesses — tap one to change it" });
  const gbox = h("div", { className: "gbox" },
    h("p", { className: "guess-cap muted", textContent: "Daisey's guesses — tap one to change it" }), chipRow);
  // The collapsed line: icons and values, no field names, and a word that says
  // it opens.
  const sumVals = h("span", { className: "gsum-vals" });
  const sumLine = h("button", { type: "button", className: "gsum",
    onclick: () => { expanded = !expanded; if (!expanded) openChip = null; paint(); } },
    h("span", { className: "gsum-k", textContent: "Daisey" }), sumVals,
    h("span", { className: "gsum-more", ariaHidden: "true", textContent: "Change" }));
  const guesses = h("div", { className: "guesses" }, sumLine, gbox);

  const newField = field("Name the new project", f.newProject);
  newField.hidden = true;
  // The two dates share a row; under them, whether the date is real.
  const kindRow = h("div", { className: "kind", role: "radiogroup", ariaLabel: "What kind of date" });
  const dateBox = h("div", { className: "sheet-stack" },
    h("div", { className: "sheet-row" }, field("Date (optional)", f.due), field("Start date (optional)", f.notBefore)),
    kindRow);
  // Waiting only exists for a task that already exists: you don't add one
  // already blocked (model.js's note on Waiting). One press to park it; the
  // name of who or what only appears once it is parked.
  const waitField = field("Waiting on", f.waitingOn);
  // Save sits on the bottom line with Delete, outside the form, so the two
  // ends of the sheet are one row (Mor, 2026-10-05). It still submits the
  // form: that is what the form= attribute is for.
  const submit = h("button", { className: "btn primary", type: "submit", textContent: "Add" });
  submit.setAttribute("form", "addTaskForm");
  const form = h("form", { id: "addTaskForm", className: "sheet-form" },
    newField,
    field("Task", f.title),
    guesses,
    field("Description (optional)", f.notes),
    dateBox,
    waitField);
  const heading = h("h2", { id: "addTitle", dir: "auto", textContent: "Add task" });

  // Other tasks teach the guesses ("similar past tasks", the project's own
  // areas); the one being edited must not teach itself.
  const history = () => (editing ? tasks.filter((t) => t.id !== editing.id) : tasks);
  // What the project field means: the list's pick, or the name typed for a new one.
  const projectOf = () => (projectSel.value === NEW_PROJECT ? f.newProject.value.trim() : projectSel.value) || INBOX;

  // Selects a project, adding it to the list if it isn't there yet (a task
  // being edited may name one that no other task uses).
  function showProject(name){
    const v = !name || name === INBOX ? "" : name;
    if (v !== NEW_PROJECT && ![...projectSel.options].some((o) => o.value === v))
      projectSel.insertBefore(h("option", { value: v, textContent: v }), projectSel.lastElementChild);
    projectSel.value = v;
    newField.hidden = v !== NEW_PROJECT;
  }

  function fillProjects(names){
    const cur = projectSel.value;
    projectSel.replaceChildren(
      h("option", { value: "", textContent: INBOX }),
      ...names.map((p) => h("option", { value: p, textContent: p })),
      h("option", { value: NEW_PROJECT, textContent: "+ New project…" }));
    showProject(cur);
  }
  fillProjects([]);

  function reguess(){
    const title = f.title.value.trim();
    if (title) {
      const given = Object.fromEntries([...mine].map((k) => [k, vals[k]]));
      const g = guessFields(title, projectOf(), given, history());
      for (const k of CHIPS) if (!mine.has(k)) vals[k] = g[k];
    }
    paint();
  }

  function pick(k, v){
    if (v === null) mine.delete(k); else { mine.add(k); vals[k] = v; }
    openChip = null;
    reguess(); // a picked type re-steers where, hours, size and energy
  }

  // Typing never moves the form: the guesses only catch up once you stop.
  function later(){
    clearTimeout(settle);
    settle = setTimeout(() => {
      const len = f.title.value.trim().length;
      if (len >= MIN_CHARS) shown = true;
      else if (!len) { shown = false; expanded = false; } // cleared the title: start over
      reguess();
    }, SETTLE);
  }

  // One chip's menu, floated over the form rather than pushing it down.
  const menuFor = (k) => h("div", { className: "gmenu", role: "listbox", ariaLabel: NAMES[k] },
    ...optionsOf(k).map((v) => h("button", { type: "button", role: "option", className: "gopt",
      ariaSelected: String(mine.has(k) && vals[k] === v), onclick: () => pick(k, v) },
    h("bdi", { textContent: valueText(k, v) }))),
    h("button", { type: "button", role: "option", className: "gopt quiet", ariaSelected: String(!mine.has(k)),
      textContent: "Daisey guesses", onclick: () => pick(k, null) }));

  function paint(){
    guesses.hidden = !shown;
    sumLine.ariaExpanded = String(expanded);
    sumLine.ariaLabel = `Daisey's guesses: ${CHIPS.map((k) => `${NAMES[k]} ${valueText(k, vals[k])}`).join(", ")}. Change them`;
    sumVals.replaceChildren(...SUMMARY.map((k) =>
      h("span", { className: "gsum-v" + (mine.has(k) ? " mine" : "") }, icon(k), h("bdi", { textContent: shortText(k, vals[k]) }))));
    gbox.hidden = !expanded;
    chipRow.replaceChildren(...CHIPS.map((k) => {
      const own = mine.has(k);
      const chip = h("button", { type: "button", className: "gchip" + (own ? " mine" : ""),
        ariaHasPopup: "listbox", ariaExpanded: String(openChip === k),
        ariaLabel: `${NAMES[k]}: ${valueText(k, vals[k])}, ${own ? "yours" : "Daisey's guess"}. Change`,
        onclick: () => { openChip = openChip === k ? null : k; paint(); } },
      icon(k), h("bdi", { textContent: shortText(k, vals[k]) }));
      return h("div", { className: "gchip-wrap" }, chip, openChip === k ? menuFor(k) : null);
    }));
    // A menu on a chip near the edge hangs the other way instead of off it.
    const menu = openChip && chipRow.querySelector(".gmenu");
    if (menu && menu.getBoundingClientRect().right > dialog.getBoundingClientRect().right - 8)
      menu.classList.add("end");
    kindRow.hidden = !f.due.value;
    kindRow.replaceChildren(...[["target", "Target (wish)"], ["deadline", "Deadline (real)"]].map(([v, text]) =>
      h("button", { type: "button", className: "chip", role: "radio", ariaChecked: String(kind === v), textContent: text,
        onclick: () => { kind = v; paint(); } })));
  }

  f.title.addEventListener("input", later);
  projectSel.addEventListener("change", () => {
    newField.hidden = projectSel.value !== NEW_PROJECT;
    if (!newField.hidden) f.newProject.focus();
    reguess();
  });
  f.newProject.addEventListener("input", later);
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
  const pendBtn = h("button", { className: "btn pend", type: "button" }, icon("pending"),
    h("span", { textContent: "Pending" }));
  pendBtn.onclick = () => {
    pending = !pending;
    if (!pending) f.waitingOn.value = "";
    paintPend();
    if (pending) f.waitingOn.focus();
  };
  function paintPend(){
    pendBtn.ariaPressed = String(pending);
    waitField.hidden = !pending;
  }
  const actions = h("div", { className: "sheet-actions" }, doNow, pendBtn, someday);
  // Delete at one end, Add/Save at the other.
  const bottom = h("div", { className: "sheet-bottom" }, del, submit);
  const disarm = () => { armed = false; del.textContent = "Delete"; del.classList.remove("arm"); };

  form.onsubmit = (ev) => {
    ev.preventDefault();
    if (projectSel.value === NEW_PROJECT && !f.newProject.value.trim()) {
      msg.textContent = "Name the new project, or pick one from the list.";
      f.newProject.focus();
      return;
    }
    try {
      if (editing) {
        // Blank due clears it. A chip handed back goes back to a guess.
        const changes = { title: f.title.value, project: projectOf(), due: f.due.value, dateKind: kind,
          notBefore: f.notBefore.value, notes: f.notes.value,
          waitingOn: pending ? f.waitingOn.value : "" };
        for (const k of CHIPS) {
          if (mine.has(k) && (!startMine.has(k) || vals[k] !== editing[k])) changes[k] = vals[k];
          else if (!mine.has(k) && startMine.has(k)) changes[k] = "";
        }
        // The toggle, not the text, decides: pending with nobody named is
        // still pending, and turning it off hands the task back. Done and Someday are
        // left alone — the circle in the list is what reopens one.
        if (editing.status === "ready" || editing.status === "waiting")
          changes.status = pending ? "waiting" : "ready";
        updateTask(uid, editing, changes, tasks).catch((e) => { console.error("[daisey] edit", e); flash("Couldn't save ", editing.title); });
        dialog.close();
        return;
      }
      const input = { title: f.title.value, project: projectOf() };
      for (const k of ["due", "notBefore", "notes"]) if (f[k].value.trim()) input[k] = f[k].value;
      if (input.due) input.dateKind = kind;
      for (const k of mine) input[k] = vals[k];
      // Resolves on server ack, which never comes offline; the list already
      // shows the task locally, so don't wait.
      addTask(uid, input, tasks).catch((e) => { console.error("[daisey] add", e); flash("Couldn't add ", input.title); });
      flash("Added ", input.title);
      dialog.close();
    } catch (e) { msg.textContent = e.message || String(e); }
  };

  function clear(){
    form.reset();
    clearTimeout(settle);
    vals = {}; mine = new Set(); startMine = new Set(); openChip = null;
    shown = false; expanded = false; pending = false; kind = "target";
  }

  const close = h("button", { className: "now-x", type: "button", ariaLabel: "Close", textContent: "✕", onclick: () => dialog.close() });
  // The heading row carries the project: the task's context, not a question.
  dialog.replaceChildren(h("div", { className: "now-head sheet-head" }, heading, projectSel, close),
    form, actions, bottom, msg);
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) { dialog.close(); return; }
    // A tap anywhere else puts an open guess menu away.
    if (openChip && !e.target.closest(".gchip-wrap")) { openChip = null; paint(); }
  });
  // Escape closes the menu first; a second one closes the sheet.
  dialog.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && openChip) { e.preventDefault(); openChip = null; paint(); }
  });

  const unsub = watchTasks(uid, (ts) => {
    tasks = ts;
    fillProjects([...new Set(ts.map((t) => t.project))].filter((p) => p !== INBOX).sort((a, b) => a.localeCompare(b)));
  }, (e) => console.error("[daisey] add", e));

  return {
    // project: prefill ("" or Inbox = Inbox); omitted = keep the last one.
    // title: prefill (Tell Daisey's text); the guesses run on it as if typed.
    open(project, title = ""){
      const keep = projectSel.value === NEW_PROJECT ? "" : projectSel.value;
      msg.textContent = "";
      editing = null;
      disarm();
      clear();
      showProject(project !== undefined ? project : keep);
      heading.textContent = "Add task";
      submit.textContent = "Add";
      waitField.hidden = true;
      actions.hidden = true;
      del.hidden = true; // nothing to delete yet
      paint();
      if (!dialog.open) dialog.showModal();
      f.title.focus();
      if (title) { f.title.value = title; f.title.dispatchEvent(new Event("input")); }
    },
    // The same popup, filled in: a wrong guess shouldn't be stuck forever.
    edit(task){
      msg.textContent = "";
      clear();
      editing = task;
      disarm();
      heading.textContent = task.title.length > 28 ? "Task" : task.title;
      submit.textContent = "Save";
      pendBtn.hidden = task.status === "done" || task.status === "someday";
      actions.hidden = false;
      del.hidden = false;
      doNow.hidden = task.status === "done" || task.status === "someday";
      someday.hidden = task.status === "done";
      someday.textContent = task.status === "someday" ? "Back from Someday" : "Someday";
      pending = task.status === "waiting";
      f.waitingOn.value = pending ? task.waitingOn || "" : "";
      paintPend();
      if (pendBtn.hidden) waitField.hidden = true;
      showProject(task.project);
      f.title.value = task.title;
      f.due.value = task.due || "";
      kind = task.dateKind === "deadline" ? "deadline" : "target";
      f.notBefore.value = task.notBefore || "";
      f.notes.value = task.notes || "";
      const guessed = new Set(task.guessed || []);
      for (const k of CHIPS) if (validField(k, task[k])) { vals[k] = task[k]; if (!guessed.has(k)) mine.add(k); }
      startMine = new Set(mine);
      // Show the stored guesses as they are; only an old task missing a
      // field gets fresh ones. Typing a new title re-guesses, as saving will.
      shown = true; // the title is already written; nothing is about to jump
      if (CHIPS.some((k) => !(k in vals))) reguess(); else paint();
      if (!dialog.open) dialog.showModal();
      f.title.focus();
    },
    unmount(){ clearTimeout(settle); unsub(); if (dialog.open) dialog.close(); dialog.replaceChildren(); },
  };
}
