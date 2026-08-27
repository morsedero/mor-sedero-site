/* saveStats is single-flight, and overlapping saves must not lose writes.
 *
 * The whole stats document — streak, history, categories, rollovers, plans,
 * project deadlines, settings — lives as one JSON blob in one Trello card
 * description, and saveStats is called from ~20 places, nearly all
 * fire-and-forget off a Done / Swap / Pending / Remove / settings save.
 *
 * Before the fix, two saves close together each serialized the ENTIRE
 * document at CALL time and sent both; whichever response landed last won
 * outright, silently discarding the other's change. That is the mechanism
 * behind "my streak reset" / "my setting reverted" / "that completion didn't
 * stick" — bugs that read as random because nothing on screen reports them.
 *
 * What this asserts:
 *   1. two overlapping saveStats calls produce ONE write while held, not two
 *      racing ones (single-flight)
 *   2. the value that finally lands is the LATER one — no lost update
 *   3. the body is serialized at WRITE time, not call time, so a save queued
 *      behind an in-flight one ships current state rather than a stale
 *      snapshot
 *   4. a normal single save still works and still writes exactly once
 *
 * Run against the pre-fix saveStats, checks 1-3 fail: two writes go out and
 * the last-writer-wins body carries whichever snapshot happened to be
 * serialized first.
 */
const fs=require("fs"),vm=require("vm");const {chromium}=require("playwright");
const H=fs.readFileSync(__dirname+"/harness.js","utf8");
const page_html=fs.readFileSync(__dirname+"/daisey.html","utf8");
const sb={require,__dirname,module:{exports:{}},exports:{},console,process};
vm.runInNewContext(H.split("(async () => {")[0]+"\nmodule.exports={stub};",sb);
const BASE=sb.module.exports.stub;

const clock=t=>`const R=Date;const O=new R("${t}").getTime()-R.now();
window.Date=class extends R{constructor(...a){if(a.length===0)super(R.now()+O);else super(...a);}static now(){return R.now()+O;}};`;

const bad=[];
const check=(cond,msg)=>{ if(!cond) bad.push(msg); };

(async()=>{
  const b=await chromium.launch({});
  const ctx=await b.newContext({viewport:{width:420,height:900},timezoneId:"Asia/Jerusalem",colorScheme:"dark"});
  const p=await ctx.newPage();
  p.on("pageerror",e=>bad.push("pageerror: "+e.message));
  p.on("console",m=>{
    const t=m.text();
    /* the app logs connector noise through logErr on purpose; only real page
       errors should fail the suite */
    if(m.type()==="error" && !/\[daisey\]/.test(t)) bad.push("console: "+t);
  });
  await p.setContent(`<!doctype html><html><head><meta charset="utf-8"><script>${clock("2026-08-17T09:00:00+03:00")}${BASE}<\/script></head><body>${page_html}</body></html>`,{waitUntil:"load"});
  await p.waitForTimeout(2600);

  /* Hold every stats write open so overlap is deterministic rather than a
     race, and record the DESCRIPTION each write carried — that body is the
     evidence for what state was serialized and when. */
  await p.evaluate(()=>{
    window.__hold=false; window.__release=[]; window.__bodies=[];
    const orig=S.mcp.callTool.bind(S.mcp);
    S.mcp.callTool=async(s,t,i)=>{
      const isStats = t==="trelloWriteCard" && i && typeof i.desc==="string" && i.desc.includes("DAYFLOW_STATE_V1");
      if(isStats){
        window.__bodies.push(i.desc);
        if(window.__hold) await new Promise(r=>window.__release.push(r));
      }
      return orig(s,t,i);
    };
  });

  const bodies = ()=>p.evaluate(()=>window.__bodies.slice());
  const clear  = ()=>p.evaluate(()=>{ window.__bodies.length=0; });
  const hold   = ()=>p.evaluate(()=>{ window.__hold=true; });
  const release= async()=>{
    await p.evaluate(()=>{ window.__hold=false; for(const r of window.__release.splice(0)) r(); });
    await p.waitForTimeout(600);
  };
  /* pull the streak value back out of a written body */
  const streakIn = d => { const m=/"streak":(\d+)/.exec(d||""); return m?+m[1]:null; };

  /* ------------------------------------------- 1. a plain save writes once */
  await clear();
  await p.evaluate(()=>saveStats({ ...(S.stats||{}), v:1, streak:1 }));
  await p.waitForTimeout(600);
  let bs=await bodies();
  check(bs.length===1, `a single save should write exactly once, got ${bs.length}`);
  check(streakIn(bs[0])===1, `the single save should carry streak 1, got ${streakIn(bs[0])}`);
  console.log("[single]", JSON.stringify({writes:bs.length, streak:streakIn(bs[0])}));

  /* ---------------------------------- 2. overlapping saves must coalesce */
  await clear();
  await hold();
  /* first save goes out and hangs; two more arrive while it is in flight */
  await p.evaluate(()=>{ saveStats({ ...(S.stats||{}), v:1, streak:2 }); });
  await p.waitForTimeout(150);
  await p.evaluate(()=>{ saveStats({ ...(S.stats||{}), v:1, streak:3 }); });
  await p.evaluate(()=>{ saveStats({ ...(S.stats||{}), v:1, streak:4 }); });
  await p.waitForTimeout(250);

  const inFlight=await bodies();
  check(inFlight.length===1,
    `only one stats write should be in flight while held, got ${inFlight.length} — overlapping saves are racing`);
  console.log("[held]", JSON.stringify({inFlight:inFlight.length, streaks:inFlight.map(streakIn)}));

  await release();
  const after=await bodies();
  /* the queued saves coalesce into ONE follow-up write, not one per call */
  check(after.length===2,
    `three overlapping saves should collapse to two writes (one held + one coalesced), got ${after.length}`);
  /* and that follow-up must carry the LATEST state, not a stale snapshot */
  const last=streakIn(after[after.length-1]);
  check(last===4, `the final write should carry the newest streak (4), got ${last} — a save was lost`);
  const live=await p.evaluate(()=>S.stats&&S.stats.streak);
  check(live===4, `S.stats should hold the newest value, got ${live}`);
  console.log("[coalesced]", JSON.stringify({writes:after.length, streaks:after.map(streakIn), live}));

  /* -------------------- 3. a save AFTER the flight drains still goes out */
  await clear();
  await p.evaluate(()=>saveStats({ ...(S.stats||{}), v:1, streak:9 }));
  await p.waitForTimeout(600);
  bs=await bodies();
  check(bs.length===1, `a save once the queue drained should write again, got ${bs.length}`);
  check(streakIn(bs[0])===9, `the post-drain save should carry streak 9, got ${streakIn(bs[0])}`);
  console.log("[after-drain]", JSON.stringify({writes:bs.length, streak:streakIn(bs[0])}));

  await b.close();
  console.log(bad.length?"FAIL:\n"+bad.map(x=>"  ✗ "+x).join("\n")
                        :"✓ overlapping saveStats calls coalesce and never lose the newest state");
  process.exit(bad.length?1:0);
})();
