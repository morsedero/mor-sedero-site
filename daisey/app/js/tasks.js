// The Tasks view: one vertical scroll, grouped by WHEN — Overdue, Today,
// This week, Later, Anytime, Waiting. The project is a chip on the row, and a
// chip row at the top filters to one project.
//
// This is a deciding list, not a filing cabinet: the dimension that matters
// while you're choosing is time, not which project a thing belongs to. The
// project columns it replaced are gone outright (Mor, 2026-10-04, after
// seeing both: "lose the projects tab, list should be default") — along with
// the toggle, the remembered choice and the sideways scroll they needed.
//
// Tapping a row ANYWHERE opens the task sheet (addtask.js in edit mode) —
// fields, Waiting on, Delete, "Do this now". There is no ⋯ menu any more and
// nothing here calls prompt() or confirm(); the one instant action left is
// the circle, and that gets an Undo toast.
//
// The task on the Now card stays in place, marked "now", and still counts in
// its project's total (Mor, 2026-10-03: it shouldn't vanish from the list
// while it's on the card).
import { watchTasks, finishTask, restoreTask } from "./store.js";
import { INBOX, notYet, localDate } from "./model.js";
import { isOverdue, isRolled } from "./triage.js";
import { h, bdi, pieces, sizeText, flash } from "./ui.js";

