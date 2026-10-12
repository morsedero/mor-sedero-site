// Tell Daisey with its helper offline (user test 2026-10-11: "lunch with Dana
// at 13:00 for an hour" became a task title). A sentence with a clock time in
// it reads as an event: tell.js offers it as one, with "Add as a task" still
// there. PURE: no DOM, no Firebase.
//
// Understands a time ("at 13:00", "13:30", "1pm", "at 9"), a length ("for an
// hour", "for 90 min", "for 1.5 hours", "for half an hour"; else an hour),
// and a day ("today", "tonight", "this morning", "tomorrow", a weekday; else
// today). Day words follow the 04:00 switch (model.js LATE_HOUR, night owls, Mor
// 2026-10-12): at 03:00 "tomorrow" is the morning you wake into, the one the
// Now card calls Tomorrow first, not the day after it. The rest, tidied,
// is the title. → { kind: "event", title, date, time, minutes } or null.
import { localDate, dayAfter, LATE_HOUR } from "./model.js";

const pad = (n) => String(n).padStart(2, "0");
const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

export function eventFrom(text = "", now = Date.now()){
  let s = ` ${String(text).replace(/\s+/g, " ").trim()} `;
  const cut = (re) => { const m = s.match(re); if (m) s = s.replace(re, " "); return m; };

  // The time: a colon, am/pm, or "at" before a bare hour.
  const t = cut(/\s(?:at\s+|@\s*)?(\d{1,2}):(\d{2})\s*(am|pm)?(?=[\s.,!?]|$)/i)
    || cut(/\s(?:at\s+|@\s*)?(\d{1,2})()\s*(am|pm)(?=[\s.,!?]|$)/i)
    || cut(/\s(?:at|@)\s*(\d{1,2})()()(?=[\s.,!?]|$)/i);
  if (!t) return null;
  let h = parseInt(t[1], 10);
  const m = t[2] ? parseInt(t[2], 10) : 0, ap = (t[3] || "").toLowerCase();
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  if (!ap && !t[2] && h < 8) h += 12; // "at 3" in a working day means 15:00
  if (h > 23 || m > 59) return null;

  // How long.
  let minutes = 60;
  const len = cut(/\sfor\s+(an?|one|half an|\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m)\b/i)
    || cut(/\sfor\s+(half an)\s+(hour)\b/i);
  if (len) {
    const n = /^half/i.test(len[1]) ? 0.5 : /^(an?|one)$/i.test(len[1]) ? 1 : parseFloat(len[1]);
    minutes = Math.round(/^h/i.test(len[2]) ? n * 60 : n);
  }
  minutes = Math.max(5, Math.min(minutes, 12 * 60));

  // Which day.
  let date = localDate(now);
  if (cut(/\s(tomorrow|tmrw)\b/i)) date = dayAfter(1, now);
  else if (cut(/\s(?:today|this morning)\b/i)) date = localDate(now);
  else if (cut(/\stonight\b/i)) {
    // Tonight runs on past midnight until 04:00: "tonight at 1am" is
    // the small hours after this evening; one already over is the next one.
    date = dayAfter(h < LATE_HOUR ? 1 : 0, now);
    if (Date.parse(`${date}T${pad(h)}:${pad(m)}`) < now) date = dayAfter(1, Date.parse(`${date}T12:00`));
  }
  else {
    const w = cut(new RegExp(`\\s(?:on\\s+|this\\s+|next\\s+)?(${DAYS.join("|")})\\b`, "i"));
    if (w) {
      const want = DAYS.indexOf(w[1].toLowerCase()), d = new Date(now);
      d.setDate(d.getDate() + (((want - d.getDay()) + 7) % 7 || 7));
      date = localDate(d.getTime());
    }
  }

  const title = s.replace(/\s(on|at|for|from)\s*$/i, " ").replace(/^[\s,.\-–]+|[\s,.\-–]+$/g, "").replace(/\s+/g, " ");
  if (!title) return null;
  return { kind: "event", title: title[0].toUpperCase() + title.slice(1), date, time: `${pad(h)}:${pad(m)}`, minutes };
}
