/* A Trello card can carry a start date — the mirror of due, a lower bound
   instead of a deadline. The connector itself has no `start` field (checked
   exhaustively); a Netlify webhook function mirrors Trello's real field into
   the description as a hidden `<!-- daisey-start:YYYY-MM-DD -->` HTML
   comment (2026-08-18: was a visible `▶ Starts YYYY-MM-DD — ` prefix, moved
   to a hidden marker after it showed up as real clutter in the card's
   actual Trello description), and normCard parses that marker into
   card.start. candidates(date) excludes a card whose start
   date is after the day being built, so it can't be picked (or offered in
   the swap picker) before it's meant to begin; once the built day reaches
   that date it's eligible and scheduled by the normal size rules like any
   other card (quick/short/long — unaffected by this gate). */
const fs=require("fs"),vm=require("vm");const {chromium}=require("playwright");
const H=fs.readFileSync(__dirname+"/harness.js","utf8");
const page_html=fs.readFileSync(__dirname+"/daisey.html","utf8");
const sb={require,__dirname,module:{exports:{}},exports:{},console,process};
vm.runInNewContext(H.split("(async () => {")[0]+"\nmodule.exports={stub};",sb);
const BASE=sb.module.exports.stub;

const clock=t=>`const R=Date;const O=new R("${t}").getTime()-R.now();
window.Date=class extends R{constructor(...a){if(a.length===0)super(R.now()+O);else super(...a);}static now(){return R.now()+O;}};`;

const bad=[];
const check=(cond,msg)=>{ if(!cond) bad.push(msg); };

