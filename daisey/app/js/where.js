// Where you are, from the phone's location (Mor, 2026-10-05: the place chip
// went; Daisey works it out). Ported from the old Daisey's where-you-are
// (placeClassify / placeSheet), which had landed there by mistake.
// Read when the app opens, then every REDETECT_MS while it's on screen — a
// web page gets no background location.
// Fixes over ~10s give a speed: under ~10 km/h is walking, faster is a
// ride. Speed can't tell a train from a bus from a car, so a ride asks once
// (now.js rideAsk) and keeps the answer for RIDE_MS. Standing still near a
// saved place → that place (Home → "home", any other → "spot:<name>");
// still and away from all of them → Out. Still with no Home saved and no
// place near, or no location at all (denied, unsupported) → null, and the
// calendar's guess stands (context.js placeNow).
// Picked by hand on Now (placeFix, rideAsk): that holds MANUAL_MS,
// over whatever the location says.
// Places: home · out · walk · ride (not answered yet) · train · bus · car ·
// spot:<name>.
// Per-device localStorage only, never Firestore: home's coordinates don't
// belong in the cloud.
const KEY = "daisey.where.v1";
const NEAR_M = 150;          // within this of a place (or the fix's accuracy, if worse, up to 400) = there
const STILL_MPS = 0.7;       // under this you're standing still
const WALK_MPS = 2.8;        // under this (~10 km/h) you're walking; over it, riding
const RIDE_MS = 2 * 3600000; // a train / bus / car answer holds for the rest of the ride
const MANUAL_MS = 45 * 60000; // a hand-picked place outranks the location this long
export const RIDES = ["train", "bus", "car"];
const WINDOW_MS = 10000;     // how long to collect fixes for a speed
const REDETECT_MS = 5 * 60000;
// Fixes vaguer than this don't count toward a speed. Opening the app, the
// first fix is often a Wi-Fi guess tens of metres off, and the jump to the
// GPS fix a second later read as a ride (Mor, 2026-10-06: sitting at home,
// Daisey asked "On a train, bus or driving?" and held back every home task).
const SPEED_ACC_M = 50;
const SPEED_SPAN_MS = 5000;  // a distance over less time than this is noise

// { places: [{ name, lat, lng }], last: fix, ride: { mode, at }, manual: { value, at } }.
// The first version kept one `home`; it becomes the place called Home.
function load(){
  let d = {};
  try { d = JSON.parse(localStorage.getItem(KEY)) || {}; } catch { /* nothing saved */ }
  if (d.home && !d.places) { d.places = [{ name: "Home", ...d.home }]; delete d.home; }
  d.places ||= [];
  return d;
}
const save = (d) => { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* per-tab only */ } };
const isHome = (name) => name.trim().toLowerCase() === "home";
const placeOf = (p) => (isHome(p.name) ? "home" : `spot:${p.name}`);

