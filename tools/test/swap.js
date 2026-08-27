/* swapTo() used to carry the outgoing slot's own duration straight over to
   whatever card landed in it — swap a 20-minute quick task's slot for a
   3-hour session and the block stayed 20 minutes. A session has a real
   size of its own (CFG.shortMin) and now gets it, found via a fresh
   findSlots() search anchored at the old slot's start time — not the old
   slot's own length.

   Quick tasks are the opposite: they have no size of their own (one quick
   task's slot length depends on how many others share the quickTotal
   window at build time), so a quick card swapped into any slot — same
   size or not — always keeps that slot's own length untouched. Swapping a
   quick card into a long-standing slot (colorId "11", from before the
   work-day size was removed 2026-08-24 — still readable off old real
   calendar blocks, see daisey.html's allEvents) leaving it that long is
   correct, not a regression of this fix.

   Each case reseeds a lone quick task at 09:00-09:20 on an otherwise empty
   day rather than chaining off the previous case's result. */
const fs=require("fs"),vm=require("vm");const {chromium}=require("playwright");
const H=fs.readFileSync(__dirname+"/harness.js","utf8");
const page_html=fs.readFileSync(__dirname+"/daisey.html","utf8");
const sb={require,__dirname,module:{exports:{}},exports:{},console,process};
vm.runInNewContext(H.split("(async () => {")[0]+"\nmodule.exports={stub};",sb);
const BASE=sb.module.exports.stub;

