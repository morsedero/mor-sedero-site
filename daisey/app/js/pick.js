// A pick the user made (Switch, "Put … on the card instead"), as rules apart
// from the Now card's screen (now.js), so they can be tested. PURE.

// What the moment filters out that is still the user's to pick: too long for
// the gap, its block, another place, office hours, not evening yet, its own
// slot later. Put off today (skipped) and the quiet ones stay out.
export const SWITCH_TOO = new Set(["size", "block", "place", "office", "evening", "booked"]);
// Out for good right now: another place, the office shut, not evening yet.
// A card holding a task that turns one of these lets go of it rather than
// waiting for a refresh.
export const CANT_NOW = new Set(["place", "office", "evening"]);

// Why `id` is out of the engine's picks right now, if it's one Switch may
// still offer; null when it isn't out (or can't be offered).
export const outReason = (out = [], id) => out.find((o) => o.task.id === id && SWITCH_TOO.has(o.reason))?.reason ?? null;

// A pick holds until acted on, but not once it can't be done after it was
// picked (moved, or set to another place: Mor, 2026-10-12). One picked
// knowingly while it already couldn't (another place, office shut) stays.
// state: { chosen, chosenOut: { id, why } | null }, why: outReason now.
// → the next { chosen, chosenOut }.
export function holdPick({ chosen, chosenOut }, why){
  if (!chosen) return { chosen, chosenOut };
  if (chosenOut?.id !== chosen || !CANT_NOW.has(why)) return { chosen, chosenOut: { id: chosen, why } };
  return why === chosenOut.why ? { chosen, chosenOut } : { chosen: null, chosenOut };
}

// A tap is a fresh, knowing pick (2026-10-18): what was remembered about an
// earlier pick of the same task is dropped, or a task picked once when it
// could be done, and offered again once it couldn't, was let go the moment it
// was tapped ("Put … on the card instead" did nothing).
export const freshPick = (id) => ({ chosen: id, chosenOut: null });

// The task a pick puts on the card: ranked by the engine, or out for a
// reason Switch may offer. null when it can't go there, so it isn't offered.
// r: the engine's { ranked, out }.
export function pickedCard(r, id){
  const s = (r?.ranked || []).find((x) => x.task.id === id);
  if (s) return s;
  const o = (r?.out || []).find((x) => x.task.id === id && SWITCH_TOO.has(x.reason));
  return o ? { task: o.task, whyParts: ["your pick"] } : null;
}

// What "Show me anyway" offers: only tasks a tap really puts on the card.
export const offerable = (r) => (r?.out || []).filter((o) => SWITCH_TOO.has(o.reason) && o.task?.status === "ready"
  && holdPick(freshPick(o.task.id), o.reason).chosen === o.task.id && pickedCard(r, o.task.id)).map((o) => ({ task: o.task }));
