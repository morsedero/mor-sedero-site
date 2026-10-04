// The Schedule panel: the day as Google Calendar draws it — an hour gutter
// down the side, blocks sitting at their real time and as tall as they really
// are. One day fills the panel and the days slide sideways (swipe, or ‹ ›),
// up to a week ahead.
//
// It was a list of rows until 2026-10-05 (Mor: "copy from google calendar,
// make it better to use"). A list can only TELL you the day; a grid shows it —
// an hour of nothing looks like an hour of nothing, and two things at once sit
// side by side instead of pretending to be a sequence.
//
// The scale is one pixel a minute, which is the whole trick: a drag of N
// pixels IS N minutes, so moving and resizing need no conversion and land
// where the finger says. A block never renders shorter than MIN_BLOCK, so a
// 5-minute errand stays readable and tappable — the one place the grid lies,
// and the same lie Google tells.
//
// (The old daisey.html tried true-to-scale CARDS and had to rip it out: task
// cards there were 61–144px of buttons and accordions, so a 15-minute task
// could not be 15px. These blocks are one line of text with no controls inside
// them, which is why the same scale works here and didn't there.)
//
// What it does that Google doesn't:
//   · free gaps are the point, not the leftovers — the capacity line counts
//     them, and Daisey's pencil suggestions (pencil.js) sit IN them as dashed
//     ghosts you can accept with one tap
//   · one tap on a block opens a bar with everything you can do to it
//
// Editing an event you own:
//   · drag the block to move it (touch: hold it a moment first, so a swipe
//     still scrolls the day)
//   · drag its top or bottom edge to change when it starts or ends
//   · double-tap it to rename, or use the bar
// Drags snap to the quarter hour and show the new times as they go. Every
// change can be undone for a few seconds; a delete asks first, because Google
// has no undo for it.
//
// It reads the same fetch as the Now card's free window (calendar.js), so the
// panel and the card can never disagree. Daisey still never schedules anything
// ITSELF; what it writes is what the user typed or dragged.
import { watchCalendar, retime, deleteEvent, renameEvent, acceptBlock } from "./calendar.js";
import { watchTasks, watchMoment, watchLearn, watchPencil, savePencil } from "./store.js";
import { sketch, capacity, blockStart } from "./pencil.js";
import { workBase } from "./context.js";
import { ROOM_HOURS } from "./weights.js";
import { localDate } from "./model.js";
import { h, bdi, dur } from "./ui.js";

const DAYS_AHEAD = 7; // as far as the days slide, and as far as the fetch reaches
const MIN = 60000;
const PPM = 1; // pixels per minute: the grid's scale, and a drag's conversion rate
const SNAP = 15; // minutes a drag snaps to
const MIN_BLOCK = 18; // px: a 5-minute event still has to be readable and tappable
const SHORT_BLOCK = 34; // px: under this a block shows its name only, on one line
const EDGE_FROM = 44; // px: a shorter block has no edge handles, only the bar
const HOLD_MS = 320; // how long a finger rests on a block before it picks it up
const LEAD_MIN = 30, TRAIL_MIN = 60; // air kept above and below "now" in the window

