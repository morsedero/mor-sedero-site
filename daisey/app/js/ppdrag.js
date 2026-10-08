// Drag-to-reorder for the proposal's rows (Mor, 2026-10-08: same drag as the
// Schedule's, schedule.js draggable). The row is the handle: a mouse drags
// after a few px, a finger after a short still hold (a quick swipe still
// scrolls); a plain tap still opens the task. A line marks where it lands.
// list: the <ol>. Rows with .pp-drag drag; others (breaks)
// just sit there. onMove(from, to): the item's index → its new one.
// busy(on): the owner holds its redraws while a drag is live.
export function sortable(list, { onMove, busy }){
  let pid = null, armed = false, hold = 0, dragged = false, row = null;
  let y0 = 0, lastY = 0, off = 0, mid0 = 0, s0 = 0, lo = 0, hi = 0, rh = 0, raf = 0;
  let snap = [], to = 0, from = 0, marked = null;
  const rows = () => [...list.querySelectorAll(":scope > .pp-drag")];
  // The nearest scrolling ancestor (the page body, usually).
  const scroller = () => { for (let n = list.parentElement; n; n = n.parentElement) { const o = getComputedStyle(n).overflowY; if ((o === "auto" || o === "scroll") && n.scrollHeight > n.clientHeight) return n; } return document.scrollingElement; };
  let sc = null;
  const top = () => (sc === document.scrollingElement ? 0 : sc.getBoundingClientRect().top);
  const bottom = () => (sc === document.scrollingElement ? innerHeight : sc.getBoundingClientRect().bottom);
  const centre = () => Math.min(hi, bottom() + sc.scrollTop - rh / 2 + 14, Math.max(lo, top() + sc.scrollTop + rh / 2 - 14, lastY + off + sc.scrollTop));
  const unmark = () => { marked?.[0].classList.remove(marked[1]); marked = null; };
  const show = () => {
    row.style.transform = `translateY(${centre() - mid0}px)`;
    const c = centre();
    to = snap.filter((s) => s.mid < c).length;
    unmark();
    if (to !== from) marked = snap[to] ? [snap[to].el, "pp-ins"] : [snap.at(-1).el, "pp-ins-end"];
    if (marked) marked[0].classList.add(marked[1]);
  };
  const tick = () => {
    const Z = 72, up = top() + Z - lastY, down = lastY - (bottom() - Z);
    const v = up > 0 ? -Math.min(1, up / Z) : down > 0 ? Math.min(1, down / Z) : 0;
    if (v) { const was = sc.scrollTop; sc.scrollTop += Math.sign(v) * Math.max(3, Math.abs(v) * 20); if (sc.scrollTop !== was) show(); }
    raf = requestAnimationFrame(tick);
  };
  const arm = () => {
    clearTimeout(hold); armed = dragged = true; busy(true);
    try { row.setPointerCapture(pid); } catch {}
    sc = scroller(); s0 = sc.scrollTop;
    const all = rows();
    from = all.indexOf(row);
    snap = all.filter((r) => r !== row).map((el) => { const r = el.getBoundingClientRect(); return { el, mid: (r.top + r.bottom) / 2 + s0 }; });
    const r = row.getBoundingClientRect(), mid = (r.top + r.bottom) / 2, l = list.getBoundingClientRect();
    off = mid - y0; mid0 = mid + s0; rh = r.height; to = from;
    lo = l.top + s0 - 40; hi = l.bottom + s0 + 40;
    row.classList.add("pp-dragging");
    navigator.vibrate?.(10);
    raf = requestAnimationFrame(tick);
    show();
  };
  const disarm = () => { clearTimeout(hold); pid = null; };
  list.addEventListener("pointerdown", (e) => {
    if (e.button || pid != null) return;
    const r = e.target.closest(".pp-drag");
    if (!r || !list.contains(r) || e.target.closest(".pp-ctls, .pp-fit")) return; // the buttons stay buttons
    row = r; pid = e.pointerId; y0 = lastY = e.clientY; dragged = false;
    if (e.pointerType !== "mouse") hold = setTimeout(arm, 350);
  });
  list.addEventListener("pointermove", (e) => {
    if (e.pointerId !== pid) return;
    lastY = e.clientY;
    if (armed) return show();
    if (Math.abs(lastY - y0) > 6) e.pointerType === "mouse" ? arm() : disarm();
  });
  list.addEventListener("touchmove", (e) => { if (armed) e.preventDefault(); }, { passive: false });
  list.addEventListener("contextmenu", (e) => { if (pid != null) e.preventDefault(); });
  list.addEventListener("click", (e) => { if (dragged) { e.stopPropagation(); e.preventDefault(); dragged = false; } }, true);
  const end = (e) => {
    if (e.pointerId !== pid) return;
    const live = armed; disarm(); armed = false;
    if (!live) return;
    try { row.releasePointerCapture(e.pointerId); } catch {}
    cancelAnimationFrame(raf);
    row.style.transform = ""; row.classList.remove("pp-dragging"); unmark();
    const go = e.type === "pointerup" && to !== from;
    busy(false); // lets the owner redraw (its held redraw, or the move's own)
    if (go) onMove(from, to);
  };
  list.addEventListener("pointerup", end);
  list.addEventListener("pointercancel", end);
}
