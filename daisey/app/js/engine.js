// The Now engine, in three gates (DAISEY_SPEC "Now engine logic"):
//   Gate 1 — can it be done now?        filterOut
//   Gate 2 — what does leaving it cost? deadline, target, stakes, priority, area, neglect
//   Gate 3 — does it fit this gap?      window, momentum, batch, learned, skips
// then a why line from the factors that gave the most.
// PURE: no Firebase, no DOM. The clock is only read as a default, and all
// dates are local time, so the node tests in daisey/test/v1/ drive it with
// fixed moments. Every number lives in weights.js.
import * as W from "./weights.js";
import { localDate, durText, notYet, leftMinutes, progressOf, LABELS } from "./model.js";
import { effectiveDue } from "./triage.js";
import { officeOpen, officeMinutesLeft } from "./holidays.js";

const MIN = 60000;
const DAY = 86400000;
// Every scoring factor, in why-line tie order (earlier wins a tie).
const FACTORS = ["deadline", "stakes", "office", "progress", "batch", "spot", "priority", "area", "target", "window", "momentum", "neglect", "learned"];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const key = (p) => String(p || "").trim().toLowerCase();
const pad = (n) => String(n).padStart(2, "0");

// ---------- Step 1: the moment ----------

export function timeBucket(now = Date.now()){
  const d = new Date(now), h = d.getHours();
  return {
    part: h < W.AFTERNOON_FROM ? "morning" : h < W.EVENING_FROM ? "afternoon" : "evening",
    weekend: W.WEEKEND_DAYS.includes(d.getDay()),
  };
}

// The free window from the calendar's busy events ({ title, start, end },
// ISO strings, sorted). In an event → 0 until it ends. Else minutes until
// the next one, less EVENT_BUFFER (readMoment caps it). restOfDay: nothing else today.
// `until` (ms): the end of the day hours — free time stops there too.
export function freeWindow(events, now = Date.now(), until = null){
  const ev = events.map((e) => ({ ...e, title: e.title, start: Date.parse(e.start), end: Date.parse(e.end) }));
  const current = ev.find((e) => e.start <= now && now < e.end) || null;
  if (current) return { window: 0, current, next: null, restOfDay: false };
  const next = ev.find((e) => e.start > now) || null;
  const restOfDay = !next || localDate(next.start) !== localDate(now);
  // EVENT_BUFFER: leave room before the next event (2026-10-06).
  let window = next ? Math.max(0, Math.floor((next.start - now) / MIN) - W.EVENT_BUFFER) : W.WINDOW_CAP;
  if (until != null) window = Math.max(0, Math.min(window, Math.floor((until - now) / MIN)));
  return { window, current: null, next: restOfDay ? null : next, restOfDay };
}

// The project a calendar event is a block for: its title equals a project's
// name, or holds it as whole words ("Daisey work" → Daisey). Longest name
// wins, so "Monster Punk audio" beats a project called "Monster". Inbox
// never counts. Case-insensitive; Hebrew prefix letters aren't stripped.
export function matchProject(title, projects){
  const words = String(title || "").toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  let best = null;
  for (const p of new Set(projects)) {
    const name = String(p || "").trim();
    if (!name || name.toLowerCase() === "inbox") continue;
    const pw = name.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
    if (!pw.length) continue;
    const hit = words.some((_, i) => pw.every((w, j) => words[i + j] === w));
    if (hit && (!best || name.length > best.length)) best = name;
  }
  return best;
}

