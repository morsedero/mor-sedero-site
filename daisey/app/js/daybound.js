// The ONE day boundary (Mor, 2026-10-18). PURE and import-free, so model.js
// and routine.js (which model.js imports) can both read it.
//
// The day switches at the start of the active day (Settings "My day" start,
// default 08:00), not at midnight. From midnight until then it is still last
// night: "today" is the day that began yesterday, and that stretch is
// "tonight". Everything that asks "which day is it" goes through getDayKey;
// the Night pill, the clock's date and the day words all derive from the same
// minute (setDayBoundary, fed from settings by store.js watchSettings;
// day.js dayBoundaryOf). A day itself can run on past midnight (Tell Daisey
// "I can work until 1am", a usual end up to 04:00, day.js dayHours).
const pad = (n) => String(n).padStart(2, "0");

export function localDate(ms = Date.now()){
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const DEFAULT_DAY_BOUNDARY = 8 * 60;
export let DAY_BOUNDARY = DEFAULT_DAY_BOUNDARY; // minutes after midnight; a live binding
export function setDayBoundary(min){
  DAY_BOUNDARY = Number.isInteger(min) && min >= 0 && min < 1440 ? min : DEFAULT_DAY_BOUNDARY;
}
const minuteOfDay = (ms) => { const d = new Date(ms); return d.getHours() * 60 + d.getMinutes(); };
export const lastNight = (ms = Date.now()) => minuteOfDay(ms) < DAY_BOUNDARY;
export const back1 = (ms) => { const d = new Date(ms); d.setDate(d.getDate() - 1); return d.getTime(); };
// The day you're in, "YYYY-MM-DD". 07:59 → yesterday's, 08:00 → today's.
export const getDayKey = (ms = Date.now()) => localDate(lastNight(ms) ? back1(ms) : ms);
