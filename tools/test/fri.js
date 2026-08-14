const fs=require("fs"),vm=require("vm");const {chromium}=require("playwright");
const H=fs.readFileSync("harness.js","utf8");const page_html=fs.readFileSync("dayflow.html","utf8");
const sb={require,__dirname,module:{exports:{}},exports:{},console,process};
vm.runInNewContext(H.split("(async () => {")[0]+"\nmodule.exports={stub};",sb);
const REAL=JSON.parse(fs.readFileSync("real-events.json","utf8")).events;   // real Friday 14 Aug
const stub=sb.module.exports.stub.replace(/const EVENTS = [^;]+;/,"const EVENTS = "+JSON.stringify(REAL)+";");
const clock=t=>`const R=Date;const O=new R("${t}").getTime()-R.now();
window.Date=class extends R{constructor(...a){if(a.length===0)super(R.now()+O);else super(...a);}static now(){return R.now()+O;}};`;
(async()=>{const b=await chromium.launch({executablePath:"/opt/pw-browsers/chromium-1194/chrome-linux/chrome"});
async function run(label,choice,when){
  const ctx=await b.newContext({viewport:{width:760,height:1100},timezoneId:"Asia/Jerusalem",colorScheme:"dark"});
  const p=await ctx.newPage();const errs=[];
  p.on("pageerror",e=>errs.push(e.message));p.on("console",m=>{if(m.type()==="error")errs.push(m.text());});
  await p.setContent(`<!doctype html><html><head><meta charset="utf-8"><script>${clock(when)}${stub}<\/script></head><body>${page_html}</body></html>`,{waitUntil:"load"});
  await p.waitForTimeout(2600);
  const before=await p.evaluate(()=>({ask:!!document.querySelector(".ask"),
    hub:!!document.querySelector(".now"), tasks:existingBlocks(new Date()).total}));
  if(choice!=null){
    await p.locator(".ask-opts .opt-sm").nth(choice).click();
    await p.waitForTimeout(2600);
  }
  const after=await p.evaluate(()=>{const h=existingBlocks(new Date());
    return {small:h.small,deep:h.deep,total:h.total,ask:!!document.querySelector(".ask"),
      hub:!!document.querySelector(".now"),
      answer:(S.stats.fridayAnswers||{})[dayKey(new Date())]||null};});
  console.log(`[${label}]`,errs.length?("ERR "+errs.join("|")):"ok","before:",JSON.stringify(before),"after:",JSON.stringify(after));
  await p.screenshot({path:`fri-${label}.png`,fullPage:true});await ctx.close();
}
await run("ask-visible",null,"2026-08-14T09:00:00+03:00");
await run("short",0,"2026-08-14T09:00:00+03:00");
await run("full",1,"2026-08-14T09:00:00+03:00");
await run("off",2,"2026-08-14T09:00:00+03:00");
await b.close();})();
