// The Schedule panel: what Google Calendar says a day holds. One day fills
// the panel and the days slide sideways — swipe, or use ‹ › — up to a week
// ahead. Read-only; Daisey never writes to the calendar in v1.
//
// It reads the same fetch as the Now card's free window (calendar.js), so
// the panel and the card can never disagree. Events already finished stay,
// in grey, because a day you can't see the start of is hard to place
// yourself in, and a red line marks where "now" falls, as Google's does.
//
// Tapping an event you own opens two of the three writes Daisey makes: move
// it, or delete it. A move can be undone for a few seconds; a delete asks
// first, because Google has no undo for it.
//
// The third is "+ New event" in the header, which opens addevent.js on the
// day being shown (Mor, 2026-10-04 — no jumping to Google Calendar to put a
// meeting in). Daisey still never schedules anything ITSELF; what it writes
// is what the user typed.
import { watchCalendar, moveEvent, moveEventTo, deleteEvent, renameEvent, acceptBlock } from "./calendar.js";
import { watchTasks, watchMoment, watchLearn, watchPencil, savePencil } from "./store.js";
import { sketch, capacity, blockStart } from "./pencil.js";
import { workBase } from "./context.js";
import { ROOM_HOURS } from "./weights.js";
import { localDate } from "./model.js";
import { h, bdi, dur } from "./ui.js";

const DAYS_AHEAD = 7; // as far as the days slide, and as far as the fetch reaches
const clock = (iso) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const NOTE = {
  loading: "Checking the calendar…",
  not_connected: "Calendar not connected. Sign in to the old Daisey once to link it.",
  needs_reauth: "Calendar sign-in expired. Sign in to the old Daisey again.",
  error: "Couldn't reach the calendar.",
};

// "Today", "Tomorrow", then the weekday and date.
const dayLabel = (offset, ms) => (offset === 0 ? "Today" : offset === 1 ? "Tomorrow"
  : new Date(ms).toLocaleDateString([], { weekday: "long", day: "numeric", month: "short" }));

const dayStart = (now, offset) => { const d = new Date(now); d.setDate(d.getDate() + offset); return d.getTime(); };

// Each event, the gap before it, and — on today — the line marking now.
// `from` is where the day's clock starts: now, for today; null otherwise,
// since "7 h 59 min free" before a 10:00 rehearsal is noise, not information.
// `until` (today only): the end of the waking day, so the stretch after
// the last event is a gap too — that's where the pencil goes. An event
// marked Free is listed but takes no time.
function dayRows(events, now, from, until = null){
  const rows = [];
  let cursor = from;
  let marked = from == null; // the now line belongs to today alone
  const gapRow = (a, b) => { const gap = Math.round((b - a) / 60000); if (gap >= 15) rows.push({ gap, minutes: gap, start: a, end: b }); };
  for (const e of events) {
    const start = Date.parse(e.start), end = Date.parse(e.end || e.start);
    const blocks = !e.allDay && e.busy !== false;
    // The line comes before the gap it starts, not after it.
    if (!marked && !e.allDay && start > now) { rows.push({ nowLine: true }); marked = true; }
    if (blocks && cursor != null && start > cursor) gapRow(cursor, start);
    const running = !e.allDay && start <= now && end > now;
    rows.push({ event: e, past: !e.allDay && end <= now, running });
    if (running) marked = true; // the line would fall inside this event; its own highlight says so
    if (blocks) cursor = Math.max(cursor ?? start, end);
  }
  if (until != null && cursor != null && until > cursor) {
    if (!marked) { rows.push({ nowLine: true }); marked = true; }
    gapRow(cursor, until);
  }
  if (!marked && rows.length) rows.push({ nowLine: true }); // everything today is already over
  return rows;
}

