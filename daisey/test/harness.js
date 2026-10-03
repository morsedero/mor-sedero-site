/* Local smoke-test harness. Replays the connector shapes observed in-session
   against the real page code, in Chromium. Never shipped. */
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const page_html = fs.readFileSync(path.join(__dirname, "daisey.html"), "utf8");

const WSB = "ari:cloud:trello::board/workspace/6047bc9723ed9c3e9036b496/";
const WSL = "ari:cloud:trello::list/workspace/6047bc9723ed9c3e9036b496/";
const WSC = "ari:cloud:trello::card/workspace/6047bc9723ed9c3e9036b496/";

/* o.size: "short" -> one yellow label, "long" -> one orange label, else none */
const SIZE_LABEL = { short: [{ id: "lbl-y", name: "", color: "yellow" }],
                      long:  [{ id: "lbl-o", name: "", color: "orange" }] };
const card = (id, name, listId, listName, boardId, boardName, o = {}) => ({
  id: WSC + id, name, desc: o.desc || "",
  url: `https://trello.com/c/${o.short || id.slice(0, 8)}/1-x`,
  webUrl: `https://trello.com/c/${o.short || id.slice(0, 8)}/1-x`,
  list: { id: WSL + listId, name: listName },
  board: { id: WSB + boardId, name: boardName },
  labels: o.labels || SIZE_LABEL[o.size] || [], due: o.due || null, dueComplete: !!o.done,
  start: o.start || null,
  lastActivityAt: o.last || "2026-08-14T09:00:00.000Z", members: []
});

const L_DF    = "6a7fe7139743ddfb8c0c902f";   // widget-state list, lives on סידורים now

const FIX = {
  "692abd49a69c853bb71cb728": [   // PROJECTS — size now comes from the label, not the board
    card("6a7a16b45edb755b2107cf9d", "לולאת מוזיקה לבמה הראשית (Main Stage Music Loop)", "692ad0f8af173930081b8cc0", "MonsterPunk", "692abd49a69c853bb71cb728", "PROJECTS", { desc: "🔴 URGENT — top priority. ~120m", last: "2026-08-01T09:00:00.000Z", short: "aWUJk3a8", size: "short" }),
    card("6a57724dc9a3b2a279542008", "לקבל אישור SFX V3", "6945507695274f7bf6ec669d", "Party Pooper", "692abd49a69c853bb71cb728", "PROJECTS", { desc: "תקוע — waiting", last: "2026-07-15T11:43:10.004Z", short: "OG77QlEj" }),
    card("6a7a16b78f083be2881704de", "רשימת SFX דחופה (Urgent SFX Punch List)", "692ad0f8af173930081b8cc0", "MonsterPunk", "692abd49a69c853bb71cb728", "PROJECTS", { desc: "🔴 URGENT — full punch list", last: "2026-08-10T09:00:00.000Z", short: "03GLnjpt", size: "long" })
  ],
  "693683bc8be8844147bbe82c": [   // סידורים — also hosts the widget's own hidden state card
    card("6942b6c70120be08ee10477f", "ארנונה", "692ad30a3c912740b99aebba", "יאלללהלהלה", "693683bc8be8844147bbe82c", "סידורים", { due: "2026-08-13T06:00:00.000Z", last: "2026-08-11T20:30:12.676Z", short: "TXxCAu3T" }),
    card("6a7b85c078d48893cd304370", "טיפול דרך צה\"ל", "692ad30a3c912740b99aebba", "יאלללהלהלה", "693683bc8be8844147bbe82c", "סידורים", { due: "2026-08-17T06:00:00.000Z", last: "2026-08-11T20:29:53.156Z" }),
    card("695e184a125fc0d87373fae5", "סרטונים קצרים של מערכות סאונד", "692ad344119a1755d3ce76a1", "עיצוב אתר", "693683bc8be8844147bbe82c", "סידורים", { last: "2026-01-07T08:29:53.828Z", short: "rhgdTRFD" }),
    card("6a7f123751886d625eda3c24", "📊 Daisey Stats", L_DF, "📊 Daisey (widget state — do not edit)", "693683bc8be8844147bbe82c", "סידורים",
      { desc: 'Daisey widget state store.\n\n<!--DAYFLOW_STATE_V1\n{"v":1,"streak":4,"lastCompletionDate":"2026-08-13","history":[],"categories":{"סדקו":{"picked":10,"done":7},"PROJECTS":{"picked":6,"done":2}},"rollovers":{"' + WSC + '6a71830a641f324ff3551517":{"first":"2026-08-06","count":6,"last":"2026-08-13"}},"plans":{},"mute":false,"settings":{"openEvents":["חמל"]}}\nDAYFLOW_STATE_V1-->\n' })
  ],
  "6a718220df5bd657f0636bc7": [   // סדקו
    card("6a7182f4349203169ce7fa4b", "לסגור מקום לחתונה", "6a7182a99c4984af4dfe290e", "יאללה היום!", "6a718220df5bd657f0636bc7", "סדקו", { due: "2026-08-14T06:00:00.000Z", last: "2026-08-13T18:24:02.671Z", short: "Y9SpnlTP" }),
    card("6a7182d9ba4edcf3ef5add6d", "לתקן מזגן מקצר חדר שינה", "6a7182a99c4984af4dfe290e", "יאללה היום!", "6a718220df5bd657f0636bc7", "סדקו", { desc: "מחכה לתשובה מיוסי", due: "2026-08-21T06:00:00.000Z", last: "2026-08-14T07:05:10.974Z", short: "svkJStfN" }),
    card("6a71830a641f324ff3551517", "לסדר את המחסן", "6a71841f0bac3afffd2fc607", "משימותתתת", "6a718220df5bd657f0636bc7", "סדקו", { due: "2026-08-25T08:31:00.000Z", last: "2026-08-11T10:16:45.339Z", short: "mByvGrzM", size: "short" }),
    card("6a71835602e51f5dc1e2e7a3", "ברבקטו לסופי", "6a71841f0bac3afffd2fc607", "משימותתתת", "6a718220df5bd657f0636bc7", "סדקו", {})
  ]
};

