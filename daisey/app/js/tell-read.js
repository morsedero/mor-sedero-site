// Tell Daisey's two steps either side of the helper, PURE (no DOM, no
// Firebase), so test/phrases/run.mjs runs exactly what the bar runs:
// requestBody() is what goes to functions/daisey-now-chat.js, understood()
// is what the cards are drawn from once the answer is back.
import { localDate, getDayKey } from "./model.js";
import { withSpoken } from "./duration.js";
import { toMin, usualHours, minText, LATE_END_MAX } from "./day.js";
import { repeatFrom } from "./routine.js";

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
