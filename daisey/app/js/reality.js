// Reality over plan (Mor, 2026-10-06; DAISEY_SPEC "Reality over plan").
// A calendar event, a booked slot or a Daisey plan is a prediction. What you
// actually do — real work logged on a task — is evidence, and evidence wins.
// The Now card (now.js) and the notifications (notify.js, on the server)
// read the day through these, so both adapt to what really happened without
// asking you. (There is no Start or running timer any more, 2026-10-20:
// Daisey can't see you working, only what you log.)

const ms = (v) => (typeof v === "number" ? v : Date.parse(v));

// The calendar events reality has overruled, by eventKey. A busy timed event
// that has started stops counting as "what's happening" when real work was
// logged after it began (Done or kept time sets the task's workedAt). Then
// the Now card doesn't wait behind it, its time counts as free, and its end
// isn't announced as "X is over". Events still ahead are never overruled: a
// plan for later is still the best guess about later.
// Evidence older than the event's last edit (`updated`) doesn't count
// (Mor, 2026-10-08): an event added or moved onto time already worked says
// what the user is doing NOW, so it's newer than the work and wins.
export const eventKey = (e) => `${e.id || e.title}|${ms(e.start)}`;
export function overruled(events, { tasks = [], now = Date.now() } = {}){
  const work = Math.max(0, ...(tasks || []).map((t) => t.workedAt || 0));
  const out = new Set();
  for (const e of events || []) {
    if (e.allDay || e.busy === false) continue;
    const s = ms(e.start), end = ms(e.end), edit = e.updated ? ms(e.updated) || 0 : 0;
    if (!(s <= now)) continue;
    if (work >= Math.max(s, edit) && work < end) out.add(eventKey(e));
  }
  return out;
}
