// The task sheet (layout round 2, Mor 2026-10-05; New Design/9-task): one
// task, opened by tapping its title anywhere — the Now card, a project
// screen — and the same sheet, empty, for a new task.
//
// Top to bottom: the project (dot + name, a list with "+ New project…"),
// the title (26px, edited in place), two date boxes side by side — Start
// (not before) FIRST, then Due with its Deadline/Target tag — "How long?",
// one chip: Daisey's guess until you pick (no Details row any more),
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
import { watchTasks, addTask, updateTask, removeTask, watchProjectNames, watchSettings, unlogReopened } from "./store.js";
import { durText, guessFields, validField, CHOICES, LABELS, INBOX, localDate, clampDate, outsideRange, progressOf } from "./model.js";
import { h, flash, icon, bdi } from "./ui.js";
import { projectsOf } from "./projects.js";
import { isRoutine, weekLine, PER_MAX, DEFAULT_AT, cleanRoutine, seriesSig } from "./routine.js";
import { syncSeries, dropSeries } from "./slots.js";

// Every field Daisey guesses, and the one the user sees (Mor, 2026-10-07:
// "keep only the time the user thinks it's gonna take"). The rest are never
// asked for: they're guessed from the title and corrected by what the user
// does — a skip reason, past tasks (model.guessFields, now.js).
const CHIPS = ["area", "type", "where", "openHours", "size", "stakes"];
const SHOWN = ["size"];
const NAMES = { area: "Area", type: "Type", where: "Where", openHours: "Open hours", size: "Size", stakes: "Stakes" };
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

