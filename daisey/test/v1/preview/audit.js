/* Phone layout audit, evaluated in the page by preview.js --audit <file>.
   Finds what a screenshot hides at a glance: things past the screen edge,
   text cut off, content colliding, taps too small, and content stuck under
   the fixed dock at the bottom of the scroll. Also returns each visible
   element's box (geo) so two engines can be diffed (phone-audit.js). */
(async () => {
  const vw = document.documentElement.clientWidth, vh = window.innerHeight;
  const issues = [];
  const css = (el) => getComputedStyle(el);
  const shown = (el) => {
    for (let e = el; e && e !== document.body; e = e.parentElement) {
      const s = css(e); if (s.display === "none" || s.visibility === "hidden" || +s.opacity === 0) return false;
    }
    const r = el.getBoundingClientRect(); return r.width > 1 || r.height > 1;
  };
  const label = (el) => {
    const c = el.classList.length ? "." + [...el.classList].slice(0, 2).join(".") : "";
    const t = (el.getAttribute("aria-label") || el.innerText || el.value || "").trim().replace(/\s+/g, " ").slice(0, 28);
    return el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + c + (t ? ` "${t}"` : "");
  };
  // The part of el actually painted: its box cut by every clipping ancestor.
  const fixedOrSticky = (el) => { for (let e = el; e; e = e.parentElement) { const p = css(e).position; if (p === "fixed" || p === "sticky") return e; } return null; };
  const visibleBox = (el) => {
    let r = el.getBoundingClientRect(), x1 = r.left, y1 = r.top, x2 = r.right, y2 = r.bottom;
    for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
      const s = css(p);
      if (s.overflowX !== "visible" || s.overflowY !== "visible") {
        const q = p.getBoundingClientRect();
        if (s.overflowX !== "visible") { x1 = Math.max(x1, q.left); x2 = Math.min(x2, q.right); }
        if (s.overflowY !== "visible") { y1 = Math.max(y1, q.top); y2 = Math.min(y2, q.bottom); }
      }
    }
    return { x1, y1, x2, y2, empty: x2 - x1 < 1 || y2 - y1 < 1 };
  };
  const all = [...document.querySelectorAll("body *")].filter((el) => !["SCRIPT", "STYLE", "TEMPLATE", "OPTION"].includes(el.tagName) && !el.closest("svg > *") && shown(el));

  const over = document.documentElement.scrollWidth - vw;
  if (over > 0) issues.push(`PAGE-OVERFLOW page is ${over}px wider than the screen`);

  // Past the side of the screen (after clipping), topmost offender only.
  const off = new Set();
  for (const el of all) {
    const b = visibleBox(el); if (b.empty) continue;
    if (b.x2 > vw + 0.5 || b.x1 < -0.5) { off.add(el); if (!off.has(el.parentElement)) issues.push(`OFFSCREEN ${label(el)} spans ${Math.round(b.x1)}..${Math.round(b.x2)} of ${vw}`); }
  }

  // A control partly cut away by a parent that hides overflow (not one that scrolls).
  const hides = (v) => v === "hidden" || v === "clip";
  for (const el of all.filter((e) => e.matches("button, a[href], input:not([type=hidden]), select, textarea, [role=button]"))) {
    const r = el.getBoundingClientRect();
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const s = css(p); if (/(auto|scroll)/.test(s.overflowX + s.overflowY)) break;
      const q = p.getBoundingClientRect();
      const cut = Math.max(hides(s.overflowX) ? Math.max(q.left - r.left, r.right - q.right) : 0, hides(s.overflowY) ? Math.max(q.top - r.top, r.bottom - q.bottom) : 0);
      if (cut > 2 && cut < Math.max(r.width, r.height)) { issues.push(`CUT ${label(el)} loses ${Math.round(cut)}px to ${label(p).slice(0, 40)}`); break; }
    }
  }

  // Text cut off: its own text overflows a box that hides overflow.
  for (const el of all) {
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!own) continue;
    const s = css(el);
    const hidesX = s.overflowX !== "visible", hidesY = s.overflowY !== "visible";
    if (hidesX && el.scrollWidth > el.clientWidth + 1) issues.push(`${s.textOverflow === "ellipsis" ? "ELLIPSIS" : "CLIPPED-X"} ${label(el)} needs ${el.scrollWidth}px, has ${el.clientWidth}`);
    else if (hidesY && el.scrollHeight > el.clientHeight + 2 && s.overflowY !== "auto" && s.overflowY !== "scroll") issues.push(`${s.webkitLineClamp && s.webkitLineClamp !== "none" ? "CLAMPED" : "CLIPPED-Y"} ${label(el)} needs ${el.scrollHeight}px tall, has ${el.clientHeight}`);
  }

  // Collisions between content leaves in normal flow (fixed layers are checked below).
  const leaf = (el) => /^(BUTTON|A|INPUT|SELECT|TEXTAREA|IMG|LABEL|svg)$/i.test(el.tagName)
    || [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
  // Each popup, dialog, menu or fixed bar is its own layer: only things in the same layer may not collide.
  const layer = (el) => { for (let e = el; e; e = e.parentElement) { if (e.tagName === "DIALOG" || /^(fixed|absolute|sticky)$/.test(css(e).position)) return e; } return null; };
  const leaves = all.filter(leaf);
  const tops = leaves.filter((el) => !leaves.some((o) => o !== el && o.contains(el)));
  const boxes = tops.map((el) => ({ el, b: visibleBox(el), l: layer(el) })).filter((x) => !x.b.empty);
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    if (boxes[i].l !== boxes[j].l || css(boxes[i].el).transform !== "none" || css(boxes[j].el).transform !== "none") continue; // a turned box (the open +) is bigger than what it paints
    const a = boxes[i].b, c = boxes[j].b;
    const w = Math.min(a.x2, c.x2) - Math.max(a.x1, c.x1), h = Math.min(a.y2, c.y2) - Math.max(a.y1, c.y1);
    if (w > 2 && h > 2) issues.push(`OVERLAP ${label(boxes[i].el)} × ${label(boxes[j].el)} by ${Math.round(w)}×${Math.round(h)}`);
  }

  // iOS zooms the page into any field under 16px when it takes focus, and leaves it zoomed.
  for (const el of all.filter((e) => e.matches("input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=hidden]), select, textarea")))
    if (parseFloat(css(el).fontSize) < 16) issues.push(`IOS-ZOOM ${label(el)} is ${css(el).fontSize}`);

  // Taps too small for a finger.
  for (const el of all.filter((e) => e.matches("button, a[href], input:not([type=hidden]), select, [role=button], summary"))) {
    const r = el.getBoundingClientRect();
    if (r.height < 30 || r.width < 30) issues.push(`SMALL-TAP ${label(el)} ${Math.round(r.width)}×${Math.round(r.height)}`);
  }

  // Scrolled to the very bottom, nothing in flow may sit under a fixed bar.
  const scrollers = [document.scrollingElement, ...document.querySelectorAll(".screen:not([hidden]), dialog[open]")].filter(Boolean);
  for (const sc of scrollers) sc.scrollTop = sc.scrollHeight;
  await new Promise((r) => setTimeout(r, 120));
  const bars = all.filter((el) => { const s = css(el); return s.position === "fixed" && el.getBoundingClientRect().height < 140 && s.pointerEvents !== "none" && !el.matches(".toast, .burst, .stars, #splash"); });
  for (const bar of bars) {
    const q = bar.getBoundingClientRect();
    for (const el of tops) {
      if (bar.contains(el) || el.contains(bar) || layer(el)) continue;
      const b = visibleBox(el); if (b.empty) continue;
      const w = Math.min(b.x2, q.right) - Math.max(b.x1, q.left), h = Math.min(b.y2, q.bottom) - Math.max(b.y1, q.top);
      if (w > 2 && h > 2) issues.push(`UNDER-BAR ${label(el)} under ${label(bar)} by ${Math.round(h)}px at the end of the scroll`);
    }
  }
  for (const sc of scrollers) sc.scrollTop = 0;

  // Boxes for the engine diff, keyed by a stable DOM path.
  const key = (el) => { const p = []; for (let e = el; e && e !== document.body; e = e.parentElement) p.unshift(e.tagName.toLowerCase() + (e.id ? "#" + e.id : ":" + [...e.parentElement.children].indexOf(e))); return p.join(">"); };
  const geo = {};
  for (const el of tops) { const r = el.getBoundingClientRect(); geo[key(el)] = [label(el), Math.round(r.left), Math.round(r.top + window.scrollY), Math.round(r.width), Math.round(r.height)]; }
  return { vw, issues: [...new Set(issues)], geo };
})()
