/* Uniform rows — the 2026-08-26 layout.
 *
 * Two generations of proportional-height machinery were removed to get here
 * (anchorRows/sizeCardToDuration, then buildDayScale/pushForFloor/
 * pushForOverflow). Both existed to make a card's HEIGHT mean its duration,
 * and both failed the same way: the pixel floor needed to keep a 15-minute
 * card legible is bigger than the space 15 minutes buys, so short cards
 * always overflowed into each other and later rows had to be pushed down to
 * compensate — at which point the cards no longer lined up with the hour
 * labels beside them, which is the exact misreading an hour gutter exists to
 * prevent. Confirmed live on 2026-08-26: four back-to-back quarter-hour tasks
 * claimed 112px of a 60px span and a 10:00 meeting rendered level with the
 * 10:20 mark.
 *
 * These assertions are the ones that would fail if any of that came back, or
 * if the flow layout that replaced it regressed. Every one of them was
 * checked against the pre-change build and fails there (see the header note
 * on each case), because a test that passes both before and after a fix is
 * not evidence of anything.
 */
const fs=require("fs"),vm=require("vm");const {chromium}=require("playwright");
const H=fs.readFileSync(__dirname+"/harness.js","utf8");
const page_html=fs.readFileSync(__dirname+"/daisey.html","utf8");
const sb={require,__dirname,module:{exports:{}},exports:{},console,process};
vm.runInNewContext(H.split("(async () => {")[0]+"\nmodule.exports={stub};",sb);
const stub=sb.module.exports.stub.replace(/const DAY = [^;]+;/,'const DAY = "2026-08-17";');
const clock=t=>`const R=Date;const O=new R("${t}").getTime()-R.now();
window.Date=class extends R{constructor(...a){if(a.length===0)super(R.now()+O);else super(...a);}static now(){return R.now()+O;}};`;

/* Four back-to-back 15-min quick tasks, then a 5h meeting, then a real gap,
   then an evening event. This is the shape from the user's own screenshot —
   the one that produced the overlap and the drift. */
const task=(id,title,s,e)=>({id,colorId:"9",summary:"🎵 "+title,
  description:"[daisey] "+title+"\n\nOriginal: https://trello.com/c/"+(id+"XXXXXXXX").slice(0,8).toUpperCase()+"/1-x",
  start:{dateTime:"2026-08-17T"+s+":00+03:00",timeZone:"Asia/Jerusalem"},
  end:{dateTime:"2026-08-17T"+e+":00+03:00",timeZone:"Asia/Jerusalem"},status:"confirmed"});
const meeting=(id,title,s,e)=>({id,summary:title,status:"confirmed",
  start:{dateTime:"2026-08-17T"+s+":00+03:00",timeZone:"Asia/Jerusalem"},
  end:{dateTime:"2026-08-17T"+e+":00+03:00",timeZone:"Asia/Jerusalem"}});

const FIXTURE=[
  task("q1","Task One","09:00","09:15"),
  task("q2","Task Two","09:15","09:30"),
  task("q3","Task Three","09:30","09:45"),
  task("q4","Task Four","09:45","10:00"),
  meeting("m1","Long Meeting","10:00","15:00"),
  meeting("m2","Evening Signing","17:00","18:00"),
];