const LISTS = {
  "692abd49a69c853bb71cb728": [["692ad0f8af173930081b8cc0", "MonsterPunk"], ["6945507695274f7bf6ec669d", "Party Pooper"]],
  "693683bc8be8844147bbe82c": [["692ad30a3c912740b99aebba", "יאלללהלהלה"], ["692ad1da2e76e1fe6c1f9699", "MONEY MONEY"], ["692ad344119a1755d3ce76a1", "עיצוב אתר"], [L_DF, "📊 Daisey (widget state — do not edit)"]],
  "6a718220df5bd657f0636bc7": [["6a7182a99c4984af4dfe290e", "יאללה היום!"], ["6a71841f0bac3afffd2fc607", "משימותתתת"]]
};

/* events for 2026-08-14 (Friday) — mix of all-day, real meetings, task blocks */
const EVENTS = [
  { id: "allday1", summary: "מילואים", start: { date: "2026-08-09T00:00:00Z" }, end: { date: "2026-08-21T00:00:00Z" }, status: "confirmed" },
  { id: "real1", summary: "חמל", start: { dateTime: "2026-08-14T06:00:00+03:00", timeZone: "Asia/Jerusalem" }, end: { dateTime: "2026-08-14T14:00:00+03:00", timeZone: "Asia/Jerusalem" }, status: "confirmed" },
  { id: "real2", summary: "ישיבה עם אסתר", start: { dateTime: "2026-08-14T16:00:00+03:00", timeZone: "Asia/Jerusalem" }, end: { dateTime: "2026-08-14T17:00:00+03:00", timeZone: "Asia/Jerusalem" }, status: "confirmed" },
  { id: "task1", colorId: "9", summary: "🏛️ ארנונה — overdue, pay today", description: "[daisey] Daisey block.\nOriginal: https://trello.com/c/TXxCAu3T", start: { dateTime: "2026-08-14T14:15:00+03:00", timeZone: "Asia/Jerusalem" }, end: { dateTime: "2026-08-14T14:45:00+03:00", timeZone: "Asia/Jerusalem" }, status: "confirmed" },
  { id: "task2", colorId: "5", summary: "🎵 Main Stage Music Loop", description: "[daisey] Daisey block.\nOriginal: https://trello.com/c/aWUJk3a8", start: { dateTime: "2026-08-14T17:30:00+03:00", timeZone: "Asia/Jerusalem" }, end: { dateTime: "2026-08-14T19:00:00+03:00", timeZone: "Asia/Jerusalem" }, status: "confirmed" }
];

