const fs=require("fs"),vm=require("vm");const {chromium}=require("playwright");
const H=fs.readFileSync("harness.js","utf8");const page_html=fs.readFileSync("daisey.html","utf8");
const sb={require,__dirname,module:{exports:{}},exports:{},console,process};
vm.runInNewContext(H.split("(async () => {")[0]+"\nmodule.exports={stub};",sb);
const stub=sb.module.exports.stub.replace(/const DAY = [^;]+;/,'const DAY = "2026-08-17";');
const clock=t=>`const R=Date;const O=new R("${t}").getTime()-R.now();
window.Date=class extends R{constructor(...a){if(a.length===0)super(R.now()+O);else super(...a);}static now(){return R.now()+O;}};`;
(async()=>{const b=await chromium.launch({});
for(const scheme of ["dark","light"]){
 const ctx=await b.newContext({viewport:{width:760,height:1150},timezoneId:"Asia/Jerusalem",colorScheme:scheme});
 const p=await ctx.newPage();const errs=[];
 p.on("pageerror",e=>errs.push(e.message));p.on("console",m=>{if(m.type()==="error")errs.push(m.text());});
 await p.setContent(`<!doctype html><html><head><meta charset="utf-8"><script>${clock("2026-08-17T09:00:00+03:00")}${stub}<\/script></head><body>${page_html}<script>try{checkChoresTrigger=function(){};}catch(_){}<\/script></body></html>`,{waitUntil:"load"});
 await p.waitForTimeout(3200);
 /* The auto-plan schedules every quick task for the day into one merged
    brick (see CLAUDE.md), which has no expand/checklist toggle of its own
    (Done/Swap/Remove per task instead — see the brick-list body). This test
    is specifically about the checklist-tick flow on "ארנונה" (the one
    fixture card with real checklist items), so it force-seeds a day with
    just that one quick task — a lone quick task still collapses to a plain
    single-card row with the normal .mini.info toggle, same as before
    bricks existed.
    Both the mock's backing EVENTS array AND the page's S.events cache have
    to be overwritten (same pattern fast.js's seed() uses) — the connector
    stub's watcher re-fires from EVENTS on its own timer, so touching only
    S.events gets silently reverted back to whatever the boot-time auto-plan
    already wrote into EVENTS the moment that watcher next fires. */
 await p.evaluate(()=>{
   const ev = { id:"solo-ticktest", colorId:"9", summary:"• ארנונה",
     description:"[daisey] ארנונה\n\nOriginal: https://trello.com/c/TXxCAu3T",
     start:{dateTime:"2026-08-17T09:00:00+03:00",timeZone:"Asia/Jerusalem"},
     end:{dateTime:"2026-08-17T09:15:00+03:00",timeZone:"Asia/Jerusalem"}, status:"confirmed" };
   EVENTS.length=0; EVENTS.push(ev);
   S.events={ payload:{ events:[ev] }, storedAt:Date.now() };
   render();
 });
 await p.waitForTimeout(400);
 /* This fixture force-seeds a single quick task, which becomes `current` —
    and current no longer renders inside #pageMain at all (2026-08-26 hero
    redesign): it lives in #heroSlot, a flex sibling above the scroller.
    "#pageMain, #heroSlot" covers both without caring which one actually
    holds the card in a given scenario — the checklist-tick flow this test
    exercises is exactly what the hero exists to keep working, just moved. */
 const auto=await p.evaluate(()=>({
   panelsOpen:document.querySelectorAll("#pageMain .details, #heroSlot .details").length,
   checkboxes:document.querySelectorAll("#pageMain .details li .box, #heroSlot .details li .box").length,
   expandBtns:document.querySelectorAll("#pageMain .expand, #heroSlot .expand").length,
   accent:getComputedStyle(document.documentElement).getPropertyValue("--accent").trim(),
   /* stack mode's dot lives in the sibling .rail-stop, not inside .row — the
      hero hides its own rail-stop entirely (see .hero-slot .rail-stop), so
      with only one task in the fixture (current, in the hero) this is
      legitimately empty; kept for whatever a human reads off the log. */
   boardDots:[...document.querySelectorAll("#pageMain .rows .rail-stop .dot")].map(d=>getComputedStyle(d).backgroundColor)
 }));
 if(scheme==="dark"){
   // details are closed by default now — open the hub's own toggle first
   await p.locator("#pageMain .mini.info, #heroSlot .mini.info").first().click();
   await p.waitForTimeout(300);
   // toggle the first unchecked item
   const box=p.locator("#pageMain .details li:not(.on) .box, #heroSlot .details li:not(.on) .box").first();
   const before=await p.evaluate(()=>[...document.querySelectorAll("#pageMain .details li, #heroSlot .details li")].map(l=>l.classList.contains("on")?1:0));
   await box.click(); await p.waitForTimeout(800);
   const after=await p.evaluate(()=>({
     states:[...document.querySelectorAll("#pageMain .details li, #heroSlot .details li")].map(l=>l.classList.contains("on")?1:0),
     counts:[...document.querySelectorAll("#pageMain .details .clname span:last-child, #heroSlot .details .clname span:last-child")].map(x=>x.textContent),
     writes:window.__calls.filter(c=>c.tool==="trelloWriteChecklist").map(c=>c.input.action+":"+c.input.checked)}));
   console.log("[toggle] before:",JSON.stringify(before),"after:",JSON.stringify(after));
 }
 console.log(`[${scheme}]`,errs.length?("ERR "+errs.join("|")):"ok",JSON.stringify(auto));
 await p.screenshot({path:`tick-${scheme}.png`,fullPage:true});await ctx.close();
}
await b.close();})();
