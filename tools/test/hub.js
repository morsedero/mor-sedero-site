const fs=require("fs"),vm=require("vm");const {chromium}=require("playwright");
const H=fs.readFileSync("harness.js","utf8");const page_html=fs.readFileSync("daisey.html","utf8");
const sb={require,__dirname,module:{exports:{}},exports:{},console,process};
vm.runInNewContext(H.split("(async () => {")[0]+"\nmodule.exports={stub};",sb);
const BASE=sb.module.exports.stub;
const REAL=JSON.parse(fs.readFileSync("real-events.json","utf8")).events
  .map(e=>JSON.parse(JSON.stringify(e).split("2026-08-14").join("2026-08-17")));
const clock=t=>`const R=Date;const O=new R("${t}").getTime()-R.now();
window.Date=class extends R{constructor(...a){if(a.length===0)super(R.now()+O);else super(...a);}static now(){return R.now()+O;}};`;

(async()=>{const b=await chromium.launch({});
async function open_(stub,when,scheme){
  const ctx=await b.newContext({viewport:{width:760,height:1000},timezoneId:"Asia/Jerusalem",colorScheme:scheme||"dark"});
  const p=await ctx.newPage();p.__errs=[];
  p.on("pageerror",e=>p.__errs.push(e.message));p.on("console",m=>{if(m.type()==="error")p.__errs.push(m.text());});
  await p.setContent(`<!doctype html><html><head><meta charset="utf-8"><script>${clock(when)}${stub}<\/script></head><body>${page_html}<script>try{checkChoresTrigger=function(){};}catch(_){}<\/script></body></html>`,{waitUntil:"load"});
  await p.waitForTimeout(2600);return {p,ctx};
}
const realStub=BASE.replace(/const EVENTS = [^;]+;/,"const EVENTS = "+JSON.stringify(REAL)+";");

// A) packed day -> rebuild via Re-plan
{
  const {p,ctx}=await open_(realStub,"2026-08-17T10:05:00+03:00");
  const before=await p.evaluate(()=>({blocks:allEvents().filter(e=>e.isTask).length,
    clearable:clearableBlocks(new Date()).length}));
  await p.locator("#replanBtn").click(); await p.waitForTimeout(500);
  const dlg=await p.evaluate(()=>{const d=document.querySelector(".dialog");return d?d.querySelector("p").textContent:null;});
  await p.locator(".dialog .btn.primary").click(); await p.waitForTimeout(2500);
  const after=await p.evaluate(()=>{const h=existingBlocks(new Date());
    return {blocks:allEvents().filter(e=>e.isTask).length,
    quick:h.quick,short:h.short,long:h.long,
    dels:window.__calls.filter(c=>c.tool==="delete_event").length,
    creates:window.__calls.filter(c=>c.tool==="create_event").length};});
  console.log("[rebuild] errs:",p.__errs.length?p.__errs:"none");
  console.log("  before:",JSON.stringify(before),"\n  dialog:",JSON.stringify(dlg),"\n  after:",JSON.stringify(after));
  await p.screenshot({path:"hub-rebuild.png",fullPage:true});await ctx.close();
}
// B) hub + board colours + expand details
{
  const {p,ctx}=await open_(realStub,"2026-08-17T14:20:00+03:00");
  const hub=await p.evaluate(()=>({
    clock:(document.querySelector("#cwHH")||{}).textContent,
    hubTitle:(document.querySelector(".now .row .n")||{}).textContent,
    /* .chip.bk, not the long-gone .chip.board — this selector was matching
       nothing and reporting undefined. It carries the card's *list* name now;
       the board is still what colours it. */
    sourceChip:(document.querySelector(".now .chip.bk")||{}).textContent,
    hubClass:[...(document.querySelector(".now")||{classList:[]}).classList].join(" "),
    /* Stack mode's dot lives in the sibling .rail-stop, not inside .row
       itself (see CLAUDE.md's "Stack mode's own time column" note) — .meeting
       is on .rail-stop itself (mirroring .item), not on .time-row. */
    dotColors:[...document.querySelectorAll("#pageMain .rows .rail-stop:not(.meeting) .dot")].slice(0,5)
      .map(d=>getComputedStyle(d).backgroundColor)
  }));
  // details are closed by default now — open the hub's own toggle first
  await p.locator(".now .mini.info").click().catch(()=>{});
  await p.waitForTimeout(900);
  const det=await p.evaluate(()=>({
    desc:(document.querySelector(".now .details .desc")||{}).textContent||null,
    clName:(document.querySelector(".now .details .clname")||{}).textContent||null,
    items:[...document.querySelectorAll(".now .details li")].map(l=>(l.classList.contains("on")?"[x] ":"[ ] ")+l.querySelector(".it").textContent.slice(0,26)),
    calls:window.__calls.filter(c=>c.tool==="trelloReadChecklist").length}));
  console.log("[hub] errs:",p.__errs.length?p.__errs:"none");
  console.log("  hub:",JSON.stringify(hub));
  console.log("  details:",JSON.stringify(det));
  await p.screenshot({path:"hub-details.png",fullPage:true});await ctx.close();
}
await b.close();})();
