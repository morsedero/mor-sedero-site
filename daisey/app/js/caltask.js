// Calendar events that are really tasks (DAISEY_SPEC "Day hours, booked
// tasks and calendar tasks"): "לבטל עד ה20 בחודש את הלינקדאין פרמיום" sat in
// the calendar as an event, where nothing would ever pick it. Daisey offers
// each such event once as a task — guessed fields, a deadline read from the
// title — and only touches the event if the user taps Delete. PURE.
import { localDate, guessFields, INBOX } from "./model.js";
import { sameTitle } from "./day.js";

// Verbs that open a to-do, not a meeting. Hebrew infinitives anywhere in the
// title; English only as the first word ("Call mom", not "Team call").
const HE_VERBS = ["לבטל", "להתקשר", "לשלם", "להירשם", "לשלוח", "לקנות", "להזמין", "לחדש", "לקבוע", "לתאם", "לברר",
  "להגיש", "למלא", "לסדר", "לתקן", "להחזיר", "לאסוף", "לבדוק", "לענות", "לאשר", "לכתוב", "להעביר", "לסגור", "להוציא", "לצלם"];
const EN_VERBS = ["cancel", "call", "pay", "register", "renew", "book", "send", "buy", "return", "submit", "email",
  "reply", "order", "fix", "apply", "sign", "finish", "check", "file", "collect", "write", "update", "remember"];

// The deadline phrase: "עד ה20", "עד ה-20 בחודש", "עד 20/10", "by the 20th",
// "until 20/10". Group 1 the day, group 2 the month if given.
const DEADLINE_RE = [
  /עד\s*(?:ה-?|ל-?)?\s*(\d{1,2})(?:[./](\d{1,2}))?(?:\s*(?:ב|ל)חודש)?/u,
  /\b(?:by|until|till|before)\s+(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?(?:[./](\d{1,2}))?\b/i,
];

const words = (title) => String(title || "").toLowerCase().split(/[\s,.;:!?()"'״׳-]+/u).filter(Boolean);

export function looksLikeTask(title){
  const w = words(title);
  if (!w.length) return false;
  if (w.some((x) => HE_VERBS.includes(x) || HE_VERBS.includes(x.replace(/^ו/u, "")))) return true;
  if (EN_VERBS.includes(w[0]) && w[1] !== "with") return true;
  return DEADLINE_RE.some((re) => re.test(title));
}

// The date the phrase names, counted from `ref` (the event's day): a bare day
// is this month if it's still ahead, else next month; day/month is this year,
// or next year once passed. null if there's no phrase or it's no real date.
export function parseDeadline(title, ref = Date.now()){
  for (const re of DEADLINE_RE) {
    const m = re.exec(String(title || ""));
    if (!m) continue;
    const day = Number(m[1]), r = new Date(ref);
    let d;
    if (m[2]) {
      d = new Date(r.getFullYear(), Number(m[2]) - 1, day);
      if (localDate(d.getTime()) < localDate(ref)) d = new Date(r.getFullYear() + 1, Number(m[2]) - 1, day);
    } else {
      d = new Date(r.getFullYear(), r.getMonth(), day);
      if (day < r.getDate()) d = new Date(r.getFullYear(), r.getMonth() + 1, day);
    }
    if (day < 1 || d.getDate() !== day) return null; // the 31st of a short month
    return localDate(d.getTime());
  }
  return null;
}

// The task's title: the event's, without the deadline phrase (it becomes the
// due date instead).
export function taskTitle(title){
  let t = String(title || "");
  for (const re of DEADLINE_RE) t = t.replace(re, " ");
  return t.replace(/\s+/g, " ").trim() || String(title || "").trim();
}

// What the offer would create: { title, project, due, dateKind } for addTask,
// plus the guessed fields to show on the offer.
export function draftFrom(ev, history = []){
  const title = taskTitle(ev.title);
  const due = parseDeadline(ev.title, Date.parse(ev.start) || Date.now());
  return {
    input: { title, project: INBOX, ...(due ? { due, dateKind: "deadline" } : {}) },
    guess: guessFields(title, INBOX, {}, history),
  };
}

// The first event worth offering: reads like a task, wasn't made by Daisey,
// isn't already a task by title, and hasn't been offered before (`offered`:
// event ids already asked about, either way).
export function nextOffer(events = [], tasks = [], offered = []){
  const asked = new Set(offered);
  const open = tasks.filter((t) => t.status !== "dropped");
  return events.find((e) => e.id && !asked.has(e.id) && !e.taskId && looksLikeTask(e.title)
    && !open.some((t) => sameTitle(t.title, e.title) || sameTitle(t.title, taskTitle(e.title)))) || null;
}
