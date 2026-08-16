/* Drag-to-reorder in the Day-view list must PUSH the whole run of cards
   between the old and new position, not just trade times with whatever's
   under the pointer — the thing that changed after cards A/B/C/D (all
   quick, back-to-back, no gaps) get dragged: A onto C's slot should also
   move B (the card in between) into A's old slot, not leave it sitting
   still. A plain pairwise swap would only touch A and C.

   The calendar state is overwritten directly after boot settles, rather
   than fed in through the EVENTS fixture, so the widget's own auto-replan
   on first load (nothing "planned" yet for the day) can't immediately
   clear these hand-placed blocks out from under the test. Both the mock
   connector's own backing EVENTS array and the page's S.events cache get
   the override — list_events/update_event read and mutate EVENTS by
   reference (see harness.js), so a later commitMove() background
   refreshCalendar() would otherwise stomp these back to whatever boot's
   auto-replan produced. */
const fs=require("fs"),vm=require("vm");const {chromium}=require("playwright");
const H=fs.readFileSync(__dirname+"/harness.js","utf8");
const page_html=fs.readFileSync(__dirname+"/dayflow.html","utf8");
const sb={require,__dirname,module:{exports:{}},exports:{},console,process};
vm.runInNewContext(H.split("(async () => {")[0]+"\nmodule.exports={stub};",sb);
const BASE=sb.module.exports.stub;

const ev = (id, letter, s, e) => ({
  id, colorId:"9", summary:`• Task ${letter}`,
  description:`[dayflow] Task ${letter}\n\nOriginal: https://trello.com/c/${id}00000/1-x`,
  start:{dateTime:`2026-08-14T${s}:00+03:00`,timeZone:"Asia/Jerusalem"},
  end:{dateTime:`2026-08-14T${e}:00+03:00`,timeZone:"Asia/Jerusalem"},
  status:"confirmed"
});
const EVENTS = [
  ev("qa","A","09:00","09:20"),
  ev("qb","B","09:20","09:40"),
  ev("qc","C","09:40","10:00"),
  ev("qd","D","10:00","10:20")
];

const clock=t=>`const R=Date;const O=new R("${t}").getTime()-R.now();
window.Date=class extends R{constructor(...a){if(a.length===0)super(R.now()+O);else super(...a);}static now(){return R.now()+O;}};`;

