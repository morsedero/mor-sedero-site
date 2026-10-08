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
//   meeting a calendar event starts in rec.meetingLead minutes (menu, default
//           10; Mor, 2026-10-08: "didn't send a notification before a
//           meeting"). Every timed busy event that isn't a task's own slot
//           (booked covers those). Comes even while a task runs, and from
//           the lead before the day starts, so a meeting at 08:00 still gets
//           its reminder.
//   miss    a free slot passed with nothing started (app/js/miss.js): the
//           task that was up, with Start / Shorten buttons; once the misses
//           add up (two slots in a row, a third of the day's free time, or
//           today's work no longer fitting) it's the silence check instead —
//           "Rough day?" with Lighter plan / Not today, once a day. Not when Daisey was on screen since
//           (its own banner asked), never alongside a gap or booked
//           suggestion, and not when the calendar can't be read (a meeting
//           would look like idle time).
//
// Reality over plan (app/js/reality.js, 2026-10-06): the snapshot carries
// the running task, and what you're actually doing beats the calendar.
//   - While a task runs (or is paused, still your focus), nothing competes
//     with it: no gap or booked-slot suggestion, the brief and the wrap
//     wait for it to end, a people alert only comes in the last
//     PEOPLE_FOCUS minutes before the meeting.
//   - An event you worked through (a task started or finished during it)
//     isn't busy: it doesn't hold back the brief and its end isn't a gap.
//   - gap and booked name one task, so they carry its id: the notification
//     gets a "Start task" button (sw.js). They expire quickly (ttl), so a
//     phone that was off doesn't get a suggestion for a moment long gone.
//
// Nothing outside the day hours. The picks are the app's own code — engine,
// context, day, needs-list, brief — required from app/js (esbuild bundles
// them; netlify.toml), so the server and the Now card can't disagree. The
// engine reads local time, so the caller sets process.env.TZ to the user's
// zone first.
const { brief, localParts, zoned, MIN } = require("../../app/js/brief.js");
const { collectNeeds } = require("../../app/js/needs-list.js");
const { rank } = require("../../app/js/engine.js");
const { workBase } = require("../../app/js/context.js");
const { bookings } = require("../../app/js/day.js");
const { routineCalendar } = require("../../app/js/routine.js");
const { localDate, notYet, durText } = require("../../app/js/model.js");
const { effectiveDue } = require("../../app/js/triage.js");
const { waitingFor, personOf } = require("../../app/js/nudge.js");
const { EVENT_BUFFER } = require("../../app/js/weights.js");
const { runState, overruled, eventKey } = require("../../app/js/reality.js");
const { missState, silenceText } = require("../../app/js/miss.js");
const { nextPlanned, leftOf } = require("../../app/js/proposal.js");
const { MISS } = require("../../app/js/weights.js");
const { withTrips } = require("../../app/js/trips.js");

