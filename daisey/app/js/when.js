// A day in the user's own words → YYYY-MM-DD, worked out here and not by the
// helper (phrase bank 2026-10-19: "on the 25th" said on Oct 26 came back as
// the 25th, already gone; "in 3 days" got no date at all). The helper copies
// the words (dateWords); this counts from the day key (daybound.js), so every
// word follows the same fixed 04:00 boundary as the cards. PURE.
//
// → { date } · { ask: [day, day] } when the words fit two days · null when
// they aren't a day it knows (the helper's own date stands then).
//
// Asks only for "tomorrow" with a clock time, said after midnight before
// 04:00 ("call Dana tomorrow at 8" at 03:44: the morning you wake into, or
// the one after?). Without a time, "tomorrow" is the day key's next day, as
// everywhere else. "Next Thursday" asks this coming one or the one after,
// unless today is Thursday.
import { getDayKey, addDaysTo, lastNight } from "./daybound.js";

const EN_DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const HE_DAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const NUMS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  "שניים": 2, "שני": 2, "שתיים": 2, "שלושה": 3, "שלוש": 3, "ארבעה": 4, "ארבע": 4, "חמישה": 5, "חמש": 5, "שישה": 6, "שש": 6, "שבעה": 7, "שבע": 7, "עשרה": 10 };
const NUM = `(\\d+|${Object.keys(NUMS).join("|")})`;
const num = (s) => (/^\d+$/.test(s) ? Number(s) : NUMS[s]);
// A whole word, Hebrew too (\b only knows ASCII); Hebrew may carry a one-letter prefix (ב, ל, ו, ה, מ).
const W = (src) => new RegExp(`(?<![\\p{L}\\d])(?:[בלוהמ]?)(?:${src})(?![\\p{L}\\d])`, "u");

const weekday = (ymd) => new Date(`${ymd}T12:00`).getDay();
const pad = (n) => String(n).padStart(2, "0");
const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const daysIn = (y, m) => new Date(y, m, 0).getDate(); // m 1-12

export function dateFrom(words, now = Date.now(), { timed = false } = {}){
  const s = ` ${String(words || "").toLowerCase().replace(/[,!?]/g, " ").replace(/\s+/g, " ").trim()} `;
  if (!s.trim()) return null;
  const key = getDayKey(now);
  const [Y, M, D] = key.split("-").map(Number);
  const wd = weekday(key);
  const on = (n) => ({ date: addDaysTo(key, n) });
  let m;

  if ((m = s.match(/(\d{4})-(\d{2})-(\d{2})/))) return { date: m[0] };
  if (W("day after tomorrow|מחרתיים").test(s)) return on(2);
  if (W("tomorrow|tmrw|מחר").test(s)) return timed && lastNight(now) ? { ask: [addDaysTo(key, 1), addDaysTo(key, 2)] } : on(1);
  if (W("yesterday|אתמול").test(s)) return on(-1);

  // in N days / weeks, N weeks from today, a week from today; בעוד N ימים, יומיים, שבוע, שבועיים
  if ((m = s.match(new RegExp(` in ${NUM} (days?|weeks?) `)) || s.match(new RegExp(` ${NUM} (days?|weeks?) from (?:today|now) `)))) {
    return on(num(m[1]) * (m[2].startsWith("week") ? 7 : 1));
  }
  if (W("in a (week|fortnight)|a week from (today|now)").test(s)) return on(/fortnight/.test(s) ? 14 : 7);
  if ((m = s.match(W(`בעוד ${NUM} (ימים|שבועות)`)))) return on(num(m[1]) * (m[2] === "שבועות" ? 7 : 1));
  if (W("(?:בעוד|עוד) (יומיים|שבועיים|שבוע|יום)").test(s)) {
    const w = s.match(/(יומיים|שבועיים|שבוע|יום)/)[1];
    return on({ "יום": 1, "יומיים": 2, "שבוע": 7, "שבועיים": 14 }[w]);
  }

  // ends: the day, the week (Saturday, weights.js), the month
  if (W("end of (?:the )?day|סוף היום|today|tonight|this evening|היום|הלילה|הערב").test(s)) return on(0);
  if (W("end of (?:the |this )?week|סוף השבוע|סוף שבוע").test(s)) return on(6 - wd);
  if (W("end of (?:the |this )?month|סוף החודש").test(s)) return { date: ymd(Y, M, daysIn(Y, M)) };
  // next week, no day: the coming Sunday (the chat prompt's rule)
  if (W("next week|(?:ה)?שבוע הבא").test(s)) return on((7 - wd) % 7 || 7);

  // a weekday: this coming one (today counts); "next" asks, unless it's today's
  const en = EN_DAYS.findIndex((d) => W(`${d}|${d.slice(0, 3)}`).test(s));
  const heM = s.match(W(`(?:יום )(${HE_DAYS.join("|")})|(שבת)`));
  const want = en >= 0 ? en : heM ? HE_DAYS.indexOf(heM[1] || heM[2]) : -1;
  if (want >= 0) {
    const ahead = (want - wd + 7) % 7;
    if (W("next|הבא|הבאה").test(s)) return ahead === 0 ? on(7) : { ask: [addDaysTo(key, ahead), addDaysTo(key, ahead + 7)] };
    return on(ahead);
  }

  // a month and day: "Oct 25", "25 October", "25/10", "25.10" → this year, else next
  const mon = MONTHS.findIndex((x) => W(`${x}[a-z]*`).test(s));
  if (mon >= 0 && (m = s.match(/(\d{1,2})(?:st|nd|rd|th)?/))) return nextOf(mon + 1, Number(m[1]), key);
  if ((m = s.match(/(?<!\d)(\d{1,2})[/.](\d{1,2})(?![\d/.])/))) return nextOf(Number(m[2]), Number(m[1]), key);

  // a day of the month: "the 25th", "on the 3rd", "ב-25" → this month, or next if it's gone
  if ((m = s.match(/(?:the |on |ב-?|^ )(\d{1,2})(?:st|nd|rd|th)?(?: (?:of the month|לחודש))?(?= )/)) && Number(m[1]) >= 1 && Number(m[1]) <= 31) {
    const d = Number(m[1]);
    if (d >= D && d <= daysIn(Y, M)) return { date: ymd(Y, M, d) };
    const [y2, m2] = M === 12 ? [Y + 1, 1] : [Y, M + 1];
    return d <= daysIn(y2, m2) ? { date: ymd(y2, m2, d) } : null;
  }
  return null;
}

function nextOf(month, day, key){
  const y = Number(key.slice(0, 4));
  if (month < 1 || month > 12 || day < 1 || day > daysIn(y, month)) return null;
  const date = ymd(y, month, day);
  return { date: date >= key ? date : ymd(y + 1, month, Math.min(day, daysIn(y + 1, month))) };
}
