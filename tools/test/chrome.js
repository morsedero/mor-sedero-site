/* App chrome: the switch/progress/rebuild row shares one line without
   overflowing at phone width, the clock sits alone in its own topbar row
   above the header (left-aligned, above everything else), the date sits
   centered between the prev/next arrows in the header row below it, the
   peach palette is live, and card titles anchor right. */
const fs=require("fs"),vm=require("vm");const {chromium}=require("playwright");
const H=fs.readFileSync("harness.js","utf8");const page_html=fs.readFileSync("daisey.html","utf8");
const sb={require,__dirname,module:{exports:{}},exports:{},console,process};
vm.runInNewContext(H.split("(async () => {")[0]+"\nmodule.exports={stub};",sb);
const stub=sb.module.exports.stub.replace(/const DAY = [^;]+;/,'const DAY = "2026-08-17";');
const clock=t=>`const R=Date;const O=new R("${t}").getTime()-R.now();
window.Date=class extends R{constructor(...a){if(a.length===0)super(R.now()+O);else super(...a);}static now(){return R.now()+O;}};`;
(async()=>{const b=await chromium.launch({});
let fails=0;
/* 320 is the narrowest phone still in use (SE 1st gen / small Android) and is
   where the three dash groups first ran out of room; 430 is a Pro Max, just
   above the 2-row breakpoint's busiest case; 760 is the single-row desktop
   layout. Checking only 390 is what let the crowded-row bug through. */
for(const [w,label] of [[320,"tiny"],[390,"narrow"],[430,"phone-max"],[760,"wide"]]){
  for(const scheme of ["light","dark"]){
    const ctx=await b.newContext({viewport:{width:w,height:860},timezoneId:"Asia/Jerusalem",colorScheme:scheme});
    const p=await ctx.newPage();const errs=[];
    p.on("pageerror",e=>errs.push(e.message));p.on("console",m=>{if(m.type()==="error" && !/^\[daisey\]/.test(m.text()))errs.push(m.text());});
    await p.setContent(`<!doctype html><html><head><meta charset="utf-8"><script>${clock("2026-08-17T09:00:00+03:00")}${stub}<\/script></head><body>${page_html}<script>try{checkChoresTrigger=function(){};}catch(_){}<\/script></body></html>`,{waitUntil:"load"});
    await p.waitForTimeout(2600);
    const r=await p.evaluate(()=>({
      bodyOverflow: document.body.scrollWidth > document.body.clientWidth,
      dashOverflow: document.getElementById("dash").scrollWidth > document.getElementById("dash").clientWidth,
      switchRect: document.getElementById("viewSwitch").getBoundingClientRect(),
      dashRightRect: document.getElementById("dashRight").getBoundingClientRect(),
      topbarRect: document.querySelector(".topbar").getBoundingClientRect(),
      clockRect: document.getElementById("clockw").getBoundingClientRect(),
      setRect: document.getElementById("setBtn").getBoundingClientRect(),
      /* .head is dead markup (`<header class="head"></header>`, CSS
         display:none) — the day nav it used to hold moved into #dash's own
         .dash-center a redesign ago and nothing in the live layout reads
         .head any more. Comparing against a display:none element's rect
         (always {top:0,...}) is what made this assertion fail regardless
         of viewport/scheme; #dash is the real row that sits below .topbar
         now. Unrelated to the brick-merge change — this predates it. */
      dashRect: document.getElementById("dash").getBoundingClientRect(),
      prevRect: document.getElementById("prev").getBoundingClientRect(),
      nextRect: document.getElementById("next").getBoundingClientRect(),
      dateRect: document.getElementById("dateWrap").getBoundingClientRect(),
      dashCenterRect: document.querySelector(".dash-center").getBoundingClientRect(),
      /* The date is the one thing in this row that identifies which day is on
         screen. Two earlier phone-layout fixes kept the row from *overflowing*
         by letting the date compress instead — which this suite happily passed
         while the label silently ellipsized to nothing and the groups
         overlapped by ~200px. scrollWidth>clientWidth is what actually catches
         "you can't see the current day". */
      dateClipped: (()=>{const e=document.getElementById("dateLabel");
        return e.scrollWidth > e.clientWidth + 1;})(),
      dateText: document.getElementById("dateLabel").textContent,
      bg: getComputedStyle(document.documentElement).getPropertyValue("--bg").trim(),
      colorScheme: getComputedStyle(document.documentElement).colorScheme,
      bodyBg: getComputedStyle(document.body).backgroundColor,
      titleAlign: getComputedStyle(document.querySelector(".now .row .n")).textAlign,
      rowTitleAlign: document.querySelector("#pageMain .row .n") ? getComputedStyle(document.querySelector("#pageMain .row .n")).textAlign : null
    }));
    const bad=[];
    if(r.bodyOverflow) bad.push("page scrolls horizontally");
    if(r.dashOverflow) bad.push("the dash row itself overflows");
    if(!(r.switchRect.right <= r.dashRightRect.left)) bad.push("dash children out of left-to-right order");
    /* Real 2-D overlap between the three dash groups. The old left-to-right
       check only ever compared the switcher with the pill and never involved
       the date group at all, so a date group sitting on top of the pill (the
       actual 2026-08-24 bug, measured at 197px of overlap on a 390px phone)
       went unnoticed. Boxes on different rows don't overlap, so this stays
       true whether the dash is one row or two. */
    const hit=(a,c)=>a.left < c.right-0.5 && c.left < a.right-0.5 &&
                     a.top  < c.bottom-0.5 && c.top  < a.bottom-0.5;
    if(hit(r.switchRect, r.dashCenterRect)) bad.push("the view switcher overlaps the date group");
    if(hit(r.dashCenterRect, r.dashRightRect)) bad.push("the date group overlaps the progress pill / rebuild button");
    if(hit(r.switchRect, r.dashRightRect)) bad.push("the view switcher overlaps the progress pill / rebuild button");
    if(r.dateClipped) bad.push(`the date is clipped — can't tell which day is on screen (showing "${r.dateText}")`);
    // the clock lives above everything else, anchored left, with settings
    // opposite it on the right
    if(!(r.topbarRect.top <= r.dashRect.top)) bad.push("clock's topbar isn't above the dash row");
    if(!(Math.abs(r.clockRect.left - r.topbarRect.left) < 2)) bad.push("clock isn't left-anchored in the topbar");
    if(!(r.clockRect.right <= r.setRect.left)) bad.push("settings isn't to the right of the clock");
    // prev/next pin to the header row's two edges, the date sits centered
    // between them (the old "dot between the arrows" is gone)
    if(!(r.prevRect.right <= r.dateRect.left && r.dateRect.right <= r.nextRect.left))
      bad.push("head children out of left-to-right order");
    const leftGap = r.dateRect.left - r.prevRect.right, rightGap = r.nextRect.left - r.dateRect.right;
    if(Math.abs(leftGap - rightGap) > 4) bad.push(`date not centered (gaps ${leftGap.toFixed(1)} vs ${rightGap.toFixed(1)})`);
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
