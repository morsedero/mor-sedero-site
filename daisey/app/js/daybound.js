// The ONE day boundary (Mor, 2026-10-18). PURE and import-free, so model.js
// and routine.js (which model.js imports) can both read it.
//
// The day switches at a FIXED 08:00 (the sleep boundary), not at midnight and
// NOT at Settings' "My day" start: that only sets the planning window and the
// Night pill (day.js dayHours). From midnight until 08:00 it is still last
// night: "today" is the day that began yesterday, and that stretch is
// "tonight". Everything that asks "which day is it" goes through getDayKey. A
// day itself can run on past midnight (Tell Daisey "I can work until 1am", a
// usual end up to 04:00, day.js dayHours).
const pad = (n) => String(n).padStart(2, "0");

export function localDate(ms = Date.now()){
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const DAY_BOUNDARY = 8 * 60; // minutes after midnight, fixed
const minuteOfDay = (ms) => { const d = new Date(ms); return d.getHours() * 60 + d.getMinutes(); };
export const lastNight = (ms = Date.now()) => minuteOfDay(ms) < DAY_BOUNDARY;
export const back1 = (ms) => { const d = new Date(ms); d.setDate(d.getDate() - 1); return d.getTime(); };
// The day you're in, "YYYY-MM-DD". 07:59 → yesterday's, 08:00 → today's.
export const getDayKey = (ms = Date.now()) => localDate(lastNight(ms) ? back1(ms) : ms);
