// Task fields, defaults, first-pass size guess.
// PURE: no Firebase, no DOM, and the clock is only read as a default argument,
// so the node tests in daisey/test/v1/ import this file directly.
//
// Dates are local calendar days as "YYYY-MM-DD" strings, times are "HH:MM",
// timestamps are epoch ms.
//
// Decided with Mor after session 2 (2026-10-03), departing from the spec:
// - No energy at all (Mor, later the same day: "feels pointless"). Old task
//   docs may still carry an `energy` field; nothing reads it.
// - No "hard due" field. A due turns hard on its own when the time left
//   before it gets tight for the task's size — the engine works that out
//   each moment (session 3), so nothing is stored.
// - No repeating tasks.
// - Waiting is set by acting on an existing task, never when adding one.

export const SIZES = [5, 15, 30, 60, 90]; // guess buckets; 90 reads as "90+"
export const STATUS = ["ready", "waiting", "done"];
export const SKIP_REASONS = ["tired", "notime", "mood", "blocked"];
export const INBOX = "Inbox";
export const DEFAULT_SIZE = 30;
export const SPLIT_FROM = 60; // "can split" defaults on from this size
const SIMILAR = 0.5; // title word overlap that counts as "a similar past task"

// First-pass word hints, English + Hebrew. Session 10's learning refines
// sizes from real finish times; these only have to beat "30, medium".
const SIZE_HINTS = [
  [90, ["compose", "produce", "research", "להלחין", "להפיק", "מחקר"]],
  [60, ["prep", "write", "mix", "design", "practice", "record", "edit", "build", "rehearse",
        "הכנה", "להכין", "לכתוב", "מיקס", "לעצב", "לתרגל", "להקליט", "לערוך", "לבנות", "חזרה"]],
  [15, ["call", "email", "mail", "phone", "order", "send", "invoice", "schedule",
        "להתקשר", "טלפון", "מייל", "שיחה", "לשלוח", "להזמין", "חשבונית", "לתאם"]],
  [5, ["text", "reply", "pay", "confirm", "remind", "whatsapp", "sms",
       "הודעה", "לענות", "לשלם", "לאשר", "תזכורת", "וואטסאפ"]],
];

// ---------- dates ----------

const pad = (n) => String(n).padStart(2, "0");

export function localDate(ms = Date.now()){
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ---------- field cleaning ----------

const text = (v) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "");
const notesText = (v) => (typeof v === "string" ? v.trim() : "");

export function toMinutes(v){
  if (v == null || v === "") return null;
  const n = parseFloat(String(v)); // "90+" → 90
  return Number.isFinite(n) && n > 0 ? Math.max(1, Math.round(n)) : null;
}

export function toDate(v){
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const [y, m, d] = v.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10) === v ? v : null; // rejects 2026-02-30
}

export const toTime = (v) => (typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : null);

// ---------- guesses ----------

