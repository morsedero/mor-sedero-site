/* The day boundary, a half-dead boot, and the refresh-on-return.

   1. Midnight with the page open. S.anchor was set once at load and
      allEvents() drops every card-linked block that doesn't start today, so
      crossing 00:00 used to empty the whole schedule out of the model: the hub
      fell to "Nothing scheduled" and its own Re-plan button could only answer
      "Only today can be built right now." A reload was the only way out, and
      leaving the tab open overnight is the normal way this gets used.
   2. Boot with only one connector answering. The settle loop used to wait for
      all three Trello boards *and* the calendar, with a 20s timeout that then
      skipped settings, the rollover sweep and the auto-plan entirely — so a
      slow board bought a 20-second blank screen and a degraded day.
   3. Coming back to a backgrounded tab: nothing refreshed on focus, so the
      page rode entirely on the host's 2-3 minute refetch.

   The clock stub keeps a mutable window.__shift so the test can walk time
   forward inside a live page instead of booting a second one. */
const fs=require("fs"),vm=require("vm");const {chromium}=require("playwright");
const H=fs.readFileSync(__dirname+"/harness.js","utf8");
const page_html=fs.readFileSync(__dirname+"/dayflow.html","utf8");
const sb={require,__dirname,module:{exports:{}},exports:{},console,process};
vm.runInNewContext(H.split("(async () => {")[0]+"\nmodule.exports={stub};",sb);
const BASE=sb.module.exports.stub;

/* Sunday 2026-08-16 — an ordinary day (the day off ships as Saturday) */
const DAY="2026-08-16", NEXT="2026-08-17";
const clock=t=>`window.__EVENT_DAY="${DAY}";window.__shift=0;
const R=Date;const O=new R("${t}").getTime()-R.now();
window.Date=class extends R{constructor(...a){if(a.length===0)super(R.now()+O+window.__shift);else super(...a);}static now(){return R.now()+O+window.__shift;}};`;

const bad=[];
const check=(cond,msg)=>{ if(!cond) bad.push(msg); };

async function newPage(b,extra,stub){
  const ctx=await b.newContext({viewport:{width:420,height:900},timezoneId:"Asia/Jerusalem",colorScheme:"dark"});
  const p=await ctx.newPage();
  p.on("pageerror",e=>bad.push("pageerror: "+e.message));
  p.on("console",m=>{if(m.type()==="error")bad.push("console: "+m.text());});
  await p.setContent(`<!doctype html><html><head><meta charset="utf-8"><script>${extra}${stub}<\/script></head><body>${page_html}</body></html>`,{waitUntil:"load"});
  return p;
}

