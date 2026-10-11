// Focus mode: the whole screen is the task you're on, calm and light (Mor,
// 2026-10-05 redesign): an area-tinted card with the title and a ring timer,
// Pause and Stop as round icons, Done, then +15 min · Pending
// (icon + words). Nothing
// else (the tabs, the Tell bar and the greeting are hidden by body.focus).
//
// Done means finished. Pause only freezes the timer, right here: the screen
// stays, the button turns into Resume (Mor, 2026-10-05: the paused card on
// the main screen had no way back to the normal one). Stop ends the session
// with its time kept and goes back to the normal card (now.js).
//
// Done is one tap (Mor, 2026-10-11); the hold that asked "how much is done"
// went. See holdButton.
//
// +15 min is always there; past the estimate the ring just stays full. No
// sound, no red — running over is normal.
//
// The run lives in Firestore (state/now), so a reload or the other device
// shows the same timer still going; elapsed is always worked out from
// startedAt rather than counted here.
import { h, bdi, dur, icon } from "./ui.js";
import { elapsedMinutes, runCap } from "./reality.js";
import { areaClass, areaName, projectShown } from "./look.js";
import { awayText } from "./deep.js";

const BATCH_NOUN = { call: ["call", "calls"], admin: ["admin bit", "admin bits"], errand: ["errand", "errands"] };
// "3 calls", "1 errand".
export const batchName = (type, n) => `${n} ${(BATCH_NOUN[type] || ["task", "tasks"])[n === 1 ? 0 : 1]}`;

// Minutes since the last tick (or the start): what the next tick books.
// A paused run's clock stands still at pausedAt.
const upTo = (run, now) => run.pausedAt ?? now;
export const sinceMark = (run, now = Date.now()) => Math.max(0, (upTo(run, now) - (run.mark ?? run.startedAt)) / 60000);

// elapsedMinutes and runCap live in reality.js: the server reads runs too.
export { elapsedMinutes, runCap };

// Pausing and resuming the state/now doc. Resuming moves startedAt (and a
// batch's mark) on by the length of the pause, so elapsed carries on from
// where it stopped and nothing else has to know a pause happened.
export const paused = (run, now = Date.now()) => ({ ...run, pausedAt: now });
export function resumed(run, now = Date.now()){
  const { pausedAt, ...rest } = run;
  const gap = Math.max(0, now - (pausedAt ?? now));
  return { ...rest, startedAt: run.startedAt + gap, ...(run.mark != null ? { mark: run.mark + gap } : {}) };
}

export const targetMinutes = (run, task) => (task?.size || 0) + (run.extra || 0);
export const isOver = (run, task, now = Date.now()) => elapsedMinutes(run, now) > targetMinutes(run, task);

// A forgotten timer (weights RUN_ASK): past this many minutes focus mode asks
// "Still on it?", and what Done or Stop books is capped here. "Still on it"
// moves the plan up to now (extra), which moves the cap with it.
export const bookedMinutes = (run, task, now = Date.now()) => Math.min(elapsedMinutes(run, now), runCap(targetMinutes(run, task)));
// What "Still on it" adds to the plan: enough that the plan is now.
export const stillOnMinutes = (run, task, now = Date.now()) => Math.max(0, Math.ceil(elapsedMinutes(run, now) - targetMinutes(run, task)));
// "Finished earlier": the answers to "how long did it take?" — half the plan
// to twice it, in 5-minute steps, none longer than the clock has run.
export function tookOptions(target, elapsed){
  const r5 = (m) => Math.max(5, Math.round(m / 5) * 5);
  const out = [...new Set([0.5, 1, 1.5, 2].map((f) => r5((target || 0) * f)))].filter((m) => m <= elapsed);
  return out.length ? out : [r5(Math.min(target || 5, elapsed))];
}

// mm:ss, and h:mm:ss once it passes an hour — never "72:00".
const clock = (min) => {
  const t = Math.floor(min * 60), p2 = (n) => String(n).padStart(2, "0");
  return t >= 3600 ? `${Math.floor(t / 3600)}:${p2(Math.floor(t / 60) % 60)}:${p2(t % 60)}` : `${Math.floor(t / 60)}:${p2(t % 60)}`;
};

