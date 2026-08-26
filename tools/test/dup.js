/* Rebuild used to leave a card with two identical blocks side by side when
   the *delete* half of clear-then-recreate failed but the *create* half
   still went through: applyPlan optimistically dropped the old block from
   the local model before attempting the real delete, and on failure just
   toasted — nothing put the model back, nothing kept the just-freed slot
   out of planFor's re-lay. The same still-eligible card then got a brand
   new block in the same slot its old, still-real block already occupied.

   Fixture: one candidate card with one existing quick block today. delete_event
   is made to fail once with a non-retryable code, so applyPlan sees exactly
   one failed clear. */
const fs=require("fs"),vm=require("vm");const {chromium}=require("playwright");
const H=fs.readFileSync(__dirname+"/harness.js","utf8");
const page_html=fs.readFileSync(__dirname+"/daisey.html","utf8");
const sb={require,__dirname,module:{exports:{}},exports:{},console,process};
vm.runInNewContext(H.split("(async () => {")[0]+"\nmodule.exports={stub};",sb);
const BASE=sb.module.exports.stub;

const HOOK="window.__calls.push({ server, tool, input });";
const FAIL=HOOK+' if(window.__fail && window.__fail.tool===tool && window.__fail.n>0){ window.__fail.n--; throw { code:"tool_error", server, message:"stubbed rejection" }; }';
const stub=BASE.split(HOOK).join(FAIL);
if(stub===BASE){ console.log("FAIL:\n  ✗ test setup: the callTool logging hook wasn't found in the harness"); process.exit(1); }

/* the card behind the block below — "לסגור מקום לחתונה" — already exists in
   harness.js's own סדקו fixture (short: "Y9SpnlTP"), unlabelled (quick),
   due today, so it's still the top-ranked candidate after the block is
   cleared and gets picked again on the same rebuild. */
const SHORT="Y9SpnlTP";
const ev = (id,s,e) => ({
  id, colorId:"9", summary:"• לסגור מקום לחתונה",
  description:`[daisey] לסגור מקום לחתונה\n\nOriginal: https://trello.com/c/${SHORT}/1-x`,
  start:{dateTime:`2026-08-14T${s}:00+03:00`,timeZone:"Asia/Jerusalem"},
  end:{dateTime:`2026-08-14T${e}:00+03:00`,timeZone:"Asia/Jerusalem"},
  status:"confirmed"
});
const EVENTS=[ev("qa","09:00","09:15")];

const clock=t=>`const R=Date;const O=new R("${t}").getTime()-R.now();
window.Date=class extends R{constructor(...a){if(a.length===0)super(R.now()+O);else super(...a);}static now(){return R.now()+O;}};`;

const bad=[];
const check=(cond,msg)=>{ if(!cond) bad.push(msg); };

(async()=>{
  const b=await chromium.launch({});
  const ctx=await b.newContext({viewport:{width:420,height:900},timezoneId:"Asia/Jerusalem",colorScheme:"dark"});
  const p=await ctx.newPage();
  p.on("pageerror",e=>bad.push("pageerror: "+e.message));
  p.on("console",m=>{if(m.type()==="error")bad.push("console: "+m.text());});
  await p.setContent(`<!doctype html><html><head><meta charset="utf-8"><script>${clock("2026-08-14T07:00:00+03:00")}${stub}<\/script></head><body>${page_html}</body></html>`,{waitUntil:"load"});
  await p.waitForTimeout(2600);

  await p.evaluate((events)=>{
    EVENTS.length=0; EVENTS.push(...JSON.parse(JSON.stringify(events)));
    S.events={ payload:{ events:EVENTS }, storedAt:Date.now() };
    S.failed=[];
    render();
  }, EVENTS);

  const blocksForCard=async()=>p.evaluate((short)=>
    allEvents().filter(e=>e.cardShort===short).map(e=>({id:e.id,s:minsOf(e.start),e:minsOf(e.end)})), SHORT);

  const before=await blocksForCard();
  check(before.length===1,`fixture should start with exactly one block, got ${before.length}`);

  await p.evaluate(()=>{ window.__fail={tool:"delete_event",n:1}; });
  await p.evaluate((d)=>{
    applyPlan(startOfDay(new Date()), "normal", null, true);
  });
  await p.waitForTimeout(1200);

  const after=await blocksForCard();
  check(after.length===1,`a failed clear must not leave two blocks for the same card, got ${after.length}: ${JSON.stringify(after)}`);
  check(after.length!==1 || after[0].id===before[0].id,
    "the surviving block should be the original one, put back by the undo — not a newly-created duplicate");

  const bar=await p.evaluate(()=>{
    const t=document.querySelector(".toast.unsaved");
    return t ? (t.querySelector(".undo-msg")||{}).textContent : null;
  });
  check(/1 change didn't save/.test(bar||""),`the failed clear should sit in the unsaved bar, got ${JSON.stringify(bar)}`);

  /* retry succeeds now — the old block finally clears for real, and since
     this run never created a second block for it, the card just goes back
     to unscheduled (safe) rather than anything getting left behind */
  await p.evaluate(()=>{ window.__fail={tool:"delete_event",n:0}; });
  await p.click(".toast.unsaved .undo-btn");
  await p.waitForTimeout(800);

  const afterRetry=await blocksForCard();
  check(afterRetry.length===0,`retry should finish clearing the original block, got ${afterRetry.length} left`);
  const barGone=await p.evaluate(()=>!document.querySelector(".toast.unsaved"));
  check(barGone,"the unsaved bar should clear once the retried delete lands");

  console.log("[dup]", JSON.stringify({before,after,bar,afterRetry,barGone}));
  console.log(bad.length ? "FAIL:\n  ✗ "+bad.join("\n  ✗ ")
                         : "✓ a failed clear during rebuild no longer doubles the card");
  await b.close();
  process.exit(bad.length?1:0);
})();
