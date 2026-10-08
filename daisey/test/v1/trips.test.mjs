// trips.js: an event in another city → travel legs. PURE.
import test from "node:test";
import assert from "node:assert/strict";
import * as T from "../../app/js/trips.js";
import { placeNow } from "../../app/js/context.js";
import { freeWindow, filterOut, readMoment } from "../../app/js/engine.js";
import { collectNeeds } from "../../app/js/needs-list.js";

const HOME = { lat: 32.175, lng: 34.907 }; // Kfar Saba
const at = (hhmm) => Date.parse(`2026-10-09T${hhmm}:00+03:00`);
const iso = (hhmm) => new Date(at(hhmm)).toISOString();
const ash = { id: "e1", series: "abc", recurring: true, title: "מחוננים אשקלון", start: iso("08:00"), end: iso("13:00"), busy: true };
const hhmm = (ms) => new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jerusalem" });

test("finds a city in the title or location, with a Hebrew prefix, whole words only", () => {
  assert.equal(T.cityOf(ash)?.name, "Ashkelon");
  assert.equal(T.cityIn("נסיעה לאשקלון")?.name, "Ashkelon");
  assert.equal(T.cityIn("Lunch, Ramat HaSharon")?.name, "Ramat HaSharon"); // not Ramat Gan, not Sharon
  assert.equal(T.cityIn("שדרות רוטשילד 1, תל אביב")?.name, "Tel Aviv"); // a boulevard isn't Sderot
  assert.equal(T.cityIn("יום הולדת לאילת"), null); // a name isn't Eilat
  assert.equal(T.cityIn("Haifaxyz"), null);
  assert.equal(T.cityOf({ title: "Gym", location: "Herzliya Marina" })?.name, "Herzliya");
});

test("estimates from Home; a city next door is no trip", () => {
  const e = T.estimate(T.cityNamed("Ashkelon"), HOME);
  assert.ok(e.car >= 70 && e.car <= 95, `car ${e.car}`);
  assert.ok(e.train > e.car, "the train takes longer");
  assert.equal(T.estimate(T.cityNamed("Ashkelon"), null), null);
  assert.equal(T.isLocal(T.cityNamed("Ra'anana"), HOME), true);
  assert.equal(T.isLocal(T.cityNamed("Ashkelon"), HOME), false);
});

test("asks once per series, not for answered or local ones", () => {
  const now = at("20:00") - 864e5;
  const week2 = { ...ash, id: "e2", start: new Date(at("08:00") + 7 * 864e5).toISOString(), end: new Date(at("13:00") + 7 * 864e5).toISOString() };
  const local = { id: "e3", title: "Coffee in Ra'anana", start: iso("15:00"), end: iso("16:00"), busy: true };
  const asks = T.tripAsks([ash, week2, local], {}, { now, home: HOME, days: 14 });
  assert.deepEqual(asks.map((a) => a.key), ["s:abc"]);
  assert.equal(T.tripAsks([ash], { "s:abc": T.noTrip(T.cityNamed("Ashkelon")) }, { now, home: HOME }).length, 0);
  // Needs you carries it.
  const needs = collectNeeds({ events: [ash], calOk: true, settings: {}, now, home: HOME });
  assert.equal(needs[0]?.kind, "trip");
});

test("typed minutes win; other modes scale without a Home", () => {
  const a = T.answer(T.cityNamed("Ashkelon"), "car", { minutes: 75 });
  assert.equal(a.min.car, 75);
  assert.ok(a.min.train > 75);
  assert.equal(T.answer(T.cityNamed("Ashkelon"), "car", {}), null); // no Home, nothing typed: ask
});

test("legs there and back, busy, and one trip for back-to-back events in a city", () => {
  const trips = { "s:abc": { city: "Ashkelon", mode: "train", min: { train: 110, bus: 125, car: 80 } } };
  const out = T.withTrips([ash], trips);
  const legs = out.filter((e) => e.trip);
  assert.deepEqual(legs.map((l) => [l.title, hhmm(Date.parse(l.start)), hhmm(Date.parse(l.end))]),
    [["Train to Ashkelon", "06:10", "08:00"], ["Train back from Ashkelon", "13:00", "14:50"]]);
  const more = { id: "e4", title: "פגישה אשקלון", start: iso("14:00"), end: iso("15:00"), busy: true };
  const both = T.withTrips([ash, more], { ...trips, [T.tripKey(more)]: trips["s:abc"] }).filter((e) => e.trip);
  assert.equal(both.length, 2);
  assert.equal(hhmm(Date.parse(both[1].start)), "15:00");
  // The chain: the event at its heart, over when the train is back.
  const c = T.chainFrom(out.find((e) => e.trip?.dir === "to"), out);
  assert.equal(c.main.title, ash.title);
  assert.equal(hhmm(c.end), "14:50");
});

test("one day another way, or not going, leaves the answer alone", () => {
  const trips = { "s:abc": { city: "Ashkelon", mode: "train", min: { train: 110, bus: 125, car: 80 } } };
  let day = T.setTripDay([], "2026-10-09", "s:abc", "car");
  assert.equal(T.withTrips([ash], trips, day).find((e) => e.trip).title, "Drive to Ashkelon");
  day = T.setTripDay(day, "2026-10-09", "s:abc", "none");
  assert.equal(day.length, 1);
  assert.equal(T.withTrips([ash], trips, day).some((e) => e.trip), false);
  // Another day: the saved train.
  assert.equal(T.withTrips([ash], trips, T.setTripDay([], "2026-10-16", "s:abc", "car")).find((e) => e.trip).trip.mode, "train");
});

test("on the train: the place is train, the ride is the window, laptop fits, home doesn't", () => {
  const trips = { "s:abc": { city: "Ashkelon", mode: "train", min: { train: 110, bus: 125, car: 80 } } };
  const evs = T.withTrips([ash], trips);
  const now = at("06:30");
  const place = placeNow({ events: evs, now });
  assert.equal(place.value, "train");
  assert.equal(placeNow({ events: evs, now, located: "ride" }).value, "train");
  assert.equal(placeNow({ events: evs, now, located: "home" }).value, "home"); // the phone says you didn't go
  const fw = freeWindow(evs.filter((e) => e.busy !== false), now);
  assert.equal(fw.current?.trip?.dir, "to");
  const m = readMoment({ now, place: "train", window: Math.floor((fw.current.end - now) / 60000) });
  const laptop = { id: "a", title: "Mix", status: "ready", size: 45, where: "computer" };
  const home = { id: "b", title: "Laundry", status: "ready", size: 20, where: "home" };
  assert.equal(filterOut(laptop, m), null);
  assert.equal(filterOut(home, m), "place");
  const car = readMoment({ now, place: "car", window: 60 });
  assert.equal(filterOut(laptop, car), "place");
});