// Bits of colour thrown from (x, y): the sparkle when a hold completes (the
// handoff has its own drifting petals now). On <body>, outside the root the timer
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

// Done on the Now card (Mor, 2026-10-11): confetti thrown from the card's
// middle, past its edges, and four-point stars twinkling round its rim.
export function celebrate(el){
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  burst(cx, cy, 36, Math.max(r.width, r.height) * 0.7);
  const box = h("div", { className: "burst", ariaHidden: "true" });
  const n = 12, per = 2 * (r.width + r.height);
  for (let i = 0; i < n; i++){
    // Evenly round the rim, nudged a little in or out.
    let d = (i + Math.random() * 0.6) / n * per, x, y;
    if (d < r.width) { x = r.left + d; y = r.top; }
    else if ((d -= r.width) < r.height) { x = r.right; y = r.top + d; }
    else if ((d -= r.height) < r.width) { x = r.right - d; y = r.bottom; }
    else { d -= r.width; x = r.left; y = r.bottom - d; }
    const s = h("b");
    s.style.cssText = `left:${Math.round(x + (Math.random() - 0.5) * 16)}px;top:${Math.round(y + (Math.random() - 0.5) * 16)}px;` +
      `--sz:${Math.round(10 + Math.random() * 10)}px;color:${COLOURS[i % COLOURS.length]};animation-delay:${Math.round(60 + Math.random() * 380)}ms`;
    box.append(s);
  }
  document.body.append(box);
  setTimeout(() => box.remove(), 1400);
}

// After Done (Mor, 2026-10-11): the next card pushes in from the start side
// (left; right in RTL) and shoves this one off its spot; it tips over the
// far edge and falls down the screen like a real card. A copy, fixed over
// the page, does the falling so nothing clips it and the next card can
// render in place right away. Its path is a small simulation sampled at
// 60 fps: while the cards touch, this one rides the next card's own curve
// (PUSH_MS / PUSH_EASE = .push-in in app.css); a tenth of its width along
// it goes over the edge, drags as it pivots, then gravity takes it. Tuned
// so it falls down through a phone screen, not out its side.
export const PUSH_MS = 1100;
const PUSH_EASE = [0.4, 0, 0.2, 1];
const bezier = ([x1, y1, x2, y2]) => {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx, cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const X = (t) => ((ax * t + bx) * t + cx) * t, Y = (t) => ((ay * t + by) * t + cy) * t, dX = (t) => (3 * ax * t + 2 * bx) * t + cx;
  return (x) => { let t = x; for (let i = 0; i < 8; i++) { const d = X(t) - x, v = dX(t); if (Math.abs(d) < 1e-6 || !v) break; t -= d / v; } return Y(Math.min(1, Math.max(0, t))); };
};
export function dropAway(el){
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const r = el.getBoundingClientRect(), glow = getComputedStyle(el).boxShadow;
  const rtl = getComputedStyle(el).direction === "rtl", s = rtl ? -1 : 1; // pushed toward the end side
  const c = el.cloneNode(true);
  c.classList.remove("won", "in", "out", "push-in");
  c.querySelector(".won-shine")?.remove();
  c.querySelectorAll("[id]").forEach((n) => n.removeAttribute("id"));
  c.removeAttribute("id"); c.setAttribute("aria-hidden", "true"); c.inert = true;
  c.style.cssText += `;position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;margin:0;z-index:60;` +
    `pointer-events:none;animation:none;transform:none;will-change:transform;transform-origin:${rtl ? "left" : "right"} bottom;box-shadow:${glow}`;
  document.body.append(c);
  const P = bezier(PUSH_EASE), dt = 1000 / 60, W = r.width;
  const TIP = 300, g = 0.0019, end = innerHeight - r.top + W * 0.6, f = [];
  let t = 0, x = 0, y = 0, a = 0, vy = 0, va = 0;
  for (; P(t / PUSH_MS) < 0.1; t += dt) f.push([t, s * W * P(t / PUSH_MS), 0, 0]);
  const rel = t;
  x = s * W * P(rel / PUSH_MS);
  let vx = s * W * (P(rel / PUSH_MS) - P((rel - dt) / PUSH_MS)) / dt;
  for (let n = 0; y < end && n < 240; n++, t += dt) {
    const k = Math.min(1, (t - rel) / TIP); // the pivot eases into the fall
    vy += g * (0.3 + 0.7 * k) * dt; va += s * (0.0003 * (1 - k) + 0.00002 * k) * dt; vx *= k < 1 ? 0.93 : 0.98;
    x += vx * dt; y += vy * dt; a += va * dt;
    f.push([t, x, y, a]);
  }
  const T = t;
  const anim = c.animate(f.map(([ft, fx, fy, fa]) => ({ offset: ft / T,
    transform: `perspective(900px) translate(${fx.toFixed(1)}px, ${fy.toFixed(1)}px) rotate(${fa.toFixed(2)}deg) rotateX(${Math.min(16, fy * 0.03).toFixed(1)}deg)` })),
    { duration: T, easing: "linear", fill: "forwards" });
  // The Done glow fades into the shadow of a card lifted off the page.
  c.animate([{ boxShadow: glow }, { boxShadow: "0 18px 40px rgb(0 0 0 / .2)" }], { duration: 500, easing: "ease-out", fill: "forwards" });
  const done = () => c.remove();
  anim.finished.then(done, done);
  setTimeout(done, T + 400);
}