// The pencil (DAISEY_SPEC "Pencil schedule", Mor's step 6): on today, each
// free gap of 20+ minutes shows one faded suggestion from the engine run for
// that gap (pencil.js). Tap it: Accept writes a block to the "Daisey"
// calendar; Swap shows the next pick for that gap; Dismiss drops the task
// from today's pencil. Nothing is written without a tap, and ignoring it
// costs nothing. It redraws whenever tasks, the calendar or the energy and
// place chips change. On top of today: "2 h free today, 8 open. Realistic:
// 3." with "Move the rest", which opens the sweep on the ones that don't fit.
// uid: the signed-in user. onSweep(ids) opens the sweep on those tasks.
export function mountSchedule(root, { onAdd, uid, onSweep } = {}){
  let cal = { status: "loading", events: [] };
  let tasks = null, momentDoc = {}, learnStats = {}, pencilDoc = {};
  let currentId = null; // the task on the Now card: the current gap's pencil
  let openPencil = null; // the pencil whose actions are showing (its gap key)
  let offset = 0; // days from today
  let strip = null; // the sliding row of days
  let heading, back, prev, next;
  let openId = null; // the event whose actions are showing
  let confirming = null; // the event id waiting for "Delete?" to be confirmed
  let renaming = null, renameText = null; // the event id being renamed, and what's typed so far
  let busy = false; // a write is in flight
  let problem = ""; // what went wrong with the last write
  let undo = null; // { id, minutes } for a few seconds after a move
  let undoTimer = null;

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

  function offerUndo(id, minutes){
    clearTimeout(undoTimer);
    undo = { id, minutes };
    undoTimer = setTimeout(() => { undo = null; render(); }, 6000);
  }

  // The event as it is now — after a write the list is refetched, so the
  // object the button closed over is stale.
  const fresh = (id) => cal.events.find((e) => e.id === id) || null;

  const moveBy = (e, minutes) => run(async () => {
    await moveEvent(e, minutes);
    openId = null;
    offerUndo(e.id, minutes);
  });

  function actions(e){
    // Rename (Mor, 2026-10-04): one line with the title, Save or Cancel. What's
    // typed lives in renameText, so the minute's calendar refetch can redraw
    // without wiping it.
    if (renaming === e.id) {
      const input = h("input", { id: "schRename", className: "sch-rename", dir: "auto", autocomplete: "off",
        value: renameText ?? e.title, ariaLabel: "New name", oninput: (ev) => { renameText = ev.target.value; } });
      const save = () => {
        const title = input.value.trim();
        if (!title || title === e.title) { renaming = null; renameText = null; render(); return; }
        run(async () => { await renameEvent(e, title); renaming = null; renameText = null; openId = null; });
      };
      input.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") { ev.preventDefault(); save(); }
        if (ev.key === "Escape") { renaming = null; renameText = null; render(); }
      });
      setTimeout(() => input.focus());
      return h("li", { className: "sch-actions" }, input,
        h("button", { className: "chip", type: "button", textContent: "Save", disabled: busy, onclick: save }),
        h("button", { className: "chip", type: "button", textContent: "Cancel", onclick: () => { renaming = null; renameText = null; render(); } }));
    }
    if (confirming === e.id) {
      return h("li", { className: "sch-actions" },
        h("span", { className: "muted", textContent: "Delete it?" }),
        h("button", { className: "chip danger", type: "button", textContent: "Delete", disabled: busy,
          onclick: () => run(async () => { await deleteEvent(e); confirming = null; openId = null; }) }),
        h("button", { className: "chip", type: "button", textContent: "Keep", onclick: () => { confirming = null; render(); } }));
    }
    const at = h("input", { type: "time", className: "sch-at", value: clock(e.start), ariaLabel: "Move to" });
    return h("li", { className: "sch-actions" },
      h("button", { className: "chip", type: "button", textContent: "−15m", disabled: busy, onclick: () => moveBy(e, -15) }),
      h("button", { className: "chip", type: "button", textContent: "+15m", disabled: busy, onclick: () => moveBy(e, 15) }),
      h("button", { className: "chip", type: "button", textContent: "+1 h", disabled: busy, onclick: () => moveBy(e, 60) }),
      at,
      h("button", { className: "chip", type: "button", textContent: "Move", disabled: busy,
        onclick: () => at.value && run(async () => { await moveEventTo(e, at.value); openId = null; }) }),
      h("button", { className: "chip", type: "button", textContent: "Rename", disabled: busy,
        onclick: () => { renaming = e.id; renameText = null; render(); } }),
      h("button", { className: "chip danger", type: "button", textContent: "Delete", disabled: busy,
        onclick: () => { confirming = e.id; render(); } }));
  }

  function eventRow(r){
    const e = r.event;
    const time = e.allDay ? "all day" : e.end ? `${clock(e.start)}–${clock(e.end)}` : clock(e.start);
    const canEdit = e.editable && !e.allDay && e.end;
    const inside = [
      // The colour is the one the user sees in Google Calendar.
      h("span", { className: "sch-dot", style: e.color ? `background:${e.color}` : "" }),
      h("span", { className: "sch-time", textContent: time }),
      h("span", { className: "sch-title" }, bdi(e.title),
        r.running && h("span", { className: "sch-now", textContent: "now" })),
    ];
    const cls = "sch-row" + (r.past ? " past" : "") + (r.running ? " running" : "") + (openId === e.id ? " open" : "");
    if (!canEdit) return h("li", { className: cls }, ...inside);
    return h("li", { className: cls },
      h("button", { className: "sch-open", type: "button", ariaExpanded: String(openId === e.id),
        ariaLabel: `${e.title}, ${time} — move or delete`,
        onclick: () => { openId = openId === e.id ? null : e.id; confirming = null; renaming = null; render(); } }, ...inside));
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

  const span = (p) => { const start = blockStart(p); return { start, end: start + p.minutes * 60000 }; };
  const pencilTitle = (p) => p.task.title + (p.part ? " (part)" : "");

  function pencilRow(p){
    const { start, end } = span(p);
    const time = `${clock(start)}–${clock(end)}`;
    return h("li", { className: "sch-row sch-pencil" + (openPencil === p.key ? " open" : "") },
      h("button", { className: "sch-open", type: "button", ariaExpanded: String(openPencil === p.key),
        ariaLabel: `Suggestion for ${time}: ${pencilTitle(p)}. Accept, swap or dismiss`,
        onclick: () => { openPencil = openPencil === p.key ? null : p.key; openId = null; render(); } },
      h("span", { className: "sch-dot pencil" }),
      h("span", { className: "sch-time", textContent: time }),
      h("span", { className: "sch-title" }, bdi(pencilTitle(p)), "?")));
  }

  function pencilActions(p){
    const { start, end } = span(p);
    return h("li", { className: "sch-actions" },
      h("button", { className: "chip", type: "button", textContent: "Accept", disabled: busy,
        ariaLabel: `Accept: put ${p.task.title} on your Daisey calendar, ${clock(start)}–${clock(end)}`,
        onclick: () => run(async () => { await acceptBlock({ task: p.task, start, end, title: pencilTitle(p) }); openPencil = null; }) }),
      h("button", { className: "chip", type: "button", textContent: "Swap", disabled: busy, onclick: () => answer(p, "swap") }),
      h("button", { className: "chip", type: "button", textContent: "Dismiss", disabled: busy, onclick: () => answer(p, "dismiss") }));
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

  function dayPanel(now, n){
    const date = localDate(dayStart(now, n));
    const today = n === 0;
    const events = cal.events.filter((e) => localDate(Date.parse(e.start)) === date)
      .sort((a, b) => (a.allDay === b.allDay ? Date.parse(a.start) - Date.parse(b.start) : a.allDay ? -1 : 1));
    const rows = dayRows(events, now, today ? now : null, today ? new Date(now).setHours(ROOM_HOURS.end, 0, 0, 0) : null);
    const pen = today ? pencils(now) : [];
    // The pencil for a gap row: the suggestion whose gap overlaps it.
    const penFor = (r) => pen.find((p) => p.gap.start < r.end && p.gap.end > r.start);
    return h("section", { className: "sch-day", ariaLabel: dayLabel(n, dayStart(now, n)) },
      today && capLine(now),
      rows.length === 0
        ? h("p", { className: "muted sch-free", textContent: "Nothing on the calendar." })
        : h("ul", { className: "sch-list" }, ...rows.flatMap((r) => {
          if (r.nowLine) return [h("li", { className: "sch-nowline" }, h("span", { className: "sch-nowtime", textContent: clock(now) }))];
          if (r.gap) {
            const p = penFor(r);
            if (!p) return [h("li", { className: "sch-gap", textContent: `${dur(r.minutes)} free` })];
            return openPencil === p.key ? [pencilRow(p), pencilActions(p)] : [pencilRow(p)];
          }
          const li = eventRow(r);
          return openId === r.event.id ? [li, actions(r.event)] : [li];
        })));
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
          `Moved ${undo.minutes > 0 ? "+" : "−"}${dur(Math.abs(undo.minutes))}. `,
          h("button", { className: "linkish", type: "button", textContent: "Undo", onclick: () => {
            const e = fresh(undo.id), by = -undo.minutes;
            undo = null; clearTimeout(undoTimer);
            if (e) run(() => moveEvent(e, by)); else render();
          } })));
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
