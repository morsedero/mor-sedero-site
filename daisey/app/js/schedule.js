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
//
// Editable from here (Mor, 2026-10-06): an event opens its details (Edit,
// Remove); a free gap or an empty day opens a new event right there. An event
// happening now is marked Now. A week ahead, as far as calendar.js fetches;
// a run of empty days folds into one line instead of a "Nothing scheduled"
// per day.
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

const quarterUp = (ms) => { const q = 15 * 60000; return Math.ceil(ms / q) * q; };
const hm = (ms) => clock(ms);

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

// el: the page. onEvent(ev): an event's details. onNew(date, at): a new
// event on "YYYY-MM-DD", at "HH:MM" when a gap was tapped.
export function mountSchedule(el, uid, { onEvent, onNew } = {}){
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
    const nameOf = (i, date) => (i === 0 ? (late || today.getHours() >= 18 ? "Tonight" : "Today")
      : i === 1 ? "Tomorrow" : date.toLocaleDateString("en-GB", { weekday: "long" }));
    const label = (name, date) => h("div", { className: "sc-label" }, h("span", { className: "sc-name", textContent: name }), h("span", { className: "sc-date", textContent: date }));
    const none = (date, text) => h("button", { type: "button", className: "sc-none", onclick: () => onNew?.(localDate(date.getTime())) },
      h("span", { textContent: text }), h("span", { className: "sc-add", ariaHidden: "true", textContent: "+ Add" }));
    let empty = []; // a run of empty days after tomorrow, shown as one line
    const flush = () => {
      if (!empty.length) return;
      const [a, b] = [empty[0], empty.at(-1)];
      kids.push(empty.length === 1
        ? h("section", { className: "sc-day", ariaLabel: `${a.name}, ${short(a.date)}` }, label(a.name, short(a.date)), none(a.date, "Nothing scheduled"))
        : h("section", { className: "sc-day", ariaLabel: `${a.name} to ${b.name}: nothing scheduled` },
          label(`${a.name.slice(0, 3)} – ${b.name.slice(0, 3)}`, `${a.date.getDate()}–${short(b.date).replace(/^\w+\s/, "")}`),
          none(a.date, `Nothing scheduled for ${empty.length} days`)));
      empty = [];
    };
    for (let i = 0; i < DAYS; i++) {
      const date = new Date(today); date.setDate(date.getDate() + i);
      const rows = dayRows(cal.events, date, hrs, i === 0 ? now : 0);
      // Past the day's end with nothing left tonight: go straight to tomorrow.
      if (i === 0 && late && !rows.length) { kids.push(nightDivider(minText(hrs.end), minText(hrs.start))); continue; }
      const name = nameOf(i, date);
      if (i >= 2 && !rows.length) { empty.push({ name, date }); continue; }
      flush();
      kids.push(h("section", { className: "sc-day", ariaLabel: `${name}, ${short(date)}` }, label(name, short(date)),
        ...(rows.length ? rows.map((x) => row(x, now)) : [none(date, "Nothing scheduled")])));
      if (i === 0) kids.push(nightDivider(minText(hrs.end), minText(hrs.start)));
    }
    flush();
    const y = el.scrollTop;
    el.replaceChildren(...kids);
    el.scrollTop = y;
  }

  function row(x, now){
    const time = x.allDay ? "All day" : `${clock(x.start)}–${clock(x.end)}`;
    // Free time is quiet (Mor, 2026-10-06: the dashed boxes read as slots to
    // fill): no box, no times, just how long, on a hairline.
    // Tapping it adds an event there.
    if (x.kind === "free") return h("button", { type: "button", className: "sc-row sc-gap", ariaLabel: `Free ${time} — add an event`,
      onclick: () => onNew?.(localDate(x.start), hm(quarterUp(x.start))) },
      h("span", { className: "sc-free" }, `${durText((x.end - x.start) / 60000)} free`, h("span", { className: "sc-add", ariaHidden: "true", textContent: "+" })));
    const on = !x.allDay && x.start <= now && now < x.end;
    return h("div", { className: "sc-row" + (on ? " sc-on" : "") }, h("span", { className: "sc-time strong" }, time, on && h("span", { className: "sc-nowtag", textContent: "Now" })),
      h("button", { type: "button", className: "sc-ev", style: x.ev.color ? `--ev:${x.ev.color}` : "",
        ariaLabel: `${on ? "Now: " : ""}${x.ev.title}, ${time}`, onclick: () => onEvent?.(x.ev) }, bdi(x.ev.title)));
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
