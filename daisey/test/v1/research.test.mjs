// "Can this be done online?" (research.js + functions/daisey-now-research.js).
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { tidy } = createRequire(import.meta.url)("../../functions/daisey-now-research.js");

test("the model's answer: first JSON object, known values only", () => {
  assert.deepEqual(tidy('```json\n{"online":"yes","why":"אפשר לרכוש באתר"}\n```'), { online: "yes", why: "אפשר לרכוש באתר" });
  assert.deepEqual(tidy('Sure. {"online":"no","why":"Needs a call"} Hope that helps'), { online: "no", why: "Needs a call" });
  assert.equal(tidy('{"online":"maybe","why":"x"}'), null);
  assert.equal(tidy("no idea"), null);
});

const { worthChecking } = await import("../../app/js/research.js");
test("only a guessed office-hours task is worth checking, once", () => {
  assert.equal(worthChecking({ openHours: "office", guessed: ["openHours", "size"] }), true);
  assert.equal(worthChecking({ openHours: "office", guessed: ["size"] }), false); // the user chose it
  assert.equal(worthChecking({ openHours: "anytime", guessed: ["openHours"] }), false);
  assert.equal(worthChecking({ openHours: "office", guessed: ["openHours"], research: { online: "no" } }), false);
});
