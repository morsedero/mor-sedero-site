/* The day off must never be planned, from any vantage point; and a saved
   pre-migration setting must not smuggle in a 90-minute "hour". */
const fs=require("fs"),vm=require("vm");const {chromium}=require("playwright");
const H=fs.readFileSync(__dirname+"/harness.js","utf8");
const page_html=fs.readFileSync(__dirname+"/dayflow.html","utf8");
const sb={require,__dirname,module:{exports:{}},exports:{},console,process};
vm.runInNewContext(H.split("(async () => {")[0]+"\nmodule.exports={stub};",sb);
// stats card carrying the OLD setting shape
const legacy = sb.module.exports.stub.replace(
  '"plans":{},"mute":false}', '"plans":{},"mute":false,"settings":{"maxSmall":3,"smallMin":30,"maxDeep":1,"deepMin":90}}');
const clock=t=>`const R=Date;const O=new R("${t}").getTime()-R.now();
window.Date=class extends R{constructor(...a){if(a.length===0)super(R.now()+O);else super(...a);}static now(){return R.now()+O;}};`;
const fmt=m=>`${String(Math.floor(m/60)).padStart(2,"0")}:${String(m%60).padStart(2,"0")}`;
(async()=>{const b=await chromium.launch({executablePath:"/opt/pw-browsers/chromium-1194/chrome-linux/chrome"});
let fails=0;
async function go(label, when, stub, navNext){
  const ctx=await b.newContext({viewport:{width:760,height:900},timezoneId:"Asia/Jerusalem",colorScheme:"dark"});
  const p=await ctx.newPage();const errs=[];
  p.on("pageerror",e=>errs.push(e.message));p.on("console",m=>{if(m.type()==="error")errs.push(m.text());});
  await p.setContent(`<!doctype html><html><head><meta charset="utf-8"><script>${clock(when)}${stub}<\/script></head><body>${page_html}</body></html>`,{waitUntil:"load"});
  await p.waitForTimeout(3000);
  if(navNext){ await p.locator("#next").click(); await p.waitForTimeout(800);
    const rb=p.locator("#replanBtn"); if(await rb.count()) { await rb.click(); await p.waitForTimeout(1200);
      const dl=p.locator(".dialog .btn.primary"); if(await dl.count()){ await dl.click(); await p.waitForTimeout(2200); } } }
  const r=await p.evaluate(()=>{
    const anchor=S.anchor, d=new Date(anchor);
    const blocks=allEvents().filter(e=>e.isTask&&overlapsDay(e,d))
      .map(e=>({s:minsOf(e.start),e:minsOf(e.end),deep:e.deep})).sort((a,b)=>a.s-b.s);
    return {day:d.getDay(),state:(document.querySelector(".state h2")||{}).textContent||null,
      blocks,quickTotal:CFG.quickTotal,slice:quickSlice(),creates:window.__calls.filter(c=>c.tool==="create_event").length};});
  const q=r.blocks.filter(x=>!x.deep);
  const span=q.length?q[q.length-1].e-q[0].s:0;
  const bad=[];
  if(r.day===6 && r.blocks.length) bad.push(`${r.blocks.length} blocks on the day off`);
  if(r.day===6 && r.state!=="Day off") bad.push(`day off shows "${r.state}"`);
  if(span>r.quickTotal) bad.push(`quick span ${span} > ${r.quickTotal}`);
  console.log(`[${label}] ${errs.length?"ERR "+errs.join("|"):"ok"} day=${r.day} state=${JSON.stringify(r.state)} `+
    `quickTotal=${r.quickTotal} slice=${r.slice} span=${span} blocks=${r.blocks.length}`);
  r.blocks.forEach(x=>console.log(`     ${fmt(x.s)}-${fmt(x.e)}${x.deep?" [s]":""}`));
  if(bad.length) console.log("   ✗ "+bad.join("\n   ✗ ")); else console.log("   ✓");
  fails+=bad.length+errs.length; await ctx.close();
}
await go("legacy settings (Mon)", "2026-08-17T08:00:00+03:00",
  legacy.replace(/const DAY = [^;]+;/,'const DAY = "2026-08-17";'), false);
await go("Fri -> view Sat, re-plan", "2026-08-14T19:00:00+03:00",
  sb.module.exports.stub, true);
await b.close(); process.exit(fails?1:0);})();
