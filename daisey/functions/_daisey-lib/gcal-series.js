// A change to one day of a repeating Google Calendar event, carried to the
// days Google's own dialog asks about (Mor, 2026-10-09: "just like this, to
// affect Google Calendar"): "This event" is the plain PATCH or DELETE on the
// one occurrence and never comes here; "This and following events" and "All
// events" do.
//
// All events: the series' own event (the master) takes the change. A move is
// the same shift the user gave this day, so moving Tuesday's 10:00 to 11:00
// moves every week to 11:00, and a weekly rule's days shift with it.
//
// This and following: what Google does too, a split. The series is ended the
// second before this day, and a copy of it, with the change, starts here and
// runs on to where the series used to end. On the first day there is nothing
// before to keep, so it is All events.
//
// Timed events only; the event sheet never offers all-day ones for editing.
// Returns null when the event turns out not to repeat (the caller does the
// plain write), else { res, id? }: the last Google response, for the caller's
// usual error mapping, and the new series' id after a split.
const DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// RFC 5545 UTC stamp: 2026-10-09T08:00:00Z -> 20261009T080000Z.
const stamp = (ms) => new Date(ms).toISOString().replace(/\.\d{3}/, "").replace(/[-:]/g, "");

// The weekday of an instant where the series lives, 0 = Sunday.
const weekday = (ms, tz) => SHORT.indexOf(new Intl.DateTimeFormat("en-US", { weekday: "short", ...(tz ? { timeZone: tz } : {}) }).format(new Date(ms)));

// The series' rule lines, changed: a weekly rule's days moved by `shift`
// (Tuesdays moved a day are Wednesdays), the count dropped (`noCount`, for
// a copy that starts part-way), or the end set to `until`.
function rules(lines, { shift = 0, noCount = false, until = null } = {}){
  return (lines || []).map((line) => {
    if (!/^RRULE:/i.test(line)) return line;
    let parts = line.slice(6).split(";").filter(Boolean);
    const weekly = parts.some((p) => /^FREQ=WEEKLY$/i.test(p));
    if (shift && weekly) {
      parts = parts.map((p) => (!/^BYDAY=/i.test(p) ? p : "BYDAY=" + p.slice(6).split(",").map((d) => {
        const m = d.match(/^([+-]?\d*)(SU|MO|TU|WE|TH|FR|SA)$/i);
        return m ? m[1] + DAYS[(DAYS.indexOf(m[2].toUpperCase()) + shift + 7) % 7] : d;
      }).join(",")));
    }
    if (noCount || until) parts = parts.filter((p) => !/^COUNT=/i.test(p));
    if (until) parts = parts.filter((p) => !/^UNTIL=/i.test(p)).concat(`UNTIL=${until}`);
    return "RRULE:" + parts.join(";");
  });
}

// What a split copies from the series: everything the user set, nothing
// Google owns (ids, links, stamps, the organiser).
const KEEP = ["summary", "description", "location", "colorId", "transparency", "visibility", "reminders",
  "extendedProperties", "attendees", "guestsCanModify", "guestsCanInviteOthers", "guestsCanSeeOtherGuests", "source"];

// scope: "following" | "all". change: { title?, start?, end?, remove? },
// start/end ISO with an offset, both or neither. location: a string sets it
// ("" clears), null keeps it.
async function changeSeries({ base, headers, eventId, scope, title, start, end, location = null, remove }){
  const at = (id) => `${base}/${encodeURIComponent(id)}`;
  let res = await fetch(at(eventId), { headers });
  if (!res.ok) return { res };
  const inst = await res.json();
  if (!inst.recurringEventId) return null;
  res = await fetch(at(inst.recurringEventId), { headers });
  if (!res.ok) return { res };
  const master = await res.json();
  if (!master.start?.dateTime || !inst.start?.dateTime) return { res: { ok: false, status: 400 } };

  const tz = master.start.timeZone || inst.start.timeZone;
  const was = Date.parse(inst.originalStartTime?.dateTime || inst.start.dateTime);
  if (scope === "following" && was <= Date.parse(master.start.dateTime)) scope = "all";

  if (scope === "all") {
    if (remove) return { res: await fetch(at(master.id), { method: "DELETE", headers }) };
    const patch = { ...(title ? { summary: title } : {}), ...(location !== null ? { location } : {}) };
    if (start) {
      const from = Date.parse(master.start.dateTime) + Date.parse(start) - Date.parse(inst.start.dateTime);
      const to = from + Date.parse(end) - Date.parse(start);
      const shift = weekday(from, tz) - weekday(Date.parse(master.start.dateTime), tz);
      patch.start = { dateTime: new Date(from).toISOString(), ...(tz ? { timeZone: tz } : {}) };
      patch.end = { dateTime: new Date(to).toISOString(), ...(master.end?.timeZone || tz ? { timeZone: master.end?.timeZone || tz } : {}) };
      if (shift) patch.recurrence = rules(master.recurrence, { shift });
    }
    return { res: await fetch(at(master.id), { method: "PATCH", headers, body: JSON.stringify(patch) }) };
  }

  // Following. The copy first: if Google refuses it, the series is untouched
  // rather than cut short with nothing to carry on.
  const cut = { recurrence: rules(master.recurrence, { until: stamp(was - 1000) }) };
  let id = null;
  if (!remove) {
    const from = start ? Date.parse(start) : Date.parse(inst.start.dateTime);
    const to = start ? Date.parse(end) : Date.parse(inst.end.dateTime);
    const copy = Object.fromEntries(KEEP.filter((k) => master[k] !== undefined).map((k) => [k, master[k]]));
    if (title) copy.summary = title;
    if (location !== null) copy.location = location;
    copy.start = { dateTime: new Date(from).toISOString(), ...(tz ? { timeZone: tz } : {}) };
    copy.end = { dateTime: new Date(to).toISOString(), ...(tz ? { timeZone: tz } : {}) };
    copy.recurrence = rules(master.recurrence, { shift: weekday(from, tz) - weekday(was, tz), noCount: true });
    res = await fetch(base, { method: "POST", headers, body: JSON.stringify(copy) });
    if (!res.ok) return { res };
    id = (await res.json().catch(() => ({}))).id || null;
  }
  res = await fetch(at(master.id), { method: "PATCH", headers, body: JSON.stringify(cut) });
  return { res, id };
}

module.exports = { changeSeries, rules, stamp };