// Everything the engine knows about right now. All optional:
//   window          free minutes (no calendar → 60), capped at 180
//   realWindow      false = the window is a stand-in: it still filters what
//                   fits, but earns no window-fit points
//   nextEvent       title of the next calendar event ("fits before teaching")
//   place           home · out · anywhere · walk · ride · train · bus · car
//                   · spot (a saved place other than Home; `spot` names it)
//                   (where.js; default anywhere)
//   blockProject    a calendar block named after a project: only its tasks
//   lastProject     project last started or finished today
//   recentProjects  projects worked on in the last 2 days
//   projectRanks    project names in the Projects page's order, top first
//   areaDone        { area: tasks worked this week } — area balance
//   sessionSkips    ids hidden by Not now this session
//   skipsToday      { id: count } — the skip penalty
//   learnStats      { "type|bucket": { starts, skips } } — learned fit
//   booked          { id: slot start ms } — booked tasks wait for their slot
export function readMoment(input = {}){
  const now = input.now ?? Date.now();
  const w = Number(input.window);
  return {
    now,
    today: localDate(now),
    window: clamp(Number.isFinite(w) && input.window !== "" && input.window != null ? Math.round(w) : W.NO_CALENDAR_WINDOW, 0, W.WINDOW_CAP),
    realWindow: input.realWindow !== false,
    nextEvent: input.nextEvent || null,
    bucket: timeBucket(now),
    place: W.PLACES.includes(input.place) ? input.place : "anywhere",
    officeOpen: officeOpen(now),
    officeLeft: officeMinutesLeft(now),
    blockProject: input.blockProject ? key(input.blockProject) : null,
    spot: W.PLACES.includes(input.place) && input.place === "spot" && input.spot ? String(input.spot) : null,
    lastProject: input.lastProject || null,
    recentProjects: (input.recentProjects || []).map(key),
    projectRanks: (input.projectRanks || []).map(key).filter((p) => p && p !== "inbox"),
    areaDone: input.areaDone || {},
    sessionSkips: new Set(input.sessionSkips || []),
    skipsToday: input.skipsToday || {},
    learnStats: input.learnStats || {},
    booked: input.booked || {},
  };
}

// ---------- Gate 1: can it be done now? ----------

// The minutes a task can have now: the window, cut short at 16:00 for a
// task that needs offices open.
const windowFor = (task, m) => (task.openHours === "office" ? Math.min(m.window, m.officeLeft) : m.window);

// Why a task can't be offered right now, or null if it can.
export function filterOut(task, m){
  if (task.status === "done" || task.status === "dropped") return "done";
  if (task.status === "waiting") return "waiting";
  // Started, then waiting for a reply (2026-10-07): nothing to do on it until
  // the reply comes, so it isn't offered. The running card still shows it.
  if (task.onHold) return "waiting";
  if (task.status === "someday") return "someday";
  if ((task.skipsSinceStart || 0) >= W.STALE_SKIPS && !deadlineWithin(task, m.now, W.STALE_KEEP_DEADLINE_DAYS)) return "stale";
  if (notYet(task, m.now)) return "notyet";
  if (m.booked[task.id] > m.now) return "booked";
  if (m.sessionSkips.has(task.id)) return "skipped";
  if (m.blockProject && key(task.project) !== m.blockProject) return "block";
  if ((task.notAt || []).includes(m.place)) return "place"; // said "Not here" on a skip
  if ((W.PLACE_BLOCKS[m.place] || []).includes(task.where) && !(m.place === "car" && W.DRIVING_TYPES.includes(task.type))) return "place";
  if (task.openHours === "office" && !m.officeOpen) return "office";
  if (task.openHours === "evening" && new Date(m.now).getHours() < W.EVENING_FROM) return "evening";
  const w = windowFor(task, m);
  if (leftMinutes(task) > w && !(task.canSplit && w >= W.SPLIT_MIN_WINDOW)) return "size";
  return null;
}

// ---------- Gate 2: what does leaving it cost? ----------

const dateParts = (s) => s.split("-").map(Number);

export function daysUntil(due, now){
  const [y, mo, d] = dateParts(due), [ty, tm, td] = dateParts(localDate(now));
  return Math.round((Date.UTC(y, mo - 1, d) - Date.UTC(ty, tm - 1, td)) / DAY);
}

// A real deadline this many days away or fewer (passed counts).
export const deadlineWithin = (task, now, days) =>
  task.dateKind === "deadline" && !!task.due && daysUntil(task.due, now) <= days;

export function dueAt(task){
  const [y, mo, d] = dateParts(task.due);
  const [hh, mm] = task.dueTime ? task.dueTime.split(":").map(Number) : [23, 59];
  return new Date(y, mo - 1, d, hh, mm).getTime();
}

