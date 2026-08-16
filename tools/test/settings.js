/* The settings sheet used to hard-cap at 600px tall and lay each field out
   as a flex-wrap flow with no fixed label column, so two things happened: on
   a viewport shorter than ~600px+chrome it needed an internal scroll to see
   everything, and on any viewport it could still overflow past the top/
   bottom of the screen since the scrim centered it without regard for how
   tall it actually was. The panel is now sized off the real viewport height
   (minus safe-area insets) instead of a fixed number, and every row sits in
   a two-column grid so values line up regardless of label length.

   Checked across several realistic phone/tablet viewport heights: the panel
   must fit inside the screen with no internal scroll needed, and must not
   spill past the top or bottom edge. */
const fs=require("fs"),vm=require("vm");const {chromium}=require("playwright");
const H=fs.readFileSync(__dirname+"/harness.js","utf8");
const page_html=fs.readFileSync(__dirname+"/dayflow.html","utf8");
const sb={require,__dirname,module:{exports:{}},exports:{},console,process};
vm.runInNewContext(H.split("(async () => {")[0]+"\nmodule.exports={stub};",sb);
const BASE=sb.module.exports.stub;
const clock=t=>`const R=Date;const O=new R("${t}").getTime()-R.now();
window.Date=class extends R{constructor(...a){if(a.length===0)super(R.now()+O);else super(...a);}static now(){return R.now()+O;}};`;

const bad=[];
const check=(cond,msg)=>{ if(!cond) bad.push(msg); };

/* short is a fair bar today, not "must survive a 300px sliver" — an
   internal scroll is still the deliberate safety net below that */
const SIZES = [
  { name:"iphone-se",   width:375, height:667 },
  { name:"iphone-15",   width:393, height:852 },
  { name:"pixel-short", width:412, height:732 },
  { name:"ipad-mini",   width:744, height:1133 }
];

(async()=>{
  const b=await chromium.launch({});
  for(const sz of SIZES){
    const ctx=await b.newContext({ viewport:{width:sz.width,height:sz.height}, timezoneId:"Asia/Jerusalem", colorScheme:"dark" });
    const p=await ctx.newPage();
    const errs=[];
    p.on("pageerror",e=>errs.push(e.message));
    p.on("console",m=>{if(m.type()==="error")errs.push(m.text());});
    await p.setContent(`<!doctype html><html><head><meta charset="utf-8"><script>${clock("2026-08-17T09:00:00+03:00")}${BASE}<\/script></head><body>${page_html}</body></html>`,{waitUntil:"load"});
    await p.waitForTimeout(2600);

    await p.click("#setBtn");
    await p.waitForTimeout(350);

    const m = await p.evaluate(()=>{
      const dlg = document.querySelector(".dialog.sheet");
      const setBox = document.querySelector(".set");
      const r = dlg.getBoundingClientRect();
      return {
        top:r.top, bottom:r.bottom, vh:innerHeight,
        rows: document.querySelectorAll(".set-row").length,
        heads: [...document.querySelectorAll(".set-h")].map(x=>x.textContent),
        needsScroll: setBox.scrollHeight > setBox.clientHeight + 1,
        swatches: document.querySelectorAll(".swatch-card").length
      };
    });

    check(m.top >= -0.5, `[${sz.name}] dialog top (${m.top.toFixed(1)}) should not sit above the screen`);
    check(m.bottom <= m.vh + 0.5, `[${sz.name}] dialog bottom (${m.bottom.toFixed(1)}) should not spill past viewport height (${m.vh})`);
    check(!m.needsScroll, `[${sz.name}] the field list should fit without an internal scroll (rows=${m.rows})`);
    check(m.swatches===3, `[${sz.name}] all three board swatches should be in one row, got ${m.swatches}`);
    console.log(`[${sz.name}]`, JSON.stringify(m));

    // Cancel should still discard cleanly regardless of layout changes
    await p.click(".dialog .btn.quiet");
    await p.waitForTimeout(150);
    const closed = await p.evaluate(()=>!document.querySelector(".scrim"));
    check(closed, `[${sz.name}] Cancel should close the settings sheet`);

    if(errs.length) bad.push(`[${sz.name}] page errors: ${errs.join("|")}`);
    await ctx.close();
  }

  console.log(bad.length ? "FAIL:\n  ✗ "+bad.join("\n  ✗ ")
                         : "✓ settings fits on screen with no scroll, top/bottom clear, across all sizes");
  await b.close();
  process.exit(bad.length?1:0);
})();
