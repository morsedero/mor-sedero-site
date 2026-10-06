// What Daisey sends, and when (Mor, 2026-10-06: "do all", no daily limit for
// now). daisey-now-morning calls decide() every 5 minutes for each user:
//
//   brief   the day brief (app/js/brief.js), once a day, at the first run
//           after the day hours start that isn't inside a calendar event
//           (up to BRIEF_WINDOW minutes late)
//   wrap    the evening wrap, once a day, in the last hour of the day hours
//           (not inside an event): what got done, what's still open today.
//           Tapping it opens Daisey's wrap questions (?open=wrap)
//   gap     a busy event just ended and 30+ free minutes follow: the task
//           the Now card would pick for that window, with its why
//   booked  a task's booked slot (day.js bookings) is starting
//   people  up to 45 minutes before an event that names someone a Pending
//           task waits on: "You're waiting on Yuval for: …" (app/js/nudge.js)
//
// Nothing outside the day hours. The picks are the app's own code — engine,
// context, day, needs-list, brief — required from app/js (esbuild bundles
// them; netlify.toml), so the server and the Now card can't disagree. The
// engine reads local time, so the caller sets process.env.TZ to the user's
// zone first.
const { brief, localParts, zoned, MIN } = require("../../app/js/brief.js");
const { collectNeeds } = require("../../app/js/needs-list.js");
const { rank } = require("../../app/js/engine.js");
const { workBase, energyNow } = require("../../app/js/context.js");
const { bookings } = require("../../app/js/day.js");
const { localDate, notYet, durText } = require("../../app/js/model.js");
const { effectiveDue } = require("../../app/js/triage.js");
const { waitingFor, personOf } = require("../../app/js/nudge.js");
const { EVENT_BUFFER } = require("../../app/js/weights.js");

const BRIEF_WINDOW = 240; // minutes after the day starts the brief may still go
const WRAP_BEFORE = 60; // the wrap goes in the day's last hour
const GAP_LOOKBACK = 10; // an event that ended this recently opens a gap
const GAP_MIN = 30; // free minutes worth a nudge
const BOOKED_EARLY = 3, BOOKED_LATE = 10; // minutes around a slot's start
const PEOPLE_BEFORE = 45; // minutes before the meeting
const DEFAULT_TYPES = { brief: true, wrap: true, gap: true, booked: true, people: true };

const isBusy = (e) => !e.allDay && e.busy !== false && e.start && e.end;
const clockIn = (ms, tz) => { const m = localParts(ms, tz).minutes; return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; };
const evKey = (e) => `${e.id || e.title}|${e.end}`;

