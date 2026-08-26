const fs=require("fs"),vm=require("vm");const {chromium}=require("playwright");
const H=fs.readFileSync("harness.js","utf8");const page_html=fs.readFileSync("daisey.html","utf8");
const sb={require,__dirname,module:{exports:{}},exports:{},console,process};
vm.runInNewContext(H.split("(async () => {")[0]+"\nmodule.exports={stub};",sb);
const BASE=sb.module.exports.stub;
const clock=t=>`const R=Date;const O=new R("${t}").getTime()-R.now();
window.Date=class extends R{constructor(...a){if(a.length===0)super(R.now()+O);else super(...a);}static now(){return R.now()+O;}};`;
async function run(b,label,stub,when,scheme){
  const ctx=await b.newContext({viewport:{width:760,height:760},timezoneId:"Asia/Jerusalem",colorScheme:scheme||"dark"});
  const p=await ctx.newPage();const errs=[];
  p.on("pageerror",e=>errs.push(e.message));p.on("console",m=>{if(m.type()==="error")errs.push(m.text());});
  await p.setContent(`<!doctype html><html><head><meta charset="utf-8"><script>${clock(when)}${stub}<\/script></head><body>${page_html}</body></html>`,{waitUntil:"load"});
  await p.waitForTimeout(2600);
  const r=await p.evaluate(()=>({
    state:(document.querySelector(".state h2")||{}).textContent||null,
    now:(document.querySelector(".now .row .n")||{}).textContent||null,
    meetingStrip:(document.querySelector(".meeting-now .mn-name")||{}).textContent||null,
    sections:[...document.querySelectorAll(".later .lh .eyebrow:first-child")].map(x=>x.textContent),
    rowNames:[...document.querySelectorAll("#pageMain .rows .row .n .nt")].map(x=>x.textContent.slice(0,22)),
    dashRightHidden:document.querySelector("#dashRight").hidden}));
  console.log(`[${label}]`,errs.length?("ERR "+errs.join("|")):"ok",JSON.stringify(r));
  await p.screenshot({path:`st-${label}.png`,fullPage:true});await ctx.close();
}
(async()=>{const b=await chromium.launch({});
const mon=BASE.replace(/const DAY = [^;]+;/,'const DAY = "2026-08-17";');
// empty day: no events at all
const empty=BASE.replace(/const EVENTS = [^;]+;/,"const EVENTS = [];");
// connector down
const dead=BASE.replace(/watchTool\(server, tool, input, handler, opts\)\{/,
 'watchTool(server, tool, input, handler, opts){ setTimeout(()=>handler({type:"error",error:{code:"needs_reauth",server,message:"expired"}}),20); return ()=>{};} __unused(){');
await run(b,"midday",mon,"2026-08-17T09:40:00+03:00");
await run(b,"empty",empty,"2026-08-17T09:40:00+03:00");
await run(b,"friday",BASE,"2026-08-14T09:40:00+03:00","light");
await run(b,"saturday",BASE,"2026-08-15T09:40:00+03:00");
await run(b,"dead",dead,"2026-08-17T09:40:00+03:00");
await b.close();})();
