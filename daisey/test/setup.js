/* Multi-user setup: can somebody who ISN'T this app's author use it?
 *
 * Until 2026-08-24 the answer was no. The calendar address, the Trello
 * workspace id, four board ARIs and the state card's home board were all
 * literals. A different viewer got a permanent skeleton — or, if a connector
 * happened to resolve, the author's own calendar rendered inside their app.
 *
 * The cases here are the ones that actually distinguish "works for anyone"
 * from "looks like it works because I'm the author":
 *   1. A viewer who can't see the author's boards gets the wizard, never his
 *      boards. This is the leak that would matter most.
 *   2. Finishing the wizard produces a working identity and creates the
 *      state list on the board they chose.
 *   3. Board CSS is generated, and resolves BOTH --bc and --bc-soft. The old
 *      applyColors set only --bc, so a recoloured board kept a stale tint.
 *   4. A board that ERRORS still lets the app boot. That was an unbounded
 *      hang: the settle gate waited for success that never came.
 *   5. No batch board => no Projects tab, and nothing downstream throws.
 *   6. The author's own install still boots straight in, with his keys.
 */
const fs=require("fs"),vm=require("vm");const {chromium}=require("playwright");
const H=fs.readFileSync(__dirname+"/harness.js","utf8");
const page_html=fs.readFileSync(__dirname+"/daisey.html","utf8");
const sb={require,__dirname,module:{exports:{}},exports:{},console,process};
vm.runInNewContext(H.split("(async () => {")[0]+"\nmodule.exports={stub};",sb);
const BASE=sb.module.exports.stub.replace(/const DAY = [^;]+;/,'const DAY = "2026-08-17";');
const clock=t=>`const R=Date;const O=new R("${t}").getTime()-R.now();
window.Date=class extends R{constructor(...a){if(a.length===0)super(R.now()+O);else super(...a);}static now(){return R.now()+O;}};`;

/* pre: JS that runs BEFORE the stub, to set the __NO_SETUP / __BOARDS_VISIBLE
   switches the harness reads. */
async function open(b, pre, w, h){
  const ctx=await b.newContext({viewport:{width:w||900,height:h||1000},timezoneId:"Asia/Jerusalem"});
  const p=await ctx.newPage();const errs=[];
  p.on("pageerror",e=>errs.push(e.message));
  /* "[daisey] ..." lines are logErr's deliberate diagnostics, not page errors.
     They exist because this file used to have ONE console.error in ~5700
     lines, so a half-failed run left nothing to debug with. A connector that
     hasn't loaded yet is a handled, queued-for-retry condition the wizard
     recovers from — it must not read as a crash. */
  p.on("console",m=>{if(m.type()==="error" && !/^\[daisey\]/.test(m.text()))errs.push(m.text());});
  await p.setContent(`<!doctype html><html><head><meta charset="utf-8"><script>${clock("2026-08-17T09:00:00+03:00")}${pre||""}${BASE}<\/script></head><body>${page_html}</body></html>`,{waitUntil:"load"});
  await p.waitForTimeout(3800);
  return {ctx,p,errs};
}

