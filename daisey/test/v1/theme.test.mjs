// Light wins over night (Mor, 2026-10-18): Auto may go dark at night, but a
// user who picked Light stays Light. Every theme rule keyed on :root.night
// must be guarded with :not([data-theme="light"]). Layout rules for the night
// page (.nowrow, #panel, .night-hero...) stay unguarded: they are not colours.
// Browser check: test/v1/preview/preview.js en --at 02:00 --eval (see the commit).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const css = ["app.css", "design.css"].map((f) => fs.readFileSync(new URL(`../../app/css/${f}`, import.meta.url), "utf8")).join("\n");
const rules = [...css.replaceAll(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
const GUARD = ':not([data-theme="light"])';

test("every dark-theme rule that also keys on :root.night is guarded against a Light pick", () => {
  const themed = rules.filter((r) => /:root\.night/.test(r.sel) && (/data-theme="dark"/.test(r.sel) || /color-scheme|--[a-z-]+:|fill:|stroke:/.test(r.body)));
  assert.ok(themed.length >= 10, `found ${themed.length}`);
  for (const r of themed) {
    for (const part of r.sel.split(",").map((s) => s.trim()).filter((s) => /:root\.night/.test(s))) {
      assert.ok(part.includes(`:root.night${GUARD}`), `unguarded night theme rule: ${part}`);
    }
  }
});

test("a Light pick still gets its own light tokens and color-scheme", () => {
  assert.ok(/:root\[data-theme="light"\]\s*\{\s*color-scheme:\s*light/.test(css));
  assert.ok(!/:root\.night\s*\{\s*color-scheme/.test(css), "night alone no longer forces color-scheme");
});
