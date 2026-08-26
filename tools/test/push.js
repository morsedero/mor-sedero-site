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
const page_html=fs.readFileSync(__dirname+"/daisey.html","utf8");
const sb={require,__dirname,module:{exports:{}},exports:{},console,process};
vm.runInNewContext(H.split("(async () => {")[0]+"\nmodule.exports={stub};",sb);
const BASE=sb.module.exports.stub;

const ev = (id, letter, s, e) => ({
  id, colorId:"9", summary:`• Task ${letter}`,
  description:`[daisey] Task ${letter}\n\nOriginal: https://trello.com/c/${id}00000/1-x`,
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

  // Wait for the boot-time auto-plan (startDay's own applyPlan) to fully
  // settle before seeding — S.busy is that plan's own re-entrancy guard.
  // A fixed wait here used to race it: its own still-in-flight
  // create/delete calls landed in the shared EVENTS array right alongside
  // the drag's own writes a moment later, leaving two brick events behind
  // instead of one.
  await p.waitForFunction(() => typeof S!=="undefined" && S.busy===false, {timeout:8000}).catch(()=>{});

  // drop in the hand-placed events, overwriting whatever boot's own
  // auto-replan produced — both the mock's backing store and the page's
  // own cache, so a background refreshCalendar() later stays consistent.
  // Also seed matching Trello card fixtures (S.cards) for A-D's synthetic
  // Original: links — the new card-aware drag (relayRows) reads item.card
  // for every quick row and refuses to move one that hasn't resolved (see
  // CLAUDE.md: silently dropping an unresolved task from a rewritten brick
  // description is a real data-loss risk, not just a test-fixture gap).
  await p.evaluate((events) => {
    EVENTS.length = 0;
    EVENTS.push(...events);
    S.events = { payload: { events: EVENTS }, storedAt: Date.now() };
    const mk = (id, letter) => ({
      id:"ari:cloud:trello::card/workspace/x/"+id, name:"Task "+letter, desc:"",
      url:"https://trello.com/c/"+id+"00000/1-x", webUrl:"https://trello.com/c/"+id+"00000/1-x",
      list:{id:"ari:cloud:trello::list/workspace/x/l1",name:"L"},
      board:{id:"ari:cloud:trello::board/workspace/x/692abd49a69c853bb71cb728",name:"PROJECTS"},
      labels:[], due:null, dueComplete:false, lastActivityAt:"2026-08-13T09:00:00.000Z", members:[]
    });
    for(const bd of BOARDS) S.cards[bd.key] = { payload:{ cards:{ nodes:[] } } };
    S.cards.projects = { payload:{ cards:{ nodes:[
      mk("qa","A"), mk("qb","B"), mk("qc","C"), mk("qd","D")
    ]}}};
    render();
  }, EVENTS);
  await p.waitForTimeout(300);

  const bad=[];
  const check=(cond,msg)=>{ if(!cond) bad.push(msg); };

  /* Reads agenda()'s exploded per-card rows, not allEvents() — once A/B/C
     land back-to-back they merge into one shared brick event (see
     CLAUDE.md), so there's no longer one event per task to read s/e off
     directly; agenda()'s item.s/item.e2 are still the real per-task
     positions regardless of how many events they're spread across. */
  const times=async()=>p.evaluate(()=>{
    const out={};
    for(const i of agenda()){
      const m = i.card && /^Task ([A-D])$/.exec(i.card.name);
      if(m) out[m[1]] = { s:i.s, e:i.e2 };
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
  /* Selected by TITLE, not by index. The hub now renders inside .rows.stack
     (it sits on the hour grid with everything else), so an nth() index into
     that list silently shifted by one when that landed — the drag still ran,
     just onto Task B, and the failure read as a scheduling bug rather than a
     stale selector. Identity can't drift like that. */
  const cBox = await p.locator("#pageMain .rows.stack .item.stack:not(.meeting)")
    .filter({ hasText:"Task C" }).first().boundingBox();
  check(!!hubBox && !!cBox, "drag setup: hub or Task C's row wasn't found");

  if(hubBox && cBox){
    await p.mouse.move(hubBox.x+hubBox.width/2, hubBox.y+20);
    await p.mouse.down();
    await p.waitForTimeout(200);   // wireStackDrag's ARM_MS hold before it arms the drag
    await p.mouse.move(hubBox.x+hubBox.width/2, cBox.y+cBox.height/2, {steps:10});
    await p.mouse.move(hubBox.x+hubBox.width/2, cBox.y+cBox.height/2, {steps:2});
    await p.mouse.up();
  }
  await p.waitForTimeout(700);

  /* Repacked positions use CFG.quickTotal (default 15min) per task, not
     each card's old individual duration — relayRows sizes every quick row
     by the same fixed slice planFor already uses for a brick window, same
     as a real reorder would. The pre-drag EVENTS fixture's own 20-minute
     spacing is unrelated and only matters for the "before" checks above,
     which read raw, un-repacked event times. */
  const after = await times();
  check(after.B && after.B.s===540 && after.B.e===555, `B should have been pushed into A's old 09:00 slot, got ${JSON.stringify(after.B)}`);
  check(after.C && after.C.s===555 && after.C.e===570, `C should have been pushed into B's old slot, got ${JSON.stringify(after.C)}`);
  check(after.A && after.A.s===570 && after.A.e===585, `A should have landed in C's old slot, got ${JSON.stringify(after.A)}`);
  check(after.D && after.D.s===600 && after.D.e===620, `D wasn't part of the push and should be untouched, got ${JSON.stringify(after.D)}`);
  /* A, B and C are still adjacent quick tasks after the push, so they
     merge into one shared brick event (see CLAUDE.md); D, no longer
     adjacent to them, stays its own event untouched. */
  const shape = await p.evaluate(()=>{
    const evs = allEvents().filter(e=>e.isTask && !e.isBreak);
    return { brickCount: evs.filter(e=>e.isBrick).length, total: evs.length };
  });
  check(shape.brickCount===1, `A/B/C should have merged into one brick event, got ${shape.brickCount} brick event(s)`);
  check(shape.total===2, `expected 2 events total (the ABC brick + D's own), got ${shape.total}`);

  const undoShown = await p.evaluate(()=>!!document.querySelector(".toast.undo"));
  check(undoShown, "a completed push should show the undo popup");

  await p.keyboard.press("Control+z");
  await p.waitForTimeout(700);

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