// The running task's Done button: one tap (Mor, 2026-10-11: the "how much
// is done" hold went). The timer re-renders the whole focus screen every
// second: the button is built once per run (key) and the same node is handed
// back on every render, so focus isn't lost.
let held = null; // { key, el, onDone }: the current run's button

export function holdButton(key, aria, disabled, onDone){
  if (held?.key === key){
    const { el } = held, hadFocus = document.activeElement === el;
    held.onDone = onDone; el.disabled = disabled; el.ariaLabel = aria;
    if (hadFocus) queueMicrotask(() => el.focus({ preventScroll: true })); // the re-render detached it
    return el;
  }
  const el = h("button", { className: "btn primary hold", type: "button", ariaLabel: aria, disabled,
    onclick: () => me.onDone() }, h("span", { className: "hold-label" }, h("span", { textContent: "Done" })));
  const me = held = { key, el, onDone };
  return el;
}

// The ring: a 220px circle, track in the area's border colour, amber
// progress. Past the estimate it just stays full — running over is normal.
const R = 96, C = 2 * Math.PI * R;
function ringParts(){
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 220 220");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "ring-svg");
  const circle = (cls) => {
    const c = document.createElementNS(NS, "circle");
    for (const [k, v] of Object.entries({ cx: 110, cy: 110, r: R, class: cls })) c.setAttribute(k, v);
    return c;
  };
  const track = circle("ring-track"), bar = circle("ring-bar");
  bar.setAttribute("stroke-dasharray", C.toFixed(1));
  bar.setAttribute("transform", "rotate(-90 110 110)");
  svg.append(track, bar);
  const time = h("span", { className: "ring-time", role: "timer" });
  const of = h("span", { className: "ring-of", dir: "auto" });
  return { el: h("div", { className: "ring" }, svg, h("div", { className: "ring-text" }, time, of)), bar, time, of };
}
function setRing(ring, mins, target){
  const p = target > 0 ? Math.min(1, mins / target) : 0;
  ring.bar.setAttribute("stroke-dashoffset", (C * (1 - p)).toFixed(1));
  ring.time.textContent = clock(mins);
  ring.time.ariaLabel = `${dur(Math.round(mins))} so far`;
  ring.of.textContent = target > 0 ? `of ${dur(target)}` : "";
}

// The screen is built once per run and handed back every second with only
// the clock, the ring and the handlers updated (now.js fill leaves an
// unchanged screen be), so nothing on it is rebuilt under a finger.
let screen = null; // { key, el, parts, cb }

