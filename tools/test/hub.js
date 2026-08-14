const fs=require("fs"),vm=require("vm");const {chromium}=require("playwright");
const H=fs.readFileSync("harness.js","utf8");const page_html=fs.readFileSync("dayflow.html","utf8");
const sb={require,__dirname,module:{exports:{}},exports:{},console,process};
vm.runInNewContext(H.split("(async () => {")[0]+"\nmodule.exports={stub};",sb);
const BASE=sb.module.exports.stub;
const REAL=JSON.parse(fs.readFileSync("real-events.json","utf8")).events
  .map(e=>JSON.parse(JSON.stringify(e).split("2026-08-14").join("2026-08-17")));
const clock=t=>`const R=Date;const O=new R("${t}").getTime()-R.now();
window.Date=class extends R{constructor(...a){if(a.length===0)super(R.now()+O);else super(...a);}static now(){return R.now()+O;}};`;

(async()=>{const b=await chromium.launch({executablePath:"/opt/pw-browsers/chromium-1194/chrome-linux/chrome"});
async function open_(stub,when,scheme){
  const ctx=await b.newContext({viewport:{width:760,height:1000},timezoneId:"Asia/Jerusalem",colorScheme:scheme||"dark"});
  const p=await ctx.newPage();p.__errs=[];
  p.on("pageerror",e=>p.__errs.push(e.message));p.on("console",m=>{if(m.type()==="error")p.__errs.push(m.text());});
  await p.setContent(`<!doctype html><html><head><meta charset="utf-8"><script>${clock(when)}${stub}<\/script></head><body>${page_html}</body></html>`,{waitUntil:"load"});
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
  const after=await p.evaluate(()=>({blocks:allEvents().filter(e=>e.isTask).length,
    small:existingBlocks(new Date()).small,deep:existingBlocks(new Date()).deep,
    dels:window.__calls.filter(c=>c.tool==="delete_event").length,
    creates:window.__calls.filter(c=>c.tool==="create_event").length}));
  console.log("[rebuild] errs:",p.__errs.length?p.__errs:"none");
  console.log("  before:",JSON.stringify(before),"\n  dialog:",JSON.stringify(dlg),"\n  after:",JSON.stringify(after));
  await p.screenshot({path:"hub-rebuild.png",fullPage:true});await ctx.close();
}
// B) hub + board colours + expand details
{
  const {p,ctx}=await open_(realStub,"2026-08-17T14:20:00+03:00");
  const hub=await p.evaluate(()=>({
    clock:(document.querySelector("#hubClock")||{}).textContent,
    left:(document.querySelector("#hubLeft")||{}).textContent,
    fill:(document.querySelector("#hubFill")||{}).style.width,
    boardChip:(document.querySelector(".now .chip.board")||{}).textContent,
    hubClass:[...(document.querySelector(".now")||{classList:[]}).classList].join(" "),
    dotColors:[...document.querySelectorAll(".rows .row")].slice(0,5)
      .map(r=>getComputedStyle(r.querySelector(".dot")).backgroundColor)
  }));
  await p.locator(".now .expand").click(); await p.waitForTimeout(900);
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