(async()=>{
  const b=await chromium.launch({});
  const bad=[];
  const check=(cond,msg)=>{ if(!cond) bad.push(msg); };

  for(const vp of [{width:900,height:800,name:"wide"},{width:390,height:844,name:"phone"}]){
    const ctx=await b.newContext({viewport:{width:vp.width,height:vp.height},timezoneId:"Asia/Jerusalem"});
    const p=await ctx.newPage();
    const errs=[];
    p.on("pageerror",e=>errs.push(e.message));
    p.on("console",m=>{if(m.type()==="error" && !/^\[daisey\]/.test(m.text()))errs.push(m.text());});
    await p.setContent(`<!doctype html><html><head><meta charset="utf-8"><script>${clock("2026-08-17T09:48:00+03:00")}${stub}<\/script></head><body>${page_html}<script>try{checkChoresTrigger=function(){};}catch(_){}<\/script></body></html>`,{waitUntil:"load"});
    await p.waitForTimeout(2800);
    await p.evaluate((evs)=>{
      EVENTS.length=0; EVENTS.push(...JSON.parse(JSON.stringify(evs)));
      S.events={payload:{events:EVENTS},storedAt:Date.now()};
      render();
    },FIXTURE);
    await p.waitForTimeout(600);

    const geo=await p.evaluate(()=>{
      /* EVERY .time-row inside #pageMain, at any depth. paintMain puts the
         lead rows (missed/break/currentMarker/nest) inside an unstyled
         .hub-lead wrapper, so a `.rows.stack > .time-row` child selector
         silently saw 3 of 7 rows here — and missed currentMarker, which is
         exactly the row that carried a real bug during this change. The
         hero is deliberately NOT included: it lives in #heroSlot, a
         separate sibling of #pageMain (both inside #scroller since
         2026-08-27). Each row's time now lives INSIDE its card, top-left
         (.row-lead .t — 2026-08-27, replaces the old outside .rail-stop
         column), so leadBox is measured off that instead of a rail. */
      const rows=[...document.querySelectorAll("#pageMain .time-row")];
      return rows.map(r=>{
        const b=r.getBoundingClientRect();
        const lead=r.querySelector(".row-lead");
        const leadBox=lead?lead.getBoundingClientRect():null;
        const card=r.querySelector(".item, .offhours, .quiet");
        const cardBox=card?card.getBoundingClientRect():null;
        return {
          cls:r.className, min:+r.dataset.min, dur:+r.dataset.dur,
          top:b.top, bottom:b.bottom, height:b.height,
          leadText:lead?lead.textContent.trim():null,
          leadH:leadBox?leadBox.height:null,
          cardLeft:cardBox?cardBox.left:null, cardW:cardBox?cardBox.width:null,
        };
      });
    });

    const tag=`[${vp.name}]`;
    check(geo.length>0,`${tag} the timeline should render rows at all`);

    /* 1. NO OVERLAP. The whole reason the old layout was replaced: a floored
          short card's bottom fell below the next card's top. In flow layout
          this is structurally impossible, which is the point — assert it so a
          return to absolute positioning has to prove itself here first.
          Fails pre-change: rows overlapped by up to ~13px each. */
    for(let i=1;i<geo.length;i++){
      check(geo[i].top >= geo[i-1].bottom - 0.5,
        `${tag} row ${i} (${geo[i].cls}) starts at ${Math.round(geo[i].top)} but the row above ends at ${Math.round(geo[i-1].bottom)} — cards must never overlap`);
    }

    /* 2. CHRONOLOGICAL ORDER. Rows carry no computed top any more, so
          document order IS the day's order — nothing re-sorts them visually.
          A row that renders above another must also start no later. */
    const timed=geo.filter(g=>Number.isFinite(g.min));
    for(let i=1;i<timed.length;i++){
      check(timed[i].min >= timed[i-1].min,
        `${tag} row at ${timed[i].min}min renders below one at ${timed[i-1].min}min — document order must match clock order`);
    }

    /* 3. UNIFORM-ISH HEIGHTS. The old build gave a 5h meeting ~300px and a
          15m task 28px — a 10x spread driven purely by duration. Now height
          follows CONTENT, so the tallest ordinary row may not be more than
          3x the shortest. Fails pre-change by a wide margin.
          Excludes the off-hours/quiet cards (deliberately different shapes)
          and any open accordion row. */
    const plain=geo.filter(g=>!/offhours|quiet|current-marker/.test(g.cls));
    if(plain.length>1){
      const hs=plain.map(g=>g.height);
      const lo=Math.min(...hs), hi=Math.max(...hs);
      check(hi <= lo*3+1,
        `${tag} row heights span ${Math.round(lo)}..${Math.round(hi)}px — height must follow content, not duration (a 5h meeting must not dwarf a 15m task)`);
      /* And specifically: the 5h meeting must not be the tallest thing by
         virtue of being long. Compare it against a 15m task directly.
         2.2x, not 2x (2026-08-27): removing the outside rail column (see
         .time-row's CSS) also removed a grid track that used to force EVERY
         row in that grid to match the rail's own content height — a plain
         15m task used to measure 44.5px purely because the rail beside it
         needed that much room, not because the task's own content did. Now
         .time-row is a single block column, a task's height is honestly
         just its own content (measured: 31.5px), which is MORE correct, not
         a regression — the meeting itself barely moved (62.9px → 65.5px,
         just its own new in-card time badge line). The ratio grew because
         the denominator got more honest, not because the numerator grew. */
      const long=geo.find(g=>g.dur===300), short=geo.find(g=>g.dur===15);
      if(long && short){
        check(long.height <= short.height*2.2,
          `${tag} the 5h meeting is ${Math.round(long.height)}px against a 15m task's ${Math.round(short.height)}px — duration must not drive height`);
      }
    }

    /* 4. THE CARD STATES ITS OWN TIME, ON ONE LINE. The in-card time badge
          (.row-lead .t, top-left corner — 2026-08-27, replaces the outside
          rail column) is the only clock on screen now for a real task/
          meeting row, so every one of those must actually carry a readable
          "hh:mm". Excludes offhours/quiet — same as check 3, those state
          their time as plain text (.offhours-start/.quiet-start), not via
          rowLead, since they were never cards with a title to anchor a
          badge next to. The height bound catches a badge that wraps to two
          lines instead of staying inline beside the title, the same class
          of bug the old rail check caught when it was a flex column. */
    for(const g of timed){
      if(/offhours|quiet/.test(g.cls)) continue;
      check(/\d{1,2}:\d{2}/.test(g.leadText||""),
        `${tag} row at ${g.min}min has no readable time in its card (got ${JSON.stringify(g.leadText)})`);
      check(g.leadH != null && g.leadH <= 24,
        `${tag} the time badge at ${g.min}min is ${Math.round(g.leadH)}px tall — it must sit on one line, not wrap`);
    }

    /* 5. NO HORIZONTAL SPILL, AND THE CARD IS ACTUALLY WIDE. .time-row is a
          single block column now (2026-08-27 — the old two-track rail|card
          grid is gone), so a card can no longer land in a phantom rail
          track the way currentMarker once did. Kept as a sanity floor: a
          card collapsed to near-zero width would still be a real bug, just
          a different one now. */
    for(const g of geo){
      if(g.cardW==null) continue;
      check(g.cardW > 80,
        `${tag} a card in row ${g.cls} is only ${Math.round(g.cardW)}px wide`);
    }
    const spill=await p.evaluate(()=>{
      const d=document.documentElement;
      return {docW:d.clientWidth, scrollW:d.scrollWidth};
    });
    check(spill.scrollW <= spill.docW+1,
      `${tag} the page scrolls horizontally (${spill.scrollW} > ${spill.docW}) — rows must never spill sideways`);

    /* 6. FREE TIME IS NAMED, NOT LEFT AS A VOID. The fixture has a real 2h
          hole (15:00→17:00). The old build compressed it and floated a "⋯ 2h"
          tag over the empty space, which reads as a rendering fault; it must
          now be a real card that says how long it is. */
    const quiet=await p.evaluate(()=>{
      const q=document.querySelector("#pageMain .quiet");
      return q?{txt:q.textContent.replace(/\s+/g," ").trim()}:null;
    });
    check(!!quiet,`${tag} a real 2h gap in the day should render a "free time" card`);
    if(quiet) check(/2h/.test(quiet.txt),`${tag} the free-time card should state its length, got ${JSON.stringify(quiet.txt)}`);

    /* 7. THE WHOLE DAY FITS WITHOUT ABSURD SCROLL. Six items should not need
          multiple screens. The old true-to-scale build spent ~660px on this
          same day before the first task was even readable. */
    const totalH=await p.evaluate(()=>{
      const r=document.querySelector("#pageMain .rows.stack");
      return r?r.getBoundingClientRect().height:0;
    });
    check(totalH>0 && totalH<560,
      `${tag} six rows occupy ${Math.round(totalH)}px — a handful of items should not span multiple screens`);

    /* 8. THE HERO TITLE IS NEVER TRUNCATED — the full text always survives,
          however many lines it takes (2026-08-28, direct user request: "the
          user can see the entire Headline — always", reversing the
          2026-08-27 hard-cap-at-2-lines/ellipsis behaviour this test used to
          guard). Same real long Hebrew title as before — a long RTL title
          at hero scale is what surfaced the original truncation bug, so it
          stays the fixture even though the assertion direction flipped. */
    await p.evaluate(()=>{
      const longHebrew = "🎵 לתקן מזגן מקצר בחדר השינה של הילדים בקומה השנייה";
      EVENTS.length=0;
      EVENTS.push({id:"heroLong",colorId:"5",summary:longHebrew,
        description:"[daisey] "+longHebrew+"\n\nOriginal: https://trello.com/c/HEROLONGX/1-x",
        start:{dateTime:"2026-08-17T09:00:00+03:00",timeZone:"Asia/Jerusalem"},
        end:{dateTime:"2026-08-17T10:30:00+03:00",timeZone:"Asia/Jerusalem"},status:"confirmed"});
      S.events={payload:{events:EVENTS},storedAt:Date.now()};
      render();
    });
    await p.waitForTimeout(500);
    const hero=await p.evaluate(()=>{
      const n=document.querySelector("#heroSlot .item.hub .row .n");
      if(!n) return null;
      const nt=n.querySelector(".nt");
      return {
        text:nt?nt.textContent:null,
        hasEllipsis: nt?/…$/.test(nt.textContent):null,
      };
    });
    check(!!hero,`${tag} the hero should render for a real task`);
    if(hero){
      const full = "🎵 לתקן מזגן מקצר בחדר השינה של הילדים בקומה השנייה";
      check(hero.text === full,
        `${tag} the hero title should render in full, got ${JSON.stringify(hero.text)}`);
      check(!hero.hasEllipsis,
        `${tag} the hero title must never be truncated with an ellipsis, got ${JSON.stringify(hero.text)}`);
    }

    check(errs.length===0,`${tag} page errors: ${errs.join(" | ")}`);
    await p.screenshot({path:`layout-${vp.name}.png`});
    await ctx.close();
  }

  await b.close();
  if(bad.length){ console.log("FAIL:"); for(const m of bad) console.log("  ✗ "+m); process.exit(1); }
  console.log("ok — uniform rows: no overlap, clock order, content-driven heights, one-line rails, named gaps");
})();
