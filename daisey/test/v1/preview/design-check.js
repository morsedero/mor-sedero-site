#!/usr/bin/env node
/* DOM checks for the design round 4 states (2026-10-18). Each check renders a
   preview scenario (preview.js, real app code, fake store) and reads the
   page's text, so it asserts what is on screen, not what the code meant.

     node daisey/test/v1/preview/design-check.js [slice]

   Prints PASS/FAIL per check, exits 1 on any FAIL. */
const { execFileSync } = require("child_process");
const os = require("os");
const path = require("path");

const PREVIEW = path.join(__dirname, "preview.js");
const OUT = path.join(os.tmpdir(), "daisey-design-check");

function text(scenario, ...args){
  return execFileSync(process.execPath, [PREVIEW, scenario, "--out", OUT, "--at", "10:42", "--text", ...args],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 120000 });
}

const SECONDS = /\b\d{1,2}:\d{2}:\d{2}\b/;
const CHECKS = {
  1: [
    ["Now card: Done, Switch and Later, no Start, no Not now, HH:MM clock", () => {
      const t = text("en");
      return ["Done", "Switch", "Later"].every((w) => t.includes(w)) && !/\bStart\b/.test(t) && !t.includes("Not now") && !SECONDS.test(t);
    }],
    ["Later opens its dropdown with the five choices", () => {
      const t = text("en", "--click", "[aria-label^='Later:']");
      return ["Later today", "Tomorrow", "This week", "Waiting on…", "Put on hold"].every((w) => t.includes(w));
    }],
    ["Waiting on… swaps the dropdown for its form", () => {
      const t = text("en", "--click", "[aria-label^='Later:']", "--click", "[aria-label^='Pending:']");
      return t.includes("Waiting on what?") && !t.includes("Later today");
    }],
  ],
  2: [
    ["Needs you: one card, pager '1 of N', main answer on the card, More holds the rest", () => {
      const t = text("old", "--click", "#needsChip");
      return /\b1 of \d+\b/.test(t) && t.includes("More") && !t.includes("Ask me later");
    }],
    ["More opens On hold, Delete task and Ask me later", () => {
      const t = text("old", "--click", "#needsChip", "--click", ".dc-more", "--click", ".dc-list .btn:last-child", "--click", ".dc-more");
      return t.includes("Still doing this?") && ["On hold", "Delete task", "Ask me later"].every((w) => t.includes(w));
    }],
    ["Routine nudge: one line, no zero count; a tap opens the card", () => {
      const line = text("nag", "--days", "3");
      const card = text("nag", "--days", "3", "--click", ".routine-nag");
      return line.includes("Portuguese") && !/\b0 of \d/.test(line) && card.includes("Routine") && card.includes("Just 15 min");
    }],
    ["Plan ready: every row listed, Approve / Rethink / No plan, no summary line", () => {
      const t = text("squeeze-proposed", "--cal", "squeeze", "--click", "#planChip", "--click", ".sc-planbtn");
      return ["Approve", "Rethink", "No plan", "Mix review for Reprise", "Lesson prep"].every((w) => t.includes(w));
    }],
  ],
};

const only = process.argv[2];
let failed = 0;
for (const [slice, checks] of Object.entries(CHECKS)) {
  if (only && only !== slice) continue;
  for (const [name, run] of checks) {
    let ok = false;
    try { ok = run(); } catch (e) { console.log(`  error: ${e.message.split("\n")[0]}`); }
    if (!ok) failed++;
    console.log(`${ok ? "PASS" : "FAIL"} slice ${slice}: ${name}`);
  }
}
process.exit(failed ? 1 : 0);
