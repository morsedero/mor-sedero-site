/* Done / Swap / Pending / Remove used to hold the whole UI still behind
   S.pending while two or three round trips to Trello and Google Calendar
   finished — the same wait that made dragging feel slow before commitMove
   existed. They're local-first now: the card leaves the open list, the slot
   changes hands, or the block disappears on the tap, and the writes go out
   behind it.

   S.mcp.callTool is wrapped so every write hangs until the test releases it,
   and completions are counted separately from attempts (the harness logs a
   call before it does any work, so __calls alone can't tell "sent" from
   "finished"). That's what makes "the UI already moved" an assertion rather
   than a race: nothing has *completed* at the moment we look.

   Fixture: three back-to-back quick tasks whose Trello links point at real
   fixture cards, overwritten after boot settles the same way push.js does it
   — the mock's backing EVENTS array *and* the page's S.events cache, so a
   background refresh can't stomp them. */
const fs=require("fs"),vm=require("vm");const {chromium}=require("playwright");
const H=fs.readFileSync(__dirname+"/harness.js","utf8");
const page_html=fs.readFileSync(__dirname+"/daisey.html","utf8");
const sb={require,__dirname,module:{exports:{}},exports:{},console,process};
vm.runInNewContext(H.split("(async () => {")[0]+"\nmodule.exports={stub};",sb);
const BASE=sb.module.exports.stub;

const ev = (id, letter, s, e, short) => ({
  id, colorId:"9", summary:`• Task ${letter}`,
  description:`[daisey] Task ${letter}\n\nOriginal: https://trello.com/c/${short}/1-x`,
  start:{dateTime:`2026-08-14T${s}:00+03:00`,timeZone:"Asia/Jerusalem"},
  end:{dateTime:`2026-08-14T${e}:00+03:00`,timeZone:"Asia/Jerusalem"},
  status:"confirmed"
});
const EVENTS=[ ev("qa","A","09:00","09:20","Y9SpnlTP"),
               ev("qb","B","09:20","09:40","TXxCAu3T"),
               ev("qc","C","09:40","10:00","mByvGrzM") ];

const clock=t=>`const R=Date;const O=new R("${t}").getTime()-R.now();
window.Date=class extends R{constructor(...a){if(a.length===0)super(R.now()+O);else super(...a);}static now(){return R.now()+O;}};`;

const bad=[];
const check=(cond,msg)=>{ if(!cond) bad.push(msg); };
const WRITE=/event|trelloWrite/;