// run: the state/now doc. task: the task it names (may be missing if it was
// deleted elsewhere — then Done is disabled).
// Callers: onDone() · onExtend(minutes) · onPause() · onResume() · onStop() · onPending() · onBack()
// (leave Deep Focus, keep the task running on the dashboard).
export function focusView(run, task, cb){
  const key = `${run.taskId}@${run.startedAt}`;
  const mins = elapsedMinutes(run), target = task ? targetMinutes(run, task) : 0;
  const what = task?.title || "this task";
  if (screen?.key !== key) {
    const ring = ringParts();
    const title = h("div", { className: "focus-title", dir: "auto" });
    const quiet = (name, text, aria, fn) => h("button", { className: "btn line withicon", type: "button", ariaLabel: aria, onclick: fn },
      icon(name), h("span", { textContent: text }));
    const hold = holdButton(key, `Done: ${what}`, !task, () => screen?.cb.onDone());
    const stillText = h("p", { className: "focus-still-text" });
    // Forgot to hit Done: "Finished earlier" asks how long it took, and
    // that's what gets booked (and logged, ending when it really ended).
    const stillBtns = h("div", { className: "focus-still-btns" },
      h("button", { className: "btn line", type: "button", textContent: "Still on it",
        onclick: () => screen && screen.cb.onExtend(stillOnMinutes(screen.run, screen.task)) }),
      task && h("button", { className: "btn line", type: "button", textContent: "Finished earlier", onclick: () => askTook() }));
    const still = h("div", { className: "focus-still", role: "status", hidden: true }, stillText, stillBtns);
    const away = h("p", { className: "focus-away", role: "status", hidden: true });
    const askTook = () => {
      const s = screen;
      if (!s) return;
      s.asking = true;
      const go = (m) => { if (m > 0) s.cb.onFinishedAfter?.(m); };
      const other = h("input", { type: "number", min: 1, inputMode: "numeric", className: "focus-took-other", ariaLabel: "Minutes it took" });
      other.addEventListener("keydown", (e) => { if (e.key === "Enter") go(Math.round(Number(other.value))); });
      s.stillText.textContent = "How long did it take?";
      stillBtns.replaceChildren(
        ...tookOptions(targetMinutes(s.run, s.task), elapsedMinutes(s.run)).map((m) =>
          h("button", { className: "chip", type: "button", textContent: dur(m), onclick: () => go(m) })),
        h("span", { className: "focus-took-row" }, other, h("span", { className: "muted", textContent: "min" }),
          h("button", { className: "btn line", type: "button", textContent: "Done", onclick: () => go(Math.round(Number(other.value))) })));
    };
    const el = h("div", { className: "focus" + areaClass(task) },
      h("div", { className: "focus-top" }, h("span", { className: "hero-area" }, h("span", { className: "dot", ariaHidden: "true" }),
        [areaName(task), projectShown(task)].filter(Boolean).join(" · ") || "Focus")),
      h("section", { className: "focus-card", ariaLabel: "Focus" }, title,
        h("p", { className: "focus-hold", textContent: "I'll hold everything else." }), ring.el),
      still,
      away,
      h("div", { className: "focus-spacer" }),
      ctlRow(() => (screen?.paused ? screen.cb.onResume() : screen?.cb.onPause()),
        `Stop ${what} for now; the time so far is kept`, () => screen?.cb.onStop()),
      hold,
      h("div", { className: "focus-row" },
        quiet("plus", "15 min", `Give ${what} 15 more minutes`, () => screen?.cb.onExtend(15)),
        task && quiet("pending", "Pending", `${what} is blocked — stop and set it to Pending`, () => screen?.cb.onPending?.())),
      h("div", { className: "focus-row" },
        // Waiting for a reply (2026-10-07): back to the dashboard card, which asks who; the timer keeps going.
        task && quiet("pending", "Waiting", `waiting for a reply on ${what}: put it on hold, the timer keeps running`, () => screen?.cb.onWait?.()),
        quiet("back", "Dashboard", `Leave Deep Focus; ${what} keeps running`, () => screen?.cb.onBack?.())),
      // Honest about the limit: a web page can't block apps (deep.js).
      h("details", { className: "focus-help" }, h("summary", { textContent: "Block other apps?" }),
        h("p", { textContent: "Daisey can't block apps or silence your phone from here, it only holds the screen and tells you when you've been away. Android can: search Settings for “App pinning” (Samsung: “Pin windows”), turn it on, then pin Daisey from the recent-apps screen." })));
    screen = { key, el, title, ring, hold, still, stillText, away };
  }
  screen.cb = cb;
  screen.run = run;
  screen.task = task;
  const cap = runCap(target);
  screen.still.hidden = !(mins > cap || screen.asking);
  if (mins > cap && !screen.asking) screen.stillText.textContent = `Still on it? It's been ${dur(Math.round(mins))}. If you stopped earlier, Done and Stop count ${dur(Math.round(cap))}.`;
  pauseState(screen.el, !!run.pausedAt, what);
  screen.paused = !!run.pausedAt;
  screen.title.textContent = task?.title || "That task is gone";
  const awayNow = awayText();
  screen.away.hidden = !awayNow;
  screen.away.textContent = awayNow;
  setRing(screen.ring, mins, target);
  holdButton(key, `Done: ${what}`, !task, () => screen?.cb.onDone());
  return screen.el;
}

