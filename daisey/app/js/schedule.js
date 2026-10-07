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
// crowded and confusing), or the week as a grid — see "Day or Week" below.
import { watchCalendar, connectCalendar, fetchRange } from "./calendar.js";
import { watchSettings, watchTasks, watchRun, watchDayPlan } from "./store.js";
import { timeline } from "./proposal.js";
import { areaClass, watchProjectColors } from "./look.js";
import { dayHours, minText } from "./day.js";
import { localDate, durText } from "./model.js";
import { h, bdi, nightDivider, icon } from "./ui.js";

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
// Day or Week (Mor, 2026-10-07: replaces the strip of seven day chips). Day:
// one day as the list above, opening on today, with ‹ › stepping one day at a
// time, back into the past too. Week: Sunday to Saturday as a grid like
// Google Calendar's — an hour column, seven day columns, events as blocks at
// their times; ‹ › step a week. Tapping a weekday heading opens that day;
// tapping the title goes back to today. Which view is remembered on this
// device; where you've stepped to lasts only as long as the tab.
const HOUR_PX = 44; // week grid: one hour's height
const VIEW_KEY = "daisey.schedView";
const dayStart = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d; };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const ymdToDate = (ymd) => { const [y, m, d] = ymd.split("-").map(Number); return new Date(y, m - 1, d); };
const pad = (n) => String(n).padStart(2, "0");

// Overlapping blocks share a column side by side: lane = which slot, lanes =
// how many in that overlap group. items: { s, e } in minutes, sorted by s.
function lanes(items){
  let group = [], end = -Infinity;
  const flush = () => {
    const cols = [];
    for (const x of group) {
      let i = cols.findIndex((e) => e <= x.s);
      if (i < 0) { i = cols.length; cols.push(0); }
      cols[i] = x.e; x.lane = i;
    }
    for (const x of group) x.lanes = cols.length;
    group = [];
  };
  for (const x of items) {
    if (x.s >= end) { flush(); end = -Infinity; }
    group.push(x); end = Math.max(end, x.e);
  }
  flush();
  return items;
}

