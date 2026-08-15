/* Friday is an ordinary planning day: no prompt, caps applied on open. */
const fs=require("fs"),vm=require("vm");const {chromium}=require("playwright");
const H=fs.readFileSync(__dirname+"/harness.js","utf8");
const page_html=fs.readFileSync(__dirname+"/dayflow.html","utf8");
const sb={require,__dirname,module:{exports:{}},exports:{},console,process};
vm.runInNewContext(H.split("(async () => {")[0]+"\nmodule.exports={stub};",sb);
const REAL=JSON.parse(fs.readFileSync(__dirname+"/real-events.json","utf8")).events;  // real Friday 14 Aug
const stub=sb.module.exports.stub.replace(/const EVENTS = [^;]+;/,"const EVENTS = "+JSON.stringify(REAL)+";");
const clock=t=>`const R=Date;const O=new R("${t}").getTime()-R.now();
window.Date=class extends R{constructor(...a){if(a.length===0)super(R.now()+O);else super(...a);}static now(){return R.now()+O;}};`;

(async()=>{
  const b=await chromium.launch({executablePath:"/opt/pw-browsers/chromium-1194/chrome-linux/chrome"});
  let fails=0;
  for(const [label,when] of [["friday morning","2026-08-14T09:00:00+03:00"],
                             ["saturday","2026-08-15T09:00:00+03:00"]]){
    const ctx=await b.newContext({viewport:{width:760,height:1100},timezoneId:"Asia/Jerusalem",colorScheme:"dark"});
    const p=await ctx.newPage();const errs=[];
    p.on("pageerror",e=>errs.push(e.message));p.on("console",m=>{if(m.type()==="error")errs.push(m.text());});
    await p.setContent(`<!doctype html><html><head><meta charset="utf-8"><script>${clock(when)}${stub}<\/script></head><body>${page_html}</body></html>`,{waitUntil:"load"});
    await p.waitForTimeout(3200);
    const r=await p.evaluate(()=>{const h=existingBlocks(new Date());
      return {quick:h.quick,short:h.short,long:h.long,prompt:!!document.querySelector(".ask"),
              hub:!!document.querySelector(".now"),
              state:(document.querySelector(".state h2")||{}).textContent||null,
              maxS:CFG.maxSmall,maxSh:CFG.maxShort,maxL:CFG.maxLong};});
    const bad=[];
    if(r.prompt) bad.push("a prompt was shown");
    if(label==="saturday"){
      if(r.state!=="Day off") bad.push("day-off state missing");
      if(r.quick||r.short||r.long) bad.push("scheduled something on the day off");
    }else{
      if(r.quick>r.maxS) bad.push(`${r.quick} quick > cap ${r.maxS}`);
      if(r.short>r.maxSh) bad.push(`${r.short} short > cap ${r.maxSh}`);
      if(r.long>r.maxL)  bad.push(`${r.long} long > cap ${r.maxL}`);
      if(!r.hub) bad.push("no hub");
    }
    console.log(`[${label}] ${errs.length?"ERR "+errs.join("|"):"ok"} ${r.quick}/${r.maxS} quick · ${r.short}/${r.maxSh} short · ${r.long}/${r.maxL} long · prompt=${r.prompt}` +
                (bad.length?"\n  ✗ "+bad.join("\n  ✗ "):"  ✓"));
    fails+=bad.length+errs.length;
    await p.screenshot({path:__dirname+`/fri-${label.split(" ")[0]}.png`,fullPage:true});
    await ctx.close();
  }
  await b.close();
  process.exit(fails?1:0);
})();
