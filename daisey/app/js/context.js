// Place for the Now card's chip (DAISEY_SPEC "Read the moment"). PURE.
//
// Place: your correction in the last 3 hours; else the phone's location
// (where.js: home, out, walk, ride, train, bus, car, spot:<name>); else Out
// while an event with a location runs or just after it; else Home.
// (Energy lived here until 2026-10-07; it was dropped on purpose.)
import * as W from "./weights.js";
import { localDate } from "./model.js";

const HOUR = 3600000, MIN = 60000;
const fresh = (c, now) => !!c && ["home", "out", "anywhere"].includes(c.value) && now - c.at < W.CORRECTION_HOURS * HOUR;

export function placeNow({ correction = null, located = null, events = [], now = Date.now() } = {}){
  if (fresh(correction, now) && ["home", "out", "anywhere"].includes(correction.value)) return { value: correction.value, guessed: false };
  if (String(located).startsWith("spot:")) return { value: "spot", spot: located.slice(5), guessed: false, located: true };
  // A trip leg running (trips.js): its mode, unless the phone says otherwise.
  // A ride the phone can't name takes the leg's mode.
  const leg = events.find((e) => e.trip && Date.parse(e.start) <= now && now < Date.parse(e.end));
  // The leg's place, not its mode: a train without the laptop is a bus.
  const ride = leg && (leg.trip.place || leg.trip.mode);
  if (leg && located === "ride") return { value: ride, guessed: true, trip: leg.trip };
  if (W.PLACES.includes(located) && !["anywhere", "spot"].includes(located)) return { value: located, guessed: false, located: true };
  if (leg) return { value: ride, guessed: true, trip: leg.trip };
  const out = events.some((e) => {
    if (e.allDay || !e.location) return false;
    const start = Date.parse(e.start), end = Date.parse(e.end);
    return start <= now && now < end + W.OUT_AFTER_MINUTES * MIN;
  });
  return { value: out ? "out" : "home", guessed: true };
}

// Each project's tier, { name: tier } (projects.js publishes it as it
// paints). Every engine caller gets it through workBase, so the card, the
// plan and night mode all rank by the same tiers.
let tiers = {};
const tierSubs = new Set();
export function setProjectTiers(map){
  if (JSON.stringify(map) === JSON.stringify(tiers)) return;
  tiers = map;
  tierSubs.forEach((cb) => cb());
}
export function watchProjectTiers(cb){ tierSubs.add(cb); return () => tierSubs.delete(cb); }

// What the engine needs from the task history, shared by the Now card and
// night mode so the two can't disagree: momentum (the project last worked
// on today, those worked on in the last 2 days) and the area balance (tasks
// finished this week, from Sunday, per area). "Worked on" means started,
// timed or finished, by when that happened (workedAt) — not touchedAt, which
// an edit or a skip also moves, so a project skipped today read as "keeps it
// going". Tasks from before workedAt count by their finish time only.
export function workBase(tasks = [], now = Date.now()){
  const today = localDate(now);
  const when = (t) => t.workedAt || t.doneAt || 0;
  const worked = tasks.filter((t) => when(t) && when(t) <= now).sort((a, b) => when(b) - when(a));
  const week = new Date(now); week.setHours(0, 0, 0, 0); week.setDate(week.getDate() - week.getDay());
  const areaDone = {};
  for (const t of tasks) if (t.status === "done" && t.doneAt >= week.getTime() && t.area) areaDone[t.area] = (areaDone[t.area] || 0) + 1;
  return {
    lastProject: worked.find((t) => localDate(when(t)) === today)?.project || null,
    recentProjects: worked.filter((t) => now - when(t) < W.MOMENTUM.recentDays * 864e5).map((t) => t.project),
    areaDone,
    projectTiers: tiers,
  };
}
