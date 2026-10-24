// Daisey v1's Job Hunt: the cards in jobs.json in the Job Hunt Drive folder.
// Claude owns their content; Daisey writes back only a job's stage (and moves
// its folder). With "Authorization: Bearer <Firebase ID token>".
//   GET  → { cards, modified: ISO | null, fileId }
//   POST { updates: { <job id>: { event: "done" | "deleted", from: <stage>, at: ISO } } }
//     → { results: { <job id>: "ok" | "failed" | "conflict" | "gone" | "bad" }, cards, modified, fileId }
//     (jobs-drive.js writeStages); 400 bad_updates on none.
// The auth and the error codes are drive-handler.js's.
const { driveHandler } = require("./_daisey-lib/drive-handler");
const { readJobs, writeStages } = require("./_daisey-lib/jobs-drive");

exports.handler = (event) => {
  if (event.httpMethod === "POST") {
    return driveHandler(event, (accessToken, body) => writeStages(accessToken, body.updates), "daisey-now-jobs", ["POST"]);
  }
  return driveHandler(event, (accessToken) => readJobs(accessToken), "daisey-now-jobs");
};
