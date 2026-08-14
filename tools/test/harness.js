/* Local smoke-test harness. Replays the connector shapes observed in-session
   against the real page code, in Chromium. Never shipped. */
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const page_html = fs.readFileSync(path.join(__dirname, "dayflow.html"), "utf8");

const WSB = "ari:cloud:trello::board/workspace/6047bc9723ed9c3e9036b496/";
const WSL = "ari:cloud:trello::list/workspace/6047bc9723ed9c3e9036b496/";
const WSC = "ari:cloud:trello::card/workspace/6047bc9723ed9c3e9036b496/";

const card = (id, name, listId, listName, boardId, boardName, o = {}) => ({
  id: WSC + id, name, desc: o.desc || "",
  url: `https://trello.com/c/${o.short || id.slice(0, 8)}/1-x`,
  webUrl: `https://trello.com/c/${o.short || id.slice(0, 8)}/1-x`,
  list: { id: WSL + listId, name: listName },
  board: { id: WSB + boardId, name: boardName },
  labels: [], due: o.due || null, dueComplete: !!o.done,
  lastActivityAt: o.last || "2026-08-14T09:00:00.000Z", members: []
});

const TODAY_B = "6a7a17e2ed53384c4f792d87";
const L_TODAY = "6a7a17e6498e4a01d6e8a7ad";
const L_DONE  = "6a7a17e6fa8d1b840074ed07";
const L_DF    = "6a7f122bfaae567f2d12af95";

const FIX = {
  "692abd49a69c853bb71cb728": [   // PROJECTS (deep)
    card("6a7a16b45edb755b2107cf9d", "לולאת מוזיקה לבמה הראשית (Main Stage Music Loop)", "692ad0f8af173930081b8cc0", "MonsterPunk", "692abd49a69c853bb71cb728", "PROJECTS", { desc: "🔴 URGENT — top priority. ~120m", last: "2026-08-01T09:00:00.000Z", short: "aWUJk3a8" }),
    card("6a57724dc9a3b2a279542008", "לקבל אישור SFX V3", "6945507695274f7bf6ec669d", "Party Pooper", "692abd49a69c853bb71cb728", "PROJECTS", { desc: "תקוע — waiting", last: "2026-07-15T11:43:10.004Z", short: "OG77QlEj" })
  ],
  "693683bc8be8844147bbe82c": [   // סידורים (small)
    card("6942b6c70120be08ee10477f", "ארנונה", "692ad30a3c912740b99aebba", "יאלללהלהלה", "693683bc8be8844147bbe82c", "סידורים", { due: "2026-08-13T06:00:00.000Z", last: "2026-08-11T20:30:12.676Z", short: "TXxCAu3T" }),
    card("6a7b85c078d48893cd304370", "טיפול דרך צה\"ל", "692ad30a3c912740b99aebba", "יאלללהלהלה", "693683bc8be8844147bbe82c", "סידורים", { due: "2026-08-17T06:00:00.000Z", last: "2026-08-11T20:29:53.156Z" }),
    card("695e184a125fc0d87373fae5", "סרטונים קצרים של מערכות סאונד", "692ad344119a1755d3ce76a1", "עיצוב אתר", "693683bc8be8844147bbe82c", "סידורים", { last: "2026-01-07T08:29:53.828Z", short: "rhgdTRFD" })
  ],
  "6a718220df5bd657f0636bc7": [   // סדקו (small)
    card("6a7182f4349203169ce7fa4b", "לסגור מקום לחתונה", "6a7182a99c4984af4dfe290e", "יאללה היום!", "6a718220df5bd657f0636bc7", "סדקו", { due: "2026-08-14T06:00:00.000Z", last: "2026-08-13T18:24:02.671Z", short: "Y9SpnlTP" }),
    card("6a7182d9ba4edcf3ef5add6d", "לתקן מזגן מקצר חדר שינה", "6a7182a99c4984af4dfe290e", "יאללה היום!", "6a718220df5bd657f0636bc7", "סדקו", { desc: "מחכה לתשובה מיוסי", due: "2026-08-21T06:00:00.000Z", last: "2026-08-14T07:05:10.974Z", short: "svkJStfN" }),
    card("6a71830a641f324ff3551517", "לסדר את המחסן", "6a71841f0bac3afffd2fc607", "משימותתתת", "6a718220df5bd657f0636bc7", "סדקו", { due: "2026-08-25T08:31:00.000Z", last: "2026-08-11T10:16:45.339Z", short: "mByvGrzM" }),
    card("6a71835602e51f5dc1e2e7a3", "ברבקטו לסופי", "6a71841f0bac3afffd2fc607", "משימותתתת", "6a718220df5bd657f0636bc7", "סדקו", {})
  ],
  [TODAY_B]: [
    card("6a7ed991f988fbbbd59def7e", "🔴 תקוע+איחור: לסגור מקום לחתונה — overdue + blocked", L_TODAY, "🔴 היום (Today)", TODAY_B, "היום - עדיפות עליונה (Today's Priorities)", {}),
    card("6a7ed993c56bdd32067c8bc2", "🔴 OVERDUE: ארנונה — 1 day overdue", L_TODAY, "🔴 היום (Today)", TODAY_B, "היום - עדיפות עליונה (Today's Priorities)", {}),
    card("6a7ed99594a720272bcafaba", "⚠️ תקוע: לתקן מזגן — waiting on Yossi", L_TODAY, "🔴 היום (Today)", TODAY_B, "היום - עדיפות עליונה (Today's Priorities)", {}),
    card("6a7a278aba6a75a3148fc0da", "🔴 P1: דוח למנטור (Mentor report)", L_DONE, "✅ בוצע (Done)", TODAY_B, "היום - עדיפות עליונה (Today's Priorities)", { done: true }),
    card("6a7f123751886d625eda3c24", "📊 DayFlow Stats", L_DF, "📊 DayFlow (widget state — do not edit)", TODAY_B, "היום - עדיפות עליונה (Today's Priorities)",
      { desc: 'DayFlow widget state store.\n\n<!--DAYFLOW_STATE_V1\n{"v":1,"streak":4,"lastCompletionDate":"2026-08-13","history":[],"categories":{"סדקו":{"picked":10,"done":7},"PROJECTS":{"picked":6,"done":2}},"rollovers":{"' + WSC + '6a71830a641f324ff3551517":{"first":"2026-08-06","count":6,"last":"2026-08-13"}},"plans":{},"mute":false}\nDAYFLOW_STATE_V1-->\n' })
  ]
};