const BRIEF_WINDOW = 240; // minutes after the day starts the brief may still go
const WRAP_BEFORE = 60; // the wrap goes in the day's last hour
const GAP_LOOKBACK = 10; // an event that ended this recently opens a gap
const GAP_MIN = 30; // free minutes worth a nudge
const BOOKED_EARLY = 3, BOOKED_LATE = 10; // minutes around a slot's start
const PEOPLE_BEFORE = 45; // minutes before the meeting
const PEOPLE_FOCUS = 15; // ...or this close, while a task is running
const MEETING_LEAD = 10; // minutes before a meeting, unless the menu says otherwise
const GAP_TTL = 30 * 60, BOOKED_TTL = 15 * 60; // seconds a suggestion stays worth delivering
const MISS_TTL = 30 * 60, SILENCE_TTL = 60 * 60;
const DEFAULT_TYPES = { brief: true, wrap: true, gap: true, booked: true, people: true, meeting: true, miss: true };

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
  const tasks = rec.tasks || [];
  // With the travel legs (trips.js): "starts in 15 min" names the train to
  // the meeting, and no gap opens while you're on the way back.
  const evs = withTrips(events || [], rec.settings?.trips || {}, rec.settings?.tripDay || null);

  const lead = rec.meetingLead ?? MEETING_LEAD;
  if (types.meeting && minutes >= start - lead && minutes < end) {
    const sent = new Set(rec.meetingSent || []);
    const slots = new Set([...bookings(tasks, evs, now)].map(([, b]) => `${b.start}|${b.title}`));
    for (const e of evs) {
      if (!isBusy(e) || e.taskId) continue;
      const s = Date.parse(e.start), k = evKey(e);
      if (s <= now || s - now > lead * MIN || sent.has(k) || slots.has(`${s}|${e.title}`)) continue;
      sent.add(k);
      out.push({ type: "meeting", title: e.title, body: `Starts at ${clockIn(s, tz)}, in ${durText(Math.max(1, Math.round((s - now) / MIN)))}.`,
        tag: `meeting-${k}`, url: "./", ttl: Math.max(60, Math.round((s - now) / 1000)) });
    }
    if (sent.size !== (rec.meetingSent || []).length) patch.meetingSent = [...sent].slice(-50);
  }

  if (minutes < start || minutes >= end) return { out, patch };
  const focus = runState(rec.run, tasks, now); // "running" | "paused" | null
  const over = overruled(evs, { tasks, run: rec.run, now });
  const busy = evs.filter((e) => isBusy(e) && !over.has(eventKey(e)));
  const current = busy.find((e) => Date.parse(e.start) <= now && now < Date.parse(e.end)) || null;

  if (types.brief && rec.sentOn !== date && minutes < start + BRIEF_WINDOW && !current && !focus) {
    const needs = collectNeeds({ tasks, events: evs, calOk: !!events, settings: rec.settings || {}, now }).length;
    const b = brief({ tasks, events, now, tz, dayStart: start, dayEnd: end, needs, dayplan: rec.dayplan || null, run: rec.run || null });
    out.push({ type: "brief", title: b.title, body: b.body, tag: `brief-${date}`, url: "./" });
    patch.sentOn = date;
  }

  if (types.wrap && rec.wrapOn !== date && minutes >= end - WRAP_BEFORE && !current && !focus) {
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
      // Already on something: the gap is spoken for. Still marked as
      // handled above, so it doesn't arrive late once the task ends.
      if (free >= GAP_MIN && !focus) {
        const r = rank(tasks, {
          now, window: free, nextEvent: next && localDate(Date.parse(next.start)) === date ? next.title : null,
          ...workBase(tasks, now),
          booked: Object.fromEntries([...booked].map(([id, b]) => [id, b.start])),
          routineCal: routineCalendar(tasks, evs, now), // routine sessions already on the calendar
        });
        // "After X", not "X is over": the calendar says it ended, not you.
        if (r.pick) out.push({ type: "gap", title: `After ${ended.title}`, taskId: r.pick.task.id, ttl: GAP_TTL,
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
      if (focus) continue; // you're on something else (or on this): the plan yields
      const t = tasks.find((x) => x.id === id);
      out.push({ type: "booked", title: "Starts now", body: `${t?.title || b.title}, booked ${clockIn(b.start, tz)}–${clockIn(b.end, tz)}.`, tag: `booked-${k}`, url: "./",
        ...(t && t.status === "ready" ? { taskId: id } : {}), ttl: BOOKED_TTL });
    }
    if (sent.size !== (rec.bookedSent || []).length) patch.bookedSent = [...sent].slice(-50);
  }

  if (types.miss && events && !out.some((m) => m.type === "gap" || m.type === "booked")) {
    const planAt = rec.plan?.date === date ? rec.plan.at || 0 : 0;
    const st = missState({ tasks, events: evs, run: rec.run, now, hours: { start, end }, planAt, silenceOn: rec.settings?.silenceOn || null });
    const sent = new Set(rec.missSent || []);
    if (st && !sent.has(st.key)) {
      sent.add(st.key);
      patch.missSent = [...sent].slice(-20);
      // Daisey was on screen since it came (or is now): the banner asked.
      const shown = rec.seenAt && (rec.seenAt >= st.at || now - rec.seenAt < MISS.seen * MIN);
      const m = !shown && missMessage(st, { rec, tasks, busy, booked, date, end, now, tz });
      if (m) out.push(m);
    }
  }

  if (types.people) {
    const sent = new Set(rec.peopleSent || []);
    for (const e of busy) {
      const s = Date.parse(e.start), k = evKey(e);
      if (s <= now || s - now > (focus ? PEOPLE_FOCUS : PEOPLE_BEFORE) * MIN || sent.has(k)) continue;
      const hits = waitingFor(e.title, tasks);
      if (!hits.length) continue;
      sent.add(k);
      const body = `You're waiting on ${personOf(hits[0].waitingOn)} for: ${hits.map((t) => t.title).join(", ")}.`;
      // Its meeting reminder goes this same run: one notification, not two.
      const same = out.find((m) => m.tag === `meeting-${k}`);
      if (same) { same.body += ` ${body}`; continue; }
      out.push({ type: "people", title: `${e.title} at ${clockIn(s, tz)}`, body, tag: `people-${k}`, url: "./",
        ttl: Math.max(60, Math.round((s - now) / 1000)) });
    }
    if (sent.size !== (rec.peopleSent || []).length) patch.peopleSent = [...sent].slice(-50);
  }
  return { out, patch };
}

// The miss / silence notification, or null when there's nothing to name.
function missMessage(st, { rec, tasks, busy, booked, date, end, now, tz }) {
  const ready = tasks.filter((t) => t.status === "ready" && !notYet(t, now));
  if (!ready.length) return null;
  if (st.kind === "silence") {
    return { type: "silence", title: "Rough day?", ttl: SILENCE_TTL, tag: `silence-${date}`, url: "./?open=lighter", date,
      body: silenceText(st, (ms) => clockIn(ms, tz)),
      actions: [{ action: "lighter", title: "Lighter plan" }, { action: "quiet", title: "Not today" }] };
  }
  // The task that was up: the approved plan's next one, else the Now card's pick.
  const plan = rec.plan?.date === date ? { status: "approved", date, items: (rec.plan.ids || []).map((taskId) => ({ taskId })) } : null;
  let task = tasks.find((t) => t.id === nextPlanned(plan, tasks, date, now));
  if (!task) {
    const next = busy.filter((e) => Date.parse(e.start) > now).sort((a, b) => Date.parse(a.start) - Date.parse(b.start))[0];
    const until = Math.min(next ? Date.parse(next.start) : Infinity, zoned(date, end, tz));
    const r = rank(tasks, { now, window: Math.max(5, Math.floor((until - now) / MIN)), nextEvent: null, ...workBase(tasks, now),
      booked: Object.fromEntries([...booked].map(([id, b]) => [id, b.start])) });
    task = r.pick?.task;
  }
  if (!task) return null;
  const shorter = leftOf(task) > 5;
  return { type: "miss", title: task.title, taskId: task.id, ttl: MISS_TTL, tag: `miss-${st.start}`, url: "./",
    body: `Up since ${clockIn(st.start, tz)} and not started. Start it${shorter ? ", shorten it," : ""} or tap to move it.`,
    actions: [{ action: "start", title: "Start" }, ...(shorter ? [{ action: "shorten", title: "Shorten" }] : [])] };
}

module.exports = { decide, DEFAULT_TYPES };