const stub = `
/* Seed the per-viewer setup so every existing suite keeps its fixtures and
   boots straight into the app instead of the first-run wizard. Uses the
   ORIGINAL board keys (projects/sidurim/sedco/mpaudio) because the fixtures,
   the state-card JSON and the assertions all reference them.
   A suite that wants to exercise the wizard sets window.__NO_SETUP = true
   before load; one that wants a different viewer sets __BOARDS_VISIBLE=[]. */
try{
  if(!window.__NO_SETUP) localStorage.setItem("daisey.setup.v1", JSON.stringify({
    v:1, calId:"morsedero@gmail.com", calName:"morsedero@gmail.com",
    boards:[
      {key:"projects",id:"ari:cloud:trello::board/workspace/6047bc9723ed9c3e9036b496/692abd49a69c853bb71cb728",name:"PROJECTS",color:"#A855F7"},
      {key:"sidurim", id:"ari:cloud:trello::board/workspace/6047bc9723ed9c3e9036b496/693683bc8be8844147bbe82c",name:"סידורים",color:"#00B8D9"},
      {key:"sedco",   id:"ari:cloud:trello::board/workspace/6047bc9723ed9c3e9036b496/6a718220df5bd657f0636bc7",name:"סדקו",color:"#FF7043"},
      {key:"mpaudio", id:"ari:cloud:trello::board/workspace/6047bc9723ed9c3e9036b496/6a82c2cd37d859bc17a06fb8",name:"Monster Punk — Audio",color:"#F0369C",tracker:true}
    ],
    statsBoardKey:"sidurim", batchBoardKey:"projects"
  }));
  else localStorage.removeItem("daisey.setup.v1");
}catch(_){ /* about:blank origin blocks storage — the legacy gate covers it */ }
window.__calls = [];
window.__errors = [];
addEventListener("error", e => window.__errors.push(String(e.message)));
addEventListener("unhandledrejection", e => window.__errors.push("rejection: " + JSON.stringify(e.reason)));
const FIX = ${JSON.stringify(FIX)};
const LISTS = ${JSON.stringify(LISTS)};
const DAY = window.__EVENT_DAY || "2026-08-14";
const EVENTS = JSON.parse(JSON.stringify(${JSON.stringify(EVENTS)}).split("2026-08-14").join(DAY));
const WATCHERS = [];
const CHECKLISTS = {
  "6942b6c70120be08ee10477f": [{ id:"cl1", name:"Checklist", position:1, checkItems:[
    { id:"i1", name:"לבטל חוב משעול השיר", state:"COMPLETE", position:1 },
    { id:"i2", name:"הנחה משרת מילואים", state:"INCOMPLETE", position:2 },
    { id:"i3", name:"קבלות שנתיים אחורה", state:"INCOMPLETE", position:3 }]}],
  "6a7a16b45edb755b2107cf9d": [{ id:"cl2", name:"SFX Items", position:1, checkItems:[
    { id:"j1", name:"🐛 volume-menu leak through boost", state:"INCOMPLETE", position:1 },
    { id:"j2", name:"אויבים חד גלגליים - יריות, תנועה", state:"INCOMPLETE", position:2 }]}]
};

function idOf(ari){ const p = String(ari).split("/"); return p[p.length-1]; }
/* Board list for setup discovery. The real connector's shape is genuinely
   confusing and is replicated EXACTLY here, because a fixture written to match
   the code rather than reality is how the covered-set ARI bug slipped through:
     node.id       -> the FULL BOARD ari  (…/board/workspace/<ws>/<board>)
     node.board.id -> the WORKSPACE ari   (…/workspace/<ws>)   <- not the board!
     node.board.name -> the WORKSPACE name, not the board's.
   Observed 2026-08-24 against the live Trello connector. */
const BOARD_META = [
  ["692abd49a69c853bb71cb728","PROJECTS"],
  ["693683bc8be8844147bbe82c","סידורים"],
  ["6a718220df5bd657f0636bc7","סדקו"],
  ["6a82c2cd37d859bc17a06fb8","Monster Punk - Audio"]
];
/* NB: this block lives inside the browser stub template string, so the
   Node-side WSB/WSL consts above are NOT in scope here — spell the ARIs out. */
const WS_ARI  = "ari:cloud:trello::workspace/6047bc9723ed9c3e9036b496";
const BRD_ARI = "ari:cloud:trello::board/workspace/6047bc9723ed9c3e9036b496/";
const boardNode = ([id,name]) => ({
  id: BRD_ARI + id, name,
  webUrl:"https://trello.com/b/"+id.slice(0,8)+"/x",
  url:"https://trello.com/b/"+id.slice(0,8)+"/x",
  iconType:"board", due:null, dueComplete:null, desc:null, labels:[], members:[],
  list:null,
  board:{ id: WS_ARI, name:"Mor Sedero" }
});
const CALENDARS = [
  { id:"morsedero@gmail.com", summary:"morsedero@gmail.com", timeZone:"Asia/Jerusalem" },
  { id:"work@group.calendar.google.com", summary:"Work", timeZone:"Asia/Jerusalem" }
];
function payloadFor(server, tool, input){
  if(tool === "trelloReadCard"){
    let nodes = FIX[idOf(input.boardIdOrUrl)] || [];
    /* window.__NO_STATE_CARD models a viewer who has boards but has never
       run Daisey — the discovery scan must find nothing and fall through to
       the wizard. Without it, "no local cache" still finds the author's own
       state card and adopts it, which is correct but untestable. */
    if(window.__NO_STATE_CARD) nodes = nodes.filter(c => !/📊/.test(c.name||""));
    return { cards: { totalCount: nodes.length, nodes } };
  }
  if(tool === "trelloReadList") return { lists: (LISTS[idOf(input.boardId)]||[]).map(([id,name],i)=>({ id:"ari:cloud:trello::list/workspace/6047bc9723ed9c3e9036b496/"+id, name, position:i+1, objectId:id })) };
  if(tool === "trelloReadChecklist") return { checklists: CHECKLISTS[idOf(input.cardId)] || [], hasMore:false };
  if(tool === "trelloReadBoard"){
    /* Setting window.__BOARDS_VISIBLE to [] simulates a DIFFERENT viewer,
       whose credentials can't see these boards — that's exactly what the
       legacy-migration gate turns on, so the stub has to express it. */
    const vis = (window.__BOARDS_VISIBLE || BOARD_META.map(m=>m[0]));
    if(input.action === "get"){
      /* __NO_LEGACY models "this viewer is not the author": the legacy probe
         resolves nothing even though their own boards are readable. */
      if(window.__NO_LEGACY) return { cards:{ nodes:[], totalCount:0 } };
      const hit = BOARD_META.find(m => m[0] === idOf(input.boardId) && vis.includes(m[0]));
      return { cards:{ nodes: hit ? [boardNode(hit)] : [], totalCount: hit ? 1 : 0 } };
    }
    const nodes = BOARD_META.filter(m => vis.includes(m[0])).map(boardNode);
    return { cards:{ nodes, totalCount:nodes.length, pageInfo:{ hasNextPage:false, endCursor:null } } };
  }
  if(tool === "list_events")    return { accessRole:"owner", events: EVENTS, summary:"morsedero@gmail.com", timeZone:"Asia/Jerusalem" };
  if(tool === "list_calendars") return { calendars: CALENDARS };
  return {};
}
window.claude = {
  use: async (n) => n === "mcp" ? {
    watchTool(server, tool, input, handler, opts){
      /* A watch whose fetch fails delivers an ERROR EVENT — it does not throw
         out of the watch. Modelling that matters: the boot settle gate now
         treats an errored board as "settled", and a stub that threw instead
         would exercise a path the real connector never takes. */
      const fire = () => {
        const dead = window.__DEAD_SERVER && window.__DEAD_SERVER[server];
        if(dead){ handler({ type:"error", error:{ code:dead, server, message:"connector unavailable" } }); return; }
        let payload;
        try{ payload = payloadFor(server,tool,input); }
        catch(err){ handler({ type:"error", error:{ code:err.code||"tool_error", message:err.message||String(err), server } }); return; }
        handler({ type:"data", result:{ payload, content:[], cache:{ storedAt: Date.now(), revalidating:false } } });
      };
      const w = { server, tool, input, fire, live:true };
      WATCHERS.push(w);
      setTimeout(()=>{ if(w.live) fire(); }, 30);
      return () => { w.live = false; };
    },
    async callTool(server, tool, input){
      window.__calls.push({ server, tool, input });
      /* window.__DEAD_SERVER = {"Trello":"server_not_connected"} models the
         single most likely first-run state for a NEW user: they opened the
         page before ever adding that connector to their Claude account.
         The real capability rejects with a code (never a generic throw) and
         each code has its own correct fix copy, so the stub must reject the
         same way — a page that collapses these into one banner hides the one
         action that would fix it. */
      const dead = window.__DEAD_SERVER && window.__DEAD_SERVER[server];
      if(dead) throw { code:dead, server, message:"connector unavailable" };
      if(tool === "trelloReadChecklist" || tool === "trelloReadCard" || tool === "trelloReadList" ||
         tool === "trelloReadBoard" || tool === "list_events" || tool === "list_calendars")
        return { payload: payloadFor(server, tool, input) };
      if(tool === "trelloWriteList" && input.action === "create"){
        const id = "newlist"+window.__calls.length;
        const bid = idOf(input.boardId);
        (LISTS[bid] = LISTS[bid] || []).push([id, input.name]);
        /* The REAL response shape for this call has never been observed — the
           app is written to read three plausible shapes and to fall back to
           finding the list by name. window.__WRITELIST_SHAPE lets a test
           drive each one, including a shape the app can't parse at all. */
        const ari = "ari:cloud:trello::list/workspace/6047bc9723ed9c3e9036b496/"+id;
        const shape = window.__WRITELIST_SHAPE || "lists.nodes";
        if(shape === "lists.nodes") return { payload:{ lists:{ nodes:[{ id:ari, name:input.name }] } } };
        if(shape === "lists.array") return { payload:{ lists:[{ id:ari, name:input.name }] } };
        if(shape === "bare")        return { payload:{ id:ari, name:input.name } };
        return { payload:{ unexpected:true } };   // app must survive and fall back
      }
      if(tool === "trelloWriteChecklist" && input.action === "update_item"){
        for(const k in CHECKLISTS) for(const cl of CHECKLISTS[k]) for(const it of cl.checkItems)
          if(it.id === input.itemId){
            if(input.checked !== undefined) it.state = input.checked ? "COMPLETE" : "INCOMPLETE";
            if(input.text !== undefined) it.name = input.text;
            return { payload: { id:it.id, name:it.name, state:it.state, position:it.position } }; }
        throw { code:"tool_error", message:"item not found" };
      }
      if(tool === "create_event"){
        const ev = { id:"new"+window.__calls.length, colorId:input.colorId, summary:input.summary,
                     description:input.description, status:"confirmed",
                     start:{dateTime:input.startTime, timeZone:"Asia/Jerusalem"},
                     end:{dateTime:input.endTime, timeZone:"Asia/Jerusalem"} };
        EVENTS.push(ev);
        return { payload: ev };
      }
      if(tool === "update_event"){
        const e = EVENTS.find(x=>x.id===input.eventId);
        /* Partial update: only fields actually present in input change.
           Real Google Calendar's update_event is assumed to behave this
           way (moveBlock only ever sends startTime/endTime, updateBrickDesc
           only ever sends description) but this has never been observed
           against the live connector — see CLAUDE.md's brick-model notes. */
        if(e){
          if(input.startTime !== undefined) e.start = { dateTime: input.startTime };
          if(input.endTime !== undefined) e.end = { dateTime: input.endTime };
          if(input.description !== undefined) e.description = input.description;
        }
        return { payload: e || {} };
      }
      if(tool === "delete_event"){
        const i = EVENTS.findIndex(x=>x.id===input.eventId);
        if(i>=0) EVENTS.splice(i,1);
        return { payload:{ status:"cancelled" } };
      }
      return { payload: { ok:true } };
    },
    async invalidate(){ WATCHERS.filter(w=>w.live).forEach(w=>w.fire()); },
    async listTools(){ return { servers: [] }; }
  } : null
};
`;

