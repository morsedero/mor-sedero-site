/* A rebuild can leave real leftover time on the day — nothing candidate-
   sized fits it. That used to just be empty space. It should now become a
   real "Break" block: created on Google Calendar like any other Daisey
   block (so it's clearable/rebuildable and drag/reorder-able the same way
   as a task), but with no card behind it and none of
   Done/Swap/Pending/Remove. The block only claims CFG.breakLen minutes at
   the front of the leftover gap (default 60) — not the whole gap, which
   used to swallow hours of genuinely free time as if it were all "the
   break" whenever a rebuild happened to leave a wide-open stretch.
   Break's own azure gradient card is GONE (2026-08-25 redesign — every
   card type now shares one uniform look, sized only by real duration; see
   .item.bk-break's own CSS comment). What's asserted below changed with
   it: a break now reads as a plain --card-surface row like any other
   card, not a specially-painted one — the assertions that used to check
   "clearly bluer than a normal card" now check the opposite, "the same
   surface as a normal card." */

/* Every board's card list is overridden to empty (candidates() -> [],
   planFor's placed -> [] deterministically) so the only variable left is a
   single hand-placed real meeting — no dependency on the fixture's own
   cards, labels, due dates or desc-parsed estimates (which is what made an
   earlier version of this test wrong: a fixture card's "~120m" estimate
   happened to exactly fill the one window this test originally predicted). */
const fs=require("fs"),vm=require("vm");const {chromium}=require("playwright");
const H=fs.readFileSync(__dirname+"/harness.js","utf8");
const page_html=fs.readFileSync(__dirname+"/daisey.html","utf8");
const sb={require,__dirname,module:{exports:{}},exports:{},console,process};
vm.runInNewContext(H.split("(async () => {")[0]+"\nmodule.exports={stub};",sb);
const stub=sb.module.exports.stub;

const ev = (id, summary, s, e) => ({
  id, summary,
  start:{dateTime:`2026-08-14T${s}:00+03:00`,timeZone:"Asia/Jerusalem"},
  end:{dateTime:`2026-08-14T${e}:00+03:00`,timeZone:"Asia/Jerusalem"},
  status:"confirmed"
});
/* a second meeting later in the day gives the 11:00-... gap something on
   the other side of it (a real break, not "the day is done") while the
   stretch after 15:00 has nothing after it at all and must NOT grow a
   break block — see the breakGaps() comment on trailing gaps. */
