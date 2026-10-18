// The ONE day boundary (Mor, 2026-10-18). PURE and import-free, so model.js
// and routine.js (which model.js imports) can both read it.
//
// The day switches at a FIXED 04:00 (the sleep boundary; was 08:00 until 2026-10-18), not at midnight and
// NOT at Settings' "My day" start: that only sets the planning window and the
// Night pill (day.js dayHours). From midnight until 04:00 it is still last
// night: "today" is the day that began yesterday, and that stretch is
// "tonight". Everything that asks "which day is it" goes through getDayKey. A
// day itself can run on past midnight (Tell Daisey "I can work until 1am", a
// usual end up to 04:00, day.js dayHours).
const pad = (n) => String(n).padStart(2, "0");

export function localDate(ms = Date.now()){
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const DAY_BOUNDARY = 4 * 60; // minutes after midnight, fixed
const minuteOfDay = (ms) => { const d = new Date(ms); return d.getHours() * 60 + d.getMinutes(); };
export const lastNight = (ms = Date.now()) => minuteOfDay(ms) < DAY_BOUNDARY;
export const back1 = (ms) => { const d = new Date(ms); d.setDate(d.getDate() - 1); return d.getTime(); };
// The day you're in, "YYYY-MM-DD". 03:59 → yesterday's, 04:00 → today's.
export const getDayKey = (ms = Date.now()) => localDate(lastNight(ms) ? back1(ms) : ms);

// A day string n days on, by the calendar ("2026-10-17", 1 → "2026-10-18").
export const addDaysTo = (ymd, n) => { const [y, m, d] = ymd.split("-").map(Number); return localDate(new Date(y, m - 1, d + n, 12).getTime()); };
// The day a spoken day word means, counted from the day you're in (getDayKey,
// the same key the cards use): at 01:51 Sunday "today" is Saturday, the day
// that began at 04:00, "yesterday" Friday, "tomorrow" Sunday. Hebrew too.
// null for a word that isn't one.
const DAY_WORDS = { yesterday: -1, today: 0, tonight: 0, tomorrow: 1, tmrw: 1, "אתמול": -1, "היום": 0, "הלילה": 0, "מחר": 1, "מחרתיים": 2 };
export function dateForWord(word, now = Date.now()){
  const n = DAY_WORDS[String(word ?? "").trim().toLowerCase()];
  return n == null ? null : addDaysTo(getDayKey(now), n);
}
