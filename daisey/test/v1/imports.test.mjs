// Every app module's exports, called in another module, must be imported
// there. A missing import is a ReferenceError only on tap (Mor, 2026-10-09:
// "I'm a passenger", "I'm home" and "Not moving" on Now all did nothing).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const dir = new URL("../../app/js/", import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith(".js"));
// Comments out: "day.js capacity()" in a comment is no call.
const bare = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
const src = Object.fromEntries(files.map((f) => [f, bare(readFileSync(new URL(f, dir), "utf8"))]));
const exported = (s) => [...s.matchAll(/export\s+(?:async\s+)?(?:function\*?|const|let)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);
const known = (s, name) => new RegExp(String.raw`(?:\bimport\s*\{[^}]*\b${name}\b[^}]*\}|\b(?:function|const|let|var)\s+${name}\b|[({,]\s*${name}\s*[,)=}]|\b${name}\s*=>)`).test(s);

test("every exported function called elsewhere is imported there", () => {
  const missing = [];
  for (const [from, s] of Object.entries(src)) {
    for (const name of exported(s)) {
      for (const [f, t] of Object.entries(src)) {
        if (f === from || !new RegExp(String.raw`(?<![.\w$])${name}\(`).test(t)) continue;
        if (!known(t, name)) missing.push(`${f} calls ${name}() from ${from}`);
      }
    }
  }
  assert.deepEqual(missing, []);
});