(async()=>{
  const b=await chromium.launch({});
  const ctx=await b.newContext({viewport:{width:420,height:900},timezoneId:"Asia/Jerusalem",colorScheme:"dark"});
  const p=await ctx.newPage();
  const errs=[];
  p.on("pageerror",e=>errs.push(e.message));
  p.on("console",m=>{if(m.type()==="error")errs.push(m.text());});
  await p.setContent(`<!doctype html><html><head><meta charset="utf-8"><script>${clock("2026-08-14T07:00:00+03:00")}${BASE}<\/script></head><body>${page_html}</body></html>`,{waitUntil:"load"});
  await p.waitForTimeout(2600);

  // drop in the hand-placed events, overwriting whatever boot's own
  // auto-replan produced — both the mock's backing store and the page's
  // own cache, so a background refreshCalendar() later stays consistent
  await p.evaluate((events) => {
    EVENTS.length = 0;
    EVENTS.push(...events);
    S.events = { payload: { events: EVENTS }, storedAt: Date.now() };
    render();
  }, EVENTS);
  await p.waitForTimeout(300);

  const bad=[];
  const check=(cond,msg)=>{ if(!cond) bad.push(msg); };

  const times=async()=>p.evaluate(()=>{
    const out={};
    for(const e of allEvents()){
      const m = /^Task ([A-D])$/.exec((e.summary||"").replace(/^•\s*/,""));
      if(m) out[m[1]] = { s:minsOf(e.start), e:minsOf(e.end) };
    }
    return out;
  });

  const before = await times();
  check(before.A && before.A.s===540 && before.A.e===560, `A should start at 09:00, got ${JSON.stringify(before.A)}`);
  check(before.B && before.B.s===560 && before.B.e===580, `B should start at 09:20, got ${JSON.stringify(before.B)}`);
  check(before.C && before.C.s===580 && before.C.e===600, `C should start at 09:40, got ${JSON.stringify(before.C)}`);
  check(before.D && before.D.s===600 && before.D.e===620, `D should start at 10:00, got ${JSON.stringify(before.D)}`);

  const hubTitle = await p.evaluate(()=>(document.querySelector(".now .row .n")||{}).textContent||"");
  check(hubTitle.includes("Task A"), `hub should be the earliest card (Task A), got "${hubTitle}"`);

  const hubBox = await p.locator("#pageMain .now").boundingBox();
  const cBox = await p.locator("#pageMain .rows.stack .item.stack:not(.meeting)").nth(1).boundingBox();
  check(!!hubBox && !!cBox, "drag setup: hub or Task C's row wasn't found");

  const beforeCalls = await p.evaluate(()=>window.__calls.filter(c=>c.tool==="update_event").length);
  if(hubBox && cBox){
    await p.mouse.move(hubBox.x+hubBox.width/2, hubBox.y+20);
    await p.mouse.down();
    await p.mouse.move(hubBox.x+hubBox.width/2, cBox.y+cBox.height/2, {steps:10});
    await p.mouse.move(hubBox.x+hubBox.width/2, cBox.y+cBox.height/2, {steps:2});
    await p.mouse.up();
  }
  await p.waitForTimeout(700);

  const afterCalls = await p.evaluate(()=>window.__calls.filter(c=>c.tool==="update_event").length);
  check(afterCalls-beforeCalls===3, `pushing A onto C should move 3 cards (A, B, C — not D), got ${afterCalls-beforeCalls} update_event calls`);

  const after = await times();
  check(after.B && after.B.s===540 && after.B.e===560, `B should have been pushed into A's old 09:00 slot, got ${JSON.stringify(after.B)}`);
  check(after.C && after.C.s===560 && after.C.e===580, `C should have been pushed into B's old 09:20 slot, got ${JSON.stringify(after.C)}`);
  check(after.A && after.A.s===580 && after.A.e===600, `A should have landed in C's old 09:40 slot, got ${JSON.stringify(after.A)}`);
  check(after.D && after.D.s===600 && after.D.e===620, `D wasn't part of the push and should be untouched, got ${JSON.stringify(after.D)}`);

  const undoShown = await p.evaluate(()=>!!document.querySelector(".toast.undo"));
  check(undoShown, "a completed push should show the undo popup");

  const beforeUndo = await p.evaluate(()=>window.__calls.filter(c=>c.tool==="update_event").length);
  await p.keyboard.press("Control+z");
  await p.waitForTimeout(700);
  const afterUndo = await p.evaluate(()=>window.__calls.filter(c=>c.tool==="update_event").length);
  check(afterUndo-beforeUndo===3, `Ctrl+Z on a 3-card push should undo all three, got ${afterUndo-beforeUndo} more update_event calls`);

  const restored = await times();
  check(restored.A && restored.A.s===540 && restored.A.e===560, `undo should restore A to 09:00, got ${JSON.stringify(restored.A)}`);
  check(restored.B && restored.B.s===560 && restored.B.e===580, `undo should restore B to 09:20, got ${JSON.stringify(restored.B)}`);
  check(restored.C && restored.C.s===580 && restored.C.e===600, `undo should restore C to 09:40, got ${JSON.stringify(restored.C)}`);

  await p.screenshot({path:"push-after.png",fullPage:true});
  console.log("errors:", errs.length?errs:"none");
  console.log(bad.length ? "FAIL:\n  ✗ "+bad.join("\n  ✗ ") : "✓ dragging a card across others pushes the whole run, undo restores it");
  await b.close();
  process.exit(bad.length+errs.length?1:0);
})();
