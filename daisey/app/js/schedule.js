// The Schedule page of the home panel (layout round 3, Mor 2026-10-06; New
// Design/6-home-schedule-tab). One day as a list, not a grid: a label row
// ("Today · Tue 6 Oct", "Tomorrow", then the weekday), and under it one row
// per thing — its start–end time ONCE in the left column, then a tinted block
// with only the event's name, or a quiet "2 h free" line for a gap inside the
// day hours. A day with nothing on it says "Nothing scheduled".
//
// Labels follow the night-owl day (Mor, 2026-10-12; was the real clock):
// after midnight and before the day boundary (model.js getDayKey) it's
// still tonight, so the coming morning is "Tomorrow" (with the night divider
// above it) — the same morning the Now card calls Tomorrow first.
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
import { watchCalendar, connectCalendar, fetchRange, landedAgo } from "./calendar.js";
import { watchSettings, watchTasks, watchDayPlan } from "./store.js";
import { timeline } from "./proposal.js";
import { planActivity } from "./miss.js";
import { areaClass, watchProjectColors } from "./look.js";
import { dayHours, minText, planDate, usualHours, dayEndAt, nightRange, dayWord, gridSpan } from "./day.js";
import { localDate, logicalDate, durText } from "./model.js";
import { h, bdi, nightDivider, icon } from "./ui.js";
import { withTrips } from "./trips.js";

const MIN_FREE = 15; // minutes; a shorter gap isn't worth a box
const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const short = (d) => d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
const atMin = (d, min) => { const x = new Date(d); x.setHours(Math.floor(min / 60), min % 60, 0, 0); return x.getTime(); };

const quarterUp = (ms) => { const q = 15 * 60000; return Math.ceil(ms / q) * q; };
// Nothing on right now (Mor, 2026-10-18): the first task or event still to
// come wears a "Next · 25m" tag where Now would sit. Free time doesn't count
// as on; a break does (it's the Now card's too).
export function upNext(rows, now){
  if (rows.some((x) => !x.allDay && x.kind !== "free" && x.start <= now && now < x.end)) return null;
  return rows.find((x) => !x.allDay && (x.kind === "plan" || x.kind === "event") && x.start > now) || null;
}
// Short enough for the 80px time column: "25m", "1h 30m", past 3 h just "4h".
export function untilText(ms){
  const m = Math.max(1, Math.ceil(ms / 60000));
  if (m < 60) return `${m}m`;
  const hr = Math.floor(m / 60), rest = m % 60;
  return hr >= 3 || rest < 5 ? `${hr}h` : `${hr}h ${rest}m`;
}
const hm = (ms) => clock(ms);
// A break says what it's for: "Breather · 15 min", "Lunch · 45 min". Free time reads the
// same way, "Free · 2 h". Plain words, no icons (Mor, 2026-10-21: emoji were distracting);
// app.css sets all three in a muted italic inside a dashed box.
export const breakText = (b, len) => (b.type === "meal"
  ? `${b.name || "Meal"} · ${len}` : `Breather · ${len}`);