(async()=>{
  const b=await chromium.launch({});
  const ctx=await b.newContext({viewport:{width:420,height:900},timezoneId:"Asia/Jerusalem",colorScheme:"dark"});
  const p=await ctx.newPage();
  p.on("pageerror",e=>bad.push("pageerror: "+e.message));
  p.on("console",m=>{if(m.type()==="error" && !/^\[daisey\]/.test(m.text()))bad.push("console: "+m.text());});
  await p.setContent(`<!doctype html><html><head><meta charset="utf-8"><script>${clock("2026-08-17T07:00:00+03:00")}${BASE}<\/script></head><body>${page_html}</body></html>`,{waitUntil:"load"});
  await p.waitForTimeout(2600);

  /* Clears every other real fixture card out of the pool first — otherwise
     PROJECTS' own long-session card wins the day and legitimately excludes
     every quick task (start date or not), which isn't what's under test
     here. Keeps סידורים's hidden state card in place so saveStats doesn't
     try to create a replacement mid-test. */
  const seedCard = (startDate) => p.evaluate((startDate)=>{
    const stats = S.cards.sidurim.payload.cards.nodes.find(n => /^📊/.test(n.name));
    S.cards.projects.payload.cards.nodes.length = 0;
    S.cards.sidurim.payload.cards.nodes.length = 0;
    if(stats) S.cards.sidurim.payload.cards.nodes.push(stats);
    const bag = S.cards.sedco.payload.cards.nodes;
    bag.length = 0;
    bag.push({
      id: "ari:cloud:trello::card/workspace/6047bc9723ed9c3e9036b496/futcard1",
      name: "Synthetic Future Task", desc: startDate ? `<!-- daisey-start:${startDate} -->` : "",
      url: "https://trello.com/c/synFut01/1-x", webUrl: "https://trello.com/c/synFut01/1-x",
      list: { id: "list1", name: "list" },
      labels: [], due: null, dueComplete: false,
      lastActivityAt: "2026-08-14T09:00:00.000Z", members: []
    });
    EVENTS.length = 0;
    S.events = { payload:{ events:EVENTS }, storedAt:Date.now() };
    S.failed=[]; S.pending.clear();
    render();
  }, startDate);

  // start date two days out — not eligible for today's build
  await seedCard("2026-08-19");
  await p.waitForTimeout(300);
  let inPool = await p.evaluate(()=>candidates(S.anchor).some(c=>c.name==="Synthetic Future Task"));
  console.log("[start in the future]", "inPool:", inPool);
  check(!inPool, "a card whose start date is after the day being built should not be a candidate");

  await p.click("#replanBtn");
  await p.waitForTimeout(400);
  if(await p.evaluate(()=>!!document.querySelector(".dialog .btn.primary")))
    await p.click(".dialog .btn.primary");
  await p.waitForTimeout(1200);
  /* The 2026-08-26 redesign moved the CURRENT task out of #pageMain and into
     #heroSlot, so a probe scoped to "#pageMain .row .n" silently matches
     nothing and every "is it scheduled?" check passes vacuously. Read both. */
  const dayNames = ()=>[...document.querySelectorAll("#heroSlot .n, #pageMain .rows .row .n")]
    .map(n=>n.textContent).join(" | ");
  let scheduled = await p.evaluate(dayNames);
  console.log("[after rebuild, future-start]", scheduled);
  check(!scheduled.includes("Synthetic Future Task"), "a future-start card should not get scheduled today");

  // start date today — eligible now
  await seedCard("2026-08-17");
  await p.waitForTimeout(300);
  inPool = await p.evaluate(()=>candidates(S.anchor).some(c=>c.name==="Synthetic Future Task"));
  console.log("[start today]", "inPool:", inPool);
  check(inPool, "a card whose start date is today should be a candidate");

  await p.click("#replanBtn");
  await p.waitForTimeout(400);
  if(await p.evaluate(()=>!!document.querySelector(".dialog .btn.primary")))
    await p.click(".dialog .btn.primary");
  await p.waitForTimeout(1200);
  const rows = await p.evaluate(dayNames);
  console.log("[after rebuild, start today]", rows);
  check(rows.includes("Synthetic Future Task"), "a card whose start date has arrived should be scheduled like any other");

  // no start date at all: unaffected (already covered by every other suite,
  // spot-checked here for completeness)
  await seedCard(null);
  await p.waitForTimeout(300);
  inPool = await p.evaluate(()=>candidates(S.anchor).some(c=>c.name==="Synthetic Future Task"));
  check(inPool, "a card with no start date at all should be a candidate as always");

  // 2026-08-18 reorder: overdue now outranks the start-today boost (tierOf
  // comment) — a missed date beats a card that merely became eligible this
  // morning. Was the reverse; updated to match.
  await p.evaluate(()=>{
    const stats = S.cards.sidurim.payload.cards.nodes.find(n => /^📊/.test(n.name));
    S.cards.projects.payload.cards.nodes.length = 0;
    S.cards.sidurim.payload.cards.nodes.length = 0;
    if(stats) S.cards.sidurim.payload.cards.nodes.push(stats);
    const bag = S.cards.sedco.payload.cards.nodes;
    bag.length = 0;
    bag.push({
      id: "ari:cloud:trello::card/workspace/6047bc9723ed9c3e9036b496/overduecard1",
      name: "Overdue Task", desc: "",
      url: "https://trello.com/c/od01/1-x", webUrl: "https://trello.com/c/od01/1-x",
      list: { id: "list1", name: "list" },
      labels: [], due: "2026-08-10T00:00:00.000Z", dueComplete: false,
      lastActivityAt: "2026-08-14T09:00:00.000Z", members: []
    });
    bag.push({
      id: "ari:cloud:trello::card/workspace/6047bc9723ed9c3e9036b496/futcard1",
      name: "Synthetic Future Task", desc: "<!-- daisey-start:2026-08-17 -->",
      url: "https://trello.com/c/synFut01/1-x", webUrl: "https://trello.com/c/synFut01/1-x",
      list: { id: "list1", name: "list" },
      labels: [], due: null, dueComplete: false,
      lastActivityAt: "2026-08-14T09:00:00.000Z", members: []
    });
    EVENTS.length = 0;
    S.events = { payload:{ events:EVENTS }, storedAt:Date.now() };
    S.failed=[]; S.pending.clear();
    render();
  });
  await p.waitForTimeout(300);
  const order = await p.evaluate(()=>rankCards(candidates(S.anchor)).map(c=>c.name));
  console.log("[tier order vs overdue]", order.join(" | "));
  check(order[0] === "Overdue Task", "overdue should still rank first, ahead of a card whose start date arrives today");

  // ---- 2026-08-18: the marker is a hidden HTML comment, not visible text —
  // it must never leak into what Daisey itself shows or hands the user to
  // edit, and a description edit must not silently drop it. ----
  const marker = await p.evaluate(()=>{
    const withReal = "Call the plumber about the leak.\n\n<!-- daisey-start:2026-08-20 -->";
    const bare = "<!-- daisey-start:2026-08-20 -->";
    return {
      strippedWithReal: withoutStartMarker(withReal),
      strippedBare: withoutStartMarker(bare),
      extracted: extractStartMarker(withReal),
      startKey: dayKey(normCard({ name:"x", desc:withReal }, {key:"projects",name:"PROJECTS"}).start)
    };
  });
  check(marker.strippedWithReal === "Call the plumber about the leak.",
    `withoutStartMarker must hide the comment from real text, got ${JSON.stringify(marker.strippedWithReal)}`);
  check(marker.strippedBare === "",
    `a desc that's only the marker should read as empty once stripped, got ${JSON.stringify(marker.strippedBare)}`);
  check(marker.extracted === "<!-- daisey-start:2026-08-20 -->",
    `extractStartMarker must return the exact marker text, got ${JSON.stringify(marker.extracted)}`);
  check(marker.startKey === "2026-08-20",
    `normCard must still parse the date out of the hidden marker, got ${JSON.stringify(marker.startKey)}`);

  // saveCardDesc: editing the visible text must not drop a Start marker the
  // user never saw or typed.
  const savedDesc = await p.evaluate(()=>{
    const stats = S.cards.sidurim.payload.cards.nodes.find(n => /^📊/.test(n.name));
    S.cards.projects.payload.cards.nodes.length = 0;
    S.cards.sidurim.payload.cards.nodes.length = 0;
    if(stats) S.cards.sidurim.payload.cards.nodes.push(stats);
    const bag = S.cards.sedco.payload.cards.nodes;
    bag.length = 0;
    const card = {
      id: "ari:cloud:trello::card/workspace/6047bc9723ed9c3e9036b496/editcard1",
      name: "Edit Me", desc: "old text\n\n<!-- daisey-start:2026-08-21 -->",
      url: "https://trello.com/c/editc01/1-x", webUrl: "https://trello.com/c/editc01/1-x",
      list: { id: "list1", name: "list" },
      labels: [], due: null, dueComplete: false,
      lastActivityAt: "2026-08-14T09:00:00.000Z", members: []
    };
    bag.push(card);
    EVENTS.length = 0;
    S.events = { payload:{ events:EVENTS }, storedAt:Date.now() };
    S.failed=[]; S.pending.clear();
    render();
    const normed = allCards().find(c=>c.name==="Edit Me");
    saveCardDesc(normed, "new text, no marker in sight");
    return normed.desc;   // patchLocalCard mutates the object saveCardDesc was given, synchronously
  });
  await p.waitForTimeout(200);
  check(/<!--\s*daisey-start:2026-08-21\s*-->/.test(savedDesc),
    `saveCardDesc must re-append the Start marker the user never saw, got ${JSON.stringify(savedDesc)}`);
  check(savedDesc.includes("new text, no marker in sight"), "saveCardDesc must keep the user's actual edit");

  console.log(bad.length ? "FAIL:\n  ✗ "+bad.join("\n  ✗ ")
                         : "✓ a start date gates eligibility without changing how a card is sized once it's in · the marker stays hidden and survives description edits");
  await b.close();
  process.exit(bad.length?1:0);
})();
