// Where you are, from the phone's location (Mor, 2026-10-05: the place chip
// went; Daisey works it out). Read when the app opens and again when it
// comes back after REDETECT_MS — a web page gets no background location.
// Fixes over ~10s give a speed, same rules as the old Daisey's placeClassify
// (2026-10-05): under ~10 km/h is walking, faster is a ride. Speed can't
// tell a train from a bus from a car, so a ride asks once (now.js rideAsk)
// and keeps the answer for RIDE_MS. Standing still near the saved home →
// Home; still and away from it → Out. Still with no home saved, or no
// location at all (denied, unsupported) → null, and the calendar's guess
// stands (context.js placeNow).
// Places: home · out · walk · ride (not answered yet) · train · bus · car.
// Per-device localStorage only, never Firestore: home's coordinates don't
// belong in the cloud. Home is set from the account menu ("Home is here").
const KEY = "daisey.where.v1";
const NEAR_M = 150;          // within this of home (or the fix's accuracy, if worse) = home
const STILL_MPS = 0.7;       // under this you're standing still
const WALK_MPS = 2.8;        // under this (~10 km/h) you're walking; over it, riding
const RIDE_MS = 2 * 3600000; // a train / bus / car answer holds for the rest of the ride
export const RIDES = ["train", "bus", "car"];
const WINDOW_MS = 10000;     // how long to collect fixes for a speed
const REDETECT_MS = 5 * 60000;

const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
const save = (d) => { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* per-tab only */ } };

// Metres between two { lat, lng }.
function dist(a, b){
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

// The fixes → a place (above) or null. Exported for the tests.
export function placeFrom(fixes, home, ride = null, now = Date.now()){
  if (!fixes.length) return null;
  const last = fixes.at(-1), first = fixes[0];
  const speeds = fixes.map((f) => f.speed).filter((v) => v != null && !Number.isNaN(v)).sort((a, b) => a - b);
  let v = speeds.length ? speeds[Math.floor(speeds.length / 2)] : null;
  if (v == null && last.t > first.t) {
    const d = dist(first, last);
    // A move smaller than the fixes' own error is noise, not travel.
    v = d > Math.max(first.acc, last.acc) ? d / ((last.t - first.t) / 1000) : 0;
  }
  v ??= 0;
  if (v >= WALK_MPS) return ride && now - ride.at < RIDE_MS ? ride.mode : "ride";
  if (v >= STILL_MPS) return "walk";
  if (!home) return null;
  return dist(last, home) <= Math.max(NEAR_M, last.acc || 0) ? "home" : "out";
}

let current = null, lastRun = 0, running = null;
const listeners = new Set();
const tell = (v) => { if (v !== current) { current = v; listeners.forEach((f) => f(v)); } };

// Collects fixes for WINDOW_MS (or until one reports its own speed).
function fixes(){
  const geo = navigator.geolocation;
  if (!geo) return Promise.resolve([]);
  return new Promise((resolve) => {
    const got = [];
    const done = () => { geo.clearWatch(id); clearTimeout(timer); resolve(got); };
    const id = geo.watchPosition((p) => {
      const c = p.coords;
      got.push({ lat: c.latitude, lng: c.longitude, acc: c.accuracy || 0, speed: c.speed ?? null, t: p.timestamp || Date.now() });
      if (c.speed != null && !Number.isNaN(c.speed) && got.length >= 2) done();
    }, () => done(), { enableHighAccuracy: true, maximumAge: 30000, timeout: WINDOW_MS });
    const timer = setTimeout(done, WINDOW_MS);
  });
}

async function detect(){
  if (running) return running;
  lastRun = Date.now();
  running = fixes().then((fs) => {
    if (fs.length) save({ ...load(), last: fs.at(-1) });
    tell(placeFrom(fs, load().home, load().ride));
  }).finally(() => { running = null; });
  return running;
}

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

// The answer to "train, bus or driving?" (or "I'm a passenger" = bus).
export function setRide(mode){
  if (!RIDES.includes(mode)) return;
  save({ ...load(), ride: { mode, at: Date.now() } });
  tell(mode);
}

// "Home is here": saves the latest fix (a fresh one if there's none from the
// last minute) as home. Resolves true when saved, false with no location.
export async function setHomeHere(){
  let fix = load().last;
  if (!fix || Date.now() - fix.t > 60000) { await detect(); fix = load().last; }
  if (!fix) return false;
  save({ ...load(), home: { lat: fix.lat, lng: fix.lng } });
  tell("home");
  return true;
}

export const hasHome = () => !!load().home;
