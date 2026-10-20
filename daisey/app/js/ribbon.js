// The day ribbon (Mor, 2026-10-15, canvas "Daisey phone home polish"): a
// thin line under the clock on the phone's home, from the day's start to its
// end. What's done sits on it as small raised beads in their colour, what
// the plan still holds as hollow rings, the calendar's events as the line itself in their colour,
// and now as a yellow dot. Above it "✓ 3 done · ○ 2 left" (the "until 23:00"
// day end went, Mor 2026-10-20: at a 00:00 end it said nothing);
// with no plan, the plan's button sits under the line. A bead opens a small
// pop-over with what it was. schedule.js works out the day (shape()), this
// only draws it.
import { h, bdi, icon } from "./ui.js";
import { areaClass, projectShown } from "./look.js";

const hm = (ms) => new Date(ms).toTimeString().slice(0, 5);
const ring = () => h("span", { className: "rb-ring", ariaHidden: "true" });

export function mountRibbon(el, { onPlan } = {}){
  let data = null, open = null, cardId = null; // open: the bead whose pop-over shows ("d:<id>" / "l:<id>")
  let fresh = null; // the dot just tapped: it pops once (.pick), not on every repaint after

  const pct = (ms) => `${Math.max(0, Math.min(100, ((ms - data.start) / (data.end - data.start)) * 100)).toFixed(2)}%`;
  const pick = (key) => (e) => { e.stopPropagation(); open = open === key ? null : key; fresh = key; paint(); };
  const state = (key) => (open === key ? " on" : "") + (fresh === key ? " pick" : "");

  // Every pop-over hangs from its dots by stalks (Mor, 2026-10-19): one card,
  // one language. A dot, "3 done" or "2 left" opens its group's list ("d" /
  // "l"); a tapped dot's row is picked out, its stalk bold and the others
  // faint. The now dot hangs its own card from one yellow stalk.
  const group = (key) => !key ? null : key.startsWith("all:") ? key.slice(4) : key.split(":")[0];
  let drawn = null; // the group on screen last paint: a new one draws its stalks in, the same one stays still
  const MAX = 5; // a picked dot shows at most this many rows, around its own

  // Stalks from each point (dot middles, left to right) into the card's top,
  // tied side by side in that order so none cross; the card centres under them.
  function hang(line, box, pts, { cls = "", solid = true, grow } = {}){
    if (!pts.length || !box.isConnected) return;
    const w = line.clientWidth, pw = box.offsetWidth, n = pts.length;
    const mid = pts.reduce((s, p) => s + p.x, 0) / n;
    const left = Math.max(-6, Math.min(w - pw + 6, mid - pw / 2));
    box.style.left = `${left}px`;
    const top = box.offsetTop + 8, gap = Math.min(6, (pw - 48) / Math.max(1, n - 1)), half = gap * (n - 1) / 2;
    const tie = Math.max(left + 24 + half, Math.min(left + pw - 24 - half, mid));
    const NS = "http://www.w3.org/2000/svg", svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", "rb-stalks" + cls + (solid ? "" : " left") + (grow ? " grow" : ""));
    svg.setAttribute("aria-hidden", "true");
    pts.forEach((p, i) => {
      const tx = tie - half + i * gap, k = (top - p.y) * .55, path = document.createElementNS(NS, "path");
      path.setAttribute("d", `M${p.x} ${p.y} C${p.x} ${p.y + k} ${tx} ${top - k} ${tx} ${top}`);
      path.setAttribute("class", "rb-stalk" + (p.cls || ""));
      if (solid) path.setAttribute("pathLength", "1"); // the draw-in; a planned stalk is dashed and fades in instead
      path.style.setProperty("--i", i);
      svg.append(path); p.stalk = path;
    });
    line.insertBefore(svg, line.querySelector(".rb-bead, .rb-hole, .rb-now")); // over the line, under the dots
  }
  const centre = (dot) => ({ dot, x: dot.offsetLeft + dot.offsetWidth / 2, y: dot.offsetTop + dot.offsetHeight / 2 });

  function listPop(kind, line, focus){
    const all = kind === "d" ? data.done : data.left;
    const rows = all.slice().sort((a, b) => a.at - b.at);
    if (!rows.length || (focus && !rows.some((r) => r.id === focus))) { open = null; return null; }
    // Picked from a long day: the rows around it, the rest a "+N" that opens them all.
    let from = 0, to = rows.length;
    if (focus && rows.length > MAX) { const at = rows.findIndex((r) => r.id === focus); from = Math.max(0, Math.min(rows.length - MAX, at - 2)); to = from + MAX; }
    const shown = rows.slice(from, to), grow = group(open) !== drawn;
    const parts = new Map(); // id → [stalk, dot]
    const hot = (id, on) => parts.get(id)?.forEach((n) => n.classList.toggle("hot", on));
    const more = (n, word) => n > 0 && h("li", { className: "rb-more" }, h("button", { type: "button", onclick: (e) => { e.stopPropagation(); open = `all:${kind}`; paint(); } }, `+${n} ${word}`));
    const box = h("div", { className: "rb-pop rb-list" + (focus ? " picking" : "") + (grow ? "" : " still"), role: "dialog", ariaLabel: kind === "d" ? "Done today" : "Still planned", style: "left:-6px" },
      h("ul", {}, more(from, "earlier"), ...shown.map((r) => {
        const picked = r.id === focus, proj = picked && projectShown(r.task);
        return h("li", { className: areaClass(r.task) + (picked ? " picked" : ""), onmouseenter: () => hot(r.id, true), onmouseleave: () => hot(r.id, false),
          // A row picks itself; the picked one again lets go.
          onclick: (e) => { e.stopPropagation(); open = picked ? `all:${kind}` : `${kind}:${r.id}`; paint(); } },
          h("span", { className: "rb-pdot", ariaHidden: "true" }),
          h("span", { className: "rb-li-t" }, bdi(r.task.title), proj && h("span", { className: "rb-li-p" }, bdi(proj))),
          h("span", { className: "rb-li-at" }, kind === "d" ? hm(r.at) : `${hm(r.at)}–${hm(r.end)}`));
      }), more(rows.length - to, "later")));
    requestAnimationFrame(() => {
      const dots = line.querySelectorAll(kind === "d" ? ".rb-bead" : ".rb-hole"); // in the order of `all`
      const ids = new Set(shown.map((r) => r.id));
      const pts = all.map((r, i) => dots[i] && ids.has(r.id) && { ...centre(dots[i]), id: r.id, cls: areaClass(r.task) + (focus ? (r.id === focus ? " picked" : " faint") : "") })
        .filter(Boolean).sort((a, b) => a.x - b.x);
      hang(line, box, pts, { solid: kind === "d", grow });
      pts.forEach((p) => parts.set(p.id, [p.stalk, p.dot]));
    });
    return box;
  }

  // The now dot: the time, what's on right now, what's next.
  function nowPop(line){
    const now = data.now, ev = data.events.find((e) => e.start <= now && now < e.end);
    const card = cardId && (data.tasks || []).find((t) => t.id === cardId);
    const row = card ? data.left.find((l) => l.id === card.id) : data.left.find((l) => l.at <= now && now < l.end);
    const task = card || row?.task;
    const next = data.left.filter((l) => l.at > now && l.id !== task?.id).sort((a, b) => a.at - b.at)[0];
    const title = task ? task.title : ev ? ev.title : null;
    const when = row ? (row.at <= now && now < row.end ? `until ${hm(row.end)}` : `planned ${hm(row.at)}–${hm(row.end)}`) : !task && ev ? `until ${hm(ev.end)}` : null;
    const grow = drawn !== "now";
    const box = h("div", { className: "rb-pop rb-nowpop" + (grow ? "" : " still"), role: "dialog", ariaLabel: "Now" },
      h("p", { className: "rb-proj" }, `Now · ${hm(now)}`),
      h("p", { className: "rb-title" }, title ? bdi(title) : "Nothing planned right now"),
      when && h("p", { className: "rb-when" }, when),
      next && h("p", { className: "rb-when" }, "Next: ", bdi(next.task.title), ` at ${hm(next.at)}`));
    requestAnimationFrame(() => { const dot = line.querySelector(".rb-now"); if (dot) hang(line, box, [{ ...centre(dot), cls: " rb-stalk-now" }], { grow }); });
    return box;
  }

  function pop(line){
    if (open === "now") return nowPop(line);
    if (open.startsWith("all:")) return listPop(open.slice(4), line, null);
    const [kind, id] = open.split(":");
    return listPop(kind, line, id);
  }

  function paint(){
    if (!data) { el.hidden = true; return; }
    el.hidden = false;
    const { done, left, events, planned } = data;
    const top = h("div", { className: "rb-top" },
      h("span", { className: "rb-counts" },
        done.length > 0 && h("button", { type: "button", className: "rb-done" + (group(open) === "d" ? " on" : ""), ariaExpanded: String(group(open) === "d"), onclick: pick("all:d") }, icon("check"), `${done.length} done`),
        planned && left.length > 0 && h("button", { type: "button", className: "rb-left" + (group(open) === "l" ? " on" : ""), ariaExpanded: String(group(open) === "l"), onclick: pick("all:l") }, ring(), `${left.length} left`)));
    const line = h("div", { className: "rb-line" },
      h("span", { className: "rb-track", ariaHidden: "true" }),
      h("span", { className: "rb-past", ariaHidden: "true", style: `inline-size:${pct(data.now)}` }),
      // The calendar, plan or not (Mor, 2026-10-20): an event is the line in its colour, under the dots.
      ...events.map((e) => h("span", { className: "rb-ev" + (e.end <= data.now ? " gone" : ""), title: e.title, ariaHidden: "true",
        style: `inset-inline-start:${pct(e.start)};inline-size:calc(${pct(e.end)} - ${pct(e.start)})` + (e.color ? `;--ev:${e.color}` : "") })),
      ...done.map((d) => h("button", { type: "button", className: "rb-bead" + areaClass(d.task) + state(`d:${d.id}`), style: `inset-inline-start:min(${pct(d.at)}, calc(${pct(data.now)} - 15px))`,
        ariaLabel: `${d.task.title}, done ${hm(d.at)}`, ariaExpanded: String(open === `d:${d.id}`), onclick: pick(`d:${d.id}`) })),
      ...left.map((l) => h("button", { type: "button", className: "rb-hole" + areaClass(l.task) + state(`l:${l.id}`), style: `inset-inline-start:${pct(l.at)}`,
        ariaLabel: `${l.task.title}, planned ${hm(l.at)}`, ariaExpanded: String(open === `l:${l.id}`), onclick: pick(`l:${l.id}`) })),
      // The glow's phase follows the clock, so a repaint doesn't restart it.
      h("button", { type: "button", className: "rb-now" + state("now"), ariaLabel: "Now", ariaExpanded: String(open === "now"), style: `inset-inline-start:${pct(data.now)};--glow-at:-${Math.round(performance.now() % 2800)}ms`, onclick: pick("now") }));
    if (open) { const p = pop(line); if (p) line.append(p); }
    el.replaceChildren(top, line);
    fresh = null; drawn = group(open);
    if (!planned) el.append(h("div", { className: "rb-act" }, h("button", { type: "button", className: "rb-plan", onclick: () => onPlan?.() }, icon("calendar"), h("span", { textContent: data.word }))));
  }

  // A tap anywhere else shuts the pop-over.
  const away = (e) => { if (open && !e.composedPath().some((n) => n.classList?.contains?.("rb-pop"))) { open = null; paint(); } };
  document.addEventListener("click", away);

  return {
    set(d){ data = d; paint(); },
    // The task on the Now card, for the now dot's pop-over.
    setCard(id){ cardId = id; if (open === "now") paint(); },
    // A pop-over open: the phone's Back shuts it (main.js topLayer).
    isOpen: () => !!open && !el.hidden,
    close(){ open = null; paint(); },
    unmount(){ document.removeEventListener("click", away); el.replaceChildren(); el.hidden = true; },
  };
}
