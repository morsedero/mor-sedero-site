// Current energy: your correction if made in the last 3 hours, else a guess.
// PURE. Session 3/4 version: the guess is Medium (the spec's starting point
// before there's data). Session 9 adds the other signals — a long or
// draining event just ended, and your pattern for this time bucket.
export const CORRECTION_HOLD = 3 * 3600000;

// correction: { level, at } or null. Returns { level, guessed }.
export function currentEnergy({ now = Date.now(), correction = null } = {}){
  if (correction && ["low", "medium", "high"].includes(correction.level) && now - correction.at < CORRECTION_HOLD) {
    return { level: correction.level, guessed: false };
  }
  return { level: "medium", guessed: true };
}