const ev = (id, letter, s, e, short) => ({
  id, colorId:"9", summary:`• Task ${letter}`,
  description:`[daisey] Task ${letter}\n\nOriginal: https://trello.com/c/${short}/1-x`,
  start:{dateTime:`2026-08-17T${s}:00+03:00`,timeZone:"Asia/Jerusalem"},
  end:{dateTime:`2026-08-17T${e}:00+03:00`,timeZone:"Asia/Jerusalem"},
  status:"confirmed"
});
const evSized = (id, letter, s, e, short, colorId) => {
  const raw = ev(id, letter, s, e, short);
  raw.colorId = colorId;
  return raw;
};
const EVENTS=[ ev("qa","A","09:00","09:20","Y9SpnlTP") ];
// colorId "11" is a legacy block — nothing writes it any more (work-day size
// removed 2026-08-24), but a real one may still sit on someone's calendar.
const LEGACY_LONG_EVENTS=[ evSized("qb","B","09:15","17:15","TXxCAu3T","11") ];

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
  await p.setContent(`<!doctype html><html><head><meta charset="utf-8"><script>${clock("2026-08-17T07:00:00+03:00")}${BASE}<\/script></head><body>${page_html}</body></html>`,{waitUntil:"load"});
  await p.waitForTimeout(2600);

  const seed=async(events)=>{
    await p.evaluate(events=>{
      EVENTS.length=0; EVENTS.push(...JSON.parse(JSON.stringify(events)));
      S.events={ payload:{ events:EVENTS }, storedAt:Date.now() };
      S.failed=[]; S.pending.clear(); S.stats.rollovers={};
      render();
    }, events);
    await p.waitForTimeout(300);
  };
  const swap=(shortLink, name, size)=>p.evaluate(({shortLink,name,size})=>{
    const item = { ev: allEvents().find(e=>e.isTask), task:true };
    const card = { id:"synthetic-"+shortLink, name, shortLink,
      boardKey:"sedco", boardName:"סדקו", size, est:null, url:`https://trello.com/c/${shortLink}/1-x`,
      due:null, dueComplete:false, blocked:false, overdue:false, dueToday:false, deep:size!=="quick", labels:[] };
    swapTo(item, card);
  }, {shortLink,name,size});
  const state=()=>p.evaluate(()=>{
    const e = allEvents().find(e=>e.isTask);
    return e ? { s:minsOf(e.start), e:minsOf(e.end), dur:minsOf(e.end)-minsOf(e.start), size:e.size, cardShort:e.cardShort } : null;
  });

  /* How many TIMES the swapped-in card appears — in the model and on screen.
     Every assertion above reads allEvents().find(), the FIRST match, so a
     swap that left a duplicate behind passed all of them while rendering the
     card twice. That is exactly what shipped: swapTo added a local stand-in
     for the new block and never dropped it once the real event arrived, so
     both sat in S.events.payload.events (the array allEvents() reads) and
     the day showed two identical rows, one of them not real.
     applyPlan and commitRelay had always dropped their stand-ins; swapTo
     never did. Counting, not finding, is what catches it. */
  const occurrences = async (shortLink) => p.evaluate((sl)=>({
    events: allEvents().filter(e=>e.isTask && e.cardShort===sl).length,
    /* Rendered rows carrying this card's own start minute. agenda() can't be
       keyed on card.shortLink here — these are synthetic fixture cards that
       don't resolve through cardFor — so the DOM is the honest second read. */
    rows: [...document.querySelectorAll("#pageMain .time-row, #heroSlot .time-row")]
            .filter(r=>r.dataset && r.dataset.min !== undefined).length,
  }), shortLink);

  // quick (20min) -> short: should grow to CFG.shortMin, not stay at 20min
  await seed(EVENTS);
  await swap("synthShort1", "Synthetic Session", "short");
  await p.waitForTimeout(900);
  let st = await state();
  const shortMin = await p.evaluate(()=>CFG.shortMin);
  console.log("[quick->short]", JSON.stringify(st), "want dur", shortMin);
  check(!!st && st.cardShort==="synthShort1", "the short card should now hold the slot");
  check(st && st.dur===shortMin, `swapping in a session should grow the block to ${shortMin}min, got ${st&&st.dur}`);
  let occ = await occurrences("synthShort1");
  console.log("[quick->short occurrences]", JSON.stringify(occ));
  check(occ.events===1, `the swapped-in card should hold exactly ONE block, got ${occ.events} — a leftover local stand-in renders as a duplicate row`);

  // legacy long block (already on the calendar, not just-swapped-in) ->
  // quick: a quick card has no size of its own, so it keeps whatever slot
  // it lands in — the old 8h block stays 8h, on purpose
  await seed(LEGACY_LONG_EVENTS);
  const beforeQuick = await state();
  await swap("synthQuick1", "Synthetic Quick", "quick");
  await p.waitForTimeout(900);
  st = await state();
  console.log("[legacy-long->quick]", JSON.stringify({beforeQuick, after:st}));
  check(!!st && st.cardShort==="synthQuick1", "the quick card should now hold the slot");
  check(st && beforeQuick && st.dur===beforeQuick.dur, `a quick card has no size of its own — it should keep the slot's ${beforeQuick&&beforeQuick.dur}min length, got ${st&&st.dur}`);
  occ = await occurrences("synthQuick1");
  console.log("[legacy-long->quick occurrences]", JSON.stringify(occ));
  check(occ.events===1, `the swapped-in card should hold exactly ONE block, got ${occ.events}`);

  // quick -> quick: same "no size of its own" case, the slot must not move
  await seed(EVENTS);
  const before = await state();
  await swap("synthQuick2", "Synthetic Quick Two", "quick");
  await p.waitForTimeout(900);
  st = await state();
  console.log("[quick->quick]", JSON.stringify({before,after:st}));
  check(!!st && st.cardShort==="synthQuick2", "the second quick card should now hold the slot");
  check(st && before && st.s===before.s && st.dur===before.dur, "a same-size swap shouldn't move or resize the slot at all");
  occ = await occurrences("synthQuick2");
  console.log("[quick->quick occurrences]", JSON.stringify(occ));
  check(occ.events===1, `the swapped-in card should hold exactly ONE block, got ${occ.events}`);

  console.log(bad.length ? "FAIL:\n  ✗ "+bad.join("\n  ✗ ")
                         : "✓ a swap resizes the slot to the incoming card's own size, and leaves exactly one block behind");
  await b.close();
  process.exit(bad.length?1:0);
})();
