// The task sheet (layout round 2, Mor 2026-10-05; New Design/9-task): one
// task, opened by tapping its title anywhere — the Now card, a project
// screen — and the same sheet, empty, for a new task.
//
// Top to bottom: the project (dot + name, a list with "+ New project…"),
// the title (26px, edited in place), two date boxes side by side — Start
// (not before) FIRST, then Due with its Deadline/Target tag — one collapsed
// "Details: size, energy, place" row over Daisey's guessed chips,
// Links & notes, "Worked N sessions · Xh so far", and the amber Start.
//
// An open task saves as you go: every change is written when it's made (a
// typed field when you leave it, or when the sheet closes). There is no Save
// button and no status switcher (Mor: "No status switcher inside the task") —
// Later / Switch / Pending live on the Now card. Start brings a parked or
// pending task back into play (now.js start). Delete is the quiet line under
// Start, two presses.
//
// Links are URLs; a file is a link to it (Drive, Dropbox) — there is no file
// storage behind Daisey.
//
// The guessed chips are the same as before: each drops its own menu over the
// sheet, "Daisey guesses" hands a field back, dashed = a guess, solid = yours.
// While typing a new task's title they catch up only once typing stops.
import { nudgeText, waLink } from "./nudge.js";
import { watchTasks, addTask, updateTask, removeTask, watchProjectNames } from "./store.js";
import { durText, guessFields, validField, CHOICES, LABELS, INBOX, localDate, clampDate, outsideRange } from "./model.js";
import { h, flash, icon, bdi } from "./ui.js";
import { projectsOf } from "./projects.js";

