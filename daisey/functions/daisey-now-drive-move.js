// Moves a job's CV file to the folder for what happened to its task (see
// _daisey-lib/drive-move.js for the folders). With "Authorization: Bearer <Firebase ID token>".
//   POST { fileId, event: "done" | "deleted" }
//     → { fileId, parents: [folder id] }; 400 bad_updates on a bad id or event.
// The auth and the error codes are drive-handler.js's.
const { driveHandler } = require("./_daisey-lib/drive-handler");
const { moveFile, MOVES } = require("./_daisey-lib/drive-move");

const idOk = (v) => typeof v === "string" && /^[\w-]{10,}$/.test(v);

exports.handler = (event) => driveHandler(event, async (accessToken, body) => {
  if (!idOk(body.fileId) || !Object.hasOwn(MOVES, body.event)) throw Object.assign(new Error("bad move"), { bad: true });
  return moveFile(accessToken, body.fileId, body.event);
}, "daisey-now-drive-move", ["POST"]);
