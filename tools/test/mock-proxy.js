/* A tiny HTTP server standing in for netlify/functions/daisey-proxy.js.
 *
 * Build order step 2: prove the daisey.html -> daisey-standalone.html splice
 * actually works — that the app boots, watches fire, writes land — before
 * any real OAuth or Netlify Function exists. Fixture shapes mirror
 * tools/test/harness.js's FIX/LISTS/CHECKLISTS, but with BARE ids (no ARI
 * wrapping) since that's what real Trello/Google REST returns and what the
 * real daisey-proxy.js will produce — see build-standalone plan §3/§5:
 * bareId() becomes a no-op once ids are already bare, nothing else needs to
 * change for that.
 *
 * Session model: a fixed fake session cookie. This mock never rejects it —
 * auth-flow testing is a separate, later step (build order 3-5); this one
 * is purely "does the shim + splice + polling loop actually work."
 */
const http = require("http");

const B_PROJECTS = "692abd49a69c853bb71cb728";
const B_SIDURIM  = "693683bc8be8844147bbe82c";
const B_SEDCO    = "6a718220df5bd657f0636bc7";
const B_MPAUDIO  = "6a82c2cd37d859bc17a06fb8";
const L_STATE    = "6a7fe7139743ddfb8c0c902f";

const card = (id, name, listId, listName, o={}) => ({
  id, name, desc: o.desc || "",
  url: `https://trello.com/c/${id.slice(0,8)}/x`, webUrl: `https://trello.com/c/${id.slice(0,8)}/x`,
  list: { id: listId, name: listName },
  labels: o.labels || [], due: o.due || null, dueComplete: !!o.done,
  lastActivityAt: o.last || "2026-08-17T09:00:00.000Z", members: []
});

const FIX = {
  [B_PROJECTS]: [
    card("c-proj-1", "Pay rent", "l-proj-todo", "To do"),
  ],
  [B_SIDURIM]: [
    card("c-sid-state", "📊 Daisey Stats", L_STATE, "📊 Daisey (widget state — do not edit)", {
      desc: 'Daisey widget state store.\n\n<!--DAYFLOW_STATE_V1\n' + JSON.stringify({
        v:1, streak:2, lastCompletionDate:null, history:[], categories:{}, rollovers:{}, plans:{}, mute:false,
        setup: {
          v:1, calId:"mock@example.com", calName:"Mock Calendar",
          boards:[
            { key:"b0", id:B_PROJECTS, name:"PROJECTS", tracker:false, color:"#A855F7" },
            { key:"b1", id:B_SIDURIM,  name:"סידורים",  tracker:false, color:"#00B8D9" }
          ],
          statsBoardKey:"b1", batchBoardKey:null
        }
      }) + '\nDAYFLOW_STATE_V1-->\n'
    }),
  ],
  [B_SEDCO]: [],
  [B_MPAUDIO]: [],
};
const LISTS = {
  [B_PROJECTS]: [["l-proj-todo","To do"]],
  [B_SIDURIM]: [["l-sid-1","Errands"], [L_STATE, "📊 Daisey (widget state — do not edit)"]],
  [B_SEDCO]: [], [B_MPAUDIO]: [],
};
const EVENTS = [];
let writeCalls = [];

function boardsList(){
  return { cards: { nodes: [
    { id:B_PROJECTS, name:"PROJECTS" },
    { id:B_SIDURIM,  name:"סידורים" },
  ], totalCount:2, pageInfo:{ hasNextPage:false, endCursor:null } } };
}

