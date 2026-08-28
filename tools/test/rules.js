/* The 2026-08-18 rule changes, all three of them:

   1. Card text no longer blocks anything. BLOCK_RE (waiting/מחכה/blocked/…)
      used to be run over a card's name, description and label names, and any
      hit held the card out of scheduling until the wording was edited away in
      Trello. Only Daisey's own Pending marker parks a card now.
   2. Pending always releases itself on the calendar. Undated means "the rest
      of today" (written as a marker dated today, so the existing dated path
      does the work); dated means "not until then, every day after".
   3. A break hour set in Settings is RESERVED — planFor pushes it into both
      busy sets before placing anything, so no task may land on it, and
      breakGaps then turns the protected stretch into a real Break block.

   Cards are injected directly into S.cards rather than through the fixture,
   so each assertion has exactly one variable and nothing depends on the
   harness board contents drifting. */
const fs=require("fs"),vm=require("vm");const {chromium}=require("playwright");
const H=fs.readFileSync(__dirname+"/harness.js","utf8");
const page_html=fs.readFileSync(__dirname+"/daisey.html","utf8");
const sb={require,__dirname,module:{exports:{}},exports:{},console,process};
vm.runInNewContext(H.split("(async () => {")[0]+"\nmodule.exports={stub};",sb);
const stub=sb.module.exports.stub;

const clock=t=>`const R=Date;const O=new R("${t}").getTime()-R.now();
window.Date=class extends R{constructor(...a){if(a.length===0)super(R.now()+O);else super(...a);}static now(){return R.now()+O;}};`;

const bad=[];
const check=(cond,msg)=>{ if(!cond) bad.push(msg); };

