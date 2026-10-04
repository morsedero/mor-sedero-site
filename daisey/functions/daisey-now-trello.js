// Reading Trello, so tasks can be brought into Daisey once. One way only:
// Daisey owns a task from the moment it lands (DAISEY_SPEC.md, "No Trello
// sync"). Nothing here writes to Trello, and nothing writes to Daisey either
// — the app does that, after the user picks what to take.
//
// GET ?boards            → { boards: [{ id, name }] }
// GET ?cards=<boardId>   → { board, lists: [{ id, name }],
//                            cards: [{ id, name, listId, listName, due, url }] }
// with "Authorization: Bearer <Firebase ID token>".
//
// Auth matches the calendar endpoints: the Firebase sign-in's Google `sub`
// maps to old Daisey's user id in Netlify Blobs, which is where its Trello
// token lives. No Trello login of its own.
//
// Errors: 401 no_session · 404 not_connected (no Trello link on that user) ·
// 400 bad_request · 502 trello.
const { verifyIdToken } = require("./_daisey-lib/firebase-auth");
const { openStore } = require("./_daisey-lib/blobs");
const { getTrelloToken } = require("./_daisey-lib/tokens");

const KEY = process.env.TRELLO_STANDALONE_API_KEY;
const API = "https://api.trello.com/1";
const MAX_CARDS = 500;

const reply = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  body: JSON.stringify(body),
});
const fail = (statusCode, code) => reply(statusCode, { error: code });

async function trello(path, token, params = {}) {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries({ key: KEY, token, ...params })) url.searchParams.set(k, v);
  const res = await fetch(url);
  if (!res.ok) throw Object.assign(new Error(`trello ${res.status}`), { status: res.status });
  return res.json();
}

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") return fail(405, "get_only");
  if (!KEY) return fail(502, "trello");

  let claims;
  try {
    const token = (event.headers.authorization || event.headers.Authorization || "").replace(/^Bearer\s+/i, "");
    claims = await verifyIdToken(token);
  } catch (e) {
    return fail(401, "no_session");
  }
  const sub = claims.firebase?.identities?.["google.com"]?.[0];
  if (!sub) return fail(404, "not_connected");

  const userId = await openStore("daisey-users").get(`google-sub:${sub}`, { type: "text" });
  if (!userId) return fail(404, "not_connected");
  const token = await getTrelloToken(userId);
  if (!token) return fail(404, "not_connected");

  const q = event.queryStringParameters || {};
  try {
    if (q.boards !== undefined) {
      const boards = await trello("/members/me/boards", token, { fields: "id,name,closed", filter: "open" });
      return reply(200, { boards: boards.filter((b) => !b.closed).map((b) => ({ id: b.id, name: b.name })) });
    }

    if (q.cards) {
      const [board, lists, cards] = await Promise.all([
        trello(`/boards/${q.cards}`, token, { fields: "id,name" }),
        trello(`/boards/${q.cards}/lists`, token, { fields: "id,name" }),
        trello(`/boards/${q.cards}/cards`, token, { filter: "open", fields: "id,name,due,dueComplete,idList,url" }),
      ]);
      const listName = new Map(lists.map((l) => [l.id, l.name]));
      return reply(200, {
        board: { id: board.id, name: board.name },
        lists: lists.map((l) => ({ id: l.id, name: l.name })),
        // Cards already ticked off in Trello aren't work anyone still has to do.
        cards: cards.filter((c) => !c.dueComplete).slice(0, MAX_CARDS).map((c) => ({
          id: c.id, name: c.name, listId: c.idList, listName: listName.get(c.idList) || "", due: c.due || null, url: c.url,
        })),
      });
    }

    return fail(400, "bad_request");
  } catch (e) {
    if (e.status === 401) return fail(404, "not_connected");
    console.error("daisey-now-trello", e);
    return fail(502, "trello");
  }
};
