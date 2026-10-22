// Moves a job's CV file in Drive to the folder for its stage (daisey-now-drive-move;
// folders in functions/_daisey-lib/drive-move.js). Stages: "ready" = review done
// (Approve), "applied" = ready done (Applied), "deleted" = the task was deleted.
// → true when Drive confirmed the move, false when it didn't. Never throws.
import { idToken } from "./firebase.js";

const MOVE_URL = "/.netlify/functions/daisey-now-drive-move";

export async function moveCvFile(fileId, event){
  try {
    const res = await fetch(MOVE_URL, { method: "POST", headers: { Authorization: `Bearer ${await idToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ fileId, event }) });
    if (!res.ok) throw new Error(`move ${res.status}`);
    return true;
  } catch (e) { console.error("[daisey] jobs move", e); return false; }
}
