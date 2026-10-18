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
  const at = args.includes("--at") ? [] : ["--at", "10:42"];
  return execFileSync(process.execPath, [PREVIEW, scenario, "--out", OUT, ...at, "--text", ...args],
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
  3: [
    ["Empty day: drawing, one headline, one line, no buttons on the card", () => {
      const t = text("empty");
      return t.includes("No tasks yet") && t.includes("Add a few and Daisey will pick.") && !t.includes("Nothing to pick");
    }],
    ["All done: 'That's everything.', not 'No tasks yet'", () => {
      const t = text("alldone", "--at", "16:00");
      return t.includes("That's everything.") && !t.includes("No tasks yet");
    }],
    ["Nothing fits: headline, one line, keeps its one way out", () => {
      const t = text("breakpick", "--cal", "none", "--at", "19:30");
      return /Nothing fits the next/.test(t) && t.includes("Free until") && t.includes("Show me anyway") && !/^Break$/m.test(t);
    }],
    ["Night: the dusk card, Tomorrow first on its own, no list or counts", () => {
      const t = text("en", "--at", "23:40");
      return /Late, /.test(t) && /tomorrow first/i.test(t) && !/still open for today/.test(t) && !/Done today/.test(t);
    }],
    ["Night: Today opens the day in place of Tomorrow first", () => {
      const t = text("en", "--cal", "squeeze", "--at", "23:40", "--click", "#planChip");
      return t.includes("BOBBA") && !/tomorrow first/i.test(t);
    }],
  ],
  4: [
    ["Projects: 'not started' instead of 0%, 'Next: pick one' when nothing is next", () => {
      const t = text("old", "--click", "#projectsChip");
      return t.includes("not started") && t.includes("pick one") && !/\b0% done\b/.test(t);
    }],
    ["Project screen: 'not started', not 0%", () => {
      const t = text("old", "--click", "#projectsChip", "--click", ".pcard");
      return t.includes("not started") && !/^0%$/m.test(t);
    }],
    ["Stats is a page: Today's Daisey, a bud and no guilt at 0, no counts", () => {
      const t = text("empty", "--click", "#weekChip");
      return /today's daisey/i.test(t) && t.includes("Still a bud") && !t.includes("Nothing done yet") && !/Done today · \d/.test(t);
    }],
    ["Stats with work done: the done list by name, no count", () => {
      const t = text("alldone", "--at", "16:00", "--click", "#weekChip");
      return /done today/i.test(t) && t.includes("Send invoice to Uri") && !/Done today · \d/.test(t);
    }],
    ["Settings: an icon chip on each row", () => {
      const r = require("child_process").spawnSync(process.execPath, [PREVIEW, "old", "--out", OUT, "--at", "10:42", "--click", "#avatar", "--click", "#settingsBtn",
        "--eval", "document.querySelectorAll('#settingsdlg .ichip').length"], { encoding: "utf8", timeout: 120000 });
      return /eval: 4\b/.test(r.stdout + r.stderr);
    }],
    ["+ menu: Task, Event, Project", () => {
      const t = text("old", "--click", "#plus");
      return ["Task", "Event", "Project"].every((w) => t.includes(w));
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
