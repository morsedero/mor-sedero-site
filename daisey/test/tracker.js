/* A tracker board is read but never scheduled.
   Monster Punk — Audio holds one card per sound, with lists as pipeline
   stages (Waiting → In progress → In review → Fixing → Approved →
   Implemented). Those cards must reach the model — the Pipeline view moves
   them between lists — while staying out of candidates() entirely, or a
   100+ asset board would bury a day that has room for 3 quick tasks.

   The assets here are deliberately the *most* schedulable shape possible:
   no label (= quick task), stale lastActivityAt (= stalled), some overdue.
   If the exclusion is wrong they won't merely leak, they'll outrank the
   real work. */
const fs=require("fs"),vm=require("vm");const {chromium}=require("playwright");
const H=fs.readFileSync(__dirname+"/harness.js","utf8");
const page_html=fs.readFileSync(__dirname+"/daisey.html","utf8");
const sb={require,__dirname,module:{exports:{}},exports:{},console,process};
vm.runInNewContext(H.split("(async () => {")[0]+"\nmodule.exports={stub};",sb);
const BASE=sb.module.exports.stub.replace(/const DAY = [^;]+;/,'const DAY = "2026-08-17";');

const WSB="ari:cloud:trello::board/workspace/6047bc9723ed9c3e9036b496/";
const WSL="ari:cloud:trello::list/workspace/6047bc9723ed9c3e9036b496/";
const WSC="ari:cloud:trello::card/workspace/6047bc9723ed9c3e9036b496/";
const TB="6a82c2cd37d859bc17a06fb8", TBNAME="Monster Punk — Audio";

const STAGES=[["l-wait","Waiting"],["l-prog","In progress"],["l-rev","In review"],
              ["l-fix","Fixing"],["l-appr","Approved"],["l-impl","Implemented"]];

/* 108 assets, spread across the pipeline */
const ASSETS=[];
for(let i=0;i<108;i++){
  const [lid,lname]=STAGES[i%STAGES.length];
  ASSETS.push({
    id:WSC+"asset"+i, name:`sfx_${String(i).padStart(3,"0")}_enemy_hit`, desc:"",
    url:`https://trello.com/c/asset${i}/1-x`, webUrl:`https://trello.com/c/asset${i}/1-x`,
    list:{ id:WSL+lid, name:lname },
    board:{ id:WSB+TB, name:TBNAME },
    labels:[], dueComplete:false, members:[],
    /* worst case for the scheduler: overdue and long untouched */
    due: i%7===0 ? "2026-08-10T06:00:00.000Z" : null,
    lastActivityAt:"2026-06-01T09:00:00.000Z"
  });
}

const inject=`
FIX[${JSON.stringify(TB)}] = ${JSON.stringify(ASSETS)};
LISTS[${JSON.stringify(TB)}] = ${JSON.stringify(STAGES.map(([id,name])=>[id,name]))};
`;
const stub=BASE+inject;

const clock=t=>`const R=Date;const O=new R("${t}").getTime()-R.now();
window.Date=class extends R{constructor(...a){if(a.length===0)super(R.now()+O);else super(...a);}static now(){return R.now()+O;}};`;

