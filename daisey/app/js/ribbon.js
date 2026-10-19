// The day ribbon (Mor, 2026-10-15, canvas "Daisey phone home polish"): a
// thin line under the clock on the phone's home, from the day's start to its
// end. What's done sits on it as small raised beads in their colour, what
// the plan still holds as hollow rings, the calendar's events as soft bars,
// and now as a yellow dot. Above it "✓ 3 done · ○ 2 left" and "until 23:00";
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

  // "3 done" / "2 left" open the whole list, not one bead. Its dots hang it
  // from the line by stalks (Mor, 2026-10-19), a bouquet tied at the card's
  // top: the card sits under the dots' middle, a row under the mouse lights
  // its stalk and dot.
  function listPop(kind, line){
    const all = kind === "d" ? data.done : data.left;
    const rows = all.slice().sort((a, b) => a.at - b.at);
    if (!rows.length) { open = null; return null; }
    const grow = fresh === open; // just opened: the stalks draw in, not on every repaint
    const stalks = new Map(); // id → [stalk, dot]
    const hot = (id, on) => stalks.get(id)?.forEach((n) => n.classList.toggle("hot", on));
    const box = h("div", { className: "rb-pop rb-list", role: "dialog", ariaLabel: kind === "d" ? "Done today" : "Still planned", style: "left:-6px" },
      h("ul", {}, ...rows.map((r) => h("li", { className: areaClass(r.task), onmouseenter: () => hot(r.id, true), onmouseleave: () => hot(r.id, false) },
        h("span", { className: "rb-pdot", ariaHidden: "true" }),
        h("span", { className: "rb-li-t" }, bdi(r.task.title)),
        h("span", { className: "rb-li-at" }, kind === "d" ? hm(r.at) : `${hm(r.at)}–${hm(r.end)}`)))));
    requestAnimationFrame(() => {
      const dots = line.querySelectorAll(kind === "d" ? ".rb-bead" : ".rb-hole"); // in the order of `all`
      const pts = all.map((r, i) => dots[i] && { id: r.id, task: r.task, dot: dots[i], x: dots[i].offsetLeft + dots[i].offsetWidth / 2, y: dots[i].offsetTop + dots[i].offsetHeight / 2 })
        .filter(Boolean).sort((a, b) => a.x - b.x);
      if (!pts.length || !box.isConnected) return;
      const w = line.clientWidth, pw = box.offsetWidth, n = pts.length;
      const mid = pts.reduce((s, p) => s + p.x, 0) / n;
      const left = Math.max(-6, Math.min(w - pw + 6, mid - pw / 2));
      box.style.left = `${left}px`;
      // The stalks end a little under the card's edge, side by side in the dots' order so none cross.
      const top = box.offsetTop + 8, gap = Math.min(6, (pw - 48) / Math.max(1, n - 1)), half = gap * (n - 1) / 2;
      const tie = Math.max(left + 24 + half, Math.min(left + pw - 24 - half, mid));
      const NS = "http://www.w3.org/2000/svg", svg = document.createElementNS(NS, "svg");
      svg.setAttribute("class", "rb-stalks" + (kind === "l" ? " left" : "") + (grow ? " grow" : ""));
      svg.setAttribute("aria-hidden", "true");
      pts.forEach((p, i) => {
        const tx = tie - half + i * gap, k = (top - p.y) * .55, path = document.createElementNS(NS, "path");
        path.setAttribute("d", `M${p.x} ${p.y} C${p.x} ${p.y + k} ${tx} ${top - k} ${tx} ${top}`);
        path.setAttribute("class", "rb-stalk" + areaClass(p.task));
        if (kind === "d") path.setAttribute("pathLength", "1"); // the draw-in; a planned stalk is dashed and fades in instead
        path.style.setProperty("--i", i);
        svg.append(path); stalks.set(p.id, [path, p.dot]);
      });
      line.insertBefore(svg, dots[0]); // over the line, under the dots
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
    const box = h("div", { className: "rb-pop rb-nowpop", role: "dialog", ariaLabel: "Now" },
      h("span", { className: "rb-arrow", ariaHidden: "true" }),
      h("p", { className: "rb-proj" }, `Now · ${hm(now)}`),
      h("p", { className: "rb-title" }, title ? bdi(title) : "Nothing planned right now"),
      when && h("p", { className: "rb-when" }, when),
      next && h("p", { className: "rb-when" }, "Next: ", bdi(next.task.title), ` at ${hm(next.at)}`));
    requestAnimationFrame(() => {
      const dot = line.querySelector(".rb-now");
      const w = line.clientWidth, pw = box.offsetWidth, x = dot.offsetLeft + dot.offsetWidth / 2;
      const left = Math.max(-6, Math.min(w - pw + 6, x - pw / 2));
      box.style.left = `${left}px`; box.style.setProperty("--arrow", `${x - left}px`);
    });
    return box;
  }

  function pop(line){
    if (open.startsWith("all:")) return listPop(open.slice(4), line);
    if (open === "now") return nowPop(line);
    const [kind, id] = open.split(":");
    const item = (kind === "d" ? data.done : data.left).find((x) => x.id === id);
    if (!item) { open = null; return null; }
    const t = item.task, proj = projectShown(t);
    const box = h("div", { className: "rb-pop" + areaClass(t), role: "dialog", ariaLabel: t.title },
      h("span", { className: "rb-arrow", ariaHidden: "true" }),
      proj && h("p", { className: "rb-proj" }, h("span", { className: "rb-pdot", ariaHidden: "true" }), bdi(proj)),
      h("p", { className: "rb-title" }, bdi(t.title)),
      h("p", { className: "rb-when" }, ...(kind === "d" ? [icon("check"), `Done ${hm(item.at)}`] : [`Planned ${hm(item.at)}–${hm(item.end)}`])));
    // Centred on its bead, kept inside the line; the arrow points at the bead.
    requestAnimationFrame(() => {
      const bead = line.querySelector(".rb-bead.on, .rb-hole.on");
      const w = line.clientWidth, pw = box.offsetWidth, x = bead ? bead.offsetLeft + bead.offsetWidth / 2 : (parseFloat(pct(item.at)) / 100) * w;
      const left = Math.max(-6, Math.min(w - pw + 6, x - pw / 2));
      box.style.left = `${left}px`; box.style.setProperty("--arrow", `${x - left}px`);
    });
    return box;
  }

  function paint(){
    if (!data) { el.hidden = true; return; }
    el.hidden = false;
    const { done, left, events, planned } = data;
    const top = h("div", { className: "rb-top" },
      h("span", { className: "rb-counts" },
        done.length > 0 && h("button", { type: "button", className: "rb-done" + (open === "all:d" ? " on" : ""), ariaExpanded: String(open === "all:d"), onclick: pick("all:d") }, icon("check"), `${done.length} done`),
        planned && left.length > 0 && h("button", { type: "button", className: "rb-left" + (open === "all:l" ? " on" : ""), ariaExpanded: String(open === "all:l"), onclick: pick("all:l") }, ring(), `${left.length} left`)),
      h("span", { className: "rb-until", textContent: `until ${hm(data.end)}` }));
    const line = h("div", { className: "rb-line" },
      h("span", { className: "rb-track", ariaHidden: "true" }),
      h("span", { className: "rb-past", ariaHidden: "true", style: `inline-size:${pct(data.now)}` }),
      // The calendar only while there's no plan; a plan already holds it.
      ...(planned ? [] : events).map((e) => h("span", { className: "rb-ev", title: e.title, ariaHidden: "true", style: `inset-inline-start:${pct(e.start)};inline-size:calc(${pct(e.end)} - ${pct(e.start)})` })),
      ...done.map((d) => h("button", { type: "button", className: "rb-bead" + areaClass(d.task) + state(`d:${d.id}`), style: `inset-inline-start:min(${pct(d.at)}, calc(${pct(data.now)} - 15px))`,
        ariaLabel: `${d.task.title}, done ${hm(d.at)}`, ariaExpanded: String(open === `d:${d.id}`), onclick: pick(`d:${d.id}`) })),
      ...left.map((l) => h("button", { type: "button", className: "rb-hole" + areaClass(l.task) + state(`l:${l.id}`), style: `inset-inline-start:${pct(l.at)}`,
        ariaLabel: `${l.task.title}, planned ${hm(l.at)}`, ariaExpanded: String(open === `l:${l.id}`), onclick: pick(`l:${l.id}`) })),
      // The glow's phase follows the clock, so a repaint doesn't restart it.
      h("button", { type: "button", className: "rb-now" + state("now"), ariaLabel: "Now", ariaExpanded: String(open === "now"), style: `inset-inline-start:${pct(data.now)};--glow-at:-${Math.round(performance.now() % 2800)}ms`, onclick: pick("now") }));
    if (open) { const p = pop(line); if (p) line.append(p); }
    el.replaceChildren(top, line);
    fresh = null;
    if (!planned) el.append(h("div", { className: "rb-act" }, h("button", { type: "button", className: "rb-plan", onclick: () => onPlan?.() }, icon("calendar"), h("span", { textContent: data.word }))));
  }

  // A tap anywhere else shuts the pop-over.
  const away = (e) => { if (open && !e.composedPath().some((n) => n.classList?.contains?.("rb-pop"))) { open = null; paint(); } };
  document.addEventListener("click", away);

  return {
    set(d){ data = d; paint(); },
    // The task on the Now card, for the now dot's pop-over.
    setCard(id){ cardId = id; if (open === "now") paint(); },
    unmount(){ document.removeEventListener("click", away); el.replaceChildren(); el.hidden = true; },
  };
}
