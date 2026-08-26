#!/usr/bin/env node
/* Generates tools/daisey-standalone.html from tools/daisey.html.
 *
 * WHY THIS EXISTS AT ALL: daisey-standalone.html cannot be a hand-maintained
 * fork. tools/CLAUDE.md already documents, at length, how easy it is for a
 * copy of this file to silently drift from the real one — the test suite's
 * own tools/test/daisey.html has to be actively re-copied before every run
 * for exactly that reason, and CLAUDE.md records at least two real incidents
 * where a hand-edit was lost to a stale copy. A generated file makes that
 * class of bug structurally impossible for the standalone build: there is
 * only ever one source of truth, tools/daisey.html, and this script is the
 * only thing allowed to produce the other file.
 *
 * WHAT IT DOES: literal text splicing, not parsing. Two markers must exist
 * verbatim in daisey.html — BUILD-STANDALONE:MCP-RESOLVE / END
 * BUILD-STANDALONE:MCP-RESOLVE, wrapping the `window.claude.use("mcp")`
 * resolution inside boot(). Everything between them is replaced with the
 * standalone session-check + shim wiring; the two source files in
 * tools/_standalone-src/ (mcp-shim.js's functions, boot-block.js's
 * replacement body) are inlined around/into that point. Every other line of
 * daisey.html — all ~27 Trello/Google call sites, setupWizard, the whole
 * scheduling engine — passes through completely unmodified.
 *
 * Run this after every edit to tools/daisey.html that you want reflected in
 * the standalone build. It is NOT run automatically by anything else in
 * this repo (no Netlify build hook) — that's deliberate for now, so a
 * broken splice fails loudly in a manual run rather than silently shipping.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(__dirname, "daisey.html");
const OUT = path.join(__dirname, "daisey-standalone.html");
const SHIM_SRC = path.join(__dirname, "_standalone-src", "mcp-shim.js");
const BOOT_BLOCK_SRC = path.join(__dirname, "_standalone-src", "boot-block.js");

const START_MARK = "/* BUILD-STANDALONE:MCP-RESOLVE — tools/build-standalone.js replaces this";
const END_MARK = "/* END BUILD-STANDALONE:MCP-RESOLVE */";

function fail(msg){
  console.error("build-standalone: " + msg);
  process.exit(1);
}

const html = fs.readFileSync(SRC, "utf8");
const shim = fs.readFileSync(SHIM_SRC, "utf8");
const bootBlock = fs.readFileSync(BOOT_BLOCK_SRC, "utf8");

const startIdx = html.indexOf(START_MARK);
const endIdx = html.indexOf(END_MARK);
if(startIdx < 0 || endIdx < 0 || endIdx < startIdx){
  fail(
    "couldn't find the BUILD-STANDALONE:MCP-RESOLVE markers in tools/daisey.html.\n" +
    "  This means boot() was edited in a way that removed or renamed them.\n" +
    "  Find the `mcp = await (window.claude && ...)` line inside boot() and\n" +
    "  re-wrap it with the marker comments (see git history on this file, or\n" +
    "  tools/CLAUDE.md's \"Daisey standalone\" section for the exact shape)."
  );
}

/* Splice: everything up to the start marker, the replacement boot logic
   (which itself starts by resolving `mcp` the standalone way), everything
   after the end marker's own line. The original block's `try{...}catch{}`
   is deliberately dropped, not commented out — leaving dead code that LOOKS
   load-bearing is worse than removing it outright, and this file's own
   provenance comment (below) says where to find the original. */
const endLineEnd = html.indexOf("\n", endIdx) + 1;
const before = html.slice(0, startIdx);
const after = html.slice(endLineEnd);

const replacement =
  "/* --- standalone boot: see tools/_standalone-src/boot-block.js --- */\n" +
  bootBlock;

let out = before + replacement + after;

/* Flip the shared STANDALONE flag. Exactly one occurrence expected — if a
   future edit to daisey.html renames this declaration, fail loudly rather
   than silently leaving the artifact-mode default in place, which would
   make errCopy show Claude-specific copy in the standalone build. */
const FLAG_NEEDLE = "let STANDALONE = false;";
const flagCount = out.split(FLAG_NEEDLE).length - 1;
if(flagCount !== 1) fail(`expected exactly 1 occurrence of "${FLAG_NEEDLE}", found ${flagCount}`);
out = out.replace(FLAG_NEEDLE, "let STANDALONE = false; // overridden to true at runtime, see boot()");

/* Inline the shim's function definitions just before the closing </script>,
   so they're in scope for boot() (which runs as an IIFE further up the same
   script block) without needing a second <script> tag or a module system
   this single-file app doesn't otherwise use. */
const SCRIPT_CLOSE = "</script>";
const closeIdx = out.lastIndexOf(SCRIPT_CLOSE);
if(closeIdx < 0) fail("couldn't find a closing </script> tag to inline the shim before");
out = out.slice(0, closeIdx) +
  "\n/* ==== injected by tools/build-standalone.js from tools/_standalone-src/mcp-shim.js ==== */\n" +
  shim +
  "\n/* ==== end injected shim ==== */\n" +
  out.slice(closeIdx);

const banner =
  `<!-- GENERATED FILE — do not hand-edit.\n` +
  `     Produced by tools/build-standalone.js from tools/daisey.html.\n` +
  `     Edit tools/daisey.html, then re-run: node tools/build-standalone.js\n` +
  `     Built ${new Date().toISOString()} -->\n`;
out = banner + out;

fs.writeFileSync(OUT, out, "utf8");

/* Sanity checks — catch a broken splice here, not in the browser. */
try{ new Function(out.match(/<script>([\s\S]*)<\/script>/)[1]); }
catch(e){ fail("generated file's script block does not parse: " + e.message); }

const mustContain = ["standaloneMcp", "checkStandaloneSession", "renderLoginGate", "STANDALONE = false; // overridden"];
for(const needle of mustContain){
  if(!out.includes(needle)) fail(`generated file is missing expected content: "${needle}"`);
}
if(out.includes("window.claude.use")){
  fail("generated file still references window.claude.use — the splice did not remove the Claude-only path");
}

console.log(`build-standalone: wrote ${path.relative(ROOT, OUT)} (${(out.length/1024).toFixed(0)}KB)`);
