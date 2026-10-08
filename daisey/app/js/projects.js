// Projects (layout round 3, Mor 2026-10-06; New Design/7-home-projects-tab
// and 8-project). Two views of the same thing:
//
// The Projects page of the home panel. "4 projects · 14 tasks" + "+ New",
// a 2-column grid of project cards in their colour — name, count, one
// status line, progress — and the Inbox row under it. (It was a pull-up
// sheet until round 3.)
//
// The project screen. Back arrow + a row of project chips (the current one
// filled in its colour); tap a chip, or swipe sideways anywhere that isn't a
// task, for the next/previous project. A project card (name, progress), and under its bar two toggles, "X of Y done" and "On hold · N",
// each opening its drawer in the card: done tasks with a ticked tick that
// reopens, Not now (status someday) with Bring back. Below the card, one
// list in the order Daisey hands tasks out: ready first, then Pending,
// dashed, with what it waits on — no section headers (Mor, 2026-10-06; New
// Design/11-project-one-list). Swipe a task right = done (green reveal,
// Undo toast). Tap one = the task sheet.
//
// Every project has its own colour (Mor, 2026-10-06): its tasks' most common
// area when no other project has that one yet, else the next free colour in
// PALETTE. Names are taken in order, so a colour doesn't move around as
// counts change. Inbox has none.
import { watchTasks, finishTask, restoreTask, removeTask, watchProjectNames, saveProjectNames, saveProjectRanges, saveProjectOrder, saveProjectTiers } from "./store.js";
import { INBOX, progressOf, progressPatch, leftMinutes, pushedTo, notYet, durText, localDate, bringBack, cleanRange, outsideRange } from "./model.js";
import { isOverdue } from "./triage.js";
import { h, bdi, flash, icon, askProgress, sizeChip, progressBar } from "./ui.js";
import { dirOf, setProjectColors } from "./look.js";
import { setProjectTiers } from "./context.js";
import { TIERS, FOCUS_MAX } from "./weights.js";
import { sortable, zoneSortable } from "./ppdrag.js";

const SWIPE_DONE = 90; // px a task travels right before letting go finishes it
const SWIPE_PAGE = 70; // px sideways that turns the page to the next project
// A date in the list said the way a person would (Mor, 2026-10-06): today,
// tomorrow, yesterday; a weekday within the week either side; else "12 Oct".
// Not numbers: 8/10 reads as a different day in another locale.
function shortDay(s){
  const d = daysTo(s), at = new Date(`${s}T12:00`);
  if (d === 0) return "today";
  if (d === 1) return "tomorrow";
  if (d === -1) return "yesterday";
  if (Math.abs(d) <= 6) return at.toLocaleDateString(undefined, { weekday: "short" });
  return at.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
const motionOK = () => !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const isOpen = (t) => t.status !== "done" && t.status !== "dropped";
const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;

// The area colours first, then extras (app.css .pc-<key>), most distinct first.
const PALETTE = ["work", "admin", "teal", "social", "job", "home", "orange", "personal", "slate", "brick", "lime"];
const hash = (s) => [...String(s)].reduce((a, c) => (a * 31 + c.codePointAt(0)) >>> 0, 7);
export function colorize(ps){
  const taken = new Set();
  for (const p of [...ps].filter((p) => p.name !== INBOX).sort((a, b) => a.name.localeCompare(b.name))) {
    let c = PALETTE.includes(p.area) && !taken.has(p.area) ? p.area : null;
    for (let k = 0, i = hash(p.name); !c && k < PALETTE.length; k++) if (!taken.has(PALETTE[(i + k) % PALETTE.length])) c = PALETTE[(i + k) % PALETTE.length];
    p.color = c || PALETTE[hash(p.name) % PALETTE.length];
    taken.add(p.color);
  }
  return ps;
}
const colorClass = (p) => (p.color ? ` pc-${p.color}` : "");

// The projects, with everything both views show about each. `made`: the
// saved project names (state/projects) — every project, not just "+ New"
// ones, so a project outlives its last task and goes only by Delete project
// (Mor, 2026-10-06: deleting the last task took the project with it).
export function projectsOf(tasks = [], onCard = null, made = [], order = []){
  const names = [...new Set([...tasks.filter(isOpen).map((t) => t.project || INBOX),
    ...made.filter((n) => n && n !== INBOX)])];
  return colorize(names.map((name) => {
    const all = tasks.filter((t) => (t.project || INBOX) === name && t.status !== "dropped");
    const open = all.filter(isOpen);
    const n = {};
    for (const t of (open.length ? open : all)) if (t.area) n[t.area] = (n[t.area] || 0) + 1;
    const area = Object.entries(n).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    const next = open.filter((t) => t.status === "ready").sort(dragged(urgency(onCard)));
    return {
      name, area, open, all,
      next,
      pending: open.filter((t) => t.status === "waiting").sort(dragged((a, b) => String(a.checkOn || "~").localeCompare(String(b.checkOn || "~")))),
      someday: open.filter((t) => t.status === "someday"),
      done: all.filter((t) => t.status === "done").sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0)),
    };
  }).sort((a, b) => dragRank(order, a.name) - dragRank(order, b.name) || b.open.length - a.open.length || (a.name === INBOX) - (b.name === INBOX) || a.name.localeCompare(b.name)));
}

