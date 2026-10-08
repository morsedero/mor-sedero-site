// Travel to an event in another city (Mor, 2026-10-08: "מחוננים אשקלון" is
// a weekly job in Ashkelon, and he lives in Kfar Saba — ~1h20 each way that
// Daisey didn't know about). PURE: no Firebase, no DOM.
//
// An event names a city (its location, else its title) → Needs you asks once
// per series how you get there: train, bus, car, or not a trip. The answer
// is kept in settings.trips by series (tripKey), so it's never asked again.
// Each answered event then gets two travel legs on the calendar Daisey reads
// (withTrips): there before it starts, back after it ends. They're busy, so
// nothing is planned into them; while one runs, the place is its mode
// (context.js placeNow), so a train offers laptop and phone tasks that fit
// the ride, a car only hands-free calls.
// settings.laptop: true / false, the last answer to "Laptop with you?" (null:
// never asked). A train without one is a bus: phone tasks only. Unknown
// counts as without, so nothing needing a laptop is planned on a guess.
// settings.tripDay = [{ date, key, mode | "none" }]: one day travelled
// another way (or not at all), the saved answer untouched. An array, not a
// map: Firestore's merge would keep an old day's keys inside a map.

const MIN = 60000;
export const MODES = ["train", "bus", "car"];
export const LOCAL_KM = 8; // a city this close to Home is no trip
// Rough door-to-door speed from straight-line km: roads wind (×1.25–1.3),
// plus getting going (parking, the walk to the station and the wait).
const SPEED = { car: { wind: 1.25, kmh: 70, plus: 10 }, train: { wind: 1.3, kmh: 55, plus: 20 }, bus: { wind: 1.3, kmh: 45, plus: 15 } };
// Without a Home to measure from: the other modes from the one answered.
const RATIO = { car: 1, train: 1.35, bus: 1.55 };

// Israeli cities, Hebrew and English names, centre coordinates.
export const CITIES = [
  ["Jerusalem", ["ירושלים"], 31.778, 35.235],
  ["Tel Aviv", ["תל אביב", "תל-אביב", "tel-aviv", "tlv"], 32.085, 34.782],
  ["Haifa", ["חיפה"], 32.794, 34.990],
  ["Rishon LeZion", ["ראשון לציון", "rishon"], 31.964, 34.804],
  ["Petah Tikva", ["פתח תקווה", "פתח תקוה", "petach tikva"], 32.087, 34.887],
  ["Ashdod", ["אשדוד"], 31.804, 34.655],
  ["Netanya", ["נתניה"], 32.332, 34.860],
  ["Beersheba", ["באר שבע", "beer sheva", "be'er sheva"], 31.252, 34.791],
  ["Holon", ["חולון"], 32.011, 34.774],
  ["Bnei Brak", ["בני ברק"], 32.081, 34.833],
  ["Ramat Gan", ["רמת גן"], 32.068, 34.824],
  ["Rehovot", ["רחובות"], 31.894, 34.811],
  ["Ashkelon", ["אשקלון"], 31.669, 34.571],
  ["Bat Yam", ["בת ים"], 32.017, 34.750],
  ["Beit Shemesh", ["בית שמש"], 31.747, 34.988],
  ["Kfar Saba", ["כפר סבא"], 32.175, 34.907],
  ["Herzliya", ["הרצליה"], 32.166, 34.843],
  ["Hadera", ["חדרה"], 32.434, 34.919],
  ["Modiin", ["מודיעין", "modi'in"], 31.898, 35.010],
  ["Nazareth", ["נצרת"], 32.700, 35.303],
  ["Lod", ["לוד"], 31.951, 34.895],
  ["Ramla", ["רמלה"], 31.929, 34.866],
  ["Ra'anana", ["רעננה", "raanana"], 32.184, 34.871],
  ["Rosh HaAyin", ["ראש העין"], 32.096, 34.957],
  ["Hod HaSharon", ["הוד השרון"], 32.150, 34.888],
  ["Ramat HaSharon", ["רמת השרון"], 32.146, 34.839],
  ["Givatayim", ["גבעתיים"], 32.072, 34.811],
  ["Kiryat Gat", ["קריית גת", "קרית גת"], 31.610, 34.764],
  ["Kiryat Malakhi", ["קריית מלאכי", "קרית מלאכי"], 31.730, 34.745],
  ["Kiryat Ata", ["קריית אתא", "קרית אתא"], 32.809, 35.106],
  ["Kiryat Shmona", ["קריית שמונה", "קרית שמונה"], 33.207, 35.571],
  ["Nahariya", ["נהריה"], 33.006, 35.095],
  ["Akko", ["עכו", "acre"], 32.928, 35.076],
  ["Karmiel", ["כרמיאל"], 32.914, 35.296],
  ["Afula", ["עפולה"], 32.608, 35.289],
  ["Tiberias", ["טבריה"], 32.795, 35.531],
  ["Safed", ["צפת", "tzfat"], 32.965, 35.496],
  ["Yokneam", ["יקנעם"], 32.659, 35.110],
  ["Zichron Yaakov", ["זכרון יעקב"], 32.571, 34.952],
  ["Caesarea", ["קיסריה"], 32.519, 34.904],
  // English only for these two: אילת is also a first name, שדרות a boulevard.
  ["Eilat", [], 29.558, 34.952],
  ["Dimona", ["דימונה"], 31.069, 35.033],
  ["Arad", ["ערד"], 31.259, 35.213],
  ["Sderot", [], 31.525, 34.596],
  ["Netivot", ["נתיבות"], 31.421, 34.588],
  ["Ofakim", ["אופקים"], 31.314, 34.620],
  ["Yavne", ["יבנה"], 31.878, 34.739],
  ["Gedera", ["גדרה"], 31.813, 34.778],
  ["Ness Ziona", ["נס ציונה"], 31.930, 34.799],
  ["Or Yehuda", ["אור יהודה"], 32.029, 34.856],
  ["Yehud", ["יהוד"], 32.033, 34.890],
  ["Shoham", ["שוהם"], 31.999, 34.946],
  ["Ariel", ["אריאל"], 32.105, 35.170],
  ["Ma'ale Adumim", ["מעלה אדומים"], 31.777, 35.299],
  ["Even Yehuda", ["אבן יהודה"], 32.270, 34.888],
  ["Tel Mond", ["תל מונד"], 32.250, 34.917],
  ["Kfar Yona", ["כפר יונה"], 32.316, 34.935],
].map(([name, alt, lat, lng]) => ({ name, names: [name.toLowerCase(), ...alt], lat, lng }));

