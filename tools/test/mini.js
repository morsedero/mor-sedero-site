const fs=require("fs"),vm=require("vm");const {chromium}=require("playwright");
const H=fs.readFileSync("harness.js","utf8");const page_html=fs.readFileSync("dayflow.html","utf8");
const sb={require,__dirname,module:{exports:{}},exports:{},console,process};
vm.runInNewContext(H.split("(async () => {")[0]+"\nmodule.exports={stub};",sb);
const BASE=sb.module.exports.stub;
const REAL=JSON.parse(fs.readFileSync("real-events.json","utf8")).events
  .map(e=>JSON.parse(JSON.stringify(e).split("2026-08-14").join("2026-08-17")));

const clock = t => `const R=Date;const O=new R("${t}").getTime()-R.now();
window.Date=class extends R{constructor(...a){if(a.length===0)super(R.now()+O);else super(...a);}static now(){return R.now()+O;}};`;

async function run(b,label,stub,when,fn){
  const ctx=await b.newContext({viewport:{width:760,height:900},timezoneId:"Asia/Jerusalem",colorScheme:label.includes("light")?"light":"dark"});
  const p=await ctx.newPage();const errs=[];
  p.on("pageerror",e=>errs.push(e.message));
  p.on("console",m=>{if(m.type()==="error")errs.push("console: "+m.text());});
  await p.setContent(`<!doctype html><html><head><meta charset="utf-8"><script>${clock(when)}${stub}<\/script></head><body>${page_html}</body></html>`,{waitUntil:"load"});
  await p.waitForTimeout(2600);
  const r=fn?await fn(p):{};
  console.log(`[${label}] errors:`,errs.length?errs:"none",JSON.stringify(r));
  await p.screenshot({path:`mini-${label}.png`,fullPage:true});
  await ctx.close();
}
const snap = p => p.evaluate(()=>({
  now:(document.querySelector(".now .row .n")||{}).textContent||null,
  clock:(document.querySelector(".now .clock")||{}).textContent||null,
  eyebrow:(document.querySelector(".now .eyebrow")||{}).textContent||null,
  meetingNow:(document.querySelector(".meeting-now .mn-name")||{}).textContent||null,
  later:[...document.querySelectorAll("#pageMain .rows .row")].map(r=>r.querySelector(".t").textContent+" "+r.querySelector(".n").textContent.replace("meeting","")),
  state:(document.querySelector(".state h2")||{}).textContent||null,
  progress:(document.querySelector("#progressPill")||{}).textContent||null
}));

