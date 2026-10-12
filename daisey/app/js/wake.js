// The sleep boundary (night owls, Mor 2026-10-12): the day doesn't end at
// midnight. From 00:00 until you wake (the usual day start, 08:00 unless set)
// it's still "tonight", yesterday's date, and the coming morning is
// "tomorrow" — for the Now card, the Schedule, the plan and Tell Daisey
// alike. One value, set from settings (store.js watchSettings), so every
// label reads the same clock. Was 04:00 until then (model.js LATE_HOUR,
// now only how late a day itself can run). PURE, no imports; model.js
// re-exports it.
let wake = 8 * 60;
export const wakeMin = () => wake;
// "HH:MM" (settings.dayStart); kept between 04:00 and 12:00, else 08:00.
export function setWake(hhmm){
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm ?? "").trim());
  const min = m ? +m[1] * 60 + +m[2] : NaN;
  wake = min >= 4 * 60 && min <= 12 * 60 ? min : 8 * 60;
}
// After midnight and before the boundary: still last night.
export const beforeWake = (ms = Date.now()) => { const d = new Date(ms); return d.getHours() * 60 + d.getMinutes() < wake; };
