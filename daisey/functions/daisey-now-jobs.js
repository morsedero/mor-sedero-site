// Daisey v1's Job Hunt: the cards in jobs.json in the Job Hunt Drive folder.
// Claude owns their content; Daisey writes back only a job's stage (and moves
// its folder). With "Authorization: Bearer <Firebase ID token>".
//   GET  → { cards, modified: ISO | null, fileId, canWrite: false when the grant lacks full drive }
//   POST { updates: { <job id>: { event: "done" | "deleted", from: <stage>, at: ISO } } }
//     → { results: { <job id>: "ok" | "failed" | "conflict" | "stale" | "gone" | "bad" }, cards, modified, fileId }
//     (jobs-drive.js writeStages); 400 bad_updates on none.
// The auth and the error codes are drive-handler.js's.
const { driveHandler } = require("./_daisey-lib/drive-handler");
const { readJobs, writeStages } = require("./_daisey-lib/jobs-drive");

exports.handler = (event) => {
  if (event.httpMethod === "POST") {
    return driveHandler(event, (accessToken, body) => writeStages(accessToken, body.updates), "daisey-now-jobs", ["POST"]);
  }
  return driveHandler(event, async (accessToken) => ({ ...(await readJobs(accessToken)), canWrite: await fullDrive(accessToken) }), "daisey-now-jobs");
};

// Reads work on drive.readonly, so a grant from before the full drive scope
// (2026-10-22) reads fine and only fails on a stage move. canWrite: false
// lets the app offer Reconnect up front. tokeninfo failing → true (no nag).
const DRIVE = "https://www.googleapis.com/auth/drive";
async function fullDrive(accessToken){
  try {
    const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`);
    if (!res.ok) return true;
    return String((await res.json()).scope || "").split(" ").includes(DRIVE);
  } catch { return true; }
}
