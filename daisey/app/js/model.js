// Task fields, defaults, first-pass size guess.
// PURE: no Firebase, no DOM, and the clock is only read as a default argument,
// so the node tests in daisey/test/v1/ import this file directly.
//
// Dates are local calendar days as "YYYY-MM-DD" strings, times are "HH:MM",
// timestamps are epoch ms.
//
// Decided with Mor (2026-10-03, revised 2026-10-04 with the spec update):
// - Only the title is asked for. Area, type, where, open hours, size, energy
//   and stakes are guessed from it (guessFields) and shown as chips the user
//   can fix. Every field still a guess is listed in `guessed`.
// - Energy is back (2026-10-04) after a day out: a guess per task, fixable.
// - A date is a Deadline (real) or a Target (wish), never computed. New and
//   migrated dates are Targets until the user says otherwise.
// - No repeating tasks.
// - Waiting is set by acting on an existing task, never when adding one.

export const SIZES = [5, 15, 30, 60, 90]; // guess buckets; 90 reads as "90+"
// someday: parked, never on the card until moved back. dropped: let go in the
// sweep; kept (for learning) but shown nowhere.
export const STATUS = ["ready", "waiting", "done", "someday", "dropped"];
export const SKIP_REASONS = ["tired", "notime", "mood", "blocked"];
export const INBOX = "Inbox";
export const DEFAULT_SIZE = 30;
export const SPLIT_FROM = 60; // "can split" defaults on from this size
const SIMILAR = 0.5; // title word overlap that counts as "a similar past task"
export const TASK_VERSION = 2; // tasks below this get migrateTask'd on load

export const AREAS = ["work", "job", "home", "admin", "social", "personal"];
export const TYPES = ["deep", "admin", "call", "errand", "home", "social"];
export const WHERE = ["anywhere", "computer", "home", "out", "phone"];
export const OPEN_HOURS = ["anytime", "office", "evening"];
export const STAKES = ["low", "money", "someone", "penalty"];
export const ENERGY = ["low", "medium", "high"];
export const DATE_KINDS = ["deadline", "target"];
// The single-choice fields guessed from the title, and what each may hold.
export const CHOICES = { area: AREAS, type: TYPES, where: WHERE, openHours: OPEN_HOURS, stakes: STAKES, energy: ENERGY };
// Every field Daisey can guess, in the order the chips show them.
export const GUESSABLE = ["area", "type", "where", "openHours", "size", "stakes", "energy", "canSplit"];

export const LABELS = {
  area: { work: "Work", job: "Job search", home: "Home", admin: "Admin", social: "Social", personal: "Personal" },
  type: { deep: "Deep", admin: "Admin", call: "Call", errand: "Errand", home: "Home", social: "Social" },
  where: { anywhere: "Anywhere", computer: "Computer", home: "Home", out: "Out", phone: "Phone" },
  openHours: { anytime: "Anytime", office: "Office hours", evening: "Evening" },
  stakes: { low: "Low stakes", money: "Costs money", someone: "Affects someone", penalty: "Deadline penalty" },
  energy: { low: "Low energy", medium: "Medium energy", high: "High energy" },
  dateKind: { deadline: "Deadline", target: "Target" },
};

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

// What a type of task usually takes, when neither a similar past task nor
// the title's own words say. This is what stops every task landing on 30.
export const TYPE_SIZE = { call: 15, admin: 15, errand: 45, home: 30, social: 60, deep: 60 };

// Shrinking a task that keeps getting stopped or skipped: half the size, rounded
// down to a bucket (a 90 becomes 30, never back up to 60), never under 5.
export const shrunk = (size) => SIZES.filter((s) => s <= (size || DEFAULT_SIZE) / 2).pop() ?? SIZES[0];
export const shrinkPatch = (task, now = Date.now()) => ({ size: shrunk(task.size), stopsUnfinished: 0, skipsSinceStart: 0, touchedAt: now });

export function guessSize(title, history = [], type = null){
  const toks = tokens(title);
  const past = history.filter((h) => h && similarity(toks, h.title) >= SIMILAR).map(pastMinutes).filter((m) => m > 0);
  if (past.length) return snapSize(median(past));
  for (const [size, words] of SIZE_HINTS) if (words.some((w) => hasWord(toks, w))) return size;
  // What this type of task has really taken, once three are finished.
  const typical = history.filter((h) => h && h.type === type && h.status === "done" && h.spentMinutes > 0).map((h) => h.spentMinutes);
  if (type && typical.length >= 3) return snapSize(median(typical));
  return TYPE_SIZE[type] ?? DEFAULT_SIZE;
}