(async()=>{
  const b=await chromium.launch({});

  /* ---------------------------------------------- 1. crossing midnight */
  {
    const p=await newPage(b,clock(`${DAY}T21:00:00+03:00`),BASE);
    await p.waitForTimeout(2600);

    const before=await p.evaluate(()=>({today:S.today,anchor:dayKey(S.anchor),ready:S.ready,
      plans:Object.keys((S.stats&&S.stats.plans)||{})}));
    check(before.ready,"should have booted");
    check(before.today===DAY,`S.today should start as ${DAY}, got ${before.today}`);
    check(before.anchor===DAY,`anchor should start as ${DAY}, got ${before.anchor}`);

    const creationsBefore=await p.evaluate(()=>window.__calls.filter(c=>c.tool==="create_event").length);

    // walk the clock 5 hours forward: 21:00 Sun -> 02:00 Mon, page never reloads
    await p.evaluate(()=>{ window.__shift = 5*60*60*1000; });
    await p.waitForTimeout(3000);

    const after=await p.evaluate(()=>({today:S.today,anchor:dayKey(S.anchor),
      plans:Object.keys((S.stats&&S.stats.plans)||{}),
      replanHidden:document.querySelector("#replanBtn").hidden,
      locked:isLockedDay(S.anchor),
      state:(document.querySelector(".state h2")||{}).textContent||null}));

    check(after.today===NEXT,`S.today should have followed the clock to ${NEXT}, got ${after.today}`);
    check(after.anchor===NEXT,`the anchor should have followed to ${NEXT}, got ${after.anchor}`);
    check(!after.locked,"the new day is today and must not be locked");
    check(!after.replanHidden,"Re-plan should be usable again on the new day");
    check(after.state!=="Nothing scheduled",'the hub must not be stranded on "Nothing scheduled" after midnight');
    check(after.plans.includes(NEXT),`the new day should have been built once (plans: ${JSON.stringify(after.plans)})`);

    const creationsAfter=await p.evaluate(()=>window.__calls.filter(c=>c.tool==="create_event").length);
    check(creationsAfter>creationsBefore,"the new day should have had blocks laid onto it");

    // and it must not keep re-planning on every tick
    await p.waitForTimeout(2500);
    const creationsSettled=await p.evaluate(()=>window.__calls.filter(c=>c.tool==="create_event").length);
    check(creationsSettled===creationsAfter,
      `the rollover should build the new day once, not every tick (${creationsAfter} -> ${creationsSettled})`);

    console.log("[midnight]", JSON.stringify(after));
    await p.context().close();
  }

  /* ------------------------- 1b. a day the user navigated to isn't yanked */
  {
    const p=await newPage(b,clock(`${DAY}T21:00:00+03:00`),BASE);
    await p.waitForTimeout(2600);
    await p.evaluate(()=>{ goDay(3); });        // wander off to a future day
    const parked=await p.evaluate(()=>dayKey(S.anchor));
    await p.evaluate(()=>{ window.__shift = 5*60*60*1000; });
    await p.waitForTimeout(2500);
    const still=await p.evaluate(()=>({anchor:dayKey(S.anchor),today:S.today}));
    check(still.anchor===parked,`a day the user navigated to should stay put across midnight (${parked} -> ${still.anchor})`);
    check(still.today===NEXT,"S.today should still have advanced even while parked elsewhere");
    console.log("[parked]", JSON.stringify(still));
    await p.context().close();
  }

  /* ----------------------------- 2. boot with Trello never answering */
  {
    const noTrello=BASE.replace(
      "setTimeout(()=>{ if(w.live) fire(); }, 30);",
      'if(tool !== "trelloReadCard") setTimeout(()=>{ if(w.live) fire(); }, 30);');
    check(noTrello!==BASE,"test setup: the watchTool fire hook wasn't found in the harness");

    const p=await newPage(b,clock(`${DAY}T09:40:00+03:00`),noTrello);
    await p.waitForTimeout(2600);   // well under the old 20s fallback

    const st=await p.evaluate(()=>({ready:S.ready,skel:!!document.querySelector(".skel"),
      rows:document.querySelectorAll("#pageMain .item, #pageMain .now").length,
      banner:(document.querySelector(".banner")||{}).textContent||null,
      hasCards:Object.keys(S.cards).length}));
    check(st.ready,"the calendar alone should be enough to finish booting");
    check(!st.skel,"the skeleton should be gone long before the old 20s fallback");
    check(st.rows>0,"the day should render from calendar events even with Trello down");
    check(st.hasCards===0,"test setup: Trello was supposed to stay unanswered");
    console.log("[half-boot]", JSON.stringify(st));
    await p.context().close();
  }

  /* --------------------------------- 3. refresh when the tab comes back */
  {
    const p=await newPage(b,clock(`${DAY}T09:40:00+03:00`),BASE);
    await p.waitForTimeout(2600);
    await p.evaluate(()=>{
      window.__inv=0;
      const orig=S.mcp.invalidate.bind(S.mcp);
      S.mcp.invalidate=async(...a)=>{ window.__inv++; return orig(...a); };
    });

    await p.evaluate(()=>{ window.dispatchEvent(new Event("focus")); });
    await p.waitForTimeout(300);
    const fresh=await p.evaluate(()=>window.__inv);
    check(fresh===0,`a tab refreshed moments ago shouldn't re-fetch on focus, got ${fresh}`);

    await p.evaluate(()=>{ S.lastRefresh = 0; window.dispatchEvent(new Event("focus")); });
    await p.waitForTimeout(500);
    const stale=await p.evaluate(()=>window.__inv);
    check(stale>=2,`returning to a stale tab should refresh both connectors, got ${stale}`);
    console.log("[return]", JSON.stringify({fresh,stale}));
    await p.context().close();
  }

  console.log(bad.length ? "FAIL:\n  ✗ "+bad.join("\n  ✗ ")
                         : "✓ midnight rollover, half-dead boot and refresh-on-return all hold");
  await b.close();
  process.exit(bad.length?1:0);
})();
