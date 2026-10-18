// The Undo toast stays 8 seconds (Mor, 2026-10-18; was 3.5 s).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { UNDO_MS, UNDO_FADE_MS } from "../../app/js/undo.js";

const read = (f) => fs.readFileSync(new URL(`../../app/${f}`, import.meta.url), "utf8");

test("undo toast: 8 s, one number for the flash and the Now card's toast, fade 300 ms before the end", () => {
  assert.equal(UNDO_MS, 8000);
  assert.match(read("js/ui.js"), /import \{ UNDO_MS \} from "\.\/undo\.js"/);
  assert.match(read("js/now.js"), /import \{ UNDO_MS \} from "\.\/undo\.js"/);
  assert.doesNotMatch(read("js/now.js"), /const UNDO_MS\s*=/, "no private copy");
  assert.doesNotMatch(read("js/ui.js"), /const UNDO_MS\s*=/, "no private copy");
  const fadeAt = UNDO_MS - UNDO_FADE_MS;
  assert.equal(fadeAt, 7700);
  const css = read("css/app.css");
  const rule = css.split(String.fromCharCode(10)).find((l) => l.startsWith(".toast.timed {")) || "";
  assert.ok(rule.includes(`toast-out .3s ease-in ${fadeAt}ms forwards`) && rule.includes(`calc(${fadeAt}ms - var(--age, 0ms))`), "the CSS fade starts at UNDO_MS - 300");
});
