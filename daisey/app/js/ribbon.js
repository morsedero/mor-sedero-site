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
  let data = null, open = null; // open: the bead whose pop-over shows ("d:<id>" / "l:<id>")

  const pct = (ms) => `${Math.max(0, Math.min(100, ((ms - data.start) / (data.end - data.start)) * 100)).toFixed(2)}%`;
  const pick = (key) => (e) => { e.stopPropagation(); open = open === key ? null : key; paint(); };

  // "3 done" / "2 left" open the whole list, not one bead.
  function listPop(kind){
    const rows = (kind === "d" ? data.done : data.left).slice().sort((a, b) => a.at - b.at);
    if (!rows.length) { open = null; return null; }
    return h("div", { className: "rb-pop rb-list", role: "dialog", ariaLabel: kind === "d" ? "Done today" : "Still planned", style: "left:-6px" },
      h("ul", {}, ...rows.map((r) => h("li", { className: areaClass(r.task) },
        h("span", { className: "rb-pdot", ariaHidden: "true" }),
        h("span", { className: "rb-li-t" }, bdi(r.task.title)),
        h("span", { className: "rb-li-at" }, kind === "d" ? hm(r.at) : `${hm(r.at)}–${hm(r.end)}`)))));
  }

  // The now dot: the time, what's on right now, what's next.
  function nowPop(line){
    const now = data.now, cur = data.left.find((l) => l.at <= now && now < l.end), ev = data.events.find((e) => e.start <= now && now < e.end);
    const next = data.left.filter((l) => l.at > now).sort((a, b) => a.at - b.at)[0];
    const box = h("div", { className: "rb-pop rb-nowpop", role: "dialog", ariaLabel: "Now" },
      h("span", { className: "rb-arrow", ariaHidden: "true" }),
      h("p", { className: "rb-proj" }, `Now · ${hm(now)}`),
      h("p", { className: "rb-title" }, cur ? bdi(cur.task.title) : ev ? bdi(ev.title) : "Nothing planned right now"),
      (cur || ev) && h("p", { className: "rb-when" }, `until ${hm((cur || ev).end)}`),
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
    if (open.startsWith("all:")) return listPop(open.slice(4));
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
      ...done.map((d) => h("button", { type: "button", className: "rb-bead" + areaClass(d.task) + (open === `d:${d.id}` ? " on" : ""), style: `inset-inline-start:min(${pct(d.at)}, calc(${pct(data.now)} - 15px))`,
        ariaLabel: `${d.task.title}, done ${hm(d.at)}`, ariaExpanded: String(open === `d:${d.id}`), onclick: pick(`d:${d.id}`) })),
      ...left.map((l) => h("button", { type: "button", className: "rb-hole" + areaClass(l.task) + (open === `l:${l.id}` ? " on" : ""), style: `inset-inline-start:${pct(l.at)}`,
        ariaLabel: `${l.task.title}, planned ${hm(l.at)}`, ariaExpanded: String(open === `l:${l.id}`), onclick: pick(`l:${l.id}`) })),
      h("button", { type: "button", className: "rb-now" + (open === "now" ? " on" : ""), ariaLabel: "Now", ariaExpanded: String(open === "now"), style: `inset-inline-start:${pct(data.now)}`, onclick: pick("now") }));
    if (open) { const p = pop(line); if (p) line.append(p); }
    el.replaceChildren(top, line);
    if (!planned) el.append(h("div", { className: "rb-act" }, h("button", { type: "button", className: "rb-plan", onclick: () => onPlan?.() }, icon("calendar"), h("span", { textContent: data.word }))));
  }

  // A tap anywhere else shuts the pop-over.
  const away = (e) => { if (open && !e.composedPath().some((n) => n.classList?.contains?.("rb-pop"))) { open = null; paint(); } };
  document.addEventListener("click", away);

  return {
    set(d){ data = d; paint(); },
    unmount(){ document.removeEventListener("click", away); el.replaceChildren(); el.hidden = true; },
  };
}
