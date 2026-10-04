// Weekly goals (DAISEY_SPEC "Weekly intents"): one number per area, how many
// tasks a week you want to finish there. Set from the account menu. The
// number feeds the engine's area balance (engine.areaBalance) and shows as
// quiet progress in Tasks. Changes save straight away, like settings.
import { watchSettings, saveSettings } from "./store.js";
import { AREAS, LABELS } from "./model.js";
import { h } from "./ui.js";

const MAX = 7; // a week; more than that isn't a goal, it's a job

export function mountIntents(dialog, uid){
  let intents = {};
  const fail = (e) => console.error("[daisey] intents", e);

  function save(next){
    intents = next;
    saveSettings(uid, { intents }).catch(fail);
    paint();
  }

  function row(a){
    const n = intents[a] || 0, name = LABELS.area[a];
    return h("div", { className: "int-row" },
      h("span", { className: "int-name", textContent: name }),
      h("div", { className: "int-step" },
        h("button", { className: "chip", type: "button", textContent: "\u2212", disabled: n <= 0,
          ariaLabel: `Fewer ${name} a week`, onclick: () => save({ ...intents, [a]: Math.max(0, n - 1) }) }),
        h("output", { className: "int-n", textContent: n ? `${n} a week` : "none", ariaLabel: `${name}: ${n ? n + " a week" : "no goal"}` }),
        h("button", { className: "chip", type: "button", textContent: "+", disabled: n >= MAX,
          ariaLabel: `More ${name} a week`, onclick: () => save({ ...intents, [a]: Math.min(MAX, n + 1) }) })));
  }

  function paint(){
    dialog.replaceChildren(
      h("div", { className: "now-head" }, h("h2", { id: "intTitle", textContent: "Weekly goals" }),
        h("button", { className: "now-x", type: "button", ariaLabel: "Close", textContent: "\u2715", onclick: () => dialog.close() })),
      h("p", { className: "muted", textContent: "How many tasks a week you want to finish in each area. Daisey gives a neglected area a turn; nothing here is scored against you." }),
      h("div", { className: "int-list" }, ...AREAS.map(row)));
  }

  dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });
  const unsub = watchSettings(uid, (s) => { intents = s?.intents || {}; if (dialog.open) paint(); }, fail);

  return {
    open(){ paint(); if (!dialog.open) dialog.showModal(); },
    unmount(){ unsub(); if (dialog.open) dialog.close(); dialog.replaceChildren(); },
  };
}