// A real deadline: past or today 35, within 2 days 25, within 7 days 12 —
// counted that many days earlier for big work still to do (DEADLINE_LEAD_PER_DAY).
function deadline(task, m){
  if (!task.due || task.dateKind !== "deadline") return { points: 0, detail: null };
  const days = daysUntil(task.due, m.now);
  const passed = days < 0 || (days === 0 && !!task.dueTime && m.now >= dueAt(task));
  const left = leftMinutes(task), lead = Math.max(0, Math.ceil(left / W.DEADLINE_LEAD_PER_DAY) - 1);
  const eff = days - lead;
  const D = W.DEADLINE;
  return { points: eff <= 0 ? D.today : eff <= 2 ? D.within2 : eff <= 7 ? D.within7 : 0, detail: { days, passed, lead, left } };
}

// A target (wish date): today or past 8, within 3 days 4. A passed target
// counts as today's (triage.effectiveDue) and never grows past that.
function target(task, m){
  if (!task.due || task.dateKind === "deadline") return { points: 0, detail: null };
  const days = daysUntil(effectiveDue(task, m.now), m.now);
  return { points: days <= 0 ? W.TARGET.today : days <= 3 ? W.TARGET.within3 : 0, detail: { days } };
}

function stakes(task){
  return { points: W.STAKES[task.stakes] || 0, detail: { kind: task.stakes } };
}

// The area furthest behind gets up to 12: how little the area got this week
// compared with the busiest one. An even week gives nobody points.
export function areaBalance(task, m, areas){
  const a = task.area;
  if (!a || !areas.length) return { points: 0, detail: null };
  const done = (x) => m.areaDone[x] || 0;
  const counts = areas.map(done), max = Math.max(...counts), min = Math.min(...counts);
  if (max === min) return { points: 0, detail: null };
  return { points: Math.round(W.AREA_BALANCE_MAX * (max - done(a)) / (max - min)), detail: { area: a, done: done(a) } };
}

// The project's place on the Projects page (Mor, 2026-10-08: the ones on top
// get more attention): the top one PRIORITY_MAX, the last none, evenly
// between. The Inbox, a task with no project and a lone project get none.
function priority(task, m){
  const n = m.projectRanks.length, i = m.projectRanks.indexOf(key(task.project));
  if (n < 2 || i < 0) return { points: 0, detail: null };
  return { points: Math.round(W.PRIORITY_MAX * (n - 1 - i) / (n - 1)), detail: { rank: i + 1 } };
}

// Days since real work (Start, time, Done: workedAt), else since it was
// added. Not touchedAt: a skip, Later or an edit moves that, so a task you
// kept dodging read as freshly looked after (2026-10-06).
function neglect(task, m){
  const since = task.workedAt ?? task.createdAt ?? task.touchedAt ?? m.now;
  const days = Math.max(0, Math.floor((m.now - since) / DAY));
  return { points: Math.min(W.NEGLECT_MAX, days * W.NEGLECT_PER_DAY), detail: { days } };
}

// ---------- Gate 3: does it fit this gap? ----------


function windowFit(task, m){
  if (!m.realWindow) return { points: 0, detail: null };
  const w = windowFor(task, m);
  const r = w > 0 ? leftMinutes(task) / w : Infinity;
  const fit = r > 1 ? "piece" : r >= 0.5 ? "full" : r >= 0.25 ? "half" : "small";
  return { points: W.WINDOW_FIT[fit], detail: { fit, window: w, nextEvent: m.nextEvent } };
}

function momentum(task, m){
  const p = key(task.project);
  if (m.lastProject && p === key(m.lastProject)) return { points: W.MOMENTUM.lastToday, detail: { kind: "today" } };
  if (m.recentProjects.includes(p)) return { points: W.MOMENTUM.recent, detail: { kind: "recent" } };
  return { points: 0, detail: null };
}

// Batches: for each batch type, the offerable tasks of it, smallest first,
// as many as fit the window together (max BATCH.max). Two or more → each
// gets the batch bonus. Returns Map(task id → { type, ids, minutes }).
export function findBatches(tasks, m){
  const out = new Map();
  for (const type of W.BATCH.types) {
    const pool = tasks.filter((t) => t.type === type).sort((a, b) => leftMinutes(a) - leftMinutes(b));
    const ids = [];
    let minutes = 0;
    for (const t of pool) {
      if (ids.length >= W.BATCH.max || minutes + leftMinutes(t) > windowFor(t, m)) break;
      ids.push(t.id); minutes += leftMinutes(t);
    }
    if (ids.length >= W.BATCH.min) for (const id of ids) out.set(id, { type, ids, minutes });
  }
  return out;
}

