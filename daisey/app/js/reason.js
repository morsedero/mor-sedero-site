// The ONE reason line for a task (Mor, 2026-10-18): "Overdue since Wed.",
// "Planned for today.", "Website is in Focus." — so every screen that explains
// why a task is here says it the same way. PURE: data in, words out; the UI
// only places them. Never names the same project twice.
//
// Pieces, as in engine.js: plain strings, and { name } for anything the user
// typed (a project), which the UI wraps in <bdi> so Hebrew and English never
// reorder each other.
import { INBOX, progressOf, getDayKey } from "./model.js";
import { daysOverdue } from "./project-state.js";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MAX_LINES = 2;

const parts = (ymd) => ymd.split("-").map(Number);
// Whole days from the day you're in to ymd: negative = behind you.
const daysTo = (ymd, now) => Math.round((Date.parse(`${ymd}T12:00`) - Date.parse(`${getDayKey(now)}T12:00`)) / 864e5);
// "today" · "tomorrow" · "Wed" (within the next/last 6 days) · "Oct 3".
export function dayWords(ymd, now = Date.now()){
  const d = daysTo(ymd, now);
  if (d === 0) return "today";
  if (d === 1) return "tomorrow";
  if (d === -1) return "yesterday";
  const [y, m, day] = parts(ymd);
  return Math.abs(d) < 7 ? DAYS[new Date(y, m - 1, day).getDay()] : `${MONTHS[m - 1]} ${day}`;
}

// The reasons that apply, strongest first, each a list of pieces.
// ctx: { now, planned: "YYYY-MM-DD" | null (the day of the approved plan
// holding this task), focus: bool (its project is in Focus), projectDue:
// the project's own due date }.
export function reasonPieces(task, { now = Date.now(), planned = null, focus = false, projectDue = null } = {}){
  const out = [];
  const due = task?.due, deadline = task?.dateKind === "deadline";
  if (due && deadline) {
    const over = daysOverdue(task, now);
    out.push(over > 0 ? ["Overdue since ", dayWords(due, now)] : daysTo(due, now) <= 7 ? ["Due ", dayWords(due, now)] : null);
  } else if (due) {
    const d = daysTo(due, now);
    out.push(d < 0 ? ["Target was ", dayWords(due, now)] : d <= 7 ? ["Target ", dayWords(due, now)] : null);
  }
  if (planned) out.push(["Planned for ", dayWords(planned, now)]);
  const named = task?.project && task.project !== INBOX;
  if (projectDue && named) {
    const over = daysOverdue({ due: projectDue }, now) > 0;
    if (over || daysTo(projectDue, now) <= 7) out.push([{ name: task.project }, over ? " was due " : " due ", dayWords(projectDue, now)]);
  }
  if (focus && task?.project && task.project !== INBOX) out.push([{ name: task.project }, " is in Focus"]);
  if (progressOf(task || {}) > 0) out.push([`${progressOf(task)}% done`]);
  // A name once, however many reasons would carry it.
  const seen = new Set();
  return out.filter(Boolean).filter((p) => {
    const names = p.filter((x) => typeof x !== "string").map((x) => x.name.toLowerCase());
    if (names.some((n) => seen.has(n))) return false;
    names.forEach((n) => seen.add(n));
    return true;
  }).slice(0, MAX_LINES);
}

const flat = (p) => p.map((x) => (typeof x === "string" ? x : x.name)).join("");

// { text, lines, pieces }: "Overdue since Wed. Planned for today." Nothing
// to say → text "" (the UI shows no line rather than an empty one).
export function reasonLine(task, ctx = {}){
  const pieces = reasonPieces(task, ctx), lines = pieces.map((p) => flat(p) + ".");
  return { text: lines.join(" "), lines, pieces };
}
