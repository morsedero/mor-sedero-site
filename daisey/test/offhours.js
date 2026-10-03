/* The "off the clock" card.
 *
 * When the working day (CFG.dayEnd) is over but the calendar still holds a
 * real event later that evening, the space between them used to render as a
 * silent void — a card at 09:00, then nothing, then a card at 20:00, with no
 * explanation of the three hours in between.
 *
 * This is NOT a Break and must not become one: a Break is a real Google
 * Calendar event Daisey creates inside the work window. This is derived at
 * render time and writes nothing, because free time is not an appointment.
 * breakGaps() cannot express it either — it clamps to winE, so it is blind by
 * construction to anything past the end of the day.
 *
 * The cases below are the ones that actually distinguish "a genuine evening
 * gap" from the several things that merely look like one.
 */
const fs=require("fs"),vm=require("vm");const {chromium}=require("playwright");
const H=fs.readFileSync(__dirname+"/harness.js","utf8");
const page_html=fs.readFileSync(__dirname+"/daisey.html","utf8");
const sb={require,__dirname,module:{exports:{}},exports:{},console,process};
vm.runInNewContext(H.split("(async () => {")[0]+"\nmodule.exports={stub};",sb);
const BASE=sb.module.exports.stub.replace(/const DAY = [^;]+;/,'const DAY = "2026-08-17";');
const clock=t=>`const R=Date;const O=new R("${t}").getTime()-R.now();
window.Date=class extends R{constructor(...a){if(a.length===0)super(R.now()+O);else super(...a);}static now(){return R.now()+O;}};`;
const ev=(id,sum,a,b)=>`{id:"${id}",summary:${JSON.stringify(sum)},status:"confirmed",start:{dateTime:"2026-08-17T${a}:00+03:00",timeZone:"Asia/Jerusalem"},end:{dateTime:"2026-08-17T${b}:00+03:00",timeZone:"Asia/Jerusalem"}}`;
const allday=`{id:"ad",summary:"מילואים",status:"confirmed",start:{date:"2026-08-16T00:00:00Z"},end:{date:"2026-08-20T00:00:00Z"}}`;

const CASES=[
 ["evening event after dayEnd",       [ev("e1","אימון כושר","20:00","21:30")],                 true ],
 ["nothing after work",               [],                                                      false],
 ["event only 15m after dayEnd",      [ev("e2","שיחה","17:15","17:45")],                       false],
 ["event still inside work hours",    [ev("e3","ישיבה","15:00","16:00")],                      false],
 ["all-day banner only",              [allday],                                                false],
 ["all-day + real evening event",     [allday, ev("e4","קונצרט","19:30","22:00")],              true ],
 ["two evening events (earliest wins)",[ev("e5","מאוחר","22:00","23:00"),ev("e6","מוקדם","19:00","20:00")], true ],
];

(async()=>{
const b=await chromium.launch({});
let fails=0;
for(const [name,evs,expect] of CASES){
  const stub=BASE+`\nEVENTS.length=0;${evs.map(e=>`EVENTS.push(${e});`).join("")}\n`;
  const ctx=await b.newContext({viewport:{width:390,height:1000},timezoneId:"Asia/Jerusalem"});
  const p=await ctx.newPage();const errs=[];
  p.on("pageerror",e=>errs.push(e.message));
  await p.setContent(`<!doctype html><html><head><meta charset="utf-8"><script>${clock("2026-08-17T09:00:00+03:00")}${stub}<\/script></head><body>${page_html}</body></html>`,{waitUntil:"load"});
  await p.waitForTimeout(3400);
  await p.evaluate(()=>{document.querySelectorAll(".scrim").forEach(s=>s.remove());});
  const r=await p.evaluate(()=>{
    const c=document.querySelector(".offhours");
    return {shown:!!c,
      span:c?(c.querySelector(".offhours-span")||{}).textContent:null,
      until:c?(c.querySelector(".offhours-until")||{}).textContent:null,
      count:document.querySelectorAll(".offhours").length,
      draggable:!!document.querySelector(".offhours .item.stack, .offhours[data-row-id]")};
  });
  const ok = r.shown===expect && r.count<=1 && !r.draggable && !errs.length;
  if(!ok) fails++;
  console.log(`${ok?"ok  ":"FAIL"} ${name.padEnd(34)} shown=${r.shown} (want ${expect})${r.shown?` "${r.span}" ${JSON.stringify(r.until)}`:""}${errs.length?" ERR:"+errs.join("|"):""}`);
  await ctx.close();
}
console.log(fails?`\n${fails} case(s) failed`:"\nall off-hours cases behave");
await b.close();
process.exit(fails?1:0);
})();
