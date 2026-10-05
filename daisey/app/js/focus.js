// Focus mode: the whole screen is the task you're on. Title, a running
// timer, Done and Pause — nothing else (the tabs, the + button and the
// greeting are hidden by body.focus).
//
// Two ways out (Mor, 2026-10-05, after Stop, then Pause + Cancel, then a
// "Finished, or more left?" question all felt like too many). Done means
// finished. Pause freezes the timer and goes back to the main screen, where
// the card holds the paused task: Resume, or the card's own Later · Switch ·
// Pending, any of which ends the session with its time kept (now.js).
//
// Past the estimate it asks once, quietly: "Still on it? +15 min". No
// sound, no red — running over is normal.
//
// The run lives in Firestore (state/now), so a reload or the other device
// shows the same timer still going; elapsed is always worked out from
// startedAt rather than counted here.
import { h, bdi, dur } from "./ui.js";

const BATCH_NOUN = { call: ["call", "calls"], admin: ["admin bit", "admin bits"], errand: ["errand", "errands"] };
// "3 calls", "1 errand".
export const batchName = (type, n) => `${n} ${(BATCH_NOUN[type] || ["task", "tasks"])[n === 1 ? 0 : 1]}`;

// Minutes since the last tick (or the start): what the next tick books.
// A paused run's clock stands still at pausedAt.
const upTo = (run, now) => run.pausedAt ?? now;
export const sinceMark = (run, now = Date.now()) => Math.max(0, (upTo(run, now) - (run.mark ?? run.startedAt)) / 60000);

export const elapsedMinutes = (run, now = Date.now()) => Math.max(0, (upTo(run, now) - run.startedAt) / 60000);

// Pausing and resuming the state/now doc. Resuming moves startedAt (and a
// batch's mark) on by the length of the pause, so elapsed carries on from
// where it stopped and nothing else has to know a pause happened.
export const paused = (run, now = Date.now()) => ({ ...run, pausedAt: now });
export function resumed(run, now = Date.now()){
  const { pausedAt, ...rest } = run;
  const gap = Math.max(0, now - (pausedAt ?? now));
  return { ...rest, startedAt: run.startedAt + gap, ...(run.mark != null ? { mark: run.mark + gap } : {}) };
}

const pauseButton = (what, onPause) => h("button", { className: "btn", type: "button", textContent: "Pause",
  ariaLabel: `Pause ${what} and go back to the main screen`, onclick: () => onPause() });
export const targetMinutes = (run, task) => (task?.size || 0) + (run.extra || 0);
export const isOver = (run, task, now = Date.now()) => elapsedMinutes(run, now) > targetMinutes(run, task);

// mm:ss, and h:mm:ss once it passes an hour — never "72:00".
const clock = (min) => {
  const t = Math.floor(min * 60), p2 = (n) => String(n).padStart(2, "0");
  return t >= 3600 ? `${Math.floor(t / 3600)}:${p2(Math.floor(t / 60) % 60)}:${p2(t % 60)}` : `${Math.floor(t / 60)}:${p2(t % 60)}`;
};

// run: the state/now doc. task: the task it names (may be missing if it was
// deleted elsewhere — then Done is disabled).
// Callers: onDone() · onExtend(minutes) · onPause().
export function focusView(run, task, { onDone, onExtend, onPause }){
  const mins = elapsedMinutes(run);
  const over = task && isOver(run, task);

  return h("div", { className: "focus" },
    h("div", { className: "focus-title", dir: "auto", textContent: task?.title || "That task is gone" }),
    h("div", { className: "focus-timer", role: "timer", ariaLabel: `${dur(Math.round(mins))} so far`, textContent: clock(mins) }),
    task && h("div", { className: "focus-of", dir: "auto", textContent: `of ${dur(targetMinutes(run, task))}` }),
    over && h("div", { className: "focus-over" },
      h("p", { className: "focus-ask", textContent: "Still on it?" }),
      h("div", { className: "focus-chips" },
        h("button", { className: "chip", type: "button", textContent: "+15 min",
          ariaLabel: "Still on it: give it 15 more minutes", onclick: () => onExtend(15) }))),
    h("div", { className: "focus-actions" },
      h("button", { className: "btn primary", type: "button", textContent: "Done",
        ariaLabel: `Done: ${task?.title || "this task"} is finished`, onclick: () => onDone(), disabled: !task }),
      pauseButton(task?.title || "this task", onPause)));
}

// After Done: what Daisey would do next, offered the same way the card does.
export function handoffView(doneTitle, next, { onStart, onSkip }){
  return h("div", { className: "focus" },
    h("div", { className: "focus-done" }, "Done. ", bdi(doneTitle)),
    next
      ? h("div", { className: "now-card main" },
        h("div", { className: "now-meta", dir: "auto", textContent: "Next" }),
        h("div", { className: "now-title", dir: "auto", textContent: next.task.title }),
        next.why && h("p", { className: "now-why", textContent: next.why }),
        h("button", { className: "btn primary start", type: "button", textContent: "Start",
          ariaLabel: `Start: ${next.task.title}`, onclick: () => onStart(next.task) }),
        h("div", { className: "now-actions" },
          h("button", { className: "btn quiet", type: "button", textContent: "Not now",
            ariaLabel: `Not now: skip ${next.task.title}`, onclick: () => onSkip(next.task) })))
      : h("div", { className: "focus-actions" },
        h("p", { className: "focus-ask", textContent: "Nothing else fits right now. Take the break." }),
        h("button", { className: "btn", type: "button", textContent: "Back", onclick: () => onSkip(null) })));
}

// A batch in focus mode: a checklist, one timer for the lot. Tick each as it
// gets done; the last tick ends the batch. Pause goes back to the main
// screen, where the batch can be resumed or ended (the unticked stay open).
// tasks: the batch's tasks in order (missing ones already dropped).
// Callers: onTick(task) · onPause().
export function batchFocusView(run, tasks, type, { onTick, onPause }){
  const mins = elapsedMinutes(run), done = new Set(run.done || []);
  const total = tasks.reduce((s, t) => s + (t.size || 0), 0);
  return h("div", { className: "focus" },
    h("div", { className: "focus-title", textContent: batchName(type, tasks.length) + ", together" }),
    h("div", { className: "focus-timer", role: "timer", ariaLabel: `${dur(Math.round(mins))} so far`, textContent: clock(mins) }),
    h("div", { className: "focus-of", textContent: `of about ${dur(total)}` }),
    h("ul", { className: "batch-list" }, ...tasks.map((t) => {
      const ticked = done.has(t.id);
      return h("li", {}, h("button", { type: "button", className: "batch-item" + (ticked ? " done" : ""), disabled: ticked,
        ariaLabel: ticked ? `Done: ${t.title}` : `Mark done: ${t.title}`, onclick: () => onTick(t) },
        h("span", { className: "tk-check" + (ticked ? " done" : ""), textContent: ticked ? "✓" : "" }), bdi(t.title)));
    })),
    h("div", { className: "focus-actions" }, pauseButton("the batch", onPause)));
}
