// Moves a job's Drive folder to the stage folder for what happened to its task
// (the stage → folder config is _daisey-lib/drive-move.js). With "Authorization: Bearer <Firebase ID token>".
//   POST { folderId | fileId, event: "done" | "deleted", from: <stage key> }
//     → { folderId, parents, moved }; 400 bad_updates on a bad id, event or stage,
//     409 wrong_stage when the folder is not in the stage it was acted on from.
// The auth and the other error codes are drive-handler.js's.
const { driveHandler } = require("./_daisey-lib/drive-handler");
const { moveJobFolder } = require("./_daisey-lib/drive-move");

const idOk = (v) => typeof v === "string" && /^[\w-]{10,}$/.test(v);

exports.handler = (event) => driveHandler(event, async (accessToken, body) => {
  const hasFolder = idOk(body.folderId), hasFile = idOk(body.fileId);
  if (!hasFolder && !hasFile) throw Object.assign(new Error("bad move"), { bad: true });
  return moveJobFolder(accessToken, { folderId: hasFolder ? body.folderId : "", fileId: hasFile ? body.fileId : "", event: body.event, from: body.from });
}, "daisey-now-drive-move", ["POST"]);