function batch(task, batches){
  const b = batches.get(task.id);
  return b ? { points: W.BATCH.bonus, detail: b } : { points: 0, detail: null };
}

// How often tasks of this type were started vs skipped at this time of day.
// At a saved place (Studio, Gym…): a task that names it, in its project or
// title, belongs there. Same idea as the old Daisey's place labels.
function spot(task, m){
  const s = key(m.spot);
  if (!s || !(key(task.project).includes(s) || key(task.title).includes(s))) return { points: 0, detail: null };
  return { points: W.SPOT_POINTS, detail: { name: m.spot } };
}

function learned(task, m){
  const s = m.learnStats[`${task.type}|${m.bucket.part}`];
  if (!s) return { points: 0, detail: null };
  const starts = s.starts || 0, skips = s.skips || 0;
  const v = W.LEARNED_MAX * (starts - skips) / (starts + skips + W.LEARNED_DAMP);
  return { points: clamp(Math.round(v), W.LEARNED_MIN, W.LEARNED_MAX), detail: { bucket: m.bucket.part, type: task.type } };
}

// Not a score: office-hours tasks get "offices close at 16:00" in the why
// line when closing is near.
function office(task, m){
  if (task.openHours !== "office" || !m.officeOpen || m.officeLeft > W.OFFICE_SOON_MINUTES) return { points: 0, detail: null };
  return { points: 0, why: W.WHY_OFFICE_POINTS, detail: { close: `${pad(W.OFFICE.close)}:00` } };
}

// Not a score: a task well under way says so in the why line.
function progress(task){
  const p = progressOf(task);
  if (p < W.PROGRESS_SAY_MIN) return { points: 0, detail: null };
  return { points: 0, why: W.WHY_PROGRESS_POINTS, detail: { pct: p } };
}

// Score parts, total and the details the why line needs. `ctx` carries what
// depends on the other tasks (batches, areas in play).
export function scoreTask(task, m, ctx = { batches: new Map(), areas: [] }){
  const f = {
    deadline: deadline(task, m), target: target(task, m), stakes: stakes(task), priority: priority(task, m), area: areaBalance(task, m, ctx.areas), neglect: neglect(task, m),
    window: windowFit(task, m), momentum: momentum(task, m), batch: batch(task, ctx.batches), learned: learned(task, m),
    office: office(task, m), spot: spot(task, m), progress: progress(task),
  };
  const parts = Object.fromEntries(FACTORS.map((k) => [k, f[k].points]));
  const details = Object.fromEntries(FACTORS.map((k) => [k, f[k].detail]));
  const whyPoints = Object.fromEntries(FACTORS.map((k) => [k, f[k].why ?? f[k].points]));
  parts.skips = -W.SKIP_PENALTY * (m.skipsToday[task.id] || 0);
  const score = Object.values(parts).reduce((a, b) => a + b, 0);
  return { task, score, parts, details, whyPoints };
}

// Higher score first; tie → real deadline first, then higher stakes, then
// the higher project, then smaller size, then older.
export function compare(a, b){
  return b.score - a.score || b.parts.deadline - a.parts.deadline || b.parts.stakes - a.parts.stakes || b.parts.priority - a.parts.priority
    || leftMinutes(a.task) - leftMinutes(b.task) || (a.task.createdAt || 0) - (b.task.createdAt || 0);
}

// ---------- why line ----------
// Phrases are lists of pieces: plain strings, and { name } for anything the
// user typed (a project, a person, an event), which the UI puts in its own
// <bdi> so Hebrew and English never reorder each other. whyText flattens them.

function dateWords(due, days){
  const [y, mo, d] = dateParts(due);
  return days === 0 ? "today" : days === 1 ? "tomorrow"
    : days < 7 ? DAY_NAMES[new Date(y, mo - 1, d).getDay()] : `${MONTHS[mo - 1]} ${d}`;
}