// rec: the Blobs record (morning.js). events: the agenda around now, or null
// when the calendar can't be read. Returns { out: [message], patch }.
function decide(rec, events, now = Date.now()) {
  const tz = rec.tz || "Asia/Jerusalem";
  const types = { ...DEFAULT_TYPES, ...(rec.notify || {}) };
  const { date, minutes } = localParts(now, tz);
  const start = rec.dayStart ?? 480, end = rec.dayEnd ?? 1320;
  const out = [], patch = {};
  if (minutes < start || minutes >= end) return { out, patch };
  const tasks = rec.tasks || [];
  const evs = events || [];
  const busy = evs.filter(isBusy);
  const current = busy.find((e) => Date.parse(e.start) <= now && now < Date.parse(e.end)) || null;

  if (types.brief && rec.sentOn !== date && minutes < start + BRIEF_WINDOW && !current) {
    const needs = collectNeeds({ tasks, events: evs, calOk: !!events, settings: rec.settings || {}, now }).length;
    const b = brief({ tasks, events, now, tz, dayStart: start, dayEnd: end, needs });
    out.push({ type: "brief", title: b.title, body: b.body, tag: `brief-${date}`, url: "./" });
    patch.sentOn = date;
  }

  if (types.wrap && rec.wrapOn !== date && minutes >= end - WRAP_BEFORE && !current) {
    patch.wrapOn = date;
    const done = tasks.filter((t) => t.status === "done" && t.doneAt && localDate(t.doneAt) === date).length;
    const open = tasks.filter((t) => t.status === "ready" && t.due && !notYet(t, now) && effectiveDue(t, now) <= date);
    const dl = open.filter((t) => t.dateKind === "deadline");
    if (done || open.length) {
      const parts = [];
      if (done) parts.push(`Done today: ${done}.`);
      if (open.length) parts.push(`Still open for today: ${open.length}${dl.length ? `, deadline: ${dl[0].title}${dl.length > 1 ? ` and ${dl.length - 1} more` : ""}` : ""}. Tap to sort them.`);
      else parts.push("Nothing left over.");
      out.push({ type: "wrap", title: "End of the day", body: parts.join(" "), tag: `wrap-${date}`, url: open.length ? "./?open=wrap" : "./" });
    }
  }

  const booked = bookings(tasks, evs, now - BOOKED_LATE * MIN);
  if (types.gap && !current) {
    const ended = busy.filter((e) => { const t = Date.parse(e.end); return t <= now && now - t <= GAP_LOOKBACK * MIN; })
      .sort((a, b) => Date.parse(b.end) - Date.parse(a.end))[0];
    if (ended && rec.gapFor !== evKey(ended)) {
      patch.gapFor = evKey(ended);
      const next = busy.filter((e) => Date.parse(e.start) > now).sort((a, b) => Date.parse(a.start) - Date.parse(b.start))[0];
      const until = Math.min(next ? Date.parse(next.start) : Infinity, zoned(date, end, tz));
      // Room before the next event, as the Now card leaves it (EVENT_BUFFER).
      const free = Math.floor((until - now) / MIN) - (next && Date.parse(next.start) <= until ? EVENT_BUFFER : 0);
      if (free >= GAP_MIN) {
        const r = rank(tasks, {
          now, window: free, nextEvent: next && localDate(Date.parse(next.start)) === date ? next.title : null,
          ...workBase(tasks, now), energy: energyNow({ events: evs, now }).value, intents: rec.settings?.intents || {},
          booked: Object.fromEntries([...booked].map(([id, b]) => [id, b.start])),
        });
        if (r.pick) out.push({ type: "gap", title: `${ended.title} is over`,
          body: `${durText(free)} free. Next: ${r.pick.task.title}. ${r.pick.why}`.trim(), tag: `gap-${evKey(ended)}`, url: "./" });
      }
    }
  }

  if (types.booked) {
    const sent = new Set(rec.bookedSent || []);
    for (const [id, b] of booked) {
      const k = `${id}|${b.start}`;
      if (sent.has(k) || b.start > now + BOOKED_EARLY * MIN || b.start <= now - BOOKED_LATE * MIN) continue;
      sent.add(k);
      const t = tasks.find((x) => x.id === id);
      out.push({ type: "booked", title: "Starts now", body: `${t?.title || b.title}, booked ${clockIn(b.start, tz)}–${clockIn(b.end, tz)}.`, tag: `booked-${k}`, url: "./" });
    }
    if (sent.size !== (rec.bookedSent || []).length) patch.bookedSent = [...sent].slice(-50);
  }

  if (types.people) {
    const sent = new Set(rec.peopleSent || []);
    for (const e of busy) {
      const s = Date.parse(e.start), k = evKey(e);
      if (s <= now || s - now > PEOPLE_BEFORE * MIN || sent.has(k)) continue;
      const hits = waitingFor(e.title, tasks);
      if (!hits.length) continue;
      sent.add(k);
      out.push({ type: "people", title: `${e.title} at ${clockIn(s, tz)}`,
        body: `You're waiting on ${personOf(hits[0].waitingOn)} for: ${hits.map((t) => t.title).join(", ")}.`, tag: `people-${k}`, url: "./" });
    }
    if (sent.size !== (rec.peopleSent || []).length) patch.peopleSent = [...sent].slice(-50);
  }
  return { out, patch };
}

module.exports = { decide, DEFAULT_TYPES };