const CHIPS = ["area", "type", "where", "openHours", "size", "stakes", "energy"];
const NAMES = { area: "Area", type: "Type", where: "Where", openHours: "Open hours", size: "Size", stakes: "Stakes", energy: "Energy" };
const SIZE_OPTIONS = [5, 15, 30, 60, 90, 120, 180, 240];
const NEW_PROJECT = "__new"; // the project list's "+ New project…" entry
const SETTLE = 450; // ms of quiet typing before a new task's guesses catch up
const MIN_CHARS = 3;
const valueText = (k, v) => (k === "size" ? durText(v) : LABELS[k][v] ?? "");
const shortText = (k, v) => valueText(k, v).replace(/ (energy|stakes|hours)$/, "");
const optionsOf = (k) => (k === "size" ? SIZE_OPTIONS : CHOICES[k]);
const boxDate = (s) => new Date(`${s}T12:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
// "1 h 40", "25 min": the worked line is short on purpose.
const workedText = (m) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60}` : ""}`);

// onStart(id): close the sheet and start the task (now.js start).
export function mountAddTask(dialog, uid, { onStart } = {}){
  let tasks = [];
  let editing = null; // the open task (kept fresh from the snapshot), or null for a new one
  let vals = {}, mine = new Set(), openChip = null;
  let detailsOpen = false;
  let links = [];
  let kind = "target";
  let settle = 0, armed = false, fieldN = 0;
  const fail = (e) => console.error("[daisey] task", e);

  // ---------- the pieces ----------
  // The sheet is built like the event sheet (addevent.js) — same card, head,
  // labelled fields and button (Mor, 2026-10-06: "make it identical").
  const heading = h("h2", { id: "addTitle", textContent: "New task" });
  const closeX = h("button", { className: "now-x", type: "button", ariaLabel: "Close", textContent: "✕", onclick: () => dialog.close() });
  const field = (label, input, ...more) => {
    input.id ||= `ts-f${++fieldN}`;
    return h("div", { className: "field" }, h("label", { htmlFor: input.id, textContent: label }), input, ...more);
  };
  const projectSel = h("select", { className: "ts-project" });
  const newProject = h("input", { className: "ts-input", dir: "auto", autocomplete: "off", placeholder: "Name the new project", ariaLabel: "New project name" });
  const title = h("textarea", { className: "ts-title", dir: "auto", rows: 1, placeholder: "What's the task?", required: true });

  // A date box: the label, what's set (or "Any time"), and a native date
  // input laid over the whole box, so a tap anywhere opens the picker.
  function dateBox(label, empty){
    const input = h("input", { type: "date", className: "ts-date-in", ariaLabel: label });
    input.addEventListener("click", () => { try { input.showPicker(); } catch { /* opened natively */ } });
    const value = h("span", { className: "ts-date-v" });
    const clear = h("button", { type: "button", className: "ts-date-x", ariaLabel: `Clear ${label}`, onclick: (e) => { e.preventDefault(); input.value = ""; input.dispatchEvent(new Event("change")); } }, icon("close"));
    const tag = h("button", { type: "button", className: "ts-kind", hidden: true });
    const box = field(label, h("div", { className: "ts-date" }, value, tag, clear, input));
    box.querySelector("label").htmlFor = input.id = `ts-f${++fieldN}`;
    const paint = () => {
      value.textContent = input.value ? boxDate(input.value) : empty;
      box.lastChild.classList.toggle("set", !!input.value);
      clear.hidden = !input.value;
    };
    return { input, box, tag, paint };
  }
  const start = dateBox("Start", "Any time");
  const due = dateBox("Due", "No date");
  due.tag.onclick = (e) => {
    e.preventDefault();
    kind = kind === "deadline" ? "target" : "deadline";
    paintDates();
    if (editing) save({ dateKind: kind });
  };
  function paintDates(){
    start.paint(); due.paint();
    due.tag.hidden = !due.input.value;
    due.tag.textContent = kind === "deadline" ? "Deadline" : "Target";
    due.tag.className = "ts-kind " + kind;
    due.tag.ariaLabel = `${kind === "deadline" ? "Deadline (real)" : "Target (wish)"}: tap to change`;
  }

  // Details: collapsed by default; opens Daisey's guessed chips.
  const detailsBtn = h("button", { type: "button", className: "ts-details", ariaExpanded: "false",
    onclick: () => { detailsOpen = !detailsOpen; openChip = null; reguess(); } },
  icon("details"), h("span", { className: "ts-details-t", textContent: "Details: size, energy, place" }), icon("chev"));
  const chipRow = h("div", { className: "gchips ts-chips", role: "group", ariaLabel: "Daisey's guesses — tap one to change it" });

  // Pending's details, on a pending task: data, not a switch.
  const waitingOn = h("input", { className: "ts-input", dir: "auto", autocomplete: "off", placeholder: "who or what?" });
  const checkOn = h("input", { className: "ts-input", type: "date" });
  // Nudge (2026-10-06): a short check-in drafted in WhatsApp; you pick the
  // contact and send it yourself (nudge.js).
  const nudgeBtn = h("button", { className: "linkish ts-nudge", type: "button", textContent: "Nudge on WhatsApp",
    onclick: () => { if (editing) window.open(waLink(nudgeText({ ...editing, waitingOn: waitingOn.value })), "_blank", "noopener"); } });
  const pendBox = h("div", { className: "ts-pend" },
    h("label", {}, h("span", { textContent: "Waiting on" }), waitingOn),
    h("label", {}, h("span", { textContent: "Ask me again" }), checkOn),
    nudgeBtn);
  // Waiting for a reply (Mor, 2026-10-07): the same hold as the running
  // card's Waiting — on hold, off the card, and if it's the running task its
  // timer keeps going. A switch plus who; not Pending (that has its own box).
  const holdSwitch = h("input", { type: "checkbox", id: "tsHold" });
  const holdWho = h("input", { className: "ts-input", dir: "auto", autocomplete: "off", id: "tsHoldWho" });
  const holdBox = h("div", { className: "ts-hold" },
    h("label", { className: "ts-hold-sw", htmlFor: "tsHold" }, holdSwitch, h("span", { textContent: "Waiting for a reply" })),
    h("label", { className: "ts-hold-who", htmlFor: "tsHoldWho" }, h("span", { textContent: "From who (optional)" }), holdWho));
  holdSwitch.addEventListener("change", () => {
    if (!editing) return;
    save({ onHold: holdSwitch.checked ? { who: holdWho.value, since: editing.onHold?.since } : null });
    paintFoot();
  });
  holdWho.addEventListener("change", () => { if (editing?.onHold || holdSwitch.checked) save({ onHold: { who: holdWho.value, since: editing.onHold?.since } }); });
  const stateLine = h("p", { className: "ts-state" });
  // What the web check found (research.js): "Daisey checked: online…" / "needs a call…".
  const researchLine = h("p", { className: "ts-state ts-research", dir: "auto" });

  const linkRow = h("div", { className: "ts-links" });
  const notes = h("textarea", { className: "ts-notes", dir: "auto", rows: 2, placeholder: "Notes…", ariaLabel: "Notes" });
  const worked = h("p", { className: "ts-worked" });
  const startBtn = h("button", { type: "button", className: "btn primary ts-start" });
  const del = h("button", { type: "button", className: "ts-del" });
  const msg = h("p", { className: "msg", role: "status" });
  const section = (label, ...kids) => h("div", { className: "field" }, h("h3", { className: "ts-h", textContent: label }), ...kids);

  dialog.replaceChildren(h("div", { className: "now-head" }, heading, closeX),
    field("Project", projectSel, newProject),
    field("Task", title),
    h("div", { className: "ts-dates" }, start.box, due.box),
    detailsBtn, chipRow, pendBox, holdBox, researchLine, stateLine,
    section("Links & notes", h("div", { className: "ts-group" }, linkRow, notes)),
    worked, startBtn, del, msg);

  // ---------- saving ----------
  // Other tasks teach the guesses; the open one must not teach itself.
  const history = () => (editing ? tasks.filter((t) => t.id !== editing.id) : tasks);
  const projectOf = () => (projectSel.value === NEW_PROJECT ? newProject.value.trim() : projectSel.value) || INBOX;
  function save(changes){
    if (!editing) return;
    const was = editing;
    try { updateTask(uid, was, changes, tasks).catch((e) => { fail(e); flash("Couldn't save ", was.title); }); }
    catch (e) { msg.textContent = e.message || String(e); }
  }
  // Typed fields save when you leave them, and on close (flush).
  function flush(){
    if (!editing) return;
    const c = {};
    const t = title.value.trim();
    if (t && t !== editing.title) c.title = t;
    if ((notes.value.trim() || null) !== (editing.notes || null)) c.notes = notes.value;
    if (editing.status === "waiting" && (waitingOn.value.trim() || null) !== (editing.waitingOn || null)) c.waitingOn = waitingOn.value;
    if (projectSel.value === NEW_PROJECT && newProject.value.trim() && newProject.value.trim() !== editing.project) c.project = newProject.value.trim();
    if (Object.keys(c).length) save(c);
  }

  // ---------- project ----------
  // The sheet wears its project's colour, the same one as on the Projects
  // page (Mor, 2026-10-06: "design and colors in add task are really off").
  // A new project or Inbox falls back to the guessed area's colour, or none.
  let colors = {};
  const paintArea = () => {
    const c = colors[projectSel.value];
    dialog.className = dialog.className.split(" ").filter((k) => !/^(pc|area)-/.test(k)).join(" ")
      + (c ? ` pc-${c}` : vals.area ? ` area-${vals.area}` : "");
  };
  function showProject(name){
    const v = !name || name === INBOX ? "" : name;
    if (v !== NEW_PROJECT && ![...projectSel.options].some((o) => o.value === v))
      projectSel.insertBefore(h("option", { value: v, textContent: v }), projectSel.lastElementChild);
    projectSel.value = v;
    newProject.hidden = v !== NEW_PROJECT;
    paintArea();
  }
  function fillProjects(names){
    const cur = projectSel.value;
    projectSel.replaceChildren(h("option", { value: "", textContent: INBOX }),
      ...names.map((p) => h("option", { value: p, textContent: p })),
      h("option", { value: NEW_PROJECT, textContent: "+ New project…" }));
    showProject(cur);
  }
  fillProjects([]);
  projectSel.addEventListener("change", () => {
    newProject.hidden = projectSel.value !== NEW_PROJECT;
    paintArea();
    if (!newProject.hidden) { fenceDates([]); newProject.focus(); return; }
    const c = fenceDates(["notBefore", "due"]);
    paintDates();
    if (editing) save({ project: projectOf(), ...c }); else reguess();
  });
  newProject.addEventListener("change", () => { if (editing && newProject.value.trim()) save({ project: newProject.value.trim() }); else reguess(); });

  // ---------- title ----------
  const fit = () => { title.style.blockSize = "auto"; title.style.blockSize = `${title.scrollHeight + title.offsetHeight - title.clientHeight}px`; };
  title.addEventListener("input", () => {
    fit();
    if (editing) return;
    clearTimeout(settle);
    settle = setTimeout(() => { if (title.value.trim().length >= MIN_CHARS) reguess(); }, SETTLE);
  });
  title.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); title.blur(); } });
  title.addEventListener("change", () => { if (editing && title.value.trim() && title.value.trim() !== editing.title) save({ title: title.value }); });

  // ---------- dates ----------
  // A project's dates fence its tasks' (Mor, 2026-10-07): the pickers get
  // min/max, and a date typed or carried in from outside is pulled to the
  // nearest edge, with a line saying so. A saved task already outside is left
  // alone until it is touched or moved.
  const rangeNow = () => ranges[projectSel.value] || null;
  const rangeText = (r) => [r.start && `from ${boxDate(r.start)}`, r.due && `to ${boxDate(r.due)}`].filter(Boolean).join(" ");
  function fenceDates(touch){
    const r = rangeNow();
    for (const box of [start, due]) { box.input.min = r?.start || ""; box.input.max = r?.due || ""; }
    if (!r) return {};
    const out = {};
    for (const [key, box] of [["notBefore", start], ["due", due]]) {
      const v = box.input.value;
      if (touch.includes(key) && outsideRange(r, v)) {
        box.input.value = clampDate(r, v); out[key] = box.input.value;
        msg.textContent = `${key === "due" ? "Due" : "Start"} kept inside the project dates (${rangeText(r)}).`;
      }
    }
    return out;
  }
  start.input.addEventListener("change", () => { const c = fenceDates(["notBefore"]); paintDates(); if (editing) save({ notBefore: start.input.value, ...c }); });
  due.input.addEventListener("change", () => { const c = fenceDates(["due"]); paintDates(); if (editing) save({ due: due.input.value, dateKind: kind, ...c }); });

  // ---------- chips ----------
  function reguess(){
    const t = title.value.trim();
    // Open Details on an untitled task: the plain defaults, not an empty row.
    if (t || detailsOpen) {
      const given = Object.fromEntries([...mine].map((k) => [k, vals[k]]));
      const g = guessFields(t, projectOf(), given, history());
      for (const k of CHIPS) if (!mine.has(k)) vals[k] = g[k];
    }
    paintChips();
  }
  function pick(k, v){
    if (v === null) mine.delete(k); else { mine.add(k); vals[k] = v; }
    openChip = null;
    if (editing) save({ [k]: v === null ? "" : v });
    reguess();
  }
  const menuFor = (k) => h("div", { className: "gmenu", role: "listbox", ariaLabel: NAMES[k] },
    ...optionsOf(k).map((v) => h("button", { type: "button", role: "option", className: "gopt",
      ariaSelected: String(mine.has(k) && vals[k] === v), onclick: () => pick(k, v) }, h("bdi", { textContent: valueText(k, v) }))),
    h("button", { type: "button", role: "option", className: "gopt quiet", ariaSelected: String(!mine.has(k)),
      textContent: "Daisey guesses", onclick: () => pick(k, null) }));
  function paintChips(){
    paintArea();
    detailsBtn.ariaExpanded = String(detailsOpen);
    chipRow.hidden = !detailsOpen;
    if (!detailsOpen) return;
    chipRow.replaceChildren(...CHIPS.filter((k) => vals[k] != null).map((k) => {
      const own = mine.has(k);
      const chip = h("button", { type: "button", className: "gchip" + (own ? " mine" : ""), ariaHasPopup: "listbox", ariaExpanded: String(openChip === k),
        ariaLabel: `${NAMES[k]}: ${valueText(k, vals[k])}, ${own ? "yours" : "Daisey's guess"}. Change`,
        onclick: () => { openChip = openChip === k ? null : k; paintChips(); } },
      icon(k), h("bdi", { textContent: shortText(k, vals[k]) }));
      return h("div", { className: "gchip-wrap" }, chip, openChip === k ? menuFor(k) : null);
    }));
    const menu = openChip && chipRow.querySelector(".gmenu");
    if (menu && menu.getBoundingClientRect().right > dialog.getBoundingClientRect().right - 8) menu.classList.add("end");
  }

  // ---------- links ----------
  let adding = false;
  function paintLinks(){
    const url = h("input", { className: "ts-input", type: "url", inputMode: "url", placeholder: "Paste a link", ariaLabel: "Link" });
    const addIt = () => {
      if (url.value.trim()) { links.push({ url: url.value.trim() }); if (editing) save({ links }); }
      adding = false; paintLinks();
    };
    url.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addIt(); } if (e.key === "Escape") { e.stopPropagation(); adding = false; paintLinks(); } });
    linkRow.replaceChildren(
      ...links.map((l, k) => h("span", { className: "ts-link" },
        h("a", { href: /^[a-z][a-z0-9+.-]*:/i.test(l.url) ? l.url : `https://${l.url}`, target: "_blank", rel: "noopener" }, icon("link"), bdi(l.label || l.url)),
        h("button", { type: "button", className: "ts-link-x", ariaLabel: `Remove ${l.label || l.url}`,
          onclick: () => { links.splice(k, 1); if (editing) save({ links }); paintLinks(); } }, icon("close")))),
      adding ? h("span", { className: "ts-link-add" }, url, h("button", { type: "button", className: "btn small", textContent: "Add", onclick: addIt }))
        : h("button", { type: "button", className: "ts-link-new", textContent: "+ Link or file", onclick: () => { adding = true; paintLinks(); linkRow.querySelector("input")?.focus(); } }));
  }
  notes.addEventListener("change", () => { if (editing) save({ notes: notes.value }); });
  waitingOn.addEventListener("change", () => save({ waitingOn: waitingOn.value }));
  checkOn.addEventListener("change", () => { if (checkOn.value) save({ checkOn: checkOn.value }); });

  // ---------- the foot ----------
  function paintFoot(){
    const t = editing;
    const n = t?.starts || 0, m = Math.round(t?.spentMinutes || 0);
    worked.hidden = !t || (!n && !m);
    worked.textContent = `Worked ${n} session${n === 1 ? "" : "s"} · ${workedText(m)} so far`;
    pendBox.hidden = t?.status !== "waiting";
    // Only for an open task that isn't already Pending.
    holdBox.hidden = !t || t.status !== "ready";
    if (t && document.activeElement !== holdSwitch) holdSwitch.checked = !!t.onHold;
    holdWho.parentElement.hidden = !holdSwitch.checked;
    const done = t?.status === "done";
    stateLine.hidden = !(t && (done || t.status === "someday"));
    stateLine.replaceChildren(...(done
      ? [`Done ${t.doneAt ? new Date(t.doneAt).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }) : ""}. `,
        h("button", { type: "button", className: "linkish", textContent: "Reopen", onclick: () => save({ status: "ready" }) })]
      : ["In Not now. Start brings it back."]));
    const r = t?.research;
    researchLine.hidden = !r || r.online === "unsure" || !r.why;
    researchLine.textContent = r ? `${r.online === "yes" ? "Daisey checked: can be done online" : "Daisey checked: needs a call or a visit"}${r.why ? ` — ${r.why}` : ""}` : "";
    startBtn.hidden = done;
    startBtn.replaceChildren(icon(t ? "play" : "plus"), h("span", { textContent: t ? "Start" : "Add task" }));
    del.hidden = !t;
  }
  startBtn.onclick = () => {
    if (editing) { flush(); const id = editing.id; dialog.close(); onStart?.(id); return; }
    add();
  };
  del.onclick = () => {
    if (!editing) return;
    if (!armed) { armed = true; del.textContent = "Really delete?"; del.classList.add("arm"); return; }
    const gone = editing;
    editing = null;
    dialog.close();
    removeTask(uid, gone.id).catch((e) => { fail(e); flash("Couldn't delete ", gone.title); });
    flash("Deleted ", gone.title);
  };
  const disarm = () => { armed = false; del.textContent = "Delete task"; del.classList.remove("arm"); };

  function add(){
    if (projectSel.value === NEW_PROJECT && !newProject.value.trim()) { msg.textContent = "Name the new project, or pick one from the list."; newProject.focus(); return; }
    if (!title.value.trim()) { msg.textContent = "Give it a name first."; title.focus(); return; }
    fenceDates(["notBefore", "due"]);
    const input = { title: title.value, project: projectOf() };
    if (start.input.value) input.notBefore = start.input.value;
    if (due.input.value) { input.due = due.input.value; input.dateKind = kind; }
    if (notes.value.trim()) input.notes = notes.value;
    if (links.length) input.links = links;
    for (const k of mine) input[k] = vals[k];
    try {
      // Resolves on server ack, which never comes offline; the list already
      // has it locally, so don't wait.
      addTask(uid, input, tasks).catch((e) => { fail(e); flash("Couldn't add ", input.title); });
      flash("Added ", input.title);
      dialog.close();
    } catch (e) { msg.textContent = e.message || String(e); }
  }

  // ---------- open / close ----------
  function clear(){
    clearTimeout(settle);
    vals = {}; mine = new Set(); openChip = null; detailsOpen = false;
    links = []; adding = false; kind = "target";
    title.value = ""; notes.value = ""; newProject.value = ""; waitingOn.value = ""; checkOn.value = "";
    start.input.value = ""; due.input.value = "";
    msg.textContent = "";
    disarm();
  }
  function paintAll(){ paintDates(); paintChips(); paintLinks(); paintFoot(); }
  const show = () => { if (!dialog.open) dialog.showModal(); requestAnimationFrame(fit); };

  dialog.addEventListener("close", () => { flush(); editing = null; });
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) { dialog.close(); return; }
    if (openChip && !e.target.closest(".gchip-wrap")) { openChip = null; paintChips(); }
  });
  dialog.addEventListener("keydown", (e) => { if (e.key === "Escape" && openChip) { e.preventDefault(); openChip = null; paintChips(); } });

  // The project list: every project a task names, plus the empty ones
  // made with "+ New" on the Projects page.
  let made = [], ranges = {};
  const refill = () => {
    colors = Object.fromEntries(projectsOf(tasks || [], null, made).map((p) => [p.name, p.color]).filter(([, c]) => c));
    fillProjects([...new Set([...(tasks || []).map((t) => t.project), ...made])].filter((p) => p && p !== INBOX).sort((a, b) => a.localeCompare(b)));
  };
  const unsubNames = watchProjectNames(uid, (ns, rs) => { made = ns; ranges = rs || {}; refill(); fenceDates([]); }, fail);
  const unsub = watchTasks(uid, (ts) => {
    tasks = ts;
    refill();
    if (editing) {
      const fresh = ts.find((t) => t.id === editing.id);
      if (!fresh) { editing = null; if (dialog.open) dialog.close(); return; }
      editing = fresh;
      // What isn't typed into follows the saved task: guesses re-guessed on a
      // title change, the worked line, the state.
      for (const k of CHIPS) if (validField(k, fresh[k])) vals[k] = fresh[k];
      if (dialog.open) { paintChips(); paintFoot(); }
    }
  }, fail);

  return {
    // project: prefill (""/Inbox = Inbox, "__new" = a new project);
    // omitted = keep the last one. title: prefill (Tell Daisey's text).
    open(project, text = ""){
      const keep = projectSel.value === NEW_PROJECT ? "" : projectSel.value;
      clear();
      editing = null;
      heading.textContent = "New task";
      showProject(project !== undefined ? project : keep);
      title.value = text;
      fenceDates([]);
      if (text) reguess();
      paintAll();
      show();
    },
    newProject(){ this.open(NEW_PROJECT); },
    // The sheet for one task.
    edit(task){
      clear();
      editing = task;
      heading.textContent = "Edit task";
      showProject(task.project);
      title.value = task.title;
      start.input.value = task.notBefore || "";
      due.input.value = task.due || "";
      fenceDates([]);
      kind = task.dateKind === "deadline" ? "deadline" : "target";
      notes.value = task.notes || "";
      waitingOn.value = task.waitingOn || "";
      holdWho.value = task.onHold?.who || "";
      checkOn.value = task.checkOn || "";
      checkOn.min = localDate();
      links = (task.links || []).map((l) => ({ ...l }));
      const guessed = new Set(task.guessed || []);
      for (const k of CHIPS) if (validField(k, task[k])) { vals[k] = task[k]; if (!guessed.has(k)) mine.add(k); }
      if (CHIPS.some((k) => !(k in vals))) reguess();
      paintAll();
      show();
    },
    unmount(){ clearTimeout(settle); unsub(); unsubNames(); if (dialog.open) dialog.close(); dialog.replaceChildren(); },
  };
}
