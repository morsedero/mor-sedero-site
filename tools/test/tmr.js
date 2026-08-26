/* Scheduling was widened to today *and* tomorrow (isSchedulable), but
   allEvents() kept a filter from before that change: any card-linked
   event not starting on the literal real-world "today" was dropped. A
   block built for tomorrow still landed on the calendar for real, but
   vanished from the app the instant it was created — existingBlocks,
   clearableBlocks and planFor's "already scheduled" set all read through
   allEvents() too, so every rebuild saw an empty day and piled on
   duplicates while the UI just showed nothing. Fixed by matching the
   filter to isSchedulable instead of same-day-as-now. */
const fs=require("fs"),vm=require("vm");const {chromium}=require("playwright");
const H=fs.readFileSync(__dirname+"/harness.js","utf8");
const page_html=fs.readFileSync(__dirname+"/daisey.html","utf8");
const sb={require,__dirname,module:{exports:{}},exports:{},console,process};
vm.runInNewContext(H.split("(async () => {")[0]+"\nmodule.exports={stub};",sb);
const BASE=sb.module.exports.stub;
const stub=BASE.replace(/const DAY = [^;]+;/,'const DAY = "2026-08-17";');
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
  await p.setContent(`<!doctype html><html><head><meta charset="utf-8"><script>${clock("2026-08-17T09:00:00+03:00")}${stub}<\/script></head><body>${page_html}<script>try{checkChoresTrigger=function(){};}catch(_){}<\/script></body></html>`,{waitUntil:"load"});
  await p.waitForTimeout(2600);

  await p.click("#next"); // tomorrow
  await p.waitForTimeout(300);
  await p.evaluate(()=>{ window.__calls.length = 0; });

  await p.click("#replanBtn");
  await p.waitForTimeout(400);
  if(await p.evaluate(()=>!!document.querySelector(".dialog .btn.primary")))
    await p.click(".dialog .btn.primary");
  await p.waitForTimeout(1200);

  const first = await p.evaluate(()=>({
    created: window.__calls.filter(c=>c.tool==="create_event").length,
    visible: allEvents().filter(e=>e.isTask && overlapsDay(e, S.anchor)).length,
    rows: document.querySelectorAll("#pageMain .row .n").length,
    existing: existingBlocks(S.anchor).total
  }));
  console.log("[built tomorrow]", JSON.stringify(first));
  check(first.created > 0, "rebuild should have created at least one block for tomorrow");
  check(first.visible === first.created, `blocks built for tomorrow should stay visible in allEvents(), got ${first.visible} of ${first.created}`);
  check(first.rows === first.created, `the Day-view list should show tomorrow's new blocks, got ${first.rows} rows for ${first.created} created`);
  check(first.existing === first.created, `existingBlocks(tomorrow) should count what was just built, got ${first.existing}`);

  // rebuilding again must clear-and-relay, not pile on duplicates
  await p.click("#replanBtn");
  await p.waitForTimeout(400);
  if(await p.evaluate(()=>!!document.querySelector(".dialog .btn.primary")))
    await p.click(".dialog .btn.primary");
  await p.waitForTimeout(1200);

  const second = await p.evaluate(()=>({
    rows: document.querySelectorAll("#pageMain .row .n").length,
    existing: existingBlocks(S.anchor).total
  }));
  console.log("[rebuilt tomorrow again]", JSON.stringify(second));
  check(second.rows === first.rows, `a second rebuild should replace, not duplicate — had ${first.rows} rows, now ${second.rows}`);
  check(second.existing === first.existing, `a second rebuild shouldn't grow the block count — had ${first.existing}, now ${second.existing}`);

  console.log(bad.length ? "FAIL:\n  ✗ "+bad.join("\n  ✗ ")
                         : "✓ blocks built for tomorrow stay visible and don't duplicate on rebuild");
  await b.close();
  process.exit(bad.length?1:0);
})();
