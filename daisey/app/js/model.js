// Task fields, defaults, first-pass size/energy guesses.
// PURE: no Firebase, no DOM, and the clock is only read as a default argument,
// so the node tests in daisey/test/v1/ import this file directly.
//
// Dates are local calendar days as "YYYY-MM-DD" strings, times are "HH:MM",
// timestamps are epoch ms.
//
// Decided with Mor after session 2 (2026-10-03), departing from the spec:
// - Energy is never asked when adding a task; Daisey guesses it. The user
//   weighs in when choosing a task (how: to be decided).
// - No "hard due" field. A due turns hard on its own when the time left
//   before it gets tight for the task's size — the engine works that out
//   each moment (session 3), so nothing is stored.
// - No repeating tasks.
// - Waiting is set by acting on an existing task, never when adding one.

export const SIZES = [5, 15, 30, 60, 90]; // guess buckets; 90 reads as "90+"
export const ENERGY = ["low", "medium", "high"];
export const STATUS = ["ready", "waiting", "done"];
export const SKIP_REASONS = ["tired", "notime", "mood", "blocked"];
export const INBOX = "Inbox";
export const DEFAULT_SIZE = 30;
export const DEFAULT_ENERGY = "medium";
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
const ENERGY_HINTS = [
  ["high", ["write", "compose", "mix", "design", "practice", "record", "study", "learn", "plan", "debug", "research",
            "לכתוב", "להלחין", "מיקס", "לעצב", "לתרגל", "להקליט", "ללמוד", "לתכנן", "מחקר"]],
  ["low", ["email", "mail", "reply", "text", "pay", "invoice", "order", "tidy", "clean", "file", "admin", "whatsapp",
           "מייל", "לענות", "לשלם", "חשבונית", "להזמין", "לסדר", "לנקות", "וואטסאפ"]],
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

export function toEnergy(v){
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "med") return "medium";
  return ENERGY.includes(s) ? s : null;
}

export function toDate(v){
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const [y, m, d] = v.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10) === v ? v : null; // rejects 2026-02-30
}

export const toTime = (v) => (typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : null);

// ---------- guesses ----------

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

export function guessEnergy(title, size){
  const toks = tokens(title);
  for (const [energy, words] of ENERGY_HINTS) if (words.some((w) => hasWord(toks, w))) return energy;
  if (size <= 5) return "low";
  if (size >= 90) return "high";
  return DEFAULT_ENERGY;
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
  const guessed = ["energy"];

  let size = toMinutes(input.size);
  if (size == null) { size = guessSize(title, history); guessed.unshift("size"); }
  let canSplit = input.canSplit;
  if (typeof canSplit !== "boolean") { canSplit = size >= SPLIT_FROM; guessed.push("canSplit"); }
  const due = toDate(input.due);

  return {
    project: text(input.project) || INBOX,
    title,
    size,
    energy: guessEnergy(title, size),
    due,
    dueTime: due ? toTime(input.dueTime) : null,
    status: "ready",
    waitingOn: null,
    canSplit,
    notes: notesText(input.notes) || null,
    guessed,
    createdAt: now,
    touchedAt: now,
    ...freshCounters(),
  };
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Returns only the fields that change, ready for a Firestore update. A field
// named in `changes` becomes the user's own; passing null/"" for size or
// energy hands it back to Daisey to guess. Guessed fields are re-guessed when
// what they were guessed from (title, size) changes.
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
  if (has("energy") && toEnergy(changes.energy) != null) { set("energy", toEnergy(changes.energy)); guessed.delete("energy"); }
  else if (has("energy") || ((titleChanged || sizeChanged) && guessed.has("energy"))) {
    set("energy", guessEnergy(get("title"), get("size"))); guessed.add("energy");
  }

  if (has("canSplit") && typeof changes.canSplit === "boolean") { set("canSplit", changes.canSplit); guessed.delete("canSplit"); }
  else if (sizeChanged && guessed.has("canSplit")) set("canSplit", get("size") >= SPLIT_FROM);

  if (has("due")) set("due", toDate(changes.due));
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

// Could the engine offer this task? (Window and energy are session 3.)
export const isAvailable = (task) => task.status === "ready";
