/* Rule assertions against the live DOM after an auto-plan. */
const fs = require("fs"), path = require("path");
const { chromium } = require("playwright");
const H = fs.readFileSync(path.join(__dirname, "harness.js"), "utf8");

// reuse the harness fixture + stub by re-evaluating its top section
const page_html = fs.readFileSync(path.join(__dirname, "dayflow.html"), "utf8");
const stubMatch = /const stub = `([\s\S]*?)\n`;/.exec(H);
if (!stubMatch) { console.error("could not extract stub"); process.exit(1); }

// rebuild stub by running harness in a sandbox to get the interpolated string
const vm = require("vm");
const sandbox = { require, __dirname, module: { exports: {} }, exports: {}, console, process };
const src = H.split("(async () => {")[0] + "\nmodule.exports = { stub, page_html };";
vm.runInNewContext(src, sandbox);
const stub = sandbox.module.exports.stub;

const doc = extra => `<!doctype html><html><head><meta charset="utf-8">
<script>${extra}${stub}<\/script></head><body>${page_html}</body></html>`;

const monday = `
  window.__EVENT_DAY = "2026-08-17";
  const RealDate = Date;
  const OFFSET = new RealDate("2026-08-17T08:30:00+03:00").getTime() - RealDate.now();
  window.Date = class extends RealDate {
    constructor(...a){ if(a.length===0) super(RealDate.now()+OFFSET); else super(...a); }
    static now(){ return RealDate.now()+OFFSET; }
  };
`;

(async () => {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const ctx0 = await browser.newContext({ viewport:{width:1440,height:940}, timezoneId:"Asia/Jerusalem" }); const p = await ctx0.newPage();
  const errs = [];
  p.on("pageerror", e => errs.push(e.message));
  await p.setContent(doc(monday), { waitUntil: "load" });
  await p.waitForTimeout(3000);

  const data = await p.evaluate(() => {
    const PPM = PPM_DAY, GS = GRID_START_H * 60;
    const toMin = node => {
      const top = parseFloat(node.style.top), h = parseFloat(node.style.height);
      return { s: Math.round(GS + top / PPM), e: Math.round(GS + (top + h + 2) / PPM) };
    };
    const out = { real: [], task: [], deep: [], buffer: [], calls: window.__calls.length };
    document.querySelectorAll(".daycol .ev").forEach(n => {
      const m = toMin(n);
      m.name = (n.querySelector(".ev-n") || {}).textContent || "";
      if (n.classList.contains("buffer")) out.buffer.push(m);
      else if (n.classList.contains("real")) out.real.push(m);
      else { out.task.push(m); if (n.classList.contains("deep")) out.deep.push(m); }
    });
    return out;
  });

  const ov = (a, b) => a.s < b.e && a.e > b.s;
  const fails = [];

  for (const t of data.task)
    for (const r of data.real)
      if (ov(t, r)) fails.push(`task "${t.name}" ${t.s}-${t.e} overlaps REAL "${r.name}" ${r.s}-${r.e}`);

  for (const t of data.task)
    for (const b of data.buffer)
      if (ov(t, b)) fails.push(`task "${t.name}" ${t.s}-${t.e} intrudes on BUFFER ${b.s}-${b.e}`);

  for (let i = 0; i < data.task.length; i++)
    for (let j = i + 1; j < data.task.length; j++)
      if (ov(data.task[i], data.task[j]))
        fails.push(`task "${data.task[i].name}" overlaps task "${data.task[j].name}"`);

  const smalls = data.task.filter(t => !data.deep.some(d => d.s === t.s));
  console.log("page errors :", errs.length ? errs : "none");
  console.log("real events :", data.real.length);
  console.log("task blocks :", data.task.length, "(deep:", data.deep.length + ")");
  console.log("buffers     :", data.buffer.length);
  console.log("write calls :", data.calls);
  console.log(data.task.map(t => `  ${Math.floor(t.s/60)}:${String(t.s%60).padStart(2,"0")}-${Math.floor(t.e/60)}:${String(t.e%60).padStart(2,"0")}  ${t.name}`).join("\n"));
  console.log(fails.length ? "\nFAILURES:\n" + fails.map(f => " ✗ " + f).join("\n") : "\n✓ all placement rules hold");
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})();
