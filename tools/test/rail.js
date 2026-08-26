/* The Day-view time rail.
 *
 * Two things this guards, both of which failed silently before:
 *
 *  1. The rail shows a START, not a range. It used to print
 *     "11:30–12:30" per row into a 44px column — which wrapped onto two
 *     lines, and for a quick-task brick printed the *event's* whole span on
 *     every sibling, so four tasks each claimed the full hour. The times a
 *     brick's siblings show must be their own consecutive slices.
 *  2. A press-and-hold on a card is a drag, never a text selection.
 *     wireStackDrag waits ARM_MS before capturing the pointer (so a swipe can
 *     still scroll), and during that gap the browser is free to start its own
 *     long-press text selection — which wins the gesture and leaves the card
 *     unmovable with a blue highlight over its title. user-select:none on the
 *     card surface is the whole fix, so it's worth asserting it's still there.
 */
const fs=require("fs"),vm=require("vm");const {chromium}=require("playwright");
const H=fs.readFileSync(__dirname+"/harness.js","utf8");
const page_html=fs.readFileSync(__dirname+"/daisey.html","utf8");
const sb={require,__dirname,module:{exports:{}},exports:{},console,process};
vm.runInNewContext(H.split("(async () => {")[0]+"\nmodule.exports={stub};",sb);
const stub=sb.module.exports.stub.replace(/const DAY = [^;]+;/,'const DAY = "2026-08-17";');
const clock=t=>`const R=Date;const O=new R("${t}").getTime()-R.now();
window.Date=class extends R{constructor(...a){if(a.length===0)super(R.now()+O);else super(...a);}static now(){return R.now()+O;}};`;

