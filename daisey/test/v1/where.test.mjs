// where.js: fixes → home / out / unknown. PURE part only (placeFrom).
import test from "node:test";
import assert from "node:assert/strict";
import { placeFrom } from "../../app/js/where.js";
import { placeNow } from "../../app/js/context.js";

const HOME = { lat: 32.0853, lng: 34.7818 };
const fix = (dLat = 0, t = 0, extra = {}) => ({ lat: HOME.lat + dLat, lng: HOME.lng, acc: 20, speed: null, t, ...extra });

test("where: still at home → home; still 1 km away → out", () => {
  assert.equal(placeFrom([fix(0, 0), fix(0.00005, 10000)], HOME), "home");
  assert.equal(placeFrom([fix(0.009, 0), fix(0.009, 10000)], HOME), "out");
});

test("where: moving → out, even next to home; reported speed wins", () => {
  assert.equal(placeFrom([fix(0, 0), fix(0.0003, 10000)], HOME), "out"); // ~33 m in 10 s
  assert.equal(placeFrom([fix(0, 0, { speed: 8 }), fix(0, 1000, { speed: 9 })], HOME), "out");
  assert.equal(placeFrom([fix(0, 0, { speed: 0 }), fix(0, 1000, { speed: 0 })], HOME), "home");
});

test("where: a jitter inside the fixes' accuracy isn't travel", () => {
  assert.equal(placeFrom([fix(0, 0, { acc: 60 }), fix(0.0004, 10000, { acc: 60 })], HOME), "home"); // ~44 m < 60 m accuracy
});

test("where: no home saved and still → unknown; no fixes → unknown", () => {
  assert.equal(placeFrom([fix(0, 0), fix(0, 10000)], null), null);
  assert.equal(placeFrom([], HOME), null);
});

test("placeNow: location beats the calendar; a fresh correction beats location", () => {
  const now = Date.now();
  const ev = [{ start: new Date(now - 6e5).toISOString(), end: new Date(now + 6e5).toISOString(), location: "Office" }];
  assert.equal(placeNow({ located: "home", events: ev, now }).value, "home");
  assert.equal(placeNow({ located: null, events: ev, now }).value, "out");
  assert.equal(placeNow({ correction: { value: "out", at: now }, located: "home", now }).value, "out");
});