// One day's rows: events (busy or not) in order, and Free boxes for the gaps
// between busy ones inside the day hours. from: nothing before this counts
// as free (now, for today); events before it still show.
export function dayRows(events, date, hrs, from = 0){
  const d0 = new Date(date); d0.setHours(0, 0, 0, 0);
  const d1 = new Date(d0); d1.setDate(d1.getDate() + 1);
  const ymd = localDate(d0.getTime());
  // A day that runs past midnight keeps its small hours; the next day starts
  // after them (night owls, Mor 2026-10-11).
  const tail = Math.max(0, hrs.end - 1440) * 60000, a = d0.getTime() + tail, b = d1.getTime() + tail;
  const allDay = events.filter((e) => e.allDay && String(e.start).slice(0, 10) <= ymd && ymd < String(e.end || e.start).slice(0, 10))
    .map((e) => ({ kind: "event", allDay: true, ev: e }));
  const timed = events.filter((e) => !e.allDay)
    .map((e) => ({ kind: "event", start: Date.parse(e.start), end: Date.parse(e.end), ev: e }))
    .filter((x) => x.start < b && x.end > a)
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
export function mountSchedule(el, uid, { onEvent, onNew, onOpen, onMissed, onProjects, onWeek, onDay, onNow, onPlan, onShape, mode = "home" } = {}){
  let cal = { status: "loading", events: [] };
  let settings = {};
  let tasks = null; // for Plan my day
  let dayPlan = null; // today's saved plan doc; approved, it sits in today's gaps
  const view = mode === "week" ? "week" : "day";
  const HOUR_PX = mode === "week" ? 60 : 44; // week grid: one hour's height
  const ORBIT_MS = 9000; // one lap of the now row's light (app.css sc-orbit)
  let focus = null; // "YYYY-MM-DD" stepped to; null = today
  // Days outside the week calendar.js fetches (today + 7) come from
  // fetchRange, one stretch at a time, kept until the main calendar changes.
  let extra = { key: null, status: "loading", events: [] };
  const fail = (e) => console.error("[daisey] schedule", e);

  let jump = true; // next render scrolls the week to now (or its first event)
  const go = (ymd) => { focus = ymd; el.scrollTop = 0; jump = true; render(); };

  // The day's now row: the one on, else the first not yet past.
  let toNow = view === "day"; // next render lands the list on now (the Now button, opening Today)
  const nowRow = () => view === "day" && !focus ? el.querySelector(".sc-row.sc-on, .sc-row:not(.sc-past, .sc-gap, .sc-noroom)") : null;
  function scrollToNow(smooth){
    const r = nowRow(), head = el.querySelector(".sc-head");
    if (!r) return;
    const top = el.scrollTop + r.getBoundingClientRect().top - el.getBoundingClientRect().top - (head?.offsetHeight || 0) - 8;
    el.scrollTo({ top: Math.max(0, top), behavior: smooth ? "smooth" : "auto" });
  }
  // Today scrolled so its now row is out of sight shows the Now button too.
  function nowAway(){
    const b = el.querySelector(".sc-today"), r = nowRow();
    if (!b || focus || view !== "day") return;
    const box = el.getBoundingClientRect(), at = r?.getBoundingClientRect(), headH = el.querySelector(".sc-head")?.offsetHeight || 0;
    // Hidden (another page showing), every rect is 0 and the row reads as
    // off-screen: the button flashed up on today. Judge only with a layout.
    const away = !!at && box.height > 0 && (at.bottom < box.top + headH || at.top > box.bottom - 36);
    b.classList.toggle("off", !away); b.tabIndex = away ? 0 : -1;
  }
  let awayQ = 0;
  const awayLater = () => { if (!awayQ) awayQ = requestAnimationFrame(() => { awayQ = 0; nowAway(); }); };
  el.addEventListener("scroll", awayLater, { passive: true });
  // Shown again or resized (Focus grows the card above) re-judges it too.
  const sized = typeof ResizeObserver === "function" ? new ResizeObserver(awayLater) : null;
  sized?.observe(el);

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

  // Drag sideways to change day (week: change week), or the arrows in the bar.
  let stepBy = () => {}, swipe = null;
  el.style.touchAction = "pan-y"; // keep the horizontal drag ours, or the browser cancels it
  // The page follows the finger, then slides off and the next one slides in.
  // The head (arrows, Now, Week) stays put and only the day under it moves, so it feels anchored.
  el.style.overflowX = "hidden"; // the sliding day must not widen the box
  const slide = (x, ms) => {
    for (const c of el.children) {
      if (c.classList.contains("sc-head")) continue;
      c.style.transition = ms ? `transform ${ms}ms ease-out` : "none"; c.style.transform = x ? `translateX(${x}px)` : "";
    }
  };
  // Slide the page off toward `side` (-1 left, 1 right), swap it, slide the new one in.
  const flip = (side, swap) => {
    const out = side * (el.clientWidth || innerWidth);
    slide(out, 140);
    setTimeout(() => { swap(); slide(-out); el.getBoundingClientRect(); slide(0, 180); }, 140);
  };
  el.addEventListener("pointerdown", (e) => { swipe = { x: e.clientX, y: e.clientY, on: false }; });
  el.addEventListener("pointermove", (e) => {
    if (!swipe) return;
    const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
    if (!swipe.on && Math.abs(dx) > 10 && Math.abs(dx) > 1.5 * Math.abs(dy)) {
      swipe.on = true;
      try { el.setPointerCapture(e.pointerId); } catch { /* gone already */ } // a mouse leaving the box still ends the drag
    }
    if (swipe.on) slide(dx * 0.9);
  });
  el.addEventListener("pointerup", (e) => {
    if (!swipe) return;
    const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y, on = swipe.on;
    swipe = null;
    if (!on) return;
    sawSwipe = true; setTimeout(() => { sawSwipe = false; });
    if (Math.abs(dx) < 60 || Math.abs(dx) < 1.5 * Math.abs(dy)) { slide(0, 180); return; }
    const rtl = getComputedStyle(el).direction === "rtl";
    flip(dx < 0 ? -1 : 1, () => stepBy((dx < 0) !== rtl ? 1 : -1));
  });
  el.addEventListener("pointercancel", () => { if (swipe?.on) slide(0, 180); swipe = null; });
  // Capture dropped without an up. Only el's own: a finger's touched row
  // loses its implicit capture the moment el takes it, and that bubbles here.
  el.addEventListener("lostpointercapture", (e) => { if (e.target === el && swipe?.on) { slide(0, 180); swipe = null; } });
  let sawSwipe = false; // the lift after a drag is not a tap
  el.addEventListener("click", (e) => { if (sawSwipe) { e.stopPropagation(); e.preventDefault(); } }, true);

  function render(){
    // After midnight in a day that's still on (late): the day shown is the
    // calendar's, with its own hours, and what's left of tonight sits on top
    // of it (day(); Mor, 2026-10-11).
    const now = Date.now(), real = dayHours(settings);
    if (mode === "home") onShape?.(shape(now));
    const hrs = real.late ? usualHours(settings) : real;
    const today = dayStart(now);
    const at = focus ? ymdToDate(focus) : today;
    const range = view === "week" ? [addDays(at, -at.getDay()), 7] : [at, 1];
    const from = range[0], to = addDays(from, range[1]);
    const got = cal.status === "ok" ? eventsFor(from.getTime(), to.getTime() + Math.max(0, hrs.end - 1440) * 60000) : cal;
    // With the travel legs (trips.js): the way there and back sits on the day
    // as its own quiet block, and the plan treats it as the Now card does.
    const src = got.status === "ok" ? { ...got, events: withTrips(got.events, settings.trips || {}, settings.tripDay || [], settings.laptop ?? null) } : got;
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
    const future = (view === "week" ? from : at).getTime() > today.getTime(); // today lies behind (left)
    // Names count from the day you're in: past midnight, until the sleep
    // boundary, that's still yesterday, so the calendar's today reads
    // Tomorrow, the next day its weekday (night owls, Mor 2026-10-12).
    const named = ymdToDate(logicalDate(now)), night = named < today;
    const dayName = (d) => {
      const w = dayWord(localDate(d.getTime()), now); // the one day word (day.js), same as the card and the header
      // The whole day shows, morning included, so it reads Today, not Tonight
      // (2026-10-11); past midnight it's all behind you: Earlier today (Mor, 2026-10-12).
      return w === "today" ? (night ? "Earlier today" : "Today") : w === "tomorrow" ? "Tomorrow" : w === "yesterday" ? "Yesterday"
        : d.toLocaleDateString("en-GB", { weekday: "long" });
    };
    const last = addDays(to, -1);
    const span = from.getMonth() === last.getMonth()
      ? `${from.getDate()} – ${last.getDate()} ${last.toLocaleDateString("en-GB", { month: "short" })}`
      : `${from.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} – ${last.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`;
    const tonight = real.late && view !== "week" && isNow;
    const title = view === "week" ? (isNow ? "This week" : span) : tonight ? "Tonight" : dayName(at);
    const rel = Math.abs(Math.round((at - named) / 864e5)) <= 1;
    // A weekday title already names the day, so its date line drops it (Mor, 2026-10-12).
    const sub = view === "week" ? (isNow ? span : "") : tonight ? `until ${minText(real.end)}`
      : rel ? short(at) : at.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    // A phone drops the date line, so a plain weekday carries its date ("Wed 15").
    const narrow = view === "week" || rel ? title : `${at.toLocaleDateString("en-GB", { weekday: "short" })} ${at.getDate()}`;

    const weekBtn = h("button", { type: "button", className: "sc-weekbtn", ariaLabel: "Week", onclick: () => onWeek?.() }, icon("calendar"), h("span", { textContent: "Week" }));
    // One row (Mor, 2026-10-07). Today keeps its place (just unseen on
    // today), so the arrows and the switch never shift under the finger.
    // Arrows at both ends (Mor, 2026-10-18) beside the drag: the same step and
    // the same slide as a swipe, so the gesture reads as possible. They sit
    // at the bar's start and end, so in RTL "previous" is on the right.
    const rtl = getComputedStyle(el).direction === "rtl";
    const stepBtn = (n, label) => h("button", { type: "button", className: "sc-step", ariaLabel: label,
      onclick: () => flip(rtl ? n : -n, () => stepBy(n)) }, icon((n < 0) !== rtl ? "back" : "chev"));
    const bar = h("div", { className: "sc-bar" + (isNow ? "" : " away") },
      stepBtn(-1, view === "week" ? "Previous week" : "Previous day"),
      h("button", { type: "button", className: "sc-title" + (isNow ? "" : " away"), ariaLabel: isNow ? title : `${title} — back to today`, onclick: () => go(null) },
        h("span", { className: "sc-name", textContent: title }), h("span", { className: "sc-name sc-name-s", textContent: narrow }), sub && h("span", { className: "sc-date", textContent: sub })),
      // "● Now" (Mor, 2026-10-12): back to the present, not to a date; past
      // midnight "← Today" didn't say which day. Shows while you're away
      // from now: another day, or today scrolled off its now row (nowAway).
      // Another day slides back like a swipe; then the list lands on now.
      h("button", { type: "button", className: "sc-today" + (isNow ? " off" : ""), ariaLabel: "Back to now", tabIndex: isNow ? -1 : 0,
        onclick: () => { const back = view === "week" ? () => go(null) : () => { focus = null; toNow = true; render(); onNow?.(); };
          if (isNow) { scrollToNow(true); onNow?.(); } else flip(future ? 1 : -1, back); } },
        h("span", { className: "sc-pulse", ariaHidden: "true" }), "Now"),
      mode === "home" && onWeek && weekBtn,
      // The plan's way in, on a phone, from the day (CSS shows it only there):
      // Change plan once one is approved (Mor, 2026-10-12); before that the
      // Today key opens this page too, so it offers Plan my day, or Plan the
      // rest once something's done today (Mor, 2026-10-15).
      mode === "home" && onPlan && h("button", { type: "button", className: "sc-weekbtn sc-planbtn", ariaLabel: planWord(now), title: planWord(now), onclick: () => onPlan() }, icon("calendar"), h("span", { textContent: planWord(now) })),
      stepBtn(1, view === "week" ? "Next week" : "Next day"));
    const head = h("div", { className: "sc-head" + (view === "week" ? " wk" : "") }, bar);

    let body;
    if (src.status !== "ok") body = [h("p", { className: "sc-note", textContent: src.status === "loading" ? "Loading…" : "Couldn't load these days." })];
    else if (view === "week") body = week(src.events, from, now, hrs, today, head);
    else body = day(src.events, at, now, hrs, today, real);

    const y = el.scrollTop;
    el.replaceChildren(head, ...body);
    el.scrollTop = y;
    if (toNow && src.status === "ok") { toNow = false; scrollToNow(false); }
    nowAway();
    if (jump && src.status === "ok") {
      jump = false;
      const mark = view === "week" && (el.querySelector(".wk-now") || [...el.querySelectorAll(".wk-ev")].sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0]);
      if (mark) el.scrollTop = Math.max(0, el.scrollTop + mark.getBoundingClientRect().top - el.getBoundingClientRect().top - head.offsetHeight - HOUR_PX);
    }
  }

  // A task's project colour (its area's, failing that) for the event made for
  // it; events with no task keep their calendar colour.
  const tone = (ev) => { const t = ev.taskId && tasks?.find((x) => x.id === ev.taskId); return t ? areaClass(t) : ""; };

  // Today's shape for the home's day ribbon (main.js paintRibbon; Mor,
  // 2026-10-15): the day's hours, what's done (when, what), what the plan
  // still holds, and the calendar's timed events. Today only, whatever day
  // this page shows; null past midnight in a day that's still on.
  function shape(now){
    const hrs = dayHours(settings);
    if (hrs.late || !tasks) return null;
    const today = dayStart(now), start = atMin(today, hrs.start), end = today.getTime() + hrs.end * 60000;
    const events = cal.status === "ok" ? (cal.events || []).filter((e) => !e.allDay && !e.taskId && Date.parse(e.end) > start && Date.parse(e.start) < end)
      .map((e) => ({ start: Math.max(start, Date.parse(e.start)), end: Math.min(end, Date.parse(e.end)), title: e.title || "Busy", color: e.color })) : [];
    const day = planDate(now, hrs), planned = dayPlan?.status === "approved" && dayPlan.date === day;
    const done = tasks.filter((t) => t.status === "done" && t.doneAt && planDate(t.doneAt, hrs) === day).sort((a, b) => a.doneAt - b.doneAt)
      .map((t) => ({ id: t.id, at: t.doneAt, task: t }));
    const left = planned ? planRows(cal.status === "ok" ? cal.events || [] : [], now).filter((r) => r.kind === "plan" && r.end > now && r.task.status !== "done")
      .map((r) => ({ id: r.task.id, at: r.start, end: r.end, task: r.task })) : [];
    return { start, end, now, done, left, events, planned, tasks, word: planWord(now) };
  }

  function planWord(now){
    const hrs = dayHours(settings), day = planDate(now, hrs);
    if (dayPlan?.status === "approved" && dayPlan.date === day) return "Change plan";
    return tasks?.some((t) => t.status === "done" && t.doneAt && planDate(t.doneAt, hrs) === day) ? "Plan the rest" : "Plan my day";
  }

  // Today's approved plan on the clock (derived, never written to the calendar).
  function planRows(events, now){
    const hrs = dayHours(settings); // the clock's, not the shown day's
    if (dayPlan?.status !== "approved" || dayPlan.date !== planDate(now, hrs) || !tasks) return [];
    // Held like the Now card's (proposal.timeline since): a task you haven't
    // started stays at its time, it doesn't slide with the clock.
    const tl = timeline(dayPlan.items || [], { tasks, events, now, hours: hrs, since: planActivity(tasks, dayPlan.approvedAt || 0) });
    noRoom = tl.over.map((o) => ({ kind: "noroom", task: o.task, why: o.why }));
    return [...tl.rows.map((r) => ({ kind: "plan", start: r.start, end: r.end, task: r.task, missed: !!r.missed, of: r.of, minutes: r.minutes })),
      ...tl.breaks.map((b) => ({ kind: "break", start: b.start, end: b.end, type: b.type, name: b.name }))];
  }
  // The plan's tasks with No room today, and why (2026-10-11: a task in the
  // plan never just disappears from Today). Set by planRows.
  let noRoom = [];

  // An approved plan sits inside today's free time (Mor, 2026-10-08): its
  // blocks replace the stretch of gap they cover. Derived, never written to
  // the calendar.
  function withPlan(rows, planned){
    if (!planned.length) return rows;
    const cut = rows.flatMap((x) => {
      if (x.kind !== "free") return [x];
      let parts = [x];
      for (const p of planned) parts = parts.flatMap((f) => [
        { ...f, end: Math.min(f.end, p.start) }, { ...f, start: Math.max(f.start, p.end) }]
        .filter((g) => g.end - g.start >= MIN_FREE * 60000 && (g.end <= p.start || g.start >= p.end)));
      return parts;
    });
    return [...cut, ...planned].sort((a, b) => (a.start ?? -1) - (b.start ?? -1) || (a.kind === "free") - (b.kind === "free"));
  }
  const noRoomRow = (x) => h("div", { className: "sc-row sc-noroom" },
    h("span", { className: "sc-time", textContent: "No room" }),
    h("button", { type: "button", className: "sc-ev sc-plan" + areaClass(x.task), ariaLabel: `No room today: ${x.task.title}, ${x.why}`, onclick: () => onOpen?.(x.task) },
      h("span", { className: "sc-dot" }), h("span", { className: "sc-tt" }, bdi(x.task.title), h("small", { className: "sc-why", textContent: x.why }))));
  // Events and planned rows stay where they are: no dragging (Mor,
  // 2026-10-11). A tap opens one; its edit sheet is the only way to move it.

  // real: the clock's day hours. Late (a day still on past midnight): what's
  // left of tonight first, then the night, then tomorrow — this calendar day
  // (Mor, 2026-10-11: a Saturday schedule under a Sunday clock felt wrong).
  function day(events, date, now, hrs, today, real = hrs){
    const t = date.getTime(), t0 = today.getTime(), tonight = t === t0 && !!real.late;
    // Free time only from now on: none in the past, today's from the clock.
    const fromMs = t < t0 ? addDays(date, 1).getTime() : t === t0 && !tonight ? now : 0;
    noRoom = [];
    const planned = t === t0 ? planRows(events, now) : [];
    const rows = tonight ? dayRows(events, date, hrs, fromMs) : withPlan(dayRows(events, date, hrs, fromMs), planned);
    const ymd = localDate(t);
    const out = [];
    let nx = null;
    if (tonight) {
      const close = dayEndAt(now, real);
      const left = withPlan(dayRows(events.filter((e) => !e.allDay && Date.parse(e.start) < close), date, real, now)
        .filter((x) => x.end > now), planned);
      nx = upNext([...left, ...rows], now);
      out.push(h("section", { className: "sc-day", ariaLabel: "Tonight" },
        ...(left.length ? left.map((x) => row(x, now, x === nx)) : [h("p", { className: "sc-note", textContent: "Nothing left tonight." })])),
        nightDivider(...nightRange({ start: hrs.start, end: real.end })),
        h("div", { className: "sc-label sc-next" }, h("span", { className: "sc-name", textContent: "Tomorrow" }), h("span", { className: "sc-date", textContent: short(date) })));
    }
    // Not on the way somewhere (trips.js): on the 06:10 train the day has begun.
    const riding = events.some((e) => e.trip && Date.parse(e.start) <= now && now < Date.parse(e.end));
    if (t === t0 && !tonight && now < atMin(today, hrs.start) && !riding) out.push(nightDivider(...nightRange(hrs)));
    const none = h("button", { type: "button", className: "sc-none", onclick: () => onNew?.(ymd) },
      h("span", { textContent: "Nothing scheduled" }), h("span", { className: "sc-add", ariaHidden: "true", textContent: "+ Add" }));
    if (!tonight && t === t0) nx = upNext(rows, now);
    out.push(h("section", { className: "sc-day", ariaLabel: short(date) }, ...(rows.length ? rows.map((x) => row(x, now, x === nx)) : [none]),
      ...(tonight ? [] : noRoom.map(noRoomRow))));
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
      // The plan's tasks; its breaks (no task) stay on the day view.
      if (a === t0) for (const p of planRows(events, now).filter((r) => r.kind === "plan")) timed.push({ plan: p, start: p.start, end: p.end, s: (p.start - a) / 60000, e: (p.end - a) / 60000 });
      timed.sort((p, q) => p.s - q.s || q.e - p.e);
      return { d, ymd, allDay, timed: lanes(timed) };
    });
    // The grid spans the day hours, stretched to fit anything outside them.
    const { h0, h1 } = gridSpan(hrs, cols.flatMap((c) => c.timed));
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
      ...Array.from({ length: h1 - h0 }, (_, i) => h("span", { style: `top:${i * HOUR_PX}px` + (i ? "" : ";transform:none"), textContent: pad(h0 + i) })));
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
          col.append(h("button", { type: "button", className: "wk-ev wk-plan" + areaClass(x.plan.task) + (x.plan.missed ? " missed" : x.end <= now ? " past" : x.start <= now ? " on" : ""),
            style: `top:${px(x.s)}px;block-size:${Math.max(18, px(x.e) - px(x.s) - 2)}px;inset-inline-start:${x.lane * w}%;inline-size:calc(${w}% - 2px)`,
            ariaLabel: `Planned: ${x.plan.task.title}, ${short(c.d)} ${time}`, onclick: () => onOpen?.(x.plan.task) },
            h("span", { className: "wk-evt" }, bdi(x.plan.task.title)), x.e - x.s >= 45 && h("span", { className: "wk-evtime", textContent: clock(x.start) })));
          continue;
        }
        const done = /^✓\s*/u.test(x.ev.title), title = done ? x.ev.title.replace(/^✓\s*/u, "") : x.ev.title;
        const tall = x.e - x.s >= 45, time = `${clock(x.start)}–${clock(x.end)}`;
        const w = 100 / x.lanes;
        if (x.ev.trip) { // the way there or back: Daisey's, not the calendar's, so nothing to open
          col.append(h("div", { className: "wk-ev wk-trip" + (x.end <= now ? " past" : x.start <= now ? " on" : ""), role: "img",
            style: `top:${px(x.s)}px;block-size:${Math.max(18, px(x.e) - px(x.s) - 2)}px;inset-inline-start:${x.lane * w}%;inline-size:calc(${w}% - 2px)`,
            ariaLabel: `${title}, ${short(c.d)} ${time}` },
            h("span", { className: "wk-evt", dir: "auto", textContent: title }), tall && h("span", { className: "wk-evtime", textContent: clock(x.start) })));
          continue;
        }
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

  function row(x, now, next = false){
    const time = x.allDay ? "All day" : `${clock(x.start)}–${clock(x.end)}`;
    const until = next ? untilText(x.start - now) : "";
    const tag = (on) => on ? h("span", { className: "sc-nowtag", textContent: "Now" })
      : next && h("span", { className: "sc-nexttag", textContent: `Next · ${until}` });
    const nextCls = next ? " sc-next" : "", nextAria = next ? `Next, in ${until}: ` : "";
    // Free time is quiet (Mor, 2026-10-06: the dashed boxes read as slots to
    // fill): no box, no times, just how long, on a hairline.
    // Tapping it adds an event there.
    if (x.kind === "free") return h("button", { type: "button", className: "sc-row sc-gap", ariaLabel: `Free ${time} — add an event`,
      onclick: () => onNew?.(localDate(x.start), hm(quarterUp(x.start))) },
      h("span", { className: "sc-free" }, `Free · ${durText((x.end - x.start) / 60000)}`, h("span", { className: "sc-add", ariaHidden: "true", textContent: "+" })));
    const on = !x.allDay && x.start <= now && now < x.end;
    const past = !x.allDay && x.end <= now;
    // No clock times: the break pill starts where the event boxes do.
    if (x.kind === "break") return h("div", { className: "sc-row sc-gap sc-break" + (on ? " sc-on" : past ? " sc-past" : ""), ariaLabel: `${time} break` },
      h("span", { className: "sc-free" }, breakText(x, durText((x.end - x.start) / 60000))));
    // The row on right now wears its colour edge to edge (Mor, 2026-10-08).
    // Its orbiting light is phased off the wall clock, so a re-render picks it
    // up where it was instead of jumping back to the start (ORBIT_MS = app.css sc-orbit).
    // How far through it you are shows as a deeper fill: a CSS animation as long
    // as the event, started that far back, so it creeps on with no timer.
    const orbit = on ? `--orbit:-${Date.now() % ORBIT_MS}ms;--dur:${x.end - x.start}ms;--el:-${Date.now() - x.start}ms;` : "";
    // Planned and never started isn't "over" (Mor, 2026-10-10): not dimmed
    // like what happened, and not red either ("negative"): a quiet "?" until
    // it's re-planned.
    if (x.kind === "plan") { const pe = h("div", { className: "sc-row" + (x.missed ? " sc-missed" : on ? " sc-on" + areaClass(x.task) : past ? " sc-past" : nextCls), style: orbit },
      h("span", { className: "sc-time strong" }, time, x.missed ? h("button", { type: "button", className: "sc-misstag", textContent: "?", title: "No Done yet: how did it go?", ariaLabel: `${x.task.title}: no Done yet. How did it go?`, onclick: (e) => onMissed?.(x.task.id, x.start, e.currentTarget.closest(".sc-row")?.querySelector(".sc-ev")) }) : tag(on)),
      h("button", { type: "button", className: "sc-ev sc-plan" + areaClass(x.task), ariaLabel: `${nextAria}Planned: ${x.task.title}, ${time}`, onclick: () => onOpen?.(x.task) },
        h("span", { className: "sc-dot" }), x.of ? h("span", { className: "sc-tt" }, bdi(x.task.title),
          h("small", { className: "sc-why", textContent: `${durText(x.minutes)} of ${durText(x.of)}, shortened to fit` })) : bdi(x.task.title)));
      return pe; }
    // The way to an event in another city and back (trips.js): Daisey's own
    // block, not the calendar's, so it doesn't open, drag or delete.
    if (x.ev?.trip) return h("div", { className: "sc-row" + (on ? " sc-on" : past ? " sc-past" : nextCls), style: orbit },
      h("span", { className: "sc-time strong" }, time, tag(on)),
      h("span", { className: "sc-ev sc-trip", ariaLabel: `${nextAria}${x.ev.title}, ${time}` }, h("span", { className: "sc-evi" }, icon("later")), x.ev.title));
    // A finished task is logged as a "✓ title" event (calendar.js logDone).
    const done = /^✓\s*/u.test(x.ev.title), title = done ? x.ev.title.replace(/^✓\s*/u, "") : x.ev.title;
    // Just added or moved: it drops into place with a glow (Mor, 2026-10-10),
    // phased off when it landed so the write's reload doesn't replay it.
    const land = landedAgo(x.ev);
    const rowEl = h("div", { className: "sc-row" + (on ? " sc-on" + tone(x.ev) : past ? " sc-past" : nextCls) + (land != null ? " sc-land" : "") + (x.ev.leaving ? " sc-leave" : ""),
      style: orbit + (on && x.ev.color ? `--ev:${x.ev.color}` : "") + (land != null ? `--land:-${land}ms;` : "") }, h("span", { className: "sc-time strong" }, time, tag(on)),
      h("button", { type: "button", className: "sc-ev" + (done ? " sc-done" : "") + tone(x.ev), style: x.ev.color ? `--ev:${x.ev.color}` : "",
        ariaLabel: `${done ? "Finished task: " : ""}${on ? "Now: " : nextAria}${title}, ${time}`, onclick: () => onEvent?.(x.ev) },
        done ? h("span", { className: "sc-dot" }) : h("span", { className: "sc-evi" }, icon("calendar")), bdi(title)));
    return rowEl;
  }

  const unsubs = [
    // A changed calendar (a write, a refetch) may change the fetched days too.
    watchCalendar((c) => { cal = c; extra.dirty = true; render(); }),
    watchSettings(uid, (s) => { settings = s || {}; render(); }, fail),
    watchTasks(uid, (ts) => { tasks = ts; render(); }, fail),
    watchProjectColors(() => render()),
    watchDayPlan(uid, (d) => { dayPlan = d || null; render(); }, fail),
  ];
  // Free time shrinks as the clock moves; once a minute is plenty.
  let mark = null;
  const tick = setInterval(() => { const m = Math.floor(Date.now() / 60000); if (m !== mark && !document.hidden) { mark = m; render(); } }, 5000);
  render();
  // Today opened (shown again): back on today, its now row on top (Mor, 2026-10-12).
  const landNow = () => { if (view !== "day") return; focus = null; toNow = true; render(); };
  return { go, landNow, unmount(){ unsubs.forEach((u) => u()); clearInterval(tick); sized?.disconnect(); el.replaceChildren(); } };
}
