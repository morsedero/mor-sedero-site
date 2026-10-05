// Projects (layout round 2, Mor 2026-10-05; New Design/7 and 8). Two views
// of the same thing, both one pull or one tap from home:
//
// The pull-up sheet. Resting, it's a handle, "Projects · 4 projects · 14
// tasks" and the Tell Daisey pill. Dragged up (or the handle tapped) it
// covers the home screen: a mini Now bar on top ("Now: <task>" + Start),
// then "Projects" + "+ New" and a 2-column grid of project cards in their
// area colour — name, count, one status line, progress. No schedule here.
// Drag down or tap the handle to close.
//
// The project screen. Back arrow + a row of project chips (the current one
// filled in its colour); tap a chip, or swipe sideways anywhere that isn't a
// task, for the next/previous project. A project card (name, area, "X of Y
// done"), then one list by urgency: Next, Pending (with what it waits on),
// and Someday and Done folded into a line each. Swipe a task right = done
// (green reveal, Undo toast). Tap one = the task sheet.
//
// A project's colour is its tasks' most common area (the same rule the old
// chips used). It replaces the Tasks list (tasks.js) and the Today panel.
import { watchTasks, finishTask, restoreTask } from "./store.js";
import { INBOX, notYet, durText, localDate } from "./model.js";
import { isOverdue } from "./triage.js";
import { h, bdi, flash, icon } from "./ui.js";
import { areaName, dirOf } from "./look.js";

