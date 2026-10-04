// A one-time question after the 2026-10-04 migration. Every date a task
// already had became a Target (a wish); this asks which of them are real
// Deadlines. Asked once (state/settings.deadlinesAsked), the first time all
// tasks are migrated and some open ones carry a date. However it closes,
// it's answered: from then on the task sheet's Deadline/Target chips do it.
import { watchTasks, watchSettings, saveSettings, restoreTask } from "./store.js";
import { TASK_VERSION } from "./model.js";
import { h, bdi } from "./ui.js";

const shortDate = (s) => new Date(`${s}T12:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });

export function mountDeadlines(dialog, uid){
  let tasks = null, settings = null, shown = false;
  const fail = (e) => console.error("[daisey] deadlines", e);

  function maybeAsk(){
    if (shown || !tasks || !settings || settings.deadlinesAsked) return;
    if (tasks.some((t) => (t.v || 0) < TASK_VERSION)) return; // migration still landing
    shown = true;
    const dated = tasks.filter((t) => t.due && t.status !== "done").sort((a, b) => a.due.localeCompare(b.due));
    if (!dated.length) { saveSettings(uid, { deadlinesAsked: true }).catch(fail); return; }
    ask(dated);
  }

  function ask(dated){
    const boxes = dated.map((t) => h("input", { type: "checkbox", checked: t.dateKind === "deadline" }));
    const finish = (save) => {
      if (save) dated.forEach((t, i) => {
        const kind = boxes[i].checked ? "deadline" : "target";
        if (t.dateKind !== kind) restoreTask(uid, t.id, { dateKind: kind }).catch(fail);
      });
      saveSettings(uid, { deadlinesAsked: true }).catch(fail);
      dialog.close();
    };
    dialog.replaceChildren(
      h("div", { className: "now-head" }, h("h2", { id: "dlTitle", textContent: "Which dates are real deadlines?" }),
        h("button", { className: "now-x", type: "button", ariaLabel: "Close", textContent: "✕", onclick: () => finish(false) })),
      h("p", { className: "muted", textContent: "Tick the ones that really can't slip. The rest become targets: wish dates that move on quietly if they pass." }),
      h("ul", { className: "dl-list" }, ...dated.map((t, i) => h("li", {},
        h("label", { className: "dl-row" }, boxes[i], h("span", { className: "dl-title" }, bdi(t.title)),
          h("span", { className: "muted dl-date", textContent: shortDate(t.due) }))))),
      h("div", { className: "sheet-actions" },
        h("button", { className: "btn primary", type: "button", textContent: "Save", autofocus: true, onclick: () => finish(true) }),
        h("button", { className: "btn quiet", type: "button", textContent: "None are", onclick: () => { boxes.forEach((b) => { b.checked = false; }); finish(true); } })));
    dialog.onclose = () => { if (!settings?.deadlinesAsked) saveSettings(uid, { deadlinesAsked: true }).catch(fail); };
    dialog.showModal();
  }

  // Both from the server, not the cache: a stale cached "not asked" would
  // ask a second time on a device that already answered.
  const unsubs = [
    watchTasks(uid, (ts, meta) => { if (!meta?.fromCache) { tasks = ts; maybeAsk(); } }, fail),
    watchSettings(uid, (s, meta) => { if (!meta?.fromCache) { settings = s; maybeAsk(); } }, fail),
  ];
  return { unmount(){ unsubs.forEach((u) => u()); if (dialog.open) dialog.close(); dialog.replaceChildren(); } };
}
