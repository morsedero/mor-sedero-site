// The Done animations: a burst of colour, the card celebrating, and the
// finished card dropping away as the next one pushes in (now.js). The focus
// screen with its timer that used to live here went with Start (2026-10-20):
// nothing in Daisey runs a timer any more.
import { h } from "./ui.js";

// Bits of colour thrown from (x, y): the sparkle on Done (the
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
  const TIP = 300, g = 0.0019, H = r.height, f = [];
  let t = 0, x = 0, y = 0, a = 0, vy = 0, va = 0;
  for (; P(t / PUSH_MS) < 0.1; t += dt) f.push([t, s * W * P(t / PUSH_MS), 0, 0]);
  const rel = t;
  x = s * W * P(rel / PUSH_MS);
  let vx = s * W * (P(rel / PUSH_MS) - P((rel - dt) / PUSH_MS)) / dt;
  // Until its highest corner is below the screen: tipped over, the far end
  // rides up by W·sin(a), so the card's bottom passing the edge isn't enough.
  const gone = () => { const q = Math.abs(a) * Math.PI / 180; return r.bottom + y - W * Math.sin(q) - H * Math.cos(q) > innerHeight + 24; };
  for (let n = 0; !gone() && n < 300; n++, t += dt) {
    const k = Math.min(1, (t - rel) / TIP); // the pivot eases into the fall
    vy += g * (0.3 + 0.7 * k) * dt; va += s * (0.0003 * (1 - k) + 0.00002 * k) * dt; vx *= k < 1 ? 0.93 : 0.98;
    x += vx * dt; y += vy * dt; a += va * dt;
    f.push([t, x, y, a]);
  }
  // The last frame must sit at offset 1: short of it, the browser fills the
  // gap with an implicit keyframe at the card's own spot, and the copy
  // flashed back there for a frame or two before it was removed (Mor's
  // recording, 2026-10-11).
  const T = f[f.length - 1][0];
  const anim = c.animate(f.map(([ft, fx, fy, fa]) => ({ offset: ft / T,
    transform: `perspective(900px) translate(${fx.toFixed(1)}px, ${fy.toFixed(1)}px) rotate(${fa.toFixed(2)}deg) rotateX(${Math.min(16, fy * 0.03).toFixed(1)}deg)` })),
    { duration: T, easing: "linear", fill: "forwards" });
  // The Done glow fades into the shadow of a card lifted off the page.
  c.animate([{ boxShadow: glow }, { boxShadow: "0 18px 40px rgb(0 0 0 / .2)" }], { duration: 500, easing: "ease-out", fill: "forwards" });
  const done = () => c.remove();
  anim.finished.then(done, done);
  setTimeout(done, T + 400);
}