// A phrase matches as consecutive words; its first word gets hasWord's
// plural and Hebrew-prefix forgiveness, the rest must match exactly.
function hasPhrase(toks, phrase){
  const p = tokens(phrase);
  if (p.length === 1) return hasWord(toks, p[0]);
  for (let i = 0; i + p.length <= toks.length; i++) {
    if (hasWord([toks[i]], p[0]) && p.slice(1).every((w, j) => toks[i + 1 + j] === w)) return true;
  }
  return false;
}
const anyOf = (toks, list) => list.some((w) => hasPhrase(toks, w));

// Word lists, English + Hebrew. First match wins, in this order: a call
// about an invoice is still a call. Words that mean too many things in
// Mor's own work ("fix the boss loop", "organize the session") are left
// out on purpose — a wrong guess costs more than "Deep".
const TYPE_WORDS = [
  ["call", ["call", "calls", "calling", "phone call", "ring", "להתקשר", "שיחה", "לצלצל"]],
  ["errand", ["buy", "shop", "shopping", "groceries", "pick up", "pickup", "collect", "drop off", "post office",
    "pharmacy", "supermarket", "return", "לקנות", "קניות", "לאסוף", "דואר", "סופר", "בית מרקחת", "מכולת", "להחזיר"]],
  ["admin", ["invoice", "form", "tax", "taxes", "renew", "pay", "bill", "insurance", "register", "order", "cancel",
    "subscription", "receipt", "bank", "email", "mail", "reply", "send", "schedule", "appointment", "book", "text",
    "whatsapp", "sms", "message", "confirm", "fill", "חשבונית", "טופס", "מסים", "לחדש", "לשלם", "ביטוח", "להירשם",
    "הרשמה", "להגיש", "הגשה", "להזמין", "לבטל", "קבלה", "בנק", "מייל", "לענות", "לשלוח", "לתאם", "תור", "הודעה",
    "וואטסאפ", "לאשר", "למלא"]],
  ["home", ["clean", "cleaning", "laundry", "dishes", "cook", "cooking", "tidy", "vacuum", "garden", "plants",
    "לנקות", "ניקיון", "כביסה", "כלים", "לבשל", "לשאוב", "עציצים"]],
  ["social", ["meet", "meetup", "dinner", "lunch", "coffee", "birthday", "party", "visit", "drinks", "hang out",
    "להיפגש", "ארוחת", "קפה", "יום הולדת", "מסיבה", "לבקר", "מפגש"]],
];
const PHONE_WORDS = ["text", "whatsapp", "sms", "message", "הודעה", "וואטסאפ", "סמס"];
const HOME_WORDS = ["practice", "rehearse", "לתרגל"];
// Places that keep office hours. A call to one of them, or an errand or
// admin task that names one, can only happen while it's open.
const OFFICE_WORDS = ["bank", "clinic", "doctor", "dentist", "insurance", "municipality", "city hall", "post office",
  "tax", "office", "accountant", "בנק", "מרפאה", "רופא", "רופאה", "ביטוח", "עירייה", "עיריית", "קופת חולים", "דואר",
  "רשות", "רואה חשבון", "מס הכנסה"];
// Calls to people, not offices: any time of day.
const FAMILY_WORDS = ["mom", "mum", "dad", "grandma", "grandpa", "sister", "brother", "friend",
  "אמא", "אבא", "סבתא", "סבא", "אחותי", "אחי", "חבר", "חברה"];
const PENALTY_WORDS = ["submit", "deadline", "register", "registration", "apply", "application", "late fee",
  "הגשה", "להגיש", "הרשמה", "להירשם", "דדליין"];
const MONEY_WORDS = ["pay", "bill", "fine", "rent", "tax", "taxes", "invoice", "refund", "renew",
  "לשלם", "חשבון", "קנס", "שכירות", "ארנונה", "מסים", "חשבונית", "החזר", "לחדש"];
const SOMEONE_WORDS = ["reply", "answer", "confirm", "get back", "send", "לענות", "לאשר", "לשלוח", "לחזור"];
const JOB_WORDS = ["job", "cv", "resume", "interview", "portfolio", "linkedin", "cover letter", "recruiter", "apply",
  "application", "hiring", "משרה", "משרות", "קורות חיים", "ראיון", "תיק עבודות", "לינקדאין", "מכתב מקדים", "גיוס"];
const PERSONAL_WORDS = ["gym", "workout", "run", "doctor", "dentist", "haircut", "therapy", "therapist", "meditate",
  "health", "רופא", "רופאה", "שיניים", "חדר כושר", "ספורט", "תספורת", "טיפול", "פסיכולוג", "בריאות", "ריצה"];

