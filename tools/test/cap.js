/* Scheduling should work correctly no matter what hour the widget is opened. */
const fs=require("fs"),vm=require("vm");const {chromium}=require("playwright");
const H=fs.readFileSync(__dirname+"/harness.js","utf8");
const page_html=fs.readFileSync(__dirname+"/dayflow.html","utf8");
const sb={require,__dirname,module:{exports:{}},exports:{},console,process};
vm.runInNewContext(H.split("(async () => {")[0]+"\nmodule.exports={stub};",sb);
const REAL=JSON.parse(fs.readFileSync(__dirname+"/real-events.json","utf8")).events;
const stub=sb.module.exports.stub.replace(/const EVENTS = [^;]+;/,"const EVENTS = "+JSON.stringify(REAL)+";");
const clock=t=>`const R=Date;const O=new R("${t}").getTime()-R.now();
window.Date=class extends R{constructor(...a){if(a.length===0)super(R.now()+O);else super(...a);}static now(){return R.now()+O;}};`;
(async()=>{const b=await chromium.launch({});
let fails=0;
for(const when of ["2026-08-14T07:30:00+03:00","2026-08-14T12:10:00+03:00","2026-08-14T16:30:00+03:00","2026-08-14T21:54:00+03:00"]){
  const ctx=await b.newContext({viewport:{width:760,height:1000},timezoneId:"Asia/Jerusalem",colorScheme:"dark"});
  const p=await ctx.newPage();const errs=[];
  p.on("pageerror",e=>errs.push(e.message));p.on("console",m=>{if(m.type()==="error")errs.push(m.text());});
  await p.setContent(`<!doctype html><html><head><meta charset="utf-8"><script>${clock(when)}${stub}<\/script></head><body>${page_html}</body></html>`,{waitUntil:"load"});
  await p.waitForTimeout(3400);
  const r=await p.evaluate(()=>{const h=existingBlocks(new Date());
    return {quick:h.quick,short:h.short,long:h.long,visibleTasks:document.querySelectorAll("#pageMain .rows .mini.ok").length,
      hub:!!document.querySelector(".now"),state:(document.querySelector(".state h2")||{}).textContent||null,
      dels:window.__calls.filter(c=>c.tool==="delete_event").length,
      creates:window.__calls.filter(c=>c.tool==="create_event").length};});
  const bad=[];
  if(r.long>0 && r.quick>0) bad.push(`${r.quick} quick task(s) alongside a long session`);
  const shown=r.visibleTasks+(r.hub?1:0);
  console.log(`[${when.slice(11,16)}] ${errs.length?"ERR "+errs.join("|"):"ok"} ` +
    `${r.quick}q ${r.short}sh ${r.long}lg · on screen ${shown} · -${r.dels}/+${r.creates}` +
    (r.state?` · "${r.state}"`:"") + (bad.length?"\n   ✗ "+bad.join("\n   ✗ "):"   ✓"));
  fails+=bad.length+errs.length; await ctx.close();
}
await b.close(); process.exit(fails?1:0);})();
