/* The core of this turn's request: a long (orange, 8h) session takes the
   day, and no quick tasks are scheduled alongside it. Also checks that on a
   day where an 8h block genuinely doesn't fit, the day falls through to
   short + quick as before — the rule should not silently eat every day. */
const fs = require("fs"), vm = require("vm");
const { chromium } = require("playwright");
const H = fs.readFileSync(__dirname + "/harness.js", "utf8");
const page_html = fs.readFileSync(__dirname + "/daisey.html", "utf8");
const sb = { require, __dirname, module: { exports: {} }, exports: {}, console, process };
vm.runInNewContext(H.split("(async () => {")[0] + "\nmodule.exports={stub};", sb);
const BASE = sb.module.exports.stub;

const clock = t => `const R=Date;const O=new R("${t}").getTime()-R.now();
window.Date=class extends R{constructor(...a){if(a.length===0)super(R.now()+O);else super(...a);}static now(){return R.now()+O;}};`;

/* an open Monday: חמל ends before the 09:00 window even opens, so an
   8-hour block genuinely has room. A session may never land inside a
   permeable meeting (only quick tasks can), so if חמל overlapped the
   window here it would rightly push the long session out — that's
   split-day-declines below, not this one. */
const OPEN_DAY = [
  { id: "hamal", summary: "חמל", start: { dateTime: "2026-08-17T06:00:00+03:00" }, end: { dateTime: "2026-08-17T08:30:00+03:00" }, status: "confirmed" }
];
const openStub = BASE
  .replace(/const DAY = [^;]+;/, 'const DAY = "2026-08-17";')
  .replace(/const EVENTS = [^;]+;/, "const EVENTS = " + JSON.stringify(OPEN_DAY) + ";");

/* a Friday whose real meeting (16:00-17:00) splits the 9-17 window into a
   7h open stretch — too short for an 8h long session, which should decline */
const splitStub = BASE; // ships with ישיבה עם אסתר 16:00-17:00 on 2026-08-14

/* חמל is permeable and spans most of the morning (06:00-14:00) — plenty of
   room after it for the short session, and quick tasks may still land
   inside it. Only sessions have to stay out. */
const PERMEABLE_DAY = [
  { id: "hamal", summary: "חמל", start: { dateTime: "2026-08-17T06:00:00+03:00" }, end: { dateTime: "2026-08-17T14:00:00+03:00" }, status: "confirmed" }
];
const permeableStub = BASE
  .replace(/const DAY = [^;]+;/, 'const DAY = "2026-08-17";')
  .replace(/const EVENTS = [^;]+;/, "const EVENTS = " + JSON.stringify(PERMEABLE_DAY) + ";");

(async () => {
  const browser = await chromium.launch({});
  let fails = 0;

  async function run(label, stub, when, checks) {
    const ctx = await browser.newContext({ viewport: { width: 760, height: 1000 }, timezoneId: "Asia/Jerusalem", colorScheme: "dark" });
    const p = await ctx.newPage();
    const errs = [];
    p.on("pageerror", e => errs.push(e.message));
    await p.setContent(`<!doctype html><html><head><meta charset="utf-8"><script>${clock(when)}${stub}<\/script></head><body>${page_html}</body></html>`, { waitUntil: "load" });
    await p.waitForTimeout(3200);
    const r = await p.evaluate(() => {
      const d = new Date();
      const have = existingBlocks(d);
      const blocks = allEvents().filter(e => e.isTask && overlapsDay(e, d))
        .map(e => ({ n: e.summary, s: minsOf(e.start), e: minsOf(e.end), size: e.size })).sort((a, b) => a.s - b.s);
      return { have, blocks, creates: window.__calls.filter(c => c.tool === "create_event").length,
               toast: (document.querySelector(".toast") || {}).textContent || null };
    });
    const bad = checks(r);
    console.log(`[${label}] ${errs.length ? "ERR " + errs.join("|") : "ok"} quick=${r.have.quick} short=${r.have.short}`);
    r.blocks.forEach(b => console.log(`    ${String(Math.floor(b.s/60)).padStart(2,"0")}:${String(b.s%60).padStart(2,"0")}-${String(Math.floor(b.e/60)).padStart(2,"0")}:${String(b.e%60).padStart(2,"0")} [${b.size}] ${b.n}`));
    if (bad && bad.length) console.log("  ✗ " + bad.join("\n  ✗ ")); else console.log("  ✓");
    fails += (bad ? bad.length : 0) + errs.length;
    await ctx.close();
  }

  /* The 8h "long session / work day" tier was REMOVED in the 2026-08-25/26
     redesign: `workdayMax` is gone and `existingBlocks` buckets everything
     non-short as quick, so only `quick` and `short` exist now. These two
     scenarios used to assert `have.long`, which is permanently `undefined`
     against the current app — they were failing silently because nothing ran
     the suite. Rewritten for the two-tier model. */

  await run("open-day-fits", openStub, "2026-08-17T08:00:00+03:00", r => {
    const bad = [];
    /* an open day should still fill with real work, sessions included */
    if (r.have.short < 1) bad.push(`expected at least 1 short session on an open day, got ${r.have.short}`);
    if (r.have.total === 0) bad.push("expected the open day to be scheduled at all");
    const short = r.blocks.find(b => b.size === "short");
    if (short && (short.e - short.s) > 480) bad.push(`short block is ${short.e-short.s}min, longer than a whole work day`);
    return bad;
  });

  await run("split-day-declines", splitStub, "2026-08-14T08:00:00+03:00", r => {
    const bad = [];
    /* a day chopped up by meetings can't fit a full session, but the quick
       tasks must still land — the fall-through is the point of the scenario */
    if (r.have.quick === 0) bad.push("expected quick tasks to still be scheduled on a split day");
    for (const b of r.blocks.filter(x => x.size === "short"))
      if ((b.e - b.s) > 300) bad.push(`a ${b.e-b.s}min session was forced into a split day`);
    return bad;
  });

  await run("session-skips-permeable-quick-doesnt", permeableStub, "2026-08-17T08:00:00+03:00", r => {
    const bad = [];
    const hamal = { s: 360, e: 840 };
    const ov = (a, b) => a.s < b.e && a.e > b.s;
    const short = r.blocks.find(b => b.size === "short");
    if (!short) bad.push("expected the short session to still get scheduled, just not inside חמל");
    else if (ov(short, hamal)) bad.push(`short session ${short.s}-${short.e} landed inside חמל`);
    const quick = r.blocks.filter(b => b.size === "quick");
    if (!quick.some(t => ov(t, hamal))) bad.push("expected at least one quick task to land inside חמל");
    return bad;
  });

  await browser.close();
  console.log(fails ? `\n${fails} failure(s)` : "\nboth scenarios pass");
  process.exit(fails ? 1 : 0);
})();
