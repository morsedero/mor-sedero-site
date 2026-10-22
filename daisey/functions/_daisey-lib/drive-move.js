// Moving a job's own Drive file (its CV copy) between the Job Hunt status
// folders. The destinations are a connection config, not core logic: the
// core knows only "an event, a file id, a folder to put it in". A user who
// plugs in their own folders changes MOVES, nothing else.
//   ready   → review done (Approve)        → "2 ready to apply"
//   applied → ready done (Applied)         → "3 applied"
//   deleted → the job's task was deleted   → "1 to review"
// Nothing is ever deleted from Drive: a move only changes the parent.
const MOVES = {
  ready: { to: "10JBoTbxmSykvjVtbCxS5qGaXKa9voiDb" }, // 2 ready to apply
  applied: { to: "1nbP94U4nSWFVW2yXrXsPA0Jlcj4KL3Of" }, // 3 applied
  deleted: { to: "1RZplmNbCyxeLTArQ10bl1zhse0teajNh" }, // 1 to review
};

// Same error shape as jobs-drive.js's driveGet: { reauth } · { scope } · { notFound } · other Errors.
async function driveCall(url, accessToken, fetchFn, init = {}) {
  const res = await fetchFn(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${accessToken}` } });
  if (res.ok) return res.json();
  if (res.status === 401) throw Object.assign(new Error("drive 401"), { reauth: true });
  if (res.status === 404) throw Object.assign(new Error("drive 404"), { notFound: true });
  const body = await res.json().catch(() => ({}));
  const reasons = (body.error?.errors || []).map((e) => e.reason);
  const noScope = reasons.some((r) => r === "insufficientPermissions" || r === "ACCESS_TOKEN_SCOPE_INSUFFICIENT") || /insufficient/i.test(body.error?.message || "");
  if (res.status === 403 && noScope) throw Object.assign(new Error("drive scope"), { scope: true });
  throw Object.assign(new Error(`drive ${res.status}: ${body.error?.message || ""}`), { status: res.status });
}

// → { fileId, parents } as Drive now has it. A file already in the destination
// (and nowhere else) is left alone, so a retry after a half-finished move is safe.
async function moveFile(accessToken, fileId, event, fetchFn = fetch) {
  const move = MOVES[event];
  if (!move) throw Object.assign(new Error("no move for event"), { bad: true });
  const file = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`);
  file.searchParams.set("fields", "id,parents");
  const { parents = [] } = await driveCall(file, accessToken, fetchFn);
  if (parents.length === 1 && parents[0] === move.to) return { fileId, parents };

  const patch = new URL(file);
  patch.searchParams.set("addParents", move.to);
  if (parents.length) patch.searchParams.set("removeParents", parents.join(","));
  const out = await driveCall(patch, accessToken, fetchFn, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: "{}" });
  return { fileId: out.id || fileId, parents: [move.to] };
}

module.exports = { moveFile, MOVES };
