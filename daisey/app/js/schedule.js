// The Schedule panel: what Google Calendar says a day holds. One day at a
// time, with ‹ › to step up to a week ahead (Mor, 2026-10-04: today and
// tomorrow stacked in one card was both too much and not enough). Read-only
// — Daisey never writes to the calendar in v1.
//
// The same read as the Now card's free window (calendar.js), so the panel
// and the greeting can never disagree. Events already finished are kept, in
// grey, because a day you can't see the start of is hard to place yourself in.
import { watchCalendar } from "./calendar.js";
import { localDate } from "./model.js";
import { h, bdi, dur } from "./ui.js";

const clock = (iso) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const NOTE = {
  loading: "Checking the calendar…",
  not_connected: "Calendar not connected. Sign in to the old Daisey once to link it.",
  needs_reauth: "Calendar sign-in expired. Sign in to the old Daisey again.",
  error: "Couldn't reach the calendar.",
};

// Each event, plus the gap before it, so the free stretches are visible —
// that is what the panel is for. `from` is where the day's clock starts:
// now, for today. Tomorrow has no "now", so it shows no opening gap —
// "7 h 59 min free" before a 10:00 rehearsal is noise, not information.
function dayRows(events, now, from){
  const rows = [];
  let cursor = from;
  for (const e of events) {
    const start = Date.parse(e.start), end = Date.parse(e.end || e.start);
    if (!e.allDay && cursor != null && start > cursor) {
      const gap = Math.round((start - cursor) / 60000);
      if (gap >= 15) rows.push({ gap, minutes: gap });
    }
    rows.push({ event: e, past: !e.allDay && end <= now, running: !e.allDay && start <= now && end > now });
    if (!e.allDay) cursor = Math.max(cursor, end);
  }
  return rows;
}

const DAYS_AHEAD = 7; // as far as the step arrows go, and as far as the fetch reaches

// "Today", "Tomorrow", then the weekday and date.
function dayLabel(offset, date){
  if (offset === 0) return "Today";
  if (offset === 1) return "Tomorrow";
  return new Date(date).toLocaleDateString([], { weekday: "long", day: "numeric", month: "short" });
}

export function mountSchedule(root){
  let cal = { status: "loading", events: [] };
  let offset = 0; // days from today

  function day(now){
    const when = new Date(now); when.setDate(when.getDate() + offset);
    const date = localDate(when.getTime());
    const events = cal.events.filter((e) => localDate(Date.parse(e.start)) === date)
      .sort((a, b) => (a.allDay === b.allDay ? Date.parse(a.start) - Date.parse(b.start) : a.allDay ? -1 : 1));
    // Only today has a "now" to measure the first gap from.
    const rows = dayRows(events, now, offset === 0 ? now : null);
    return h("section", { className: "sch-day" },
      rows.length === 0
        ? h("p", { className: "muted sch-free", textContent: "Nothing on the calendar." })
        : h("ul", { className: "sch-list" }, ...rows.map((r) => r.gap
          ? h("li", { className: "sch-gap", textContent: `${dur(r.minutes)} free` })
          : h("li", { className: "sch-row" + (r.past ? " past" : "") + (r.running ? " running" : "") },
            h("span", { className: "sch-time", textContent: r.event.allDay ? "all day" : clock(r.event.start) }),
            h("span", { className: "sch-title" }, bdi(r.event.title),
              r.running && h("span", { className: "sch-now", textContent: "now" }))))));
  }

  const step = (by, label, disabled) => h("button", {
    className: "sch-step", type: "button", textContent: by < 0 ? "‹" : "›", ariaLabel: label, disabled,
    onclick: () => { offset = Math.min(DAYS_AHEAD, Math.max(0, offset + by)); render(); },
  });

  function render(){
    const now = Date.now();
    const when = new Date(now); when.setDate(when.getDate() + offset);
    root.replaceChildren(...[
      h("header", { className: "sch-nav" },
        step(-1, "The day before", offset === 0),
        h("h2", { className: "sch-head", textContent: dayLabel(offset, when.getTime()) }),
        step(1, "The day after", offset === DAYS_AHEAD)),
      NOTE[cal.status] && h("p", { className: "muted sch-note" }, NOTE[cal.status],
        ["not_connected", "needs_reauth"].includes(cal.status) ? h("a", { href: "/daisey/", textContent: " Open old Daisey" }) : null),
      cal.status === "ok" && day(now),
      cal.status === "ok" && offset > 0 && h("button", { className: "btn quiet sch-today", type: "button",
        textContent: "Back to today", onclick: () => { offset = 0; render(); } }),
    ].filter(Boolean));
  }

  const unsub = watchCalendar((c) => { cal = c; render(); });
  // Keep "now", the greying of finished events and the gaps honest.
  const tick = setInterval(() => { if (!document.hidden && cal.status === "ok") render(); }, 60000);
  const onVisible = () => { if (!document.hidden) render(); };
  document.addEventListener("visibilitychange", onVisible);
  root.hidden = false;
  render();

  return {
    unmount(){ unsub(); clearInterval(tick); document.removeEventListener("visibilitychange", onVisible); root.replaceChildren(); root.hidden = true; },
  };
}
