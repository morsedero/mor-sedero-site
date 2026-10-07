// Bringing Trello cards in, once. Pick a board, pick which lists to take,
// and Daisey copies the open cards into tasks it then owns outright — no
// sync back, no sync forward (DAISEY_SPEC.md: "Daisey owns the task list").
//
// Run it again whenever: every imported task remembers its card id, so the
// cards already here are listed as "already in Daisey" and only the new ones
// come over. Nothing is written until the button is pressed.
import { idToken } from "./firebase.js";
import { watchTasks, addTask, updateTask } from "./store.js";
import { h, bdi } from "./ui.js";

// Earlier imports wrote the card's URL into the notes. They're cleaned out
// wherever they're found, once per sign-in — a line that is nothing but a
// Trello link goes, and a link inside a sentence the user wrote is left
// alone. Delete this when the tasks that have one are gone.
const TRELLO_LINK = /https?:\/\/(?:www\.)?trello\.com\/\S*/gi;
const stripLink = (notes) => String(notes || "")
  .split("\n")
  .filter((line) => !/^\s*https?:\/\/(?:www\.)?trello\.com\/\S*\s*$/i.test(line))
  .join("\n")
  .trim();

function dropCardLinks(uid, tasks, done){
  for (const t of tasks) {
    if (done.has(t.id) || t.source?.app !== "trello" || !t.notes) continue;
    TRELLO_LINK.lastIndex = 0;
    if (!TRELLO_LINK.test(t.notes)) continue;
    const notes = stripLink(t.notes);
    if (notes === t.notes) continue; // a link inside their own sentence
    done.add(t.id);
    updateTask(uid, t, { notes }, tasks).catch((e) => console.error("[daisey] trello notes", e));
  }
}

const URL_ = "/.netlify/functions/daisey-now-trello";
const SAVE_URL = "/.netlify/functions/daisey-auth-trello-save";

// Connect Trello (2026-10-07). A full-page trip through Trello's authorize
// page (daisey-auth-trello-start, return=now). Trello hands the token back in
// the URL fragment, the callback forwards it to /daisey/now/?trello=1#token=…,
// and finishTrelloConnect() saves it under this sign-in, then drops the
// fragment from the address bar. The token never touches a server in a URL.
export function connectTrello(){
  location.href = "/.netlify/functions/daisey-auth-trello-start?return=now";
}
// → true saved · false failed · null nothing to finish. Call once at startup.
export async function finishTrelloConnect(){
  const params = new URLSearchParams(location.search);
  if (params.get("trello") !== "1") return null;
  const token = new URLSearchParams(location.hash.slice(1)).get("token");
  history.replaceState(history.state, "", location.pathname); // the token leaves the address bar now
  if (!token) return false;
  try {
    const res = await fetch(SAVE_URL, { method: "POST", headers: { Authorization: `Bearer ${await idToken()}`, "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
    return res.ok;
  } catch (e) { console.error("[daisey] trello connect", e); return false; }
}
// Is Trello linked and still working?
export async function trelloConnected(){
  try {
    const res = await fetch(`${URL_}?status`, { headers: { Authorization: `Bearer ${await idToken()}` } });
    return res.ok;
  } catch { return false; }
}

const ERROR = {
  not_connected: "Trello isn't connected yet.",
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
      state.notConnected = e.code === "not_connected";
      state.error = state.notConnected ? "" : ERROR[e.code] || "Couldn't reach Trello.";
    }
    state.busy = false; render();
  }

  const loadBoards = () => run(async () => {
    state.notConnected = false;
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
      // No card link in the notes (Mor, 2026-10-04: "don't need it"). The
      // card id is kept in `source` either way, which is what re-importing
      // reads; the notes are for what the user writes there.
      await addTask(uid, {
        title: c.name,
        project: c.listName || state.board.name,
        due: c.due ? c.due.slice(0, 10) : "",
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
    if (state.notConnected) return [h("p", { className: "muted", textContent: "Connect Trello once, then pick the boards to bring in." }),
      h("button", { className: "btn primary", type: "button", textContent: "Connect Trello", onclick: connectTrello })];
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
  const cleaned = new Set(); // ids already patched, so a snapshot loop can't repeat one
  const unsub = watchTasks(uid, (ts) => {
    tasks = ts;
    dropCardLinks(uid, ts, cleaned);
    if (dialog.open) render();
  }, (e) => console.error("[daisey] import", e));

  return {
    open(){
      state = { ...state, step: "boards", board: null, error: "", done: null, notConnected: false };
      render();
      if (!dialog.open) dialog.showModal();
      loadBoards();
    },
    unmount(){ unsub(); if (dialog.open) dialog.close(); dialog.replaceChildren(); },
  };
}