const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const hourLabel = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:00`;
const NOTE = {
  loading: "Checking the calendar…",
  not_connected: "Calendar not connected. Sign in to the old Daisey once to link it.",
  needs_reauth: "Calendar sign-in expired. Sign in to the old Daisey again.",
  error: "Couldn't reach the calendar.",
};

// "Today", "Tomorrow", then the weekday and date.
const dayLabel = (offset, ms) => (offset === 0 ? "Today" : offset === 1 ? "Tomorrow"
  : new Date(ms).toLocaleDateString([], { weekday: "long", day: "numeric", month: "short" }));

const dayStart = (now, offset) => { const d = new Date(now); d.setDate(d.getDate() + offset); d.setHours(0, 0, 0, 0); return d.getTime(); };
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const snapTo = (m) => Math.round(m / SNAP) * SNAP;

// Where an event sits on a given day, in minutes from that day's midnight.
// Anything running past midnight is cut at the day's end.
function place(ev, dayMs){
  const s = clamp(Math.round((Date.parse(ev.start) - dayMs) / MIN), 0, 1440);
  const e = clamp(Math.round((Date.parse(ev.end || ev.start) - dayMs) / MIN), s + 5, 1440);
  return { s, e };
}

// Side by side, the way a calendar has to: everything that overlaps shares the
// width. Each run of overlapping blocks is laid out on its own, so one busy
// hour doesn't narrow the whole day.
function lanes(items){
  const sorted = [...items].sort((a, b) => a.s - b.s || b.e - a.e);
  let run = [], runEnd = -1;
  const settle = () => {
    const cols = [];
    for (const it of run) {
      let c = cols.findIndex((col) => col[col.length - 1].e <= it.s);
      if (c < 0) { cols.push([it]); c = cols.length - 1; } else cols[c].push(it);
      it.col = c;
    }
    for (const it of run) it.cols = cols.length;
    run = [];
  };
  for (const it of sorted) {
    if (run.length && it.s >= runEnd) settle();
    run.push(it);
    runEnd = Math.max(runEnd, it.e);
  }
  if (run.length) settle();
  return sorted;
}

// Two taps on the same block within this long is a double-tap (rename). Read
// from click, not dblclick, because touch screens don't reliably fire dblclick.
const DOUBLE_TAP_MS = 400;
let lastTap = { id: null, t: 0 };
function tapTwice(id){
  const now = Date.now();
  const again = lastTap.id === id && now - lastTap.t < DOUBLE_TAP_MS;
  lastTap = again ? { id: null, t: 0 } : { id, t: now };
  return again;
}

// The pencil (DAISEY_SPEC "Pencil schedule", Mor's step 6): on today, each free
// gap of 20+ minutes shows one faded suggestion from the engine run for that
// gap (pencil.js). Tap it: "Put it in" writes a block to the "Daisey"
// calendar; "Not today" drops the task from today's pencil. Nothing is written
// without a tap, and ignoring it costs nothing. On top of today: "2 h free
// today, 8 open. Realistic: 3." with "Move the rest", which opens the sweep on
// the ones that don't fit.
// uid: the signed-in user. onSweep(ids) opens the sweep on those tasks.
export function mountSchedule(root, { onAdd, uid, onSweep } = {}){
  let cal = { status: "loading", events: [] };
  let tasks = null, momentDoc = {}, learnStats = {}, pencilDoc = {};
  let currentId = null; // the task on the Now card: the current gap's pencil
  let openPencil = null; // the suggestion whose bar is showing (its gap key)
  let offset = 0; // days from today
  let strip = null; // the sliding row of days
  let heading, back, prev, next;
  let openId = null; // the event whose bar is showing
  let confirming = false; // the open event is waiting for "Delete?" to be confirmed
  let renaming = false, renameText = null; // the open event's name is being edited
  let drag = null; // a block being dragged
  let busy = false; // a write is in flight
  let problem = ""; // what went wrong with the last write
  let undo = null; // { label, revert } for a few seconds after a change
  let undoTimer = null;
  const scrollOf = new Map(); // how far each day is scrolled, kept across redraws

  const WRITE_ERROR = {
    read_only: "That calendar is read-only.",
    gone: "That event is already gone.",
    needs_reauth: "Calendar sign-in expired. Sign in to the old Daisey again.",
    no_session: "Signed out.",
  };

  async function run(fn){
    if (busy) return;
    busy = true; problem = ""; render();
    try { await fn(); }
    catch (e) {
      console.error("[daisey] calendar write", e);
      problem = WRITE_ERROR[e.code] || "Couldn't change that event.";
    }
    busy = false;
    render();
  }

  // `revert` is what Undo runs: it needs only the ids it closed over, so it
  // still works after the calendar has refetched.
  function offerUndo(label, revert){
    clearTimeout(undoTimer);
    undo = { label, revert };
    undoTimer = setTimeout(() => { undo = null; render(); }, 6000);
  }

  // The one way a block's times change: write them, then offer to put them back.
  function commitTimes(e, start, end){
    if (busy) return render(); // another write is in flight: show the real times again
    const before = { start: Date.parse(e.start), end: Date.parse(e.end) };
    run(async () => {
      await retime(e, start, end);
      offerUndo(`Changed to ${clock(start)}–${clock(end)}`, () => retime(e, before.start, before.end));
    });
  }

  const openEvent = () => cal.events.find((ev) => ev.id === openId) || null;
  const canEdit = (e) => e.editable && !e.allDay && e.end;

  // ---------- dragging a block ----------

  // Where the block would be if the drag ended now, in minutes from midnight.
  function spanOf(d){
    if (d.mode === "move") {
      const len = d.from.e - d.from.s;
      const s = clamp(snapTo(d.from.s + d.dy), 0, 1440 - len);
      return { s, e: s + len };
    }
    if (d.mode === "start") return { s: clamp(snapTo(d.from.s + d.dy), 0, d.from.e - SNAP), e: d.from.e };
    return { s: d.from.s, e: clamp(snapTo(d.from.e + d.dy), d.from.s + SNAP, 1440) };
  }

  function paintDrag(){
    const { s, e } = spanOf(drag);
    drag.el.style.insetBlockStart = `${(s - drag.winS) * PPM}px`;
    drag.el.style.blockSize = `${Math.max(MIN_BLOCK, (e - s) * PPM)}px`;
    if (drag.label) drag.label.textContent = `${clock(drag.dayMs + s * MIN)}–${clock(drag.dayMs + e * MIN)}`;
  }

  // `grab` is the element the pointer went down on, and it must be the one
  // that captures: a captured pointer's moves are delivered to that element
  // and then bubble UP. Capturing on the block while dragging one of its own
  // edges sent every move to the block, where nothing was listening for it —
  // the edge's handler is a child and never sees an event that started above
  // it, so resizing silently did nothing.
  function startDrag(ev, ctx, mode, grab){
    if (busy || drag) return;
    drag = { ...ctx, mode, y: ev.clientY, dy: 0, label: ctx.el.querySelector(".sch-bt"), moved: false };
    ctx.el.classList.add("dragging");
    try { grab.setPointerCapture(ev.pointerId); } catch { /* the press already ended */ }
  }

  function moveDrag(ev){
    if (!drag) return;
    const dy = Math.round((ev.clientY - drag.y) / PPM);
    if (dy === drag.dy) return;
    drag.dy = dy;
    if (Math.abs(dy) > 2) drag.moved = true;
    paintDrag();
  }

  // Returns whether the block really moved, so the click that follows a drag
  // can be told from a tap.
  //
  // It must NOT repaint when nothing was dragged. With a mouse the drag arms
  // on pointerdown, so every plain click comes through here first — and a
  // render() rebuilds the DOM, detaching the very button the click was headed
  // for, which silently swallowed every tap on the grid.
  function endDrag(cancel){
    const d = drag;
    if (!d) return false;
    drag = null;
    d.el.classList.remove("dragging", "held");
    const { s, e } = spanOf(d);
    if (cancel || (s === d.from.s && e === d.from.e)) {
      if (d.dy !== 0) render(); // it was dragged somewhere and has to snap back
      return d.moved;
    }
    commitTimes(d.ev, d.dayMs + s * MIN, d.dayMs + e * MIN);
    return true;
  }

  // A block's own body moves it. On touch it has to be HELD first, or the day
  // could never be scrolled past it — and the finger's scroll has to be let
  // through until the hold lands, which Chrome only allows through a
  // non-passive touchmove (it latches touch-action at touchstart and ignores
  // later changes). The edge handles are small, deliberate targets, so they
  // take a drag straight away through touch-action:none in the CSS.
  function wireBody(el, ctx){
    let hold = null, armed = false, downY = 0, downEv = null;
    const disarm = () => { clearTimeout(hold); hold = null; armed = false; };
    el.addEventListener("touchmove", (ev) => { if (armed) ev.preventDefault(); }, { passive: false });
    el.addEventListener("pointerdown", (ev) => {
      if (ev.button > 0 || busy) return;
      downY = ev.clientY; downEv = ev;
      if (ev.pointerType !== "touch") { armed = true; startDrag(ev, ctx, "move", el); return; }
      hold = setTimeout(() => { armed = true; el.classList.add("held"); startDrag(downEv, ctx, "move", el); }, HOLD_MS);
    });
    el.addEventListener("pointermove", (ev) => {
      if (!armed) { if (hold && Math.abs(ev.clientY - downY) > 8) disarm(); return; } // a swipe, not a hold
      moveDrag(ev);
    });
    el.addEventListener("pointerup", () => { disarm(); if (endDrag(false)) el.dataset.dragged = "1"; });
    el.addEventListener("pointercancel", () => { disarm(); endDrag(true); });
  }

  const wireEdge = (el, ctx, mode) => {
    el.addEventListener("pointerdown", (ev) => { ev.preventDefault(); ev.stopPropagation(); startDrag(ev, ctx, mode, el); });
    el.addEventListener("pointermove", moveDrag);
    el.addEventListener("pointerup", (ev) => { ev.stopPropagation(); endDrag(false); });
    el.addEventListener("pointercancel", () => endDrag(true));
  };

  // ---------- the bar: everything you can do to the open block ----------

  function renameRow(e){
    const input = h("input", { id: "schRename", className: "sch-rename", dir: "auto", autocomplete: "off",
      value: renameText ?? e.title, ariaLabel: "New name", oninput: (ev) => { renameText = ev.target.value; } });
    const stop = () => { renaming = false; renameText = null; render(); };
    const save = () => {
      const title = input.value.trim();
      if (!title || title === e.title) return stop();
      run(async () => { await renameEvent(e, title); renaming = false; renameText = null; });
    };
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") { ev.preventDefault(); save(); }
      if (ev.key === "Escape") stop();
    });
    setTimeout(() => { input.focus(); input.select(); });
    return [input,
      h("button", { className: "chip", type: "button", textContent: "Save", disabled: busy, onclick: save }),
      h("button", { className: "chip", type: "button", textContent: "Cancel", onclick: stop })];
  }

  function eventBar(e){
    const close = h("button", { className: "sch-x", type: "button", ariaLabel: "Close", textContent: "✕",
      onclick: () => { openId = null; renaming = false; confirming = false; render(); } });
    const head = h("p", { className: "sch-bar-h" },
      h("span", { className: "sch-bar-t", textContent: `${clock(Date.parse(e.start))}–${clock(Date.parse(e.end))}` }), bdi(e.title));
    if (renaming) return h("div", { className: "sch-bar" }, h("div", { className: "sch-bar-row" }, ...renameRow(e)), close);
    if (confirming) {
      return h("div", { className: "sch-bar" }, head,
        h("div", { className: "sch-bar-row" },
          h("span", { className: "muted", textContent: "Delete it?" }),
          h("button", { className: "chip danger", type: "button", textContent: "Delete", disabled: busy,
            onclick: () => run(async () => { await deleteEvent(e); confirming = false; openId = null; }) }),
          h("button", { className: "chip", type: "button", textContent: "Keep", onclick: () => { confirming = false; render(); } })), close);
    }
    // From/to is the only typed way to change the times: it moves AND resizes,
    // so a separate "move to" control would be the same thing twice.
    const from = h("input", { type: "time", className: "sch-at", value: clock(Date.parse(e.start)), ariaLabel: "Start" });
    const to = h("input", { type: "time", className: "sch-at", value: clock(Date.parse(e.end)), ariaLabel: "End" });
    const setTimes = () => {
      if (!from.value || !to.value) return;
      const at = (iso, hhmm) => { const d = new Date(Date.parse(iso)); const [hh, mm] = hhmm.split(":").map(Number); d.setHours(hh, mm, 0, 0); return d.getTime(); };
      const s = at(e.start, from.value), en = at(e.end, to.value);
      if (en <= s) { problem = "The end has to be after the start."; return render(); }
      commitTimes(e, s, en);
    };
    return h("div", { className: "sch-bar" }, head,
      h("div", { className: "sch-bar-row" },
        h("span", { className: "muted", textContent: "From" }), from,
        h("span", { className: "muted", textContent: "to" }), to,
        h("button", { className: "chip", type: "button", textContent: "Set", disabled: busy, onclick: setTimes })),
      h("div", { className: "sch-bar-row" },
        h("button", { className: "chip", type: "button", textContent: "Rename", disabled: busy,
          onclick: () => { renaming = true; renameText = null; render(); } }),
        h("button", { className: "chip danger", type: "button", textContent: "Delete", disabled: busy,
          onclick: () => { confirming = true; render(); } })),
      close);
  }

  function pencilBar(p){
    const start = blockStart(p), end = start + p.minutes * MIN;
    return h("div", { className: "sch-bar" },
      h("p", { className: "sch-bar-h" },
        h("span", { className: "sch-bar-t", textContent: `${clock(start)}–${clock(end)}` }), bdi(pencilTitle(p))),
      h("div", { className: "sch-bar-row" },
        h("button", { className: "chip go", type: "button", textContent: "Put it in", disabled: busy,
          ariaLabel: `Put ${p.task.title} on your Daisey calendar, ${clock(start)}–${clock(end)}`,
          onclick: () => run(async () => { await acceptBlock({ task: p.task, start, end, title: pencilTitle(p) }); openPencil = null; }) }),
        h("button", { className: "chip", type: "button", textContent: "Not today", disabled: busy, onclick: () => answer(p, "dismiss") })),
      h("button", { className: "sch-x", type: "button", ariaLabel: "Close", textContent: "✕",
        onclick: () => { openPencil = null; render(); } }));
  }

  // ---------- pencil ----------

  const todayPencil = (now) => (pencilDoc.date === localDate(now) ? pencilDoc : { date: localDate(now), dismissed: [], swaps: {} });

  function pencils(now){
    if (!tasks) return [];
    const today = localDate(now);
    // Tasks already in an accepted block today aren't penciled again.
    const booked = cal.events.filter((e) => e.taskId && localDate(Date.parse(e.start)) === today).map((e) => e.taskId);
    const pd = todayPencil(now);
    return sketch(tasks, cal.events, { now, exclude: [...(pd.dismissed || []), ...booked], swaps: pd.swaps || {}, currentId,
      base: { ...workBase(tasks, now), learnStats }, moment: momentDoc });
  }

  function answer(p, kind){
    const pd = { ...todayPencil(Date.now()) };
    if (kind === "dismiss") pd.dismissed = [...(pd.dismissed || []), p.task.id];
    else pd.swaps = { ...(pd.swaps || {}), [p.key]: [...((pd.swaps || {})[p.key] || []), p.task.id] };
    pencilDoc = pd;
    openPencil = null;
    render();
    savePencil(uid, pd).catch((e) => console.error("[daisey] pencil", e));
  }

  const pencilTitle = (p) => p.task.title + (p.part ? " (part)" : "");

  // ---------- the grid ----------

  function blockEl(it, winS, dayMs){
    const e = it.ev;
    const height = Math.max(MIN_BLOCK, (it.e - it.s) * PPM);
    const edit = canEdit(e);
    const time = `${clock(dayMs + it.s * MIN)}–${clock(dayMs + it.e * MIN)}`;
    const el = h("button", {
      type: "button",
      className: "sch-block" + (it.past ? " past" : "") + (it.running ? " running" : "")
        + (height < SHORT_BLOCK ? " short" : "") + (height < EDGE_FROM ? " tiny" : "")
        + (openId === e.id ? " open" : "") + (edit ? " editable" : ""),
      style: `inset-block-start:${(it.s - winS) * PPM}px; block-size:${height}px;`
        + `inset-inline-start:${(it.col / it.cols) * 100}%; inline-size:${100 / it.cols}%;`
        + (e.color ? `--ev:${e.color};` : ""),
      ariaLabel: `${e.title}, ${time}${edit ? " — open to move, resize, rename or delete" : ""}`,
    },
    h("span", { className: "sch-bt", textContent: time }),
    h("span", { className: "sch-bn" }, bdi(e.title)),
    it.running && h("span", { className: "sch-nowtag", textContent: "now" }));
    el.onclick = (ev) => {
      if (el.dataset.dragged) { el.dataset.dragged = ""; return; } // that tap was a drag
      if (!edit) return;
      ev.stopPropagation();
      if (tapTwice(e.id)) { openId = e.id; renaming = true; renameText = null; confirming = false; return render(); }
      openId = openId === e.id ? null : e.id;
      openPencil = null; renaming = false; confirming = false;
      render();
    };
    if (!edit) return el;
    const ctx = { ev: e, el, from: { s: it.s, e: it.e }, winS, dayMs };
    wireBody(el, ctx);
    if (height >= EDGE_FROM) {
      const top = h("span", { className: "sch-edge top", ariaHidden: "true", title: "Drag to change the start" });
      const bottom = h("span", { className: "sch-edge bottom", ariaHidden: "true", title: "Drag to change the end" });
      wireEdge(top, ctx, "start");
      wireEdge(bottom, ctx, "end");
      el.append(top, bottom);
    }
    return el;
  }

  function pencilEl(p, winS, dayMs){
    const start = blockStart(p), end = start + p.minutes * MIN;
    const s = Math.round((start - dayMs) / MIN), e = Math.round((end - dayMs) / MIN);
    const height = Math.max(MIN_BLOCK, (e - s) * PPM);
    return h("button", {
      type: "button",
      className: "sch-block pencil" + (height < SHORT_BLOCK ? " short" : "") + (openPencil === p.key ? " open" : ""),
      style: `inset-block-start:${(s - winS) * PPM}px; block-size:${height}px; inset-inline-start:0; inline-size:100%;`,
      ariaLabel: `Suggestion for ${clock(start)}–${clock(end)}: ${pencilTitle(p)}. Put it in, or not today`,
      onclick: () => { openPencil = openPencil === p.key ? null : p.key; openId = null; render(); },
    },
    h("span", { className: "sch-bt", textContent: `${clock(start)}–${clock(end)}` }),
    h("span", { className: "sch-bn" }, bdi(pencilTitle(p)), "?"));
  }

  function dayPanel(now, n){
    const dayMs = dayStart(now, n);
    const date = localDate(dayMs);
    const today = n === 0;
    const nowMin = Math.round((now - dayMs) / MIN);
    const mine = cal.events.filter((e) => localDate(Date.parse(e.start)) === date);
    const allDay = mine.filter((e) => e.allDay);
    const items = lanes(mine.filter((e) => !e.allDay).map((e) => {
      const { s, e: e2 } = place(e, dayMs);
      return { ev: e, s, e: e2,
        past: today && dayMs + e2 * MIN <= now,
        running: today && dayMs + s * MIN <= now && dayMs + e2 * MIN > now };
    }));
    const pens = today ? pencils(now) : [];

    // The window: the working day, stretched to hold whatever falls outside it,
    // and to keep a little air around "now".
    let winS = ROOM_HOURS.start * 60, winE = ROOM_HOURS.end * 60;
    for (const it of items) { winS = Math.min(winS, it.s); winE = Math.max(winE, it.e); }
    if (today) { winS = Math.min(winS, nowMin - LEAD_MIN); winE = Math.max(winE, nowMin + TRAIL_MIN); }
    winS = clamp(Math.floor(winS / 60) * 60, 0, 1320);
    winE = clamp(Math.ceil(winE / 60) * 60, winS + 120, 1440);

    const hours = [];
    for (let m = winS; m <= winE; m += 60) {
      hours.push(h("div", { className: "sch-hour", style: `inset-block-start:${(m - winS) * PPM}px` },
        h("span", { className: "sch-hl", textContent: hourLabel(m) })));
    }
    // Tapping empty grid starts an event there, the way Google does — the
    // quarter hour you tapped, not "now" and not the top of the day.
    let lanesEl;
    lanesEl = h("div", { className: "sch-lanes",
      onclick: (ev) => {
        if (ev.target !== lanesEl) return; // a block handled it
        const y = ev.clientY - lanesEl.getBoundingClientRect().top;
        const m = clamp(snapTo(winS + Math.round(y / PPM)), 0, 1425);
        onAdd?.(date, `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
      } },
      ...pens.map((p) => pencilEl(p, winS, dayMs)),
      ...items.map((it) => blockEl(it, winS, dayMs)));
    const grid = h("div", { className: "sch-grid", style: `block-size:${(winE - winS) * PPM}px` }, ...hours, lanesEl,
      today && nowMin >= winS && nowMin <= winE
        && h("div", { className: "sch-nowline", style: `inset-block-start:${(nowMin - winS) * PPM}px` },
          h("span", { className: "sch-nowt", textContent: clock(now) })));

    const panel = h("section", { className: "sch-day", ariaLabel: dayLabel(n, dayMs) },
      today && capLine(now),
      allDay.length > 0 && h("div", { className: "sch-allday" },
        ...allDay.map((e) => h("span", { className: "sch-chip", style: e.color ? `--ev:${e.color}` : "" }, bdi(e.title)))),
      mine.length === 0 && pens.length === 0 && h("p", { className: "muted sch-free", textContent: "Nothing on the calendar." }),
      grid);
    // Where this day was scrolled to, kept across redraws; today opens on now.
    panel.onscroll = () => scrollOf.set(n, panel.scrollTop);
    const want = scrollOf.get(n) ?? (today ? Math.max(0, (nowMin - winS) * PPM - 120) : 0);
    queueMicrotask(() => { panel.scrollTop = want; });
    return panel;
  }

  function capLine(now){
    if (!tasks) return null;
    const c = capacity(tasks, cal.events, now);
    if (!c.free && !c.open) return null;
    return h("p", { className: "sch-cap" },
      c.open ? `${dur(c.free)} free today, ${c.open} open. Realistic: ${c.realistic}. ` : `${dur(c.free)} free today.`,
      c.rest.length > 0 && h("button", { className: "linkish", type: "button", textContent: "Move the rest",
        onclick: () => onSweep?.(c.rest.map((t) => t.id)) }));
  }

  // The header follows whichever day the strip is resting on.
  function head(){
    const now = Date.now();
    heading.textContent = dayLabel(offset, dayStart(now, offset));
    prev.disabled = offset === 0;
    next.disabled = offset === DAYS_AHEAD;
    back.hidden = offset === 0;
  }

  function setOffset(n, smooth = true){
    offset = Math.min(DAYS_AHEAD, Math.max(0, n));
    if (strip) strip.scrollTo({ left: offset * strip.clientWidth, behavior: smooth ? "smooth" : "auto" });
    head();
  }

  const step = (by, label) => h("button", {
    className: "sch-step", type: "button", textContent: by < 0 ? "‹" : "›", ariaLabel: label,
    onclick: () => setOffset(offset + by),
  });

  function render(){
    // Mid-drag the block under the finger is the picture; a calendar refetch
    // must not rebuild it. endDrag and run() repaint when it's done.
    if (drag) return;
    const now = Date.now();
    heading = h("h2", { className: "sch-head" });
    prev = step(-1, "The day before");
    next = step(1, "The day after");
    back = h("button", { className: "btn quiet sch-today", type: "button", textContent: "Back to today",
      hidden: true, onclick: () => setOffset(0) });

    // New events land on the day you're looking at, not on today.
    const add = h("button", { className: "sch-add", type: "button", textContent: "+", ariaLabel: "New event",
      title: "New event", hidden: cal.status !== "ok", onclick: () => onAdd?.(localDate(dayStart(Date.now(), offset))) });
    const kids = [h("header", { className: "sch-nav" }, prev, heading, next, add)];
    if (NOTE[cal.status]) {
      kids.push(h("p", { className: "muted sch-note" }, NOTE[cal.status],
        ["not_connected", "needs_reauth"].includes(cal.status)
          ? h("a", { href: "/daisey/", textContent: " Open old Daisey" }) : null));
    }
    if (cal.status === "ok") {
      strip = h("div", { className: "sch-strip" }, ...Array.from({ length: DAYS_AHEAD + 1 }, (_, n) => dayPanel(now, n)));
      // Swiping is the main way through the week; the arrows only scroll it.
      strip.onscroll = () => {
        const n = Math.round(strip.scrollLeft / strip.clientWidth);
        if (n !== offset) { offset = n; head(); }
      };
      kids.push(strip, back);
      if (problem) kids.push(h("p", { className: "sch-problem", role: "alert", textContent: problem }));
      if (undo) {
        kids.push(h("p", { className: "muted sch-undo" },
          `${undo.label}. `,
          h("button", { className: "linkish", type: "button", textContent: "Undo", onclick: () => {
            const { revert } = undo;
            undo = null; clearTimeout(undoTimer);
            run(revert);
          } })));
      }
      const open = openEvent();
      if (open) kids.push(eventBar(open));
      else if (openPencil) {
        const p = pencils(now).find((x) => x.key === openPencil);
        if (p) kids.push(pencilBar(p)); else openPencil = null;
      }
    } else strip = null;

    root.replaceChildren(...kids);
    head();
    if (strip) strip.scrollLeft = offset * strip.clientWidth; // hold the day across re-renders
  }

  const fail = (e) => console.error("[daisey] schedule", e);
  const unsubs = [
    watchCalendar((c) => { cal = c; render(); }),
    ...(uid ? [
      watchTasks(uid, (ts) => { tasks = ts; render(); }, fail),
      watchMoment(uid, (d) => { momentDoc = d || {}; render(); }, fail),
      watchLearn(uid, (d) => { learnStats = d || {}; render(); }, fail),
      watchPencil(uid, (d) => { pencilDoc = d || {}; render(); }, fail),
    ] : []),
  ];
  // Keep "now", the greying of finished events and the gaps honest.
  const tick = setInterval(() => { if (!document.hidden && cal.status === "ok") render(); }, 60000);
  const onVisible = () => { if (!document.hidden) render(); };
  document.addEventListener("visibilitychange", onVisible);
  root.hidden = false;
  render();

  return {
    // The Now card's task: the pencil for the gap you're in.
    setCurrent(id){ if (id !== currentId) { currentId = id; render(); } },
    unmount(){ unsubs.forEach((u) => u()); clearInterval(tick); clearTimeout(undoTimer); document.removeEventListener("visibilitychange", onVisible); root.replaceChildren(); root.hidden = true; },
  };
}
