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
import { watchCalendar, connectCalendar, fetchRange, retime } from "./calendar.js";
import { watchSettings, watchTasks, watchRun, watchDayPlan, saveDayPlan } from "./store.js";
import { timeline } from "./proposal.js";
import { areaClass, watchProjectColors } from "./look.js";
import { dayHours, minText } from "./day.js";
import { localDate, durText } from "./model.js";
import { h, bdi, nightDivider, icon } from "./ui.js";
import { pusher } from "./ppdrag.js";

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
// Mor, 2026-10-08: the week was small and untouchable inside the home panel,
// so it moved out. Home is the day only, with a Week button; Week is its own
// full-screen page (mode "week"), second instance of this same mount.
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
export function mountSchedule(el, uid, { onEvent, onNew, onOpen, onProjects, onWeek, onDay, mode = "home" } = {}){
  let cal = { status: "loading", events: [] };
  let settings = {};
  let tasks = null, run = null; // for Plan my day
  let dayPlan = null; // today's saved plan doc; approved, it sits in today's gaps
  const view = mode === "week" ? "week" : "day";
  const HOUR_PX = mode === "week" ? 60 : 44; // week grid: one hour's height
  let focus = null; // "YYYY-MM-DD" stepped to; null = today
  // Days outside the week calendar.js fetches (today + 7) come from
  // fetchRange, one stretch at a time, kept until the main calendar changes.
  let extra = { key: null, status: "loading", events: [] };
  const fail = (e) => console.error("[daisey] schedule", e);

  let jump = true; // next render scrolls the week to now (or its first event)
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

  // Drag sideways to change day (week: change week); no arrows.
  let stepBy = () => {}, swipe = null;
  el.style.touchAction = "pan-y"; // keep the horizontal drag ours, or the browser cancels it
  // The page follows the finger, then slides off and the next one slides in.
  const slide = (x, ms) => { el.style.transition = ms ? `transform ${ms}ms ease-out` : "none"; el.style.transform = x ? `translateX(${x}px)` : ""; };
  el.addEventListener("pointerdown", (e) => { swipe = dragging ? null : { x: e.clientX, y: e.clientY, on: false }; });
  el.addEventListener("pointermove", (e) => {
    if (!swipe || dragging) return;
    const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
    if (!swipe.on && Math.abs(dx) > 10 && Math.abs(dx) > 1.5 * Math.abs(dy)) swipe.on = true;
    if (swipe.on) slide(dx * 0.9);
  });
  el.addEventListener("pointerup", (e) => {
    if (!swipe) return;
    const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y, on = swipe.on;
    swipe = null;
    if (!on) return;
    sawSwipe = true; setTimeout(() => { sawSwipe = false; });
    if (dragging || Math.abs(dx) < 60 || Math.abs(dx) < 1.5 * Math.abs(dy)) { slide(0, 180); return; }
    const rtl = getComputedStyle(el).direction === "rtl";
    const w = el.clientWidth || innerWidth, out = dx < 0 ? -w : w;
    slide(out, 140);
    setTimeout(() => {
      stepBy((dx < 0) !== rtl ? 1 : -1);
      slide(-out); el.getBoundingClientRect(); slide(0, 180);
    }, 140);
  });
  el.addEventListener("pointercancel", () => { if (swipe?.on) slide(0, 180); swipe = null; });
  let sawSwipe = false; // the lift after a drag is not a tap
  el.addEventListener("click", (e) => { if (sawSwipe) { e.stopPropagation(); e.preventDefault(); } }, true);

  let dragging = false, stale = false; // a redraw mid-drag would drop the dragged row
  let dayCtx = null; // the shown day's { events, now, hrs, d0 }, for a drag's preview
  function render(){
    if (dragging) { stale = true; return; }
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
      el.replaceChildren(...[h("p", { className: "sc-note", textContent: note }),
        connect && h("button", { className: "btn primary sc-connect", type: "button", textContent: cal.status === "needs_reauth" ? "Reconnect Google Calendar" : "Connect Google Calendar",
          onclick: connectCalendar })].filter(Boolean));
      return;
    }

    stepBy = (n) => go(localDate(addDays(at, n * range[1]).getTime()));
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

    const weekBtn = h("button", { type: "button", className: "sc-weekbtn", ariaLabel: "Week", onclick: () => onWeek?.() }, icon("calendar"), h("span", { textContent: "Week" }));
    // One row (Mor, 2026-10-07). Today keeps its place (just unseen on
    // today), so the arrows and the switch never shift under the finger.
    const bar = h("div", { className: "sc-bar" },
      h("button", { type: "button", className: "sc-title" + (isNow ? "" : " away"), ariaLabel: isNow ? title : `${title} — back to today`, onclick: () => go(null) },
        h("span", { className: "sc-name", textContent: title }), h("span", { className: "sc-name sc-name-s", textContent: narrow }), sub && h("span", { className: "sc-date", textContent: sub })),
      h("button", { type: "button", className: "sc-today" + (isNow ? " off" : ""), ariaLabel: "Back to today", textContent: "Today", tabIndex: isNow ? -1 : 0, onclick: () => go(null) }),
      mode === "home" && onWeek && weekBtn);
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
    const tl = timeline(dayPlan.items || [], { tasks, events, now, hours: hrs, run });
    return [...tl.rows.map((r) => ({ kind: "plan", start: r.start, end: r.end, task: r.task })),
      ...tl.breaks.map((b) => ({ kind: "break", start: b.start, end: b.end, type: b.type }))];
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
    // Where a drag can land: every timed row (free time too). Timed events and
    // planned blocks are the ones that move.
    const slots = rows.filter((x) => !x.allDay);
    dayCtx = { events, now, hrs, d0: t };
    const out = [];
    if (t === t0 && now < atMin(today, hrs.start)) out.push(nightDivider(minText(hrs.end), minText(hrs.start)));
    const none = h("button", { type: "button", className: "sc-none", onclick: () => onNew?.(ymd) },
      h("span", { textContent: "Nothing scheduled" }), h("span", { className: "sc-add", ariaHidden: "true", textContent: "+ Add" }));
    out.push(h("section", { className: "sc-day", ariaLabel: short(date) }, ...(rows.length ? rows.map((x) => row(x, now, slots)) : [none])));
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
        ariaLabel: `${short(c.d)} — open the day`, onclick: () => onDay?.(c.ymd) },
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

  function row(x, now, slots = []){
    const time = x.allDay ? "All day" : `${clock(x.start)}–${clock(x.end)}`;
    // Free time is quiet (Mor, 2026-10-06: the dashed boxes read as slots to
    // fill): no box, no times, just how long, on a hairline.
    // Tapping it adds an event there.
    if (x.kind === "free") return x.el = h("button", { type: "button", className: "sc-row sc-gap", ariaLabel: `Free ${time} — add an event`,
      onclick: () => onNew?.(localDate(x.start), hm(quarterUp(x.start))) },
      h("span", { className: "sc-free" }, `${durText((x.end - x.start) / 60000)} free`, h("span", { className: "sc-add", ariaHidden: "true", textContent: "+" })));
    const on = !x.allDay && x.start <= now && now < x.end;
    const past = !x.allDay && x.end <= now;
    // No clock times: "30 min break" starts where the event boxes do.
    if (x.kind === "break") return x.el = h("div", { className: "sc-row sc-gap sc-break" + (on ? " sc-on" : past ? " sc-past" : ""), ariaLabel: `${time} break` },
      h("span", { className: "sc-free" }, `${durText((x.end - x.start) / 60000)} ${x.type === "lunch" ? "lunch" : "break"}`));
    if (x.kind === "plan") { const pe = h("div", { className: "sc-row" + (on ? " sc-on" : past ? " sc-past" : "") },
      h("span", { className: "sc-time strong" }, time, on && h("span", { className: "sc-nowtag", textContent: "Now" })),
      h("button", { type: "button", className: "sc-ev sc-plan" + areaClass(x.task), ariaLabel: `Planned: ${x.task.title}, ${time}`, onclick: () => onOpen?.(x.task) },
        h("span", { className: "sc-dot" }), bdi(x.task.title)));
      if (slots.includes(x)) { x.el = pe; draggable(x, pe, slots); pe.classList.add("sc-drag"); }
      return pe; }
    // A finished task is logged as a "✓ title" event (calendar.js logDone).
    const done = /^✓\s*/u.test(x.ev.title), title = done ? x.ev.title.replace(/^✓\s*/u, "") : x.ev.title;
    const rowEl = h("div", { className: "sc-row" + (on ? " sc-on" : past ? " sc-past" : "") }, h("span", { className: "sc-time strong" }, time, on && h("span", { className: "sc-nowtag", textContent: "Now" })),
      h("button", { type: "button", className: "sc-ev" + (done ? " sc-done" : "") + tone(x.ev), style: x.ev.color ? `--ev:${x.ev.color}` : "",
        ariaLabel: `${done ? "Finished task: " : ""}${on ? "Now: " : ""}${title}, ${time}`, onclick: () => onEvent?.(x.ev) },
        done ? h("span", { className: "sc-dot" }) : h("span", { className: "sc-evi" }, icon("calendar")), bdi(title)));
    if (slots.includes(x)) { x.el = rowEl; draggable(x, rowEl, slots); rowEl.classList.add("sc-drag"); }
    return rowEl;
  }

  // Drag a row anywhere in the day (Mor, 2026-10-08: one row away wasn't
  // enough). The row itself is the handle, no grip (Mor, same day): a mouse
  // drags once it moves a few px, a finger after a short still hold (a quick
  // swipe still scrolls); a plain tap still opens it. The row stays inside its
  // day — past the first or last row it stops. Where it's let go decides:
  // - an event takes a new time and keeps its length. It starts where the row
  //   above the drop line ends, or where free time it's dropped on starts.
  //   Nothing else moves; the plan flows around it.
  // - a planned task takes that place in the plan's order; the plan re-flows
  //   around the events, so its time follows.
  // While dragging, the row's time shows where it would land, and the rows in
  // the way slide over to make room (pusher, ppdrag.js).
  function draggable(x, rowEl, slots){
    const dur = x.end - x.start;
    let y0 = 0, s0 = 0, off = 0, lastY = 0, home = 0, mid0 = 0, lo = 0, hi = 0, snap = [], drop = null, marked = null, timeEl = null, orig = [], raf = 0, push = null;
    let pid = null, armed = false, hold = 0, dragged = false;
    // The dragged row's middle, in page terms: inside its day, and inside what
    // shows of the list (under the sticky bar, above the bottom) give or take
    // a peek — so at either edge it stays in sight while the list scrolls.
    let rh = 0;
    const centre = () => {
      const s = el.scrollTop, r = el.getBoundingClientRect(), top = el.querySelector(".sc-head")?.getBoundingClientRect().bottom ?? r.top;
      const PEEK = 14, vlo = top + s + rh / 2 - PEEK, vhi = r.bottom + s - rh / 2 + PEEK;
      return Math.min(hi, vhi, Math.max(lo, vlo, lastY + off + s));
    };
    // The pointer → { on: a free row } or { i: the line before snap[i] }.
    const where = () => {
      const c = centre();
      const on = x.kind === "event" && snap.find((s) => s.p.kind === "free" && c >= s.top && c <= s.bottom);
      return on ? { on: on.p } : { i: snap.filter((s) => s.mid < c).length };
    };
    // What letting go there does; null = nothing changes.
    const outcome = (w) => {
      if (x.kind === "event") {
        if (!w.on && w.i === home) return null;
        const above = snap[w.i - 1]?.p, below = snap[w.i]?.p;
        let start = w.on ? w.on.start : above ? (above.kind === "free" ? above.start : above.end) : below.start - dur;
        start = Math.max(dayCtx.d0, start);
        return start === x.start ? null : { start, end: start + dur };
      }
      const all = dayPlan?.items || [], me = all.find((it) => it.taskId === x.task.id);
      if (!me) return null;
      const items = all.filter((it) => it !== me);
      const plans = snap.filter((s) => s.p.kind === "plan").map((s) => s.p);
      const k = snap.slice(0, w.i).filter((s) => s.p.kind === "plan").length;
      const at = k < plans.length ? items.findIndex((it) => it.taskId === plans[k].task.id)
        : plans.length ? items.findIndex((it) => it.taskId === plans.at(-1).task.id) + 1 : 0;
      items.splice(Math.max(0, at), 0, me);
      if (items.every((it, j) => it === all[j])) return null;
      const r = timeline(items, { tasks, events: dayCtx.events, now: dayCtx.now, hours: dayCtx.hrs, run }).rows.find((q) => q.taskId === x.task.id);
      return { items, start: r?.start, end: r?.end };
    };
    const unmark = () => { marked?.[0].classList.remove(marked[1]); marked = null; };
    const show = () => {
      rowEl.style.transform = `translateY(${centre() - mid0}px)`;
      const w = where();
      drop = outcome(w);
      unmark();
      // Dropped on free time it takes that time: nothing to push, the gap lights up.
      if (drop && w.on) { marked = [w.on.el, "sc-target"]; marked[0].classList.add(marked[1]); }
      drop && !w.on ? push.to(snap[w.i]?.p.el, snap.at(-1)?.p.el) : push.home();
      timeEl.replaceChildren(...(!drop ? orig : drop.start == null ? ["Won't fit"] : [`${clock(drop.start)}–${clock(drop.end)}`]));
    };
    // Near the top or bottom edge the page scrolls, so any row can be reached.
    const tick = () => {
      const r = el.getBoundingClientRect(), top = el.querySelector(".sc-head")?.getBoundingClientRect().bottom ?? r.top;
      // Nearer the edge, faster (up to 20px a frame); a wide zone to push into.
      const Z = 72, up = top + Z - lastY, down = lastY - (r.bottom - Z);
      const v = up > 0 ? -Math.min(1, up / Z) : down > 0 ? Math.min(1, down / Z) : 0;
      if (v) { const was = el.scrollTop; el.scrollTop += Math.sign(v) * Math.max(3, Math.abs(v) * 20); if (el.scrollTop !== was) show(); }
      raf = requestAnimationFrame(tick);
    };
    const arm = () => {
      clearTimeout(hold); armed = dragging = dragged = true;
      try { rowEl.setPointerCapture(pid); } catch {}
      rowEl.classList.add("sc-dragging");
      s0 = el.scrollTop; drop = null;
      snap = slots.filter((p) => p !== x && p.el?.isConnected).map((p) => {
        const r = p.el.getBoundingClientRect();
        return { p, top: r.top + s0, bottom: r.bottom + s0, mid: (r.top + r.bottom) / 2 + s0 };
      });
      const r = rowEl.getBoundingClientRect(), mid = (r.top + r.bottom) / 2, sec = rowEl.parentElement.getBoundingClientRect();
      off = mid - y0; mid0 = mid + s0; rh = r.height; home = snap.filter((s) => s.mid < mid0).length;
      // A little past the first and last row, so a tall row can still pass
      // a short one's middle and be pushed to the very top or bottom.
      const EDGE = 56;
      lo = sec.top + s0 - EDGE; hi = sec.bottom + s0 + EDGE;
      timeEl = rowEl.querySelector(".sc-time"); orig = [...timeEl.childNodes];
      push = pusher(rowEl.parentElement, rowEl);
      navigator.vibrate?.(10);
      raf = requestAnimationFrame(tick);
      show();
    };
    const disarm = () => { clearTimeout(hold); pid = null; };
    rowEl.addEventListener("pointerdown", (e) => {
      if (e.button || pid != null) return;
      if (!e.target.closest(".sc-ev")) return; // only the task cube drags, not the time text
      pid = e.pointerId; y0 = lastY = e.clientY; dragged = false;
      if (e.pointerType !== "mouse") hold = setTimeout(arm, 350); // a finger: hold still first
    });
    rowEl.addEventListener("pointermove", (e) => {
      if (e.pointerId !== pid) return;
      lastY = e.clientY;
      if (armed) return show();
      if (Math.abs(lastY - y0) > 6) e.pointerType === "mouse" ? arm() : disarm(); // a finger moving first is a scroll
    });
    // A finger: once armed, the page mustn't take the move as a scroll.
    rowEl.addEventListener("touchmove", (e) => { if (armed) e.preventDefault(); }, { passive: false });
    rowEl.addEventListener("contextmenu", (e) => { if (pid != null) e.preventDefault(); });
    // The click that ends a drag doesn't open the row.
    rowEl.addEventListener("click", (e) => { if (dragged) { e.stopPropagation(); e.preventDefault(); dragged = false; } }, true);
    const end = async (e) => {
      if (e.pointerId !== pid) return;
      const live = armed; disarm(); armed = false;
      if (!live) return;
      try { rowEl.releasePointerCapture(e.pointerId); } catch {}
      dragging = false; cancelAnimationFrame(raf);
      rowEl.style.transform = ""; rowEl.classList.remove("sc-dragging");
      unmark(); push.done(); timeEl.replaceChildren(...orig);
      const d = e.type === "pointerup" ? drop : null; drop = null;
      if (!d) { if (stale) { stale = false; render(); } return; }
      stale = false;
      if (x.kind === "plan") { // the saved plan's order; times follow from it
        dayPlan = { ...dayPlan, items: d.items }; render();
        saveDayPlan(uid, dayPlan).catch(fail);
        return;
      }
      // Shown at the new time at once; the write's reload confirms it.
      const ev = x.ev, was = [ev.start, ev.end];
      ev.start = new Date(d.start).toISOString(); ev.end = new Date(d.end).toISOString(); render();
      try { await retime(ev, d.start, d.end); }
      catch (err) { [ev.start, ev.end] = was; render(); fail(err); }
    };
    rowEl.addEventListener("pointerup", end);
    rowEl.addEventListener("pointercancel", end);
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
  return { go, unmount(){ unsubs.forEach((u) => u()); clearInterval(tick); el.replaceChildren(); } };
}
