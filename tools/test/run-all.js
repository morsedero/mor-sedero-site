/* Runs the whole Daisey suite in one command and exits non-zero if anything
   failed. Before this existed `npm test` was the npm stub (`exit 1`) and the
   37 files had to be run by hand, one at a time, against three incompatible
   result conventions — so in practice the suite was not run, and bugs that
   it already covered reached the user anyway.

   Two jobs, and the first matters more than the second:

   1. REFRESH THE COPY. Every test reads `tools/test/daisey.html`, which is a
      gitignored manual copy of `tools/daisey.html`. It goes stale silently
      and the suite then passes against whatever the file said last time
      somebody copied it — that is not theoretical, a `moveAssetTo` fix was
      once "confirmed" by a green tracker.js still driving the old shape.
      Copying on every run removes the failure mode instead of documenting it.

   2. NORMALIZE PASS/FAIL. Three conventions are in play:
        - 28 files call process.exit(1)          -> trust the exit code
        - dead/late/states/tick print "[label] ERR" and exit 0
        - det/edit/hub/mini print raw JSON with no marker at all
      So a file is failed if it exits non-zero OR its output matches the
      failure vocabulary. det/edit/hub/mini have no assertions whatsoever and
      cannot fail on their own; they are reported as DUMP, counted separately,
      and never gate the run. That is a coverage gap to close, not something
      to hide behind a green check. */

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const DIR = __dirname;
const SRC = path.join(DIR, "..", "daisey.html");
const DST = path.join(DIR, "daisey.html");

/* Not tests: harness.js is a screenshot script whose top half other files
   scrape for `stub`, mock-proxy.js is a server standalone.js starts itself,
   and run-all.js is this file. */
const NOT_TESTS = new Set(["harness.js", "mock-proxy.js", "run-all.js"]);

/* No assertions at all — they log state and screenshot. Reported, not gating. */
const DUMP_ONLY = new Set(["det.js", "edit.js", "hub.js", "mini.js"]);

/* Matches the "[label] ERR ..." convention and hard crashes. Deliberately not
   matching a bare "error" — several tests legitimately print
   "errors: none" / "page errors: none" on a good run. */
const FAIL_RE = /(^|\s)(FAIL|ERR)\b|✗|Unhandled|Cannot find module|ReferenceError|TypeError|SyntaxError|TimeoutError|triggerUncaughtException|page\.\w+: Timeout/;

const args = process.argv.slice(2);
const only = args.filter(a => !a.startsWith("-"));
/* Serial by default. These are full Chromium sessions driving an 8000-line
   page, and every suite waits on fixed `waitForTimeout` durations rather than
   on conditions — so under CPU contention a drag or a write can land after the
   window the test measures. retry.js reported calls:0 at 4-way parallelism and
   failed again at 2-way, while passing 3/3 run on its own. The whole suite is
   ~4 min serial; that is worth paying for a result you can believe. Pass
   --jobs=N to override. */
const jobs = Math.max(1, Number((args.find(a => a.startsWith("--jobs=")) || "").split("=")[1]) || 1);

function refreshCopy() {
  if (!fs.existsSync(SRC)) {
    console.error(`FATAL: ${SRC} does not exist — nothing to test.`);
    process.exit(2);
  }
  fs.copyFileSync(SRC, DST);
  const kb = (fs.statSync(DST).size / 1024).toFixed(0);
  console.log(`refreshed daisey.html from ../daisey.html (${kb} KB)\n`);
}

function run(file) {
  return new Promise(resolve => {
    const started = Date.now();
    /* cwd is the test dir: several files read "harness.js"/"daisey.html" as
       bare relative paths rather than via __dirname. */
    const ch = spawn(process.execPath, [file], { cwd: DIR });
    let out = "";
    ch.stdout.on("data", d => (out += d));
    ch.stderr.on("data", d => (out += d));
    ch.on("close", code => {
      const secs = ((Date.now() - started) / 1000).toFixed(1);
      const dump = DUMP_ONLY.has(file);
      const failed = dump ? false : code !== 0 || FAIL_RE.test(out);
      resolve({ file, code, out, secs, dump, failed });
    });
  });
}

(async () => {
  refreshCopy();

  let files = fs.readdirSync(DIR)
    .filter(f => f.endsWith(".js") && !NOT_TESTS.has(f))
    .sort();
  if (only.length) files = files.filter(f => only.includes(f) || only.includes(f.replace(/\.js$/, "")));

  if (!files.length) {
    console.error("no test files matched");
    process.exit(2);
  }

  console.log(`running ${files.length} suites, ${jobs} at a time\n`);

  const results = [];
  const queue = files.slice();
  await Promise.all(Array.from({ length: Math.min(jobs, queue.length) }, async () => {
    while (queue.length) {
      const file = queue.shift();
      let r = await run(file);
      /* One retry on failure. These suites wait on fixed timeouts rather than
         conditions, so a slow machine can fail one spuriously — but a suite
         that only passes on the second try is reported as FLAKY, not as a
         pass, because that is a real defect worth seeing. */
      if (r.failed) {
        const again = await run(file);
        if (!again.failed) { r = again; r.flaky = true; }
      }
      results.push(r);
      const tag = r.dump ? "DUMP" : r.failed ? "FAIL" : r.flaky ? "FLAKY" : "ok  ";
      console.log(`  ${tag}  ${r.file.padEnd(16)} ${r.secs}s`);
    }
  }));

  results.sort((a, b) => a.file.localeCompare(b.file));
  const failed = results.filter(r => r.failed);
  const dumps = results.filter(r => r.dump);

  for (const r of failed) {
    console.log(`\n${"=".repeat(60)}\nFAIL ${r.file} (exit ${r.code})\n${"=".repeat(60)}`);
    /* tail only — these suites print full day schedules on success too */
    console.log(r.out.trim().split("\n").slice(-25).join("\n"));
  }

  const flaky = results.filter(r => r.flaky);
  const passed = results.length - failed.length - dumps.length;
  console.log(`\n${"-".repeat(60)}`);
  console.log(`${passed} passed · ${failed.length} failed · ${flaky.length} flaky · ${dumps.length} dump-only (no assertions)`);
  if (flaky.length) console.log(`flaky (passed only on retry): ${flaky.map(f => f.file).join(", ")}`);
  if (dumps.length) console.log(`dump-only: ${dumps.map(d => d.file).join(", ")} — these cannot fail; read them by hand`);
  if (failed.length) console.log(`failed: ${failed.map(f => f.file).join(", ")}`);

  process.exit(failed.length ? 1 : 0);
})();
