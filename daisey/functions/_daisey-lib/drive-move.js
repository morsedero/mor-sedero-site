// Moving a job's own Drive FOLDER between the Job Hunt stage folders. This file
// is the Job Hunt connection's config: core knows only "an event and a folder
// id"; which stage a done/delete leads to lives in TRANSITIONS below. A user
// with their own pipeline changes FOLDERS and TRANSITIONS, nothing else.
//   Job Hunt/jobs/ holds one folder per stage; each job is a subfolder of one.
// Folders are matched by ID, never by name (a stage was renamed once already).
// A move only changes the job folder's parent. Nothing is ever deleted in Drive.
const ROOT = "15ARYM4_zMdpNK7At_L6tBSxe8Q_ut3JO"; // "jobs"
const FOLDERS = {
  to_review: "1RZplmNbCyxeLTArQ10bl1zhse0teajNh", // 1 to review
  ready_to_apply: "10JBoTbxmSykvjVtbCxS5qGaXKa9voiDb", // 2 ready to apply
  pending: "1nbP94U4nSWFVW2yXrXsPA0Jlcj4KL3Of", // 3 pending
  in_process: "1-vbR7puV7TgFgtlhT7RvtIKe6hLPEDh6", // 4 in process
  passed: "1uD-CheX4UIR8jb5XLcj5Q9ZXd0olliEg", // 5 passed
};
// stage → { done, deleted } = the stage the folder goes to. null = no move
// (done on an in-process job closes the task only; the folder stays).
const TRANSITIONS = {
  to_review: { done: "pending", deleted: "passed" },
  ready_to_apply: { done: "pending", deleted: "passed" },
  pending: { done: "in_process", deleted: "passed" },
  in_process: { done: null, deleted: "passed" },
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

const fileUrl = (id) => {
  const u = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}`);
  u.searchParams.set("fields", "id,parents");
  return u;
};

// The job's folder id: the one given, else the folder holding a file of the
// job (its CV). Never a stage folder or the jobs folder itself.
async function jobFolderId(accessToken, { folderId, fileId }, fetchFn) {
  let id = folderId;
  if (!id) {
    const { parents = [] } = await driveCall(fileUrl(fileId), accessToken, fetchFn);
    if (parents.length !== 1) throw Object.assign(new Error("file has no single folder"), { bad: true });
    id = parents[0];
  }
  if (id === ROOT || Object.values(FOLDERS).includes(id)) throw Object.assign(new Error("not a job folder"), { bad: true });
  return id;
}

// → { folderId, parents, moved } as Drive now has it.
//   from: the stage the job was in when Mor acted. A folder already in the
//   destination is left alone (a retry after a half-finished move is safe);
//   one that is somewhere else is a conflict, not moved.
async function moveJobFolder(accessToken, job, fetchFn = fetch) {
  const { event, from } = job;
  const step = TRANSITIONS[from];
  if (!step || !Object.hasOwn(step, event)) throw Object.assign(new Error("no move for event"), { bad: true });
  const id = await jobFolderId(accessToken, job, fetchFn);
  const { parents = [] } = await driveCall(fileUrl(id), accessToken, fetchFn);

  const dest = step[event];
  if (dest === null) return { folderId: id, parents, moved: false }; // closed: the folder stays
  const to = FOLDERS[dest];
  if (parents.length === 1 && parents[0] === to) return { folderId: id, parents, moved: false };
  if (!parents.includes(FOLDERS[from])) throw Object.assign(new Error("job is not in the stage it was acted on from"), { conflict: true });

  const patch = fileUrl(id);
  patch.searchParams.set("addParents", to);
  patch.searchParams.set("removeParents", FOLDERS[from]);
  await driveCall(patch, accessToken, fetchFn, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: "{}" });
  return { folderId: id, parents: [to, ...parents.filter((p) => p !== FOLDERS[from])], moved: true };
}

module.exports = { moveJobFolder, FOLDERS, TRANSITIONS, ROOT };