const SWIPE_DONE = 90; // px a task travels right before letting go finishes it
const SWIPE_PAGE = 70; // px sideways that turns the page to the next project
const shortDay = (s) => new Date(`${s}T12:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
const motionOK = () => !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const isOpen = (t) => t.status !== "done" && t.status !== "dropped";
const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;

// The projects, with everything both views show about each.
export function projectsOf(tasks = [], onCard = null){
  const names = [...new Set(tasks.filter(isOpen).map((t) => t.project || INBOX))];
  return names.map((name) => {
    const all = tasks.filter((t) => (t.project || INBOX) === name && t.status !== "dropped");
    const open = all.filter(isOpen);
    const n = {};
    for (const t of (open.length ? open : all)) if (t.area) n[t.area] = (n[t.area] || 0) + 1;
    const area = Object.entries(n).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    const next = open.filter((t) => t.status === "ready").sort(urgency(onCard));
    return {
      name, area, open, all,
      next,
      pending: open.filter((t) => t.status === "waiting").sort((a, b) => String(a.checkOn || "~").localeCompare(String(b.checkOn || "~"))),
      someday: open.filter((t) => t.status === "someday"),
      done: all.filter((t) => t.status === "done").sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0)),
    };
  }).sort((a, b) => b.open.length - a.open.length || (a.name === INBOX) - (b.name === INBOX) || a.name.localeCompare(b.name));
}

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
  const parts = [p.pending.length && `${p.pending.length} pending`, p.next.length && `${p.next.length} later`, p.someday.length && `${p.someday.length} someday`].filter(Boolean);
  return [parts.join(" · ") || "All done"];
}
const progress = (p) => (p.all.length ? p.done.length / p.all.length : 0);
const bar = (p, cls) => h("div", { className: cls, role: "img", ariaLabel: `${p.done.length} of ${p.all.length} done` },
  h("span", { style: `inline-size:${Math.round(progress(p) * 100)}%` }));

// els: { pull, now, handle, sum, body, view }. onOpen(task): the task sheet.
// onAdd(project): a new task there. onNew(): a new project. onStart(id).
export function mountProjects(els, uid, { onOpen, onAdd, onNew, onStart, onScreen } = {}){
  let tasks = null, onCard = null;
  let sheetOpen = false;
  let shown = null; // the project on the project screen
  let fold = { someday: false, done: false };
  const fail = (e) => console.error("[daisey] projects", e);
  const list = () => projectsOf(tasks || [], onCard);

  // ---------- the pull-up sheet ----------
  function paintSheet(){
    const ps = list();
    const n = ps.reduce((s, p) => s + p.open.length, 0);
    els.sum.replaceChildren(...["Projects", plural(ps.length, "project"), plural(n, "task")].flatMap((t, i) => (i ? [h("span", { ariaHidden: "true", textContent: "·" }), h("span", { textContent: t })] : [h("span", { textContent: t })])));
    els.handle.ariaLabel = sheetOpen ? "Close projects" : `Pull up for projects: ${ps.length} projects, ${n} tasks`;
    els.handle.ariaExpanded = String(sheetOpen);
    els.pull.classList.toggle("open", sheetOpen);
    els.body.hidden = !sheetOpen;
    const cur = onCard && (tasks || []).find((t) => t.id === onCard);
    els.now.hidden = !sheetOpen || !cur;
    if (cur) els.now.replaceChildren(h("div", { className: "pull-nowbar" + (cur.area ? ` area-${cur.area}` : "") },
      h("span", { className: "dot", ariaHidden: "true" }),
      h("span", { className: "pull-nowtext" }, "Now: ", bdi(cur.title)),
      h("button", { type: "button", className: "btn primary small", textContent: "Start", onclick: () => { setSheet(false); onStart?.(cur.id); } })));
    if (!sheetOpen) return;
    els.body.replaceChildren(
      h("div", { className: "pull-head" }, h("h2", { textContent: "Projects" }),
        h("button", { type: "button", className: "linkish pull-new", textContent: "+ New", onclick: () => onNew?.() })),
      ps.length ? h("div", { className: "pgrid" }, ...ps.map((p) => h("button", { type: "button", className: "pcard" + (p.area ? ` area-${p.area}` : ""),
        onclick: () => { setSheet(false); openProject(p.name); } },
        h("span", { className: "pcard-top" }, h("span", { className: "pcard-name", dir: "auto", textContent: p.name }), h("span", { className: "pcard-n", textContent: String(p.open.length) })),
        h("span", { className: "pcard-status" }, ...statusLine(p)),
        bar(p, "pbar"))))
        : h("p", { className: "muted", textContent: "No projects yet. Tell Daisey what's on your plate." }));
  }
  function setSheet(open){
    sheetOpen = open;
    els.pull.style.transform = "";
    paintSheet();
    document.body.classList.toggle("sheet-open", open);
  }
  els.handle.onclick = () => { if (!dragged) setSheet(!sheetOpen); };

  // Drag: the sheet follows the finger; let go past a quarter of the way and
  // it finishes the move, otherwise it settles back. A short tap is the
  // handle's click.
  let drag = null, dragged = false;
  const sheet = els.pull.querySelector(".pull-sheet");
  sheet.addEventListener("pointerdown", (e) => {
    if (!e.target.closest(".pull-handle, .pull-head")) return;
    drag = { y: e.clientY, id: e.pointerId, from: sheetOpen, span: 0 };
    dragged = false;
  });
  sheet.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dy = e.clientY - drag.y;
    if (!dragged) {
      if (Math.abs(dy) < 8 || (drag.from ? dy < 0 : dy > 0)) return;
      dragged = true;
      try { sheet.setPointerCapture(drag.id); } catch { /* gone */ }
      const rest = sheet.getBoundingClientRect().height;
      if (!drag.from) { sheetOpen = true; paintSheet(); }
      drag.span = Math.max(1, sheet.getBoundingClientRect().height - (drag.from ? 140 : rest));
      els.pull.classList.add("dragging");
    }
    const off = drag.from ? Math.max(0, dy) : Math.max(0, drag.span + dy);
    els.pull.style.transform = `translateY(${off}px)`;
    drag.off = off;
  });
  const letGo = () => {
    if (!drag) return;
    const d = drag; drag = null;
    els.pull.classList.remove("dragging");
    if (!dragged) return;
    setTimeout(() => { dragged = false; });
    const moved = d.from ? d.off : d.span - d.off;
    setSheet(d.from ? moved < d.span / 4 : moved > d.span / 4);
  };
  sheet.addEventListener("pointerup", letGo);
  sheet.addEventListener("pointercancel", letGo);

  // ---------- the project screen ----------
  function complete(t){
    const before = { status: t.status || "ready", doneAt: t.doneAt ?? null, skipsSinceStart: t.skipsSinceStart ?? 0 };
    finishTask(uid, t).catch(fail);
    flash("Done: ", t.title, { undo: () => restoreTask(uid, t.id, before).catch(fail) });
  }

  // A task card that swipes right to finish.
  function swipeCard(t, card){
    const reveal = h("span", { className: "pj-reveal", ariaHidden: "true" }, icon("check"), h("span", { textContent: "Done" }));
    const wrap = h("div", { className: "pj-swipe" }, reveal, card);
    let s = null, moved = false;
    card.addEventListener("pointerdown", (e) => { s = { x: e.clientX, y: e.clientY, id: e.pointerId, dx: 0 }; moved = false; });
    card.addEventListener("pointermove", (e) => {
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
    const st = t.steps || [];
    const parts = [durText(t.size || 30)];
    if (st.length) parts.push(`${st.filter((x) => x.done).length} of ${st.length} steps`);
    if (notYet(t)) parts.push(`from ${shortDay(t.notBefore)}`);
    else if (t.due) parts.push(`${isOverdue(t) ? "was due" : t.dateKind === "deadline" ? "due" : "by"} ${shortDay(t.due)}`);
    return parts.join(" · ");
  }
  const taskBtn = (t, kids) => h("button", { type: "button", className: "pj-task" + (notYet(t) ? " later" : ""), dir: dirOf(t.title),
    ariaLabel: `Open ${t.title}`, onclick: () => onOpen?.(t) }, ...kids);

  const section = (dot, label, n, ...kids) => h("section", { className: "pj-sec", ariaLabel: label },
    h("h3", { className: "pj-h" }, h("span", { className: `pj-dot ${dot}`, ariaHidden: "true" }), h("span", { className: "pj-h-t", textContent: label }), h("span", { className: "pj-n", textContent: String(n) })),
    ...kids);
  const foldRow = (key, dot, label, items, row) => [
    h("button", { type: "button", className: "pj-fold", ariaExpanded: String(fold[key]), onclick: () => { fold[key] = !fold[key]; paintView(); } },
      h("span", { className: `pj-dot ${dot}`, ariaHidden: "true" }), h("span", { className: "pj-h-t", textContent: label }),
      h("span", { className: "pj-n", textContent: `${items.length} ${fold[key] ? "▾" : "▸"}` })),
    fold[key] && items.length > 0 && h("div", { className: "pj-list" }, ...items.slice(0, 50).map(row)),
  ];

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
        className: "pj-chip" + (q.area ? ` area-${q.area}` : ""), onclick: () => go(q.name) },
      h("span", { className: "dot", ariaHidden: "true" }), bdi(q.name))));
    const next = p.next.map((t) => swipeCard(t, taskBtn(t, [
      h("span", { className: "pj-row" }, h("span", { className: "pj-title", dir: "auto", textContent: t.title }),
        t.id === onCard && h("span", { className: "pj-now", textContent: "NOW" })),
      h("span", { className: "pj-meta", textContent: nextMeta(t) })])));
    const pending = p.pending.map((t) => swipeCard(t, taskBtn(t, [
      h("span", { className: "pj-row" },
        h("span", { className: "pj-col" }, h("span", { className: "pj-title", dir: "auto", textContent: t.title }),
          h("span", { className: "pj-meta" }, ...(t.waitingOn ? ["Waiting on ", bdi(t.waitingOn)] : ["Pending"]),
            t.checkOn ? (t.checkOn <= localDate() ? " · check now" : ` · ask ${shortDay(t.checkOn)}`) : "")),
        t.waitingOn && h("span", { className: "pj-who", ariaHidden: "true", textContent: [...t.waitingOn.trim()][0]?.toUpperCase() || "" }))])));
    const quietRow = (t) => h("button", { type: "button", className: "pj-quiet" + (t.status === "done" ? " done" : ""), dir: dirOf(t.title),
      onclick: () => onOpen?.(t) }, bdi(t.title));
    els.view.replaceChildren(...[
      h("div", { className: "pj-top" },
        h("button", { type: "button", className: "pj-back", ariaLabel: "Back to home", onclick: () => onScreen?.(null) }, icon("back")), chips),
      h("div", { className: "pj-card" + (p.area ? ` area-${p.area}` : "") },
        h("div", { className: "pj-card-top" }, h("h2", { className: "pj-name", dir: "auto", textContent: p.name }),
          p.area && h("span", { className: "pj-area", textContent: areaName({ area: p.area }) })),
        h("div", { className: "pj-prog" }, bar(p, "pbar big"), h("span", { textContent: `${p.done.length} of ${p.all.length} done` }))),
      section("next", "Next", p.next.length, ...next,
        h("button", { type: "button", className: "pj-add", textContent: "+ Add a task", onclick: () => onAdd?.(p.name === INBOX ? "" : p.name) })),
      p.pending.length > 0 && section("pending", "Pending", p.pending.length, ...pending),
      ...foldRow("someday", "someday", "Someday", p.someday, quietRow),
      ...foldRow("done", "done", "Done", p.done, quietRow),
      ps.length > 1 && h("p", { className: "pj-hint" }, icon("back"), "Swipe for the next project", icon("chev"))].filter(Boolean));
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
    shown = name; fold = { someday: false, done: false };
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
  let page = null;
  els.view.addEventListener("pointerdown", (e) => {
    page = e.target.closest(".pj-swipe, .pj-chips, input, textarea") ? null : { x: e.clientX, y: e.clientY };
  });
  els.view.addEventListener("pointerup", (e) => {
    if (!page) return;
    const dx = e.clientX - page.x, dy = e.clientY - page.y;
    page = null;
    if (Math.abs(dx) > SWIPE_PAGE && Math.abs(dx) > 1.5 * Math.abs(dy)) {
      const rtl = getComputedStyle(els.view).direction === "rtl";
      step((dx < 0) !== rtl ? 1 : -1);
    }
  });
  els.view.addEventListener("pointercancel", () => { page = null; });

  function openProject(name){
    shown = name; fold = { someday: false, done: false };
    els.view.hidden = false;
    els.view.scrollTop = 0;
    paintView();
    onScreen?.(name);
  }
  function closeProject(){ shown = null; els.view.hidden = true; els.view.replaceChildren(); }

  function render(){ paintSheet(); paintView(); }
  const unsub = watchTasks(uid, (ts) => { tasks = ts; render(); }, fail);
  els.pull.hidden = false;
  render();

  return {
    setCurrent(id){ onCard = id; render(); },
    openProject,
    closeProject,
    closeSheet: () => { if (sheetOpen) setSheet(false); },
    isSheetOpen: () => sheetOpen,
    shownProject: () => shown,
    unmount(){ unsub(); closeProject(); setSheet(false); els.pull.hidden = true; els.body.replaceChildren(); els.now.replaceChildren(); },
  };
}
