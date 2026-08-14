/* Scheduling-rule assertions, checked against the engine rather than the DOM.
   Verifies the guarantees the widget promises about a planned day. */
const fs = require("fs"), vm = require("vm");
const { chromium } = require("playwright");

const H = fs.readFileSync(__dirname + "/harness.js", "utf8");
const page_html = fs.readFileSync(__dirname + "/dayflow.html", "utf8");
const sb = { require, __dirname, module: { exports: {} }, exports: {}, console, process };
vm.runInNewContext(H.split("(async () => {")[0] + "\nmodule.exports={stub};", sb);
const BASE = sb.module.exports.stub;

const REAL = JSON.parse(fs.readFileSync(__dirname + "/real-events.json", "utf8")).events
  .map(e => JSON.parse(JSON.stringify(e).split("2026-08-14").join("2026-08-17")));

const clock = t => `const R=Date;const O=new R("${t}").getTime()-R.now();
window.Date=class extends R{constructor(...a){if(a.length===0)super(R.now()+O);else super(...a);}static now(){return R.now()+O;}};`;

const SCENARIOS = [
  { name: "light day",  stub: BASE.replace(/const DAY = [^;]+;/, 'const DAY = "2026-08-17";'), at: "2026-08-17T08:30:00+03:00" },
  { name: "packed day", stub: BASE.replace(/const EVENTS = [^;]+;/, "const EVENTS = " + JSON.stringify(REAL) + ";"), at: "2026-08-17T08:30:00+03:00" },
  { name: "late start", stub: BASE.replace(/const DAY = [^;]+;/, 'const DAY = "2026-08-17";'), at: "2026-08-17T17:40:00+03:00" }
];

(async () => {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  let failures = 0;

  for (const sc of SCENARIOS) {
    const ctx = await browser.newContext({ viewport: { width: 760, height: 900 }, timezoneId: "Asia/Jerusalem" });
    const p = await ctx.newPage();
    const errs = [];
    p.on("pageerror", e => errs.push(e.message));
    await p.setContent(`<!doctype html><html><head><meta charset="utf-8"><script>${clock(sc.at)}${sc.stub}<\/script></head><body>${page_html}</body></html>`, { waitUntil: "load" });
    await p.waitForTimeout(2800);

    const r = await p.evaluate(() => {
      const d = new Date();
      const blocks = allEvents().filter(e => e.isTask && !e.allDay && overlapsDay(e, d))
        .map(e => ({ n: e.summary, s: minsOf(e.start), e: minsOf(e.end), deep: e.deep }));
      /* permeable meetings are ones you've said tasks may run inside */
      const real = allEvents().filter(e => !e.isTask && !e.allDay && overlapsDay(e, d) && !permeable(e))
        .map(e => ({ n: e.summary, s: minsOf(e.start), e: minsOf(e.end) }));
      const open = allEvents().filter(e => !e.isTask && !e.allDay && overlapsDay(e, d) && permeable(e))
        .map(e => e.summary);
      const have = existingBlocks(d);
      return { blocks, real, open, have, winS: CFG.dayStart * 60, winE: CFG.dayEnd * 60, buf: CFG.buffer,
               maxSmall: CFG.maxSmall, maxDeep: CFG.maxDeep, quickTotal: CFG.quickTotal };
    });

    const ov = (a, b) => a.s < b.e && a.e > b.s;
    const fails = [];

    // 1. never on top of a meeting that blocks (permeable ones are allowed)
    for (const t of r.blocks)
      for (const m of r.real)
        if (ov(t, m)) fails.push(`"${t.n}" ${t.s}-${t.e} overlaps meeting "${m.n}" ${m.s}-${m.e}`);

    // 2. work sessions keep their buffer clear on both sides
    for (const dpe of r.blocks.filter(b => b.deep))
      for (const t of r.blocks)
        if (t !== dpe && ov(t, { s: dpe.s - r.buf, e: dpe.e + r.buf }))
          fails.push(`"${t.n}" intrudes on the buffer around session "${dpe.n}"`);

    // 3. task blocks never overlap each other (touching is fine — quick tasks
    //    share one contiguous window by design)
    for (let i = 0; i < r.blocks.length; i++)
      for (let j = i + 1; j < r.blocks.length; j++)
        if (ov(r.blocks[i], r.blocks[j])) fails.push(`"${r.blocks[i].n}" overlaps "${r.blocks[j].n}"`);

    // 3b. all quick tasks fit inside one window of CFG.quickTotal
    const q = r.blocks.filter(b => !b.deep).sort((a, b) => a.s - b.s);
    if (q.length && (q[q.length - 1].e - q[0].s) > r.quickTotal)
      fails.push(`quick tasks span ${q[q.length-1].e - q[0].s}min > ${r.quickTotal}`);

    // 4. daily caps hold after a run
    if (r.have.small > r.maxSmall) fails.push(`${r.have.small} quick tasks exceeds cap ${r.maxSmall}`);
    if (r.have.deep > r.maxDeep) fails.push(`${r.have.deep} sessions exceeds cap ${r.maxDeep}`);

    // 5. everything sits inside the working window
    for (const t of r.blocks)
      if (t.s < r.winS || t.e > r.winE)
        fails.push(`"${t.n}" ${t.s}-${t.e} falls outside ${r.winS}-${r.winE}`);

    const fmt = m => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    console.log(`\n=== ${sc.name} (${sc.at.slice(11, 16)}) ===`);
    console.log(`  page errors: ${errs.length ? errs.join(" | ") : "none"}`);
    console.log(`  ${r.have.small}/${r.maxSmall} quick · ${r.have.deep}/${r.maxDeep} session · ${r.real.length} blocking` +
      (r.open.length ? ` · open: ${r.open.join(", ")}` : ""));
    r.blocks.sort((a, b) => a.s - b.s).forEach(t => console.log(`    ${fmt(t.s)}-${fmt(t.e)} ${t.deep ? "[session] " : ""}${t.n}`));
    console.log(fails.length ? "  FAIL:\n" + fails.map(f => "    ✗ " + f).join("\n") : "  ✓ all rules hold");
    failures += fails.length + errs.length;
    await ctx.close();
  }

  await browser.close();
  console.log(failures ? `\n${failures} failure(s)` : "\nall scenarios pass");
  process.exit(failures ? 1 : 0);
})();