(async()=>{
  const b=await chromium.launch({});
  const ctx=await b.newContext({viewport:{width:420,height:900},timezoneId:"Asia/Jerusalem",colorScheme:"dark"});
  const p=await ctx.newPage();
  p.on("pageerror",e=>bad.push("pageerror: "+e.message));
  p.on("console",m=>{if(m.type()==="error" && !/^\[daisey\]/.test(m.text()))bad.push("console: "+m.text());});
  await p.setContent(`<!doctype html><html><head><meta charset="utf-8"><script>${clock("2026-08-14T07:00:00+03:00")}${stubOf()}<\/script></head><body>${page_html}</body></html>`,{waitUntil:"load"});
  function stubOf(){ return BASE; }
  await p.waitForTimeout(2600);
  await p.evaluate(()=>{S.scheduleOpen=true;render();});

  /* wrap the live bridge: hold writes, and count what actually finished */
  await p.evaluate(()=>{
    window.__hold=false; window.__release=[]; window.__done=[];
    const orig=S.mcp.callTool.bind(S.mcp);
    S.mcp.callTool=async(s,t,i)=>{
      if(window.__hold && /event|trelloWrite/.test(t))
        await new Promise(r => window.__release.push(r));
      const r=await orig(s,t,i);
      window.__done.push(t+(i&&i.action?":"+i.action:""));
      return r;
    };
  });

  const seed=async()=>{
    await p.evaluate(events=>{
      window.__hold=false;
      for(const r of window.__release.splice(0)) r();
      EVENTS.length=0; EVENTS.push(...JSON.parse(JSON.stringify(events)));
      S.events={ payload:{ events:EVENTS }, storedAt:Date.now() };
      S.failed=[]; S.pending.clear(); S.stats.rollovers={};
      /* Reseeded events reuse the same fixed ids (qa/qb/qc) every scenario,
         so a stale S.openRow from a previous scenario's row-open click would
         otherwise toggle that same row straight closed here instead of
         opening it — see CLAUDE.md's collapsible-card accordion note. */
      S.openRow=null;
      for(const c of allCards()){ const n=rawCardNode(c); if(n) n.dueComplete=false; }
      render();
    }, EVENTS);
    await p.waitForTimeout(250);
    await p.evaluate(()=>{ window.__hold=true; window.__done.length=0; });
  };
  const finished=async()=>p.evaluate(()=>window.__done.slice());
  const release=async()=>{
    await p.evaluate(()=>{ window.__hold=false; for(const r of window.__release.splice(0)) r(); });
    await p.waitForTimeout(700);
  };
  const hub=async()=>p.evaluate(()=>(document.querySelector(".now .row .n")||{}).textContent||"");
  const openRows=async()=>p.evaluate(()=>document.querySelectorAll("#pageMain .item.stack:not(.meeting)").length);

  /* ------------------------------------------------------------- Done */
  /* #heroSlot, not #pageMain (2026-08-26 hero redesign): the hub's own
     open-card actions (Done/Swap/Pending/Remove) moved into the hero —
     the timeline's own in-place stand-in (currentMarker) deliberately
     carries no action buttons, to avoid showing the same controls twice. */
  await seed();
  const first=await hub();
  check(first.includes("לסגור מקום לחתונה"), `hub should be Task A's card, got "${first}"`);
  await p.click("#heroSlot .now .mini.ok");
  await p.waitForTimeout(250);

  /* progress-pill is icon-only now (2026-08-28, direct user request — the
     Today well already shows progress block-by-block) — the real count
     survives as the title/aria-label, not textContent. */
  let st={ pill:await p.evaluate(()=>($("#progressPill")||{}).title), hub:await hub(), done:await finished() };
  check(/^1\//.test(st.pill||""),`the progress pill should already read 1 done, got ${st.pill}`);
  check(!st.hub.includes("לסגור מקום לחתונה"),"the finished card should already be out of the open list");
  check(st.done.length===0,`no write should have finished yet, got ${JSON.stringify(st.done)}`);
  console.log("[done]", JSON.stringify(st));
  await release();
  check((await finished()).some(t=>t==="trelloWriteCard:mark_done"),"the mark_done write should land once released");

  /* ----------------------------------------------------------- Remove */
  /* A non-hub row is collapsed by default (see CLAUDE.md's collapsible-card
     accordion note) — its action row only renders once it's the one open
     card, so the row has to be tapped open before its Remove button exists
     to click. Unrelated to the brick-merge change; this pre-dates it.
     :not(.current-marker-card) (2026-08-27): currentMarker grew its own
     .row wrapper the same day the in-card time badge replaced the outside
     rail (see timelineItem/currentMarker), so its card now matches this
     selector too — but it was never collapsible (no accordion, the hero
     already shows its full detail) and has no click-to-open handler, so
     without the exclusion this could click the always-open hub instead of
     the actual collapsible row and never reveal a Remove button. */
  await seed();
  let rows=await openRows();
  await p.click("#pageMain .rows.stack .item.stack:not(.meeting):not(.current-marker-card) .row");
  await p.waitForTimeout(250);
  await p.click("#pageMain .rows.stack .item.stack:not(.meeting) .mini.del");
  await p.waitForTimeout(250);
  await p.click(".dialog .btn:not(.quiet)");
  await p.waitForTimeout(250);

  st={ rows:await openRows(), done:await finished() };
  check(st.rows===rows-1,`Remove should take the row out at once (${rows} -> ${st.rows})`);
  check(st.done.length===0,`no write should have finished yet, got ${JSON.stringify(st.done)}`);
  console.log("[remove]", JSON.stringify(st));
  await release();
  check((await finished()).includes("delete_event"),"the block delete should land once released");

  /* ------------------------------------------------------------- Swap */
  await seed();
  await p.click("#heroSlot .now .mini.swap");
  await p.waitForTimeout(350);
  const picked=await p.evaluate(()=>{
    const row=document.querySelector(".pick .pick-row");
    const name=row ? (row.querySelector(".n")||{}).textContent : null;
    if(row) row.click();
    return name;
  });
  await p.waitForTimeout(250);

  st={ hub:await hub(), done:await finished() };
  check(!!picked,"the swap picker should have offered at least one card");
  check(picked && st.hub.includes(picked),`the slot should already show "${picked}", got "${st.hub}"`);
  /* The swapped-in card's own checklist prefetch (loadChecklists, run
     unconditionally for every rendered card) is a read, not a held write —
     it's expected to complete immediately regardless of __hold, which only
     gates event/trelloWrite calls (see WRITE above). Only writes matter for
     "nothing committed yet". */
  check(st.done.filter(t=>WRITE.test(t)).length===0,`no write should have finished yet, got ${JSON.stringify(st.done)}`);
  console.log("[swap]", JSON.stringify({picked,...st}));
  await release();
  check((await finished()).includes("create_event"),"the replacement block should be created once released");

  /* ---------------------------------------------------------- Pending */
  /* :not(.current-marker-card) — see the Remove block's comment above. */
  await seed();
  rows=await openRows();
  await p.click("#pageMain .rows.stack .item.stack:not(.meeting):not(.current-marker-card) .row");
  await p.waitForTimeout(250);
  await p.click("#pageMain .rows.stack .item.stack:not(.meeting) .mini.pend");
  await p.waitForTimeout(350);
  await p.click(".dialog .btn:not(.quiet)");
  await p.waitForTimeout(250);

  st={ rows:await openRows(), done:await finished() };
  check(st.rows===rows-1,`Pending should clear the block at once (${rows} -> ${st.rows})`);
  check(st.done.length===0,`no write should have finished yet, got ${JSON.stringify(st.done)}`);
  console.log("[pending]", JSON.stringify(st));
  await release();

  /* ------------------ a Done whose write fails comes back on screen */
  await seed();
  await p.evaluate(()=>{
    window.__hold=false;
    const orig=S.mcp.callTool;
    S.mcp.callTool=async(s,t,i)=>{
      if(t==="trelloWriteCard" && i.action==="mark_done") throw { code:"tool_error", message:"nope", server:s };
      return orig(s,t,i);
    };
  });
  const before=await hub();
  await p.click("#heroSlot .now .mini.ok");
  await p.waitForTimeout(900);

  st=await p.evaluate(()=>({
    pill:($("#progressPill")||{}).title,
    hub:(document.querySelector(".now .row .n")||{}).textContent||"",
    bar:(document.querySelector(".toast.unsaved .undo-msg")||{}).textContent||null
  }));
  check(st.hub===before,`a failed Done should put the card back as the hub (${JSON.stringify(before)} -> ${JSON.stringify(st.hub)})`);
  check(/^0\//.test(st.pill||""),`a failed Done should undo the progress bump, got ${st.pill}`);
  check(/1 change didn't save/.test(st.bar||""),`a failed Done should be held for retry, got ${JSON.stringify(st.bar)}`);
  console.log("[done-fails]", JSON.stringify(st));

  console.log(bad.length ? "FAIL:\n  ✗ "+bad.join("\n  ✗ ")
                         : "✓ Done, Swap, Pending and Remove all land on screen before their writes");
  await b.close();
  process.exit(bad.length?1:0);
})();