function handle(server, tool, input){
  if(server === "Session" && tool === "whoami") return {};
  if(tool === "trelloReadBoard"){
    if(input.action === "get") return { cards:{ nodes:[], totalCount:0 } }; // no legacy match in this mock
    return boardsList();
  }
  if(tool === "trelloReadCard"){
    const nodes = FIX[input.boardIdOrUrl] || [];
    return { cards:{ totalCount: nodes.length, nodes } };
  }
  if(tool === "trelloReadList"){
    const arr = LISTS[input.boardId] || [];
    return { lists: arr.map(([id,name],i) => ({ id, name, position:i+1, objectId:id })) };
  }
  if(tool === "trelloReadChecklist") return { checklists: [], hasMore:false };
  if(tool === "trelloWriteCard"){
    writeCalls.push({ tool, input });
    if(input.action === "create"){
      const id = "new-" + Math.random().toString(36).slice(2,9);
      return { cards:{ nodes:[{ id }] } };
    }
    return { cards:{ nodes:[{ id: input.cardId }] } };
  }
  if(tool === "trelloWriteChecklist"){
    writeCalls.push({ tool, input });
    return { id: input.itemId, name: input.text || "", state: input.checked ? "COMPLETE" : "INCOMPLETE", position:1 };
  }
  if(tool === "trelloWriteList"){
    writeCalls.push({ tool, input });
    return { lists: [{ id: "new-list-" + Date.now(), name: input.name }] };
  }
  if(tool === "list_calendars") return { calendars: [{ id:"mock@example.com", summary:"Mock Calendar", timeZone:"UTC" }] };
  if(tool === "list_events") return { accessRole:"owner", events: EVENTS, summary:"mock@example.com", timeZone:"UTC" };
  if(tool === "create_event"){
    writeCalls.push({ tool, input });
    const ev = { id:"ev-"+Date.now(), summary:input.summary, description:input.description, colorId:input.colorId,
      status:"confirmed", start:{ dateTime:input.startTime }, end:{ dateTime:input.endTime } };
    EVENTS.push(ev);
    return ev;
  }
  if(tool === "update_event"){
    writeCalls.push({ tool, input });
    const e = EVENTS.find(x => x.id === input.eventId);
    if(e){
      if(input.startTime !== undefined) e.start = { dateTime: input.startTime };
      if(input.endTime !== undefined) e.end = { dateTime: input.endTime };
      if(input.description !== undefined) e.description = input.description;
    }
    return e || {};
  }
  if(tool === "delete_event"){
    writeCalls.push({ tool, input });
    const i = EVENTS.findIndex(x => x.id === input.eventId);
    if(i >= 0) EVENTS.splice(i,1);
    return { status:"cancelled" };
  }
  return {};
}

/* Serves BOTH the app html (so fetch("/.netlify/functions/daisey-proxy",...)
   resolves same-origin — relative fetch paths need a real http:// origin,
   not file://) and the mock proxy endpoint, on one port. `html` is the
   already-read daisey-standalone.html contents. */
function start(port, html){
  const server = http.createServer((req,res) => {
    if(req.method === "GET"){
      /* charset=utf-8 is not optional: without it the browser defaults to
         Latin-1, and every emoji/Hebrew character in daisey-standalone.html
         (📊, סידורים, …) — including the exact "📊 Daisey Stats" marker
         STATS_NAME_RE matches on — comes through mojibake'd. That silently
         broke state-card discovery in this harness, not in the app. */
      res.writeHead(200, { "Content-Type":"text/html; charset=utf-8" });
      res.end(html);
      return;
    }
    res.setHeader("Access-Control-Allow-Origin", "*");
    if(req.method !== "POST"){ res.writeHead(404); res.end(); return; }
    let body = "";
    req.on("data", c => body += c);
    req.on("end", () => {
      try{
        const { server:srv, tool, input } = JSON.parse(body || "{}");
        const payload = handle(srv, tool, input || {});
        res.writeHead(200, { "Content-Type":"application/json; charset=utf-8" });
        res.end(JSON.stringify({ payload }));
      }catch(e){
        res.writeHead(500, { "Content-Type":"application/json; charset=utf-8" });
        res.end(JSON.stringify({ error:{ code:"tool_error", message:String(e) } }));
      }
    });
  });
  return new Promise(resolve => server.listen(port, () => resolve({ server, writeCalls: () => writeCalls })));
}

module.exports = { start };
