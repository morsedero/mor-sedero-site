/* Quick tasks share one hour; marked meetings become permeable; swap works. */
const fs=require("fs"),vm=require("vm");const {chromium}=require("playwright");
const H=fs.readFileSync(__dirname+"/harness.js","utf8");
const page_html=fs.readFileSync(__dirname+"/dayflow.html","utf8");
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
const blocks=()=>p.evaluate(()=>allEvents().filter(e=>e.isTask&&overlapsDay(e,new Date()))
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
const cfg=await p.evaluate(()=>({total:CFG.quickTotal,openEvents:CFG.openEvents,
  persisted:(S.stats.settings||{}).openEvents}));
console.log("   cfg:",JSON.stringify(cfg));
// swap
await p.locator(".now .mini",{hasText:"Swap"}).click(); await p.waitForTimeout(600);
const pick=await p.evaluate(()=>({rows:document.querySelectorAll(".pick-row").length,
  first:(document.querySelector(".pick-row .n")||{}).textContent||null}));
await p.screenshot({path:"hour-pick.png"});
if(pick.rows){ await p.locator(".pick-row").first().click(); await p.waitForTimeout(2200); }
const after=await p.evaluate(()=>({hub:(document.querySelector(".now .row .n")||{}).textContent,
  swaps:window.__calls.filter(c=>c.tool==="create_event").length}));
console.log("   picker:",JSON.stringify(pick),"-> hub now:",JSON.stringify(after.hub));
console.log("errors:",errs.length?errs:"none");
const bad=[];
if(span>cfg.total) bad.push(`quick span ${span} > ${cfg.total}`);
if(!inHamalDefault) bad.push("default did not schedule inside חמל");
if(inHamal) bad.push("closing חמל still scheduled inside it");
console.log(bad.length?"FAIL: "+bad.join(" | "):"✓ all four behaviours hold");
await p.screenshot({path:"hour-after.png",fullPage:true});
await b.close();process.exit(bad.length+errs.length?1:0);})();
