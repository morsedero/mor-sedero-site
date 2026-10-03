// TEMPORARY engine panel on the ?debug page (session 3). Set the moment by
// hand (free minutes, energy, optionally a pretend time) and
// see the pick, Something else and the full ranking with each task's points.
// "Not now" here only lives in this tab: it hides the task for the session
// and counts toward today's skip penalty. Goes away with the debug list once
// the Now card (session 4) exists.
import { rank } from "./engine.js";
import { localDate } from "./model.js";

const h = (tag, props = {}, ...kids) => {
  const el = Object.assign(document.createElement(tag), props);
  el.append(...kids.filter((k) => k != null && k !== false));
  return el;
};
let n = 0;
const field = (label, input) => {
  input.id = `dbg-e${++n}`;
  return h("div", { className: "dbg-field" }, h("label", { htmlFor: input.id, textContent: label }), input);
};

const REASONS = {
  waiting: "waiting", stale: "skipped 5× — would ask keep/shrink/drop", skipped: "not now (this session)",
  energy: "needs high energy, you're low", size: "too big for the window",
};
const PARTS = [["urgency", "U"], ["energy", "E"], ["window", "W"], ["momentum", "M"], ["neglect", "N"], ["learned", "L"], ["skips", "S"]];
const DAY = 86400000;

export function mountEngine(root){
  let tasks = [];
  const sessionSkips = new Set();
  const skipsToday = {};

  const f = {
    window: h("input", { type: "number", min: 0, max: 180, step: 5, value: 60, inputMode: "numeric" }),
    energy: h("select", {}, ...["low", "medium", "high"].map((v) => h("option", { value: v, textContent: v, selected: v === "medium" }))),
    time: h("input", { type: "datetime-local" }),
  };
  for (const el of Object.values(f)) el.oninput = () => render();
  const reset = h("button", { className: "btn small", type: "button", textContent: "New session", onclick: () => { sessionSkips.clear(); render(); } });
  const out = h("div", { className: "eng-out" });
  root.replaceChildren(
    h("h2", { className: "label", textContent: "Now engine (debug)" }),
    h("div", { className: "eng-form" },
      field("Free minutes", f.window), field("Energy", f.energy),
      field("Pretend time (empty = now)", f.time)),
    out);

  const pts = (s) => PARTS.filter(([k]) => s.parts[k]).map(([k, l]) => `${l}${s.parts[k] > 0 ? "+" : ""}${s.parts[k]}`).join(" ");

  function card(s, label){
    return h("div", { className: "eng-card" + (label === "Now" ? " pick" : "") },
      h("div", { className: "dbg-project", dir: "auto", textContent: `${label} · ${s.task.project} · ${s.task.size} min · ${s.task.energy}` }),
      h("div", { className: "dbg-title", dir: "auto", textContent: s.task.title }),
      h("div", { textContent: s.why || "(no reason worth saying)" }),
      h("div", { className: "muted", textContent: `score ${s.score} · ${pts(s)}` }));
  }

  function render(){
    const now = f.time.value ? new Date(f.time.value).getTime() : Date.now();
    const today = localDate(now);
    // Until the action log exists (session 5), "activity" = finishing a task.
    const done = tasks.filter((t) => t.doneAt && t.doneAt <= now).sort((a, b) => b.doneAt - a.doneAt);
    const last = done.find((t) => localDate(t.doneAt) === today)?.project || null;

    const r = rank(tasks, {
      now, window: f.window.value, energy: f.energy.value, lastProject: last,
      recentProjects: done.filter((t) => now - t.doneAt < 2 * DAY).map((t) => t.project),
      sessionSkips: [...sessionSkips], skipsToday,
    });

    const notNow = (s) => h("button", { className: "btn small", type: "button", textContent: "Not now", onclick: () => {
      sessionSkips.add(s.task.id);
      skipsToday[s.task.id] = (skipsToday[s.task.id] || 0) + 1;
      render();
    } });
    const empty = r.empty === "none" ? "No tasks yet — the chat bar would invite a brain dump."
      : r.empty === "nofit" ? `Nothing fits the next ${r.moment.window} minutes. Take the break.` : null;

    out.replaceChildren(...[
      h("p", { className: "muted", textContent:
        `${r.moment.window} min free · energy ${r.moment.energy} · ${r.moment.bucket.part}${r.moment.bucket.weekend ? " (weekend)" : ""}` +
        (last ? ` · momentum: ${last}` : "") + (sessionSkips.size ? ` · ${sessionSkips.size} hidden this session` : "") }),
      empty && h("p", { className: "eng-empty", textContent: empty }),
      r.pick && card(r.pick, "Now"),
      r.alternatives.length > 0 && h("h3", { className: "label", textContent: "Something else" }),
      ...r.alternatives.map((s) => card(s, "Alt")),
      h("div", { className: "dbg-tabs" }, h("h3", { className: "label", textContent: `Ranking (${r.ranked.length})` }), sessionSkips.size > 0 && reset),
      h("ol", { className: "dbg-list eng-rank" }, ...r.ranked.map((s) => h("li", { className: "dbg-task" },
        h("div", { className: "dbg-title", dir: "auto", textContent: s.task.title }),
        h("div", { textContent: s.why }),
        h("div", { className: "muted", textContent: `score ${s.score} · ${s.task.project} · ${s.task.size} min · ${s.task.energy}${s.task.due ? " · due " + s.task.due : ""} · ${pts(s)}` }),
        h("div", { className: "dbg-actions" }, notNow(s))))),
      r.out.length > 0 && h("h3", { className: "label", textContent: `Left out (${r.out.length})` }),
      h("ul", { className: "dbg-list" }, ...r.out.map((o) => h("li", { className: "dbg-task off" },
        h("div", { className: "dbg-title", dir: "auto", textContent: o.task.title }),
        h("div", { className: "muted", textContent: REASONS[o.reason] || o.reason })))),
    ].filter(Boolean));
  }

  const tick = setInterval(() => { if (!f.time.value) render(); }, 60000);
  return {
    update(ts){ tasks = ts; render(); },
    unmount(){ clearInterval(tick); root.replaceChildren(); },
  };
}
