// The Schedule panel: what Google Calendar says a day holds. One day fills
// the panel and the days slide sideways — swipe, or use ‹ › — up to a week
// ahead. Read-only; Daisey never writes to the calendar in v1.
//
// It reads the same fetch as the Now card's free window (calendar.js), so
// the panel and the card can never disagree. Events already finished stay,
// in grey, because a day you can't see the start of is hard to place
// yourself in, and a red line marks where "now" falls, as Google's does.
//
// Tapping an event you own opens the two writes Daisey makes: move it, or
// delete it. Both are reactions to a day that changed — Daisey never creates
// calendar entries of its own (that would be the auto-scheduler the spec
// refuses to be). A move can be undone for a few seconds; a delete asks
// first, because Google has no undo for it.
import { watchCalendar, moveEvent, moveEventTo, deleteEvent } from "./calendar.js";
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
function dayRows(events, now, from){
  const rows = [];
  let cursor = from;
  let marked = from == null; // the now line belongs to today alone
  for (const e of events) {
    const start = Date.parse(e.start), end = Date.parse(e.end || e.start);
    // The line comes before the gap it starts, not after it.
    if (!marked && !e.allDay && start > now) { rows.push({ nowLine: true }); marked = true; }
    if (!e.allDay && cursor != null && start > cursor) {
      const gap = Math.round((start - cursor) / 60000);
      if (gap >= 15) rows.push({ gap, minutes: gap });
    }
    const running = !e.allDay && start <= now && end > now;
    rows.push({ event: e, past: !e.allDay && end <= now, running });
    if (running) marked = true; // the line would fall inside this event; its own highlight says so
    if (!e.allDay) cursor = Math.max(cursor ?? start, end);
  }
  if (!marked && rows.length) rows.push({ nowLine: true }); // everything today is already over
  return rows;
}

export function mountSchedule(root){
  let cal = { status: "loading", events: [] };
  let offset = 0; // days from today
  let strip = null; // the sliding row of days
  let heading, back, prev, next;
  let openId = null; // the event whose actions are showing
  let confirming = null; // the event id waiting for "Delete?" to be confirmed
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
        onclick: () => { openId = openId === e.id ? null : e.id; confirming = null; render(); } }, ...inside));
  }

  function dayPanel(now, n){
    const date = localDate(dayStart(now, n));
    const events = cal.events.filter((e) => localDate(Date.parse(e.start)) === date)
      .sort((a, b) => (a.allDay === b.allDay ? Date.parse(a.start) - Date.parse(b.start) : a.allDay ? -1 : 1));
    const rows = dayRows(events, now, n === 0 ? now : null);
    return h("section", { className: "sch-day", ariaLabel: dayLabel(n, dayStart(now, n)) },
      events.length === 0
        ? h("p", { className: "muted sch-free", textContent: "Nothing on the calendar." })
        : h("ul", { className: "sch-list" }, ...rows.map((r) => (r.nowLine
          ? h("li", { className: "sch-nowline" }, h("span", { className: "sch-nowtime", textContent: clock(now) }))
          : r.gap ? h("li", { className: "sch-gap", textContent: `${dur(r.minutes)} free` })
          : eventRow(r))).flatMap((li, i) => {
            const r = rows[i];
            return r.event && openId === r.event.id ? [li, actions(r.event)] : [li];
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

    const kids = [h("header", { className: "sch-nav" }, prev, heading, next)];
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

  const unsub = watchCalendar((c) => { cal = c; render(); });
  // Keep "now", the greying of finished events and the gaps honest.
  const tick = setInterval(() => { if (!document.hidden && cal.status === "ok") render(); }, 60000);
  const onVisible = () => { if (!document.hidden) render(); };
  document.addEventListener("visibilitychange", onVisible);
  root.hidden = false;
  render();

  return {
    unmount(){ unsub(); clearInterval(tick); clearTimeout(undoTimer); document.removeEventListener("visibilitychange", onVisible); root.replaceChildren(); root.hidden = true; },
  };
}
