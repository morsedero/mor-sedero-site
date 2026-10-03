/* Writes used to be fire-and-forget with a 3.4-second obituary. errCopy has
   always promised "Retrying shortly." / "Pausing briefly." for the transient
   codes and there was no retry anywhere in the file, so a drag made on a bad
   connection patched the local model, rendered, failed, snapped back, toasted
   once, and the move was simply gone.

   Two halves here:
     1. A transient failure is ridden out — callTool retries, the move lands,
        and the user never learns anything went wrong.
     2. A permanent one is *kept*: the block reverts, but the work sits in the
        unsaved bar until it's either retried successfully or discarded.

   The stub's callTool gets a fail counter injected right after its __calls
   push, so every attempt is still counted — that's what makes "3 calls for
   one move" observable.

   Fixture: four back-to-back quick tasks, same override trick as push.js —
   both the mock's backing EVENTS array and the page's S.events cache, so a
   background refreshCalendar() can't stomp them back. */
const fs=require("fs"),vm=require("vm");const {chromium}=require("playwright");
const H=fs.readFileSync(__dirname+"/harness.js","utf8");
const page_html=fs.readFileSync(__dirname+"/daisey.html","utf8");
const sb={require,__dirname,module:{exports:{}},exports:{},console,process};
vm.runInNewContext(H.split("(async () => {")[0]+"\nmodule.exports={stub};",sb);
const BASE=sb.module.exports.stub;

const HOOK="window.__calls.push({ server, tool, input });";
const FAIL=HOOK+' if(window.__fail && window.__fail.tool===tool && window.__fail.n>0){ window.__fail.n--; throw { code:"server_unavailable", server, message:"stubbed outage" }; }';
const stub=BASE.split(HOOK).join(FAIL);
if(stub===BASE){ console.log("FAIL:\n  ✗ test setup: the callTool logging hook wasn't found in the harness"); process.exit(1); }

/* colorId 5 (short session), not 9 (quick) — dragging two adjacent quick
   tasks now auto-merges them into one shared brick event (see CLAUDE.md's
   brick model), which replaces the update_event this test is built around
   with create_event/delete_event instead. Two short sessions never merge
   (only quick rows do), so they keep the plain move-in-place path this
   retry/backoff test actually needs to exercise. */
