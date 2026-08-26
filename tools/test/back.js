/* Pending, 2026-08-18 decision: it should no longer mean "hide forever
   until I manually clear it." Undated Pending is eligible immediately;
   dated Pending is eligible once its date passes — same as before. What's
   new is that either way, once eligible, the card carries `pendingReturned`
   and tierOf ranks it in the same top tier as a card whose start date
   arrives today (see start.js), except this boost doesn't fade after one
   day: it keeps firing every day the card sits unresolved, since unlike a
   start date there's no natural "it's been claimed" moment. Re-pending an
   already-returned card (now a reachable path, since it's not `blocked`
   any more) has to replace the old marker, not nest a second one inside
   it — pendingItem strips any existing Pending marker before writing. */
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
  p.on("console",m=>{if(m.type()==="error")bad.push("console: "+m.text());});
  await p.setContent(`<!doctype html><html><head><meta charset="utf-8"><script>${clock("2026-08-17T07:00:00+03:00")}${BASE}<\/script></head><body>${page_html}</body></html>`,{waitUntil:"load"});
  await p.waitForTimeout(2600);

  // normCard-level: undated Pending is eligible right away; dated Pending
  // is eligible only once its date passes; both are `pendingReturned` once
  // eligible, and a still-waiting dated one is neither.
  const norm = await p.evaluate(()=>{
    const board={key:"sidurim",name:"סידורים"};
    const undated = normCard({id:"x1",name:"Task A",desc:"⏳ Pending — need approval",labels:[]},board);
    const notYet  = normCard({id:"x2",name:"Task B",desc:"⏳ Pending until 2026-08-25 — need approval",labels:[]},board);
    const past    = normCard({id:"x3",name:"Task C",desc:"⏳ Pending until 2026-08-15 — need approval",labels:[]},board);
    return {
      undated: {blocked:undated.blocked, pendingReturned:undated.pendingReturned},
      notYet:  {blocked:notYet.blocked,  pendingReturned:notYet.pendingReturned},
      past:    {blocked:past.blocked,    pendingReturned:past.pendingReturned}
    };
  });
  console.log("[normCard]", JSON.stringify(norm));
  check(norm.undated.blocked===false && norm.undated.pendingReturned===true, "undated Pending should be eligible and pendingReturned right away");
  check(norm.notYet.blocked===true && norm.notYet.pendingReturned===false, "a dated Pending not yet due should still block, not pendingReturned");
  check(norm.past.blocked===false && norm.past.pendingReturned===true, "a dated Pending past its date should be eligible and pendingReturned");

  // tierOf, 2026-08-18 reorder: overdue now outranks pendingReturned (same
  // tier as a start-today card) — a missed date is the strongest signal.
  // Was the reverse; updated to match.
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
      id: "ari:cloud:trello::card/workspace/6047bc9723ed9c3e9036b496/returnedcard1",
      name: "Returned Task", desc: "⏳ Pending — need approval",
      url: "https://trello.com/c/ret01/1-x", webUrl: "https://trello.com/c/ret01/1-x",
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
  console.log("[tier order]", order.join(" | "));
  check(order[0]==="Overdue Task", "overdue should still rank first, ahead of a returned Pending card");
  const stillIn = await p.evaluate(()=>candidates(S.anchor).some(c=>c.name==="Returned Task"));
  check(stillIn, "a returned Pending card is a real candidate, not just ranked high while excluded");

  // re-pending an already-returned card replaces the marker, doesn't nest it
  const rewrite = await p.evaluate(()=>{
    const card = candidates(S.anchor).find(c=>c.name==="Returned Task");
    const ev = { id: "synthEvReturned1" };
    pendingItem({card, ev}, { desc: card.desc, until: "2026-09-01" });
    return new Promise(res=>setTimeout(()=>{
      const call = window.__calls.find(c=>c.tool==="trelloWriteCard" && c.input.action==="update" && c.input.cardId===card.id);
      res(call ? call.input.desc : null);
    }, 500));
  });
  console.log("[re-pend write]", rewrite);
  const markerCount = rewrite ? (rewrite.match(/⏳ Pending/g)||[]).length : -1;
  check(markerCount===1, "re-pending a returned card should replace the old marker, not nest a second one (found "+markerCount+")");
  check(!!rewrite && rewrite.includes("2026-09-01"), "re-pending should write the new until date");

  console.log(bad.length ? "FAIL:\n  ✗ "+bad.join("\n  ✗ ")
                         : "✓ Pending returns eligible on time, ranks top while unresolved, and re-pending replaces its marker cleanly");
  await b.close();
  process.exit(bad.length?1:0);
})();