const doc = (extra) => `<!doctype html><html><head><meta charset="utf-8">
<script>${extra}${stub}<\/script></head><body>${page_html}</body></html>`;

(async () => {
  const browser = await chromium.launch({});
  const results = [];

  async function run(label, extra, scheme, actions) {
    const ctx = await browser.newContext({ colorScheme: scheme, viewport: { width: 1440, height: 940 }, timezoneId: "Asia/Jerusalem" });
    const p = await ctx.newPage();
    const logs = [];
    p.on("console", m => { if (m.type() === "error") logs.push(m.text()); });
    p.on("pageerror", e => logs.push("pageerror: " + e.message));
    await p.setContent(doc(extra), { waitUntil: "load" });
    await p.waitForTimeout(2500);
    if (actions) await actions(p);
    const errs = await p.evaluate(() => window.__errors);
    const calls = await p.evaluate(() => window.__calls);
    const shot = `shot-${label}.png`;
    await p.screenshot({ path: shot, fullPage: false });
    results.push({ label, logs, errs, calls, shot });
    await ctx.close();
  }

  // 1. real date = Friday 2026-08-14 → Friday curtain, no auto-plan
  await run("friday-dark", "", "dark");
  await run("friday-light", "", "light");

  // 2. force a Monday → auto-plan should fire and write blocks
  const monday = `
    window.__EVENT_DAY = "2026-08-17";
    const RealDate = Date;
    const OFFSET = new RealDate("2026-08-17T11:30:00+03:00").getTime() - RealDate.now();
    window.Date = class extends RealDate {
      constructor(...a){ if(a.length===0) super(RealDate.now()+OFFSET); else super(...a); }
      static now(){ return RealDate.now()+OFFSET; }
    };
  `;
  await run("monday-dark", monday, "dark");

  // 3. week view
  await run("week", monday, "light", async p => {
    await p.click('.segmented button[data-view="week"]');
    await p.waitForTimeout(700);
  });

  // 4. complete a card via the tick → celebration + writes
  await run("complete", monday, "dark", async p => {
    const t = p.locator(".highlights .card .tick").first();
    if (await t.count()) { await t.click(); await p.waitForTimeout(900); }
  });

  for (const r of results) {
    console.log(`\n=== ${r.label} ===`);
    console.log("console errors:", r.logs.length ? r.logs : "none");
    console.log("window errors :", r.errs.length ? r.errs : "none");
    console.log("writes        :", r.calls.map(c => c.tool + (c.input && c.input.action ? ":" + c.input.action : "")).join(", ") || "none");
  }
  await browser.close();
})();
