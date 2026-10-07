// The Schedule page of the home panel (layout round 3, Mor 2026-10-06; New
// Design/6-home-schedule-tab). One day as a list, not a grid: a label row
// ("Today · Tue 6 Oct", "Tomorrow", then the weekday), and under it one row
// per thing — its start–end time ONCE in the left column, then a tinted block
// with only the event's name, or a quiet "2 h free" line for a gap inside the
// day hours. A day with nothing on it says "Nothing scheduled".
//
// Labels follow the real clock: after midnight the coming day is "Today"
// (with the night divider above it), never "Tomorrow".
//
// Editable from here (Mor, 2026-10-06): an event opens its details (Edit,
// Remove); a free gap or an empty day opens a new event right there. An event
// happening now is marked Now.
//
// Today shows the whole day, what already passed included (Mor, 2026-10-06),
// dimmed; only free time starts from now.
//
// One day at a time (Mor, 2026-10-06: the whole week stacked vertically was
// crowded and confusing). A strip of the 7 days calendar.js fetches sits on
// top — weekday, date, a dot when there's something on — and the picked day
// shows below in full. It opens on today, or on tomorrow once today's hours
// are over and nothing's left. The pick lasts only as long as the tab.
import { watchCalendar, connectCalendar } from "./calendar.js";
import { watchSettings, watchTasks, watchRun } from "./store.js";
import { dayHours, minText } from "./day.js";
import { localDate, durText } from "./model.js";
import { h, bdi, nightDivider, icon } from "./ui.js";

const DAYS = 7; // today and six more: calendar.js fetches a week ahead
const MIN_FREE = 15; // minutes; a shorter gap isn't worth a box
const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const short = (d) => d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
const atMin = (d, min) => { const x = new Date(d); x.setHours(Math.floor(min / 60), min % 60, 0, 0); return x.getTime(); };

const quarterUp = (ms) => { const q = 15 * 60000; return Math.ceil(ms / q) * q; };
const hm = (ms) => clock(ms);

