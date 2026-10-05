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
// Done is a press-and-hold, not a tap (Mor, 2026-10-05: a mis-tap ended the
// task with no way back). Holding fills the button over a second; letting go
// early drains it again. See holdButton.
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

// Bits of colour thrown from (x, y): the sparkle when a hold completes, the
// confetti when the handoff shows. On <body>, outside the root the timer
// re-renders every second, and gone after the animation. Nothing at all
// under reduced motion.
const COLOURS = ["var(--accent)", "#ff7aa2", "#6cc6ff", "#7ed957", "#b28dff"];
export function burst(x, y, n = 14, reach = 90){
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const box = h("div", { className: "burst", ariaHidden: "true" });
  for (let i = 0; i < n; i++){
    const a = Math.random() * Math.PI * 2, r = reach * (0.5 + Math.random() * 0.5);
    const bit = h("i");
    bit.style.cssText = `left:${x}px;top:${y}px;background:${COLOURS[i % COLOURS.length]};` +
      `--dx:${Math.round(Math.cos(a) * r)}px;--dy:${Math.round(Math.sin(a) * r)}px;` +
      `--rot:${Math.round(Math.random() * 720 - 360)}deg;animation-delay:${Math.round(Math.random() * 90)}ms`;
    box.append(bit);
  }
  document.body.append(box);
  setTimeout(() => box.remove(), 1600);
}
// The handoff's confetti: one big burst from the upper middle of the screen.
export const celebrate = () => burst(innerWidth / 2, innerHeight * 0.35, 60, Math.min(innerWidth, 640) * 0.45);

// The hold-to-finish Done button. The timer re-renders the whole focus screen
// every second, so a fresh button each render would reset a hold half-way:
// the button is built once per run (key) and the same node is handed back
// on every render. Its fill lives on the node (--p), driven by rAF, and the
// release is heard on window, so moving the node mid-hold breaks nothing.
// Pointer or Space/Enter. A quick tap only wiggles and says to hold.
const HOLD_MS = 1000;
let held = null; // { key, el, onDone }: the current run's button

function holdButton(key, aria, disabled, onDone){
  if (held?.key === key){
    const { el } = held, hadFocus = document.activeElement === el;
    held.onDone = onDone; el.disabled = disabled; el.ariaLabel = aria;
    if (hadFocus) queueMicrotask(() => el.focus({ preventScroll: true })); // the re-render detached it
    return el;
  }
  const sub = h("span", { className: "hold-sub", textContent: "press & hold" });
  const el = h("button", { className: "btn primary hold", type: "button", ariaLabel: aria, disabled,
    oncontextmenu: (e) => e.preventDefault() }, // a long press on a phone is not a menu
  h("span", { className: "hold-fill", ariaHidden: "true" }),
  h("span", { className: "hold-label" }, h("span", { textContent: "Done" }), sub));
  const me = held = { key, el, onDone };
  let t0 = 0, raf = 0, done = false;
  const set = (p) => el.style.setProperty("--p", p);
  const listen = (on) => ["pointerup", "pointercancel", "keyup", "blur"].forEach((t) => (on ? addEventListener : removeEventListener)(t, stop));
  const step = (now) => {
    const t = Math.min(1, (now - t0) / HOLD_MS), p = t * t * t; // ease-in: creeps, then rushes to full
    set(p);
    if (t < 1){ raf = requestAnimationFrame(step); return; }
    done = true; listen(false);
    el.classList.remove("holding"); el.classList.add("held");
    sub.textContent = "nice!";
    const r = el.getBoundingClientRect();
    burst(r.left + r.width / 2, r.top + r.height / 2);
    setTimeout(() => me.onDone(), 380); // let the pop land first
  };
  const start = (e) => {
    if (el.disabled || done || t0) return;
    if (e.type === "keydown"){ if (e.repeat || (e.key !== " " && e.key !== "Enter")) return; e.preventDefault(); }
    else if (e.button) return;
    t0 = performance.now();
    el.classList.remove("nudge"); el.classList.add("holding");
    sub.textContent = "keep holding…";
    raf = requestAnimationFrame(step); listen(true);
  };
  function stop(e){
    if (done || !t0) return;
    if (e.type === "keyup" && e.key !== " " && e.key !== "Enter") return;
    const quick = performance.now() - t0 < 300;
    cancelAnimationFrame(raf); listen(false); t0 = 0;
    el.classList.remove("holding"); set(0);
    sub.textContent = quick ? "hold it a sec" : "press & hold";
    if (quick){ el.classList.remove("nudge"); void el.offsetWidth; el.classList.add("nudge"); }
  }
  el.addEventListener("pointerdown", start);
  el.addEventListener("keydown", start);
  return el;
}

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
      holdButton(`${run.taskId}@${run.startedAt}`, `Done: press and hold to finish ${task?.title || "this task"}`, !task, onDone),
      pauseButton(task?.title || "this task", onPause)));
}

// After Done: what Daisey would do next, offered the same way the card does.
// cheer: the first render after finishing. The 🎉 pops in (the caller
// throws the confetti); later re-renders of the same handoff stay still.
export function handoffView(doneTitle, next, { onStart, onSkip, cheer }){
  return h("div", { className: "focus" },
    h("div", { className: "focus-cheer" + (cheer ? " pop" : ""), ariaHidden: "true", textContent: "🎉" }),
    h("div", { className: "focus-done" + (cheer ? " pop" : "") }, "Done. ", bdi(doneTitle)),
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
