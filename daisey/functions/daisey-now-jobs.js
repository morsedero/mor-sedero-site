// Daisey v1's Job Hunt: the cards in jobs.json in the Job Hunt Drive folder
// (read only — jobs.json is Claude's), and Daisey's own daisey-status.json
// beside it. With "Authorization: Bearer <Firebase ID token>".
//   GET [?file=<status file id>]
//     → { cards, modified: ISO | null, statusFileId: id | null, status: {id: {status, at, note?}} | null }
//     status is null when the status file couldn't be read: the cards still come.
//   POST { fileId?, updates: { <job id>: { status, at, note? } } }
//     → { fileId, status: {...every job in the file} }; 400 bad_updates on none valid.
// The auth and the error codes are drive-handler.js's.
const { driveHandler, fail } = require("./_daisey-lib/drive-handler");
const { readJobs, readStatus, writeStatus } = require("./_daisey-lib/jobs-drive");

const idOk = (v) => typeof v === "string" && /^[\w-]{10,}$/.test(v);

exports.handler = (event) => {
  if (event.httpMethod === "POST") {
    return driveHandler(event, async (accessToken, body) => {
      const out = await writeStatus(accessToken, idOk(body.fileId) ? body.fileId : "", body.updates);
      return { fileId: out.fileId, status: out.jobs };
    }, "daisey-now-jobs", ["POST"]);
  }
  const file = event.queryStringParameters?.file;
  return driveHandler(event, async (accessToken) => {
    const jobs = await readJobs(accessToken);
    const st = await readStatus(accessToken, idOk(file) ? file : "").catch((e) => {
      if (e.reauth) throw e; // the token, not the file: the shell refreshes it and runs this again
      console.error("daisey-now-jobs status", e.message);
      return null;
    });
    return { ...jobs, statusFileId: st?.fileId || null, status: st ? st.jobs : null };
  }, "daisey-now-jobs");
};