// A city named as whole words. Hebrew may carry a one-letter prefix
// ("באשקלון", "לאשקלון"); a longer name wins ("Ramat HaSharon" over a city
// it contains).
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const MATCH = CITIES.flatMap((c) => c.names.map((n) => ({ c, n,
  re: new RegExp(`(^|[^\\p{L}\\p{N}])${/[֐-׿]/.test(n) ? "[בלמהו]?" : ""}${esc(n).replace(/[ -]/g, "[\\s-]+")}($|[^\\p{L}\\p{N}])`, "iu") })))
  .sort((a, b) => b.n.length - a.n.length);
export function cityIn(text){
  const s = String(text || "");
  if (!s.trim()) return null;
  return MATCH.find((m) => m.re.test(s))?.c || null;
}
export const cityOf = (ev) => cityIn(ev?.location) || cityIn(ev?.title);
export const cityNamed = (name) => CITIES.find((c) => c.name === name) || null;

// One answer per series: a repeating event's every week is the same trip.
const norm = (s) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
export const tripKey = (ev) => (ev.series ? `s:${ev.series}` : `t:${norm(ev.title)}`);

// Kilometres between two { lat, lng }, straight line.
export function km(a, b){
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
const five = (m) => Math.max(5, Math.round(m / 5) * 5);

// Minutes each way by each mode from Home, or null with no Home saved.
export function estimate(city, home){
  if (!city || !home || !Number.isFinite(home.lat)) return null;
  const d = km(home, city);
  return Object.fromEntries(MODES.map((m) => [m, five((d * SPEED[m].wind / SPEED[m].kmh) * 60 + SPEED[m].plus)]));
}
export const isLocal = (city, home) => !!(city && home && Number.isFinite(home.lat) && km(home, city) < LOCAL_KM);

// The saved answer for a mode: { city, mode, min: { train, bus, car } }.
// minutes: what the user typed for the mode they picked, else the estimate.
export function answer(city, mode, { home = null, minutes = null } = {}){
  const est = estimate(city, home);
  const typed = Number(minutes) > 0 ? Math.round(Number(minutes)) : null;
  const base = typed ?? est?.[mode];
  if (!base) return null;
  const min = est ? { ...est } : Object.fromEntries(MODES.map((m) => [m, five(base * RATIO[m] / RATIO[mode])]));
  min[mode] = base;
  return { city: city.name, mode, min };
}
export const noTrip = (city) => ({ city: city?.name || null, mode: "none" });

const timed = (e) => !e.allDay && e.busy !== false && e.start && e.end && !e.trip && !e.taskId;
const dateOf = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

// The trips to ask about: events in the next `days` days naming a city that
// isn't near Home, whose series has no answer yet. One per series, soonest
// first. → [{ key, ev, city }]
export function tripAsks(events = [], trips = {}, { now = Date.now(), home = null, days = 7 } = {}){
  const seen = new Set(), out = [];
  const until = now + days * 864e5;
  for (const ev of [...events].filter(timed).sort((a, b) => Date.parse(a.start) - Date.parse(b.start))) {
    const s = Date.parse(ev.start);
    if (Date.parse(ev.end) <= now || s > until) continue;
    const key = tripKey(ev);
    if (seen.has(key) || trips?.[key]) continue;
    const city = cityOf(ev);
    if (!city || isLocal(city, home)) continue;
    seen.add(key);
    out.push({ key, ev, city });
  }
  return out;
}

const LEG = {
  train: { to: (c) => `Train to ${c}`, back: (c) => `Train back from ${c}` },
  bus: { to: (c) => `Bus to ${c}`, back: (c) => `Bus back from ${c}` },
  car: { to: (c) => `Drive to ${c}`, back: (c) => `Drive back from ${c}` },
};

// The mode and minutes for one event: the day's override, else the answer.
function tripFor(ev, trips, tripDay){
  const key = tripKey(ev), a = trips?.[key];
  if (!a || a.mode === "none" || !a.min) return null;
  const date = dateOf(Date.parse(ev.start));
  const day = (Array.isArray(tripDay) ? tripDay : []).find((d) => d.date === date && d.key === key)?.mode;
  const mode = day || a.mode;
  if (mode === "none" || !MODES.includes(mode)) return null;
  const minutes = a.min[mode] || five(a.min[a.mode] * RATIO[mode] / RATIO[a.mode]);
  return { key, mode, minutes, city: a.city };
}

// What a ride lets you do, as a place (weights.PLACE_BLOCKS).
export const ridePlace = (mode, laptop) => (mode === "train" && laptop !== true ? "bus" : mode);

// tripDay with one day's way of travelling set (newest 20 kept).
export const setTripDay = (tripDay, date, key, mode) =>
  [...(Array.isArray(tripDay) ? tripDay : []).filter((d) => !(d.date === date && d.key === key)), { date, key, mode }].slice(-20);

// The calendar with the travel legs added. Back-to-back events in the same
// city share one trip: there before the first, back after the last (a gap
// shorter than going home and back again doesn't send you home).
export function withTrips(events = [], trips = {}, tripDay = [], laptop = null){
  if (!trips || !Object.keys(trips).length) return events;
  const runs = [];
  for (const ev of events.filter(timed).sort((a, b) => Date.parse(a.start) - Date.parse(b.start))) {
    const t = tripFor(ev, trips, tripDay);
    if (!t) continue;
    const s = Date.parse(ev.start), e = Date.parse(ev.end), last = runs.at(-1);
    if (last && last.city === t.city && s - last.end < 2 * last.trip.minutes * MIN) {
      if (e > last.end) { last.end = e; last.lastEv = ev; last.back = t; }
      continue;
    }
    runs.push({ city: t.city, start: s, end: e, firstEv: ev, lastEv: ev, trip: t, back: t });
  }
  if (!runs.length) return events;
  const leg = (ev, t, dir, from, to) => ({
    id: `trip:${ev.id}:${dir}`, calendarId: "daisey-trip", title: LEG[t.mode][dir](t.city),
    start: new Date(from).toISOString(), end: new Date(to).toISOString(),
    busy: true, allDay: false, editable: false,
    trip: { key: t.key, mode: t.mode, place: ridePlace(t.mode, laptop), city: t.city, dir, minutes: t.minutes, of: ev.title },
  });
  const legs = runs.flatMap((r) => [
    leg(r.firstEv, r.trip, "to", r.start - r.trip.minutes * MIN, r.start),
    leg(r.lastEv, r.back, "back", r.end, r.end + r.back.minutes * MIN),
  ]);
  return [...events, ...legs];
}

// The run of back-to-back busy events starting with `first` (a trip there,
// the event, the trip back): when it ends, and the event at its heart.
export function chainFrom(first, events = []){
  const busy = events.filter((e) => !e.allDay && e.busy !== false && e.end)
    .map((e) => ({ e, s: Date.parse(e.start), end: Date.parse(e.end) })).sort((a, b) => a.s - b.s);
  let end = Date.parse(first.end);
  const parts = [first];
  for (const b of busy) {
    if (b.e === first || b.s < Date.parse(first.start)) continue;
    if (b.s > end + MIN) break;
    parts.push(b.e);
    end = Math.max(end, b.end);
  }
  return { start: Date.parse(first.start), end, main: parts.find((e) => !e.trip) || first, parts };
}
