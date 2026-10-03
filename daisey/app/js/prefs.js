// Per-device choices that expire after the spec's 3 hours: free time and the
// energy correction. localStorage only for now (session 9 moves the energy
// correction to Firestore so it follows you across devices). Everything
// works the same if storage is blocked.
import { currentEnergy, CORRECTION_HOLD } from "./energy.js";

const WINDOW_KEY = "daisey.window.v1";
const ENERGY_KEY = "daisey.energy.v1";

function load(key){
  try {
    const v = JSON.parse(localStorage.getItem(key) || "null");
    if (v && Date.now() - v.at < CORRECTION_HOLD) return v;
  } catch {}
  return null;
}
const save = (key, v) => { try { localStorage.setItem(key, JSON.stringify({ ...v, at: Date.now() })); } catch {} };

export const getWindow = () => load(WINDOW_KEY)?.window ?? 60;
export const setWindow = (window) => save(WINDOW_KEY, { window });
export const getEnergy = () => currentEnergy({ correction: load(ENERGY_KEY) });
export const setEnergy = (level) => save(ENERGY_KEY, { level });
