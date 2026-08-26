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
  p.on("console",m=>{if(m.type()==="error" && !/^\[daisey\]/.test(m.text()))bad.push("console: "+m.text());});
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
    /* The current task lives in #heroSlot since the 2026-08-26 redesign, so a
       count scoped to #pageMain alone undercounts the day. Count the task
       rows themselves (.nt is the title node) across both. */
    rows: document.querySelectorAll("#heroSlot .n .nt, #pageMain .rows .row .n .nt").length,
    /* every block the rebuild created, by name, so we can prove each one is
       actually on screen — the raw row count also includes the fixture's
       pre-existing meetings, so counts will never match `created` exactly */
    missing: (()=>{
      /* DOM titles are truncated and may carry a trailing ↗, so compare on a
         short prefix rather than equality */
      const shown=[...document.querySelectorAll("#heroSlot .n .nt, #pageMain .rows .row .n .nt")]
        .map(n=>n.textContent.replace(/↗\s*$/,"").trim());
      return allEvents().filter(e=>e.isTask && overlapsDay(e, S.anchor))
        .map(e=>e.summary)
        /* A quick-task BRICK is one event ("• 4 tasks") that renders as the
           individual task rows inside it, so its summary never appears in the
           DOM verbatim. It's visible; it just can't be matched by title. */
        .filter(sum=>!/^•\s*\d+\s+tasks?$/.test(sum))
        .filter(sum=>!shown.some(n=>n.length>3 && sum.includes(n.slice(0,12))));
    })(),
    /* existingBlocks() deliberately excludes breaks (!e.isBreak), so it can
       never equal `created`, which includes the ☕ Break event. Compare it
       against the non-break creates instead. */
    existing: existingBlocks(S.anchor).total,
    createdReal: allEvents().filter(e=>e.isTask && !e.isBreak && overlapsDay(e, S.anchor)).length
  }));
  console.log("[built tomorrow]", JSON.stringify(first));
  check(first.created > 0, "rebuild should have created at least one block for tomorrow");
  check(first.visible === first.created, `blocks built for tomorrow should stay visible in allEvents(), got ${first.visible} of ${first.created}`);
  /* The real regression this suite exists for: a block built for tomorrow
     vanished from the app the instant it was created. So assert every built
     block is ON SCREEN — not that the row count equals `created`, which it
     never can, since the day also lists the fixture's existing meetings. */
  check(first.missing.length === 0, `every block built for tomorrow should be visible; missing: ${JSON.stringify(first.missing)}`);
  check(first.rows > 0, "the Day view should show tomorrow's blocks, got no rows at all");
  check(first.existing === first.createdReal, `existingBlocks(tomorrow) should count every non-break block just built, got ${first.existing} of ${first.createdReal}`);

  // rebuilding again must clear-and-relay, not pile on duplicates
  await p.click("#replanBtn");
  await p.waitForTimeout(400);
  if(await p.evaluate(()=>!!document.querySelector(".dialog .btn.primary")))
    await p.click(".dialog .btn.primary");
  await p.waitForTimeout(1200);

  const second = await p.evaluate(()=>({
    /* The current task lives in #heroSlot since the 2026-08-26 redesign, so a
       count scoped to #pageMain alone undercounts the day. Count the task
       rows themselves (.nt is the title node) across both. */
    rows: document.querySelectorAll("#heroSlot .n .nt, #pageMain .rows .row .n .nt").length,
    /* every block the rebuild created, by name, so we can prove each one is
       actually on screen — the raw row count also includes the fixture's
       pre-existing meetings, so counts will never match `created` exactly */
    missing: (()=>{
      /* DOM titles are truncated and may carry a trailing ↗, so compare on a
         short prefix rather than equality */
      const shown=[...document.querySelectorAll("#heroSlot .n .nt, #pageMain .rows .row .n .nt")]
        .map(n=>n.textContent.replace(/↗\s*$/,"").trim());
      return allEvents().filter(e=>e.isTask && overlapsDay(e, S.anchor))
        .map(e=>e.summary)
        /* A quick-task BRICK is one event ("• 4 tasks") that renders as the
           individual task rows inside it, so its summary never appears in the
           DOM verbatim. It's visible; it just can't be matched by title. */
        .filter(sum=>!/^•\s*\d+\s+tasks?$/.test(sum))
        .filter(sum=>!shown.some(n=>n.length>3 && sum.includes(n.slice(0,12))));
    })(),
    /* existingBlocks() deliberately excludes breaks (!e.isBreak), so it can
       never equal `created`, which includes the ☕ Break event. Compare it
       against the non-break creates instead. */
    existing: existingBlocks(S.anchor).total,
    createdReal: allEvents().filter(e=>e.isTask && !e.isBreak && overlapsDay(e, S.anchor)).length
  }));
  console.log("[rebuilt tomorrow again]", JSON.stringify(second));
  check(second.rows === first.rows, `a second rebuild should replace, not duplicate — had ${first.rows} rows, now ${second.rows}`);
  check(second.existing === first.existing, `a second rebuild shouldn't grow the block count — had ${first.existing}, now ${second.existing}`);

  console.log(bad.length ? "FAIL:\n  ✗ "+bad.join("\n  ✗ ")
                         : "✓ blocks built for tomorrow stay visible and don't duplicate on rebuild");
  await b.close();
  process.exit(bad.length?1:0);
})();