// Dragged order (Mor, 2026-10-08): a project or task Mor has dragged keeps
// that place; what hasn't been dragged yet follows, in the usual order.
const dragRank = (order, name) => { const i = order.indexOf(name); return i < 0 ? order.length : i; };
const dragged = (rest) => (a, b) => (a.pos == null) - (b.pos == null) || (a.pos ?? 0) - (b.pos ?? 0) || rest(a, b);

// Next, most urgent first: the card's task, then what can start now, then
// passed deadlines, then by date, then oldest.
const urgency = (onCard) => (a, b) => (b.id === onCard) - (a.id === onCard)
  || notYet(a) - notYet(b)
  || isOverdue(b) - isOverdue(a)
  || (a.dateKind === "deadline" ? 0 : 1) - (b.dateKind === "deadline" ? 0 : 1)
  || String(a.due || "9999").localeCompare(String(b.due || "9999"))
  || (a.createdAt || 0) - (b.createdAt || 0);

// The one status line on a grid card.
function statusLine(p){
  const now = p.next.find((t) => !notYet(t));
  if (now) return ["Next: ", bdi(now.title)];
  const parts = [p.pending.length && `${p.pending.length} pending`, p.next.length && `${p.next.length} later`, p.someday.length && `${p.someday.length} on hold`].filter(Boolean);
  return [parts.join(" · ") || (p.all.length ? "All done" : "No tasks yet")];
}
// Effort still to do (master spec s.16, 2026-10-06): the sizes of the open
// tasks less the time already put in, 5 minutes at least each. Pending ones
// count: they're still part of the way to done. Not now ones don't.
export const minutesLeft = (p) => [...p.next, ...p.pending].reduce((n, t) => n + leftMinutes(t), 0);
// Mean of the tasks' own % (done = 100), so half-finished work counts.
const progress = (p) => (p.all.length ? p.all.reduce((n, t) => n + progressOf(t), 0) / (100 * p.all.length) : 0);
const bar = (p, cls) => h("div", { className: cls, role: "img", ariaLabel: `${Math.round(progress(p) * 100)}% done` },
  h("span", { style: `inline-size:${Math.round(progress(p) * 100)}%` }));

// A task's date says how close it is (Mor, 2026-10-06; the project card's
// nearest-date badge is gone — a date belongs to its task): a deadline
// within a week yellow, within 2 days orange, passed red and bold.
const daysTo = (s) => Math.round((new Date(`${s}T12:00`) - new Date(`${localDate()}T12:00`)) / 864e5);
function dueTone(t){
  if (isOverdue(t)) return "over";
  if (t.dateKind !== "deadline" || !t.due) return "";
  const d = daysTo(t.due);
  return d <= 2 ? "soon" : d <= 7 ? "near" : "";
}