(async()=>{
  const b=await chromium.launch({});
  const ctx=await b.newContext({viewport:{width:390,height:1000},timezoneId:"Asia/Jerusalem"});
  const p=await ctx.newPage();const errs=[];
  p.on("pageerror",e=>errs.push(e.message));
  p.on("console",m=>{if(m.type()==="error")errs.push(m.text());});
  await p.setContent(`<!doctype html><html><head><meta charset="utf-8"><script>${clock("2026-08-17T11:30:00+03:00")}${stub}<\/script></head><body>${page_html}</body></html>`,{waitUntil:"load"});
  await p.waitForTimeout(3400);
  await p.evaluate(()=>{document.querySelectorAll(".scrim").forEach(s=>s.remove());});
  await p.waitForTimeout(200);

  const bad=[];
  const r=await p.evaluate(()=>[...document.querySelectorAll(".rail-stop")].map(s=>({
    h:(s.querySelector(".t")||{}).textContent,
    m:(s.querySelector(".tm")||{}).textContent,
    oclock:!!s.querySelector(".tm.oclock"),
    brick:s.classList.contains("brick"),
    sub:s.classList.contains("brick-sub"),
    title:s.title,
    text:s.textContent
  })));
  console.log("rail:", r.map(x=>x.h+":"+x.m).join(" · "));

  if(r.length<4) bad.push(`expected several rail stops, got ${r.length}`);
  /* No row may print a range any more — that's the whole redesign. */
  for(const s of r) if(/[–]/.test(s.text)) bad.push(`a rail stop still prints a range: "${s.text}"`);
  /* every stop reads as a zero-padded hh:mm, same shape as weekGrid's labels */
  for(const s of r){
    if(!/^\d{2}$/.test(s.h||"")) bad.push(`hour not zero-padded 2 digits: "${s.h}"`);
    if(!/^:\d{2}$/.test(s.m||"")) bad.push(`minutes should read ":mm": "${s.m}"`);
  }

  const bricks=r.filter(x=>x.brick);
  if(bricks.length<2) bad.push(`expected a multi-task brick in the fixture, got ${bricks.length}`);
  const starts=bricks.map(x=>x.h+x.m);
  if(new Set(starts).size!==starts.length)
    bad.push("brick siblings repeat the same time — they must each show their own slice: "+starts.join(","));
  if(bricks[0]&&bricks[0].sub) bad.push("the first brick stop must not be subordinate");
  if(bricks.slice(1).some(x=>!x.sub)) bad.push("later brick stops must all be subordinate");
  /* the full range survives as a tooltip, so nothing is actually lost */
  if(bricks[0]&&!/–/.test(bricks[0].title||"")) bad.push("a rail stop lost its full-range title");
  console.log(`brick run              : ${starts.join(" → ")} (titles carry full ranges)`);

  /* --- the selection fix --- */
  const sel=await p.evaluate(()=>{
    const card=document.querySelector(".item.stack");
    const rail=document.querySelector(".rail-stop");
    const det=document.querySelector(".item.stack .details");
    const us=el=>el?getComputedStyle(el).userSelect||getComputedStyle(el).webkitUserSelect:null;
    return { card:us(card), rail:us(rail), details:det?us(det):"(none rendered)" };
  });
  console.log(`user-select            : card=${sel.card} rail=${sel.rail} details=${sel.details}`);
  if(sel.card!=="none") bad.push(`a card must not be selectable (long-press would text-select instead of dragging), got "${sel.card}"`);
  if(sel.rail!=="none") bad.push(`the rail must not be selectable, got "${sel.rail}"`);
  if(sel.details!=="(none rendered)" && sel.details!=="text")
    bad.push(`an expanded card's details should stay selectable, got "${sel.details}"`);

  /* A press-and-hold must still actually arm a drag — the point of
     user-select:none is that the hold reaches wireStackDrag at all.
     Note the class is `stack-dragging` (Day-list reorder), NOT `dragging`
     (that's Week-view's separate pixel-grid drag, wireItemDrag) — and the
     drag only engages once the pointer passes onMove's 8px threshold, so
     holding alone is deliberately not enough.
     Aim at a non-hub row's title: `eligible` excludes .mini/.details/a, and
     the hub renders its action buttons across the middle of the card. */
  const rows=await p.evaluate(()=>[...document.querySelectorAll(".item.stack")]
    .map(el=>({hub:el.classList.contains("hub"),has:!!el.dataset.rowId})));
  /* A long card is now genuinely sized to its real clock height at build
     time (2026-08-25 redesign: every .time-row's top/height come straight
     from its own start/duration — see timelineItem/buildDayScale — there is
     no more after-the-fact sizeCardToDuration pass to poke). The bottom
     line (time chip + action buttons) must stay pinned to the card's bottom
     rather than floating mid-card with dead space under it, and must not be
     clipped away by .item's overflow:hidden. Both have been real bugs; this
     opens a 3h session card (which the fixture doesn't otherwise have) to
     drive a real long row through the same code path the day view uses. */
  const longCard = await p.evaluate(()=>{
    const r = [...document.querySelectorAll(".time-row")].find(x=>+x.dataset.dur >= 179);
    if(!r) return null;
    const sec=r.closest("[data-ppm]"), ppm=+sec.dataset.ppm;
    const c=r.querySelector(".item.stack"), cb=c.getBoundingClientRect();
    const m=c.querySelector(".row-meta"), mb=m ? m.getBoundingClientRect() : null;
    return {cardH:Math.round(cb.height), wantH:Math.round((+r.dataset.dur)*ppm),
      gapBelowMeta: mb ? Math.round(cb.bottom-mb.bottom) : 0,
      acts:[...c.querySelectorAll(".mini")].map(b=>b.textContent.trim()),
      clipped:c.scrollHeight>Math.round(cb.height)+1};
  });
  if(!longCard){
    console.log("long card              : (fixture has no session-length card — skipped)");
  }else{
    if(Math.abs(longCard.cardH-longCard.wantH)>1)
      bad.push(`a 3h card should cover its 3 hours (${longCard.wantH}px), got ${longCard.cardH}px`);
    if(longCard.gapBelowMeta>2)
      bad.push(`the bottom line should sit on the card's bottom, found ${longCard.gapBelowMeta}px of space under it`);
    if(longCard.clipped)
      bad.push("a grown card clips its own content — overflow:hidden is eating the bottom line");
    for(const b of ["⏱","▾"])
      if(!longCard.acts.includes(b)) bad.push(`the ${b} button is missing from an open card: ${JSON.stringify(longCard.acts)}`);
  }
  const idx=rows.findIndex(r=>!r.hub&&r.has);
  if(idx<0) bad.push("no draggable non-hub row in the fixture");
  else{
    const box=await p.locator(".item.stack").nth(idx).boundingBox();
    const tx=box.x+box.width*0.55, ty=box.y+12;
    await p.mouse.move(tx,ty);
    await p.mouse.down();
    await p.waitForTimeout(260);
    const armedEarly=await p.evaluate(()=>!!document.querySelector(".item.stack.stack-dragging"));
    await p.mouse.move(tx,ty+80,{steps:10});
    await p.waitForTimeout(150);
    const dragging=await p.evaluate(()=>!!document.querySelector(".item.stack.stack-dragging"));
    const selected=await p.evaluate(()=>String(getSelection?getSelection().toString():""));
    await p.mouse.up();
    await p.waitForTimeout(500);
    console.log(`press-and-hold         : hold-only=${armedEarly?"engaged":"idle"} after-move=${dragging?"dragging":"NOT dragging"} selectedText=${JSON.stringify(selected)}`);
    if(armedEarly) bad.push("a hold with no movement already engaged the drag — a tap would move cards");
    if(!dragging) bad.push("press-and-hold then move no longer drags the card");
    if(selected) bad.push(`the hold selected text instead of dragging: ${JSON.stringify(selected)}`);
  }

  await ctx.close();

  /* --- REAL TOUCH. This is the one that matters. ------------------------
     The mouse path above passed for a build in which touch dragging was
     completely broken, so it proves very little on its own. `touch-action:
     pan-y` on .item.stack means the browser owns vertical panning: on a real
     touch device it claimed the gesture on the first move and fired
     pointercancel, killing every drag. wireStackDrag now preventDefault()s
     touchmove once the hold has armed, which is the only thing that takes
     the gesture back.
     Needs hasTouch + CDP-dispatched touch events; Playwright's mouse API
     will not reproduce it. */
  const tctx=await b.newContext({viewport:{width:390,height:560},timezoneId:"Asia/Jerusalem",hasTouch:true,isMobile:true});
  const tp=await tctx.newPage();
  tp.on("pageerror",e=>errs.push(e.message));
  await tp.setContent(`<!doctype html><html><head><meta charset="utf-8"><script>${clock("2026-08-17T11:30:00+03:00")}${stub}<\/script></head><body>${page_html}</body></html>`,{waitUntil:"load"});
  await tp.waitForTimeout(3400);
  /* Toasts too, not just scrims: .toasts is a fixed strip across the bottom
     of the screen, and a real toast inside it is legitimately clickable
     (pointer-events:auto, so it can be dismissed). On a 560px phone that
     strip sits exactly where the lower cards are, so a touch aimed at a card
     lands on the toast instead and the gesture never reaches the card. */
  await tp.evaluate(()=>{document.querySelectorAll(".scrim").forEach(s=>s.remove());const tz=document.querySelector(".toasts");if(tz)tz.style.display="none";});
  const trows=await tp.evaluate(()=>[...document.querySelectorAll(".item.stack")]
    .map(el=>({hub:el.classList.contains("hub"),has:!!el.dataset.rowId})));
  const tidx=trows.findIndex(x=>!x.hub&&x.has);
  const cdp=await tctx.newCDPSession(tp);

  if(tidx<0) bad.push("no draggable non-hub row for the touch test");
  else{
    /* Scroll it into view first. Since the Day view went onto a real hour
       grid the hub renders inside the list rather than above it, and rows
       are anchored to their true start minute — so on a 560px phone the
       first draggable card sits well below the fold. A CDP touch at an
       off-screen y lands on nothing, and every touch assertion below fails
       for a reason that has nothing to do with what they test. */
    await tp.locator(".item.stack").nth(tidx).scrollIntoViewIfNeeded();
    await tp.waitForTimeout(250);
    const tbox=await tp.locator(".item.stack").nth(tidx).boundingBox();
    const x=Math.round(tbox.x+tbox.width*0.55), y=Math.round(tbox.y+12);

    /* (a) press-and-hold then move = drag, and NO pointercancel */
    await tp.evaluate(()=>{window.__c=0;document.addEventListener("pointercancel",()=>window.__c++,true);});
    await cdp.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x,y}]});
    await tp.waitForTimeout(320);
    for(let i=1;i<=6;i++){await cdp.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x,y:y+i*12}]});await tp.waitForTimeout(25);}
    const tdrag=await tp.evaluate(()=>({drag:!!document.querySelector(".item.stack.stack-dragging"),cancels:window.__c}));
    await cdp.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});
    await tp.waitForTimeout(500);
    console.log(`touch hold-drag        : dragging=${tdrag.drag} pointercancels=${tdrag.cancels}`);
    if(!tdrag.drag) bad.push("TOUCH: press-and-hold + move did not drag the card");
    if(tdrag.cancels) bad.push(`TOUCH: the browser stole the gesture (${tdrag.cancels} pointercancel) — touchmove isn't being prevented once armed`);

    /* (b) a prompt swipe must still scroll the list and must NOT drag.
       .page is the scroller — html/body are overflow:hidden, so window
       scroll stays 0 no matter what and is useless to assert on. */
    /* scrollTop=0 no longer guarantees anything is on-screen: true-to-scale
       positioning + empty-gap compression (2026-08-25 redesign) mean the
       whole fixture's schedule can sit well down the page even at the very
       top of the scroller (this fixture's own first card starts well past
       650px at scrollTop 0 — confirmed directly).
       Scroll to the MIDDLE of the available scroll range, not to a specific
       row's centred position (2026-08-26 hero redesign): the hero now
       occupies real vertical space above the scroller, shrinking this
       fixture's own timeline enough that its rows sit close together near
       the bottom of a short scroll range — centering on tidx's row (which
       happens to sit near the list's end in this fixture) landed scrollTop
       already pinned at its true max, confirmed live, leaving zero room for
       the swipe's own 144px pull no matter how much clamp headroom was
       subtracted. Range-based centering sidesteps row position entirely —
       this half of the test only needs "a real touch point inside the
       scroller with room both ways," not that specific card, so the touch
       point is the viewport's own centre instead of a card's box. */
    await tp.evaluate(()=>{
      const page=document.querySelector(".page");
      page.scrollTop = Math.round((page.scrollHeight - page.clientHeight)/2);
    });
    await tp.waitForTimeout(150);
    const pbox=await tp.locator(".page").boundingBox();
    const sx=Math.round(pbox.x+pbox.width*0.55), sy=Math.round(pbox.y+pbox.height/2);
    const before=await tp.evaluate(()=>document.querySelector(".page").scrollTop);
    const room=Math.min(before, 144);   // only need enough real scroll room for the swipe's own 144px pull
    await cdp.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x:sx,y:sy}]});
    for(let i=1;i<=8;i++){await cdp.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x:sx,y:sy-i*18}]});await tp.waitForTimeout(12);}
    const swipeDragged=await tp.evaluate(()=>!!document.querySelector(".item.stack.stack-dragging"));
    await cdp.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});
    await tp.waitForTimeout(500);
    const after=await tp.evaluate(()=>document.querySelector(".page").scrollTop);
    console.log(`touch swipe            : scrollTop ${before}->${after} (room ${room}px) dragged=${swipeDragged}`);
    if(room > 20 && after <= before) bad.push("TOUCH: a prompt swipe no longer scrolls the list");
    if(swipeDragged) bad.push("TOUCH: a prompt swipe dragged a card instead of scrolling");
  }

  console.log("page errors:",errs.length?errs.join(" | "):"none");
  console.log(bad.length?"FAIL:\n  x "+bad.join("\n  x "):"OK rail: week-style gutter, brick slices distinct, touch drags and swipes both work");
  await b.close();
  process.exit(bad.length+errs.length?1:0);
})();