const ev = (id, letter, s, e) => ({
  id, colorId:"5", summary:`🎵 Task ${letter}`,
  description:`[daisey] Task ${letter}\n\nOriginal: https://trello.com/c/${id}00000/1-x`,
  start:{dateTime:`2026-08-14T${s}:00+03:00`,timeZone:"Asia/Jerusalem"},
  end:{dateTime:`2026-08-14T${e}:00+03:00`,timeZone:"Asia/Jerusalem"},
  status:"confirmed"
});
const EVENTS=[ev("qa","A","09:00","09:20"),ev("qb","B","09:20","09:40"),
               ev("qc","C","09:40","10:00"),ev("qd","D","10:00","10:20")];

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

  const seed=async()=>p.evaluate((events)=>{
    EVENTS.length=0; EVENTS.push(...JSON.parse(JSON.stringify(events)));
    S.events={ payload:{ events:EVENTS }, storedAt:Date.now() };
    S.failed=[]; S.lastMove=null;
    render();
  }, EVENTS);

  const times=async()=>p.evaluate(()=>{
    const out={};
    for(const e of allEvents()){
      const m=/^Task ([A-D])$/.exec((e.summary||"").replace(/^[•🎵]\s*/u,""));
      if(m) out[m[1]]={s:minsOf(e.start),e:minsOf(e.end)};
    }
    return out;
  });
  const updates=async()=>p.evaluate(()=>window.__calls.filter(c=>c.tool==="update_event").length);

  /* drag the hub onto the row directly below it: an adjacent pair, so the
     push is two moves — the same shape pages.js already relies on */
  async function dragHubDown(){
    /* #heroSlot, not #pageMain: the current task renders as the hero above
       #pageMain's scroller (2026-08-26), and #pageMain's own first
       ".item.stack:not(.meeting)" is currentMarker — the SAME task. Reading
       both from #pageMain made hub and row resolve to one element, so this
       dragged a card onto itself and silently asserted against a move that
       never happened. */
    const hub=await p.locator("#heroSlot .now").boundingBox();
    const row=await p.locator("#pageMain .rows.stack .item.stack:not(.current-marker-card):not(.meeting)").first().boundingBox();
    if(!hub||!row){ check(false,"drag setup: hub or first row wasn't found"); return; }
    await p.mouse.move(hub.x+hub.width/2, hub.y+20);
    await p.mouse.down();
    await p.waitForTimeout(200);   // wireStackDrag's ARM_MS hold before it arms the drag
    await p.mouse.move(hub.x+hub.width/2, row.y+row.height/2, {steps:10});
    await p.mouse.move(hub.x+hub.width/2, row.y+row.height/2, {steps:2});
    await p.mouse.up();
  }

  /* ------------------------------- 1. a transient outage is ridden out */
  await seed();
  await p.evaluate(()=>{ window.__fail={tool:"update_event",n:2}; });
  let before=await updates();
  await dragHubDown();
  await p.waitForTimeout(3200);   // 400ms + 1200ms of backoff, plus slack

  const t1=await times();
  const calls1=(await updates())-before;
  const bar1=await p.evaluate(()=>!!document.querySelector(".toast.unsaved"));

  check(calls1===4,`two failed attempts then a retry should cost 3 calls for the first move and 1 for the second, got ${calls1}`);
  check(t1.A && t1.A.s===560,`A should have ridden out the outage and landed at 09:20, got ${JSON.stringify(t1.A)}`);
  check(t1.B && t1.B.s===540,`B should have been pushed to 09:00, got ${JSON.stringify(t1.B)}`);
  check(!bar1,"a write that succeeded on retry must not leave anything in the unsaved bar");
  console.log("[transient]", JSON.stringify({calls:calls1,A:t1.A,B:t1.B,unsavedBar:bar1}));

  /* ------------------------- 2. a permanent one is kept, not forgotten */
  await seed();
  await p.evaluate(()=>{ window.__fail={tool:"update_event",n:999}; });
  before=await updates();
  await dragHubDown();
  /* Two moves x three attempts, each attempt paying 400ms + 1200ms of
     backoff, is ~4.8s of waiting before the last one can even fail — 4500ms
     was under the floor and passed only when the machine was quick, which
     is what made this suite intermittently report 0 calls. */
  await p.waitForTimeout(7000);   // both moves burn all three attempts

  const t2=await times();
  const calls2=(await updates())-before;
  const bar2=await p.evaluate(()=>{
    const t=document.querySelector(".toast.unsaved");
    return t ? (t.querySelector(".undo-msg")||{}).textContent : null;
  });

  check(calls2===6,`two moves at three attempts each should be 6 calls, got ${calls2}`);
  check(t2.A && t2.A.s===540,`A should have snapped back to 09:00 on screen, got ${JSON.stringify(t2.A)}`);
  check(t2.B && t2.B.s===560,`B should have snapped back to 09:20, got ${JSON.stringify(t2.B)}`);
  check(/2 changes didn't save/.test(bar2||""),`the unsaved bar should name both lost moves, got ${JSON.stringify(bar2)}`);
  console.log("[permanent]", JSON.stringify({calls:calls2,A:t2.A,B:t2.B,bar:bar2}));

  /* ------------------------------------ 3. Retry replays what was lost */
  await p.evaluate(()=>{ window.__fail={tool:"update_event",n:0}; });
  before=await updates();
  await p.click(".toast.unsaved .undo-btn");
  await p.waitForTimeout(1200);

  const t3=await times();
  const calls3=(await updates())-before;
  const gone=await p.evaluate(()=>!document.querySelector(".toast.unsaved"));

  check(calls3===2,`Retry should replay both held moves, got ${calls3} calls`);
  check(t3.A && t3.A.s===560,`Retry should put A back at 09:20, got ${JSON.stringify(t3.A)}`);
  check(t3.B && t3.B.s===540,`Retry should put B back at 09:00, got ${JSON.stringify(t3.B)}`);
  check(gone,"the unsaved bar should clear once everything saved");
  console.log("[retry]", JSON.stringify({calls:calls3,A:t3.A,B:t3.B,barGone:gone}));

  console.log(bad.length ? "FAIL:\n  ✗ "+bad.join("\n  ✗ ")
                         : "✓ transient writes retry, permanent ones are held and replayable");
  await b.close();
  process.exit(bad.length?1:0);
})();
