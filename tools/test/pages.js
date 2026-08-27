/* The one-page shell — none of this existed before the redesign that
   dropped the separate Tasks/Schedule swipe split, so nothing else in the
   suite exercises it. Week view (and its own drag/collision/day-jump
   coverage, steps 3-6 in an earlier version of this file) was removed
   outright 2026-08-26 — Daisey is day-only now, one page, no switcher. */
const fs=require("fs"),vm=require("vm");const {chromium}=require("playwright");
const H=fs.readFileSync(__dirname+"/harness.js","utf8");
const page_html=fs.readFileSync(__dirname+"/daisey.html","utf8");
const sb={require,__dirname,module:{exports:{}},exports:{},console,process};
vm.runInNewContext(H.split("(async () => {")[0]+"\nmodule.exports={stub};",sb);
const BASE=sb.module.exports.stub;
const stub=BASE.replace(/const DAY = [^;]+;/,'const DAY = "2026-08-17";');
const clock=t=>`const R=Date;const O=new R("${t}").getTime()-R.now();
window.Date=class extends R{constructor(...a){if(a.length===0)super(R.now()+O);else super(...a);}static now(){return R.now()+O;}};`;

(async()=>{
  const b=await chromium.launch({});
  /* tall enough that the hub-to-first-list-row drag span (2b) fits in one
     screen even when the fixture's active meeting pulls its own tasks into
     a standalone nest between them (header + hub + nest push that span
     past 850px otherwise — no scroll position can fit both drag endpoints
     into a viewport shorter than the content actually spans). */
  const ctx=await b.newContext({viewport:{width:400,height:1100},timezoneId:"Asia/Jerusalem",colorScheme:"dark"});
  const p=await ctx.newPage();
  const errs=[];
  p.on("pageerror",e=>errs.push(e.message));
  p.on("console",m=>{if(m.type()==="error" && !/^\[daisey\]/.test(m.text()))errs.push(m.text());});
  await p.setContent(`<!doctype html><html><head><meta charset="utf-8"><script>${clock("2026-08-17T09:00:00+03:00")}${stub}<\/script></head><body>${page_html}<script>try{checkChoresTrigger=function(){};}catch(_){}<\/script></body></html>`,{waitUntil:"load"});
  await p.waitForTimeout(2800);

  const bad=[];
  const check=(cond,msg)=>{ if(!cond) bad.push(msg); };

  // 1. starts on Day view, on the one page, switcher visible from the start
  /* .now, not #pageMain .now (2026-08-26 hero redesign): the hub card lives
     in #heroSlot now, a flex sibling above #pageMain's own scroller — see
     paintHero/heroCard. Bare .now still finds it (it's the only match on
     the page), just no longer scoped to a container it isn't inside. */
  let state=await p.evaluate(()=>({view:S.view,hub:!!document.querySelector(".now"),
    viewSwitchHidden:document.querySelector("#viewSwitch").hidden}));
  check(state.view==="day","should start on Day view");
  check(state.hub,"Day view should show the hub card");
  check(!state.viewSwitchHidden,"the switcher should always be visible now");
  await p.screenshot({path:"pages-day.png"});

  // 2. the day's activities include real meetings, not just tasks — the
  //    merge that replaced the separate Schedule page
  state=await p.evaluate(()=>({meetingRows:document.querySelectorAll("#pageMain .item.meeting").length}));
  check(state.meetingRows>0,"Day view's activity list should include meetings, not tasks only");

  // 2b. drag-to-reorder in the Day-view list: drag the hub card onto the
  //     first list row below it — with nothing between them in the run,
  //     pushing degenerates to trading their two start times (two
  //     update_event calls), with an undo that puts both back. Dragging a
  //     task onto a meeting must be a no-op — meetings aren't a drop target.
  {
    /* A clean, controlled schedule for this check, not the ambient fixture:
       the fixture can (and here, does) have an active meeting pulling its
       own tasks into a standalone nest between the hub and "Later today"
       (see paintMain) — a real, working feature, but it leaves genuinely
       scheduled tasks sitting chronologically between the hub and whatever
       .rows.stack's first row is, without being part of wireStackDrag's
       reorder pool at all. pushReorder repacks times assuming the pool IS
       the full adjacent run, so a "simple adjacent push" against whatever
       the ambient fixture happens to produce can land on a much
       differently-timed row and get correctly rejected for colliding with
       those excluded tasks — not a bug, just not this check's own fixture
       to depend on. One task, one adjacent task, no meeting: nothing left
       to collide with. Restored once this block is done — steps 4/5/5b
       below depend on the ambient fixture's own three-back-to-back-quick-
       tasks shape, not this one. */
    const origEvents = await p.evaluate(()=>JSON.parse(JSON.stringify(EVENTS)));
    /* colorId 5 (short session), not 9 (quick) — two adjacent quick tasks
       now auto-merge into one shared brick event on a push (see CLAUDE.md),
       which replaces the update_event this check counts with
       create_event/delete_event instead. This scenario is about the push
       mechanism itself (moves both slots, not just the one dropped on),
       which sessions exercise identically without ever merging. */
    await p.evaluate(()=>{
      EVENTS.length = 0;
      EVENTS.push({ id:"hubEv", colorId:"5", summary:"🎵 Hub task",
        description:"[daisey] Hub task\n\nOriginal: https://trello.com/c/HUBHUBHU/1-x",
        start:{dateTime:"2026-08-17T09:00:00+03:00",timeZone:"Asia/Jerusalem"},
        end:{dateTime:"2026-08-17T09:15:00+03:00",timeZone:"Asia/Jerusalem"}, status:"confirmed" });
      EVENTS.push({ id:"rowEv", colorId:"5", summary:"🎵 Row task",
        description:"[daisey] Row task\n\nOriginal: https://trello.com/c/ROWROWRO/1-x",
        start:{dateTime:"2026-08-17T09:15:00+03:00",timeZone:"Asia/Jerusalem"},
        end:{dateTime:"2026-08-17T09:30:00+03:00",timeZone:"Asia/Jerusalem"}, status:"confirmed" });
      EVENTS.push({ id:"mtgEv", summary:"Standup",
        start:{dateTime:"2026-08-17T13:00:00+03:00",timeZone:"Asia/Jerusalem"},
        end:{dateTime:"2026-08-17T14:00:00+03:00",timeZone:"Asia/Jerusalem"}, status:"confirmed" });
      S.events = { payload:{ events:EVENTS }, storedAt:Date.now() };
      render();
    });
    await p.waitForTimeout(300);
    /* The hub card lives in #heroSlot (2026-08-26 hero redesign), and since
       2026-08-27 it's inside #scroller alongside #pageMain rather than a
       fixed sibling above it (user request: scrolling the list now carries
       the hero too) — so it can scroll off-screen same as any list row. The
       fixture's hero sits at the top of a short page here, so no
       scroll-into-view is needed for it in practice; the list row being
       dragged onto can genuinely sit off-screen on a tall fixture, so that
       half of the old scroll-fixup stays, now against #scroller. */
    await p.evaluate(()=>{
      const row=document.querySelector("#pageMain .rows.stack .item.stack:not(.current-marker-card):not(.meeting)"), host=document.querySelector("#scroller");
      if(row && host) host.scrollTop += row.getBoundingClientRect().top - host.getBoundingClientRect().top - 8;
    });
    const hubBox=await p.locator("#heroSlot .now").boundingBox();
    const rowBox=await p.locator("#pageMain .rows.stack .item.stack:not(.current-marker-card):not(.meeting)").first().boundingBox();
    if(hubBox && rowBox){
      const before=await p.evaluate(()=>window.__calls.filter(c=>c.tool==="update_event").length);
      await p.mouse.move(hubBox.x+hubBox.width/2, hubBox.y+20);
      await p.mouse.down();
      await p.waitForTimeout(200);   // wireStackDrag's ARM_MS hold before it arms the drag
      await p.mouse.move(hubBox.x+hubBox.width/2, rowBox.y+rowBox.height/2, {steps:8});
      await p.mouse.move(hubBox.x+hubBox.width/2, rowBox.y+rowBox.height/2, {steps:2});
      await p.mouse.up();
      await p.waitForTimeout(700);
      const after=await p.evaluate(()=>window.__calls.filter(c=>c.tool==="update_event").length);
      check(after-before===2,`dragging the hub onto the adjacent list row should push both slots (2 update_event calls), got ${after-before}`);
      const pushToast=await p.evaluate(()=>document.querySelector(".toast.undo .undo-msg")?.textContent||null);
      check(!!pushToast,"a completed push should show the undo popup");

      const beforeUndo=await p.evaluate(()=>window.__calls.filter(c=>c.tool==="update_event").length);
      await p.keyboard.press("Control+z");
      await p.waitForTimeout(700);
      const afterUndo=await p.evaluate(()=>window.__calls.filter(c=>c.tool==="update_event").length);
      check(afterUndo-beforeUndo===2,`Ctrl+Z on a push should undo both sides (2 more update_event calls), got ${afterUndo-beforeUndo}`);
    }else{
      check(false,"drag-to-reorder test setup: hub card or a list row wasn't found");
    }

    // dropping a task onto a meeting: no push should occur
    const meetingBox=await p.locator("#pageMain .rows.stack .item.stack.meeting").first().boundingBox();
    const rowBox2=await p.locator("#pageMain .rows.stack .item.stack:not(.current-marker-card):not(.meeting)").first().boundingBox();
    if(meetingBox && rowBox2){
      const before2=await p.evaluate(()=>window.__calls.filter(c=>c.tool==="update_event").length);
      await p.mouse.move(rowBox2.x+rowBox2.width/2, rowBox2.y+rowBox2.height/2);
      await p.mouse.down();
      await p.waitForTimeout(200);   // wireStackDrag's ARM_MS hold before it arms the drag
      await p.mouse.move(rowBox2.x+rowBox2.width/2, meetingBox.y+meetingBox.height/2, {steps:8});
      await p.mouse.up();
      await p.waitForTimeout(500);
      const after2=await p.evaluate(()=>window.__calls.filter(c=>c.tool==="update_event").length);
      check(after2===before2,"dropping a task onto a meeting should not push anything");
    }

    await p.evaluate((orig)=>{
      EVENTS.length = 0;
      EVENTS.push(...orig);
      S.events = { payload:{ events:EVENTS }, storedAt:Date.now() };
      render();
    }, origEvents);
    await p.waitForTimeout(300);
  }

  // 3. the centered date label is the "today" button — tapping it jumps
  //    S.anchor back to today from wherever it's pointed.
  //    (Week view, and its own drag/undo/collision/day-jump coverage that
  //    used to be steps 3-6 here, was removed outright 2026-08-26 — Daisey
  //    is day-only now. Nudge S.anchor off today by hand instead of
  //    reaching it via a since-removed week day-header tap, so this step
  //    still has a real "somewhere else" to jump back FROM.)
  await p.evaluate(()=>{ S.anchor = addDays(S.anchor, 3); syncCalendarWatch(); render(); });
  await p.waitForTimeout(300);
  await p.click("#dateWrap");
  await p.waitForTimeout(300);
  state=await p.evaluate(()=>({ isToday: S.anchor.toDateString() === new Date().toDateString() }));
  check(state.isToday,"tapping the date should jump S.anchor back to today");

  // 4. settings Cancel discards an in-progress color change
  await p.click("#setBtn");
  await p.waitForTimeout(300);
  const before2=await p.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue("--b-projects").trim());
  await p.evaluate(()=>{ document.querySelector(".col-in").value="#ff00ff";
    document.querySelector(".col-in").dispatchEvent(new Event("input")); });
  await p.waitForTimeout(150);
  const previewed=await p.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue("--b-projects").trim());
  check(previewed.toLowerCase()==="#ff00ff","color input should preview live");
  await p.click(".dialog .btn.quiet"); // Cancel is the first quiet button
  await p.waitForTimeout(200);
  const afterCancel=await p.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue("--b-projects").trim());
  check(afterCancel===before2,"Cancel should revert the previewed color");
  const persisted=await p.evaluate(()=>(S.stats.settings||{}).colors||{});
  check(!persisted.projects,"Cancel should not persist the color change");

  console.log("errors:", errs.length?errs:"none");
  console.log(bad.length ? "FAIL:\n  ✗ "+bad.join("\n  ✗ ") : "✓ all page/view/undo/picker/settings behaviours hold");
  await b.close();
  process.exit(bad.length+errs.length?1:0);
})();
