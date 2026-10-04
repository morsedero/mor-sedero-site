// Bringing Trello cards in, once. Pick a board, pick which lists to take,
// and Daisey copies the open cards into tasks it then owns outright — no
// sync back, no sync forward (DAISEY_SPEC.md: "Daisey owns the task list").
//
// Run it again whenever: every imported task remembers its card id, so the
// cards already here are listed as "already in Daisey" and only the new ones
// come over. Nothing is written until the button is pressed.
import { idToken } from "./firebase.js";
import { watchTasks, addTask } from "./store.js";
import { h, bdi } from "./ui.js";

const URL_ = "/.netlify/functions/daisey-now-trello";
const ERROR = {
  not_connected: "Trello isn't linked. Sign in to the old Daisey once, with Trello connected.",
  no_session: "Signed out.",
  trello: "Trello didn't answer.",
};

async function get(query){
  const res = await fetch(`${URL_}?${query}`, { headers: { Authorization: `Bearer ${await idToken()}` } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error || `http ${res.status}`), { code: body.error });
  return body;
}

export function mountImport(dialog, uid){
  let tasks = [];
  let state = { step: "boards", boards: [], board: null, lists: [], cards: [], chosen: new Set(), busy: false, error: "", done: null };

  const imported = () => new Set(tasks.map((t) => t.source?.cardId).filter(Boolean));

  const close = () => { dialog.close(); state = { ...state, step: "boards", error: "", done: null }; };

  async function run(fn){
    state.busy = true; state.error = ""; render();
    try { await fn(); }
    catch (e) {
      console.error("[daisey] trello", e);
      state.error = ERROR[e.code] || "Couldn't reach Trello.";
    }
    state.busy = false; render();
  }

  const loadBoards = () => run(async () => {
    state.boards = (await get("boards")).boards;
    state.step = "boards";
  });

  const openBoard = (board) => run(async () => {
    const data = await get(`cards=${encodeURIComponent(board.id)}`);
    state.board = data.board;
    state.lists = data.lists;
    state.cards = data.cards;
    // Everything that isn't here yet, ticked by default: the usual answer.
    const have = imported();
    state.chosen = new Set(state.lists.filter((l) => state.cards.some((c) => c.listId === l.id && !have.has(c.id))).map((l) => l.id));
    state.step = "lists";
  });

  // The cards that would come over: in a ticked list, not already imported.
  function pick(){
    const have = imported();
    return state.cards.filter((c) => state.chosen.has(c.listId) && !have.has(c.id));
  }

  const doImport = () => run(async () => {
    const cards = pick();
    for (const c of cards) {
      // The list is the project, which is how Trello boards are usually
      // organised anyway. Size is left to Daisey to guess.
      await addTask(uid, {
        title: c.name,
        project: c.listName || state.board.name,
        due: c.due ? c.due.slice(0, 10) : "",
        notes: c.url,
        source: { app: "trello", cardId: c.id, boardId: state.board.id },
      }, tasks).catch((e) => { throw e; });
    }
    state.done = cards.length;
    state.step = "done";
  });

  function body(){
    if (state.step === "done") {
      return [h("p", { textContent: state.done ? `Brought in ${state.done} card${state.done === 1 ? "" : "s"}. Daisey owns them now — Trello won't hear about changes.` : "Nothing new to bring in." }),
        h("button", { className: "btn primary", type: "button", textContent: "Done", onclick: close })];
    }
    if (state.step === "lists") {
      const have = imported();
      return [
        h("p", { className: "muted" }, "From ", bdi(state.board.name), ". Pick the lists to take."),
        h("div", { className: "imp-lists" }, ...state.lists.map((l) => {
          const cards = state.cards.filter((c) => c.listId === l.id);
          const fresh = cards.filter((c) => !have.has(c.id)).length;
          const box = h("input", { type: "checkbox", checked: state.chosen.has(l.id), disabled: !fresh,
            onchange: () => { box.checked ? state.chosen.add(l.id) : state.chosen.delete(l.id); render(); } });
          return h("label", { className: "imp-list" }, box,
            h("span", {}, bdi(l.name)),
            h("span", { className: "muted", textContent: fresh === cards.length ? `${fresh}` : `${fresh} new of ${cards.length}` }));
        })),
        h("div", { className: "imp-actions" },
          h("button", { className: "btn", type: "button", textContent: "Back", disabled: state.busy, onclick: () => { state.step = "boards"; render(); } }),
          h("button", { className: "btn primary", type: "button", disabled: state.busy || !pick().length,
            textContent: state.busy ? "Bringing them in…" : `Bring in ${pick().length}`, onclick: doImport })),
      ];
    }
    if (!state.boards.length) return [h("p", { className: "muted", textContent: state.busy ? "Looking…" : "No Trello boards." })];
    return [h("p", { className: "muted", textContent: "Which board?" }),
      h("div", { className: "imp-lists" }, ...state.boards.map((b) => h("button", {
        className: "btn imp-board", type: "button", disabled: state.busy, onclick: () => openBoard(b),
      }, bdi(b.name))))];
  }

  function render(){
    dialog.replaceChildren(
      h("div", { className: "now-head" },
        h("h2", { id: "importTitle", textContent: "Import from Trello" }),
        h("button", { className: "now-x", type: "button", ariaLabel: "Close", textContent: "✕", onclick: close })),
      ...body(),
      state.error ? h("p", { className: "msg", role: "alert", textContent: state.error }) : h("p", { className: "msg" }));
  }

  dialog.addEventListener("click", (e) => { if (e.target === dialog) close(); });
  const unsub = watchTasks(uid, (ts) => { tasks = ts; if (dialog.open) render(); }, (e) => console.error("[daisey] import", e));

  return {
    open(){
      state = { ...state, step: "boards", board: null, error: "", done: null };
      render();
      if (!dialog.open) dialog.showModal();
      loadBoards();
    },
    unmount(){ unsub(); if (dialog.open) dialog.close(); dialog.replaceChildren(); },
  };
}
