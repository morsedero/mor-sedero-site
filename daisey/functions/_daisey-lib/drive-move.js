// The Job Hunt connection's config, and the folder move it drives. Core knows
// only "a task was done / deleted"; what that means for a job lives here: the
// stage it goes to (TRANSITIONS) and the Drive folder each stage is (FOLDERS).
// A user with their own pipeline changes these two tables, nothing else.
// app/js/jobs.js holds a copy of TRANSITIONS for the instant on-screen change;
// jobs.test.mjs fails if the two drift.
//   Job Hunt/jobs/ holds one folder per stage; each job is a subfolder of one.
// Folders are matched by ID, never by name (a stage was renamed once already).
// A move only changes the job folder's parent. Nothing is ever deleted in Drive.
const ROOT = "15ARYM4_zMdpNK7At_L6tBSxe8Q_ut3JO"; // "jobs"
const FOLDERS = {
  review: "1RZplmNbCyxeLTArQ10bl1zhse0teajNh", // 1 to review
  ready: "10JBoTbxmSykvjVtbCxS5qGaXKa9voiDb", // 2 ready to apply
  pending: "1nbP94U4nSWFVW2yXrXsPA0Jlcj4KL3Of", // 3 pending
  in_process: "1-vbR7puV7TgFgtlhT7RvtIKe6hLPEDh6", // 4 in process
  passed: "1uD-CheX4UIR8jb5XLcj5Q9ZXd0olliEg", // 5 passed
};
// stage → { done, deleted } = the stage the job goes to. "closed" has no
// folder: a closed job's folder stays where it is.
const TRANSITIONS = {
  review: { done: "pending", deleted: "passed" },
  ready: { done: "pending", deleted: "passed" },
  pending: { done: "in_process", deleted: "passed" },
  in_process: { done: "closed", deleted: "passed" },
};
const STAGES = ["review", "ready", "pending", "in_process", "passed", "closed"];

// The stage a card is in: `stage`, else the legacy `status` (new and review →
// review, applied → pending, "in process" → in_process). "" when neither says.
function stageOf(card) {
  const s = String(card?.stage || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (STAGES.includes(s)) return s;
  const old = String(card?.status || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return { new: "review", review: "review", ready: "ready", applied: "pending", pending: "pending", in_process: "in_process", passed: "passed", closed: "closed" }[old] || "";
}

// The stage an event on a job in `from` leads to; "" for none.
const nextStage = (from, event) => (Object.hasOwn(TRANSITIONS, from) && Object.hasOwn(TRANSITIONS[from], event) ? TRANSITIONS[from][event] : "");

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

// → { folderId, parents, moved } as Drive now has it.
//   job: { folderId, from, to }: the job's folder, the stage it was acted on
//   from and the stage it goes to. Its parent is read first, so a move is
//   never made twice: a folder already in `to` is left alone (a retry after a
//   half-finished move is safe), and one that is in neither stage folder (moved
//   by hand) is a conflict, not moved. A stage with no folder (closed) moves nothing.
async function moveJobFolder(accessToken, { folderId, from, to }, fetchFn = fetch) {
  if (!FOLDERS[from] && FOLDERS[to]) throw Object.assign(new Error("no stage to move from"), { bad: true });
  if (!folderId || folderId === ROOT || Object.values(FOLDERS).includes(folderId)) throw Object.assign(new Error("not a job folder"), { bad: true });
  if (!FOLDERS[to]) return { folderId, parents: null, moved: false };
  const { parents = [] } = await driveCall(fileUrl(folderId), accessToken, fetchFn);
  const dest = FOLDERS[to];
  if (parents.includes(dest)) return { folderId, parents, moved: false };
  if (!parents.includes(FOLDERS[from])) throw Object.assign(new Error("job is not in the stage it was acted on from"), { conflict: true });

  const patch = fileUrl(folderId);
  patch.searchParams.set("addParents", dest);
  patch.searchParams.set("removeParents", FOLDERS[from]);
  await driveCall(patch, accessToken, fetchFn, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: "{}" });
  return { folderId, parents: [dest, ...parents.filter((p) => p !== FOLDERS[from])], moved: true };
}

module.exports = { moveJobFolder, stageOf, nextStage, FOLDERS, TRANSITIONS, STAGES, ROOT };
