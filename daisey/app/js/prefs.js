// Per-device choice that expires after the spec's 3 hours: the energy
// correction. localStorage only for now (session 9 moves the energy
// correction to Firestore so it follows you across devices). Everything
// works the same if storage is blocked.
import { currentEnergy, CORRECTION_HOLD } from "./energy.js";

const ENERGY_KEY = "daisey.energy.v1";

function load(key){
  try {
    const v = JSON.parse(localStorage.getItem(key) || "null");
    if (v && Date.now() - v.at < CORRECTION_HOLD) return v;
  } catch {}
  return null;
}
const save = (key, v) => { try { localStorage.setItem(key, JSON.stringify({ ...v, at: Date.now() })); } catch {} };

export const getEnergy = () => currentEnergy({ correction: load(ENERGY_KEY) });
export const setEnergy = (level) => save(ENERGY_KEY, { level });
