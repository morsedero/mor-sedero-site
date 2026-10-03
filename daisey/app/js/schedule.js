// The Schedule panel: what Google Calendar says today and tomorrow hold.
// Read-only — Daisey never writes to the calendar in v1 — and it sits in the
// slider next to the Now card, so "what's on?" is a swipe rather than
// another app.
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

export function mountSchedule(root){
  let cal = { status: "loading", events: [] };

  function group(label, date, now, today){
    const events = cal.events.filter((e) => localDate(Date.parse(e.start)) === date)
      .sort((a, b) => (a.allDay === b.allDay ? Date.parse(a.start) - Date.parse(b.start) : a.allDay ? -1 : 1));
    const rows = dayRows(events, now, today ? now : null);
    return h("section", { className: "sch-day" },
      h("h3", { className: "sch-h", textContent: label }),
      rows.length === 0
        ? h("p", { className: "muted sch-free", textContent: "Nothing on the calendar." })
        : h("ul", { className: "sch-list" }, ...rows.map((r) => r.gap
          ? h("li", { className: "sch-gap", textContent: `${dur(r.minutes)} free` })
          : h("li", { className: "sch-row" + (r.past ? " past" : "") + (r.running ? " running" : "") },
            h("span", { className: "sch-time", textContent: r.event.allDay ? "all day" : clock(r.event.start) }),
            h("span", { className: "sch-title" }, bdi(r.event.title),
              r.running && h("span", { className: "sch-now", textContent: "now" }))))));
  }

  function render(){
    const now = Date.now();
    root.replaceChildren(...[
      h("header", { className: "tk-head" }, h("h2", { className: "sch-head", textContent: "Schedule" })),
      NOTE[cal.status] && h("p", { className: "muted sch-note" }, NOTE[cal.status],
        ["not_connected", "needs_reauth"].includes(cal.status) ? h("a", { href: "/daisey/", textContent: " Open old Daisey" }) : null),
      cal.status === "ok" && group("Today", localDate(now), now, true),
      cal.status === "ok" && group("Tomorrow", localDate(now + 864e5), now, false),
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
