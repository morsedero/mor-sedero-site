// The Schedule page of the home panel (layout round 3, Mor 2026-10-06; New
// Design/6-home-schedule-tab). The days ahead as a list, not a grid: a label
// row per day ("Tonight · Mon 5 Oct", "Tomorrow · Tue 6 Oct", then the
// weekday), and under it one row per thing — its start–end time ONCE in the
// left column, then a tinted block with only the event's name, or a quiet
// "2 h free" line for a gap inside the day hours. The night divider sits between
// today and tomorrow. A day with nothing on it says "Nothing scheduled".
//
// Labels follow the real clock: after midnight the coming day is "Today"
// (with the night divider above it), never "Tomorrow".
import { watchCalendar } from "./calendar.js";
import { watchSettings } from "./store.js";
import { dayHours, minText } from "./day.js";
import { localDate, durText } from "./model.js";
import { h, bdi, nightDivider } from "./ui.js";

const DAYS = 7; // today and six more: calendar.js fetches a week ahead
const MIN_FREE = 15; // minutes; a shorter gap isn't worth a box
const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const short = (d) => d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
const atMin = (d, min) => { const x = new Date(d); x.setHours(Math.floor(min / 60), min % 60, 0, 0); return x.getTime(); };

// One day's rows: events (busy or not) in order, and Free boxes for the gaps
// between busy ones inside the day hours. from: nothing before this counts
// as free (now, for today).
export function dayRows(events, date, hrs, from = 0){
  const d0 = new Date(date); d0.setHours(0, 0, 0, 0);
  const d1 = new Date(d0); d1.setDate(d1.getDate() + 1);
  const ymd = localDate(d0.getTime());
  const allDay = events.filter((e) => e.allDay && String(e.start).slice(0, 10) <= ymd && ymd < String(e.end || e.start).slice(0, 10))
    .map((e) => ({ kind: "event", allDay: true, ev: e }));
  const timed = events.filter((e) => !e.allDay)
    .map((e) => ({ kind: "event", start: Date.parse(e.start), end: Date.parse(e.end), ev: e }))
    .filter((x) => x.start < d1.getTime() && x.end > d0.getTime() && x.end > from)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const open = atMin(d0, hrs.start), close = atMin(d0, hrs.end);
  const rows = [];
  let cursor = Math.max(open, Math.floor(from / 60000) * 60000);
  const gap = (to) => {
    const end = Math.min(to, close);
    if (end - cursor >= MIN_FREE * 60000) rows.push({ kind: "free", start: cursor, end });
  };
  for (const x of timed) {
    if (x.ev.busy !== false) { gap(x.start); cursor = Math.max(cursor, x.end); }
    rows.push(x);
  }
  // The gap rows went in as they were found; put everything in time order.
  rows.sort((a, b) => a.start - b.start || (a.kind === "free") - (b.kind === "free"));
  if (timed.length || from) gap(close);
  return [...allDay, ...rows];
}

// el: the page. onEvent(ev): an event's details.
export function mountSchedule(el, uid, { onEvent } = {}){
  let cal = { status: "loading", events: [] };
  let settings = {};
  const fail = (e) => console.error("[daisey] schedule", e);

  function render(){
    const now = Date.now(), hrs = dayHours(settings);
    const note = { loading: "Loading the calendar…", not_connected: "Calendar not connected.", needs_reauth: "Calendar sign-in expired.", error: "Couldn't load the calendar." }[cal.status];
    if (note) {
      el.replaceChildren(h("p", { className: "sc-note" }, note, ...(cal.status === "not_connected" || cal.status === "needs_reauth"
        ? [" ", h("a", { href: "/daisey/", textContent: "Open old Daisey" })] : [])));
      return;
    }
    const today = new Date(now);
    const close = atMin(today, hrs.end), open = atMin(today, hrs.start);
    const early = now < open; // after midnight, before the day starts
    const late = now >= close;
    const kids = [];
    if (early) kids.push(nightDivider(minText(hrs.end), minText(hrs.start)));
    for (let i = 0; i < DAYS; i++) {
      const date = new Date(today); date.setDate(date.getDate() + i);
      const rows = dayRows(cal.events, date, hrs, i === 0 ? now : 0);
      // Past the day's end with nothing left tonight: go straight to tomorrow.
      if (i === 0 && late && !rows.length) { kids.push(nightDivider(minText(hrs.end), minText(hrs.start))); continue; }
      const name = i === 0 ? (late || today.getHours() >= 18 ? "Tonight" : "Today")
        : i === 1 ? "Tomorrow" : date.toLocaleDateString("en-GB", { weekday: "long" });
      kids.push(h("section", { className: "sc-day", ariaLabel: `${name}, ${short(date)}` },
        h("div", { className: "sc-label" }, h("span", { className: "sc-name", textContent: name }), h("span", { className: "sc-date", textContent: short(date) })),
        ...(rows.length ? rows.map(row) : [h("p", { className: "sc-none", textContent: "Nothing scheduled" })])));
      if (i === 0) kids.push(nightDivider(minText(hrs.end), minText(hrs.start)));
    }
    const y = el.scrollTop;
    el.replaceChildren(...kids);
    el.scrollTop = y;
  }

  function row(x){
    const time = x.allDay ? "All day" : `${clock(x.start)}–${clock(x.end)}`;
    // Free time is quiet (Mor, 2026-10-06: the dashed boxes read as slots to
    // fill): no box, no times, just how long, on a hairline.
    if (x.kind === "free") return h("div", { className: "sc-row sc-gap", ariaLabel: `Free ${time}` },
      h("span", { className: "sc-free", textContent: `${durText((x.end - x.start) / 60000)} free` }));
    return h("div", { className: "sc-row" }, h("span", { className: "sc-time strong", textContent: time }),
      h("button", { type: "button", className: "sc-ev", style: x.ev.color ? `--ev:${x.ev.color}` : "",
        ariaLabel: `${x.ev.title}, ${time}`, onclick: () => onEvent?.(x.ev) }, bdi(x.ev.title)));
  }

  const unsubs = [
    watchCalendar((c) => { cal = c; render(); }),
    watchSettings(uid, (s) => { settings = s || {}; render(); }, fail),
  ];
  // Free time shrinks as the clock moves; once a minute is plenty.
  let mark = null;
  const tick = setInterval(() => { const m = Math.floor(Date.now() / 60000); if (m !== mark && !document.hidden) { mark = m; render(); } }, 5000);
  render();
  return { unmount(){ unsubs.forEach((u) => u()); clearInterval(tick); el.replaceChildren(); } };
}
