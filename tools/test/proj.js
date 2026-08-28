/* The Projects manager: does the remaining audio work fit before the deadline?
 *
 * What actually needs guarding here, in rough order of how expensive the bug
 * would be:
 *
 *  1. The scoring mirrored from netlify/functions/audio-sync.js. That function
 *     creates the batch cards; this page predicts what it will create. There is
 *     no shared module (CommonJS function vs. single-file artifact), so the two
 *     copies can only be kept honest by asserting them against each other —
 *     which is what test 1 does, by pulling the real classify()/splitSubject()
 *     source out of the .js file and running it beside the page's copy.
 *  2. saveStats serialises the WHOLE state object. A botched projects write
 *     doesn't just lose a deadline, it can drop the streak, the rollovers and
 *     every setting with it. Test 6 reads the real trelloWriteCard payload.
 *  3. Everything else — chain-merge, coverage, dayOff-aware runway, the
 *     dateless chrome — is ordinary arithmetic that's easy to get subtly wrong
 *     and impossible to notice by eye.
 */
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
const PB="692abd49a69c853bb71cb728";
const MP_LIST="692ad0f8af173930081b8cc0";

/* ---- 1. the real scoring, lifted out of the Netlify function -------------
   Read the source and eval just the two functions, so the assertion is
   against what actually ships rather than a second hand-copy that could
   drift in the same direction as the first. */
const SYNC=fs.readFileSync(__dirname+"/../../netlify/functions/audio-sync.js","utf8");
function lift(name){
  const i=SYNC.indexOf("function "+name+"(");
  if(i<0) throw new Error("couldn't find "+name+"() in audio-sync.js");
  // walk braces from the first { after the signature
  let s=SYNC.indexOf("{",i),d=0,j=s;
  for(;j<SYNC.length;j++){ if(SYNC[j]==="{")d++; else if(SYNC[j]==="}"){d--; if(!d){j++;break;}} }
  return SYNC.slice(i,j);
}
const realBox={};
vm.runInNewContext(lift("classify")+"\n"+lift("splitSubject")+"\nthis.classify=classify;this.splitSubject=splitSubject;",realBox);

/* Words chosen to hit every branch of both keyword lists plus the default,
   and a couple that only *contain* a keyword without matching \b (so a
   sloppy regex rewrite in either file shows up). */
const WORDS=["Green Fire","boss chain reaction","shockwave blast","multi hit","attack sequence",
  "cutscene sting","ui click","menu blip","beep tone","tick","ambient wind","footstep gravel",
  "sword swing","explosion","clicking mechanism","menuing","submenu"];

/* ---- fixtures ----------------------------------------------------------- */
const asset=(id,name,listName,desc)=>({
  id:WSC+id, name, desc:desc||"",
  url:`https://trello.com/c/${id}/1-x`, webUrl:`https://trello.com/c/${id}/1-x`,
  list:{ id:WSL+(listName==="Waiting"?"l-wait":listName==="In progress"?"l-prog":"l-appr"), name:listName },
  board:{ id:WSB+TB, name:TBNAME },
  labels:[], due:null, dueComplete:false, members:[], lastActivityAt:"2026-08-01T09:00:00.000Z"
});

/* Boss: 3 simple-ish items -> 2+2+2 = 6
   Mine Shot chain: 4 parts sharing "Mine Shot - " -> ONE Complex(4), not 4x2=8
   Enemy1: 2 items -> 4
   Ambiance: "ambient" keyword -> 1 each -> 2
   UI: "click"/"menu" -> 1 each -> 2
   Player: 2 standard -> 4
   ...plus one asset in Approved (past the Waiting/In progress gate: ignored)
   ...plus one already covered by a marker (ignored)
   ...plus 2 music tracks: one "3 min" (production -> 16), one no length (demo -> 6) */