(async()=>{
  const b=await chromium.launch({});
  const ctx=await b.newContext({viewport:{width:420,height:900},timezoneId:"Asia/Jerusalem",colorScheme:"dark"});
  const p=await ctx.newPage();
  p.on("pageerror",e=>bad.push("pageerror: "+e.message));
  p.on("console",m=>{if(m.type()==="error" && !/^\[daisey\]/.test(m.text()))bad.push("console: "+m.text());});
  await p.setContent(`<!doctype html><html><head><meta charset="utf-8"><script>${clock("2026-08-14T07:00:00+03:00")}${stub}<\/script></head><body>${page_html}</body></html>`,{waitUntil:"load"});
  await p.waitForTimeout(2600);
  await p.evaluate(()=>{S.scheduleOpen=true;render();});

  /* ---- 1. wording never blocks ------------------------------------- */
  const worded = await p.evaluate(()=>{
    const mk = (id,name,desc,labels) => ({
      id:"ari:cloud:trello::card/workspace/x/"+id, name, desc:desc||"",
      url:"https://trello.com/c/"+id+"/1-x", webUrl:"https://trello.com/c/"+id+"/1-x",
      list:{id:"ari:cloud:trello::list/workspace/x/l1",name:"L"},
      board:{id:"ari:cloud:trello::board/workspace/x/692abd49a69c853bb71cb728",name:"PROJECTS"},
      labels:labels||[], due:null, dueComplete:false, lastActivityAt:"2026-08-13T09:00:00.000Z", members:[]
    });
    for(const bd of BOARDS) S.cards[bd.key] = { payload:{ cards:{ nodes:[] } } };
    S.cards.projects = { payload:{ cards:{ nodes:[
      mk("wA","Fix the boiler","waiting on the plumber"),
      mk("wB","מחכה לתשובה מיוסי",""),
      mk("wC","Order parts","",[{id:"L1",name:"blocked",color:"sky"}])
    ]}}};
    const names = candidates().map(c=>c.name);
    return { n:names.length, names, blocked: allCards().map(c=>c.blocked) };
  });
  check(worded.n===3, `wording must not exclude anything: expected all 3 schedulable, got ${worded.n} (${JSON.stringify(worded.names)})`);
  check(worded.blocked.every(x=>x===false), `no card should read as blocked from its own text, got ${JSON.stringify(worded.blocked)}`);

  /* ---- 2. Pending releases itself ---------------------------------- */
  const pend = await p.evaluate(()=>{
    const mk = (id,desc) => ({
      id:"ari:cloud:trello::card/workspace/x/"+id, name:"Card "+id, desc,
      url:"https://trello.com/c/"+id+"/1-x", webUrl:"https://trello.com/c/"+id+"/1-x",
      list:{id:"ari:cloud:trello::list/workspace/x/l1",name:"L"},
      board:{id:"ari:cloud:trello::board/workspace/x/692abd49a69c853bb71cb728",name:"PROJECTS"},
      labels:[], due:null, dueComplete:false, lastActivityAt:"2026-08-13T09:00:00.000Z", members:[]
    });
    const today = dayKey(new Date());                                  // 2026-08-14
    const tomorrow = dayKey(addDays(new Date(),1));
    const yesterday = dayKey(addDays(new Date(),-1));
    for(const bd of BOARDS) S.cards[bd.key] = { payload:{ cards:{ nodes:[] } } };
    S.cards.projects = { payload:{ cards:{ nodes:[
      mk("pToday",     "⏳ Pending until "+today+" — \n\nwaiting"),      // set today
      mk("pYesterday", "⏳ Pending until "+yesterday+" — \n\nwaiting"),  // set yesterday
      mk("pFuture",    "⏳ Pending until "+tomorrow+" — \n\nwaiting")    // dated ahead
    ]}}};
    const by = {};
    for(const c of allCards()) by[c.name] = { blocked:c.blocked, returned:c.pendingReturned, tier:tierOf(c) };
    return { by, inPool: candidates().map(c=>c.name).sort() };
  });
  check(pend.by["Card pToday"].blocked===true,
    "a Pending set today must park the card for the rest of today");
  check(pend.by["Card pYesterday"].blocked===false,
    "yesterday's undated Pending must have released itself — the card is back today");
  check(pend.by["Card pYesterday"].returned===true,
    "a released Pending card should read as pendingReturned so it gets its boost");
  check(pend.by["Card pFuture"].blocked===true,
    "a Pending dated tomorrow must still be parked today");
  check(JSON.stringify(pend.inPool)===JSON.stringify(["Card pYesterday"]),
    `only the released card belongs in the pool, got ${JSON.stringify(pend.inPool)}`);

  /* ---- 2b. the Pending button writes a dated marker, never a bare one --- */
  const marker = await p.evaluate(()=>{
    const today = dayKey(new Date());
    return { built: pendingMark(today), bareStillPossible: pendingMark(null) };
  });
  check(/^⏳ Pending until \d{4}-\d{2}-\d{2} — $/.test(marker.built),
    `a dated marker should carry its date, got ${JSON.stringify(marker.built)}`);

  /* ---- 3. a reserved break hour is never scheduled over -------------- */
  const res = await p.evaluate(()=>{
    const mk = (id,size) => ({
      id:"ari:cloud:trello::card/workspace/x/"+id, name:"Task "+id, desc:"",
      url:"https://trello.com/c/"+id+"/1-x", webUrl:"https://trello.com/c/"+id+"/1-x",
      list:{id:"ari:cloud:trello::list/workspace/x/l1",name:"L"},
      board:{id:"ari:cloud:trello::board/workspace/x/692abd49a69c853bb71cb728",name:"PROJECTS"},
      labels: size==="short" ? [{id:"y",name:"",color:"yellow"}] : [],
      due:null, dueComplete:false, lastActivityAt:"2026-08-13T09:00:00.000Z", members:[]
    });
    for(const bd of BOARDS) S.cards[bd.key] = { payload:{ cards:{ nodes:[] } } };
    S.cards.projects = { payload:{ cards:{ nodes:[
      mk("s1","short"), mk("q1"), mk("q2"), mk("q3"), mk("q4")
    ]}}};
    EVENTS.length = 0;                                  // empty calendar, whole day free
    S.events = { payload:{ events:EVENTS }, storedAt:Date.now() };

    CFG.dayStart = 9; CFG.dayEnd = 18;
    CFG.breakHour = 13; CFG.breakLen = 60;

    const date = startOfDay(new Date());
    const placed = planFor(date, "normal", null, new Set());
    const gaps = breakGaps(date, new Set(), placed);
    return {
      reserved: reservedBreak(),
      /* quick tasks now land as one "quick-brick" placed entry (cards
         plural), not one per card — see CLAUDE.md's brick rules. */
      placed: placed.map(x=>({n:x.kind==="quick-brick" ? x.cards.map(c=>c.name).join(", ") : x.card.name,s:x.s,e:x.e,k:x.kind})),
      gaps
    };
  });
  check(res.reserved && res.reserved.s===780 && res.reserved.e===840,
    `13:00 should reserve 780–840 min, got ${JSON.stringify(res.reserved)}`);
  const clash = (res.placed||[]).filter(x => x.s < 840 && x.e > 780);
  check(clash.length===0,
    `nothing may be scheduled across a reserved break, got ${JSON.stringify(clash)}`);
  check((res.gaps||[]).some(g => g.s <= 780 && g.e >= 840),
    `the reserved hour must survive into breakGaps as free time, got ${JSON.stringify(res.gaps)}`);
  check((res.placed||[]).length>0,
    "the day should still schedule real work around the reserved break");

  /* ---- 3b. left on "Daisey decides", nothing is reserved ------------- */
  const auto = await p.evaluate(()=>{ CFG.breakHour = null; return reservedBreak(); });
  check(auto===null, `"Daisey decides" must reserve nothing, got ${JSON.stringify(auto)}`);

  /* ---- 4. no breathing room: a session may start the instant a meeting
     ends ---- "breathing room" (CFG.buffer) padded both sessions and
     meetings so nothing landed flush against them; removed 2026-08-18 at
     the user's request (it was confusable with the separate, real Break
     feature). busyFor now returns raw intervals with no padding at all.
     Meeting is 2h (under AUTO_BREAK_MIN=180), not 3h, on purpose — a 3h+
     meeting now legitimately earns a forced break of its own (see
     findSlotWithAutoBreak below); this case is isolated to test padding-vs-
     no-padding only, not that separate rule. */
  const after = await p.evaluate(()=>{
    const mk = (id,size) => ({
      id:"ari:cloud:trello::card/workspace/x/"+id, name:"Task "+id, desc:"",
      url:"https://trello.com/c/"+id+"/1-x", webUrl:"https://trello.com/c/"+id+"/1-x",
      list:{id:"ari:cloud:trello::list/workspace/x/l1",name:"L"},
      board:{id:"ari:cloud:trello::board/workspace/x/692abd49a69c853bb71cb728",name:"PROJECTS"},
      labels: size==="short" ? [{id:"y",name:"",color:"yellow"}] : [],
      due:null, dueComplete:false, lastActivityAt:"2026-08-13T09:00:00.000Z", members:[]
    });
    for(const bd of BOARDS) S.cards[bd.key] = { payload:{ cards:{ nodes:[] } } };
    S.cards.projects = { payload:{ cards:{ nodes:[ mk("s1","short") ]}}};
    EVENTS.length = 0;
    EVENTS.push({ id:"m1", summary:"Standup",
      start:{dateTime:"2026-08-14T09:00:00+03:00",timeZone:"Asia/Jerusalem"},
      end:{dateTime:"2026-08-14T11:00:00+03:00",timeZone:"Asia/Jerusalem"}, status:"confirmed" });
    S.events = { payload:{ events:EVENTS }, storedAt:Date.now() };
    CFG.dayStart = 9; CFG.dayEnd = 18; CFG.breakHour = null; CFG.shortMin = 180;
    const date = startOfDay(new Date());
    const placed = planFor(date, "normal", null, new Set());
    return { placed: placed.map(x=>({n:x.card.name,s:x.s,e:x.e})),
             gaps: breakGaps(date, new Set(), placed) };
  });
  check(after.placed.length===1 && after.placed[0].s===660,
    `a session should be able to start the instant the 11:00 meeting ends (660), got ${JSON.stringify(after.placed)}`);
  check(!(after.gaps||[]).some(g => g.s===660 && g.e===690),
    `no padding means no gap between the meeting and the session, got ${JSON.stringify(after.gaps)}`);

  /* ---- 5. rebuild clears an in-progress block too, 2026-08-18 user request:
     "Rebuild" means rebuild the whole day, not the whole day except whatever
     you happen to be doing right now. clearableBlocks used to exempt any
     block you were inside at the moment of rebuild; that exemption (and its
     collidesWithMeeting helper) is gone outright — a currently-running block
     is ordinary clearable material like anything else, meeting-collision or
     not. planFor's nowMin gate is what still keeps the replacement from
     landing in the past, not this function. */
  const stale = await p.evaluate(()=>{
    /* The page clock is pinned to 07:00, so every block below is genuinely
       in progress at that moment. */
    EVENTS.length = 0;
    /* חמל-shaped: open (tasks may run inside), but a session never may */
    EVENTS.push({ id:"hamal", summary:"חמל",
      start:{dateTime:"2026-08-14T06:00:00+03:00",timeZone:"Asia/Jerusalem"},
      end:{dateTime:"2026-08-14T12:00:00+03:00",timeZone:"Asia/Jerusalem"}, status:"confirmed" });
    /* a 3h session sitting inside it, running right now — collides with חמל */
    EVENTS.push({ id:"stale1", colorId:"5", summary:"🎵 Stale session",
      description:"[daisey] Stale session\n\nOriginal: https://trello.com/c/aWUJk3a8/1-x",
      start:{dateTime:"2026-08-14T06:30:00+03:00",timeZone:"Asia/Jerusalem"},
      end:{dateTime:"2026-08-14T09:30:00+03:00",timeZone:"Asia/Jerusalem"}, status:"confirmed" });
    /* a quick task, also in progress, also inside the meeting — legal there,
       since an open meeting admits quick tasks, but "legal" no longer means
       "protected from rebuild" */
    EVENTS.push({ id:"live1", colorId:"9", summary:"• Valid quick",
      description:"[daisey] Valid quick\n\nOriginal: https://trello.com/c/TXxCAu3T/1-x",
      start:{dateTime:"2026-08-14T06:45:00+03:00",timeZone:"Asia/Jerusalem"},
      end:{dateTime:"2026-08-14T07:15:00+03:00",timeZone:"Asia/Jerusalem"}, status:"confirmed" });
    S.events = { payload:{ events:EVENTS }, storedAt:Date.now() };
    CFG.openEvents = ["חמל"];
    const date = startOfDay(new Date());
    return { clearable: clearableBlocks(date).map(e=>e.id) };
  }, );
  check(stale.clearable.includes("stale1"),
    `rebuild must clear the in-progress session colliding with חמל, got ${JSON.stringify(stale.clearable)}`);
  check(stale.clearable.includes("live1"),
    `rebuild must clear the in-progress quick task too, not just the colliding one, got ${JSON.stringify(stale.clearable)}`);

  /* ---- 6. a currently-active permeable meeting's other tasks get their
     own dashed nest under the banner — each one a full, ordinary card
     (same component as everywhere else, actions included), not folded
     into the hub and not a flat sibling in Later today either. The
     meeting itself renders as a compact banner (meetingNowRow), not a
     stack row, so it never reaches groupForStack — a second task
     scheduled "inside" it used to show up as a flat sibling in Later
     today with no sign it belonged to the meeting at all. (A fold-into-
     the-hub design was tried in between and reverted: the hub and every
     other card are now the exact same component — timelineItem's own
     stack mode, opts.hub just scales it up and re-tints it, see nowCard —
     so there's no separate "hub-shaped slot" left to fold anything into.) ---- */
  const nested = await p.evaluate(()=>{
    EVENTS.length = 0;
    EVENTS.push({ id:"hamal2", summary:"חמל",
      start:{dateTime:"2026-08-14T06:00:00+03:00",timeZone:"Asia/Jerusalem"},
      end:{dateTime:"2026-08-14T12:00:00+03:00",timeZone:"Asia/Jerusalem"}, status:"confirmed" });
    EVENTS.push({ id:"nowTask", colorId:"9", summary:"• Now task",
      description:"[daisey] Now task\n\nOriginal: https://trello.com/c/AAAAAAAA/1-x",
      start:{dateTime:"2026-08-14T07:00:00+03:00",timeZone:"Asia/Jerusalem"},
      end:{dateTime:"2026-08-14T07:15:00+03:00",timeZone:"Asia/Jerusalem"}, status:"confirmed" });
    EVENTS.push({ id:"laterTask", colorId:"9", summary:"• Later task",
      description:"[daisey] Later task\n\nOriginal: https://trello.com/c/BBBBBBBB/1-x",
      start:{dateTime:"2026-08-14T09:00:00+03:00",timeZone:"Asia/Jerusalem"},
      end:{dateTime:"2026-08-14T09:15:00+03:00",timeZone:"Asia/Jerusalem"}, status:"confirmed" });
    S.events = { payload:{ events:EVENTS }, storedAt:Date.now() };
    CFG.openEvents = ["חמל"];
    for(const bd of BOARDS) S.cards[bd.key] = { payload:{ cards:{ nodes:[] } } };
    render();
  });
  await p.waitForTimeout(500);
  /* A non-hub row is collapsed by default (see CLAUDE.md's collapsible-card
     accordion note) — its Done/Swap/Remove row only renders once it's the
     one open card, same as any other non-hub row (mini.js/fast.js hit the
     same thing). Open the nested task before checking for its actions. */
  /* .hub-group is gone (2026-08-25 redesign — the special hub-card wrapper
     and its connector machinery were deleted outright once every row got a
     real pixel position; see paintMain's hub-collapse comment). meetingNow
     and its nest still render, just as flat children of .hub-lead alongside
     every other row now, not inside a dedicated wrapper. */
  await p.locator("#pageMain .hub-lead > .nest.standalone .item .row").first().click().catch(()=>{});
  await p.waitForTimeout(300);
  const dom = await p.evaluate(()=>{
    const banner = document.querySelector("#pageMain .hub-lead > .meeting-now");
    const nest = document.querySelector("#pageMain .hub-lead > .nest.standalone");
    const nestHasLater = nest ? Array.from(nest.querySelectorAll(".row .n")).some(n=>n.textContent.includes("Later task")) : false;
    const nestCardIsFull = nest ? !!nest.querySelector(".item .mini.ok") : false;   // has its own Done button, not a read-only fold
    const hubHasAlso = !!document.querySelector(".now .hub-also");   // the old fold design — must be gone
    /* "Flat" means a top-level sibling, NOT merely "inside .rows.stack" —
       since the Day view moved onto the hour grid, .hub-lead and its
       nest live inside .rows.stack too, so the old selector matched the
       correctly-nested card and read it as a regression. Exclude anything
       within a .nest (and .hub-lead itself) to ask the real question. */
    const flatHasLater = Array.from(document.querySelectorAll(".rows.stack .item.stack .row .n"))
      .filter(n=>!n.closest(".nest")&&!n.closest(".hub-lead"))
      .some(n=>n.textContent.includes("Later task"));
    return { hasBanner:!!banner, hasNest:!!nest, nestHasLater, nestCardIsFull, hubHasAlso, flatHasLater };
  });
  check(dom.hasBanner, "meeting-now banner should render when חמל is active");
  check(dom.hasNest, `a dashed nest should render under the banner for the meeting's other task, got ${JSON.stringify(dom)}`);
  check(dom.nestHasLater, "the nest must contain the later-in-meeting task");
  check(dom.nestCardIsFull, "the nested task should be a full card with its own actions, not a read-only fold");
  check(!dom.hubHasAlso, "the old fold-into-hub design (.hub-also) should be gone");
  check(!dom.flatHasLater, "the later-in-meeting task must not also appear as a flat sibling in Later today");

  console.log("[rules]", JSON.stringify({worded, pend:pend.by, res}, null, 0).slice(0,700));
  console.log(bad.length ? "FAIL:\n  ✗ "+bad.join("\n  ✗ ")
                         : "✓ wording never blocks · Pending expires by date · a set break hour is reserved · active meeting still nests");
  await b.close();
  process.exit(bad.length?1:0);
})();