(async()=>{
  const b=await chromium.launch({});
  const ctx=await b.newContext({viewport:{width:760,height:1000},timezoneId:"Asia/Jerusalem"});
  const p=await ctx.newPage();const errs=[];
  p.on("pageerror",e=>errs.push(e.message));
  p.on("console",m=>{if(m.type()==="error" && !/^\[daisey\]/.test(m.text()))errs.push(m.text());});
  await p.setContent(`<!doctype html><html><head><meta charset="utf-8"><script>${clock("2026-08-17T08:30:00+03:00")}${stub}<\/script></head><body>${page_html}</body></html>`,{waitUntil:"load"});
  await p.waitForTimeout(3200);

  const r=await p.evaluate(()=>{
    const all=allCards();
    const pool=candidates();
    const isTr=c=>c.boardName==="Monster Punk — Audio";
    const d=new Date();
    const blocks=allEvents().filter(e=>e.isTask&&!e.allDay&&overlapsDay(e,d));
    /* a scheduled block that resolves back to a tracker card is a leak */
    const leaked=blocks.map(e=>cardFor(e)).filter(c=>c&&isTr(c)).map(c=>c.name);
    return {
      allTracker: all.filter(isTr).length,
      poolTracker: pool.filter(isTr).length,
      poolTotal: pool.length,
      listsSeen: [...new Set(all.filter(isTr).map(c=>c.listName))].sort(),
      leaked,
      /* the exclusion must be by board, not by label/blocked side effects */
      sampleUnlabelled: all.filter(isTr).filter(c=>!c.labels.length).length,
      trackerFlagged: all.filter(isTr).every(c=>isTrackerCard(c))
    };
  });

  const bad=[];
  if(r.allTracker===0) bad.push("tracker cards never reached the model at all — nothing was tested");
  if(r.poolTracker>0)  bad.push(`${r.poolTracker} tracker card(s) leaked into candidates()`);
  if(r.leaked.length)  bad.push(`scheduled a tracker card: ${r.leaked.join(", ")}`);
  if(!r.trackerFlagged) bad.push("isTrackerCard() did not agree the cards are tracker cards");
  if(r.poolTotal===0)  bad.push("candidates() is empty — the real boards got excluded too");

  console.log(`tracker cards in model : ${r.allTracker} (unlabelled: ${r.sampleUnlabelled})`);
  console.log(`pipeline lists seen    : ${r.listsSeen.join(" · ")||"(none)"}`);
  console.log(`in candidates()        : ${r.poolTracker}   (pool total ${r.poolTotal})`);

  /* --- the Assets view itself --- */
  /* The Assets tab was pulled from the switcher (2026-08-17) — the tracker
     board stays out of candidates() but the pipeline UI is dormant until a
     later background rework. Drive it directly since there's no button. */
  await p.evaluate(()=>{ S.view="pipeline"; render(); });
  await p.waitForTimeout(500);

  const v=await p.evaluate(()=>({
    cols:[...document.querySelectorAll(".pipe-col")].map(c=>({
      name:(c.querySelector(".pipe-name")||{}).textContent,
      count:(c.querySelector(".pipe-count")||{}).textContent,
      cards:c.querySelectorAll(".asset").length })),
    /* offsetParent===null is "actually not rendered", unlike .hidden which
       an explicit display: rule can quietly override */
    navHidden: $("#prev").offsetParent===null && $("#next").offsetParent===null,
    centreHidden: $(".dash-center").offsetParent===null,
    board:($(".pipe-board")||{}).textContent,
    total:($(".pipe-total")||{}).textContent,
    dashRight:$("#dashRight").hidden
  }));
  console.log(`columns                : ${v.cols.map(c=>`${c.name}(${c.count})`).join(" · ")}`);
  console.log(`header                 : "${v.board}" ${v.total} · nav hidden=${v.navHidden} centre hidden=${v.centreHidden}`);

  if(v.cols.length!==6) bad.push(`expected 6 stage columns, got ${v.cols.length}`);
  if(!v.navHidden) bad.push("prev/next still rendering on a view with no dates");
  if(!v.centreHidden) bad.push(".dash-center still rendering in pipeline mode");
  if(v.board!=="Monster Punk — Audio") bad.push(`view doesn't name its board (got "${v.board}")`);
  const shown=v.cols.reduce((n,c)=>n+c.cards,0);
  if(shown!==108) bad.push(`${shown} asset cards rendered, expected 108`);
  for(const c of v.cols) if(String(c.count)!==String(c.cards))
    bad.push(`column "${c.name}" header says ${c.count} but renders ${c.cards}`);

  /* --- a real move: tap an asset, pick a different stage --- */
  const before=await p.evaluate(()=>{
    const c=allCards().find(x=>x.name==="sfx_000_enemy_hit");
    return { list:c.listName, id:c.id };
  });
  await p.locator(".pipe-col .asset").first().click();
  await p.waitForTimeout(300);
  const opts=await p.locator(".stage-opt:not(.cur)").count();
  await p.locator(".stage-opt:not(.cur)").first().click();
  await p.waitForTimeout(700);

  const after=await p.evaluate(()=>{
    const c=allCards().find(x=>x.name==="sfx_000_enemy_hit");
    return { list:c.listName,
             calls:window.__calls.filter(x=>x.tool==="trelloWriteCard").map(x=>x.input),
             failedBar:!!document.querySelector(".failed-bar,.unsaved") };
  });
  /* `move`, not `update` — `update` takes only name/desc/due and rejects a
     listId, so the shape moveAssetTo originally guessed never committed */
  const mv=after.calls.filter(c=>c.action==="move"&&c.listId);
  console.log(`move                   : "${before.list}" → "${after.list}" (${opts} stage options offered)`);
  console.log(`write sent             : ${mv.length?JSON.stringify(mv[0]):"NONE"}`);

  if(before.list===after.list) bad.push("the asset did not change stage in the model");
  if(!mv.length) bad.push("no trelloWriteCard move+listId call was sent");

  console.log(`page errors            : ${errs.length?errs.join(" | "):"none"}`);
  console.log(bad.length?"FAIL:\n  ✗ "+bad.join("\n  ✗ "):"✓ tracker board reads, renders as a pipeline, and moves");

  await p.screenshot({path:__dirname+"/tracker-pipeline.png",fullPage:true});
  await b.close();
  process.exit(bad.length+errs.length?1:0);
})();