const ASSETS=[
  asset("a1","Boss: Green Fire","Waiting"),
  asset("a2","Boss: Ground Smash","Waiting"),
  asset("a3","Boss: Roar","In progress"),
  asset("c1","Boss: Mine Shot - fire","Waiting"),
  asset("c2","Boss: Mine Shot - loop","Waiting"),
  asset("c3","Boss: Mine Shot - ground contact","Waiting"),
  asset("c4","Boss: Mine Shot - explosion","Waiting"),
  asset("e1","Enemy1: Step","Waiting"),
  asset("e2","Enemy1: Death","Waiting"),
  asset("m1","Ambiance: ambient forest bed","Waiting"),
  asset("m2","Ambiance: ambient cave bed","Waiting"),
  asset("u1","UI: menu open","Waiting"),
  asset("u2","UI: click confirm","Waiting"),
  asset("p1","Player: Jump","Waiting"),
  asset("p2","Player: Land","Waiting"),
  asset("done1","Enemy2: Spawn","Approved"),          // past the stage gate
  asset("cov1","Enemy3: Charge","Waiting"),           // covered by the marker below
  asset("mus1","Music: GameLoop","Waiting","3 min, main loop"),
  asset("mus2","Music: Menu Theme","Waiting","first pass demo")
];

/* One PROJECTS batch card carrying a real audio-sync marker: covers cov1, and
   is itself an open yellow (session) batch = 6 pts of committed work.
   The ids here are deliberately RAW, not ARI-wrapped, because audio-sync.js
   talks to the Trello REST API directly and that is the only id shape it can
   possibly write. Daisey's own c.id is an ARI, so this is exactly the mismatch
   that has to be normalised — an ARI here would make the test pass against a
   page that could never match real data. */
const MARK=`<!-- daisey-audio-sync v1 subject="Enemy3" board="${TB}" items="cov1:2" -->`;
const BATCH={
  id:WSC+"batch1", name:"SFX batch: Enemy3", desc:"Covers the charge cue.\n\n"+MARK,
  url:"https://trello.com/c/batch1/1-x", webUrl:"https://trello.com/c/batch1/1-x",
  list:{ id:WSL+MP_LIST, name:"MonsterPunk" },
  board:{ id:WSB+PB, name:"PROJECTS" },
  labels:[{id:"lbl-y",name:"",color:"yellow"}], due:null, dueComplete:false, members:[],
  lastActivityAt:"2026-08-01T09:00:00.000Z"
};
/* A hand-written card on the same list with NO marker — must stay invisible to
   the whole system: not coverage, not committed points. */
const HAND={
  id:WSC+"hand1", name:"Implement approved combat SFX", desc:"no marker here",
  url:"https://trello.com/c/hand1/1-x", webUrl:"https://trello.com/c/hand1/1-x",
  list:{ id:WSL+MP_LIST, name:"MonsterPunk" },
  board:{ id:WSB+PB, name:"PROJECTS" },
  labels:[{id:"lbl-o",name:"",color:"orange"}], due:null, dueComplete:false, members:[],
  lastActivityAt:"2026-08-01T09:00:00.000Z"
};

const STAGES=[["l-wait","Waiting"],["l-prog","In progress"],["l-appr","Approved"]];
const inject=`
FIX[${JSON.stringify(TB)}] = ${JSON.stringify(ASSETS)};
LISTS[${JSON.stringify(TB)}] = ${JSON.stringify(STAGES)};
FIX[${JSON.stringify(PB)}] = FIX[${JSON.stringify(PB)}].concat(${JSON.stringify([BATCH,HAND])});
`;
const stub=BASE+inject;
const clock=t=>`const R=Date;const O=new R("${t}").getTime()-R.now();
window.Date=class extends R{constructor(...a){if(a.length===0)super(R.now()+O);else super(...a);}static now(){return R.now()+O;}};`;

/* expected points, computed here by hand so the test states its own arithmetic
   rather than echoing whatever the page happens to say */
const EXP_BOSS = 2+2+2+4;   // 3 singles + one merged chain
const EXP_ENEMY1 = 4, EXP_AMB = 2, EXP_UI = 2, EXP_PLAYER = 4;
const EXP_UNBATCHED = EXP_BOSS+EXP_ENEMY1+EXP_AMB+EXP_UI+EXP_PLAYER;   // 10+4+2+2+4 = 22
const EXP_MUSIC = 16+6;                                                 // 22
const EXP_OPENBATCH = 6;                                                // one yellow
const EXP_REMAINING = EXP_UNBATCHED+EXP_MUSIC+EXP_OPENBATCH;            // 50