export const guessType = (title) => {
  const toks = tokens(title);
  return (TYPE_WORDS.find(([, words]) => anyOf(toks, words)) || ["deep"])[0];
};

export function guessWhere(title, type){
  const toks = tokens(title);
  if (type === "call") return "phone";
  if (type === "errand") return "out";
  if (type === "home") return "home";
  if (type === "social") return "anywhere";
  if (anyOf(toks, PHONE_WORDS)) return "phone";
  if (type === "deep" && anyOf(toks, HOME_WORDS)) return "home";
  return "computer";
}

export function guessOpenHours(title, type){
  const toks = tokens(title);
  if (type === "call") return anyOf(toks, FAMILY_WORDS) ? "anytime" : "office";
  if ((type === "admin" || type === "errand") && anyOf(toks, OFFICE_WORDS)) return "office";
  return "anytime";
}

// Worst first: a missed registration costs more than a late bill.
// "Affects someone" also catches "… to Uri" / "for Dana" in English.
export function guessStakes(title){
  const toks = tokens(title);
  if (anyOf(toks, PENALTY_WORDS)) return "penalty";
  if (anyOf(toks, MONEY_WORDS)) return "money";
  if (anyOf(toks, SOMEONE_WORDS) || anyOf(toks, FAMILY_WORDS) || /(?:\b(?:to|for)\s+|ל-?)\p{Lu}/u.test(String(title))) return "someone";
  return "low";
}

// The title's words, then the area the user has given other tasks in the
// same project, then the type, then Work.
export function guessArea(title, project, type, history = []){
  const toks = tokens(title), ptoks = tokens(project);
  if (anyOf(toks, JOB_WORDS) || anyOf(ptoks, JOB_WORDS)) return "job";
  if (anyOf(toks, PERSONAL_WORDS)) return "personal";
  if (anyOf(toks, OFFICE_WORDS)) return "admin"; // the bank, the tax office, ביטוח לאומי
  const p = String(project || "").trim().toLowerCase();
  if (p && p !== INBOX.toLowerCase()) {
    const counts = {};
    for (const h of history) {
      if (h && String(h.project || "").trim().toLowerCase() === p && AREAS.includes(h.area) && !(h.guessed || []).includes("area")) {
        counts[h.area] = (counts[h.area] || 0) + 1;
      }
    }
    const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    if (best) return best[0];
  }
  if (type === "home" || type === "admin" || type === "social") return type;
  return "work";
}

export function guessEnergy(type, size){
  if (type === "deep" && size >= 60) return "high";
  if ((type === "call" || type === "admin" || type === "errand") && size <= 15) return "low";
  return "medium";
}

// Is this a value the field can hold? (size: minutes; canSplit: boolean)
export function validField(k, v){
  if (k === "size") return toMinutes(v) != null;
  if (k === "canSplit") return typeof v === "boolean";
  return !!CHOICES[k]?.includes(v);
}

// Every guessable field. `given` holds the user's own values; the rest are
// guessed in dependency order, so a type the user picked steers where,
// hours, size and energy, and a size steers energy and can-split.
export function guessFields(title, project, given = {}, history = []){
  const v = { ...given };
  v.type ??= guessType(title);
  v.area ??= guessArea(title, project, v.type, history);
  v.where ??= guessWhere(title, v.type);
  v.openHours ??= guessOpenHours(title, v.type);
  v.stakes ??= guessStakes(title);
  v.size ??= guessSize(title, history, v.type);
  v.energy ??= guessEnergy(v.type, v.size);
  v.canSplit ??= v.size >= SPLIT_FROM;
  return v;
}

