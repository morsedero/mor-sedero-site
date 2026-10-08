// where.js: fixes → home / out / unknown. PURE part only (placeFrom).
import test from "node:test";
import assert from "node:assert/strict";
import { placeFrom } from "../../app/js/where.js";
import { placeNow } from "../../app/js/context.js";
import { filterOut, rank, whyText } from "../../app/js/engine.js";
import * as W from "../../app/js/weights.js";

const HOME = { lat: 32.0853, lng: 34.7818 };
const PLACES = [{ name: "Home", ...HOME }];
const fix = (dLat = 0, t = 0, extra = {}) => ({ lat: HOME.lat + dLat, lng: HOME.lng, acc: 20, speed: null, t, ...extra });

test("where: still at home → home; still 1 km away → out", () => {
  assert.equal(placeFrom([fix(0, 0), fix(0.00005, 10000)], PLACES), "home");
  assert.equal(placeFrom([fix(0.009, 0), fix(0.009, 10000)], PLACES), "out");
});

test("where: walking under ~10 km/h, a ride over it, even next to home; reported speed wins", () => {
  assert.equal(placeFrom([fix(0.009, 0, { acc: 5 }), fix(0.0092, 10000, { acc: 5 })], PLACES), "walk"); // ~22 m in 10 s, 12 m of it past the error, 1 km from home
  assert.equal(placeFrom([fix(0, 0, { acc: 5 }), fix(0.0002, 10000, { acc: 5 })], PLACES), "home"); // same pace inside the house: pacing, not a walk
  assert.equal(placeFrom([fix(0, 0, { speed: 1.2 }), fix(0, 1000, { speed: 1.4 })], PLACES), "home"); // reported walking speed indoors
  assert.equal(placeFrom([fix(0, 0, { speed: 8 }), fix(0, 1000, { speed: 9 })], PLACES), "ride");
  assert.equal(placeFrom([fix(0, 0, { speed: 0 }), fix(0, 1000, { speed: 0 })], PLACES), "home");
  assert.equal(placeFrom([fix(0, 0, { speed: 1.5 }), fix(0, 1000, { speed: 1.5 })], []), "walk"); // no home needed
});

test("where: a named ride holds for 2 hours, then asks again", () => {
  const fast = [fix(0, 0, { speed: 15 }), fix(0, 1000, { speed: 15 })], now = Date.now();
  assert.equal(placeFrom(fast, PLACES, { mode: "train", at: now - 3600e3 }, now), "train");
  assert.equal(placeFrom(fast, PLACES, { mode: "train", at: now - 3 * 3600e3 }, now), "ride");
});

test("where: a jitter inside the fixes' accuracy isn't travel", () => {
  assert.equal(placeFrom([fix(0, 0, { acc: 60 }), fix(0.0004, 10000, { acc: 60 })], PLACES), "home"); // ~44 m < 60 m accuracy
});

test("where: a vague first fix jumping to a sharp one isn't a ride", () => {
  // Wi-Fi guess 60 m off, then GPS a second later: 60 m/s before the fix.
  assert.equal(placeFrom([fix(0.00055, 0, { acc: 80 }), fix(0, 1000, { acc: 5 })], PLACES), "home");
  // Two sharp fixes 60 m apart in 2 s: too short a span to call it travel.
  assert.equal(placeFrom([fix(0.00055, 0, { acc: 8 }), fix(0, 2000, { acc: 8 })], PLACES), "home");
  // One fast reading among still ones; a fast reading from a vague fix.
  assert.equal(placeFrom([fix(0, 0, { speed: 0 }), fix(0, 1000, { speed: 6 }), fix(0, 2000, { speed: 0.2 })], PLACES), "home");
  assert.equal(placeFrom([fix(0, 0, { speed: 9, acc: 120 }), fix(0, 1000, { speed: 0 })], PLACES), "home");
  // A real ride still reads as one.
  assert.equal(placeFrom([fix(0, 0, { speed: 12 }), fix(0, 1000, { speed: 13 }), fix(0, 2000, { speed: 0.5 }), fix(0, 3000, { speed: 12 })], PLACES), "ride");
});

test("where: a Home saved from a vague fix reaches that much further", () => {
  const far = [fix(0.0025, 0), fix(0.0025, 10000)]; // ~280 m from the saved point
  assert.equal(placeFrom(far, PLACES), "out");
  assert.equal(placeFrom(far, [{ ...PLACES[0], acc: 300 }]), "home");
});

test("where: no home saved and still → unknown; no fixes → unknown", () => {
  assert.equal(placeFrom([fix(0, 0), fix(0, 10000)], []), null);
  assert.equal(placeFrom([], PLACES), null);
});

test("placeNow: location beats the calendar; a fresh correction beats location", () => {
  const now = Date.now();
  const ev = [{ start: new Date(now - 6e5).toISOString(), end: new Date(now + 6e5).toISOString(), location: "Office" }];
  assert.equal(placeNow({ located: "home", events: ev, now }).value, "home");
  assert.equal(placeNow({ located: null, events: ev, now }).value, "out");
  assert.equal(placeNow({ correction: { value: "out", at: now }, located: "home", now }).value, "out");
});

test("place blocks: walking takes calls and errands; a bus no laptop; driving only calls", () => {
  const m = (place) => ({ place, now: Date.now(), booked: {}, sessionSkips: new Set(), officeOpen: true });
  const t = (where) => ({ id: where, title: where, status: "open", where, size: 0 });
  const ok = (place, where) => filterOut(t(where), m(place)) !== "place";
  assert.ok(ok("walk", "phone") && ok("walk", "out") && !ok("walk", "computer") && !ok("walk", "home"));
  assert.ok(ok("train", "computer") && !ok("train", "out"));
  assert.ok(ok("bus", "phone") && !ok("bus", "computer") && !ok("ride", "computer"));
  assert.ok(W.PLACES.every((p) => p === "car" || ok(p, "anywhere")));
  assert.ok(["anywhere", "phone", "computer", "home", "out"].every((w) => !ok("car", w)));
  // Hands-free calls are the exception; a text (phone, but not a call) isn't.
  const drive = (type) => filterOut({ ...t("phone"), type }, m("car"));
  assert.equal(drive("call"), null);
  assert.equal(drive("admin"), "place");
});

test("where: still near a saved place that isn't Home → spot:<name>; no Home + nowhere known → unknown", () => {
  const studio = [...PLACES, { name: "Studio", lat: HOME.lat + 0.02, lng: HOME.lng }];
  assert.equal(placeFrom([fix(0.02, 0), fix(0.02, 10000)], studio), "spot:Studio");
  assert.equal(placeFrom([fix(0.05, 0), fix(0.05, 10000)], studio), "out");
  assert.equal(placeFrom([fix(0.05, 0), fix(0.05, 10000)], [{ name: "Studio", lat: HOME.lat + 0.02, lng: HOME.lng }]), null);
});

test("spot: tasks naming the place rank higher there, and say why", () => {
  const now = Date.now();
  const t = (title, project) => ({ id: title, title, project, status: "open", where: "anywhere", size: 30, createdAt: now, touchedAt: now });
  const r = rank([t("Email the bank", "Admin"), t("Bounce the mix", "Studio sessions")], { now, place: "spot", spot: "Studio", window: 60 });
  assert.equal(r.pick.task.title, "Bounce the mix");
  assert.match(whyText(r.pick.whyParts), /you're at Studio/);
  assert.equal(placeNow({ located: "spot:Studio", now }).value, "spot");
  assert.equal(placeNow({ located: "spot:Studio", now }).spot, "Studio");
});
