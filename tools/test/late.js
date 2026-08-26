const fs=require("fs"),vm=require("vm");const {chromium}=require("playwright");
const H=fs.readFileSync("harness.js","utf8");const page_html=fs.readFileSync("daisey.html","utf8");
const sb={require,__dirname,module:{exports:{}},exports:{},console,process};
vm.runInNewContext(H.split("(async () => {")[0]+"\nmodule.exports={stub};",sb);
const BASE=sb.module.exports.stub;
const REAL=JSON.parse(fs.readFileSync("real-events.json","utf8")).events;  // real Friday 14 Aug
const realStub=BASE.replace(/const EVENTS = [^;]+;/,"const EVENTS = "+JSON.stringify(REAL)+";");
const noBlocks=BASE.replace(/const EVENTS = [^;]+;/,'const EVENTS = [{id:"m1",summary:"חמל",start:{dateTime:"2026-08-14T06:00:00+03:00"},end:{dateTime:"2026-08-14T14:00:00+03:00"},status:"confirmed"}];');
const clock=t=>`const R=Date;const O=new R("${t}").getTime()-R.now();
window.Date=class extends R{constructor(...a){if(a.length===0)super(R.now()+O);else super(...a);}static now(){return R.now()+O;}};`;
(async()=>{const b=await chromium.launch({});
async function go(label,stub,when,scheme,fn){
  const ctx=await b.newContext({viewport:{width:760,height:1050},timezoneId:"Asia/Jerusalem",colorScheme:scheme||"dark"});
  const p=await ctx.newPage();const errs=[];
  p.on("pageerror",e=>errs.push(e.message));p.on("console",m=>{if(m.type()==="error" && !/^\[daisey\]/.test(m.text()))errs.push(m.text());});
  await p.setContent(`<!doctype html><html><head><meta charset="utf-8"><script>${clock(when)}${stub}<\/script></head><body>${page_html}</body></html>`,{waitUntil:"load"});
  await p.waitForTimeout(2600);
  if(fn) await fn(p);
  const r=await p.evaluate(()=>({
    hub:!!document.querySelector(".now"),
    eyebrow:(document.querySelector(".now .hub-status .eyebrow")||{}).textContent||null,
    title:(document.querySelector(".now .row .n")||{}).textContent||null,
    clock:(document.querySelector("#cwHH")||{}).textContent||null,
    state:(document.querySelector(".state h2")||{}).textContent||null,

    sections:[...document.querySelectorAll(".later .lh .eyebrow:first-child")].map(x=>x.textContent)}));
  console.log(`[${label}]`,errs.length?("ERR "+errs.join("|")):"ok",JSON.stringify(r));
  await p.screenshot({path:`late-${label}.png`,fullPage:true});await ctx.close();
}
await go("friday-2056-real",realStub,"2026-08-14T20:56:00+03:00");
await go("friday-2056-light",realStub,"2026-08-14T20:56:00+03:00","light");
await go("friday-noblocks",noBlocks,"2026-08-14T09:00:00+03:00");
await b.close();})();
