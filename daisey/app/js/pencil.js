// The pencil schedule (DAISEY_SPEC "Pencil schedule"): calendar events are
// ink; each free gap of 20+ minutes left today gets one faded suggestion,
// made by running the Now engine for that gap — its length, office hours
// then, the place and energy guesses after the event before it. Same
// engine, two views: the card for now, the pencil for the rest of today.
// PURE: no Firebase, no DOM; the clock is only read as a default.
import * as W from "./weights.js";
import { rank } from "./engine.js";
import { energyNow, placeNow } from "./context.js";
import { effectiveDue } from "./triage.js";
import { localDate, notYet } from "./model.js";

const MIN = 60000;

// Free stretches from now to the end of the waking day, between busy
// timed events. An event marked Free, or all-day, takes no time.
export function gapsToday(events, now = Date.now()){
  const end = new Date(now).setHours(W.ROOM_HOURS.end, 0, 0, 0);
  const busy = events.filter((e) => !e.allDay && e.busy !== false && e.end)
    .map((e) => ({ ...e, s: Date.parse(e.start), e: Date.parse(e.end) }))
    .filter((e) => e.e > now && e.s < end)
    .sort((a, b) => a.s - b.s);
  const gaps = [];
  let cursor = now, prev = busy.find((e) => e.s <= now && e.e > now) || null;
  for (const e of busy) {
    if (e.s > cursor) gaps.push({ start: cursor, end: e.s, next: e.title, after: prev });
    if (e.e > cursor) { cursor = e.e; prev = e; }
  }
  if (cursor < end) gaps.push({ start: cursor, end, next: null, after: prev });
  return gaps.map((g) => ({ ...g, minutes: Math.floor((g.end - g.start) / MIN) }));
}

const key = (g) => new Date(g.start).toTimeString().slice(0, 5);
export const gapKey = key;

// One suggestion per gap of PENCIL_MIN+ minutes. `exclude`: ids never to
// pencil today (dismissed, or already in an accepted block). `swaps`:
// { gapKey: [ids] } passed over in that gap. `currentId`: the task on the
// Now card, which the gap holding "now" shows. `base`: the rest of the
// engine input (areaDone, learnStats, intents, …). `moment`: { energy
// correction, energy history, place correction }.
export function sketch(tasks, events, { now = Date.now(), exclude = [], swaps = {}, currentId = null, base = {}, moment = {} } = {}){
  const used = new Set(exclude);
  const out = [];
  for (const g of gapsToday(events, now)) {
    if (g.minutes < W.PENCIL_MIN) continue;
    const at = g.start;
    const isNow = at <= now;
    // Swapped away in this gap, the card's task gives way like any other.
    const current = isNow && currentId && !used.has(currentId) && !(swaps[key(g)] || []).includes(currentId)
      && tasks.find((t) => t.id === currentId);
    let pick = null;
    if (current) pick = { task: current, why: null };
    else {
      const r = rank(tasks, {
        ...base, now: at, window: Math.min(g.minutes, W.WINDOW_CAP), nextEvent: g.next,
        sessionSkips: [...used, ...(swaps[key(g)] || [])],
        energy: energyNow({ correction: moment.energy, history: moment.history || [], events, now: at }).value,
        place: placeNow({ correction: moment.place, events, now: at }).value,
      });
      pick = r.pick;
    }
    if (!pick) continue;
    const t = pick.task;
    const minutes = Math.min(Math.max(5, (t.size || 0) - (t.spentMinutes || 0)), g.minutes);
    out.push({ gap: g, key: key(g), task: t, minutes, part: (t.size || 0) > g.minutes, why: pick.why || null, isNow });
    used.add(t.id);
  }
  return out;
}

// When an accepted block should start: the gap's start, or — in the gap
// you're in now — the next 5-minute mark.
export function blockStart(p, now = Date.now()){
  if (!p.isNow) return p.gap.start;
  const d = new Date(now); d.setSeconds(0, 0);
  d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5);
  return Math.min(d.getTime(), p.gap.end - p.minutes * MIN);
}

// The morning capacity line: "2 h free today, 8 open. Realistic: 3."
// free: every free minute left today. open: ready tasks dated today or
// earlier (deadlines passed, targets rolled). realistic: how many of those
// fit the free time, deadlines first, then smallest. rest: the ones that
// don't — "Move the rest" sends them to the sweep.
export function capacity(tasks, events, now = Date.now()){
  const free = gapsToday(events, now).reduce((s, g) => s + g.minutes, 0);
  const today = localDate(now);
  const open = tasks.filter((t) => t.status === "ready" && t.due && !notYet(t, now) && effectiveDue(t, now) <= today);
  const left = (t) => Math.max(5, (t.size || 0) - (t.spentMinutes || 0));
  const order = [...open].sort((a, b) => (b.dateKind === "deadline") - (a.dateKind === "deadline") || left(a) - left(b));
  const fit = [];
  let used = 0;
  for (const t of order) if (used + left(t) <= free) { fit.push(t); used += left(t); }
  const fitIds = new Set(fit.map((t) => t.id));
  return { free, open: open.length, realistic: fit.length, rest: order.filter((t) => !fitIds.has(t.id)) };
}
