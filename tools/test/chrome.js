/* App chrome: the switch/clock/progress/rebuild row shares one line without
   overflowing at phone width, the clock stays centered between its two
   flanking groups, the peach palette is live, and card titles anchor right. */
const fs=require("fs"),vm=require("vm");const {chromium}=require("playwright");
const H=fs.readFileSync("harness.js","utf8");const page_html=fs.readFileSync("dayflow.html","utf8");
const sb={require,__dirname,module:{exports:{}},exports:{},console,process};
vm.runInNewContext(H.split("(async () => {")[0]+"\nmodule.exports={stub};",sb);
const stub=sb.module.exports.stub.replace(/const DAY = [^;]+;/,'const DAY = "2026-08-17";');
const clock=t=>`const R=Date;const O=new R("${t}").getTime()-R.now();
window.Date=class extends R{constructor(...a){if(a.length===0)super(R.now()+O);else super(...a);}static now(){return R.now()+O;}};`;
(async()=>{const b=await chromium.launch({});
let fails=0;
for(const [w,label] of [[390,"narrow"],[760,"wide"]]){
  for(const scheme of ["light","dark"]){
    const ctx=await b.newContext({viewport:{width:w,height:860},timezoneId:"Asia/Jerusalem",colorScheme:scheme});
    const p=await ctx.newPage();const errs=[];
    p.on("pageerror",e=>errs.push(e.message));p.on("console",m=>{if(m.type()==="error")errs.push(m.text());});
    await p.setContent(`<!doctype html><html><head><meta charset="utf-8"><script>${clock("2026-08-17T09:00:00+03:00")}${stub}<\/script></head><body>${page_html}</body></html>`,{waitUntil:"load"});
    await p.waitForTimeout(2600);
    const r=await p.evaluate(()=>({
      bodyOverflow: document.body.scrollWidth > document.body.clientWidth,
      dashOverflow: document.getElementById("dash").scrollWidth > document.getElementById("dash").clientWidth,
      switchRect: document.getElementById("viewSwitch").getBoundingClientRect(),
      clockRect: document.getElementById("clockw").getBoundingClientRect(),
      dashRightRect: document.getElementById("dashRight").getBoundingClientRect(),
      bg: getComputedStyle(document.documentElement).getPropertyValue("--bg").trim(),
      colorScheme: getComputedStyle(document.documentElement).colorScheme,
      bodyBg: getComputedStyle(document.body).backgroundColor,
      titleAlign: getComputedStyle(document.querySelector(".now .row .n")).textAlign,
      rowTitleAlign: document.querySelector("#pageMain .row .n") ? getComputedStyle(document.querySelector("#pageMain .row .n")).textAlign : null
    }));
    const bad=[];
    if(r.bodyOverflow) bad.push("page scrolls horizontally");
    if(r.dashOverflow) bad.push("the dash row itself overflows");
    // switch is left of clock, clock is left of dash-right, and the gap on
    // either side of the clock is within a few px of matching (centered)
    if(!(r.switchRect.right <= r.clockRect.left && r.clockRect.right <= r.dashRightRect.left))
      bad.push("dash children out of left-to-right order");
    const leftGap = r.clockRect.left - r.switchRect.right, rightGap = r.dashRightRect.left - r.clockRect.right;
    if(Math.abs(leftGap - rightGap) > 4) bad.push(`clock not centered (gaps ${leftGap.toFixed(1)} vs ${rightGap.toFixed(1)})`);
    /* the palette is deliberately theme-independent now: a reader in dark
       mode must still get the bright page, colour-scheme included */
    if(r.bg.toLowerCase()!=="#fffbea") bad.push(`--bg is ${r.bg} under colorScheme:${scheme}`);
    if(r.colorScheme!=="light") bad.push(`color-scheme is ${r.colorScheme} under colorScheme:${scheme}`);
    if(r.bodyBg!=="rgb(255, 251, 234)") bad.push(`painted body background is ${r.bodyBg} under colorScheme:${scheme}`);
    if(r.titleAlign!=="right") bad.push(`hub title text-align is ${r.titleAlign}`);
    if(r.rowTitleAlign && r.rowTitleAlign!=="right") bad.push(`row title text-align is ${r.rowTitleAlign}`);
    /* The real regression: the artifact shell doesn't use the media query at
       all — for a dark-mode reader it stamps data-theme="dark" plus an inline
       style.colorScheme on <html>. That path shipped a near-black page for
       weeks while the media-query path looked fine, so assert it directly. */
    const shell = await p.evaluate(()=>{
      const h = document.documentElement;
      h.dataset.theme = "dark"; h.style.colorScheme = "dark";
      return {
        bg: getComputedStyle(h).getPropertyValue("--bg").trim(),
        colorScheme: getComputedStyle(h).colorScheme,
        bodyBg: getComputedStyle(document.body).backgroundColor
      };
    });
    if(shell.bg.toLowerCase()!=="#fffbea") bad.push(`shell-dark --bg is ${shell.bg}`);
    if(shell.colorScheme!=="light") bad.push(`shell-dark color-scheme is ${shell.colorScheme}`);
    if(shell.bodyBg!=="rgb(255, 251, 234)") bad.push(`shell-dark body background is ${shell.bodyBg}`);
    console.log(`[${label}-${scheme}]`, errs.length?"ERR "+errs.join("|"):"ok",
      bad.length?"\n  ✗ "+bad.join("\n  ✗ "):"✓");
    fails += errs.length + bad.length;
    await p.screenshot({path:`chrome-${label}-${scheme}.png`,fullPage:false});
    await ctx.close();
  }
}
await b.close(); process.exit(fails?1:0);})();