(async()=>{
  const b=await chromium.launch({});
  const ctx=await b.newContext({viewport:{width:760,height:1100},timezoneId:"Asia/Jerusalem"});
  const p=await ctx.newPage();const errs=[];
  p.on("pageerror",e=>errs.push(e.message));
  p.on("console",m=>{if(m.type()==="error" && !/^\[daisey\]/.test(m.text()))errs.push(m.text());});
  await p.setContent(`<!doctype html><html><head><meta charset="utf-8"><script>${clock("2026-08-17T08:30:00+03:00")}${stub}<\/script></head><body>${page_html}</body></html>`,{waitUntil:"load"});
  await p.waitForTimeout(3200);
  await p.evaluate(()=>{S.scheduleOpen=true;render();});

  const bad=[];

  /* ---- 1. the mirrored scoring still agrees with audio-sync.js ---------- */
  const mine=await p.evaluate(ws=>ws.map(w=>audioClassify(w)),WORDS);
  const theirs=WORDS.map(w=>realBox.classify(w));
  const drift=WORDS.filter((w,i)=>mine[i]!==theirs[i]);
  if(drift.length) bad.push(`scoring drifted from audio-sync.js on: ${drift.map((w,i)=>`"${w}"`).join(", ")}`);
  console.log(`scoring vs audio-sync  : ${WORDS.length-drift.length}/${WORDS.length} agree`);

  const splits=await p.evaluate(()=>[
    splitSubject("Boss: Green Fire"), splitSubject("no colon here"), splitSubject("A: b: c")
  ]);
  const theirSplits=[realBox.splitSubject("Boss: Green Fire"),realBox.splitSubject("no colon here"),realBox.splitSubject("A: b: c")];
  if(JSON.stringify(splits)!==JSON.stringify(theirSplits))
    bad.push(`splitSubject drifted: page ${JSON.stringify(splits)} vs sync ${JSON.stringify(theirSplits)}`);

  /* ---- 2 + 3. the snapshot: coverage, stage gate, chain-merge ----------- */
  const s=await p.evaluate(()=>{
    const board=TRACKERS[0];
    const x=projectSnapshot(board);
    return { listName:x.listName, openAssetCount:x.openAssetCount,
             covered:[...x.covered].length, subjects:x.subjects,
             unbatchedPoints:x.unbatchedPoints, openBatches:x.openBatches,
             openBatchPoints:x.openBatchPoints, musicPoints:x.musicPoints,
             music:x.music.length, remainingPoints:x.remainingPoints,
             pressure:x.pressure, workDays:x.workDays, baseCards:x.baseCards };
  });
  console.log(`project                : "${s.listName}" · ${s.openAssetCount} open assets`);
  console.log(`segments               : ${s.subjects.map(g=>`${g.subject}(${g.points})`).join(" · ")}`);
  console.log(`points                 : unbatched ${s.unbatchedPoints} + music ${s.musicPoints} + open batch ${s.openBatchPoints} = ${s.remainingPoints}`);

  if(s.listName!=="Monster Punk")
    bad.push(`project name should strip the "— Audio" suffix, got "${s.listName}"`);
  if(s.covered!==1) bad.push(`marker coverage: expected 1 covered id, got ${s.covered}`);
  const boss=s.subjects.find(g=>g.subject==="Boss");
  if(!boss) bad.push("Boss segment missing entirely");
  else if(boss.points!==EXP_BOSS)
    bad.push(`chain-merge: Boss should be ${EXP_BOSS} pts (3 singles + ONE merged Mine Shot chain), got ${boss.points}`);
  if(s.subjects.some(g=>g.subject==="Music")) bad.push("Music leaked into the point-packed segments");
  if(s.subjects.some(g=>g.subject==="Enemy2")) bad.push("an Approved-stage asset leaked past the stage gate");
  if(s.subjects.some(g=>g.subject==="Enemy3")) bad.push("a marker-covered asset was counted again as unbatched");
  if(s.unbatchedPoints!==EXP_UNBATCHED) bad.push(`unbatched points: expected ${EXP_UNBATCHED}, got ${s.unbatchedPoints}`);
  if(s.music!==2) bad.push(`expected 2 music tracks, got ${s.music}`);
  if(s.musicPoints!==EXP_MUSIC) bad.push(`music points: expected ${EXP_MUSIC} (one "3 min" production + one demo), got ${s.musicPoints}`);
  if(s.openBatches!==1) bad.push(`expected 1 open marked batch (the unmarked hand-written card must not count), got ${s.openBatches}`);
  if(s.openBatchPoints!==EXP_OPENBATCH) bad.push(`open batch points: expected ${EXP_OPENBATCH}, got ${s.openBatchPoints}`);
  if(s.remainingPoints!==EXP_REMAINING) bad.push(`remaining: expected ${EXP_REMAINING}, got ${s.remainingPoints}`);

  /* ---- 4. no deadline -> no pressure, and the view still renders -------- */
  if(s.pressure!==null) bad.push(`no deadline should mean pressure===null, got ${s.pressure}`);
  await p.evaluate(()=>{ S.view="projects"; render(); });
  await p.waitForTimeout(400);
  const v0=await p.evaluate(()=>({
    cards:document.querySelectorAll(".proj-card").length,
    band:(document.querySelector(".proj-band")||{}).textContent,
    navHidden:$("#prev").offsetParent===null && $("#next").offsetParent===null,
    centreHidden:$(".dash-center").offsetParent===null,
    dashRight:$("#dashRight").hidden,
    hasBar:!!document.querySelector(".proj-bar")
  }));
  console.log(`view (no deadline)     : ${v0.cards} card · band "${v0.band}" · nav hidden=${v0.navHidden}`);
  if(v0.cards!==1) bad.push(`expected 1 project card, got ${v0.cards}`);
  if(v0.band!=="No deadline") bad.push(`band with no deadline should read "No deadline", got "${v0.band}"`);
  if(v0.hasBar) bad.push("a pressure bar rendered with no deadline to measure against");
  if(!v0.navHidden) bad.push("prev/next still rendering on the dateless Projects view");
  if(!v0.centreHidden) bad.push(".dash-center still rendering on the Projects view");

  /* ---- 5. runway skips the day off, and a past deadline doesn't crash --- */
  const rw=await p.evaluate(()=>{
    const from=new Date("2026-08-17T08:00:00+03:00");        // Monday
    return {
      dayOff:CFG.dayOff,
      twoWeeks:countWorkDays(from,new Date("2026-08-31T00:00:00")),   // 14 days
      sameDay:countWorkDays(from,new Date("2026-08-17T00:00:00")),
      past:countWorkDays(from,new Date("2026-08-10T00:00:00"))
    };
  });
  /* 18–31 Aug inclusive is 14 days; with dayOff=6 (Sat) that drops the 22nd
     and the 29th → 12 */
  console.log(`runway                 : 14 calendar days -> ${rw.twoWeeks} work days (dayOff=${rw.dayOff})`);
  if(rw.twoWeeks!==12) bad.push(`countWorkDays should skip the day off: expected 12 over 14 days, got ${rw.twoWeeks}`);
  if(rw.sameDay!==0) bad.push(`a same-day deadline should give 0 work days, got ${rw.sameDay}`);
  if(rw.past!==0) bad.push(`a past deadline should give 0 work days, not a negative (${rw.past})`);

  const tight=await p.evaluate(()=>{
    S.stats.projects.mpaudio={deadline:"2026-08-10",setAt:null,note:""};   // already gone
    _snapCache=null;
    const x=projectSnapshot(TRACKERS[0]);
    render();
    return { pressure:x.pressure, band:pressureBand(x.pressure).word, workDays:x.workDays };
  });
  await p.waitForTimeout(300);
  console.log(`past deadline          : ${tight.workDays} work days · pressure ${tight.pressure} · "${tight.band}"`);
  if(tight.band!=="Over") bad.push(`a past deadline should read "Over", got "${tight.band}"`);
  if(Number.isNaN(tight.pressure)) bad.push("past deadline produced NaN pressure (divide by zero leaked)");

  /* the tier boost only fires for audio-sync's own marked cards */
  const tiers=await p.evaluate(()=>{
    const all=allCards();
    const marked=all.find(c=>c.name==="SFX batch: Enemy3");
    const hand=all.find(c=>c.name==="Implement approved combat SFX");
    return { marked:projectPressureOf(marked), hand:projectPressureOf(hand),
             markedTier:tierOf(marked), handTier:tierOf(hand) };
  });
  console.log(`tier boost             : marked card tier ${tiers.markedTier} (pressure ${tiers.marked}) · unmarked tier ${tiers.handTier}`);
  if(tiers.hand!==null) bad.push("projectPressureOf matched a card with no audio-sync marker");
  if(tiers.marked===null) bad.push("projectPressureOf found no pressure for a properly marked batch card — check bareBoardId vs the ARI-wrapped BOARDS id");
  if(tiers.markedTier!==2) bad.push(`an over-pressure batch card should reach tier 2, got ${tiers.markedTier}`);

  /* ---- 6. the deadline round-trips WITHOUT eating the rest of the state - */
  /* Give the state something to lose first. The fixture's state card has no
     `settings` key (only saveCfg ever writes one), so without this the
     "settings survived" assertion would pass vacuously against a page that
     drops them. */
  await p.evaluate(()=>{ saveCfg(); });
  await p.waitForTimeout(600);
  const before=await p.evaluate(()=>({
    streak:S.stats.streak,
    rollovers:Object.keys(S.stats.rollovers||{}).length,
    hadSettings:!!(S.stats.settings&&S.stats.settings.dayStart!==undefined)
  }));
  if(!before.hadSettings) bad.push("test setup: saveCfg() didn't put settings on S.stats, so the survival check below is vacuous");
  await p.evaluate(()=>{ window.__calls.length=0; saveProjectDeadline("mpaudio","2026-10-15"); });
  await p.waitForTimeout(900);
  const wr=await p.evaluate(()=>{
    const w=window.__calls.filter(c=>c.tool==="trelloWriteCard").pop();
    if(!w) return {none:true};
    const d=w.input.desc||"";
    const i=d.indexOf("<!--DAYFLOW_STATE_V1"), j=d.indexOf("DAYFLOW_STATE_V1-->");
    let parsed=null;
    try{ parsed=JSON.parse(d.slice(i+"<!--DAYFLOW_STATE_V1".length,j).trim()); }catch(e){}
    return { parsed, live:S.stats.projects };
  });
  if(wr.none) bad.push("saving a deadline sent no trelloWriteCard at all");
  else if(!wr.parsed) bad.push("the state card payload didn't parse back as JSON");
  else{
    const q=wr.parsed;
    console.log(`state card write       : deadline=${q.projects&&q.projects.mpaudio&&q.projects.mpaudio.deadline} streak=${q.streak} rollovers=${Object.keys(q.rollovers||{}).length} settings=${!!q.settings}`);
    if(!q.projects||!q.projects.mpaudio||q.projects.mpaudio.deadline!=="2026-10-15")
      bad.push("the deadline didn't reach the state card payload");
    if(q.streak!==before.streak) bad.push(`saving a deadline changed the streak (${before.streak} -> ${q.streak})`);
    if(Object.keys(q.rollovers||{}).length!==before.rollovers)
      bad.push("saving a deadline dropped the rollover memory");
    if(!q.settings) bad.push("saving a deadline dropped the settings");
  }

  /* and the view now reflects it */
  await p.evaluate(()=>render());
  await p.waitForTimeout(400);
  const v1=await p.evaluate(()=>({
    band:(document.querySelector(".proj-band")||{}).textContent,
    hasBar:!!document.querySelector(".proj-bar"),
    dense:(document.querySelector(".proj-dense-b")||{}).textContent||"",
    segs:document.querySelectorAll(".proj-seg").length,
    deadline:(document.querySelector(".proj-deadline .proj-v")||{}).textContent
  }));
  console.log(`view (deadline set)    : "${v1.deadline}" · band "${v1.band}" · ${v1.segs} segments`);
  if(!v1.hasBar) bad.push("no pressure bar rendered once a deadline was set");
  if(v1.band==="No deadline") bad.push("band still reads 'No deadline' after one was saved");
  if(!/Oct/.test(v1.deadline||"")) bad.push(`the deadline row doesn't show the saved date (got "${v1.deadline}")`);
  if(v1.segs!==5) bad.push(`expected 5 segment rows (Boss/Enemy1/Ambiance/UI/Player), got ${v1.segs}`);

  /* ---- 7. a corrupt projects value must not take the page down --------- */
  const junk=await p.evaluate(()=>{
    const out={};
    for(const v of ["nonsense",null,42,{mpaudio:"not an object"},{mpaudio:{deadline:"13/10/2026"}}]){
      try{ out[JSON.stringify(v)]=normProjects(v).mpaudio.deadline; }
      catch(e){ out[JSON.stringify(v)]="THREW: "+e.message; }
    }
    return out;
  });
  for(const k in junk) if(junk[k]!==null) bad.push(`normProjects(${k}) should normalise to null, got ${JSON.stringify(junk[k])}`);
  console.log(`corrupt state           : ${Object.keys(junk).length} bad shapes all normalised to null`);

  /* ---- 8. a segment opens its assets, and one can be moved a stage -----
     This is the ONLY reachable path to assetMoveDialog/moveAssetTo since the
     Assets tab left the switcher — if the segment rows stop being buttons,
     the whole pipeline-move feature goes dark again with nothing to notice
     it, which is exactly how it went dark the first time. */
  await p.evaluate(()=>{ S.view="projects"; render(); });
  await p.waitForTimeout(400);
  const segCount=await p.evaluate(()=>document.querySelectorAll("button.proj-seg").length);
  if(!segCount) bad.push("segment rows aren't buttons — assetMoveDialog is unreachable again");
  await p.locator("button.proj-seg").first().click();
  await p.waitForTimeout(350);
  const sheet=await p.evaluate(()=>({
    assets:document.querySelectorAll(".seg-asset").length,
    stages:[...document.querySelectorAll(".seg-asset-stage")].map(s=>s.textContent)
  }));
  console.log(`segment sheet          : ${sheet.assets} assets · stages ${[...new Set(sheet.stages)].join("/")}`);
  if(!sheet.assets) bad.push("the segment sheet listed no assets");
  if(!sheet.stages.every(Boolean)) bad.push("an asset row didn't show its current stage");

  const before8=await p.evaluate(()=>{
    const c=allCards().find(x=>x.name==="Boss: Green Fire");
    return c?c.listName:null;
  });
  await p.locator(".seg-asset").first().click();
  await p.waitForTimeout(350);
  const opts=await p.locator(".stage-opt:not(.cur)").count();
  if(!opts) bad.push("assetMoveDialog offered no stage to move to");
  await p.locator(".stage-opt:not(.cur)").first().click();
  await p.waitForTimeout(800);
  const after8=await p.evaluate(()=>({
    moves:window.__calls.filter(c=>c.tool==="trelloWriteCard"&&c.input.action==="move"&&c.input.listId).length,
    failed:!!document.querySelector(".failed-bar,.unsaved")
  }));
  console.log(`stage move             : "${before8}" → ${after8.moves} move write(s) sent`);
  if(!after8.moves) bad.push("no trelloWriteCard move+listId call was sent from the Projects view");
  if(after8.failed) bad.push("the move landed in the unsaved-changes bar");

  console.log(`page errors            : ${errs.length?errs.join(" | "):"none"}`);
  console.log(bad.length?"FAIL:\n  ✗ "+bad.join("\n  ✗ "):"✓ projects manager: scoring mirrors audio-sync, snapshot maths hold, deadline round-trips intact, assets move stage");

  await p.screenshot({path:__dirname+"/proj-view.png",fullPage:true});
  await b.close();
  process.exit(bad.length+errs.length?1:0);
})();
