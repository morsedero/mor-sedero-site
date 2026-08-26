/* Quick tasks share one hour; marked meetings become permeable; swap works. */
const fs=require("fs"),vm=require("vm");const {chromium}=require("playwright");
const H=fs.readFileSync(__dirname+"/harness.js","utf8");
const page_html=fs.readFileSync(__dirname+"/daisey.html","utf8");
const sb={require,__dirname,module:{exports:{}},exports:{},console,process};
vm.runInNewContext(H.split("(async () => {")[0]+"\nmodule.exports={stub};",sb);
const REAL=JSON.parse(fs.readFileSync(__dirname+"/real-events.json","utf8")).events
  .map(e=>JSON.parse(JSON.stringify(e).split("2026-08-14").join("2026-08-17")));
const stub=sb.module.exports.stub.replace(/const EVENTS = [^;]+;/,"const EVENTS = "+JSON.stringify(REAL)+";");
const clock=t=>`const R=Date;const O=new R("${t}").getTime()-R.now();
window.Date=class extends R{constructor(...a){if(a.length===0)super(R.now()+O);else super(...a);}static now(){return R.now()+O;}};`;
const fmt=m=>`${String(Math.floor(m/60)).padStart(2,"0")}:${String(m%60).padStart(2,"0")}`;
(async()=>{const b=await chromium.launch({});
const ctx=await b.newContext({viewport:{width:760,height:1100},timezoneId:"Asia/Jerusalem",colorScheme:"dark"});
const p=await ctx.newPage();const errs=[];
p.on("pageerror",e=>errs.push(e.message));p.on("console",m=>{if(m.type()==="error")errs.push(m.text());});
await p.setContent(`<!doctype html><html><head><meta charset="utf-8"><script>${clock("2026-08-17T07:30:00+03:00")}${stub}<\/script></head><body>${page_html}</body></html>`,{waitUntil:"load"});
await p.waitForTimeout(3200);
/* isBreak is carried through and filtered out of every quick-task tally
   below: a Break is a task-shaped block with deep=false, so "not deep" on
   its own started meaning "quick task OR rest" the moment breaks became real
   blocks, and the quick-span assertions silently measured from the break. */
const blocks=()=>p.evaluate(()=>allEvents().filter(e=>e.isTask&&!e.isBreak&&overlapsDay(e,new Date()))
  .map(e=>({n:(e.summary||"").slice(0,26),s:minsOf(e.start),e:minsOf(e.end),deep:e.deep})).sort((a,b)=>a.s-b.s));
const b1=await blocks();
console.log("default (חמל open):"); b1.forEach(x=>console.log(`   ${fmt(x.s)}-${fmt(x.e)} ${x.deep?"[s] ":"    "}${x.n}`));
const q1=b1.filter(x=>!x.deep);
console.log("   quick span:", q1.length?`${fmt(q1[0].s)}-${fmt(q1[q1.length-1].e)} = ${q1[q1.length-1].e-q1[0].s}min across ${q1.length}`:"none");

// mark חמל as open, then re-plan
await p.evaluate(async()=>{ await toggleOpenEvent("חמל"); });
await p.waitForTimeout(600);
await p.evaluate(async()=>{ await applyPlan(startOfDay(new Date()),"normal",null,true); });
await p.waitForTimeout(2500);
const b2=await blocks();
console.log("after closing חמל:"); b2.forEach(x=>console.log(`   ${fmt(x.s)}-${fmt(x.e)} ${x.deep?"[s] ":"    "}${x.n}`));
const q2=b2.filter(x=>!x.deep);
const span=q2.length?q2[q2.length-1].e-q2[0].s:0;
const inHamal=q2.filter(x=>x.s>=360&&x.e<=840).length;
const q0=b1.filter(x=>!x.deep);
const inHamalDefault=q0.filter(x=>x.s>=360&&x.e<=840).length;
console.log(`   quick span: ${span}min across ${q2.length} · inside חמל: ${inHamal} (was ${inHamalDefault})`);
const cfg=await p.evaluate(()=>({total:CFG.quickTotal,max:CFG.quickMax,openEvents:CFG.openEvents,
  persisted:(S.stats.settings||{}).openEvents}));
console.log("   cfg:",JSON.stringify(cfg));
// swap — the hub is a multi-task brick (see CLAUDE.md), so there's one Swap
// button per task inside it rather than one for the whole hub; take the
// first. A brick-task swap rewrites the shared event's description
// (update_event), never create_event/delete_event — the slot and every
// other task in it stay put.
const before=await p.evaluate(()=>window.__calls.length);
await p.locator('.now .mini[aria-label="Swap task"]').first().click(); await p.waitForTimeout(600);
const pick=await p.evaluate(()=>({rows:document.querySelectorAll(".pick-row").length,
  first:(document.querySelector(".pick-row .n")||{}).textContent||null}));
await p.screenshot({path:"hour-pick.png"});
if(pick.rows){ await p.locator(".pick-row").first().click(); await p.waitForTimeout(2200); }
const after=await p.evaluate((from)=>{
  const since=window.__calls.slice(from);
  return {hub:(document.querySelector(".now .row .n")||{}).textContent,
    swaps:since.filter(c=>c.tool==="update_event").length,
    creates:since.filter(c=>c.tool==="create_event").length,
    deletes:since.filter(c=>c.tool==="delete_event").length};
},before);
console.log("   picker:",JSON.stringify(pick),"-> hub now:",JSON.stringify(after.hub),
  "· since-swap update_event:",after.swaps,"create_event:",after.creates,"delete_event:",after.deletes);
console.log("errors:",errs.length?errs:"none");
const bad=[];
/* CFG.quickTotal is minutes PER quick task, not the width of the whole
   group (it stopped being a shared window some time ago), so the ceiling on
   a contiguous run of them is quickMax × quickTotal. Comparing the run
   against quickTotal alone only ever passed here because this scenario used
   to schedule no quick tasks at all — the moment one landed, a correct day
   read as a failure. */
const maxSpan=cfg.total*cfg.max;
if(span>maxSpan) bad.push(`quick span ${span} > ${maxSpan}`);
if(!inHamalDefault) bad.push("default did not schedule inside חמל");
if(inHamal) bad.push("closing חמל still scheduled inside it");
if(pick.rows && after.creates) bad.push(`brick-task swap fired create_event (${after.creates}) — should only rewrite the shared event`);
if(pick.rows && after.deletes) bad.push(`brick-task swap fired delete_event (${after.deletes}) — the brick slot should stay, not get replaced`);
if(pick.rows && !after.swaps) bad.push("brick-task swap fired no update_event — the shared description never got rewritten");
console.log(bad.length?"FAIL: "+bad.join(" | "):"✓ all five behaviours hold");
await p.screenshot({path:"hour-after.png",fullPage:true});
await b.close();process.exit(bad.length+errs.length?1:0);})();
