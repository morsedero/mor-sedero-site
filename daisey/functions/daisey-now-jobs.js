// Daisey v1's Job Hunt read: the cards in jobs.json in the Job Hunt Drive
// folder. GET with "Authorization: Bearer <Firebase ID token>". Read only —
// Daisey never writes to Drive.
//   { cards: [...], modified: ISO | null }
// The auth and the error codes are drive-handler.js's.
const { driveHandler } = require("./_daisey-lib/drive-handler");
const { readJobs } = require("./_daisey-lib/jobs-drive");

exports.handler = (event) => driveHandler(event, (accessToken) => readJobs(accessToken), "daisey-now-jobs");