const EVENTS = [ ev("meet1","Standup","09:00","11:00"), ev("meet2","Sync","14:00","15:00") ];

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
    for(const b of BOARDS) S.cards[b.key] = { payload:{ cards:{ nodes:[] } } };
    EVENTS.length=0; EVENTS.push(...JSON.parse(JSON.stringify(events)));
    S.events = { payload:{ events:EVENTS }, storedAt:Date.now() };
    render();
  }, EVENTS);
  await p.waitForTimeout(300);

  const pre = await p.evaluate(()=>{
    const date = startOfDay(new Date());
    const ignore = new Set();
    const placed = planFor(date,"normal",null,ignore);
    return { candidates: candidates(date).length, placed, gaps: breakGaps(date, ignore, placed) };
  });
  check(pre.candidates===0, `card override should leave zero candidates, got ${pre.candidates}`);
  check(pre.placed.length===0, `with zero candidates, planFor should place nothing, got ${JSON.stringify(pre.placed)}`);
  check(pre.gaps.length===1 && pre.gaps[0].s===660 && pre.gaps[0].e===720,
    `expected one 11:00–12:00 break (660–720 min, capped to the 60min default breakLen) between the two meetings, got ${JSON.stringify(pre.gaps)}`);
  check(!pre.gaps.some(g=>g.e>=1200),
    `the stretch after 15:00 has nothing after it and must not become a break (day is just done), got ${JSON.stringify(pre.gaps)}`);

  /* boot's own auto-plan has already run against the fixture by now and may
     legitimately have made a break of its own — the counts below are about
     THIS rebuild, so the call log is cleared first rather than asserting on
     a total that includes boot's work. */
  await p.evaluate(()=>{ window.__calls.length = 0; });
  await p.evaluate(()=>{ applyPlan(startOfDay(new Date()), "normal", null, true); });
  await p.waitForTimeout(1000);

  const breakCalls = await p.evaluate(()=>
    window.__calls.filter(c=>c.tool==="create_event" && c.input.colorId==="7"));
  check(breakCalls.length===1, `expected exactly one break create_event, got ${breakCalls.length}: ${JSON.stringify(breakCalls.map(c=>c.input))}`);
  if(breakCalls.length){
    check(breakCalls[0].input.description==="[daisey] Break", `break description should be the plain DF_MARK, got ${JSON.stringify(breakCalls[0].input.description)}`);
  }

  const breaks = await p.evaluate(()=>
    allEvents().filter(e=>e.isBreak).map(e=>({s:minsOf(e.start),e:minsOf(e.end),isTask:e.isTask,cardShort:e.cardShort})));
  check(breaks.length===1, `expected exactly one isBreak event after refresh, got ${breaks.length}`);
  if(breaks.length){
    check(breaks[0].s===660 && breaks[0].e===720, `break should span 11:00–12:00 (660–720 min, capped to breakLen), got ${JSON.stringify(breaks[0])}`);
    check(breaks[0].isTask===true, "a break must still be isTask (mine) so it's clearable/rebuildable like any Daisey block");
    check(!breaks[0].cardShort, "a break must never resolve a card");
  }

  const row = await p.evaluate(()=>{
    const el = [...document.querySelectorAll(".item.stack")].find(n=>n.classList.contains("bk-break"));
    if(!el) return null;
    return {
      title: (el.querySelector(".n") || {}).textContent || "",
      hasActs: !!el.querySelector(".acts-inline"),
      hasCardLink: !!el.querySelector(".card-link"),
      hasDone: !!el.querySelector(".mini.ok"),
      hasSwap: !!el.querySelector(".mini.swap"),
      hasPending: !!el.querySelector(".mini.pend"),
      hasRemove: !!el.querySelector(".mini.del"),
      background: getComputedStyle(el).backgroundColor,
      backgroundImage: getComputedStyle(el).backgroundImage,
      meta: (()=>{const m=el.querySelector(".row-meta");
        return m?{h:Math.round(m.getBoundingClientRect().height),
                  txt:m.textContent.trim()}:null;})(),
      ntFont: (()=>{const t=el.querySelector(".nt");
        return t?{font:getComputedStyle(t).fontFamily.split(",")[0],
                  size:getComputedStyle(t).fontSize}:"no .nt";})(),
      /* The label is the title AND the time together — measure the group's
         own centre against the card's, not the title alone (which sits
         above the time by design). */
      centring: (()=>{const n=el.querySelector(".n"), m=el.querySelector(".row-meta");
        if(!n) return null;
        const nb=n.getBoundingClientRect(), eb=el.getBoundingClientRect();
        const mb=m?m.getBoundingClientRect():nb;
        const top=Math.min(nb.top,mb.top), bot=Math.max(nb.bottom,mb.bottom);
        return {dxCentre:Math.round((nb.left+nb.right)/2-(eb.left+eb.right)/2),
                dyGroup:Math.round((top+bot)/2-(eb.top+eb.bottom)/2),
                size:getComputedStyle(el.querySelector(".nt")||n).fontSize};})(),
      box: (b=>({x:b.x,y:b.y,w:b.width,h:b.height}))(el.getBoundingClientRect())
    };
  });
  /* Sampled off-centre for parity with the pre-redesign version of this
     test (the ::after corner highlight it was avoiding is gone along with
     the gradient, but the same sample point still works fine against a
     flat --card surface). */
  if(row){
    const shot = await p.screenshot({clip:{
      x:Math.round(row.box.x+row.box.w*0.55), y:Math.round(row.box.y+row.box.h*0.6),
      width:2, height:2}});
    row.pixel = await p.evaluate(async b64=>{
      const img=new Image(); img.src="data:image/png;base64,"+b64;
      await img.decode();
      const c=document.createElement("canvas"); c.width=c.height=1;
      c.getContext("2d").drawImage(img,0,0);
      const d=c.getContext("2d").getImageData(0,0,1,1).data;
      return {r:d[0],g:d[1],b:d[2],a:d[3]};
    }, shot.toString("base64"));
  }
  check(!!row, "the break should render as a .item.stack.bk-break row in the later list");
  if(row){
    check(row.title.trim().startsWith("Break"), `break row title should read "Break", got ${JSON.stringify(row.title)}`);
    check(!row.hasActs, "a break row must not render any acts-inline (Done/Swap/Pending/Remove) block at all");
    check(!row.hasCardLink, "a break row must not carry the ↗ Trello card link");
    check(!row.hasDone && !row.hasSwap && !row.hasPending && !row.hasRemove, "a break row must not expose Done/Swap/Pending/Remove individually");
    /* Every card (Break included, since 2026-08-25) gets the same neutral
       --card surface with just a coloured spine — no more special azure
       paint for Break specifically (see the CSS comment by .item.bk-break).
       Checked as "opaque, and not noticeably bluer than a neutral surface",
       the mirror image of the old assertion, so a real regression back to
       a tinted/gradient fill would still be caught. */
    const px = row.pixel || {r:0,g:0,b:0,a:0};
    const paint = `pixel ${JSON.stringify(px)} (bg ${row.background}, img ${row.backgroundImage.slice(0,60)})`;
    check(px.a === 255, `a break card must be opaque or the hour grid lines show through it, got ${paint}`);
    check(row.backgroundImage === "none", `a break card should have no gradient/background-image any more, got ${paint}`);
    check(px.b - px.r < 15, `a break card should read as the same neutral surface as any other card, not tinted azure, got ${paint}`);
  }

  const openHasBreak = await p.evaluate(()=>splitAgenda().open.some(i=>i.isBreak));
  check(openHasBreak===false, "a break must never count as open/outstanding work (hub eligibility / progress pill)");

  console.log("[brk]", JSON.stringify({breakCalls:breakCalls.map(c=>c.input), breaks, row}));
  console.log(bad.length ? "FAIL:\n  ✗ "+bad.join("\n  ✗ ")
                         : "✓ a leftover gap becomes exactly one real, uniformly-styled, action-free Break block");
  await b.close();
  process.exit(bad.length?1:0);
})();
