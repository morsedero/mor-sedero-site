// Drag-to-reorder for the proposal's rows (Mor, 2026-10-08: same drag as the
// Schedule's, schedule.js draggable). The row is the handle: a mouse drags
// after a few px, a finger after a short still hold (a quick swipe still
// scrolls); a plain tap still opens the task. The rows in the way slide over
// to make room (pusher, below).
// list: the <ol>. Rows with .pp-drag drag; others just sit there.
// onMove(row, before): the dragged row lands before that row (null: last).
// busy(on): the owner holds its redraws while a drag is live.
// grid: the rows sit in a multi-column grid: the row follows the pointer
// both ways and lands before/after the nearest one.
export function sortable(list, { onMove, busy, grid = false }){
  let pid = null, armed = false, hold = 0, dragged = false, row = null;
  let x0 = 0, lastX = 0, cx0 = 0, y0 = 0, lastY = 0, off = 0, mid0 = 0, s0 = 0, lo = 0, hi = 0, rh = 0, raf = 0;
  let snap = [], to = 0, from = 0, push = null;
  const rows = () => [...list.querySelectorAll(":scope > .pp-drag")];
  // The nearest scrolling ancestor (the page body, usually).
  const scroller = () => { for (let n = list.parentElement; n; n = n.parentElement) { const o = getComputedStyle(n).overflowY; if ((o === "auto" || o === "scroll") && n.scrollHeight > n.clientHeight) return n; } return document.scrollingElement; };
  let sc = null;
  const top = () => (sc === document.scrollingElement ? 0 : sc.getBoundingClientRect().top);
  const bottom = () => (sc === document.scrollingElement ? innerHeight : sc.getBoundingClientRect().bottom);
  const centre = () => Math.min(hi, bottom() + sc.scrollTop - rh / 2 + 14, Math.max(lo, top() + sc.scrollTop + rh / 2 - 14, lastY + off + sc.scrollTop));
  const show = () => {
    let c = centre();
    if (grid) {
      const dy = lastY - y0 + sc.scrollTop - s0, cx = cx0 + lastX - x0, cy = mid0 + dy;
      row.style.transform = `translate(${lastX - x0}px, ${dy}px)`;
      let best = -1, d = Infinity;
      snap.forEach((s, k) => { const e = (s.cx - cx) ** 2 + (s.mid - cy) ** 2; if (e < d) { d = e; best = k; } });
      const n = snap[best];
      to = !n ? 0 : best + (Math.abs(cy - n.mid) < n.h / 2 ? (cx > n.cx ? 1 : 0) : (cy > n.mid ? 1 : 0));
    } else {
      row.style.transform = `translateY(${c - mid0}px)`;
      to = snap.filter((s) => s.mid < c).length;
    }
    to === from ? push.home() : push.to(snap[to]?.el, snap.at(-1)?.el);
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
    snap = all.filter((r) => r !== row).map((el) => { const r = el.getBoundingClientRect(); return { el, mid: (r.top + r.bottom) / 2 + s0, cx: (r.left + r.right) / 2, h: r.height }; });
    const r = row.getBoundingClientRect(), mid = (r.top + r.bottom) / 2, l = list.getBoundingClientRect();
    off = mid - y0; mid0 = mid + s0; cx0 = (r.left + r.right) / 2; rh = r.height; to = from;
    lo = l.top + s0 - 40; hi = l.bottom + s0 + 40;
    push = pusher(list, row, grid);
    row.classList.add("pp-dragging");
    navigator.vibrate?.(10);
    raf = requestAnimationFrame(tick);
    show();
  };
  const disarm = () => { clearTimeout(hold); pid = null; };
  list.addEventListener("pointerdown", (e) => {
    if (e.button || pid != null) return;
    const r = e.target.closest(".pp-drag");
    if (!r || !list.contains(r) || e.target.closest(".pp-ctls, .pp-fit, .pj-tick")) return; // the buttons stay buttons
    row = r; pid = e.pointerId; x0 = lastX = e.clientX; y0 = lastY = e.clientY; dragged = false;
    if (e.pointerType !== "mouse") hold = setTimeout(arm, 350);
  });
  list.addEventListener("pointermove", (e) => {
    if (e.pointerId !== pid) return;
    lastX = e.clientX; lastY = e.clientY;
    if (armed) return show();
    // A mouse drags on a mostly-vertical pull (sideways is a task's swipe to finish);
    // a finger that moves before the hold is up is scrolling or swiping.
    const dx = Math.abs(lastX - x0), dy = Math.abs(lastY - y0);
    if (e.pointerType !== "mouse") { if (dx > 6 || dy > 6) disarm(); }
    else if (grid ? dx > 6 || dy > 6 : dy > 6 && dy > dx) arm();
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
    row.style.transform = ""; row.classList.remove("pp-dragging"); push.done();
    const go = e.type === "pointerup" && to !== from;
    busy(false); // lets the owner redraw (its held redraw, or the move's own)
    if (go) onMove(row, snap[to]?.el || null);
  };
  list.addEventListener("pointerup", end);
  list.addEventListener("pointercancel", end);
}

// Push, not a line (Mor, 2026-10-08): while a row is dragged, every row
// between where it was and where it would land slides over to make room.
// box: the rows' parent; row: the dragged one. grid: each slides into its
// neighbour's place (cards in columns); else up or down by the row's height.
// to(before, last): it would land before that element (none: after last).
// home(): back where it was, nothing moves. done(): all back, for the redraw.
export function pusher(box, row, grid = false){
  const kids = [...box.children], at = kids.indexOf(row);
  const r = kids.map((k) => k.getBoundingClientRect());
  const me = r[at], nx = r[at + 1], pv = r[at - 1];
  const D = me.height + Math.max(0, nx ? nx.top - me.bottom : pv ? me.top - pv.bottom : 0);
  const slide = (T) => kids.forEach((k, i) => {
    if (i === at) return;
    const j = T > at && i > at && i < T ? i - 1 : T <= at && i >= T && i < at ? i + 1 : i;
    k.style.transform = j === i ? "" : grid ? `translate(${r[j].left - r[i].left}px, ${r[j].top - r[i].top}px)` : `translateY(${j < i ? -D : D}px)`;
  });
  box.classList.add("pushing");
  return {
    to: (before, last) => slide(before ? kids.indexOf(before) : last ? kids.indexOf(last) + 1 : at + 1),
    home: () => slide(at + 1),
    done: () => { slide(at + 1); setTimeout(() => box.classList.remove("pushing"), 220); },
  };
}

// Drop areas (the Projects page's tiers, Mor 2026-10-08: "an area to drop
// to", not one more box to push around). root holds .pp-zone areas, each
// its header and then its .pp-drag cards. Same feel as sortable: a mouse
// drags after a few px, a finger after a short still hold. The card itself
// moves in the DOM to where it would land — its empty place is the gap —
// while a transform keeps it under the finger; everything else glides to
// its new place (FLIP). Areas never slide like cards: the one under the
// finger lights up whole (onZone) and grows or shrinks smoothly (its height
// animates), so the ones below just follow. Smoothness (Mor, 2026-10-08:
// "the other bricks snap too fast"): one slow-out glide for all of it, a
// card mid-glide is measured where it really is, the target area only
// changes once the finger is clearly in another, and the card eases into
// its slot on release instead of jumping.
// onMove(card, zone, before): it landed in that area, before that card
// (null: last). onZone(zone | null, card): where it is over, null at the end.
export function zoneSortable(root, { onMove, busy, onZone }){
  let pid = null, armed = false, hold = 0, dragged = false, card = null, raf = 0, sc = null;
  let x0 = 0, y0 = 0, lastY = 0, start = 0, home = null, over = null, settle = 0, settling = false;
  const MS = 280, EASE = "cubic-bezier(.2, .8, .2, 1)", STAY = 16; // STAY: px past an area's edge before the target moves on
  const zones = () => [...root.querySelectorAll(":scope .pp-zone")];
  const cardsIn = (z) => [...z.querySelectorAll(":scope > .pp-drag")].filter((c) => c !== card);
  const nextCard = (el) => { let n = el.nextElementSibling; while (n && !n.classList.contains("pp-drag")) n = n.nextElementSibling; return n; };
  // Layout positions in root (offsetTop: transforms don't count), so a card
  // still gliding doesn't throw the aim off.
  const rootTop = () => root.getBoundingClientRect().top;
  const scroller = () => { for (let n = root.parentElement; n; n = n.parentElement) { const o = getComputedStyle(n).overflowY; if ((o === "auto" || o === "scroll") && n.scrollHeight > n.clientHeight) return n; } return document.scrollingElement; };
  const follow = () => { card.style.transform = `translateY(${start + (lastY - y0) - (rootTop() + card.offsetTop)}px)`; };
  const flip = (move) => {
    const zs = zones(), kids = zs.flatMap((z) => [...z.children]).filter((e) => e !== card);
    const wasTop = new Map(kids.map((e) => [e, e.getBoundingClientRect().top])); // as seen, mid-glide too
    const wasH = new Map(zs.map((z) => [z, z.getBoundingClientRect().height]));
    move();
    // Where everything ends up: no running glide, natural area heights.
    for (const e of kids) { e.style.transition = "none"; e.style.transform = ""; }
    for (const z of zs) { z.style.transition = "none"; z.style.height = ""; }
    const toH = new Map(zs.map((z) => [z, z.getBoundingClientRect().height]));
    // Areas start at the height they had, so nothing below moves this frame.
    for (const z of zs) z.style.height = `${wasH.get(z)}px`;
    for (const e of kids) { const d = wasTop.get(e) - e.getBoundingClientRect().top; if (Math.abs(d) >= 1) e.style.transform = `translateY(${d}px)`; }
    root.getBoundingClientRect(); // that start frame is the one painted
    for (const e of kids) { e.style.transition = `transform ${MS}ms ${EASE}`; e.style.transform = ""; }
    for (const z of zs) { z.style.transition = `height ${MS}ms ${EASE}, background-color .2s ease, box-shadow .2s ease`; z.style.height = `${toH.get(z)}px`; }
    clearTimeout(settle);
    settle = setTimeout(() => zs.forEach((z) => { z.style.height = ""; z.style.transition = ""; }), MS + 30);
  };
  const show = () => {
    const y = lastY - rootTop(), zs = zones();
    const inside = (a) => y >= a.offsetTop - STAY && y < a.offsetTop + a.offsetHeight + STAY;
    const z = over && inside(over) ? over : zs.find((a) => y < a.offsetTop + a.offsetHeight) || zs.at(-1);
    const before = cardsIn(z).find((c) => y < c.offsetTop + c.offsetHeight / 2) || null;
    if (card.parentElement !== z || nextCard(card) !== before) flip(() => (before ? z.insertBefore(card, before) : z.append(card)));
    if (z !== over) { over = z; onZone?.(z, card); }
    follow();
  };
  const tick = () => {
    const top = sc === document.scrollingElement ? 0 : sc.getBoundingClientRect().top;
    const bottom = sc === document.scrollingElement ? innerHeight : sc.getBoundingClientRect().bottom;
    const Z = 72, up = top + Z - lastY, down = lastY - (bottom - Z);
    const v = up > 0 ? -Math.min(1, up / Z) : down > 0 ? Math.min(1, down / Z) : 0;
    if (v) { const was = sc.scrollTop; sc.scrollTop += Math.sign(v) * Math.max(3, Math.abs(v) * 20); if (sc.scrollTop !== was) { start -= sc.scrollTop - was; show(); } }
    raf = requestAnimationFrame(tick);
  };
  const arm = () => {
    clearTimeout(hold); armed = dragged = true; busy(true);
    try { root.setPointerCapture(pid); } catch {} // the root: the card moves in the DOM, which would drop a capture on it
    sc = scroller();
    start = card.getBoundingClientRect().top;
    home = { zone: card.parentElement, before: nextCard(card) };
    card.classList.add("pp-dragging");
    root.classList.add("zone-dragging");
    navigator.vibrate?.(10);
    raf = requestAnimationFrame(tick);
    show();
  };
  const disarm = () => { clearTimeout(hold); pid = null; };
  root.addEventListener("pointerdown", (e) => {
    if (e.button || pid != null || settling) return;
    const c = e.target.closest(".pp-drag");
    if (!c || !root.contains(c)) return;
    card = c; pid = e.pointerId; x0 = e.clientX; y0 = lastY = e.clientY; dragged = false;
    if (e.pointerType !== "mouse") hold = setTimeout(arm, 350);
  });
  root.addEventListener("pointermove", (e) => {
    if (e.pointerId !== pid) return;
    lastY = e.clientY;
    if (armed) return show();
    const dx = Math.abs(e.clientX - x0), dy = Math.abs(lastY - y0);
    if (e.pointerType !== "mouse") { if (dx > 6 || dy > 6) disarm(); }
    else if (dx > 6 || dy > 6) arm();
  });
  root.addEventListener("touchmove", (e) => { if (armed) e.preventDefault(); }, { passive: false });
  root.addEventListener("contextmenu", (e) => { if (pid != null) e.preventDefault(); });
  root.addEventListener("click", (e) => { if (dragged) { e.stopPropagation(); e.preventDefault(); dragged = false; } }, true);
  const end = (e) => {
    if (e.pointerId !== pid) return;
    const live = armed; disarm(); armed = false;
    if (!live) return;
    try { root.releasePointerCapture(e.pointerId); } catch {}
    cancelAnimationFrame(raf);
    const zone = card.parentElement, before = nextCard(card);
    const go = e.type === "pointerup" && (zone !== home.zone || before !== home.before);
    if (!go) flip(() => (home.before ? home.zone.insertBefore(card, home.before) : home.zone.append(card)));
    over = null; onZone?.(null, card); root.classList.remove("zone-dragging");
    // Ease into the slot, then let the owner redraw.
    const c = card; settling = true;
    c.style.transition = `transform ${MS}ms ${EASE}, scale ${MS}ms ${EASE}, box-shadow ${MS}ms ${EASE}`;
    c.style.transform = ""; c.classList.remove("pp-dragging");
    setTimeout(() => { c.style.transition = ""; settling = false; busy(false); if (go) onMove(c, zone, before); }, MS);
  };
  root.addEventListener("pointerup", end);
  root.addEventListener("pointercancel", end);
}
