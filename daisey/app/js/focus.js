// Focus mode: the whole screen is the task you're on. Title, a running
// timer, Done and Stop — nothing else (the tabs, the + button and the
// greeting are hidden by body.focus).
//
// Past the estimate it asks once, quietly: "Still on it? +15 min · Stuck".
// No sound, no red — running over is normal. Stop means "pause, still
// mine"; Stuck also sets the task to Pending, so Daisey stops offering it
// until whatever is blocking clears.
//
// The run lives in Firestore (state/now), so a reload or the other device
// shows the same timer still going; elapsed is always worked out from
// startedAt rather than counted here.
import { h, bdi, dur } from "./ui.js";

export const elapsedMinutes = (run, now = Date.now()) => Math.max(0, (now - run.startedAt) / 60000);
export const targetMinutes = (run, task) => (task?.size || 0) + (run.extra || 0);
export const isOver = (run, task, now = Date.now()) => elapsedMinutes(run, now) > targetMinutes(run, task);

// mm:ss, and h:mm:ss once it passes an hour — never "72:00".
const clock = (min) => {
  const t = Math.floor(min * 60), p2 = (n) => String(n).padStart(2, "0");
  return t >= 3600 ? `${Math.floor(t / 3600)}:${p2(Math.floor(t / 60) % 60)}:${p2(t % 60)}` : `${Math.floor(t / 60)}:${p2(t % 60)}`;
};

// run: the state/now doc. task: the task it names (may be missing if it was
// deleted elsewhere — then only Stop is offered).
// Callers: onDone(finished) · onStop({ pending }) · onExtend(minutes).
export function focusView(run, task, { onDone, onStop, onExtend }, state = {}){
  const mins = elapsedMinutes(run);
  const over = task && isOver(run, task);

  // "Done" asks the one question the spec wants: finished, or more left?
  if (state.asking) {
    return h("div", { className: "focus" },
      h("div", { className: "focus-title", dir: "auto", textContent: task?.title || "That task is gone" }),
      h("p", { className: "focus-ask", textContent: "Finished, or more left?" }),
      h("div", { className: "focus-actions" },
        h("button", { className: "btn primary", type: "button", textContent: "Finished",
          ariaLabel: `Finished: ${task?.title || "this task"}`, onclick: () => onDone(true) }),
        h("button", { className: "btn", type: "button", textContent: "More left",
          ariaLabel: "More left: keep the task, save the time spent", onclick: () => onDone(false) })));
  }

  return h("div", { className: "focus" },
    h("div", { className: "focus-title", dir: "auto", textContent: task?.title || "That task is gone" }),
    h("div", { className: "focus-timer", role: "timer", ariaLabel: `${dur(Math.round(mins))} so far`, textContent: clock(mins) }),
    task && h("div", { className: "focus-of", dir: "auto", textContent: `of ${dur(targetMinutes(run, task))}` }),
    over && h("div", { className: "focus-over" },
      h("p", { className: "focus-ask", textContent: "Still on it?" }),
      h("div", { className: "focus-chips" },
        h("button", { className: "chip", type: "button", textContent: "+15 min",
          ariaLabel: "Still on it: give it 15 more minutes", onclick: () => onExtend(15) }),
        h("button", { className: "chip", type: "button", textContent: "Stuck",
          ariaLabel: "Stuck: stop and set this task to Pending", onclick: () => onStop({ pending: true }) }))),
    h("div", { className: "focus-actions" },
      h("button", { className: "btn primary", type: "button", textContent: "Done",
        ariaLabel: `Done with ${task?.title || "this task"}`, onclick: () => onDone(), disabled: !task }),
      h("button", { className: "btn quiet", type: "button", textContent: "Stop",
        ariaLabel: "Stop without finishing; the time still counts and the task stays yours", onclick: () => onStop() })));
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
