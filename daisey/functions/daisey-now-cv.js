// A Job Hunt CV as HTML, for Daisey's "View CV": GET ?id=<Drive file id> with
// "Authorization: Bearer <Firebase ID token>". Read only.
//   { html: "<!doctype html>…" }
// The browser opens it as a page of its own (a blob), so the HTML is returned
// inside JSON and never served from this origin. The auth and the error codes
// are drive-handler.js's, plus 400 bad_id and 404 no_file.
const { driveHandler, fail } = require("./_daisey-lib/drive-handler");
const { readCv } = require("./_daisey-lib/jobs-drive");

exports.handler = (event) => {
  const id = event.queryStringParameters?.id || "";
  if (!/^[\w-]{10,}$/.test(id)) return fail(400, "bad_id");
  return driveHandler(event, async (accessToken) => ({ html: await readCv(accessToken, id) }), "daisey-now-cv");
};