// el: the page. onEvent(ev): an event's details. onNew(date, at): a new
// event on "YYYY-MM-DD", at "HH:MM" when a gap was tapped.
export function mountSchedule(el, uid, { onEvent, onNew, onOpen, onProjects } = {}){
  let cal = { status: "loading", events: [] };
  let settings = {};
  let tasks = null, run = null; // for Plan my day
  let dayPlan = null; // today's saved plan doc; approved, it sits in today's gaps
  let view = "day";
  try { if (localStorage.getItem(VIEW_KEY) === "week") view = "week"; } catch {}
  let focus = null; // "YYYY-MM-DD" stepped to; null = today
  // Days outside the week calendar.js fetches (today + 7) come from
  // fetchRange, one stretch at a time, kept until the main calendar changes.
  let extra = { key: null, status: "loading", events: [] };
  const fail = (e) => console.error("[daisey] schedule", e);

  let jump = true; // next render scrolls the week to now (or its first event)
  const setView = (v) => { view = v; try { localStorage.setItem(VIEW_KEY, v); } catch {} el.scrollTop = 0; jump = true; render(); };
  const go = (ymd) => { focus = ymd; el.scrollTop = 0; jump = true; render(); };

  // The events for [from, to): the shared week when it covers it, else a fetch.
  function eventsFor(from, to){
    const t0 = dayStart(Date.now()).getTime(), t1 = addDays(new Date(t0), 8).getTime();
    if (from >= t0 && to <= t1) return { status: cal.status, events: cal.events };
    const key = `${from}-${to}`;
    if (extra.key !== key || extra.dirty) {
      // A refetch of the same days keeps showing the last copy meanwhile.
      extra = extra.key === key ? { ...extra, dirty: false } : { key, status: "loading", events: [] };
      fetchRange(from, to).then((r) => { if (extra.key === key) { extra = { key, ...r }; render(); } })
        .catch((e) => { fail(e); if (extra.key === key) { extra = { key, status: "error", events: [] }; render(); } });
    }
    return extra;
  }

  function render(){
    const now = Date.now(), hrs = dayHours(settings);
    const today = dayStart(now);
    const at = focus ? ymdToDate(focus) : today;
    const range = view === "week" ? [addDays(at, -at.getDay()), 7] : [at, 1];
    const from = range[0], to = addDays(from, range[1]);
    const src = cal.status === "ok" ? eventsFor(from.getTime(), to.getTime()) : cal;
    const note = { loading: "Loading the calendar…", not_connected: "Connect Google Calendar to see your day here, and so Daisey plans around your events.",
      needs_reauth: "The calendar connection expired.", error: "Couldn't load the calendar." }[src.status];
    if (note && cal.status !== "ok") {
      const connect = cal.status === "not_connected" || cal.status === "needs_reauth";
      el.replaceChildren(h("p", { className: "sc-note", textContent: note }),
        connect && h("button", { className: "btn primary sc-connect", type: "button", textContent: cal.status === "needs_reauth" ? "Reconnect Google Calendar" : "Connect Google Calendar",
          onclick: connectCalendar }));
      return;
    }

    const step = (n) => go(localDate(addDays(at, n * range[1]).getTime()));
    const isNow = view === "week" ? from.getTime() === addDays(today, -today.getDay()).getTime() : at.getTime() === today.getTime();
    const late = now >= atMin(today, hrs.end);
    const dayName = (d) => {
      const diff = Math.round((d - today) / 864e5);
      return diff === 0 ? (late || new Date(now).getHours() >= 18 ? "Tonight" : "Today") : diff === 1 ? "Tomorrow" : diff === -1 ? "Yesterday"
        : d.toLocaleDateString("en-GB", { weekday: "long" });
    };
    const last = addDays(to, -1);
    const span = from.getMonth() === last.getMonth()
      ? `${from.getDate()} – ${last.getDate()} ${last.toLocaleDateString("en-GB", { month: "short" })}`
      : `${from.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} – ${last.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`;
    const title = view === "week" ? (isNow ? "This week" : span) : dayName(at);
    const sub = view === "week" ? (isNow ? span : "") : short(at);
    // A phone drops the date line, so a plain weekday carries its date ("Wed 15").
    const rel = Math.abs(Math.round((at - today) / 864e5)) <= 1;
    const narrow = view === "week" || rel ? title : `${at.toLocaleDateString("en-GB", { weekday: "short" })} ${at.getDate()}`;

    const seg = h("div", { className: "sc-seg", role: "radiogroup", ariaLabel: "View" }, ...[["day", "Day"], ["week", "Week"]].map(([v, t]) =>
      h("button", { type: "button", role: "radio", ariaChecked: String(view === v), textContent: t, onclick: () => view !== v && setView(v) })));
    // One row (Mor, 2026-10-07). Today keeps its place (just unseen on
    // today), so the arrows and the switch never shift under the finger.
    const bar = h("div", { className: "sc-bar" },
      h("button", { type: "button", className: "sc-step", ariaLabel: view === "week" ? "Previous week" : "Previous day", onclick: () => step(-1) }, icon("back")),
      h("button", { type: "button", className: "sc-title" + (isNow ? "" : " away"), ariaLabel: isNow ? title : `${title} — back to today`, onclick: () => go(null) },
        h("span", { className: "sc-name", textContent: title }), h("span", { className: "sc-name sc-name-s", textContent: narrow }), sub && h("span", { className: "sc-date", textContent: sub })),
      h("button", { type: "button", className: "sc-step", ariaLabel: view === "week" ? "Next week" : "Next day", onclick: () => step(1) }, icon("chev")),
      h("button", { type: "button", className: "sc-today" + (isNow ? " off" : ""), ariaLabel: "Back to today", textContent: "Today", tabIndex: isNow ? -1 : 0, onclick: () => go(null) }),
      seg,
      h("button", { type: "button", className: "sc-proj", ariaLabel: "Projects", onclick: () => onProjects && onProjects() }, icon("folder"), h("span", { className: "sc-proj-t", textContent: "Projects" })));
    const head = h("div", { className: "sc-head" + (view === "week" ? " wk" : "") }, bar);

    let body;
    if (src.status !== "ok") body = [h("p", { className: "sc-note", textContent: src.status === "loading" ? "Loading…" : "Couldn't load these days." })];
    else if (view === "week") body = week(src.events, from, now, hrs, today, head);
    else body = day(src.events, at, now, hrs, today);

    const y = el.scrollTop;
    el.replaceChildren(head, ...body);
    el.scrollTop = y;
    if (jump && src.status === "ok") {
      jump = false;
      const mark = view === "week" && (el.querySelector(".wk-now") || [...el.querySelectorAll(".wk-ev")].sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0]);
      if (mark) el.scrollTop = Math.max(0, el.scrollTop + mark.getBoundingClientRect().top - el.getBoundingClientRect().top - head.offsetHeight - HOUR_PX);
    }
  }

  // A task's project colour (its area's, failing that) for the event made for
  // it; events with no task keep their calendar colour.
  const tone = (ev) => { const t = ev.taskId && tasks?.find((x) => x.id === ev.taskId); return t ? areaClass(t) : ""; };

  // Today's approved plan on the clock (derived, never written to the calendar).
  function planRows(events, now, hrs){
    if (dayPlan?.status !== "approved" || dayPlan.date !== localDate() || !tasks) return [];
    return timeline(dayPlan.items || [], { tasks, events, now, hours: hrs, run }).rows
      .map((r) => ({ kind: "plan", start: r.start, end: r.end, task: r.task }));
  }

  function day(events, date, now, hrs, today){
    const t = date.getTime(), t0 = today.getTime();
    // Free time only from now on: none in the past, today's from the clock.
    const fromMs = t < t0 ? addDays(date, 1).getTime() : t === t0 ? now : 0;
    let rows = dayRows(events, date, hrs, fromMs);
    const ymd = localDate(t);
    // An approved plan sits inside today's free time (Mor, 2026-10-08): its
    // blocks replace the stretch of gap they cover. Derived, never written to
    // the calendar.
    const planned = t === t0 ? planRows(events, now, hrs) : [];
      if (planned.length) {
        const cut = rows.flatMap((x) => {
          if (x.kind !== "free") return [x];
          let parts = [x];
          for (const p of planned) parts = parts.flatMap((f) => [
            { ...f, end: Math.min(f.end, p.start) }, { ...f, start: Math.max(f.start, p.end) }]
            .filter((g) => g.end - g.start >= MIN_FREE * 60000 && (g.end <= p.start || g.start >= p.end)));
          return parts;
        });
        rows = [...cut, ...planned].sort((a, b) => (a.start ?? -1) - (b.start ?? -1) || (a.kind === "free") - (b.kind === "free"));
      }
    const out = [];
    if (t === t0 && now < atMin(today, hrs.start)) out.push(nightDivider(minText(hrs.end), minText(hrs.start)));
    const none = h("button", { type: "button", className: "sc-none", onclick: () => onNew?.(ymd) },
      h("span", { textContent: "Nothing scheduled" }), h("span", { className: "sc-add", ariaHidden: "true", textContent: "+ Add" }));
    out.push(h("section", { className: "sc-day", ariaLabel: short(date) }, ...(rows.length ? rows.map((x) => row(x, now)) : [none])));
    return out;
  }

  function week(events, from, now, hrs, today, head){
    const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
    const t0 = today.getTime();
    // Per day: all-day events, and timed ones in minutes from that midnight.
    const cols = days.map((d) => {
      const a = d.getTime(), b = addDays(d, 1).getTime(), ymd = localDate(a);
      const allDay = events.filter((e) => e.allDay && String(e.start).slice(0, 10) <= ymd && ymd < String(e.end || e.start).slice(0, 10));
      const timed = events.filter((e) => !e.allDay).map((e) => ({ ev: e, start: Date.parse(e.start), end: Date.parse(e.end) }))
        .filter((x) => x.start < b && x.end > a)
        .map((x) => ({ ...x, s: Math.max(0, (x.start - a) / 60000), e: Math.min(1440, (x.end - a) / 60000) }));
      if (a === t0) for (const p of planRows(events, now, hrs)) timed.push({ plan: p, start: p.start, end: p.end, s: (p.start - a) / 60000, e: (p.end - a) / 60000 });
      timed.sort((p, q) => p.s - q.s || q.e - p.e);
      return { d, ymd, allDay, timed: lanes(timed) };
    });
    // The grid spans the day hours, stretched to fit anything outside them.
    let h0 = Math.floor(hrs.start / 60), h1 = Math.ceil(hrs.end / 60);
    if (h1 <= h0) h1 = 24; // day hours past midnight: show to the end of the day
    for (const c of cols) for (const x of c.timed) { h0 = Math.min(h0, Math.floor(x.s / 60)); h1 = Math.max(h1, Math.ceil(x.e / 60)); }
    h0 = Math.max(0, h0); h1 = Math.min(24, Math.max(h1, h0 + 1));
    const px = (min) => ((min - h0 * 60) / 60) * HOUR_PX;

    // Weekday headings ride in the sticky header, under the bar.
    head.append(h("div", { className: "wk-heads" }, h("span"), ...cols.map((c) => {
      const t = c.d.getTime();
      return h("button", { type: "button", className: "wk-hd" + (t === t0 ? " today" : "") + (t < t0 ? " past" : "") + (c.d.getDay() === 6 ? " sat" : ""),
        ariaLabel: `${short(c.d)} — open the day`, onclick: () => { focus = c.ymd; setView("day"); } },
        h("span", { className: "wk-wd", textContent: c.d.toLocaleDateString("en-GB", { weekday: "narrow" }) }),
        h("span", { className: "wk-n", textContent: c.d.getDate() }));
    })));
    if (cols.some((c) => c.allDay.length)) head.append(h("div", { className: "wk-allday" }, h("span", { className: "wk-adl", textContent: "all day" }),
      ...cols.map((c) => h("div", { className: "wk-adc" }, ...c.allDay.map((e) => h("button", { type: "button", className: "wk-ad", style: e.color ? `--ev:${e.color}` : "",
        ariaLabel: `${e.title}, all day`, onclick: () => onEvent?.(e) }, bdi(e.title)))))));

    const hours = h("div", { className: "wk-hours", ariaHidden: "true" },
      ...Array.from({ length: h1 - h0 }, (_, i) => h("span", { style: `top:${i * HOUR_PX}px`, textContent: i ? pad(h0 + i) : "" })));
    const grid = h("div", { className: "wk-grid", style: `--hour:${HOUR_PX}px;block-size:${(h1 - h0) * HOUR_PX}px` }, hours, ...cols.map((c) => {
      const t = c.d.getTime();
      const col = h("div", { className: "wk-col" + (t === t0 ? " today" : "") + (t < t0 ? " past" : ""),
        // An empty spot: a new event there, on the half hour above.
        onclick: (e) => {
          if (e.target !== col) return;
          const min = Math.max(0, Math.min(1410, h0 * 60 + Math.floor((e.offsetY / HOUR_PX) * 2) * 30));
          onNew?.(c.ymd, `${pad(Math.floor(min / 60))}:${pad(min % 60)}`);
        } });
      for (const x of c.timed) {
        if (x.plan) {
          const w = 100 / x.lanes, time = `${clock(x.start)}–${clock(x.end)}`;
          col.append(h("button", { type: "button", className: "wk-ev wk-plan" + areaClass(x.plan.task) + (x.end <= now ? " past" : x.start <= now ? " on" : ""),
            style: `top:${px(x.s)}px;block-size:${Math.max(18, px(x.e) - px(x.s) - 2)}px;inset-inline-start:${x.lane * w}%;inline-size:calc(${w}% - 2px)`,
            ariaLabel: `Planned: ${x.plan.task.title}, ${short(c.d)} ${time}`, onclick: () => onOpen?.(x.plan.task) },
            h("span", { className: "wk-evt" }, bdi(x.plan.task.title)), x.e - x.s >= 45 && h("span", { className: "wk-evtime", textContent: clock(x.start) })));
          continue;
        }
        const done = /^✓\s*/u.test(x.ev.title), title = done ? x.ev.title.replace(/^✓\s*/u, "") : x.ev.title;
        const tall = x.e - x.s >= 45, time = `${clock(x.start)}–${clock(x.end)}`;
        const w = 100 / x.lanes;
        col.append(h("button", { type: "button", className: "wk-ev" + (done ? " done" : "") + tone(x.ev) + (x.end <= now ? " past" : x.start <= now ? " on" : ""),
          style: `top:${px(x.s)}px;block-size:${Math.max(18, px(x.e) - px(x.s) - 2)}px;inset-inline-start:${x.lane * w}%;inline-size:calc(${w}% - 2px);${x.ev.color ? `--ev:${x.ev.color}` : ""}`,
          ariaLabel: `${done ? "Finished task: " : ""}${title}, ${short(c.d)} ${time}`, onclick: () => onEvent?.(x.ev) },
          h("span", { className: "wk-evt" }, bdi(title)), tall && h("span", { className: "wk-evtime", textContent: clock(x.start) })));
      }
      if (t === t0) {
        const m = (now - t) / 60000;
        if (m >= h0 * 60 && m <= h1 * 60) col.append(h("span", { className: "wk-now", style: `top:${px(m)}px`, ariaHidden: "true" }));
      }
      return col;
    }));
    return [grid];
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
    if (x.kind === "plan") return h("div", { className: "sc-row" + (on ? " sc-on" : past ? " sc-past" : "") },
      h("span", { className: "sc-time strong" }, time, on && h("span", { className: "sc-nowtag", textContent: "Now" })),
      h("button", { type: "button", className: "sc-ev sc-plan" + areaClass(x.task), ariaLabel: `Planned: ${x.task.title}, ${time}`, onclick: () => onOpen?.(x.task) },
        h("span", { className: "sc-evi" }, icon("check")), bdi(x.task.title)));
    // A finished task is logged as a "✓ title" event (calendar.js logDone).
    const done = /^✓\s*/u.test(x.ev.title), title = done ? x.ev.title.replace(/^✓\s*/u, "") : x.ev.title;
    return h("div", { className: "sc-row" + (on ? " sc-on" : past ? " sc-past" : "") }, h("span", { className: "sc-time strong" }, time, on && h("span", { className: "sc-nowtag", textContent: "Now" })),
      h("button", { type: "button", className: "sc-ev" + (done ? " sc-done" : "") + tone(x.ev), style: x.ev.color ? `--ev:${x.ev.color}` : "",
        ariaLabel: `${done ? "Finished task: " : ""}${on ? "Now: " : ""}${title}, ${time}`, onclick: () => onEvent?.(x.ev) },
        done ? h("span", { className: "sc-tick" }, icon("check")) : h("span", { className: "sc-evi" }, icon("calendar")), bdi(title)));
  }

  const unsubs = [
    // A changed calendar (a write, a refetch) may change the fetched days too.
    watchCalendar((c) => { cal = c; extra.dirty = true; render(); }),
    watchSettings(uid, (s) => { settings = s || {}; render(); }, fail),
    watchTasks(uid, (ts) => { tasks = ts; render(); }, fail),
    watchRun(uid, (r) => { run = r; render(); }, fail),
    watchProjectColors(() => render()),
    watchDayPlan(uid, (d) => { dayPlan = d || null; render(); }, fail),
  ];
  // Free time shrinks as the clock moves; once a minute is plenty.
  let mark = null;
  const tick = setInterval(() => { const m = Math.floor(Date.now() / 60000); if (m !== mark && !document.hidden) { mark = m; render(); } }, 5000);
  render();
  return { unmount(){ unsubs.forEach((u) => u()); clearInterval(tick); el.replaceChildren(); } };
}
