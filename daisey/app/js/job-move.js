// The Job Hunt connection's Drive move: a job's folder goes to the next stage
// folder (daisey-now-drive-move; the stage → folder config is in
// functions/_daisey-lib/drive-move.js, not in core). Core only emits task.done /
// task.deleted (task-events.js); jobs-sync.js turns those into calls here.
//   job: { folderId, fileId } — the folder's id, else a file inside it (the CV)
//   event: "done" | "deleted"; from: the stage the job was in (jobs.js STAGE_OF)
// → true when Drive confirmed (or the folder was already there), false when it
// didn't. Never throws.
import { idToken } from "./firebase.js";

const MOVE_URL = "/.netlify/functions/daisey-now-drive-move";

export async function moveJobFolder(job, event, from){
  try {
    const res = await fetch(MOVE_URL, { method: "POST", headers: { Authorization: `Bearer ${await idToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ folderId: job.folderId || "", fileId: job.fileId || "", event, from }) });
    if (!res.ok) throw new Error(`move ${res.status}`);
    return true;
  } catch (e) { console.error("[daisey] jobs move", e); return false; }
}