const shortDate = (s) => new Date(`${s}T12:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
const DRAG = 0.6; // how far the chip row moves per pixel of pointer — under 1 = heavier
const FLING_DECAY = 0.93; // what's left of the glide's speed each frame after release
const FLING_STOP = 0.4; // px a frame, below which the glide is over and the row settles
const dayFrom = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return localDate(d.getTime()); };

// Which section of the List view a task falls in. Waiting outranks a date:
// a task you can't act on isn't due today however its date reads. Only a
// deadline can be Overdue; a target that passed sits quietly under Today
// (triage.js). Someday is its own fold at the bottom.
function bucketOf(t, today, weekEnd){
  if (t.status === "someday") return "someday";
  if (t.status === "waiting" || notYet(t)) return "waiting";
  if (!t.due) return "anytime";
  if (isOverdue(t)) return "overdue";
  if (t.due <= today) return "today";
  return t.due <= weekEnd ? "week" : "later";
}
const SECTIONS = [
  ["overdue", "Overdue"],
  ["today", "Today"],
  ["week", "This week"],
  ["later", "Later"],
  ["anytime", "Anytime"],
  ["waiting", "Waiting"],
];

export function mountTasks(root, uid, { onAdd, onOpen } = {}){
  let tasks = null, onCard = null;
  let project = null; // the List view's project filter; null = all
  let doneOpen = false; // the Completed fold
  let somedayOpen = false; // the Someday fold
  let reveal = 0; // a chip was just picked: tries left to slide it fully into view
  const fail = (e) => console.error("[daisey] tasks", e);

  // Completing is the one thing that happens without the sheet, so it is the
  // one thing that needs taking back. Reopening needs no undo: it's the same
  // circle again.
  function complete(t){
    const before = { status: t.status || "ready", doneAt: t.doneAt ?? null, skipsSinceStart: t.skipsSinceStart ?? 0 };
    finishTask(uid, t).catch(fail);
    flash("Done: ", t.title, { undo: () => restoreTask(uid, t.id, before).catch(fail) });
  }

  function circle(t, done){
    return h("button", { type: "button", className: "tk-check" + (done ? " done" : ""),
      ariaLabel: done ? `Reopen ${t.title}` : `Complete ${t.title}`, textContent: done ? "✓" : "",
      onclick: (e) => { e.stopPropagation(); done ? restoreTask(uid, t.id, { status: "ready", doneAt: null }).catch(fail) : complete(t); } });
  }

  // One row shape for both views. `withProject` only in the List view, where
  // the column header isn't there to say it.
  function row(t, { withProject } = {}){
    const isNow = t.id === onCard;
    const meta = pieces(sizeText(t.size),
      t.due && (isRolled(t) ? `from ${shortDate(t.due)}`
        : `${t.dateKind === "deadline" ? "deadline" : "by"} ${shortDate(t.due)}${t.dueTime ? " " + t.dueTime : ""}`),
      notYet(t) && `not before ${shortDate(t.notBefore)}`,
      t.status === "waiting" && `waiting${t.waitingOn ? " on " + t.waitingOn : ""}`);
    return h("li", { className: "tk-row" + (t.status === "waiting" || notYet(t) ? " waiting" : "") + (isNow ? " is-now" : "") },
      circle(t, false),
      h("button", { type: "button", className: "tk-open", ariaLabel: `Open ${t.title}`, onclick: () => onOpen?.(t) },
        h("div", { className: "tk-title" }, bdi(t.title),
          isNow && h("span", { className: "tk-now", title: "On the Now card", textContent: "now" })),
        h("div", { className: "tk-meta" },
          withProject && t.project !== INBOX && h("span", { className: "tk-tag" }, bdi(t.project)),
          h("span", { className: "muted" }, ...meta)),
        t.notes && h("div", { className: "muted tk-notes", dir: "auto", textContent: t.notes })));
  }

  const doneRow = (t) => h("li", { className: "tk-row done" }, circle(t, true),
    h("button", { type: "button", className: "tk-open", ariaLabel: `Open ${t.title}`, onclick: () => onOpen?.(t) },
      h("div", { className: "tk-title", dir: "auto", textContent: t.title }),
      t.doneAt && h("div", { className: "muted tk-meta", textContent: `done ${new Date(t.doneAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}` })));

  // On the card first, then waiting last, then by due, newest last.
  const order = (a, b) => (b.id === onCard) - (a.id === onCard)
    || (a.status === "waiting") - (b.status === "waiting")
    || (a.due || "9999").localeCompare(b.due || "9999")
    || b.createdAt - a.createdAt;

  const fold = (label, kids, open, onToggle) => h("details", { className: "tk-done", open,
    ontoggle: (e) => onToggle(e.currentTarget.open) },
    h("summary", { textContent: label }), h("ul", { className: "tk-list" }, ...kids));

  // ---------- the list ----------

  // The project filter. It sits ABOVE the scroller, not inside it: it used to
  // be the first thing in the list and scrolled away with the tasks, and
  // sticky can't save a grid item — a sticky item only moves inside its own
  // grid area, which is exactly its own height. One project means nothing to
  // filter, so there's no bar at all.
  //
  // One row that slides (Mor, 2026-10-04, through three goes at it). Wrapping
  // ate the list's height; a plain scroller was unreachable on a desktop,
  // where there is no finger to swipe with; chevrons answered that and were
  // clutter. So the row is dragged: a finger scrolls it as any scroller
  // scrolls, and a mouse drags it, which is the same gesture. A wheel over it
  // works too, either axis.
  //
  // Where it is slid to SURVIVES a redraw (fill), so choosing a project three
  // chips along doesn't snap the row back to the start with the chosen chip
  // off screen.
  function filterBar(open){
    const names = [...new Set(open.map((t) => t.project))].sort((a, b) => (b === INBOX) - (a === INBOX) || a.localeCompare(b));
    // Always the element, even with nothing in it: it holds the frame's first
    // grid row, so the list below it stays in the row that can scroll. Empty,
    // it has no height (.tk-filters:empty).
    if (names.length < 2) return h("div", { className: "tk-filters" });
    const chip = (name, label, count) => h("button", { type: "button", className: "chip", role: "radio",
      ariaChecked: String(project === name), onclick: () => { project = name; reveal = 1; render(); } },
      bdi(label), h("span", { className: "chip-n", textContent: String(count) }));

    const row = h("div", { className: "tk-chips", role: "radiogroup", ariaLabel: "Filter by project" },
      chip(null, "All", open.length),
      ...names.map((n) => chip(n, n, open.filter((t) => t.project === n).length)));

    // Touch is left to the browser — it already scrolls this, with momentum
    // and its own snapping. The handlers below are the mouse's version of the
    // same feel (Mor: "let me slide it, only when releasing snap it, and with
    // a drag, so it will feel smooth"):
    //
    //   while the pointer is down  the row follows it freely, snapping OFF,
    //                              so nothing tugs at it mid-drag
    //   on release                 it keeps going and slows down (FLING_DECAY)
    //   when it stops              the nearest chip settles flush
    //
    // The pointer is captured only ONCE A DRAG STARTS, never on the press.
    // Capturing on pointerdown retargets the click to the row, so every chip
    // stopped being pickable (Mor: "there's no option to choose a tab now").
    //
    // DRAG is the weight: the row moves that fraction of the pointer, so it
    // takes a deliberate pull rather than flying off on a twitch.
    let from = null, dragged = false, speed = 0, last = null, glide = 0;

    const stopGlide = () => { cancelAnimationFrame(glide); glide = 0; };

    // Brings a chip's start edge flush with the row's own: the one asked for
    // (showChip, after a pick), or else whichever is nearest. Measured from
    // the rectangles, so it reads the same in Hebrew, where scrollLeft is
    // negative and the start edge is the right one.
    //
    // `wanted` is consumed on the first settle after a pick, so a stray
    // scrollend arriving mid-animation can't re-decide on "nearest" and
    // leave the chip clipped again — which is what happened to the chip at
    // the start edge (Mor: "left still not working", after a slide).
    let wanted = null, how = "smooth";
    function settle(){
      const rtl = getComputedStyle(row).direction === "rtl";
      const edge = (el) => { const r = el.getBoundingClientRect(); return rtl ? r.right : r.left; };
      const here = edge(row);
      const target = wanted?.isConnected ? wanted : null;
      wanted = null;
      let shortest = null;
      if (target) {
        // Whichever side it hangs off, by the smaller move. The LAST chip
        // can never put its start edge flush — the row runs out of scroll
        // first — so for that one it's the far edge that has to line up.
        const r = target.getBoundingClientRect(), b = row.getBoundingClientRect();
        shortest = r.left < b.left ? r.left - b.left : r.right > b.right ? r.right - b.right : 0;
      } else {
        // Both ends are resting places of their own: at them the first or
        // last chip is already flush, and "nearest chip" would drag the row
        // back off the end a reveal had just taken it to.
        const span = row.scrollWidth - row.clientWidth;
        const at = Math.abs(row.scrollLeft);
        if (at <= 1 || at >= span - 1) return;
        // null, not 0, for "none yet": a chip already flush measures 0, and 0
        // read as unset let the chip after it win and yank the row backwards.
        for (const c of row.children) {
          const d = edge(c) - here;
          if (shortest === null || Math.abs(d) < Math.abs(shortest)) shortest = d;
        }
      }
      if (shortest && Math.abs(shortest) > 1) row.scrollBy({ left: shortest, behavior: how });
      how = "smooth";
    }
    // Called by fill() with the chip just picked, if it isn't wholly in view.
    // `behavior` is "auto" on a retry: a redraw replaces this whole row, so a
    // smooth slide that keeps being interrupted never arrives — the retry
    // jumps instead of sliding from nothing.
    row.showChip = (chip, behavior = "smooth") => { wanted = chip; how = behavior; stopGlide(); settle(); };

    // speed is px per frame, carried over from the pointer's last movement.
    function fling(){
      const step = () => {
        speed *= FLING_DECAY;
        if (Math.abs(speed) < FLING_STOP) { glide = 0; settle(); return; }
        const was = row.scrollLeft;
        row.scrollLeft += speed;
        if (row.scrollLeft === was) { glide = 0; settle(); return; } // hit an end
        glide = requestAnimationFrame(step);
      };
      glide = requestAnimationFrame(step);
    }

    row.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "touch" || e.button !== 0) return;
      stopGlide();
      from = { x: e.clientX, at: row.scrollLeft, id: e.pointerId };
      last = { x: e.clientX, t: e.timeStamp };
      speed = 0;
      dragged = false;
    });
    row.addEventListener("pointermove", (e) => {
      if (!from) return;
      const dx = e.clientX - from.x;
      if (!dragged && Math.abs(dx) > 4) {
        dragged = true;
        row.classList.add("dragging");
        try { row.setPointerCapture(from.id); } catch { /* the press already ended */ }
      }
      if (!dragged) return;
      row.scrollLeft = from.at - dx * DRAG;
      // Smoothed, so one stuttering frame at the end doesn't decide the throw.
      const ms = Math.max(1, e.timeStamp - last.t);
      speed = 0.7 * (-(e.clientX - last.x) * DRAG * 16 / ms) + 0.3 * speed;
      last = { x: e.clientX, t: e.timeStamp };
    });
    const letGo = (e) => {
      if (!from) return;
      from = null;
      row.classList.remove("dragging");
      try { row.releasePointerCapture(e.pointerId); } catch { /* already gone */ }
      if (!dragged) return;
      Math.abs(speed) > FLING_STOP ? fling() : settle();
    };
    row.addEventListener("pointerup", letGo);
    row.addEventListener("pointercancel", letGo);
    row.addEventListener("click", (e) => {
      if (!dragged) return;
      dragged = false;
      e.preventDefault();
      e.stopPropagation();
    }, true);
    // Settling is this file's job, not the stylesheet's. CSS scroll-snap was
    // tried first and fought back: with proximity snap on, Chrome remembers
    // the element it last snapped to and re-aligns to THAT when the property
    // comes back, so a drag that settled correctly on one chip was dragged
    // on to another a frame later (measured: 190 → 154 → 60).
    // Here the browser scrolls freely and the row settles when it comes to
    // rest — after a flick, after a swipe, after a wheel.
    const atRest = () => { if (!from && !glide) settle(); };
    if ("onscrollend" in row) row.addEventListener("scrollend", atRest);
    else row.addEventListener("touchend", () => setTimeout(atRest, 400)); // no scrollend yet

    row.addEventListener("wheel", (e) => {
      const by = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (!by) return;
      row.scrollLeft += by * DRAG;
      e.preventDefault();
    }, { passive: false });

    return h("div", { className: "tk-filters" }, row);
  }

  function listView(open, done){
    const shown = project ? open.filter((t) => t.project === project) : open;
    // Completed follows the chip too: a project's tab shows that project's done.
    done = project ? done.filter((t) => t.project === project) : done;
    const today = localDate(), weekEnd = dayFrom(7);
    const groups = new Map([...SECTIONS.map(([k]) => [k, []]), ["someday", []]]);
    for (const t of shown) groups.get(bucketOf(t, today, weekEnd)).push(t);

    const sections = SECTIONS.filter(([k]) => groups.get(k).length).map(([k, label]) => {
      const items = groups.get(k).sort(order);
      return h("section", { className: "tk-sec" + (k === "waiting" ? " quiet" : ""), ariaLabel: label },
        h("h3", { className: "tk-sec-h" }, h("span", { textContent: label }), h("span", { className: "muted", textContent: String(items.length) })),
        h("ul", { className: "tk-list" }, ...items.map((t) => row(t, { withProject: !project }))));
    });

    return h("div", { className: "tk-single" },
      sections.length ? h("div", { className: "tk-secs" }, ...sections)
        : h("p", { className: "muted tk-note", textContent: project ? "Nothing open in this project." : "Nothing open. All done." }),
      h("button", { type: "button", className: "tk-add", textContent: "+ Add a task", onclick: () => onAdd?.(project ?? undefined) }),
      groups.get("someday").length > 0 && h("div", { className: "tk-someday" }, fold(`Someday (${groups.get("someday").length})`,
        groups.get("someday").sort(order).map((t) => row(t, { withProject: !project })), somedayOpen, (o) => { somedayOpen = o; })),
      done.length > 0 && fold(`Completed (${done.length})`, done.sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0)).slice(0, 50).map(doneRow),
        doneOpen, (o) => { doneOpen = o; }));
  }

  // ---------- frame ----------

  // Keeps where you were scrolled through a redraw — down the list, and
  // along the chips (Mor: a chosen project shouldn't snap out of sight).
  function fill(...kids){
    const y = root.querySelector(".tk-single")?.scrollTop || 0;
    const x = root.querySelector(".tk-chips")?.scrollLeft;
    root.replaceChildren(...kids.filter(Boolean));
    const list = root.querySelector(".tk-single");
    if (list) list.scrollTop = y;
    const chips = root.querySelector(".tk-chips");
    if (chips && x != null) chips.scrollLeft = x;
    // A chip you just picked shows its whole name (Mor): if it's clipped at
    // either edge, the row slides it flush with the start. Flush rather than
    // merely visible, so the settle that follows has nothing left to move.
    //
    // It stays pending until the chip really is in view, because a redraw
    // lands in the middle of that slide more often than it looks: a Firestore
    // snapshot, or the Now card changing which task it holds, redraws this
    // view, and the scroll restore above then puts the row back where the
    // chip was still clipped. A redraw now re-issues the slide instead of
    // undoing it. Capped, so a chip that can't BE flush — the last one, with
    // the row already scrolled to its end — doesn't ask forever.
    if (chips && reveal) {
      const chip = chips.querySelector('.chip[aria-checked="true"]');
      const box = chips.getBoundingClientRect();
      const own = chip?.getBoundingClientRect();
      const clipped = own && (own.left < box.left - 1 || own.right > box.right + 1);
      if (!clipped || reveal > 4) reveal = 0;
      else { chips.showChip?.(chip, reveal > 1 ? "auto" : "smooth"); reveal++; }
    }
  }

  function render(){
    if (tasks == null) { root.replaceChildren(h("p", { className: "muted", textContent: "Loading tasks…" })); return; }
    if (!tasks.length) {
      root.replaceChildren(h("div", { className: "tk-empty card" }, h("p", { textContent: "No tasks yet." }),
        h("button", { className: "btn primary", type: "button", textContent: "+ Add task", onclick: () => onAdd?.() })));
      return;
    }
    // Dropped tasks are kept for learning and shown nowhere.
    const open = tasks.filter((t) => t.status !== "done" && t.status !== "dropped");
    const done = tasks.filter((t) => t.status === "done");
    if (project && !open.some((t) => t.project === project)) project = null; // the filtered project emptied out
    fill(filterBar(open), listView(open, done));
  }

  const unsub = watchTasks(uid, (ts) => { tasks = ts; render(); }, fail);
  render();

  return {
    setCurrent(id){ onCard = id; render(); },
    unmount(){ unsub(); root.replaceChildren(); },
  };
}