(async()=>{const b=await chromium.launch({});
const realStub=BASE.replace(/const EVENTS = [^;]+;/,"const EVENTS = "+JSON.stringify(REAL)+";");
const lightStub=BASE.replace(/const DAY = [^;]+;/,'const DAY = "2026-08-17";');

// 1. the hub's action row: Done / Swap / Pending / Remove, text labels, no
//    icon-only "switch with next" button any more
await run(b,"real-dark",realStub,"2026-08-17T14:20:00+03:00",async p=>{
  const s=await snap(p);
  s.actLabels=await p.evaluate(()=>[...document.querySelectorAll(".now .acts-inline .mini")].map(b=>b.textContent));
  return s;
});
// 2. Remove: confirms, archives the card, and clears its block
await run(b,"remove",lightStub,"2026-08-17T09:40:00+03:00",async p=>{
  const before=await snap(p);
  await p.locator('.now .mini',{hasText:"Remove"}).click();
  await p.waitForTimeout(400);
  await p.locator('.dialog .btn.primary').click();
  await p.waitForTimeout(1200);
  return {before:before.now,
    calls:await p.evaluate(()=>window.__calls.map(c=>c.tool+(c.input&&c.input.action?":"+c.input.action:""))),
    toast:await p.locator('.toast').last().textContent().catch(()=>null)};
});
// 3. completion, and the progress pill it feeds: clicking it opens a list
//    of what's actually behind the count (the harness doesn't round-trip
//    mark_done back into dueComplete, so this only checks the dialog wires
//    up and closes — assert.js/cap.js cover the count itself)
await run(b,"done",lightStub,"2026-08-17T09:40:00+03:00",async p=>{
  await p.locator('.now .mini',{hasText:"Done"}).click();
  await p.waitForTimeout(1100);
  const calls=await p.evaluate(()=>window.__calls.map(c=>c.tool+(c.input&&c.input.action?":"+c.input.action:"")));
  await p.locator("#progressPill").click();
  await p.waitForTimeout(300);
  const dialog=await p.evaluate(()=>({
    open: !!document.querySelector(".scrim"),
    title: document.querySelector(".dialog .dh h3")?.textContent||null
  }));
  await p.locator(".dialog .btn.primary",{hasText:"Close"}).click();
  await p.waitForTimeout(200);
  const closed=await p.evaluate(()=>!document.querySelector(".scrim"));
  return {calls, dialog, closed};
});
// 4. Pending now opens an edit popup first — clicking the button alone must
//    not write anything. Cancel discards the draft; "Set pending" writes
//    the edited description (marker + your text), clears today's block,
//    never archives or marks done, and the card leaves the candidate pool.
await run(b,"pending",lightStub,"2026-08-17T09:40:00+03:00",async p=>{
  const before=await snap(p);
  const cardId=await p.evaluate(()=>S.hubItem && S.hubItem.card && S.hubItem.card.id);
  const cardCallCount = id => window.__calls.filter(c =>
    (c.tool==="trelloWriteCard" && c.input && c.input.cardId===id) ||
    (c.tool==="delete_event" && c.input && c.input.eventId===S.hubItem.ev.id)).length;
  const before2=await p.evaluate(cardCallCount, cardId);
  await p.locator('.now .mini',{hasText:"Pending"}).click();
  await p.waitForTimeout(300);
  const dialogOpen=await p.evaluate(()=>!!document.querySelector(".dialog textarea"));
  const noWriteYet=(await p.evaluate(cardCallCount, cardId))===before2;

  // Cancel first: must leave everything untouched
  await p.locator(".dialog .btn.quiet",{hasText:"Cancel"}).click();
  await p.waitForTimeout(200);
  const afterCancel=await p.evaluate((id)=>({
    dialogGone: !document.querySelector(".scrim")
  }), cardId);
  afterCancel.unchanged = (await p.evaluate(cardCallCount, cardId))===before2;

  // Now the real flow: reopen, edit the description, set a "check back on"
  // date, confirm
  await p.locator('.now .mini',{hasText:"Pending"}).click();
  await p.waitForTimeout(300);
  await p.fill(".dialog textarea", "waiting on Yossi's reply");
  await p.fill(".dialog .until-in", "2026-08-25");
  await p.locator(".dialog .btn.primary",{hasText:"Set pending"}).click();
  await p.waitForTimeout(500);

  const after=await p.evaluate((id)=>({
    calls:window.__calls.map(c=>c.tool+(c.input&&c.input.action?":"+c.input.action:"")),
    descWrite:(window.__calls.find(c=>c.tool==="trelloWriteCard"&&c.input.action==="update"&&c.input.cardId===id)||{}).input||null,
    inCandidates:typeof candidates==="function" ? candidates().some(c=>c.id===id) : null
  }), cardId);
  const toast=await p.locator('.toast').last().textContent().catch(()=>null);
  return {before:before.now, dialogOpen, noWriteYet, afterCancel, ...after, toast};
});

// 5. the "check back on" date: normCard() only lifts the block once that
//    date has passed, and only if the block wasn't ALSO caused by other
//    text the card happens to contain.
await run(b,"pending-until",lightStub,"2026-08-20T09:00:00+03:00",async p=>{
  return p.evaluate(()=>{
    const board={key:"sidurim",name:"סידורים"};
    const notYet=normCard({id:"x1",name:"Task A",desc:"⏳ Pending until 2026-08-25 — need approval from foo",labels:[]},board);
    const expired=normCard({id:"x2",name:"Task B",desc:"⏳ Pending until 2026-08-15 — need approval from foo",labels:[]},board);
    const stillStuck=normCard({id:"x3",name:"Task C",desc:"⏳ Pending until 2026-08-15 — still stuck on something else",labels:[]},board);
    return {
      notYetStillBlocked: notYet.blocked===true,
      expiredNoLongerBlocked: expired.blocked===false,
      expiredButOtherTextStillBlocked: stillStuck.blocked===true
    };
  });
});
await b.close();})();
