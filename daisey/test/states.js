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
  p.on("pageerror",e=>errs.push(e.message));p.on("console",m=>{if(m.type()==="error" && !/^\[daisey\]/.test(m.text()))errs.push(m.text());});
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
  return {label,errs,r};
}
/* The "dead" scenario is SUPPOSED to surface connector errors, so a blanket
   "any error fails" gate would fail it for working correctly. Gate on page
   errors for the live scenarios, and on the rendered result for dead. */
const fails=[];
function check(cond,msg){ if(!cond) fails.push(msg); }
(async()=>{const b=await chromium.launch({});
const mon=BASE.replace(/const DAY = [^;]+;/,'const DAY = "2026-08-17";');
// empty day: no events at all
const empty=BASE.replace(/const EVENTS = [^;]+;/,"const EVENTS = [];");
/* connector down. This used to splice a early-return into watchTool's body
   and open a dangling `__unused(){` to swallow the original — which stopped
   parsing once the real watchTool grew its own body, so every "dead" run
   died with a SyntaxError and reported ERR while exiting 0. The harness
   models this properly now: __DEAD_SERVER makes the stub deliver the error
   EVENT the real connector delivers, instead of throwing. */
const dead=BASE+'\nwindow.__DEAD_SERVER={"Trello":"needs_reauth","Google Calendar":"needs_reauth"};';
const midday=await run(b,"midday",mon,"2026-08-17T09:40:00+03:00");
const empt =await run(b,"empty",empty,"2026-08-17T09:40:00+03:00");
const fri  =await run(b,"friday",BASE,"2026-08-14T09:40:00+03:00","light");
const sat  =await run(b,"saturday",BASE,"2026-08-15T09:40:00+03:00");
const dd   =await run(b,"dead",dead,"2026-08-17T09:40:00+03:00");
await b.close();

for(const s of [midday,empt,fri,sat])
  check(s.errs.length===0, `${s.label}: page errors — ${s.errs.join(" | ")}`);

/* a working day renders a current task and some rows */
for(const s of [midday,empt,fri]){
  check(!!s.r.now, `${s.label}: expected a current task, got none`);
  check(s.r.rowNames.length>0, `${s.label}: expected rows in the day list, got none`);
}
/* the day off schedules nothing and hides the right-hand dash */
check(sat.r.state==="My Day Off", `saturday: expected the day-off state card, got ${JSON.stringify(sat.r.state)}`);
check(sat.r.rowNames.length===0, `saturday: expected no rows on the day off, got ${sat.r.rowNames.length}`);
/* a dead connector shows the no-data state rather than a blank or a crash */
check(!!dd.r.state, "dead: expected a state card when the connector is down, got none");
check(!/SyntaxError|Unexpected identifier/.test(dd.errs.join(" ")),
  `dead: the stub itself failed to parse — ${dd.errs.join(" | ")}`);

console.log(fails.length?"FAIL:\n"+fails.map(f=>"  ✗ "+f).join("\n"):"✓ all states hold");
process.exit(fails.length?1:0);})();