const LISTS = {
  "692abd49a69c853bb71cb728": [["692ad0f8af173930081b8cc0", "MonsterPunk"], ["6945507695274f7bf6ec669d", "Party Pooper"]],
  "693683bc8be8844147bbe82c": [["692ad30a3c912740b99aebba", "יאלללהלהלה"], ["692ad1da2e76e1fe6c1f9699", "MONEY MONEY"], ["692ad344119a1755d3ce76a1", "עיצוב אתר"]],
  "6a718220df5bd657f0636bc7": [["6a7182a99c4984af4dfe290e", "יאללה היום!"], ["6a71841f0bac3afffd2fc607", "משימותתתת"]],
  [TODAY_B]: [[L_TODAY, "🔴 היום (Today)"], [L_DONE, "✅ בוצע (Done)"], [L_DF, "📊 DayFlow (widget state — do not edit)"]]
};

/* events for 2026-08-14 (Friday) — mix of all-day, real meetings, task blocks */
const EVENTS = [
  { id: "allday1", summary: "מילואים", start: { date: "2026-08-09T00:00:00Z" }, end: { date: "2026-08-21T00:00:00Z" }, status: "confirmed" },
  { id: "real1", summary: "חמל", start: { dateTime: "2026-08-14T06:00:00+03:00", timeZone: "Asia/Jerusalem" }, end: { dateTime: "2026-08-14T14:00:00+03:00", timeZone: "Asia/Jerusalem" }, status: "confirmed" },
  { id: "real2", summary: "ישיבה עם אסתר", start: { dateTime: "2026-08-14T16:00:00+03:00", timeZone: "Asia/Jerusalem" }, end: { dateTime: "2026-08-14T17:00:00+03:00", timeZone: "Asia/Jerusalem" }, status: "confirmed" },
  { id: "task1", colorId: "9", summary: "🏛️ ארנונה — overdue, pay today", description: "[dayflow] DayFlow block.\nOriginal: https://trello.com/c/TXxCAu3T", start: { dateTime: "2026-08-14T14:15:00+03:00", timeZone: "Asia/Jerusalem" }, end: { dateTime: "2026-08-14T14:45:00+03:00", timeZone: "Asia/Jerusalem" }, status: "confirmed" },
  { id: "task2", colorId: "5", summary: "🎵 Main Stage Music Loop", description: "[dayflow] DayFlow block.\nOriginal: https://trello.com/c/aWUJk3a8", start: { dateTime: "2026-08-14T17:30:00+03:00", timeZone: "Asia/Jerusalem" }, end: { dateTime: "2026-08-14T19:00:00+03:00", timeZone: "Asia/Jerusalem" }, status: "confirmed" }
];

const stub = `
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
function payloadFor(server, tool, input){
  if(tool === "trelloReadCard") return { cards: { totalCount: (FIX[idOf(input.boardIdOrUrl)]||[]).length, nodes: FIX[idOf(input.boardIdOrUrl)] || [] } };
  if(tool === "trelloReadList") return { lists: (LISTS[idOf(input.boardId)]||[]).map(([id,name],i)=>({ id:"ari:cloud:trello::list/workspace/6047bc9723ed9c3e9036b496/"+id, name, position:i+1, objectId:id })) };
  if(tool === "trelloReadChecklist") return { checklists: CHECKLISTS[idOf(input.cardId)] || [], hasMore:false };
  if(tool === "list_events")    return { accessRole:"owner", events: EVENTS, summary:"morsedero@gmail.com", timeZone:"Asia/Jerusalem" };
  return {};
}
window.claude = {
  use: async (n) => n === "mcp" ? {
    watchTool(server, tool, input, handler, opts){
      const fire = () => handler({ type:"data", result:{ payload: payloadFor(server,tool,input), content:[], cache:{ storedAt: Date.now(), revalidating:false } } });
      const w = { server, tool, input, fire, live:true };
      WATCHERS.push(w);
      setTimeout(()=>{ if(w.live) fire(); }, 30);
      return () => { w.live = false; };
    },
    async callTool(server, tool, input){
      window.__calls.push({ server, tool, input });
      if(tool === "trelloReadChecklist" || tool === "trelloReadCard" || tool === "trelloReadList" || tool === "list_events")
        return { payload: payloadFor(server, tool, input) };
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
        if(e){ e.start={dateTime:input.startTime}; e.end={dateTime:input.endTime}; }
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
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
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

  // 3. week + month views
  await run("week", monday, "light", async p => {
    await p.click('.segmented button[data-view="week"]');
    await p.waitForTimeout(700);
  });
  await run("month", monday, "light", async p => {
    await p.click('.segmented button[data-view="month"]');
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