// Minutes as "45 min", "1 h", "1 h 30 min". Never a decimal hour and never
// "4 h 5": a bare trailing number next to Hebrew reads as part of it.
export function durText(min){
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m} min`;
  const rest = m % 60;
  return `${Math.floor(m / 60)} h` + (rest ? ` ${rest} min` : "");
}

export const tokens = (s) => String(s || "").toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
const HEBREW = /[֐-׿]/;

// Whole-word match, forgiving English plurals and up to two Hebrew prefix
// letters (ו, ה, ל, ב, ש…), so "invoices" and "ולהתקשר" both hit.
function hasWord(toks, w){
  return toks.some((t) => t === w
    || (t.endsWith("s") && t.slice(0, -1) === w)
    || (t.endsWith("es") && t.slice(0, -2) === w)
    || (HEBREW.test(w) && t.length - w.length <= 2 && t.length > w.length && t.endsWith(w)));
}

function similarity(toksA, titleB){
  const a = new Set(toksA), b = new Set(tokens(titleB));
  if (!a.size || !b.size) return 0;
  let both = 0;
  for (const t of a) if (b.has(t)) both++;
  return both / (a.size + b.size - both);
}

// What a past task says about duration: real minutes if it was finished,
// else the size the user set (a guess teaches nothing).
function pastMinutes(t){
  if (t.status === "done" && t.spentMinutes > 0) return t.spentMinutes;
  if (!(t.guessed || []).includes("size") && t.size > 0) return t.size;
  return null;
}

const median = (xs) => { const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// Nearest bucket; a tie goes to the bigger one (underestimating hurts more:
// the task gets offered into a window it can't fit).
export function snapSize(m){
  let best = SIZES[0];
  for (const s of SIZES) if (Math.abs(s - m) <= Math.abs(best - m)) best = s;
  return best;
}

export function guessSize(title, history = []){
  const toks = tokens(title);
  const past = history.filter((h) => h && similarity(toks, h.title) >= SIMILAR).map(pastMinutes).filter((m) => m > 0);
  if (past.length) return snapSize(median(past));
  for (const [size, words] of SIZE_HINTS) if (words.some((w) => hasWord(toks, w))) return size;
  return DEFAULT_SIZE;
}

// ---------- tasks ----------

const freshCounters = () => ({
  skipCount: 0,
  skipReasons: Object.fromEntries(SKIP_REASONS.map((r) => [r, 0])),
  skipsSinceStart: 0, // the stale rule counts these
  spentMinutes: 0,
  starts: 0,
  stopsUnfinished: 0,
  doneAt: null,
});

// Only the title is required. Adding a task takes project, title, size and
// due; everything else is a default or a guess. Guessed fields are listed in
// `guessed` so the UI can mark them and a later edit can tell the user's
// values from Daisey's. `history` is the user's other tasks, used for
// "similar past tasks".
export function createTask(input, { now = Date.now(), history = [] } = {}){
  const title = text(input.title);
  if (!title) throw new Error("A task needs a title.");
  const guessed = [];

  let size = toMinutes(input.size);
  if (size == null) { size = guessSize(title, history); guessed.unshift("size"); }
  let canSplit = input.canSplit;
  if (typeof canSplit !== "boolean") { canSplit = size >= SPLIT_FROM; guessed.push("canSplit"); }
  const due = toDate(input.due);

  return {
    project: text(input.project) || INBOX,
    title,
    size,
    due,
    dueTime: due ? toTime(input.dueTime) : null,
    // Not before: Daisey keeps the task off the card until this day. For
    // work that can't start yet — files not sent, venue not booked.
    notBefore: toDate(input.notBefore),
    status: "ready",
    waitingOn: null,
    canSplit,
    notes: notesText(input.notes) || null,
    // Where it came from, when it wasn't typed here: { app, cardId, boardId }.
    // Daisey owns the task from this moment on; nothing syncs back.
    source: input.source && input.source.app ? { ...input.source } : null,
    guessed,
    createdAt: now,
    touchedAt: now,
    ...freshCounters(),
  };
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Returns only the fields that change, ready for a Firestore update. A field
// named in `changes` becomes the user's own; passing null/"" for size hands
// it back to Daisey to guess. Guessed fields are re-guessed when what they
// were guessed from (title, size) changes.
export function editTask(task, changes, { now = Date.now(), history = [] } = {}){
  const patch = {};
  const set = (k, v) => { if (!same(task[k], v)) patch[k] = v; };
  const has = (k) => Object.prototype.hasOwnProperty.call(changes, k);
  const get = (k) => (k in patch ? patch[k] : task[k]);
  const guessed = new Set(task.guessed || []);
  const others = history.filter((h) => h.id == null || h.id !== task.id);

  if (has("title")) {
    const t = text(changes.title);
    if (!t) throw new Error("A task needs a title.");
    set("title", t);
  }
  if (has("project")) set("project", text(changes.project) || INBOX);

  const titleChanged = "title" in patch;
  if (has("size") && toMinutes(changes.size) != null) { set("size", toMinutes(changes.size)); guessed.delete("size"); }
  else if (has("size") || (titleChanged && guessed.has("size"))) { set("size", guessSize(get("title"), others)); guessed.add("size"); }

  const sizeChanged = "size" in patch;

  if (has("canSplit") && typeof changes.canSplit === "boolean") { set("canSplit", changes.canSplit); guessed.delete("canSplit"); }
  else if (sizeChanged && guessed.has("canSplit")) set("canSplit", get("size") >= SPLIT_FROM);

  if (has("due")) set("due", toDate(changes.due));
  if (has("notBefore")) set("notBefore", toDate(changes.notBefore));
  if (has("dueTime") || !get("due")) set("dueTime", get("due") ? toTime(changes.dueTime ?? task.dueTime) : null);

  if (has("waitingOn")) set("waitingOn", text(changes.waitingOn) || null);
  if (has("status") && STATUS.includes(changes.status)) {
    set("status", changes.status);
    if (changes.status !== "waiting" && !has("waitingOn")) set("waitingOn", null);
    if (changes.status !== "done") set("doneAt", null); // reopened
  } else if (has("waitingOn") && get("waitingOn") && get("status") === "ready") {
    set("status", "waiting");
  }
  if (has("notes")) set("notes", notesText(changes.notes) || null);

  if (!same([...guessed].sort(), [...(task.guessed || [])].sort())) patch.guessed = [...guessed].sort();
  if (Object.keys(patch).length) patch.touchedAt = now;
  return patch;
}

export const completeTask = (task, { now = Date.now() } = {}) =>
  ({ status: "done", doneAt: now, skipsSinceStart: 0, touchedAt: now });

// Not now. The skip counts straight away; the reason is a second, optional
// patch, because the chips only appear after the card has already moved on.
export const skipTask = (task, { now = Date.now() } = {}) =>
  ({ skipCount: (task.skipCount || 0) + 1, skipsSinceStart: (task.skipsSinceStart || 0) + 1, touchedAt: now });

// "Blocked" is the one reason that changes the task itself: it's waiting on
// something, so Daisey stops offering it until that's cleared.
export function skipReason(task, reason, { now = Date.now() } = {}){
  if (!SKIP_REASONS.includes(reason)) return {};
  const counts = { ...Object.fromEntries(SKIP_REASONS.map((r) => [r, 0])), ...(task.skipReasons || {}) };
  const patch = { skipReasons: { ...counts, [reason]: counts[reason] + 1 }, touchedAt: now };
  if (reason === "blocked") patch.status = "waiting";
  return patch;
}

// Everything the two patches above can touch, as it was — so Undo puts the
// task back exactly, not approximately.
export const skipSnapshot = (task) => ({
  skipCount: task.skipCount || 0, skipsSinceStart: task.skipsSinceStart || 0,
  skipReasons: task.skipReasons || {}, status: task.status, touchedAt: task.touchedAt ?? null,
});

// Focus mode. Starting clears the stale-skip count: a task you actually
// start isn't one you keep refusing.
export const startedTask = (task, { now = Date.now() } = {}) =>
  ({ starts: (task.starts || 0) + 1, skipsSinceStart: 0, touchedAt: now });

// Leaving focus mode: the real minutes always count, whether or not the
// task is finished. `finished` completes it; otherwise it stays open and
// the stop is recorded (two stops → Daisey offers to split it, session 10).
export function workedTask(task, minutes, { finished = false, now = Date.now() } = {}){
  const spent = (task.spentMinutes || 0) + Math.max(0, Math.round(minutes));
  return finished
    ? { ...completeTask(task, { now }), spentMinutes: spent }
    : { spentMinutes: spent, stopsUnfinished: (task.stopsUnfinished || 0) + 1, touchedAt: now };
}

// Ready to be offered at all? engine.js filterOut adds window, skips and
// the "not before" date.
export const isAvailable = (task) => task.status === "ready";

// Still waiting for its day to come round.
export const notYet = (task, now = Date.now()) => !!task.notBefore && task.notBefore > localDate(now);
