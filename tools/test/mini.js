const fs=require("fs"),vm=require("vm");const {chromium}=require("playwright");
const H=fs.readFileSync("harness.js","utf8");const page_html=fs.readFileSync("dayflow.html","utf8");
const sb={require,__dirname,module:{exports:{}},exports:{},console,process};
vm.runInNewContext(H.split("(async () => {")[0]+"\nmodule.exports={stub};",sb);
const BASE=sb.module.exports.stub;
const REAL=JSON.parse(fs.readFileSync("real-events.json","utf8")).events
  .map(e=>JSON.parse(JSON.stringify(e).split("2026-08-14").join("2026-08-17")));

const clock = t => `const R=Date;const O=new R("${t}").getTime()-R.now();
window.Date=class extends R{constructor(...a){if(a.length===0)super(R.now()+O);else super(...a);}static now(){return R.now()+O;}};`;

async function run(b,label,stub,when,fn){
  const ctx=await b.newContext({viewport:{width:760,height:900},timezoneId:"Asia/Jerusalem",colorScheme:label.includes("light")?"light":"dark"});
  const p=await ctx.newPage();const errs=[];
  p.on("pageerror",e=>errs.push(e.message));
  p.on("console",m=>{if(m.type()==="error")errs.push("console: "+m.text());});
  await p.setContent(`<!doctype html><html><head><meta charset="utf-8"><script>${clock(when)}${stub}<\/script></head><body>${page_html}</body></html>`,{waitUntil:"load"});
  await p.waitForTimeout(2600);
  const r=fn?await fn(p):{};
  console.log(`[${label}] errors:`,errs.length?errs:"none",JSON.stringify(r));
  await p.screenshot({path:`mini-${label}.png`,fullPage:true});
  await ctx.close();
}
const snap = p => p.evaluate(()=>({
  now:(document.querySelector(".now h2")||{}).textContent||null,
  clock:(document.querySelector(".now .clock")||{}).textContent||null,
  eyebrow:(document.querySelector(".now .eyebrow")||{}).textContent||null,
  meetingNow:(document.querySelector(".meeting-now .mn-name")||{}).textContent||null,
  later:[...document.querySelectorAll(".rows .row")].map(r=>r.querySelector(".t").textContent+" "+r.querySelector(".n").textContent.replace("meeting","")),
  state:(document.querySelector(".state h2")||{}).textContent||null,
  foot:[...document.querySelectorAll(".foot .stat")].map(s=>(s.getAttribute("title")||"?")+"="+(s.querySelector(".v")||{}).textContent)
}));

(async()=>{const b=await chromium.launch({executablePath:"/opt/pw-browsers/chromium-1194/chrome-linux/chrome"});
const realStub=BASE.replace(/const EVENTS = [^;]+;/,"const EVENTS = "+JSON.stringify(REAL)+";");
const lightStub=BASE.replace(/const DAY = [^;]+;/,'const DAY = "2026-08-17";');

// 1. packed real day, mid-afternoon
await run(b,"real-dark",realStub,"2026-08-17T14:20:00+03:00",async p=>{
  const s=await snap(p);
  await p.locator('.now .btn').nth(1).click();       // "Not now"
  await p.waitForTimeout(900);
  s.toast=(await p.locator('.toast').first().textContent().catch(()=>null));
  s.calls=await p.evaluate(()=>window.__calls.filter(c=>c.tool==="update_event").length);
  return s;
});
// 2. lighter day -> postpone should actually move it. A 3h short session now
//    fills more of the default window than the old 90-min one did, so widen
//    it first — the point here is the successful-move path, not the cap.
await run(b,"light-day",lightStub,"2026-08-17T09:40:00+03:00",async p=>{
  const before=await snap(p);
  await p.evaluate(()=>{ CFG.dayEnd = 22; });
  await p.locator('.now .btn').nth(1).click();
  await p.waitForTimeout(1000);
  const mv=await p.evaluate(()=>window.__calls.filter(c=>c.tool==="update_event").map(c=>c.input.startTime));
  return {before:before.now,clock:before.clock,moved:mv,toast:await p.locator('.toast').last().textContent().catch(()=>null)};
});
// 3. completion
await run(b,"done",lightStub,"2026-08-17T09:40:00+03:00",async p=>{
  await p.locator('.now .btn').first().click();
  await p.waitForTimeout(1100);
  return {calls:await p.evaluate(()=>window.__calls.map(c=>c.tool+(c.input&&c.input.action?":"+c.input.action:"")))};
});
await b.close();})();