// One day's rows: events (busy or not) in order, and Free boxes for the gaps
// between busy ones inside the day hours. from: nothing before this counts
// as free (now, for today); events before it still show.
export function dayRows(events, date, hrs, from = 0){
  const d0 = new Date(date); d0.setHours(0, 0, 0, 0);
  const d1 = new Date(d0); d1.setDate(d1.getDate() + 1);
  const ymd = localDate(d0.getTime());
  const allDay = events.filter((e) => e.allDay && String(e.start).slice(0, 10) <= ymd && ymd < String(e.end || e.start).slice(0, 10))
    .map((e) => ({ kind: "event", allDay: true, ev: e }));
  const timed = events.filter((e) => !e.allDay)
    .map((e) => ({ kind: "event", start: Date.parse(e.start), end: Date.parse(e.end), ev: e }))
    .filter((x) => x.start < d1.getTime() && x.end > d0.getTime())
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
export function mountSchedule(el, uid, { onEvent, onNew, onOpen } = {}){
  let cal = { status: "loading", events: [] };
  let settings = {};
  let tasks = null, run = null; // for Plan my day
  let picked = null; // "YYYY-MM-DD" tapped in the day strip; null = today (tomorrow once tonight is empty)
  const fail = (e) => console.error("[daisey] schedule", e);

  function render(){
    const now = Date.now(), hrs = dayHours(settings);
    const note = { loading: "Loading the calendar…", not_connected: "Connect Google Calendar to see your day here, and so Daisey plans around your events.",
      needs_reauth: "The calendar connection expired.", error: "Couldn't load the calendar." }[cal.status];
    if (note) {
      const connect = cal.status === "not_connected" || cal.status === "needs_reauth";
      el.replaceChildren(h("p", { className: "sc-note", textContent: note }),
        connect && h("button", { className: "btn primary sc-connect", type: "button", textContent: cal.status === "needs_reauth" ? "Reconnect Google Calendar" : "Connect Google Calendar",
          onclick: connectCalendar }));
      return;
    }
    const today = new Date(now);
    const close = atMin(today, hrs.end), open = atMin(today, hrs.start);
    const early = now < open; // after midnight, before the day starts
    const late = now >= close;
    const days = Array.from({ length: DAYS }, (_, i) => {
      const date = new Date(today); date.setDate(date.getDate() + i);
      const rows = dayRows(cal.events, date, hrs, i === 0 ? now : 0);
      const evs = rows.filter((x) => x.kind === "event");
      return { i, date, ymd: localDate(date.getTime()), rows, events: evs.length, left: evs.filter((x) => x.allDay || x.end > now).length };
    });
    // Past the day's end with nothing left tonight, the strip opens on tomorrow.
    const auto = late && !days[0].left ? 1 : 0;
    if (!days.some((d) => d.ymd === picked)) picked = null; // the picked day has slid out of the week
    const day = days.find((d) => d.ymd === picked) || days[auto];
    const nameOf = (i, date) => (i === 0 ? (late || today.getHours() >= 18 ? "Tonight" : "Today")
      : i === 1 ? "Tomorrow" : date.toLocaleDateString("en-GB", { weekday: "long" }));
    const name = nameOf(day.i, day.date);

    const strip = h("div", { className: "sc-strip", role: "tablist", ariaLabel: "Day" }, ...days.map((d) => h("button", {
      type: "button", className: "sc-chip" + (d.date.getDay() === 6 ? " sat" : ""), role: "tab", ariaSelected: String(d === day),
      ariaLabel: `${nameOf(d.i, d.date)}, ${short(d.date)}: ${d.events ? `${d.events} event${d.events > 1 ? "s" : ""}` : "nothing scheduled"}`,
      onclick: () => { picked = d.i === auto ? null : d.ymd; el.scrollTop = 0; render(); },
    }, h("span", { className: "sc-chip-wd", textContent: d.i === 0 ? "Today" : d.date.toLocaleDateString("en-GB", { weekday: "short" }) }),
      h("span", { className: "sc-chip-n", textContent: d.date.getDate() }),
      h("span", { className: "sc-chip-dot" + (d.events ? " on" : ""), ariaHidden: "true" }))));

    const kids = [strip];
    if (day.i === 0 && early) kids.push(nightDivider(minText(hrs.end), minText(hrs.start)));
    const label = h("div", { className: "sc-label" }, h("span", { className: "sc-name", textContent: name }), h("span", { className: "sc-date", textContent: short(day.date) }));
    const none = h("button", { type: "button", className: "sc-none", onclick: () => onNew?.(day.ymd) },
      h("span", { textContent: "Nothing scheduled" }), h("span", { className: "sc-add", ariaHidden: "true", textContent: "+ Add" }));
    kids.push(h("section", { className: "sc-day", ariaLabel: `${name}, ${short(day.date)}` }, label,
      ...(day.rows.length ? day.rows.map((x) => row(x, now)) : [none])));
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
    const past = !x.allDay && x.end <= now;
    // A finished task is logged as a "✓ title" event (calendar.js logDone).
    const done = /^✓\s*/u.test(x.ev.title), title = done ? x.ev.title.replace(/^✓\s*/u, "") : x.ev.title;
    return h("div", { className: "sc-row" + (on ? " sc-on" : past ? " sc-past" : "") }, h("span", { className: "sc-time strong" }, time, on && h("span", { className: "sc-nowtag", textContent: "Now" })),
      h("button", { type: "button", className: "sc-ev" + (done ? " sc-done" : ""), style: x.ev.color ? `--ev:${x.ev.color}` : "",
        ariaLabel: `${done ? "Finished task: " : ""}${on ? "Now: " : ""}${title}, ${time}`, onclick: () => onEvent?.(x.ev) },
        done ? h("span", { className: "sc-tick" }, icon("check")) : h("span", { className: "sc-evi" }, icon("calendar")), bdi(title)));
  }

  const unsubs = [
    watchCalendar((c) => { cal = c; render(); }),
    watchSettings(uid, (s) => { settings = s || {}; render(); }, fail),
    watchTasks(uid, (ts) => { tasks = ts; render(); }, fail),
    watchRun(uid, (r) => { run = r; render(); }, fail),
  ];
  // Free time shrinks as the clock moves; once a minute is plenty.
  let mark = null;
  const tick = setInterval(() => { const m = Math.floor(Date.now() / 60000); if (m !== mark && !document.hidden) { mark = m; render(); } }, 5000);
  render();
  return { unmount(){ unsubs.forEach((u) => u()); clearInterval(tick); el.replaceChildren(); } };
}
