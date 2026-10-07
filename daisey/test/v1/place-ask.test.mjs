// where.js placeAsk: when Daisey asks "Are you home?" / "Name this place?"
// (Mor, 2026-10-07: places are learned by asking, not in Settings).
// Fakes localStorage, document and geolocation, then drives the real module.
import test from "node:test";
import assert from "node:assert/strict";

const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
globalThis.document = { hidden: false, addEventListener(){}, removeEventListener(){} };
let here = { lat: 32.0853, lng: 34.7818 };
Object.defineProperty(globalThis, "navigator", { configurable: true, value: { geolocation: {
  watchPosition(ok){ setTimeout(() => { for (let i = 0; i < 3; i++) ok({ coords: { latitude: here.lat, longitude: here.lng, accuracy: 20, speed: 0 }, timestamp: Date.now() }); }); return 1; },
  clearWatch(){},
} } });

const W = await import("../../app/js/where.js");
const KEY = "daisey.where.v1";
const data = () => JSON.parse(store.get(KEY));
const edit = (f) => { const d = data(); f(d); store.set(KEY, JSON.stringify(d)); };
const settle = () => new Promise((r) => setTimeout(r, 20));
const redetect = async () => { W.setManual(null); await settle(); };

test("placeAsk: no Home → 'home'; No → quiet until you dwell; then 'name'; naming stops it", async () => {
  const stop = W.watchWhere(() => {});
  await settle();
  assert.equal(W.placeAsk(), "home");
  W.notHomeHere();
  assert.equal(W.placeAsk(), null, "not home, first visit, no dwell: nothing to ask");
  edit((d) => { d.seen[0].since -= 31 * 60000; });
  await redetect();
  assert.equal(W.placeAsk(), "name", "30+ min here → name it");
  assert.equal(await W.saveSpot("Studio"), true);
  assert.equal(W.placeAsk(), null);
  assert.equal(W.whereNow(), "spot:Studio");
  stop();
});

test("placeAsk: Home known, a new spot on a 2nd day → 'name'; Not now silences it", async () => {
  here = { lat: 32.2, lng: 34.9 };
  edit((d) => { d.places.push({ name: "Home", lat: 31.5, lng: 34.5 }); });
  await redetect();
  assert.equal(W.whereNow(), "out");
  assert.equal(W.placeAsk(), null, "first visit");
  edit((d) => { const s = d.seen.find((x) => Math.abs(x.lat - 32.2) < 0.001); s.days = ["2000-01-01"]; });
  await redetect();
  assert.equal(W.placeAsk(), "name");
  W.quietHere();
  await redetect();
  assert.equal(W.placeAsk(), null);
});

test("placeAsk: nothing while a place is picked by hand", async () => {
  here = { lat: 32.4, lng: 35.0 };
  await redetect();
  edit((d) => { d.seen[0].days = ["2000-01-01", d.seen[0].days.at(-1)]; });
  assert.equal(W.placeAsk(), "name");
  W.setManual("out");
  assert.equal(W.placeAsk(), null);
});

test("reservedName: mode names can't be place names", () => {
  assert.equal(W.reservedName(" Train "), true);
  assert.equal(W.reservedName("Studio"), false);
});
