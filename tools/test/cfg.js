/* Settings must change what the scheduler actually does — across all three
   tiers now, not just the old single quick/session split.
   Settings-panel input order: dayStart, dayEnd, maxSmall, quickTotal,
   maxShort, shortMin, maxLong, longMin, buffer. */
const fs=require("fs"),vm=require("vm");const {chromium}=require("playwright");
const H=fs.readFileSync(__dirname+"/harness.js","utf8");
const page_html=fs.readFileSync(__dirname+"/dayflow.html","utf8");
const sb={require,__dirname,module:{exports:{}},exports:{},console,process};
vm.runInNewContext(H.split("(async () => {")[0]+"\nmodule.exports={stub};",sb);
const stub=sb.module.exports.stub.replace(/const DAY = [^;]+;/,'const DAY = "2026-08-17";');
const clock=t=>`const R=Date;const O=new R("${t}").getTime()-R.now();
window.Date=class extends R{constructor(...a){if(a.length===0)super(R.now()+O);else super(...a);}static now(){return R.now()+O;}};`;
(async()=>{const b=await chromium.launch({executablePath:"/opt/pw-browsers/chromium-1194/chrome-linux/chrome"});
const ctx=await b.newContext({viewport:{width:760,height:1050},timezoneId:"Asia/Jerusalem",colorScheme:"dark"});
const p=await ctx.newPage();const errs=[];
p.on("pageerror",e=>errs.push(e.message));p.on("console",m=>{if(m.type()==="error")errs.push(m.text());});
await p.setContent(`<!doctype html><html><head><meta charset="utf-8"><script>${clock("2026-08-17T06:30:00+03:00")}${stub}<\/script></head><body>${page_html}</body></html>`,{waitUntil:"load"});
await p.waitForTimeout(3000);
const base=await p.evaluate(()=>{const h=existingBlocks(new Date());return {q:h.quick,sh:h.short,lg:h.long,cfg:{...CFG}};});
console.log("default:",JSON.stringify({q:base.q,sh:base.sh,lg:base.lg,win:[base.cfg.dayStart,base.cfg.dayEnd]}));

await p.locator("#setBtn").click(); await p.waitForTimeout(400);
const shot1=await p.evaluate(()=>({rows:document.querySelectorAll(".set-row").length,
  heads:[...document.querySelectorAll(".set-h")].map(x=>x.textContent)}));
await p.screenshot({path:"cfg-panel.png"});

const nums=p.locator("input.num-in");
const set=async(i,v)=>{await nums.nth(i).fill(String(v)); await nums.nth(i).dispatchEvent("change"); await p.waitForTimeout(220);};
await set(0,6);    // dayStart
await set(1,22);   // dayEnd — wide window so quick+short can coexist
await set(2,2);    // maxSmall
await set(4,1);    // maxShort
await set(5,90);   // shortMin
await set(6,0);    // maxLong — disabled, so this run isolates short+quick
await p.locator(".dialog .btn.primary").click(); await p.waitForTimeout(400);

await p.locator("#replanBtn").click(); await p.waitForTimeout(500);
const dlg=await p.locator(".dialog .btn.primary").count();
if(dlg){ await p.locator(".dialog .btn.primary").click(); await p.waitForTimeout(2800); }

const after=await p.evaluate(()=>{const h=existingBlocks(new Date());
  const blocks=allEvents().filter(e=>e.isTask&&overlapsDay(e,new Date()))
    .map(e=>({s:minsOf(e.start),e:minsOf(e.end),size:e.size}));
  return {q:h.quick,sh:h.short,lg:h.long,blocks,cfg:{...CFG},persisted:(S.stats.settings||{})};});
console.log("panel:",JSON.stringify(shot1));
console.log("after:",JSON.stringify({q:after.q,sh:after.sh,lg:after.lg,win:[after.cfg.dayStart,after.cfg.dayEnd],
  shortMin:after.cfg.shortMin,maxLong:after.cfg.maxLong,blocks:after.blocks}));
console.log("persisted:",JSON.stringify({dayStart:after.persisted.dayStart,dayEnd:after.persisted.dayEnd,
  maxSmall:after.persisted.maxSmall,maxShort:after.persisted.maxShort,shortMin:after.persisted.shortMin,
  maxLong:after.persisted.maxLong}));

const bad=[];
if(after.q>after.cfg.maxSmall) bad.push("quick cap ignored");
if(after.lg>0) bad.push("a long session was scheduled despite maxLong=0");
if(after.cfg.maxLong!==0) bad.push("maxLong=0 did not persist");
for(const bl of after.blocks){
  if(bl.s<after.cfg.dayStart*60||bl.e>after.cfg.dayEnd*60) bad.push(`block ${bl.s}-${bl.e} outside window`);
  if(bl.size==="short" && bl.e-bl.s!==after.cfg.shortMin) bad.push(`short session ${bl.e-bl.s}min != ${after.cfg.shortMin}`);
}
console.log("errors:",errs.length?errs:"none");
console.log(bad.length?"FAIL: "+bad.join(" | "):"✓ settings drive the scheduler across all three tiers");
await p.screenshot({path:"cfg-after.png",fullPage:true});
await b.close(); process.exit(bad.length+errs.length?1:0);})();
