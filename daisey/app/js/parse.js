// One sentence → the fields of a task. PURE: no DOM, no network, and the
// clock only as a default argument, so the node tests drive it directly.
//
// This is the local stand-in for the Gemini parser (V1_PLAN.md session 7).
// It reads what it can — a length, a day, a project it already knows — and
// leaves the rest to model.js's own guesses. Whatever it gets wrong is shown
// on the confirm card before anything is written, so being approximate is
// fine; being silent about it would not be.
//
// Hebrew and English both, because Mor writes both in one line.
import { localDate } from "./model.js";

const DAYS = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
  sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6,
  ראשון: 0, שני: 1, שלישי: 2, רביעי: 3, חמישי: 4, שישי: 5, שבת: 6,
};
// Longest first, so "thurs" isn't swallowed by "thu" and "דקות" by "דק".
const HOURS = "hours|hour|hrs|hr|h|שעות|שעה";
const MINUTES = "minutes|minute|mins|min|m|דקות|דקה|דק";
const DAY_NAMES = Object.keys(DAYS).sort((a, b) => b.length - a.length).join("|");

// \b is useless here: Hebrew letters are not \w, so /\bמחר\b/ never matches
// the way it looks like it should. This is the Unicode-aware equivalent.
const rx = (src) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${src})(?![\\p{L}\\p{N}])`, "iu");
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const clean = (s) => s.replace(/\s{2,}/g, " ").replace(/^[\s,.;:·\-–—]+|[\s,.;:·\-–—]+$/g, "").trim();

// Cuts what matched out of the line, so "mix 2h thursday" leaves "mix".
function take(text, re){
  const m = text.match(re);
  return m ? { match: m, rest: text.slice(0, m.index) + " " + text.slice(m.index + m[0].length) } : { match: null, rest: text };
}

// A weekday name means the next one coming; today doesn't count.
function nextWeekday(day, now){
  const d = new Date(now);
  d.setDate(d.getDate() + ((day - d.getDay() + 7) % 7 || 7));
  return localDate(d.getTime());
}

export function parseTask(input, { projects = [], now = Date.now() } = {}){
  let rest = String(input || "").trim();
  const found = [];
  if (!rest) return { title: "", project: null, size: null, due: null, found };

  // How long: "90 min", "1.5h", "שעתיים". A length the user stated is kept
  // as stated; only Daisey's own guesses snap to the buckets in model.js.
  let size = null;
  const hours = take(rest, rx(`(\\d+(?:[.,]\\d+)?)\\s*(?:${HOURS})`));
  if (hours.match) { size = Math.round(parseFloat(hours.match[1].replace(",", ".")) * 60); rest = hours.rest; }
  else {
    const mins = take(rest, rx(`(\\d+)\\s*(?:${MINUTES})`));
    if (mins.match) { size = Number(mins.match[1]); rest = mins.rest; }
    else {
      const two = take(rest, rx("שעתיים"));
      if (two.match) { size = 120; rest = two.rest; }
    }
  }
  if (size != null) found.push("size");

  // When: today, tomorrow, or a weekday.
  let due = null;
  const today = take(rest, rx("today|היום"));
  const tomorrow = take(rest, rx("tomorrow|מחר"));
  const weekday = take(rest, rx(`(?:on\\s+|ב)?(?:יום\\s+)?(${DAY_NAMES})`));
  if (today.match) { due = localDate(now); rest = today.rest; }
  else if (tomorrow.match) { due = localDate(now + 864e5); rest = tomorrow.rest; }
  else if (weekday.match) { due = nextWeekday(DAYS[weekday.match[1].toLowerCase()], now); rest = weekday.rest; }
  if (due) found.push("due");

  // Which project: one Daisey already knows, named anywhere in the line.
  // Longest first, so "Monster Punk" wins over a project called "Punk".
  let project = null;
  for (const name of [...projects].sort((a, b) => b.length - a.length)) {
    const hit = take(rest, rx(`#?${escape(name)}`));
    if (hit.match) { project = name; rest = hit.rest; found.push("project"); break; }
  }

  // Whatever is left is the title, minus a preposition the cut left dangling.
  const title = clean(rest.replace(/(?:^|\s)(?:for|in|by|due|on|עד|של)\s*$/iu, ""));
  // Nothing recognisable left: the line was the title all along.
  return title ? { title, project, size, due, found } : { title: clean(String(input)), project: null, size: null, due: null, found: [] };
}
