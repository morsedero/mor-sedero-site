// The home panel's two pages, Schedule and Projects (layout round 3, Mor
// 2026-10-06; New Design/6 and 7): a segmented control with two page dots
// under it. Tap a tab, or swipe sideways inside the panel, to switch; the
// track follows the finger. The last tab is remembered on this device.
const KEY = "daisey.panel";
const SWIPE = 60; // px sideways that turns the page
const TABS = ["schedule", "projects"];

export function mountPanel({ panel, tabs, track }){
  let cur = (() => { try { return TABS.indexOf(localStorage.getItem(KEY)); } catch { return -1; } })();
  if (cur < 0) cur = 0;
  const wrap = track.parentElement;
  const rtl = () => getComputedStyle(panel).direction === "rtl";

  function show(i, { save = true } = {}){
    cur = i;
    track.style.transform = `translateX(${(rtl() ? 100 : -100) * i}%)`;
    panel.dataset.page = TABS[i];
    tabs.forEach((t, k) => { t.ariaSelected = String(k === i); t.tabIndex = k === i ? 0 : -1; });
    // The page out of view stays out of the tab order.
    [...track.children].forEach((p, k) => { p.inert = k !== i; });
    if (save) try { localStorage.setItem(KEY, TABS[i]); } catch { /* private window */ }
  }
  tabs.forEach((t, k) => { t.onclick = () => show(k); });
  panel.querySelector('[role="tablist"]').addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const fwd = (e.key === "ArrowRight") !== rtl();
    show(Math.max(0, Math.min(TABS.length - 1, cur + (fwd ? 1 : -1))));
    tabs[cur].focus();
  });

  // Swipe: horizontal moves only (touch-action: pan-y leaves vertical
  // scrolling to the page). A drag never also counts as a tap.
  let s = null, dragged = false;
  wrap.addEventListener("pointerdown", (e) => {
    if (e.target.closest("input, textarea")) return;
    s = { x: e.clientX, y: e.clientY, id: e.pointerId, dx: 0 };
    dragged = false;
  });
  wrap.addEventListener("pointermove", (e) => {
    if (!s) return;
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    if (!dragged) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { s = null; return; }
      if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      dragged = true;
      try { wrap.setPointerCapture(s.id); } catch { /* gone */ }
      panel.classList.add("dragging");
    }
    s.dx = dx;
    const base = (rtl() ? 100 : -100) * cur;
    track.style.transform = `translateX(calc(${base}% + ${dx}px))`;
  });
  const end = () => {
    if (!s) return;
    const dx = s.dx; s = null;
    panel.classList.remove("dragging");
    if (!dragged) return;
    const fwd = rtl() ? dx > SWIPE : dx < -SWIPE, back = rtl() ? dx < -SWIPE : dx > SWIPE;
    show(fwd ? Math.min(TABS.length - 1, cur + 1) : back ? Math.max(0, cur - 1) : cur);
  };
  wrap.addEventListener("pointerup", end);
  wrap.addEventListener("pointercancel", end);
  wrap.addEventListener("click", (e) => { if (dragged) { e.preventDefault(); e.stopImmediatePropagation(); dragged = false; } }, true);

  show(cur, { save: false });
  return { show: (name) => show(Math.max(0, TABS.indexOf(name))), unmount(){} };
}