// onStart(id): close the sheet, the task on the card, Focus mode on (now.js start).
export function mountAddTask(dialog, uid, { onStart } = {}){
  let tasks = [];
  let editing = null; // the open task (kept fresh from the snapshot), or null for a new one
  let vals = {}, mine = new Set(), openChip = null;
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
  // A routine (routine.js, Mor 2026-10-08): so many times a week. Its end
  // ("Until", the show) takes the Due box's place: a routine has no due date.
  // Made in a project with a due date, it runs until that date.
  const until = dateBox("Until", "No end");
  let per = 0;
  // One switch, "Repeats weekly" (Mor, 2026-10-08: simpler than a row of
  // chips); on, a − N + stepper says how many times. Off = a one-off task.
  const PER_ON = 3; // where the stepper starts: the usual "3× a week"
  const repeatSwitch = h("input", { type: "checkbox", id: "tsRepeat" });
  const perOut = h("output", { className: "ts-per-n" });
  const stepBtn = (d, text, aria) => h("button", { type: "button", className: "ts-step", textContent: text, ariaLabel: aria,
    onclick: () => setPer(Math.min(PER_MAX, Math.max(1, per + d))) });
  const perStep = h("div", { className: "ts-per", role: "group", ariaLabel: "Times a week" },
    stepBtn(-1, "−", "Fewer times a week"), perOut, stepBtn(1, "+", "More times a week"), h("span", { textContent: "times a week" }));
  // Any days (Daisey finds the time) or Set days (Mor, 2026-10-08): the user
  // picks the weekdays and one time, and Daisey writes them as a weekly event
  // in the "Daisey" calendar when the sheet closes (slots.js). The number of
  // days picked is the times a week.
  let mode = "any", days = [], at = DEFAULT_AT;
  const modeBtn = (m, text) => h("button", { type: "button", className: "chip", textContent: text,
    onclick: () => { if (mode === m) return; mode = m; changed(); } });
  const modeRow = h("div", { className: "now-chips ts-mode", role: "group", ariaLabel: "Which days" }, modeBtn("any", "Any days"), modeBtn("set", "Set days"));
  const DAY_LETTER = Array.from({ length: 7 }, (_, i) => new Date(2026, 9, 4 + i).toLocaleDateString(undefined, { weekday: "narrow" }));
  const DAY_NAME = Array.from({ length: 7 }, (_, i) => new Date(2026, 9, 4 + i).toLocaleDateString(undefined, { weekday: "long" }));
  const dayRow = h("div", { className: "ts-days", role: "group", ariaLabel: "Days" },
    ...DAY_LETTER.map((l, i) => h("button", { type: "button", className: "ts-day", textContent: l, ariaLabel: DAY_NAME[i],
      onclick: () => { days = days.includes(i) ? days.filter((d) => d !== i) : [...days, i].sort(); changed(); } })));
  const atIn = h("input", { type: "time", className: "ts-input ts-at", value: DEFAULT_AT, ariaLabel: "At what time" });
  atIn.addEventListener("change", () => { if (/^\d{2}:\d{2}$/.test(atIn.value)) { at = atIn.value; changed(); } });
  const setBox = h("div", { className: "ts-set" }, dayRow, h("label", { className: "ts-at-row" }, h("span", { textContent: "at" }), atIn),
    h("p", { className: "ts-hint", textContent: "Daisey puts these in your Daisey calendar." }));
  // "Needs laptop" (Mor, 2026-10-09): a switch over the guessed where, shown
  // only when Settings turns it on (settings.askLaptop, off by default). On =
  // where "computer"; off = "anywhere". Ticked by itself when Daisey already
  // guesses a laptop task.
  const laptopSwitch = h("input", { type: "checkbox", id: "tsLaptop" });
  const laptopRow = h("div", { className: "ts-hold ts-laptop", hidden: true },
    h("label", { className: "ts-hold-sw", htmlFor: "tsLaptop" }, laptopSwitch, h("span", { textContent: "Needs laptop" })));
  laptopSwitch.addEventListener("change", () => pick("where", laptopSwitch.checked ? "computer" : "anywhere"));
  const oftenRow = h("div", { className: "ts-hold ts-repeat" },
    h("label", { className: "ts-hold-sw", htmlFor: "tsRepeat" }, repeatSwitch, h("span", { textContent: "Repeats weekly" })), modeRow, perStep, setBox);
  const weekNow = h("p", { className: "ts-worked ts-week" });
  const setDays = () => mode === "set" && days.length > 0;
  const routineOf = () => (!per ? null : setDays()
    ? { per: days.length, days, at, until: until.input.value || null }
    : { per, days: [], until: until.input.value || null });
  function changed(){
    if (setDays()) per = days.length;
    paintOften();
    if (editing) save({ routine: routineOf() });
  }
  function setPer(n){
    if (n === per) return;
    per = n;
    if (per && !until.input.value && rangeNow()?.due) until.input.value = rangeNow().due;
    if (per) due.input.value = ""; // a routine has no due date, only its end
    paintDates(); paintOften();
    if (!per && editing) dropSeries(editing); // off: its weekly event goes now, while the task still names it
    if (editing) save({ routine: routineOf(), ...(per && editing.due ? { due: "" } : {}) });
  }
  repeatSwitch.addEventListener("change", () => setPer(repeatSwitch.checked ? PER_ON : 0));
  function paintOften(){
    repeatSwitch.checked = !!per;
    modeRow.hidden = !per;
    for (const b of modeRow.children) b.ariaPressed = String((b.textContent === "Set days") === (mode === "set"));
    perStep.hidden = !per || mode === "set";
    setBox.hidden = !per || mode !== "set";
    perOut.textContent = String(per);
    const [less, more] = perStep.querySelectorAll(".ts-step");
    less.disabled = per <= 1; more.disabled = per >= PER_MAX;
    [...dayRow.children].forEach((b, i) => { b.ariaPressed = String(days.includes(i)); });
    if (document.activeElement !== atIn) atIn.value = at;
  }
  until.input.addEventListener("change", () => { fenceUntil(); paintDates(); if (editing && per) save({ routine: routineOf() }); });
  due.tag.onclick = (e) => {
    e.preventDefault();
    kind = kind === "deadline" ? "target" : "deadline";
    paintDates();
    if (editing) save({ dateKind: kind });
  };
  function paintDates(){
    start.paint(); due.paint(); until.paint();
    due.box.hidden = !!per; until.box.hidden = !per;
    due.tag.hidden = !due.input.value;
    due.tag.textContent = kind === "deadline" ? "Deadline" : "Target";
    due.tag.className = "ts-kind " + kind;
    due.tag.ariaLabel = `${kind === "deadline" ? "Deadline (real)" : "Target (wish)"}: tap to change`;
  }

  // How long you think it takes: Daisey's guess until you tap it.
  const chipRow = h("div", { className: "gchips ts-chips", role: "group", ariaLabel: "How long you think it takes — Daisey's guess until you pick" });

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
  // How much is done: the slider writes the task's % (progressOf), which the
  // Now card, plans and projects all read.
  const pctOut = h("output", { className: "pj-pct" });
  const pctRange = h("input", { type: "range", min: "0", max: "95", step: "5", ariaLabel: "Percent finished" });
  pctRange.addEventListener("input", () => { pctOut.textContent = `${pctRange.value}%`; });
  pctRange.addEventListener("change", () => { if (editing) save({ progress: Number(pctRange.value) }); });
  const pctBox = h("div", { className: "field ts-pct" }, h("label", { textContent: "How much is done?" }), h("div", { className: "ts-pct-row" }, pctRange, pctOut));
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
    h("div", { className: "ts-dates" }, start.box, due.box, until.box),
    field("How long?", chipRow), laptopRow, oftenRow, weekNow, pctBox, pendBox, holdBox, researchLine, stateLine,
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
    if (per) { if (!until.input.value && rangeNow()?.due) until.input.value = rangeNow().due; fenceUntil(); }
    paintDates();
    if (editing) save({ project: projectOf(), ...c, ...(per ? { routine: routineOf() } : {}) }); else reguess();
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
  // The routine's end stays inside the project's dates too.
  function fenceUntil(){
    const r = rangeNow();
    until.input.min = r?.start || ""; until.input.max = r?.due || "";
    if (r && outsideRange(r, until.input.value)) {
      until.input.value = clampDate(r, until.input.value);
      msg.textContent = `Until kept inside the project dates (${rangeText(r)}).`;
    }
  }
  start.input.addEventListener("change", () => { const c = fenceDates(["notBefore"]); paintDates(); if (editing) save({ notBefore: start.input.value, ...c }); });
  due.input.addEventListener("change", () => { const c = fenceDates(["due"]); paintDates(); if (editing) save({ due: due.input.value, dateKind: kind, ...c }); });

  // ---------- chips ----------
  function reguess(){
    const t = title.value.trim();
    // An untitled task still shows the plain default, not an empty row.
    const given = Object.fromEntries([...mine].map((k) => [k, vals[k]]));
    const g = guessFields(t, projectOf(), given, history());
    for (const k of CHIPS) if (!mine.has(k)) vals[k] = g[k];
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
    laptopSwitch.checked = vals.where === "computer";
    chipRow.replaceChildren(...SHOWN.filter((k) => vals[k] != null).map((k) => {
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
    // A routine: where this week stands, and every session it has had.
    const rt = isRoutine(t) ? t.routine : null;
    weekNow.hidden = !rt;
    if (rt) {
      const all = rt.log.length, mins = rt.log.reduce((s, e) => s + (e.min || 0), 0);
      weekNow.textContent = `${weekLine(t)}${all ? ` · ${all} session${all === 1 ? "" : "s"} in all${mins ? `, ${workedText(mins)}` : ""}` : ""}`;
      worked.hidden = true;
    }
    pendBox.hidden = t?.status !== "waiting";
    // Only for an open task that isn't already Pending.
    holdBox.hidden = !t || t.status !== "ready";
    if (t && document.activeElement !== holdSwitch) holdSwitch.checked = !!t.onHold;
    holdWho.parentElement.hidden = !holdSwitch.checked;
    const done = t?.status === "done";
    pctBox.hidden = !t || done || !!rt; // a routine's sessions are whole: no %
    if (t && document.activeElement !== pctRange) {
      pctRange.value = String(Math.min(95, Math.round(progressOf(t) / 5) * 5));
      pctOut.textContent = `${pctRange.value}%`;
    }
    stateLine.hidden = !(t && (done || t.status === "someday"));
    stateLine.replaceChildren(...(done
      ? [`Done ${t.doneAt ? new Date(t.doneAt).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }) : ""}. `,
        h("button", { type: "button", className: "linkish", textContent: "Reopen", onclick: () => { unlogReopened(uid, t); save({ status: "ready" }); } })]
      : ["On hold. Focus brings it back."]));
    const r = t?.research;
    researchLine.hidden = !r || r.online === "unsure" || !r.why;
    researchLine.textContent = r ? `${r.online === "yes" ? "Daisey checked: can be done online" : "Daisey checked: needs a call or a visit"}${r.why ? ` — ${r.why}` : ""}` : "";
    startBtn.hidden = done;
    startBtn.replaceChildren(icon(t ? "focus" : "plus"), h("span", { textContent: t ? "Focus" : "Add task" }));
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
    dropSeries(gone); // its weekly event in the Daisey calendar goes too
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
    if (per) { fenceUntil(); input.routine = routineOf(); }
    else if (due.input.value) { input.due = due.input.value; input.dateKind = kind; }
    if (notes.value.trim()) input.notes = notes.value;
    if (links.length) input.links = links;
    for (const k of mine) input[k] = vals[k];
    try {
      // Resolves on server ack, which never comes offline; the list already
      // has it locally, so don't wait.
      const added = addTask(uid, input, tasks);
      added.catch((e) => { fail(e); flash("Couldn't add ", input.title); });
      // Set days: the weekly event is written once the task has its id.
      if (input.routine?.days?.length) added.then((ref) => ref?.id && owe({ id: ref.id, title: input.title.trim(), size: vals.size, routine: cleanRoutine(input.routine) }));
      flash("Added ", input.title);
      dialog.close();
    } catch (e) { msg.textContent = e.message || String(e); }
  }

  // ---------- open / close ----------
  function clear(){
    clearTimeout(settle);
    vals = {}; mine = new Set(); openChip = null;
    links = []; adding = false; kind = "target";
    title.value = ""; notes.value = ""; newProject.value = ""; waitingOn.value = ""; checkOn.value = "";
    start.input.value = ""; due.input.value = ""; until.input.value = ""; per = 0; mode = "any"; days = []; at = DEFAULT_AT;
    msg.textContent = "";
    disarm();
  }
  function paintAll(){ paintDates(); paintOften(); reguess(); paintLinks(); paintFoot(); } // reguess paints the chips, and fills "How long?" before a title is typed
  const show = () => { if (!dialog.open) dialog.showModal(); requestAnimationFrame(fit); };

  dialog.addEventListener("close", () => {
    flush();
    // The weekly event follows what the sheet now says (slots.js): written,
    // rewritten or deleted only if its days, time, end, title or length changed.
    if (editing && (editing.routine?.series || (per && setDays()))) {
      syncSeries(uid, { ...editing, title: title.value.trim() || editing.title, size: vals.size ?? editing.size,
        routine: per ? cleanRoutine({ ...editing.routine, ...routineOf() }) : { series: editing.routine?.series } }); // off: only the old event, to delete
    }
    editing = null;
  });
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) { dialog.close(); return; }
    if (openChip && !e.target.closest(".gchip-wrap")) { openChip = null; paintChips(); }
  });
  dialog.addEventListener("keydown", (e) => { if (e.key === "Escape" && openChip) { e.preventDefault(); openChip = null; paintChips(); } });

  // The project list: every project a task names, plus the empty ones
  // made with New project in the + menu.
  let made = [], ranges = {};
  const refill = () => {
    colors = Object.fromEntries(projectsOf(tasks || [], null, made).map((p) => [p.name, p.color]).filter(([, c]) => c));
    fillProjects([...new Set([...(tasks || []).map((t) => t.project), ...made])].filter((p) => p && p !== INBOX).sort((a, b) => a.localeCompare(b)));
  };
  const unsubNames = watchProjectNames(uid, (ns, rs) => { made = ns; ranges = rs || {}; refill(); fenceDates([]); }, fail);
  const unsubSettings = watchSettings(uid, (st) => { laptopRow.hidden = st?.askLaptop !== true; }, fail);
  // A Set-days routine added (or changed) offline never got its weekly event:
  // the write waits on a server ack the closed app never saw (BEHAVIOR_REVIEW
  // #9). Owed = its days' sig isn't the event's. Swept once the list comes
  // from the server, and again on reconnect. series: null = tried, nothing
  // to make (a guest, no calendar), so not retried.
  // `asking`: task ids with a sync in flight, so the add's own sync and a sweep landing
  // together don't write the event twice.
  let swept = false;
  const asking = new Set();
  const owe = (t) => {
    const k = t.id; // not the sig: the add passes a size the saved task may not have yet
    if (asking.has(k)) return;
    asking.add(k);
    syncSeries(uid, t).then(() => asking.delete(k));
  };
  const sweepSeries = () => {
    for (const t of tasks || []) {
      const want = t.status !== "done" && seriesSig(t);
      if (want && t.routine.series !== null && t.routine.series?.sig !== want) owe(t);
    }
  };
  addEventListener("online", () => { if (swept) sweepSeries(); });
  const unsub = watchTasks(uid, (ts, meta) => {
    tasks = ts;
    if (!swept && meta && !meta.fromCache) { swept = true; sweepSeries(); }
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
      per = isRoutine(task) ? task.routine.per : 0;
      until.input.value = per ? task.routine.until || "" : "";
      days = per && task.routine.days ? [...task.routine.days] : [];
      mode = days.length ? "set" : "any";
      at = task.routine?.at || DEFAULT_AT;
      fenceDates([]);
      kind = task.dateKind === "deadline" ? "deadline" : "target";
      notes.value = task.notes || "";
      waitingOn.value = task.waitingOn || "";
      holdWho.value = task.onHold?.who || "";
      checkOn.value = task.checkOn || "";
      checkOn.min = localDate();
      links = (task.links || []).map((l) => ({ ...l }));
      const guessed = new Set(task.guessed || []);
      for (const k of CHIPS) if (validField(k, task[k])) { vals[k] = task[k]; if (!guessed.has(k) || SHOWN.includes(k)) mine.add(k); } // a saved "How long?" shows as chosen, even if Daisey set it
      if (CHIPS.some((k) => !(k in vals))) reguess();
      paintAll();
      show();
    },
    unmount(){ clearTimeout(settle); unsub(); unsubNames(); unsubSettings(); if (dialog.open) dialog.close(); dialog.replaceChildren(); },
  };
}