const sizeWords = (n) => (n === 60 ? "hour" : durText(n));
// "send the stems to Yuval" → Yuval: who "affects someone" means, if it says.
// Hebrew too, when the name is in Latin letters: "ל-Yuval".
const person = (title) => (String(title).match(/(?:\b(?:to|for)\s+|ל-?)(\p{Lu}[\p{L}'-]*)/u) || [])[1] || null;

const PHRASES = {
  deadline: (s, d) => d.passed || d.days < 0 ? ["deadline passed"]
    : d.lead > 0 ? [`deadline ${dateWords(s.task.due, d.days)}, ${durText(d.left)} still to do`]
    : [`deadline ${dateWords(s.task.due, d.days)}`],
  target: (s, d) => [`planned for ${d.days <= 0 ? "today" : dateWords(effectiveDue(s.task), d.days)}`],
  stakes: (s, d) => d.kind === "money" ? ["costs money if late"]
    : d.kind === "penalty" ? ["there's a penalty if late"]
    : d.kind === "someone" ? (person(s.task.title) ? [{ name: person(s.task.title) }, " is waiting on it"] : ["someone's waiting on it"])
    : null,
  priority: (s, d) => d.rank === 1 ? [{ name: s.task.project }, " is your top project"] : [{ name: s.task.project }, ` is your #${d.rank} project`],
  office: (s, d) => [`offices close at ${d.close}`],
  progress: (s, d) => [d.pct >= 90 ? "almost done, finish it" : d.pct >= 45 && d.pct <= 55 ? "half done, finish it" : `${d.pct}% done, finish it`],
  area: (s, d) => [{ name: LABELS.area[d.area] || d.area }, d.done ? " is behind this week" : " hasn't moved this week"],
  batch: (s, d) => [`${d.ids.length} ${{ call: "calls", admin: "admin bits", errand: "errands" }[d.type]}, done together`],
  // A quick win is a small task, not just a small share of a long window.
  window: (s, d) => d.fit === "small" && leftMinutes(s.task) <= W.QUICK_WIN_MAX ? [`${sizeWords(leftMinutes(s.task))}, quick win`]
    : d.fit === "small" ? [`fits your ${sizeWords(d.window)}`]
    : d.fit === "piece" ? [`a piece fits your ${sizeWords(d.window)}`]
    : d.nextEvent ? ["fits before ", { name: d.nextEvent }]
    : d.fit === "full" ? [`fills your free ${sizeWords(d.window)}`] : [`fits your ${sizeWords(d.window)}`],
  momentum: (s, d) => d.kind === "today" ? ["keeps ", { name: s.task.project }, " going"] : ["back to ", { name: s.task.project }],
  neglect: (s, d) => [`untouched for ${d.days} days`],
  spot: (s, d) => ["you're at ", { name: d.name }],
  learned: (s, d) => s.parts.learned > 0 ? [`you usually do these in the ${d.bucket}`] : null,
};

// The factors worth a reason, strongest first.
export function whyFactors(s, skip = []){
  return FACTORS
    .filter((k) => !skip.includes(k) && s.whyPoints[k] >= W.WHY_MIN_POINTS && PHRASES[k](s, s.details[k]))
    .sort((a, b) => s.whyPoints[b] - s.whyPoints[a] || FACTORS.indexOf(a) - FACTORS.indexOf(b));
}

const phrasesOf = (s, factors) => factors.slice(0, W.WHY_PARTS).map((k) => PHRASES[k](s, s.details[k]));

// Pieces joined into one list: [phrase, ", ", phrase, …].
const joinPieces = (phrases) => phrases.flatMap((p, i) => (i ? [", ", ...p] : p));
export const whyText = (pieces) => pieces.map((p) => (typeof p === "string" ? p : p.name)).join("");

// The two or three strongest reasons, in order. `lead` moves a factor to
// the front (dedupe uses it); `skip` drops factors that make no sense.
export function whyPieces(s, { skip = [], order = null } = {}){
  const factors = order || whyFactors(s, skip);
  return joinPieces(phrasesOf(s, factors));
}

// Plain line, for the alternatives: "Deadline today, 5 min, quick win."
export function whyLine(s, opts){
  const t = whyText(whyPieces(s, opts));
  return t ? t[0].toUpperCase() + t.slice(1) + "." : "";
}

// The same reasons in Daisey's own voice, for the card it is proposing.
// Nothing to say → a plain opener, never an empty line under the title.
export function whySaid(s){
  const pieces = s.whyParts ?? whyPieces(s);
  return pieces.length ? ["I'd do this now: ", ...pieces, "."] : ["I'd do this one next."];
}

// The card and its alternatives never share a why line: if a task leads
// with a factor an earlier one already led with, it leads with its next
// one instead; if the whole line still matches, its order rotates until it
// doesn't. Sets s.whyParts (pieces) and s.why (plain) on each.
export function assignWhys(list){
  const leads = new Set(), lines = new Set();
  for (const s of list) {
    let order = whyFactors(s);
    if (order.length > 1 && leads.has(order[0])) {
      const fresh = order.findIndex((k) => !leads.has(k));
      if (fresh > 0) order = [order[fresh], ...order.filter((_, i) => i !== fresh)];
    }
    let text = whyText(whyPieces(s, { order }));
    for (let r = 1; text && lines.has(text) && r < order.length; r++) {
      const rot = [...order.slice(r), ...order.slice(0, r)];
      text = whyText(whyPieces(s, { order: rot }));
      if (!lines.has(text)) order = rot;
    }
    s.whyParts = whyPieces(s, { order });
    s.why = text ? whyLine(s, { order }) : "";
    if (order.length) leads.add(order[0]);
    if (text) lines.add(whyText(s.whyParts));
  }
}

// ---------- Something else ----------

// The next few by score, but no two from one area while another area scores
// within VARIETY_WITHIN of the next in line. The top pick's area counts as
// already shown.
export function somethingElse(ranked, count = W.ALTERNATIVES){
  if (!ranked.length) return [];
  const group = (s) => key(s.task.area || s.task.project);
  const used = new Set([group(ranked[0])]);
  const pool = ranked.slice(1), out = [];
  while (out.length < count && pool.length) {
    const next = pool[0];
    const choice = used.has(group(next))
      ? pool.find((s) => !used.has(group(s)) && s.score >= next.score - W.VARIETY_WITHIN) || next
      : next;
    out.push(choice);
    used.add(group(choice));
    pool.splice(pool.indexOf(choice), 1);
  }
  return out;
}

// ---------- the whole pass ----------

// pick: the card. alternatives: Something else. ranked: every offerable task
// in order. out: open tasks filtered out, with the reason. stale: tasks to
// ask "keep, shrink, or drop?" about. empty: "none" (no open tasks — invite
// a brain dump) or "nofit" (nothing fits — take the break), else null.
// pick.batch: the batch the pick belongs to, if it earned the bonus.
export function rank(tasks, input = {}){
  const m = readMoment(input);
  const offer = [], out = [];
  for (const t of tasks) {
    const reason = filterOut(t, m);
    if (reason === "done") continue;
    if (reason) out.push({ task: t, reason });
    else offer.push(t);
  }
  // Areas in play: every open task's, offerable now or not — a whole area
  // being out of reach right now doesn't make the others "even".
  const areas = [...new Set([...offer, ...out.map((o) => o.task)].map((t) => t.area).filter(Boolean))];
  const ctx = { batches: findBatches(offer, m), areas };
  const ranked = offer.map((t) => scoreTask(t, m, ctx)).sort(compare);
  const pick = ranked[0] || null;
  const alternatives = somethingElse(ranked);
  assignWhys([...(pick ? [pick] : []), ...alternatives]);
  for (const s of ranked) if (s.why === undefined) { s.whyParts = whyPieces(s); s.why = whyLine(s); }
  if (pick) pick.batch = ctx.batches.get(pick.task.id) || null;
  return {
    moment: m,
    pick,
    alternatives,
    ranked,
    out,
    stale: out.filter((o) => o.reason === "stale").map((o) => o.task),
    empty: pick ? null : out.length ? "nofit" : "none",
  };
}