// els: { grid, view, dialog }. onOpen(task): the task sheet. onAdd(project):
// a new task there. onStart(id).
export function mountProjects(els, uid, { onOpen, onAdd, onStart, onScreen } = {}){
  let tasks = null, onCard = null, made = [], order = [], tiers = {};
  let dragging = false, stale = false; // a drag is live: hold the redraws (ppdrag.js)
  let ranges = {}; // name -> { start, due }: the dates a project runs between
  let shown = null; // the project on the project screen
  let drawer = null; // the open drawer in the project card: "done", "someday" or null
  const fail = (e) => console.error("[daisey] projects", e);
  const list = () => projectsOf(tasks || [], onCard, made, order);
  const hold = (on) => { dragging = on; if (!on && stale) { stale = false; render(); } };

  // ---------- the Projects page ----------
  // Tiers (Mor, 2026-10-08): Focus, Keep going, Background. The engine
  // scores a project by its tier (engine.js priority, weights TIER); a new
  // project starts in Keep going. Each tier is a drop area (ppdrag.js
  // zoneSortable): a card dropped in it joins it; order inside a tier is just
  // how Mor likes to see them. While a card is dragged, the area under it
  // lights up whole — or turns red when full: Focus holds FOCUS_MAX, so it
  // stays a choice.
  const TIER_TEXT = { focus: ["Focus", "Most of your time"], keep: ["Keep going", "Steady progress"], background: ["Background", "When there's room"] };
  const MOVED = { focus: "More of your time goes to ", keep: "Steady progress for ", background: "To the background: " };
  const tierOf = (name) => (TIERS.includes(tiers[name]) ? tiers[name] : "keep");
  const full = (name, t) => t === "focus" && tierOf(name) !== "focus" && list().filter((p) => p.name !== INBOX && tierOf(p.name) === "focus").length >= FOCUS_MAX;
  function setTier(name, t, names){
    const was = { tiers, order };
    tiers = { ...tiers, [name]: t }; order = names;
    render();
    saveProjectOrder(uid, order).catch(fail);
    saveProjectTiers(uid, tiers).catch(fail);
    flash(MOVED[t], name, { undo: () => { tiers = was.tiers; order = was.order; render();
      saveProjectOrder(uid, order).catch(fail); saveProjectTiers(uid, tiers).catch(fail); } });
  }
  const dragProjects = (box) => { zoneSortable(box, { busy: hold,
    onZone: (zone, el) => {
      for (const z of box.children) {
        z.classList.toggle("on", z === zone);
        z.classList.toggle("full", z === zone && full(el._name, z._tier));
      }
    },
    onMove: (el, zone) => {
      const t = zone._tier;
      if (full(el._name, t)) { flash(`Focus holds ${FOCUS_MAX}. Move one out first.`); render(); return; }
      // The DOM already shows where it landed (zoneSortable moved the card).
      const names = [...box.children].flatMap((z) => [...z.children].filter((k) => k._name).map((k) => k._name));
      if (t !== tierOf(el._name)) return setTier(el._name, t, names);
      order = names; render();
      saveProjectOrder(uid, names).catch(fail);
    } }); return box; };
  // Same for a project's tasks: each group keeps its own order (the task's pos).
  const dragTasks = (box, group) => { sortable(box, { busy: hold,
    onMove: (el, before) => {
      const g = group.filter((t) => t !== el._t);
      g.splice(before ? g.indexOf(before._t) : g.length, 0, el._t);
      g.forEach((t, i) => { if (t.pos !== i) { t.pos = i; restoreTask(uid, t.id, { pos: i }).catch(fail); } });
      render();
    } }); return box; };
  function paintGrid(){
    const all = list();
    setProjectColors(Object.fromEntries(all.filter((p) => p.color).map((p) => [p.name, p.color])));
    const inbox = all.find((p) => p.name === INBOX);
    const ps = all.filter((p) => p !== inbox);
    setProjectTiers(Object.fromEntries(ps.map((p) => [p.name, tierOf(p.name)])));
    const card = (p) => h("button", { type: "button", className: "pcard pp-drag" + colorClass(p), _name: p.name, onclick: () => openProject(p.name) },
      h("span", { className: "pcard-top", dir: dirOf(p.name) },
        h("span", { className: "pcard-name", dir: "auto", textContent: p.name }), h("span", { className: "pcard-n", textContent: String(p.open.length) })),
      h("span", { className: "pcard-status" }, ...statusLine(p)),
      bar(p, "pbar"));
    const tier = (t) => { const ins = ps.filter((p) => tierOf(p.name) === t);
      return h("div", { className: `pp-zone tier-${t}`, _tier: t },
        h("div", { className: "pp-tier" }, h("span", { className: "pp-tier-name", textContent: TIER_TEXT[t][0] }), h("span", { className: "pp-tier-sub", textContent: TIER_TEXT[t][1] })),
        h("span", { className: "pp-tier-empty", textContent: "Drag a project here" }), ...ins.map(card)); };
    const n = all.reduce((s, p) => s + p.open.length, 0);
    const y = els.grid.scrollTop;
    els.grid.replaceChildren(...[
      h("div", { className: "pp-head" }, h("span", { className: "pp-sum", textContent: `${plural(ps.length, "project")} · ${plural(n, "task")}` }),
        h("button", { type: "button", className: "pp-new", textContent: "+ New", onclick: () => askName() })),
      ps.length ? dragProjects(h("div", { className: "pgrid tiers" }, ...TIERS.map(tier)))
        : !inbox && h("p", { className: "muted pp-empty", textContent: "No projects yet. Tell Daisey what's on your plate." }),
      inbox ? h("button", { type: "button", className: "pp-inbox", onclick: () => openProject(INBOX) },
        icon("inbox"), h("span", { className: "pp-inbox-t", textContent: "Inbox" }),
        h("span", { className: "pp-inbox-n", textContent: `${inbox.open.length} · no project yet` })) : null].filter(Boolean));
    els.grid.scrollTop = y;
  }

  // ---------- "+ New": a name, and an empty project ----------
  // A project's start and due (Mor, 2026-10-07). Both optional; its tasks'
  // dates can't fall outside them (addtask.js reads the same ranges).
  function dateFields(range){
    const mk = (label, v) => { const i = h("input", { className: "ts-input", type: "date", ariaLabel: label, value: v || "" });
      return [i, h("label", { className: "np-date" }, h("span", { textContent: label }), i)]; };
    const [start, sl] = mk("Start", range?.start), [due, dl] = mk("Due", range?.due);
    const msg = h("p", { className: "msg", role: "alert" });
    // Not a range if due is before start: say so rather than swap them silently.
    const read = () => {
      if (start.value && due.value && due.value < start.value) { msg.textContent = "Due can't be before the start."; due.focus(); return false; }
      return cleanRange({ start: start.value, due: due.value }) || null;
    };
    return { box: h("div", { className: "np-dates" }, sl, dl), msg, read };
  }
  function setRange(name, range){
    ranges = { ...ranges, [name]: range };
    saveProjectRanges(uid, ranges).catch(fail);
  }

  function askName(){
    const d = els.dialog;
    const dates = dateFields(null);
    const name = h("input", { className: "ts-input", dir: "auto", autocomplete: "off", enterKeyHint: "done",
      placeholder: "Project name", ariaLabel: "Project name", required: true });
    const msg = h("p", { className: "msg", role: "alert" });
    const create = (e) => {
      e.preventDefault();
      const v = name.value.trim();
      if (!v) { name.focus(); return; }
      if (v === INBOX || list().some((p) => p.name.toLowerCase() === v.toLowerCase())) { msg.textContent = "There's already a project by that name."; name.focus(); return; }
      const r = dates.read();
      if (r === false) return;
      made = [...made, v];
      saveProjectNames(uid, made).catch(fail);
      if (r) setRange(v, r);
      paintGrid();
      d.close();
    };
    d.replaceChildren(
      h("div", { className: "now-head" }, h("h2", { id: "npTitle", textContent: "New project" }),
        h("button", { className: "now-x", type: "button", ariaLabel: "Close", textContent: "✕", onclick: () => d.close() })),
      h("form", { className: "np-form", onsubmit: create }, name, msg, dates.box, dates.msg,
        h("div", { className: "sheet-actions" },
          h("button", { className: "btn primary", type: "submit", textContent: "Add project" }),
          h("button", { className: "btn quiet", type: "button", textContent: "Cancel", onclick: () => d.close() }))));
    d.onclick = (e) => { if (e.target === d) d.close(); };
    d.showModal();
    name.focus();
  }

  // Edit project (Mor, 2026-10-07): tap the name on the project screen. The
  // name and the start/due dates in one dialog. A new name moves every task
  // carrying the old one, the saved name and the dates.
  function askRename(old){
    const d = els.dialog, f = dateFields(ranges[old]);
    const name = h("input", { className: "ts-input", dir: "auto", autocomplete: "off", enterKeyHint: "done",
      placeholder: "Project name", ariaLabel: "Project name", required: true, value: old });
    const msg = h("p", { className: "msg", role: "alert" });
    const save = (e) => {
      e.preventDefault();
      const v = name.value.trim();
      if (!v) { name.focus(); return; }
      if (v !== old && (v === INBOX || list().some((p) => p.name.toLowerCase() === v.toLowerCase() && p.name !== old))) { msg.textContent = "There's already a project by that name."; name.focus(); return; }
      const r = f.read();
      if (r === false) return;
      if (v !== old) {
        for (const t of (tasks || [])) if ((t.project || INBOX) === old) restoreTask(uid, t.id, { project: v }).catch(fail);
        made = [...made.filter((n) => n !== old && n !== v), v];
        saveProjectNames(uid, made).catch(fail);
        const { [old]: _gone, ...rest } = ranges; ranges = rest;
        if (tiers[old]) { const { [old]: t, ...others } = tiers; tiers = { ...others, [v]: t }; saveProjectTiers(uid, tiers).catch(fail); }
        shown = v;
        onScreen?.(v);
      }
      setRange(v, r);
      const out = (tasks || []).filter((t) => isOpen(t) && (t.project || INBOX) === old && (outsideRange(r, t.due) || outsideRange(r, t.notBefore))).length;
      render();
      d.close();
      if (out) flash(`${plural(out, "task")} outside these dates: `, v);
    };
    // Any project but the Inbox. Two taps to confirm; its tasks are deleted too.
    let del = null;
    if (old !== INBOX) {
      let armed = false;
      const n = (tasks || []).filter((t) => (t.project || INBOX) === old).length;
      del = h("button", { className: "btn quiet danger", type: "button", textContent: "Delete project", onclick: () => {
        if (!armed) { armed = true; del.textContent = n ? `Really delete? ${plural(n, "task")} too` : "Really delete?"; del.classList.add("arm"); return; }
        d.close();
        deleteProject(old);
      } });
    }
    d.replaceChildren(
      h("div", { className: "now-head" }, h("h2", { id: "npTitle", textContent: "Edit project" }),
        h("button", { className: "now-x", type: "button", ariaLabel: "Close", textContent: "✕", onclick: () => d.close() })),
      h("form", { className: "np-form", onsubmit: save }, name, msg, f.box, f.msg,
        h("div", { className: "sheet-actions" },
          h("button", { className: "btn primary", type: "submit", textContent: "Save" }),
          h("button", { className: "btn quiet", type: "button", textContent: "Cancel", onclick: () => d.close() }),
          del)));
    d.onclick = (e) => { if (e.target === d) d.close(); };
    d.showModal();
    name.focus();
    name.select();
  }

  // Its tasks are deleted with it. No undo: tasks can't be recreated with the same ids.
  function deleteProject(name){
    const gone = (tasks || []).filter((t) => (t.project || INBOX) === name);
    for (const t of gone) removeTask(uid, t.id).catch(fail);
    made = made.filter((n) => n !== name);
    saveProjectNames(uid, made).catch(fail);
    const { [name]: _gone, ...rest } = ranges; ranges = rest;
    onScreen?.(null);
    render();
    flash("Deleted: ", name);
  }

  // ---------- the project screen ----------
  function complete(t){
    const before = { status: t.status || "ready", doneAt: t.doneAt ?? null, skipsSinceStart: t.skipsSinceStart ?? 0, progress: t.progress ?? 0 };
    askProgress(t, {
      start: progressOf(t) || 50,
      onFull: () => {
        finishTask(uid, t).catch(fail);
        flash("Done: ", t.title, { undo: () => restoreTask(uid, t.id, before).catch(fail) });
      },
      onPartial: (pct, when) => {
        const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); let x = localDate(d.getTime()); if (t.dateKind === "deadline" && t.due && t.due < x) x = t.due; return x; };
        const patch = when === "someday" ? { status: "someday" } : when === "tomorrow" ? { notBefore: day(1) } : when === "week" ? { notBefore: day(3) } : {};
        restoreTask(uid, t.id, { ...progressPatch(pct), ...(when === "today" ? {} : pushedTo(t, patch)) }).catch(fail);
        flash(`${pct}% done: `, t.title, { undo: () => restoreTask(uid, t.id, { ...before, notBefore: t.notBefore ?? null, pushes: t.pushes ?? 0 }).catch(fail) });
      },
    });
  }

  // A task card that swipes right to finish.
  function swipeCard(t, card){
    const reveal = h("span", { className: "pj-reveal", ariaHidden: "true" }, icon("check"), h("span", { textContent: "Done" }));
    // The tick does what the swipe does, for whoever doesn't know to swipe.
    const tick = h("button", { type: "button", className: "pj-tick", ariaLabel: `Done: ${t.title}`,
      onclick: () => { tick.classList.add("on"); setTimeout(() => complete(t), motionOK() ? 220 : 0); } }, icon("check"));
    const wrap = h("div", { className: "pj-swipe pp-drag" + (t.status === "waiting" ? " wait" : ""), _t: t }, reveal, card, tick);
    let s = null, moved = false;
    card.addEventListener("pointerdown", (e) => { s = { x: e.clientX, y: e.clientY, id: e.pointerId, dx: 0 }; moved = false; });
    card.addEventListener("pointermove", (e) => {
      if (s && wrap.classList.contains("pp-dragging")) s = null; // being dragged, not swiped
      if (!s) return;
      const sign = getComputedStyle(card).direction === "rtl" ? -1 : 1;
      const dx = (e.clientX - s.x) * sign, dy = e.clientY - s.y;
      if (!moved) {
        if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { s = null; return; }
        if (dx < 10 || dx < Math.abs(dy) * 1.5) return;
        moved = true;
        try { card.setPointerCapture(s.id); } catch { /* gone */ }
        wrap.classList.add("swiping");
      }
      s.dx = Math.max(0, dx);
      card.style.transform = `translateX(${s.dx * sign}px)`;
      wrap.classList.toggle("armed", s.dx > SWIPE_DONE);
    });
    const end = () => {
      if (!s) return;
      const go = moved && s.dx > SWIPE_DONE;
      s = null;
      wrap.classList.remove("swiping", "armed");
      if (go) {
        const sign = getComputedStyle(card).direction === "rtl" ? -1 : 1;
        card.style.transform = `translateX(${sign * 110}%)`;
        setTimeout(() => complete(t), motionOK() ? 160 : 0);
      } else card.style.transform = "";
    };
    card.addEventListener("pointerup", end);
    card.addEventListener("pointercancel", end);
    card.addEventListener("click", (e) => { if (moved) { e.preventDefault(); e.stopImmediatePropagation(); moved = false; } }, true);
    return wrap;
  }

  function nextMeta(t){
    const parts = [sizeChip(t.size ? t : { ...t, size: 30 })];
    // Both dates when both apply (Mor, 2026-10-06): the start while it's
    // still ahead (the card is dimmed until then), then the due date.
    // "Starts", not "from": "from" read as the start of a range ending at due.
    if (notYet(t)) parts.push(`Starts ${shortDay(t.notBefore)}`);
    if (t.onHold) parts.push(t.onHold.who ? `waiting on ${t.onHold.who}` : "waiting for a reply");
    // Further than 2 weeks: no date in the list, only in the task sheet.
    if (t.due && (isOverdue(t) || daysTo(t.due) <= 14)) {
      const tone = dueTone(t), text = `${isOverdue(t) ? "was due" : t.dateKind === "deadline" ? "due" : "by"} ${shortDay(t.due)}`;
      parts.push(tone ? h("span", { className: `pj-date ${tone}`, textContent: text }) : text);
    }
    return parts.flatMap((x, i) => (i ? [" · ", x] : [x]));
  }
  const taskBtn = (t, kids) => h("button", { type: "button", className: "pj-task" + (notYet(t) ? " later" : ""), dir: dirOf(t.title),
    ariaLabel: `Open ${t.title}`, onclick: () => onOpen?.(t) }, ...kids);

  // A done task's tick reopens it; Bring back takes one out of Not now.
  // restoreTask writes as-is, so doneAt has to be cleared by hand.
  function reopen(t){
    const before = { status: "done", doneAt: t.doneAt ?? Date.now() };
    restoreTask(uid, t.id, { status: "ready", doneAt: null, touchedAt: Date.now() }).catch(fail);
    flash("Reopened: ", t.title, { undo: () => restoreTask(uid, t.id, before).catch(fail) });
  }
  function bringBackTask(t){
    restoreTask(uid, t.id, bringBack(t)).catch(fail);
    flash("Back on the list: ", t.title, { undo: () => restoreTask(uid, t.id, { status: "someday", notBefore: t.notBefore ?? null,
      due: t.due ?? null, dueTime: t.dueTime ?? null, dateKind: t.dateKind ?? null }).catch(fail) });
  }
  const toggle = (key, ...kids) => h("button", { type: "button", className: "pj-tg", ariaExpanded: String(drawer === key),
    onclick: () => { drawer = drawer === key ? null : key; paintView(); } }, ...kids, h("span", { className: "pj-car", ariaHidden: "true", textContent: "▸" }));
  const doneRow = (t) => h("div", { className: "pj-drow", dir: dirOf(t.title) },
    h("button", { type: "button", className: "pj-tick on", ariaLabel: `Reopen: ${t.title}`, onclick: () => reopen(t) }, icon("check")),
    h("button", { type: "button", className: "pj-quiet done", onclick: () => onOpen?.(t) }, bdi(t.title)));
  const notNowRow = (t) => h("div", { className: "pj-drow", dir: dirOf(t.title) },
    h("button", { type: "button", className: "pj-quiet", onclick: () => onOpen?.(t) }, bdi(t.title)),
    h("button", { type: "button", className: "pj-bring", textContent: "Bring back", onclick: () => bringBackTask(t) }));

  function paintView(){
    if (shown == null) return;
    const ps = list();
    let p = ps.find((x) => x.name === shown);
    if (!p) { // emptied out: keep showing it as done, from all tasks
      const all = (tasks || []).filter((t) => (t.project || INBOX) === shown && t.status !== "dropped");
      if (!all.length) { closeProject(); return; }
      p = { name: shown, area: null, open: [], all, next: [], pending: [], someday: [], done: all.filter((t) => t.status === "done") };
    }
    const y = els.view.scrollTop, x = els.view.querySelector(".pj-chips")?.scrollLeft;
    const chips = h("div", { className: "pj-chips", role: "tablist", ariaLabel: "Projects" },
      ...ps.map((q) => h("button", { type: "button", role: "tab", ariaSelected: String(q.name === p.name),
        className: "pj-chip" + colorClass(q), onclick: () => go(q.name) },
      h("span", { className: "dot", ariaHidden: "true" }), bdi(q.name))));
    const next = p.next.map((t) => swipeCard(t, taskBtn(t, [
      h("span", { className: "pj-row" }, h("span", { className: "pj-title", dir: "auto", textContent: t.title }),
        t.id === onCard && h("span", { className: "pj-now", textContent: "NOW" })),
      h("span", { className: "pj-meta", dir: "ltr" }, ...nextMeta(t)), progressBar(t)])));
    const pending = p.pending.map((t) => swipeCard(t, taskBtn(t, [
      h("span", { className: "pj-row" },
        h("span", { className: "pj-col" }, h("span", { className: "pj-title", dir: "auto", textContent: t.title }),
          h("span", { className: "pj-meta", dir: "ltr" }, ...(t.waitingOn ? ["Waiting on ", bdi(t.waitingOn)] : ["Pending"]),
            t.checkOn ? (t.checkOn <= localDate() ? " · check now" : ` · I'll ask you ${shortDay(t.checkOn)}`) : "")),
        t.waitingOn && h("span", { className: "pj-who", ariaHidden: "true", textContent: [...t.waitingOn.trim()][0]?.toUpperCase() || "" }))])));
    if (drawer === "someday" && !p.someday.length) drawer = null;
    const drawerEl = drawer === "done" ? h("div", { className: "pj-drawer" },
      ...(p.done.length ? p.done.slice(0, 50).map(doneRow) : [h("p", { className: "pj-hint", textContent: "Nothing done yet." })]))
      : drawer === "someday" ? h("div", { className: "pj-drawer" },
        h("p", { className: "pj-hint", textContent: "Off your plate. Daisey offers one back on Sunday." }), ...p.someday.slice(0, 50).map(notNowRow))
      : null;
    els.view.replaceChildren(...[
      h("div", { className: "pj-top" },
        h("button", { type: "button", className: "pj-back", ariaLabel: "Back", onclick: () => onScreen?.(null) }, icon("back")), chips),
      h("div", { className: "pj-card" + (dirOf(p.name) === "rtl" ? " rtl" : "") },
        h("div", { className: "pj-card-top", dir: dirOf(p.name) }, h("h2", { className: "pj-name" + (p.name === INBOX ? "" : " rename"), dir: "auto", textContent: p.name,
          ...(p.name === INBOX ? {} : { role: "button", tabIndex: 0, title: "Edit project", onclick: () => askRename(p.name),
            onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); askRename(p.name); } } }) }),
          h("span", { className: "pj-pct", textContent: `${Math.round(progress(p) * 100)}%` })),
        h("div", { className: "pj-prog" }, bar(p, "pbar big")),
        p.name !== INBOX && (ranges[p.name]?.start || ranges[p.name]?.due) && h("p", { className: "pj-left", textContent:
          [ranges[p.name].start ? `Starts ${shortDay(ranges[p.name].start)}` : null, ranges[p.name].due ? `due ${shortDay(ranges[p.name].due)}` : null].filter(Boolean).join(" · ") }),
        p.all.length > 0 && h("div", { className: "pj-tgs" },
          toggle("done", h("span", { className: "pj-ok", ariaHidden: "true" }, icon("check")), h("span", { className: "pj-tg-t", textContent: `${p.done.length} of ${p.all.length} done` })),
          p.someday.length > 0 && toggle("someday", h("span", { className: "pj-zz", ariaHidden: "true" }), h("span", { className: "pj-tg-t", textContent: `On hold · ${p.someday.length}` }))),
        drawerEl),
      h("section", { className: "pj-sec pj-one", ariaLabel: "Tasks" },
        dragTasks(h("div", { className: "pj-grp" }, ...next), p.next), dragTasks(h("div", { className: "pj-grp" }, ...pending), p.pending),
        h("button", { type: "button", className: "pj-add", textContent: "+ Add a task", onclick: () => onAdd?.(p.name === INBOX ? "" : p.name) })),
      ].filter(Boolean));
    els.view.className = "ppage" + colorClass(p);
    els.view.scrollTop = y;
    const row = els.view.querySelector(".pj-chips");
    if (x != null) row.scrollLeft = x;
    const cur = row.querySelector('[aria-selected="true"]');
    if (cur) {
      const r = cur.getBoundingClientRect(), b = row.getBoundingClientRect();
      if (r.left < b.left || r.right > b.right) cur.scrollIntoView({ block: "nearest", inline: "center", behavior: x == null || !motionOK() ? "auto" : "smooth" });
    }
  }
  function go(name){
    if (name === shown) return;
    shown = name; drawer = null;
    els.view.scrollTop = 0;
    paintView();
  }
  function step(by){
    const ps = list();
    const i = ps.findIndex((p) => p.name === shown);
    if (ps.length < 2 || i < 0) return;
    go(ps[(i + by + ps.length) % ps.length].name);
  }
  // Sideways anywhere that isn't a task or the chip row turns the page.
  // The page follows the finger, slides off, and the next project slides in
  // (same as the Schedule's day swipe).
  let page = null, sawSwipe = false;
  // Only the body moves; the header with the project chips stays put.
  const slide = (x, ms) => {
    for (const c of els.view.children) {
      if (c.classList.contains("pj-top")) continue;
      c.style.transition = ms ? `transform ${ms}ms ease-out` : "none";
      c.style.transform = x ? `translateX(${x}px)` : "";
    }
  };
  const flip = (side, swap) => {
    const out = side * (els.view.clientWidth || innerWidth);
    slide(out, 140);
    setTimeout(() => { swap(); slide(-out); els.view.getBoundingClientRect(); slide(0, 180); }, 140);
  };
  els.view.addEventListener("pointerdown", (e) => {
    page = e.target.closest(".pj-swipe, .pj-chips, input, textarea") ? null : { x: e.clientX, y: e.clientY, on: false };
  });
  els.view.addEventListener("pointermove", (e) => {
    if (!page) return;
    const dx = e.clientX - page.x, dy = e.clientY - page.y;
    if (!page.on && Math.abs(dx) > 10 && Math.abs(dx) > 1.5 * Math.abs(dy)) {
      page.on = true;
      try { els.view.setPointerCapture(e.pointerId); } catch { /* gone already */ }
    }
    if (page.on) slide(dx * 0.9);
  });
  els.view.addEventListener("pointerup", (e) => {
    if (!page) return;
    const dx = e.clientX - page.x, dy = e.clientY - page.y, on = page.on;
    page = null;
    if (!on) return;
    sawSwipe = true; setTimeout(() => { sawSwipe = false; });
    if (Math.abs(dx) > SWIPE_PAGE && Math.abs(dx) > 1.5 * Math.abs(dy)) {
      const rtl = getComputedStyle(els.view).direction === "rtl";
      flip(dx < 0 ? -1 : 1, () => step((dx < 0) !== rtl ? 1 : -1));
    } else slide(0, 180);
  });
  els.view.addEventListener("pointercancel", () => { if (page?.on) slide(0, 180); page = null; });
  els.view.addEventListener("lostpointercapture", (e) => { if (e.target === els.view && page?.on) { slide(0, 180); page = null; } });
  els.view.addEventListener("click", (e) => { if (sawSwipe) { e.stopPropagation(); e.preventDefault(); } }, true);

  // A project takes the grid's place in the home panel (Mor, 2026-10-08);
  // closing it brings the grid back if that's where it was opened from.
  let fromGrid = false;
  function openProject(name){
    if (shown == null) fromGrid = !els.page.hidden;
    shown = name; drawer = null;
    els.page.hidden = true;
    els.view.hidden = false;
    els.view.scrollTop = 0;
    paintView();
    onScreen?.(name);
  }
  function closeProject(){
    if (shown != null && fromGrid) { els.page.hidden = false; paintGrid(); }
    shown = null; fromGrid = false; els.view.hidden = true; els.view.replaceChildren();
  }
  // The Projects grid (Mor, 2026-10-08): sits in the home panel in the
  // Schedule's place, toggled by the Projects button.
  function openAll(){ els.page.hidden = false; els.page.scrollTop = 0; paintGrid(); }
  function closeAll(){ els.page.hidden = true; fromGrid = false; }

  // Every project a task names gets saved, so it stays when its tasks go.
  // Only once both have loaded: saving before the names arrive would
  // overwrite them.
  let namesIn = false;
  function keepNames(){
    if (!tasks || !namesIn) return;
    const add = [...new Set(tasks.filter((t) => t.status !== "dropped").map((t) => t.project))].filter((n) => n && n !== INBOX && !made.includes(n));
    if (!add.length) return;
    made = [...made, ...add];
    saveProjectNames(uid, made).catch(fail);
  }

  function render(){ if (dragging) { stale = true; return; } paintGrid(); paintView(); }
  const unsubs = [
    watchTasks(uid, (ts) => { tasks = ts; keepNames(); render(); }, fail),
    watchProjectNames(uid, (ns, rs, od, tr) => { made = ns; ranges = rs || {}; order = od || []; tiers = tr || {}; namesIn = true; keepNames(); render(); }, fail),
  ];
  render();

  return {
    setCurrent(id){ onCard = id; render(); },
    openProject,
    closeProject,
    openAll,
    closeAll,
    // The project on screen, for "+ Task": the open project, else none.
    shownProject: () => shown,
    unmount(){ unsubs.forEach((u) => u()); closeProject(); els.grid.replaceChildren(); if (els.dialog.open) els.dialog.close(); },
  };
}
