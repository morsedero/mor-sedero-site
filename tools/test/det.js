const fs=require("fs"),vm=require("vm");const {chromium}=require("playwright");
const H=fs.readFileSync("harness.js","utf8");const page_html=fs.readFileSync("dayflow.html","utf8");
const sb={require,__dirname,module:{exports:{}},exports:{},console,process};
vm.runInNewContext(H.split("(async () => {")[0]+"\nmodule.exports={stub};",sb);
const stub=sb.module.exports.stub.replace(/const DAY = [^;]+;/,'const DAY = "2026-08-17";');
const clock=t=>`const R=Date;const O=new R("${t}").getTime()-R.now();
window.Date=class extends R{constructor(...a){if(a.length===0)super(R.now()+O);else super(...a);}static now(){return R.now()+O;}};`;
(async()=>{const b=await chromium.launch({});
const ctx=await b.newContext({viewport:{width:760,height:1200},timezoneId:"Asia/Jerusalem",colorScheme:"dark"});
const p=await ctx.newPage();const errs=[];
p.on("pageerror",e=>errs.push(e.message));p.on("console",m=>{if(m.type()==="error")errs.push(m.text());});
await p.setContent(`<!doctype html><html><head><meta charset="utf-8"><script>${clock("2026-08-17T09:00:00+03:00")}${stub}<\/script></head><body>${page_html}</body></html>`,{waitUntil:"load"});
await p.waitForTimeout(2800);
// details open on their own now — nothing to click, on the hub or on rows
const out=await p.evaluate(()=>({
  hubTitle:(document.querySelector(".now .row .n")||{}).textContent,
  panels:[...document.querySelectorAll("#pageMain .details")].map(d=>({
    desc:(d.querySelector(".desc")||{}).textContent||null,
    checklist:(d.querySelector(".clname")||{}).textContent||null,
    prog:(d.querySelector(".prog i")||{style:{}}).style.width||null,
    items:[...d.querySelectorAll("li")].map(l=>(l.classList.contains("on")?"[x] ":"[ ] ")+l.querySelector(".it").textContent.slice(0,24)),
    muted:(d.querySelector(".muted")||{}).textContent||null })),
  checklistCalls:window.__calls.filter(c=>c.tool==="trelloReadChecklist").length
}));
console.log("errors:",errs.length?errs:"none");
console.log(JSON.stringify(out,null,1));
await p.screenshot({path:"det.png",fullPage:true});await b.close();})();
