// Israeli holidays offices close for, in any year, worked out from the
// Hebrew calendar the browser already has (Intl's "hebrew" calendar) — no
// dated list to keep up to date (Mor, 2026-10-04). Which holidays: HOLIDAYS
// in weights.js. PURE.
import { HOLIDAYS, INDEPENDENCE_DAY, OFFICE } from "./weights.js";
import { localDate } from "./model.js";

const fmt = new Intl.DateTimeFormat("en-u-ca-hebrew", { month: "long", day: "numeric" });
const cache = new Map();

const hebrew = (d) => {
  const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.month} ${p.day}`;
};

// "YYYY-MM-DD" set of the year's office-closing holidays.
export function holidaysOf(year){
  if (cache.has(year)) return cache.get(year);
  const out = new Set();
  for (const d = new Date(year, 0, 1, 12); d.getFullYear() === year; d.setDate(d.getDate() + 1)) {
    const name = hebrew(d);
    if (HOLIDAYS.includes(name)) out.add(localDate(d.getTime()));
    if (name === INDEPENDENCE_DAY) {
      // Moved off Friday/Saturday to the Thursday before, off Monday to Tuesday.
      const shift = { 5: -1, 6: -2, 1: 1 }[d.getDay()] || 0;
      out.add(localDate(d.getTime() + shift * 864e5));
    }
  }
  cache.set(year, out);
  return out;
}

export const isHoliday = (ms) => holidaysOf(new Date(ms).getFullYear()).has(localDate(ms));

// A day offices open at all: Sunday–Thursday and not a holiday.
export const officeDay = (ms) => OFFICE.days.includes(new Date(ms).getDay()) && !isHoliday(ms);

// Open right now?
export function officeOpen(ms){
  const h = new Date(ms).getHours();
  return officeDay(ms) && h >= OFFICE.open && h < OFFICE.close;
}

// Minutes until offices close today (0 when closed).
export function officeMinutesLeft(ms){
  if (!officeOpen(ms)) return 0;
  const close = new Date(ms); close.setHours(OFFICE.close, 0, 0, 0);
  return Math.floor((close.getTime() - ms) / 60000);
}