// The user's own values out of an input, cleaned; anything missing or
// invalid is left for guessFields.
function givenFrom(input){
  const given = {};
  for (const k of GUESSABLE) if (validField(k, input[k])) given[k] = k === "size" ? toMinutes(input[k]) : input[k];
  return given;
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
  const project = text(input.project) || INBOX;
  const given = givenFrom(input);
  const v = guessFields(title, project, given, history);
  const due = toDate(input.due);

  return {
    project,
    title,
    area: v.area,
    type: v.type,
    where: v.where,
    openHours: v.openHours,
    size: v.size,
    stakes: v.stakes,
    energy: v.energy,
    due,
    dueTime: due ? toTime(input.dueTime) : null,
    dateKind: due ? (DATE_KINDS.includes(input.dateKind) ? input.dateKind : "target") : null,
    // Not before: Daisey keeps the task off the card until this day. For
    // work that can't start yet — files not sent, venue not booked.
    notBefore: toDate(input.notBefore),
    status: "ready",
    waitingOn: null,
    // The one thing to do next, for a big task or a goal: what the card
    // shows under the title so a 90-minute lump has a way in.
    nextStep: text(input.nextStep) || null,
    canSplit: v.canSplit,
    notes: notesText(input.notes) || null,
    // Where it came from, when it wasn't typed here: { app, cardId, boardId }.
    // Daisey owns the task from this moment on; nothing syncs back.
    source: input.source && input.source.app ? { ...input.source } : null,
    guessed: GUESSABLE.filter((k) => !(k in given)),
    v: TASK_VERSION,
    createdAt: now,
    touchedAt: now,
    ...freshCounters(),
  };
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Returns only the fields that change, ready for a Firestore update. A
// guessable field named in `changes` with a real value becomes the user's
// own; passing null/"" hands it back to Daisey to guess. Guessed fields are
// re-guessed when what they were guessed from changes: the title, the
// project, or any other classification field.
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

  const given = givenFrom(changes);
  let touched = "title" in patch || "project" in patch;
  for (const k of GUESSABLE) {
    if (k in given) { guessed.delete(k); touched = true; } else if (has(k)) { guessed.add(k); touched = true; }
  }
  if (touched) {
    // The user's values: this edit's, then the task's own (non-guessed,
    // valid) ones. A field missing from an old doc counts as a guess.
    const keep = { ...given };
    for (const k of GUESSABLE) {
      if (k in keep || guessed.has(k)) continue;
      if (validField(k, task[k])) keep[k] = task[k]; else guessed.add(k);
    }
    const v = guessFields(get("title"), get("project"), keep, others);
    for (const k of GUESSABLE) set(k, v[k]);
  }

  if (has("due")) set("due", toDate(changes.due));
  if (has("notBefore")) set("notBefore", toDate(changes.notBefore));
  if (has("dueTime") || !get("due")) set("dueTime", get("due") ? toTime(changes.dueTime ?? task.dueTime) : null);
  // A date is a Target unless the user calls it a Deadline; no date, no kind.
  if (!get("due")) set("dateKind", null);
  else if (has("dateKind") && DATE_KINDS.includes(changes.dateKind)) set("dateKind", changes.dateKind);
  else if (!DATE_KINDS.includes(task.dateKind)) set("dateKind", "target");
  if (has("nextStep")) set("nextStep", text(changes.nextStep) || null);

  if (has("waitingOn")) set("waitingOn", text(changes.waitingOn) || null);
  if (has("status") && STATUS.includes(changes.status)) {
    set("status", changes.status);
    if (changes.status !== "waiting" && !has("waitingOn")) set("waitingOn", null);
    if (changes.status !== "done") set("doneAt", null); // reopened
  } else if (has("waitingOn") && get("waitingOn") && get("status") === "ready") {
    set("status", "waiting");
  }
  if (has("notes")) set("notes", notesText(changes.notes) || null);

  const order = GUESSABLE.filter((k) => guessed.has(k));
  if (!same([...order].sort(), [...(task.guessed || [])].sort())) patch.guessed = order;
  if (Object.keys(patch).length) patch.touchedAt = now;
  return patch;
}

// Brings a task saved before TASK_VERSION up to the current fields. Fills
// what's missing, re-guesses whatever is still a guess (the flat-30 sizes
// most of all), and makes every existing date a Target. Never touches
// touchedAt: a migration isn't the user working on the task, and the
// neglect score reads it. Returns {} once a task is current.
export function migrateTask(task, history = []){
  if ((task.v || 0) >= TASK_VERSION) return {};
  const guessed = new Set(task.guessed || []);
  const keep = {};
  for (const k of GUESSABLE) {
    if (!guessed.has(k) && validField(k, task[k])) keep[k] = k === "size" ? toMinutes(task[k]) : task[k];
    else guessed.add(k);
  }
  const others = history.filter((h) => h && (h.id == null || h.id !== task.id));
  const v = guessFields(task.title, task.project, keep, others);
  const patch = {};
  for (const k of GUESSABLE) if (!same(task[k], v[k])) patch[k] = v[k];
  const kind = task.due ? (DATE_KINDS.includes(task.dateKind) ? task.dateKind : "target") : null;
  if (task.dateKind !== kind) patch.dateKind = kind;
  if (task.nextStep === undefined) patch.nextStep = null;
  const order = GUESSABLE.filter((k) => guessed.has(k));
  if (!same(order, task.guessed || [])) patch.guessed = order;
  patch.v = TASK_VERSION;
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
  notBefore: task.notBefore ?? null, // Later → This week sets it
  waitingOn: task.waitingOn ?? null, // Pending's reason
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