// Pause/Resume and Stop: two round icon buttons, side by side, centred.
function ctlRow(onPause, stopAria, onStop){
  return h("div", { className: "focus-ctl" },
    h("button", { className: "btn line round pause", type: "button", onclick: onPause }),
    h("button", { className: "btn line round", type: "button", ariaLabel: stopAria, title: "Stop", onclick: onStop }, icon("stop")));
}

// Pause ↔ Resume in place: the button's icon, and the ring's line saying so.
function pauseState(el, isPaused, what){
  el.classList.toggle("paused", isPaused);
  const b = el.querySelector(".btn.pause");
  b.replaceChildren(icon(isPaused ? "play" : "pause"));
  b.title = isPaused ? "Resume" : "Pause";
  b.ariaLabel = isPaused ? `Resume ${what}` : `Pause ${what}; the timer stops until you resume`;
  el.querySelector(".focus-hold").textContent = isPaused ? "Paused. The timer is waiting." : "I'll hold everything else.";
}

// A batch in focus mode: the same card and ring, the checklist under it, one
// timer for the lot. Tick each as it gets done; the last tick ends the batch.
// Pause and Stop work as on one task; Stop ends the batch and the unticked
// stay open. tasks: the batch's tasks in order (missing ones already
// dropped). Callers: onTick(task) · onPause() · onResume() · onStop().
export function batchFocusView(run, tasks, type, { onTick, onPause, onResume, onStop }){
  const mins = elapsedMinutes(run), done = new Set(run.done || []);
  const total = tasks.reduce((s, t) => s + (t.size || 0), 0);
  const ring = ringParts();
  setRing(ring, mins, total);
  ring.of.textContent = `of about ${dur(total)}`;
  const el = h("div", { className: "focus" + areaClass(tasks[0]) },
    h("div", { className: "focus-top" }, h("span", { className: "hero-area" }, h("span", { className: "dot", ariaHidden: "true" }), "Batch")),
    h("section", { className: "focus-card", ariaLabel: "Focus" },
      h("div", { className: "focus-title", textContent: batchName(type, tasks.length) + ", together" }),
      h("p", { className: "focus-hold", textContent: "I'll hold everything else." }), ring.el),
    h("ul", { className: "batch-list" }, ...tasks.map((t) => {
      const ticked = done.has(t.id);
      return h("li", {}, h("button", { type: "button", className: "batch-item" + (ticked ? " done" : ""), disabled: ticked,
        ariaLabel: ticked ? `Done: ${t.title}` : `Mark done: ${t.title}`, onclick: () => onTick(t) },
        h("span", { className: "tk-check" + (ticked ? " done" : ""), textContent: ticked ? "✓" : "" }), bdi(t.title)));
    })),
    h("div", { className: "focus-spacer" }),
    ctlRow(() => (run.pausedAt ? onResume() : onPause()), "Stop the batch; the ones not ticked stay open", () => onStop()));
  pauseState(el, !!run.pausedAt, "the batch");
  return el;
}