// Metres between two { lat, lng }.
function dist(a, b){
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

// The fixes → a place (above) or null. Exported for the tests.
export function placeFrom(fixes, places = [], ride = null, now = Date.now()){
  if (!fixes.length) return null;
  const last = fixes.at(-1);
  const good = fixes.filter((f) => (f.acc || 0) <= SPEED_ACC_M);
  // The lower median: one fast reading among slow ones isn't a ride.
  const speeds = good.map((f) => f.speed).filter((v) => v != null && !Number.isNaN(v)).sort((a, b) => a - b);
  let v = speeds.length ? speeds[Math.floor((speeds.length - 1) / 2)] : null;
  const [a, b] = [good[0], good.at(-1)];
  if (v == null && good.length >= 2 && b.t - a.t >= SPEED_SPAN_MS) {
    // Only the part of the move the two fixes' errors can't explain is travel.
    v = Math.max(0, dist(a, b) - (a.acc || 0) - (b.acc || 0)) / ((b.t - a.t) / 1000);
  }
  v ??= 0;
  if (v >= WALK_MPS) return ride && now - ride.at < RIDE_MS ? ride.mode : "ride";
  // A place saved from a vague fix gets that much more reach (acc, kept since
  // 2026-10-06; older saves have none).
  const reach = (p) => Math.max(NEAR_M, Math.min(last.acc || 0, 400), Math.min(p.acc || 0, 400));
  const near = places.map((p) => ({ p, d: dist(last, p) })).filter((x) => x.d <= reach(x.p)).sort((a, b) => a.d - b.d)[0];
  // Walking speed inside a saved place is pacing around the house (or GPS
  // drift indoors), not a walk (Mor, 2026-10-08). It turns into "walk" only
  // once you're out past the place's reach.
  if (v >= STILL_MPS && !near) return "walk";
  if (near) return placeOf(near.p);
  return places.some((p) => isHome(p.name)) ? "out" : null;
}

let current = null, lastRun = 0, running = null;
const listeners = new Set();
const tell = (v) => { if (v !== current) { current = v; listeners.forEach((f) => f(v)); } };
const manualNow = (d = load()) => (d.manual && Date.now() - d.manual.at < MANUAL_MS ? d.manual.value : null);

// Collects fixes for WINDOW_MS (or until three report their own speed).
function fixes(){
  const geo = navigator.geolocation;
  if (!geo) return Promise.resolve([]);
  return new Promise((resolve) => {
    const got = [];
    const done = () => { geo.clearWatch(id); clearTimeout(timer); resolve(got); };
    const id = geo.watchPosition((p) => {
      const c = p.coords;
      got.push({ lat: c.latitude, lng: c.longitude, acc: c.accuracy || 0, speed: c.speed ?? null, t: p.timestamp || Date.now() });
      if (got.filter((f) => f.speed != null && !Number.isNaN(f.speed)).length >= 3) done();
    }, () => done(), { enableHighAccuracy: true, maximumAge: 30000, timeout: WINDOW_MS });
    const timer = setTimeout(done, WINDOW_MS);
  });
}

// Unnamed spots you stand still at (Mor, 2026-10-07: nobody names places in
// Settings, so Daisey asks). d.seen: [{ lat, lng, days: [YYYY-MM-DD…],
// since, at, notHome, quiet }], one per spot within NEAR_M. placeAsk reads it.
const SEEN_MAX = 20, SEEN_ACC_M = 100, DWELL_MS = 30 * 60000;
const today = () => new Date().toLocaleDateString("sv");
const seenAt = (d, fix) => (d.seen || []).find((s) => dist(fix, s) <= NEAR_M);
function noteVisit(d, fix){
  if ((fix.acc || 0) > SEEN_ACC_M) return d;
  const seen = (d.seen ||= []), day = today();
  let s = seenAt(d, fix);
  if (!s) { s = { lat: fix.lat, lng: fix.lng, days: [], since: fix.t }; seen.push(s); }
  if (s.days.at(-1) !== day) { s.days = s.days.concat(day).slice(-7); s.since = fix.t; }
  s.at = fix.t;
  d.seen = seen.sort((a, b) => b.at - a.at).slice(0, SEEN_MAX);
  return d;
}

async function detect(){
  if (running) return running;
  lastRun = Date.now();
  const manual = manualNow();
  if (manual) { tell(manual); return; }
  running = fixes().then((fs) => {
    let d = load();
    if (fs.length) d.last = fs.at(-1);
    const v = placeFrom(fs, d.places, d.ride);
    if (fs.length && (v === "out" || v === null)) d = noteVisit(d, d.last);
    save(d);
    tell(manualNow(d) || v);
  }).finally(() => { running = null; });
  return running;
}

// What to ask about where you are, if anything: "home" (no Home saved yet:
// is this it?), "name" (Home known, or this isn't it, and you keep coming
// back: a 2nd day here, or 30+ min today), or null. Only when the location
// is fresh, you're still, and nothing's picked by hand.
export function placeAsk(){
  const d = load();
  if (manualNow(d) || !d.last || Date.now() - d.last.t > 10 * 60000 || !(current === "out" || current === null)) return null;
  const s = seenAt(d, d.last);
  if (!s || s.quiet) return null;
  if (!d.places.some((p) => isHome(p.name)) && !s.notHome) return "home";
  return s.days.length >= 2 || s.at - s.since >= DWELL_MS ? "name" : null;
}

// Answers to placeAsk. "Not home": this spot is never asked as Home again.
// "Not now": this spot is never asked about again.
function markHere(patch){
  const d = load(), s = d.last && seenAt(d, d.last);
  if (!s) return;
  Object.assign(s, patch);
  save(d);
  listeners.forEach((f) => f(current)); // same place, but the question changed
}
export const notHomeHere = () => markHere({ notHome: true });
export const quietHere = () => markHere({ quiet: true });

// onChange(place) on every change; returns stop(). Reads now, then every
// REDETECT_MS while the app is on screen, and when it comes back.
export function watchWhere(onChange){
  listeners.add(onChange);
  if (current != null) onChange(current);
  if (!lastRun) detect();
  const again = () => { if (!document.hidden && Date.now() - lastRun > REDETECT_MS) detect(); };
  const timer = setInterval(again, 60000);
  document.addEventListener("visibilitychange", again);
  return () => { listeners.delete(onChange); clearInterval(timer); document.removeEventListener("visibilitychange", again); };
}

// A saved place can't wear a mode's name ("Out", "Train"…): it would read as one.
const RESERVED = new Set(["out", "walking", "walk", "train", "bus", "car", "driving", "ride", "travelling", "not sure", "anywhere"]);
export const reservedName = (n) => RESERVED.has(String(n).trim().toLowerCase());

export const whereNow = () => current;

// The one device question waiting, if any: "ride" (a ride the phone can't
// name), "home", "name", or null. Needs you holds it (Mor, 2026-10-07: the
// questions are a notification, not a strip above the card).
export const whereAsk = () => (current === "ride" ? "ride" : placeAsk());

// The answer to "train, bus or driving?" (or "I'm a passenger" = bus).
export function setRide(mode){
  if (!RIDES.includes(mode)) return;
  save({ ...load(), ride: { mode, at: Date.now() } });
  tell(mode);
}

// "Not moving", from the ride question: wherever the last fix is when still
// (Home, a saved spot, Out), for MANUAL_MS. With nothing known, "anywhere",
// and the calendar's guess stands (context.js placeNow).
export function setStill(){
  const d = load();
  setManual((d.last && placeFrom([{ ...d.last, speed: 0 }], d.places)) || "anywhere");
}

// A place picked by hand, for MANUAL_MS; null goes back to the location.
export function setManual(value){
  const d = load();
  if (value) {
    save({ ...d, manual: { value, at: Date.now() }, ...(RIDES.includes(value) ? { ride: { mode: value, at: Date.now() } } : {}) });
    tell(value);
  } else {
    delete d.manual;
    save(d);
    lastRun = 0;
    detect();
  }
}

// Saves where you are now under `name` (Home, Studio, …), replacing a place
// of the same name; a fresh fix if there's none from the last minute.
// Resolves true when saved, false with no location.
export async function saveSpot(name){
  name = String(name || "").trim();
  if (!name) return false;
  let fix = load().last;
  if (!fix || Date.now() - fix.t > 60000) { await fixes().then((fs) => fs.length && save({ ...load(), last: fs.at(-1) })); fix = load().last; }
  if (!fix || Date.now() - fix.t > 60000) return false;
  const d = load();
  const places = d.places.filter((p) => p.name.toLowerCase() !== name.toLowerCase()).concat({ name, lat: fix.lat, lng: fix.lng, acc: fix.acc || 0 });
  const seen = (d.seen || []).filter((s) => dist(fix, s) > NEAR_M); // named now: stop asking about it
  save({ ...d, places, seen });
  tell(placeOf({ name }));
  return true;
}
