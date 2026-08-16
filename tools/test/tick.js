const fs=require("fs"),vm=require("vm");const {chromium}=require("playwright");
const H=fs.readFileSync("harness.js","utf8");const page_html=fs.readFileSync("dayflow.html","utf8");
const sb={require,__dirname,module:{exports:{}},exports:{},console,process};
vm.runInNewContext(H.split("(async () => {")[0]+"\nmodule.exports={stub};",sb);
const stub=sb.module.exports.stub.replace(/const DAY = [^;]+;/,'const DAY = "2026-08-17";');
const clock=t=>`const R=Date;const O=new R("${t}").getTime()-R.now();
window.Date=class extends R{constructor(...a){if(a.length===0)super(R.now()+O);else super(...a);}static now(){return R.now()+O;}};`;
(async()=>{const b=await chromium.launch({});
for(const scheme of ["dark","light"]){
 const ctx=await b.newContext({viewport:{width:760,height:1150},timezoneId:"Asia/Jerusalem",colorScheme:scheme});
 const p=await ctx.newPage();const errs=[];
 p.on("pageerror",e=>errs.push(e.message));p.on("console",m=>{if(m.type()==="error")errs.push(m.text());});
 await p.setContent(`<!doctype html><html><head><meta charset="utf-8"><script>${clock("2026-08-17T09:00:00+03:00")}${stub}<\/script></head><body>${page_html}</body></html>`,{waitUntil:"load"});
 await p.waitForTimeout(3200);
 const auto=await p.evaluate(()=>({
   panelsOpen:document.querySelectorAll("#pageMain .details").length,
   checkboxes:document.querySelectorAll("#pageMain .details li .box").length,
   expandBtns:document.querySelectorAll("#pageMain .expand").length,
   accent:getComputedStyle(document.documentElement).getPropertyValue("--accent").trim(),
   boardDots:[...document.querySelectorAll("#pageMain .rows .row .dot")].map(d=>getComputedStyle(d).backgroundColor)
 }));
 if(scheme==="dark"){
   // toggle the first unchecked item
   const box=p.locator("#pageMain .details li:not(.on) .box").first();
   const before=await p.evaluate(()=>[...document.querySelectorAll("#pageMain .details li")].map(l=>l.classList.contains("on")?1:0));
   await box.click(); await p.waitForTimeout(800);
   const after=await p.evaluate(()=>({
     states:[...document.querySelectorAll("#pageMain .details li")].map(l=>l.classList.contains("on")?1:0),
     counts:[...document.querySelectorAll("#pageMain .details .clname span:last-child")].map(x=>x.textContent),
     writes:window.__calls.filter(c=>c.tool==="trelloWriteChecklist").map(c=>c.input.action+":"+c.input.checked)}));
   console.log("[toggle] before:",JSON.stringify(before),"after:",JSON.stringify(after));
 }
 console.log(`[${scheme}]`,errs.length?("ERR "+errs.join("|")):"ok",JSON.stringify(auto));
 await p.screenshot({path:`tick-${scheme}.png`,fullPage:true});await ctx.close();
}
await b.close();})();
