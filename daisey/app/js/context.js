// Energy and place for the Now card's two chips (DAISEY_SPEC "Energy
// guessing and learning", "Read the moment"). PURE.
//
// Energy, strongest signal first: your correction in the last 3 hours; else
// the average of your past corrections at this time of day (once there are
// 5), else Medium — then one step lower if a long or draining calendar
// event ended in the last hour.
// Place: your correction in the last 3 hours; else Out while an event with
// a location runs or just after it; else Home.
import * as W from "./weights.js";
import { timeBucket } from "./engine.js";

const HOUR = 3600000, MIN = 60000;
const fresh = (c, now) => !!c && W.ENERGY_LEVELS.concat(["home", "out", "anywhere"]).includes(c.value) && now - c.at < W.CORRECTION_HOURS * HOUR;

// history: [{ part, weekend, value }] — past energy corrections.
export function energyNow({ correction = null, history = [], events = [], now = Date.now() } = {}){
  if (fresh(correction, now) && W.ENERGY_LEVELS.includes(correction.value)) return { value: correction.value, guessed: false };
  const b = timeBucket(now);
  const same = history.filter((h) => h.part === b.part && h.weekend === b.weekend && W.ENERGY_LEVELS.includes(h.value));
  let lvl = 1; // medium
  if (same.length >= W.ENERGY_PATTERN_MIN) {
    lvl = Math.round(same.reduce((s, h) => s + W.ENERGY_LEVELS.indexOf(h.value), 0) / same.length);
  }
  const drained = events.some((e) => {
    if (e.allDay) return false;
    const start = Date.parse(e.start), end = Date.parse(e.end);
    if (!(end <= now && now - end <= W.DRAIN.withinMinutes * MIN)) return false;
    const title = String(e.title || "").toLowerCase();
    return end - start >= W.DRAIN.longMinutes * MIN || W.DRAIN.words.some((w) => title.includes(w));
  });
  if (drained) lvl = Math.max(0, lvl - 1);
  return { value: W.ENERGY_LEVELS[lvl], guessed: true, drained };
}

export function placeNow({ correction = null, events = [], now = Date.now() } = {}){
  if (fresh(correction, now) && ["home", "out", "anywhere"].includes(correction.value)) return { value: correction.value, guessed: false };
  const out = events.some((e) => {
    if (e.allDay || !e.location) return false;
    const start = Date.parse(e.start), end = Date.parse(e.end);
    return start <= now && now < end + W.OUT_AFTER_MINUTES * MIN;
  });
  return { value: out ? "out" : "home", guessed: true };
}
