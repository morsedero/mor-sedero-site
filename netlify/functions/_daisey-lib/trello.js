// Maps the app's Trello tool calls onto real Trello REST. Response shapes
// mirror tools/test/harness.js's fixtures exactly, minus ARI wrapping —
// real ids are already bare, and bareId() in daisey.html is a no-op on
// them, so nothing there needs to change. See tools/CLAUDE.md's
// "Daisey standalone" section for the full shape-by-shape reasoning.
const KEY = process.env.TRELLO_STANDALONE_API_KEY;

async function trelloFetch(path, { method = "GET", token, params = {}, body } = {}) {
  const url = new URL(`https://api.trello.com/1${path}`);
  url.searchParams.set("key", KEY);
  url.searchParams.set("token", token);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch (e) { /* empty body, e.g. DELETE */ }
  if (!res.ok) {
    const err = new Error((json && json.message) || `Trello ${method} ${path} -> ${res.status}`);
    err.status = res.status;
    err.trelloBody = json;
    throw err;
  }
  return json;
}

// Uppercase to match STATE the app already compares against
// ("COMPLETE"/"INCOMPLETE") — Trello's real REST returns lowercase.
const upState = s => (s || "").toUpperCase();

async function call(tool, input, token) {
  if (tool === "trelloReadCard") {
    if (input.action === "get") {
      const c = await trelloFetch(`/cards/${input.cardId}`, { token, params: { fields: "id,name,desc,due,dueComplete,idList,url,labels" } });
      const list = await trelloFetch(`/lists/${c.idList}`, { token, params: { fields: "id,name" } }).catch(() => null);
      return { cards: { totalCount: 1, nodes: [shapeCard(c, list)] } };
    }
    // list_by_board
    const cards = await trelloFetch(`/boards/${input.boardIdOrUrl}/cards`, {
      token,
      params: {
        filter: input.filter || "open",
        fields: "id,name,desc,due,dueComplete,idList,url,labels,lastActivityAt",
      },
    });
    const lists = await trelloFetch(`/boards/${input.boardIdOrUrl}/lists`, { token, params: { fields: "id,name" } });
    const listById = new Map(lists.map(l => [l.id, l]));
    return { cards: { totalCount: cards.length, nodes: cards.map(c => shapeCard(c, listById.get(c.idList))) } };
  }

  if (tool === "trelloReadList") {
    const lists = await trelloFetch(`/boards/${input.boardId}/lists`, { token, params: { fields: "id,name" } });
    return { lists: lists.slice(0, 50).map((l, i) => ({ id: l.id, name: l.name, position: i + 1, objectId: l.id })) };
  }

  if (tool === "trelloReadChecklist") {
    const checklists = await trelloFetch(`/cards/${input.cardId}/checklists`, { token, params: { checkItems: "all" } });
    return {
      checklists: checklists.map(cl => ({
        id: cl.id, name: cl.name, position: cl.pos,
        checkItems: (cl.checkItems || []).map(it => ({ id: it.id, name: it.name, state: upState(it.state), position: it.pos })),
      })),
      hasMore: false,
    };
  }

  if (tool === "trelloReadBoard") {
    if (input.action === "get") {
      try {
        const b = await trelloFetch(`/boards/${input.boardId}`, { token, params: { fields: "id,name" } });
        return { cards: { nodes: [{ id: b.id, name: b.name }], totalCount: 1 } };
      } catch (e) {
        if (e.status === 401 || e.status === 404) return { cards: { nodes: [], totalCount: 0 } };
        throw e;
      }
    }
    const boards = await trelloFetch("/members/me/boards", { token, params: { fields: "id,name" } });
    return {
      cards: {
        nodes: boards.map(b => ({ id: b.id, name: b.name })),
        totalCount: boards.length,
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    };
  }

  if (tool === "trelloWriteCard") {
    if (input.action === "create") {
      const c = await trelloFetch("/cards", {
        method: "POST", token,
        body: { idList: input.listId, name: input.name, desc: input.desc },
      });
      return { cards: { nodes: [{ id: c.id }] } };
    }
    if (input.action === "mark_done") {
      await trelloFetch(`/cards/${input.cardId}`, { method: "PUT", token, body: { dueComplete: true } });
      return { cards: { nodes: [{ id: input.cardId }] } };
    }
    if (input.action === "archive") {
      await trelloFetch(`/cards/${input.cardId}`, { method: "PUT", token, body: { closed: true } });
      return { cards: { nodes: [{ id: input.cardId }] } };
    }
    if (input.action === "move") {
      const body = { idList: input.listId };
      if (input.boardId) body.idBoard = input.boardId;
      if (input.pos !== undefined) body.pos = input.pos;
      await trelloFetch(`/cards/${input.cardId}`, { method: "PUT", token, body });
      return { cards: { nodes: [{ id: input.cardId }] } };
    }
    // update
    const body = {};
    if (input.name !== undefined) body.name = input.name;
    if (input.desc !== undefined) body.desc = input.desc;
    if (input.due !== undefined) body.due = input.due;
    await trelloFetch(`/cards/${input.cardId}`, { method: "PUT", token, body });
    return { cards: { nodes: [{ id: input.cardId }] } };
  }

  if (tool === "trelloWriteChecklist") {
    // update_item — the app only ever sends checklistId+itemId, no cardId,
    // so this has to go through the checklist-scoped endpoint, not the
    // card-scoped one.
    const body = {};
    if (input.checked !== undefined) body.state = input.checked ? "complete" : "incomplete";
    if (input.text !== undefined) body.name = input.text;
    const it = await trelloFetch(`/checklists/${input.checklistId}/checkItems/${input.itemId}`, {
      method: "PUT", token, body,
    });
    return { id: it.id, name: it.name, state: upState(it.state), position: it.pos };
  }

  if (tool === "trelloWriteList") {
    const l = await trelloFetch("/lists", {
      method: "POST", token,
      body: { idBoard: input.boardId, name: input.name, pos: input.pos },
    });
    return { lists: [{ id: l.id, name: l.name }] };
  }

  const err = new Error(`Unknown Trello tool: ${tool}`);
  err.status = 400;
  throw err;
}

function shapeCard(c, list) {
  return {
    id: c.id, name: c.name, desc: c.desc || "",
    url: c.url, webUrl: c.url,
    list: list ? { id: list.id, name: list.name } : null,
    labels: c.labels || [],
    due: c.due || null, dueComplete: !!c.dueComplete,
    lastActivityAt: c.lastActivityAt || null,
    members: [],
  };
}

module.exports = { call };