(async()=>{
  const b=await chromium.launch({});
  const bad=[];
  const check=(ok,msg)=>{ if(!ok) bad.push(msg); };

  /* ---- 1. a DIFFERENT viewer: cannot see the author's boards ---------- */
  {
    const {ctx,p,errs}=await open(b,`window.__NO_SETUP=true;window.__BOARDS_VISIBLE=[];`);
    const r=await p.evaluate(()=>({
      wizard:!!document.querySelector(".setup-board")||!!document.querySelector(".dialog.sheet"),
      setup:SETUP, boards:BOARDS.length, cal:CAL_ID,
      /* innerHTML would match the app's own <script> source, which legitimately
         contains LEGACY_SETUP. Only RENDERED text can leak to a viewer. */
      leaked:/morsedero|סידורים|Monster Punk/.test(document.body.innerText||"")
    }));
    console.log(`new viewer            : wizard=${r.wizard} boards=${r.boards} CAL_ID=${r.cal}`);
    check(r.wizard, "a new viewer got no setup wizard");
    check(r.setup===null, "a new viewer inherited a SETUP they never chose");
    check(r.boards===0, `a new viewer inherited ${r.boards} boards`);
    check(r.cal===null, `a new viewer inherited the calendar ${r.cal}`);
    check(!r.leaked, "the author's boards/calendar are VISIBLE to another viewer");
    check(!errs.length, "errors on a fresh viewer: "+errs.join("|"));
    await ctx.close();
  }

  /* ---- 2. finishing the wizard builds a working identity -------------- */
  {
    /* Their own boards are visible, but they've never run Daisey (no state
       card) and they are not the author (the legacy probe must miss). Both
       switches are needed: either one alone still adopts an existing setup. */
    const {ctx,p,errs}=await open(b,`window.__NO_SETUP=true;window.__NO_STATE_CARD=true;window.__NO_LEGACY=true;`);
    const seen=await p.evaluate(()=>[...document.querySelectorAll(".setup-bn")].map(e=>e.textContent));
    check(seen.length===4, `wizard listed ${seen.length} boards, expected the viewer's 4`);
    /* tick boards 1 and 4, mark 4 a tracker */
    await p.locator(".setup-board").nth(0).locator(".setup-tick").click();
    await p.locator(".setup-board").nth(3).locator(".setup-tick").click();
    await p.locator(".setup-board").nth(3).locator(".setup-trk").click();
    await p.locator(".df .btn.primary").click();          // -> calendar
    await p.waitForTimeout(500);
    const cals=await p.evaluate(()=>[...document.querySelectorAll(".setup-cal")].length);
    check(cals===2, `calendar step listed ${cals} calendars, expected 2`);
    await p.locator(".setup-cal").nth(1).click();          // the Work calendar
    await p.locator(".df .btn.primary").click();          // -> home + day off
    await p.waitForTimeout(500);
    const homes=await p.evaluate(()=>document.querySelectorAll(".setup-home").length);
    check(homes===1, `state-card step offered ${homes} boards, expected only the non-tracker one`);
    const before=await p.evaluate(()=>window.__calls.filter(c=>c.tool==="trelloWriteList").length);
    /* finish() ends with location.reload() on a first run. Location.reload
       cannot be shadowed (documented in CLAUDE.md — assignment silently
       no-ops), so the page really does reload and takes window.__calls and
       the app's globals with it. Capture the outcome from inside the click
       instead: run finish()'s own path and read the result before the
       reload lands. */
    await p.locator(".df .btn.primary").click();
    await p.waitForTimeout(1000);
    const r=await p.evaluate(()=>({
      boards:BOARDS.map(x=>({key:x.key,name:x.name,tracker:x.tracker})),
      cal:CAL_ID, stats:SETUP&&SETUP.statsBoardKey, batch:SETUP&&SETUP.batchBoardKey,
      writes:window.__calls.filter(c=>c.tool==="trelloWriteList")
               .map(c=>({a:c.input.action,name:c.input.name,board:c.input.boardId})),
      css:(document.getElementById("boardCss")||{}).textContent||"",
      wizardGone: !document.querySelector(".setup-board")
    }));
    check(r.wizardGone, "the wizard stayed open after finishing");
    {
    console.log(`wizard finish         : keys=${r.boards.map(x=>x.key).join(",")} cal=${r.cal} stats=${r.stats}`);
    check(r.boards.length===2, `expected 2 boards after setup, got ${r.boards.length}`);
    check(r.boards.filter(x=>x.tracker).length===1, "the tracker flag didn't survive setup");
    check(r.cal==="work@group.calendar.google.com", `wrong calendar picked: ${r.cal}`);
    check(r.batch===null, "a new viewer got a batchBoardKey they can't use");
    check(r.writes.length-before===1, `expected exactly 1 trelloWriteList create, got ${r.writes.length-before}`);
    check(/Daisey/.test((r.writes[0]||{}).name||""), "the state list name wouldn't match STATS_LIST_RE");
    const home=r.boards.find(x=>x.key===r.stats);
    check(home && !home.tracker, "the state card was homed on a tracker board");
    /* keys must be fresh b0/b1, never the author's */
    check(r.boards.every(x=>/^b\d+$/.test(x.key)), `keys aren't freshly minted: ${r.boards.map(x=>x.key)}`);
    for(const bd of r.boards)
      check(r.css.includes(".bk-"+bd.key), `no generated CSS rule for board ${bd.key}`);
    }
    check(!errs.length, "errors finishing the wizard: "+errs.join("|"));
    await ctx.close();
  }

  /* ---- 3. generated CSS resolves BOTH --bc and --bc-soft -------------- */
  {
    const {ctx,p}=await open(b,"");
    const r=await p.evaluate(()=>{
      const out={};
      for(const bd of BOARDS){
        const d=document.createElement("div"); d.className="bk-"+bd.key;
        document.body.appendChild(d);
        const cs=getComputedStyle(d);
        out[bd.key]={bc:cs.getPropertyValue("--bc").trim(),soft:cs.getPropertyValue("--bc-soft").trim()};
        d.remove();
      }
      /* recolour one board and confirm the tint follows the spine — the
         exact bug in the old applyColors */
      CFG.colors = { ...(CFG.colors||{}), [BOARDS[0].key]:"#123456" };
      applyColors(CFG.colors);
      const d2=document.createElement("div"); d2.className="bk-"+BOARDS[0].key;
      document.body.appendChild(d2);
      const cs2=getComputedStyle(d2);
      const after={bc:cs2.getPropertyValue("--bc").trim(),soft:cs2.getPropertyValue("--bc-soft").trim()};
      d2.remove();
      return {out,after};
    });
    for(const k in r.out){
      check(!!r.out[k].bc, `board ${k} resolved no --bc`);
      check(!!r.out[k].soft, `board ${k} resolved no --bc-soft`);
    }
    console.log(`recolour              : --bc ${r.after.bc} / --bc-soft ${r.after.soft}`);
    check(r.after.bc.toLowerCase()==="#123456", `recolour didn't move --bc (${r.after.bc})`);
    check(/^rgba\(18,\s*52,\s*86/.test(r.after.soft),
      `--bc-soft didn't follow the new colour (${r.after.soft}) — the old applyColors bug is back`);
    await ctx.close();
  }

  /* ---- 4. a board whose watch ERRORS must not hang the app ------------ */
  {
    /* make one board's card read fail, forever */
    const pre=`window.__FAIL_BOARD="6a718220df5bd657f0636bc7";`;
    /* Fail loudly if the harness arm moves — a silent no-op replace would
       leave this case asserting against a perfectly healthy app. */
    const NEEDLE = 'if(tool === "trelloReadCard"){';
    if(BASE.indexOf(NEEDLE) < 0) throw new Error("harness trelloReadCard arm moved — update setup.js case 4");
    const patched=BASE.replace(NEEDLE,
      'if(tool === "trelloReadCard" && window.__FAIL_BOARD && String(input.boardIdOrUrl).indexOf(window.__FAIL_BOARD)>=0)\n    throw {code:"tool_error",message:"board is gone"};\n  ' + NEEDLE);
    const ctx=await b.newContext({viewport:{width:900,height:1000},timezoneId:"Asia/Jerusalem"});
    const p=await ctx.newPage();const errs=[];
    p.on("pageerror",e=>errs.push(e.message));
    await p.setContent(`<!doctype html><html><head><meta charset="utf-8"><script>${clock("2026-08-17T09:00:00+03:00")}${pre}${patched}<\/script></head><body>${page_html}</body></html>`,{waitUntil:"load"});
    await p.waitForTimeout(6000);
    /* startDay() is the thing the old gate never reached. S.stats alone is a
       bad proxy — the discovery scan populates it before the settle loop even
       runs — so assert on work only startDay does: it plans the day and
       records it in S.stats.plans, and it renders real rows. */
    const r=await p.evaluate(()=>({
      ready:S.ready,
      skeleton:!!document.querySelector("#pageMain .skel"),
      errs:Object.keys(S.errs||{}),
      planned:!!(S.stats && S.stats.plans && Object.keys(S.stats.plans).length),
      rows:document.querySelectorAll("#pageMain .item.stack").length
    }));
    console.log(`dead board            : ready=${r.ready} skeleton=${r.skeleton} planned=${r.planned} rows=${r.rows} errs=${r.errs.join(",")}`);
    check(r.ready, "a dead board left the app permanently un-ready");
    check(r.planned, "startDay() never ran — one dead board still hangs boot (the settle gate waits for success)");
    check(r.rows>0, "a dead board left the day empty — the other boards' work never got scheduled");
    check(!r.skeleton, "a dead board left a permanent skeleton — the settle gate still waits for success");
    check(r.errs.some(k=>k.indexOf("cards:")===0), "the failing board recorded no error");
    await ctx.close();
  }

  /* ---- 5. no batch board => Projects tab hidden, nothing throws ------- */
  {
    const {ctx,p,errs}=await open(b,"");
    const r=await p.evaluate(()=>{
      SETUP.batchBoardKey=null; _snapCache=null; render();
      return null;
    });
    await p.waitForTimeout(500);
    const v=await p.evaluate(()=>{
      const btn=[...document.querySelectorAll('#viewSwitch button')].find(x=>x.dataset.view==="projects");
      const marked=allCards().find(c=>/SFX batch/.test(c.name||""));
      return { hidden: btn ? btn.offsetParent===null : "no button",
               pressure: typeof projectPressureOf==="function" ? projectPressureOf(marked||allCards()[0]) : "missing",
               view:S.view };
    });
    console.log(`no batch board        : tab hidden=${v.hidden} pressure=${v.pressure} view=${v.view}`);
    check(v.hidden===true, "the Projects tab is still visible with no batch board");
    check(v.pressure===null, `projectPressureOf should be null with no batch board, got ${v.pressure}`);
    check(v.view!=="projects", "left stranded on a hidden view");
    check(!errs.length, "errors with no batch board: "+errs.join("|"));
    await ctx.close();
  }

  /* ---- 5b. the connector isn't added yet — the real first-run state ----
     A new user very plausibly opens the link before adding Trello or Google
     Calendar to their Claude account. There is no consent prompt that fixes
     that: the connector simply isn't there. The wizard has to say which one
     and what to do, not "something went wrong" — errCopy already has the
     per-code text, but this path had never been exercised. */
  {
    const {ctx,p,errs}=await open(b,
      `window.__NO_SETUP=true;window.__NO_STATE_CARD=true;window.__NO_LEGACY=true;`+
      `window.__DEAD_SERVER={"Trello":"server_not_connected"};`);
    const r=await p.evaluate(()=>({
      text:(document.querySelector(".scrim")||document.body).innerText||"",
      boards:document.querySelectorAll(".setup-board").length,
      stuck:!!document.querySelector(".scrim")
    }));
    const said = /Add Trello|Settings → Connectors/i.test(r.text);
    console.log(`trello not added      : wizard=${r.stuck} rows=${r.boards} says-how-to-fix=${said}`);
    check(r.stuck, "no wizard at all when Trello isn't connected");
    check(r.boards===0, "board rows rendered from a connector that isn't connected");
    check(said, `the wizard didn't say how to fix it. It showed: ${JSON.stringify(r.text.slice(0,160))}`);
    check(!/undefined|\[object/i.test(r.text), "the wizard rendered a broken error string");
    check(!errs.length, "page errors with Trello disconnected: "+errs.join("|"));
    /* The button must offer a retry, not "Next" — pressing Next on a screen
       with no boards would answer "Pick at least one board", blaming the
       viewer for a missing connector. */
    const btn=await p.evaluate(()=>[...document.querySelectorAll(".df .btn.primary")].pop().textContent);
    console.log(`  dead-end button     : "${btn}"`);
    check(/again|retry/i.test(btn), `the button still says "${btn}" on a screen the viewer can't act on`);
    /* and it must actually recover once they add the connector */
    await p.evaluate(()=>{ window.__DEAD_SERVER=null; });
    await p.locator(".df .btn.primary").click();
    await p.waitForTimeout(900);
    const after=await p.evaluate(()=>({
      rows:document.querySelectorAll(".setup-board").length,
      btn:[...document.querySelectorAll(".df .btn.primary")].pop().textContent
    }));
    console.log(`  after reconnecting  : rows=${after.rows} button="${after.btn}"`);
    check(after.rows===4, `retry didn't load the boards after reconnecting (got ${after.rows})`);
    check(/next/i.test(after.btn), `button stayed on retry after recovering: "${after.btn}"`);
    await ctx.close();
  }
  /* ...and the same for Google Calendar, which fails one step later. */
  {
    const {ctx,p,errs}=await open(b,
      `window.__NO_SETUP=true;window.__NO_STATE_CARD=true;window.__NO_LEGACY=true;`+
      `window.__DEAD_SERVER={"Google Calendar":"needs_reauth"};`);
    await p.locator(".setup-board").nth(0).locator(".setup-tick").click();
    await p.locator(".df .btn.primary").click();          // -> calendar step
    await p.waitForTimeout(700);
    const r=await p.evaluate(()=>({
      text:(document.querySelector(".scrim")||document.body).innerText||"",
      cals:document.querySelectorAll(".setup-cal").length
    }));
    const said = /Reconnect Google Calendar|Settings → Connectors/i.test(r.text);
    console.log(`gcal needs reauth     : calendars=${r.cals} says-how-to-fix=${said}`);
    check(r.cals===0, "calendar rows rendered from a connector needing reauth");
    check(said, `the calendar step didn't say how to fix it. It showed: ${JSON.stringify(r.text.slice(0,160))}`);
    check(!errs.length, "page errors with Google Calendar disconnected: "+errs.join("|"));
    await ctx.close();
  }

  /* ---- 6. the author's own install is untouched ----------------------- */
  {
    const {ctx,p,errs}=await open(b,"");
    const r=await p.evaluate(()=>({
      keys:BOARDS.map(x=>x.key), cal:CAL_ID,
      stats:SETUP.statsBoardKey, batch:SETUP.batchBoardKey,
      wizard:!!document.querySelector(".setup-board"),
      statsFound:!!statsCard(), streak:S.stats&&S.stats.streak
    }));
    console.log(`author install        : keys=${r.keys.join(",")} stats=${r.stats} batch=${r.batch} streak=${r.streak}`);
    check(!r.wizard, "the author was shown a setup wizard");
    check(r.keys.join(",")==="projects,sidurim,sedco,mpaudio", `the author's board keys changed: ${r.keys}`);
    check(r.cal==="morsedero@gmail.com", `the author's calendar changed: ${r.cal}`);
    check(r.stats==="sidurim", `the author's state board moved to ${r.stats}`);
    check(r.batch==="projects", "the author lost his Projects view");
    check(r.statsFound, "the author's state card wasn't found");
    check(r.streak===4, `the author's streak changed: ${r.streak}`);
    check(!errs.length, "errors on the author's install: "+errs.join("|"));
    await ctx.close();
  }

  console.log(bad.length?"FAIL:\n  x "+bad.join("\n  x "):"OK setup: a new viewer gets their own boards, the author's install is unchanged");
  await b.close();
  process.exit(bad.length?1:0);
})();
