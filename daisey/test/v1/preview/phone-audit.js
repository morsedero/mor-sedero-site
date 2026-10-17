#!/usr/bin/env node
/* Runs audit.js over the app's main screens on phone sizes, in Chromium
   (Android) and WebKit (iPhone), and prints every finding once with the
   configs it showed up in, then the places the two engines lay out
   differently. Needs playwright's chromium + webkit from daisey/test/
   (npx playwright install webkit, once).

     node daisey/test/v1/preview/phone-audit.js [--only screen] [--widths 320,390] [--shots dir]

   Exits non-zero on PAGE-OVERFLOW, OFFSCREEN, CUT, IOS-ZOOM, CLIPPED, OVERLAP or UNDER-BAR. ELLIPSIS,
   CLAMPED, SMALL-TAP and the engine diff are reported, not failed: some are
   deliberate (a one-line toast, a 2-line alt title). */
const { execFile } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const args = process.argv.slice(2);
const opt = (f, d) => { const i = args.indexOf(f); return i < 0 ? d : args[i + 1]; };
const SCREENS = {
  now: [],
  focus: ["--run", "Mix review for Reprise:10"],
  menu: ["--click", "#avatar"],
  plus: ["--click", "#plus"],
  addtask: ["--click", "#plus", "--click", "#plusTask"],
  event: ["--click", "#plus", "--click", "#plusEvent"],
  settings: ["--click", "#avatar", "--click", "#settingsBtn"],
  plan: ["--click", "#planChip"],
  projects: ["--click", "#projectsChip"],
  schedule: ["--cal", "day"],
  tell: ["--chat", "on", "--click", "#tellInput=add milk, call Uri", "--eval", "new Promise((r) => { document.querySelector('#tell').requestSubmit(); setTimeout(r, 900); })"],
  needs: ["--cal", "day", "--click", "#needsChip"],
  later: ["--click", "[aria-label^='Later:']"],
};
const PHONES = { 320: 568, 360: 780, 390: 844, 430: 932 };
const widths = (opt("--widths") || Object.keys(PHONES).join(",")).split(",").map(Number);
const only = opt("--only");
const shots = opt("--shots", path.join(os.tmpdir(), "daisey-phone-audit"));
const engines = ["chromium", "webkit"];
const jobs = [];
for (const [screen, extra] of Object.entries(SCREENS)) if (!only || only.split(",").includes(screen))
  for (const engine of engines) for (const w of widths) jobs.push({ screen, extra, engine, w });

const run = (j) => new Promise((done) => {
  const out = path.join(shots, `${j.screen}-${j.engine}-${j.w}`);
  const file = out + ".json";
  execFile(process.execPath, [path.join(__dirname, "preview.js"), "mixed", ...j.extra, "--engine", j.engine, "--mobile",
    "--width", String(j.w), "--height", String(PHONES[j.w] || 844), "--at", "11:00", "--audit", file, "--out", out],
  { timeout: 90000 }, (err, stdout, stderr) => {
    let res = null; try { res = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
    done({ ...j, res, err: res ? null : (stderr || String(err)).split("\n").filter(Boolean).slice(-2).join(" | ") });
  });
});

(async () => {
  fs.mkdirSync(shots, { recursive: true });
  const results = [], queue = [...jobs];
  await Promise.all(Array.from({ length: 4 }, async () => { for (let j; (j = queue.shift());) results.push(await run(j)); }));
  const seen = new Map();
  let bad = 0;
  for (const r of results) {
    if (!r.res) { console.log(`ERROR ${r.screen} ${r.engine} ${r.w}: ${r.err}`); bad++; continue; }
    for (const i of r.res.issues) { const k = r.screen + " | " + i.replace(/\d+(px|×\d+)?/g, "#"); const s = seen.get(k) || { i, at: [] }; s.at.push(`${r.engine[0]}${r.w}`); seen.set(k, s); }
  }
  const order = ["PAGE-OVERFLOW", "OFFSCREEN", "CUT", "IOS-ZOOM", "CLIPPED", "OVERLAP", "UNDER-BAR", "ELLIPSIS", "CLAMPED", "SMALL-TAP"];
  const rank = (k) => order.findIndex((o) => k.split(" | ")[1].startsWith(o));
  for (const [k, s] of [...seen].sort((a, b) => rank(a[0]) - rank(b[0]))) {
    const [screen] = k.split(" | ");
    if (/^(PAGE-OVERFLOW|OFFSCREEN|CUT|IOS-ZOOM|CLIPPED|OVERLAP|UNDER-BAR)/.test(s.i)) bad++;
    console.log(`${screen.padEnd(9)} ${s.i}  [${s.at.join(" ")}]`);
  }
  // Engine diff: the same element more than 3px apart in size or place.
  for (const screen of Object.keys(SCREENS)) for (const w of widths) {
    const c = results.find((r) => r.screen === screen && r.engine === "chromium" && r.w === w)?.res;
    const k = results.find((r) => r.screen === screen && r.engine === "webkit" && r.w === w)?.res;
    if (!c || !k) continue;
    const diffs = [];
    for (const [p, a] of Object.entries(c.geo)) { const b = k.geo[p]; if (!b) continue;
      const d = [1, 2, 3, 4].map((n) => b[n] - a[n]);
      if (Math.abs(d[2]) > 3 || Math.abs(d[3]) > 3) diffs.push(`${a[0]} w${d[2] >= 0 ? "+" : ""}${d[2]} h${d[3] >= 0 ? "+" : ""}${d[3]}`); }
    if (diffs.length) console.log(`DIFF ${screen} ${w}: webkit vs chromium — ${diffs.slice(0, 6).join("; ")}${diffs.length > 6 ? ` (+${diffs.length - 6})` : ""}`);
  }
  console.log(`${results.length} runs, ${bad} failing findings. Shots: ${shots}`);
  process.exit(bad ? 1 : 0);
})();
