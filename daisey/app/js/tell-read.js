// Tell Daisey's two steps either side of the helper, PURE (no DOM, no
// Firebase), so test/phrases/run.mjs runs exactly what the bar runs:
// requestBody() is what goes to functions/daisey-now-chat.js, understood()
// is what the cards are drawn from once the answer is back.
import { localDate, getDayKey } from "./model.js";
import { withSpoken } from "./duration.js";
import { toMin, usualHours, minText, LATE_END_MAX } from "./day.js";
import { repeatFrom } from "./routine.js";
import { dateFrom } from "./when.js";

// now: the task id on the Now card. With recent (the 3 open tasks added or
// edited last, newest first) it's what "done", "push it", "no, make it 30"
// point at when no task is named (phrase bank 2026-10-19: without them the
// helper asked "which task?" or changed the wrong one).
export function requestBody(text, tasks, { guest = false, now = null } = {}){
  const open = tasks.filter((t) => t.status !== "done" && t.status !== "dropped");
  const at = (t) => Math.max(Number(t.editedAt) || 0, Number(t.createdAt) || 0);
  const recent = open.filter(at).sort((a, b) => at(b) - at(a)).slice(0, 3).map((t) => t.id);
  return {
    ...(now && open.some((t) => t.id === now) ? { now } : {}),
    ...(recent.length ? { recent } : {}),
    // today: the day key (daybound.js), the cards' today. Still up past
    // midnight, before 04:00, that's yesterday's date, and the helper is told
    // (afterMidnight): "yesterday", "today" and "tomorrow" count from it.
    text, today: getDayKey(), weekday: new Date(`${getDayKey()}T12:00`).toLocaleDateString("en", { weekday: "long" }),
    ...(getDayKey() !== localDate() ? { afterMidnight: true } : {}),
    ...(guest ? { guest: true } : {}),
    tasks: open.map((t) => ({ id: t.id, title: t.title, project: t.project, due: t.due || undefined, status: t.status })),
    projects: [...new Set(open.map((t) => t.project))],
  };
}

// The helper's whole answer as the panel shows it: the days worked out from
// the user's words (withDates), then understood() on the actions; a day
// may turn one card into a question. And a guard: "I didn't do it" is never
// a Done (phrase bank 2026-10-19: the helper marked the Now card done).
export function readAnswer({ reply = "", actions = [], question, choices = [] }, text, settings = {}, { now = null } = {}){
  const said = /\b(didn'?t|did not|haven'?t|have not|not done|never did)\b|לא (עשיתי|סיימתי|הספקתי)/i.test(text);
  // Days first: a repeat (withRepeats) turns a due date into its end.
  // Later with no task named is the Now card's.
  const named = actions.map((a) => (a.kind === "later" && !a.taskId && now ? { ...a, taskId: now } : a));
  const dated = withDates(named.filter((a) => !(said && a.kind === "done")), text);
  const list = understood(dated.actions, text, settings);
  if (!dated.ask) return { reply, actions: list, ...(question ? { question, choices } : {}) };
  return { reply: dated.ask.question, actions: list, question: dated.ask.question, choices: dated.ask.choices };
}

// The day each card means, from the user's words (when.js), not from the
// helper's own sum: it copies the words into dateWords (here: when). A
// card whose words fit two days ("tomorrow at 8" at 03:44) becomes a
// question; the chip's answer comes back in the text ("(Which day? → Tue 20
// Oct)") and settles it. Words it can't read leave the helper's date.
const DATE_FIELDS = ["due", "notBefore", "date", "checkOn"];
const he = (s) => /[֐-׿]/.test(s);
const label = (ymd, text) => new Date(`${ymd}T12:00`).toLocaleDateString(he(text) ? "he" : "en", { weekday: "short", day: "numeric", month: "short" });
function withDates(actions, text){
  const picked = (String(text).match(/→ ([^)\n]+)\)\s*$/) || [])[1];
  let ask = null;
  const out = actions.flatMap((a) => {
    if (!a.when) return [a];
    const { when, ...b } = a;
    const r = dateFrom(when, Date.now(), { timed: b.kind === "event" });
    // words that aren't a day ("later"): an update left with nothing to change goes
    if (!r) return b.kind === "update" && !["title", "project", "size", "due", "dateKind", "notBefore"].some((k) => b[k] != null) ? [] : [b];
    let date = r.date;
    if (r.ask) {
      date = r.ask.find((d) => label(d, text) === picked);
      if (!date) { ask = { question: he(text) ? "לאיזה יום?" : "Which day?", choices: r.ask.map((d) => label(d, text)) }; return []; }
    }
    const field = DATE_FIELDS.find((f) => b[f]) || (b.kind === "event" || b.kind === "query" ? "date" : b.kind === "waiting" ? "checkOn" : "due");
    return [{ ...b, [field]: date }];
  });
  return { actions: out, ask };
}

// The helper's actions as the cards show them: a duration typed in the
// sentence wins (duration.js withSpoken), a day end past what a day can run
// to is held at the latest, and repeats are read (withRepeats).
export function understood(actions, text, settings = {}){
  // "Until 1am" runs past midnight (day.js dayHours), up to 04:00 (LATE_END_MAX); an
  // end between that and the day's start ("until 6am") can't be, so it
  // stops at the latest one and says so.
  const endOk = (m) => m < LATE_END_MAX || m > usualHours(settings).start;
  return withRepeats(withSpoken(actions, text).map((a) => (a.kind === "moment" && a.dayEnd && toMin(a.dayEnd) != null && !endOk(toMin(a.dayEnd))
    ? { ...a, dayEnd: minText(LATE_END_MAX - 1), latest: true } : a)), text);
}

// A repeat in the words ("water plants every weekday", 2026-10-15: it was
// saved as a one-off): read here (routine.repeatFrom), so it holds with or
// without the helper. The helper's own read comes first; then the card's
// title; then, for a lone new task, the whole message (the helper may have
// taken the words out of the title). A routine has no due date: one given
// is its end.
function withRepeats(actions, text){
  const adds = actions.filter((a) => a.kind === "add");
  return actions.map((a) => {
    if (a.kind !== "add") return a;
    const inTitle = repeatFrom(a.title);
    let r = a.routine || inTitle?.routine || (adds.length === 1 ? repeatFrom(text)?.routine : null);
    if (!r) return a;
    if (r.every === "month" && !r.on) r = { ...r, on: a.notBefore || getDayKey() }; // its day is every month's
    const { due, dateKind, ...rest } = a;
    return { ...rest, title: inTitle?.title || a.title, routine: { ...r, ...(due && !r.until ? { until: due } : {}) } };
  });
}
