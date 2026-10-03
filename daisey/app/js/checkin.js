// The daily check-in: a popup on the first visit each day, reopened from
// "Plan today". Hours free today, energy (guess, tap to fix), and tick what
// you'd like done today. Ticked tasks get a boost on the Now card. No clock
// times and no order — the Now card still decides the next step, so nothing
// breaks when the day changes. Saved in users/{uid}/state/today.
import { watchTasks, watchToday, saveToday } from "./store.js";
import { readMoment, scoreTask, compare } from "./engine.js";
import { localDate } from "./model.js";
import { getEnergy, setEnergy } from "./prefs.js";
import { h, chips, ENERGIES, sizeText } from "./ui.js";

const HOURS = [[1, "1 h"], [2, "2 h"], [4, "4 h"], [6, "6 h"], [8, "8 h+"]];
const hm = (min) => (min >= 60 ? `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60}` : ""}` : `${min} min`);

export function mountCheckin(dialog, uid, { onSaved } = {}){
  let tasks = null, today = undefined; // undefined until the first snapshot
  let draft = null; // { hours, picks: Set } while open
  let editEnergy = false;
  let autoChecked = false;

  const body = h("div", { className: "now-body" });
  const fill = (...kids) => body.replaceChildren(...kids.filter(Boolean));
  const close = h("button", { className: "now-x", type: "button", ariaLabel: "Close", textContent: "✕", onclick: () => dialog.close() });
  dialog.replaceChildren(h("div", { className: "now-head" }, h("h2", { id: "checkinTitle", textContent: "Plan today" }), close), body);
  dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });

  const planned = () => today?.date === localDate();

  function render(){
    if (!draft) return;
    const energy = getEnergy();
    const head = [
      chips("Hours free today", HOURS, draft.hours, (v) => { draft.hours = v; render(); }),
      h("button", { type: "button", className: "now-pill", ariaExpanded: String(editEnergy),
        textContent: `Energy: ${energy.level}${energy.guessed ? " (guess)" : ""} ✎`, onclick: () => { editEnergy = !editEnergy; render(); } }),
      editEnergy && chips("How's your energy?", ENERGIES, energy.guessed ? null : energy.level, (v) => { setEnergy(v); editEnergy = false; render(); }),
    ];
    if (tasks == null) { fill(...head, h("p", { className: "muted", textContent: "Loading tasks…" })); return; }

    // Every ready task, best fit for a long stretch at this energy first.
    const m = readMoment({ window: 180, energy: energy.level });
    const list = tasks.filter((t) => t.status === "ready").map((t) => scoreTask(t, m)).sort(compare);
    const minutes = list.filter((s) => draft.picks.has(s.task.id)).reduce((a, s) => a + s.task.size, 0);
    const budget = draft.hours ? draft.hours * 60 : null;

    fill(...head,
      h("div", { className: "now-label", textContent: "What would you like done today?" }),
      list.length === 0 && h("p", { className: "muted", textContent: "No open tasks yet." }),
      h("ul", { className: "ci-list" }, ...list.map((s) => {
        const id = `ci-${s.task.id}`;
        const box = h("input", { type: "checkbox", id, checked: draft.picks.has(s.task.id),
          onchange: () => { box.checked ? draft.picks.add(s.task.id) : draft.picks.delete(s.task.id); render(); } });
        return h("li", {}, h("label", { className: "ci-item", htmlFor: id }, box,
          h("span", { className: "ci-text" },
            h("span", { className: "ci-title", dir: "auto", textContent: s.task.title }),
            h("span", { className: "muted", dir: "auto", textContent: [s.task.project, sizeText(s.task.size), s.task.due && `due ${s.task.due}`].filter(Boolean).join(" · ") }))));
      })),
      draft.picks.size > 0 && h("p", { className: "muted", textContent: `Picked ${hm(minutes)}` + (budget ? ` of ${hm(budget)}` : "") +
        (budget && minutes > budget ? " — more than fits; Daisey will offer the best ones first." : "") }),
      h("div", { className: "now-actions" },
        h("button", { className: "btn", type: "button", textContent: "Skip today", onclick: () => save([]) }),
        h("button", { className: "btn primary", type: "button", textContent: "Start the day", onclick: () => save([...draft.picks]) })));
  }

  function save(picks){
    saveToday(uid, { date: localDate(), hours: draft.hours, picks }).catch((e) => console.error("[daisey] checkin save", e));
    dialog.close();
    onSaved?.();
  }

  function open(){
    const same = planned();
    draft = { hours: same ? today.hours ?? null : null, picks: new Set(same ? today.picks || [] : []) };
    editEnergy = false;
    render();
    if (!dialog.open) dialog.showModal();
  }

  // First visit of the day: open once both snapshots are in.
  const maybeAuto = () => {
    if (autoChecked || tasks == null || today === undefined) return;
    autoChecked = true;
    if (!planned()) open();
  };
  const fail = (e) => console.error("[daisey] checkin", e);
  const unsubs = [
    watchTasks(uid, (ts) => { tasks = ts; maybeAuto(); if (dialog.open) render(); }, fail),
    watchToday(uid, (t) => { today = t; maybeAuto(); }, fail),
  ];

  return {
    open,
    unmount(){ unsubs.forEach((u) => u()); if (dialog.open) dialog.close(); dialog.replaceChildren(); },
  };
}
