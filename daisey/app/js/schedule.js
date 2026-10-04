// The Schedule panel: what Google Calendar says a day holds. One day fills
// the panel and the days slide sideways — swipe, or use ‹ › — up to a week
// ahead.
//
// It reads the same fetch as the Now card's free window (calendar.js), so
// the panel and the card can never disagree. Events already finished stay,
// in grey, because a day you can't see the start of is hard to place
// yourself in, and a red line marks where "now" falls, as Google's does.
//
// Tapping an event opens it in the event sheet (addevent.js) — its details,
// then Edit — which is Google's own flow, and what Mor asked for on
// 2026-10-05: "copy from google calendar everything about opening and editing
// events from the grid, and revert the timeline view".
//
// So this panel reads the day and nothing else: no drag, no inline rename, no
// row that opens into a set of controls. A true-to-scale time grid was tried
// here the same day and reverted on sight ("doesn't feel good as a timed
// schedule, too big") — a day of mostly-empty hours spent most of its height
// saying nothing, where a list says the same day in a screenful. All the
// editing the grid was carrying moved into the sheet, which is why the list
// could come back unchanged.
//
// The "+ New event" button in the header opens the same sheet empty, on the
// day being shown (Mor, 2026-10-04 — no jumping to Google Calendar to put a
// meeting in). Daisey still never schedules anything ITSELF; what it writes is
// what the user typed.
import { watchCalendar, acceptBlock } from "./calendar.js";
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

// "HH:MM" on the same day as an ISO time, as a timestamp.

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

// Up next (DAISEY_SPEC "Pencil schedule", Mor 2026-10-05 — "like tetris,
// where the user can see what is next and can replace it if he wants"): the
// suggestions are NOT scattered through the day any more. The engine's picks
// for today's free gaps (pencil.js) are one queue at the top of today: the
// next piece large, the two after it faded behind it. Replace swaps the next
// piece for the engine's following pick in that gap; Not today drops the task
// from the queue; Add puts it on the "Daisey" calendar, which is the only
// thing that writes anything. Ignoring the queue costs nothing.
//
// Why a queue and not a row inside each gap: a faded row sitting in a 15:00
// slot reads as something already scheduled, and the day list then held two
// kinds of thing with one shape. One queue says "this is what's coming, and
// it isn't booked" without needing the day to carry it. The gaps in the list
// are back to plain "1 h 20 min free".
//
// It redraws whenever tasks, the calendar or the energy and place chips
// change. On top of today: "2 h free today, 8 open. Realistic: 3." with
// "Move the rest", which opens the sweep on the ones that don't fit.
// uid: the signed-in user. onSweep(ids) opens the sweep on those tasks.
// onOpen(event) hands a tapped calendar event to the sheet.
export function mountSchedule(root, { onAdd, onOpen, uid, onSweep } = {}){
  let cal = { status: "loading", events: [] };
  let tasks = null, momentDoc = {}, learnStats = {}, pencilDoc = {};
  let currentId = null; // the task on the Now card: the current gap's pencil
  let offset = 0; // days from today
  let strip = null; // the sliding row of days
  let heading, back, prev, next;
  let busy = false; // a write is in flight (the pencil's; the sheet does its own)
  let problem = ""; // what went wrong with the last write

  const WRITE_ERROR = {
    read_only: "That calendar is read-only.",
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


  // ---------- rows ----------

  function eventRow(r){
    const e = r.event;
    const time = e.allDay ? "all day" : e.end ? `${clock(e.start)}–${clock(e.end)}` : clock(e.start);
    const inside = [
      // The colour is the one the user sees in Google Calendar.
      h("span", { className: "sch-dot", style: e.color ? `background:${e.color}` : "" }),
      h("span", { className: "sch-time", textContent: time }),
      h("span", { className: "sch-title" }, bdi(e.title),
        r.running && h("span", { className: "sch-now", textContent: "now" })),
    ];
    return h("li", { className: "sch-row" + (r.past ? " past" : "") + (r.running ? " running" : "") },
      h("button", { className: "sch-open", type: "button", ariaLabel: `${e.title}, ${time} — open it`,
        onclick: () => onOpen?.(e) }, ...inside));
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
    render();
    savePencil(uid, pd).catch((e) => console.error("[daisey] pencil", e));
  }

  const span = (p) => { const start = blockStart(p); return { start, end: start + p.minutes * 60000 }; };
  const pencilTitle = (p) => p.task.title + (p.part ? " (part)" : "");

  // The next piece, big, with its actions; then up to two more, faded, so
  // the shape of the rest of the day is visible without being acted on.
  function nextUp(now){
    const pen = pencils(now);
    if (pen.length === 0) return null;
    const [p, ...rest] = pen;
    const { start, end } = span(p);
    const when = p.isNow ? "now" : clock(start);
    return h("section", { className: "sch-next", ariaLabel: "Up next" },
      h("p", { className: "sch-next-label", textContent: "Up next" }),
      h("p", { className: "sch-next-task" }, bdi(pencilTitle(p)),
        h("span", { className: "sch-next-when", textContent: `${when} · ${dur(p.minutes)}` })),
      h("div", { className: "sch-next-acts" },
        h("button", { className: "chip", type: "button", textContent: "Add", disabled: busy,
          ariaLabel: `Add ${p.task.title} to your Daisey calendar, ${clock(start)}–${clock(end)}`,
          onclick: () => run(() => acceptBlock({ task: p.task, start, end, title: pencilTitle(p) })) }),
        h("button", { className: "chip", type: "button", textContent: "Replace", disabled: busy,
          ariaLabel: `Replace ${p.task.title} with the next pick for ${when}`,
          onclick: () => answer(p, "swap") }),
        h("button", { className: "chip", type: "button", textContent: "Not today", disabled: busy,
          ariaLabel: `Take ${p.task.title} off today's queue`, onclick: () => answer(p, "dismiss") })),
      rest.length > 0 && h("ul", { className: "sch-queue" }, ...rest.slice(0, 2).map((q) =>
        h("li", { className: "sch-queue-item" },
          h("span", { className: "sch-time", textContent: clock(span(q).start) }),
          h("span", { className: "sch-title" }, bdi(pencilTitle(q)))))));
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
    return h("section", { className: "sch-day", ariaLabel: dayLabel(n, dayStart(now, n)) },
      today && capLine(now),
      today && nextUp(now),
      rows.length === 0
        ? h("p", { className: "muted sch-free", textContent: "Nothing on the calendar." })
        : h("ul", { className: "sch-list" }, ...rows.flatMap((r) => {
          if (r.nowLine) return [h("li", { className: "sch-nowline" }, h("span", { className: "sch-nowtime", textContent: clock(now) }))];
          if (r.gap) return [h("li", { className: "sch-gap", textContent: `${dur(r.minutes)} free` })];
          return [eventRow(r)];
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
    unmount(){ unsubs.forEach((u) => u()); clearInterval(tick); document.removeEventListener("visibilitychange", onVisible); root.replaceChildren(); root.hidden = true; },
  };
}
