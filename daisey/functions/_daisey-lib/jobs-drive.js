// The Job Hunt files in Google Drive. jobs.json is Claude's: the newest one in
// the Job Hunt folder, READ ONLY here; its id changes every week, so it is
// looked up by name each time. daisey-status.json is Daisey's own (created
// with drive.file, so it is the only file Daisey can ever write): what Mor
// decided on each job, laid over the cards by the app. Shared shape of the
// failures:
//   { reauth: true }    Google says the token is no good (401)
//   { scope: true }     the grant predates the scope the call needs (403 insufficient scope)
//   { notFound: true }  Drive says 404
//   { bad: true }       nothing valid to write
//   { bad: true }       nothing valid to write
//   other Errors        Drive itself failed
const FOLDER_ID = "1_sAGh_9VYSD2YEDxzQqnLzvII3Q4JgiE";
const FILE_NAME = "jobs.json";
const STATUS_NAME = "daisey-status.json";
const STATUSES = ["ready", "applied", "passed"];
const MAX_CARDS = 500;
const MAX_BYTES = 2 * 1024 * 1024;

async function driveGet(url, accessToken, fetchFn, init = {}) {
  const res = await fetchFn(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${accessToken}` } });
  if (res.ok) return res;
  if (res.status === 401) throw Object.assign(new Error("drive 401"), { reauth: true });
  if (res.status === 404) throw Object.assign(new Error("drive 404"), { notFound: true });
  const body = await res.json().catch(() => ({}));
  const reasons = (body.error?.errors || []).map((e) => e.reason);
  const noScope = reasons.some((r) => r === "insufficientPermissions" || r === "ACCESS_TOKEN_SCOPE_INSUFFICIENT") || /insufficient/i.test(body.error?.message || "");
  if (res.status === 403 && noScope) {
    throw Object.assign(new Error("drive scope"), { scope: true });
  }
  throw Object.assign(new Error(`drive ${res.status}: ${body.error?.message || ""}`), { status: res.status });
}

// → { cards: [...], modified: ISO | null }. No jobs.json in the folder → no cards.
async function readJobs(accessToken, fetchFn = fetch) {
  const q = `name='${FILE_NAME}' and '${FOLDER_ID}' in parents and trashed=false`;
  const list = new URL("https://www.googleapis.com/drive/v3/files");
  list.searchParams.set("q", q);
  list.searchParams.set("fields", "files(id,modifiedTime)");
  list.searchParams.set("orderBy", "modifiedTime desc");
  list.searchParams.set("pageSize", "1");
  const found = (await (await driveGet(list, accessToken, fetchFn)).json()).files || [];
  if (!found.length) return { cards: [], modified: null };

  const media = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(found[0].id)}`);
  media.searchParams.set("alt", "media");
  const text = await (await driveGet(media, accessToken, fetchFn)).text();
  if (text.length > MAX_BYTES) throw new Error("jobs.json too large");
  let cards;
  try { cards = JSON.parse(text); } catch { throw new Error("jobs.json is not JSON"); }
  if (!Array.isArray(cards)) throw new Error("jobs.json is not a list");
  return { cards: cards.filter((c) => c && typeof c === "object" && c.id).slice(0, MAX_CARDS), modified: found[0].modifiedTime || null };
}

// A CV file's HTML text. Drive also says 404 for a file it won't show this account.
async function readCv(accessToken, fileId, fetchFn = fetch) {
  const media = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`);
  media.searchParams.set("alt", "media");
  const text = await (await driveGet(media, accessToken, fetchFn)).text();
  if (text.length > MAX_BYTES) throw new Error("cv too large");
  return text;
}

// ---------- daisey-status.json ----------
// {"updated":"<iso>","jobs":{"<job id>":{"status":"ready|applied|passed","at":"<iso>","note":"…"}}}
// One entry per job id, the latest `at` wins. Anything malformed is dropped
// rather than trusted: the file is shared state, read by every device.
const time = (v) => (typeof v === "string" ? Date.parse(v) : NaN);

function cleanJobs(jobs) {
  const out = {};
  if (!jobs || typeof jobs !== "object") return out;
  for (const [id, e] of Object.entries(jobs).slice(0, MAX_CARDS)) {
    if (!id || id.length > 200 || !e || typeof e !== "object" || !STATUSES.includes(e.status) || !(time(e.at) > 0)) continue;
    const note = typeof e.note === "string" ? e.note.trim().slice(0, 500) : "";
    out[id] = { status: e.status, at: new Date(time(e.at)).toISOString(), ...(note ? { note } : {}) };
  }
  return out;
}

// The file Daisey wrote: by the id it was told, else (or if that id is gone)
// by name in the folder. → { id, jobs } or null when there is none.
async function findStatus(accessToken, fileId, fetchFn) {
  const read = async (id) => {
    const media = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}`);
    media.searchParams.set("alt", "media");
    const text = await (await driveGet(media, accessToken, fetchFn)).text();
    if (text.length > MAX_BYTES) throw new Error("status file too large");
    let body = null;
    try { body = JSON.parse(text); } catch { /* a damaged file is rewritten, not trusted */ }
    return { id, jobs: cleanJobs(body?.jobs) };
  };
  if (fileId) {
    try { return await read(fileId); } catch (e) { if (!e.notFound) throw e; }
  }
  const list = new URL("https://www.googleapis.com/drive/v3/files");
  list.searchParams.set("q", `name='${STATUS_NAME}' and '${FOLDER_ID}' in parents and trashed=false`);
  list.searchParams.set("fields", "files(id)");
  list.searchParams.set("orderBy", "modifiedTime desc");
  list.searchParams.set("pageSize", "1");
  const found = (await (await driveGet(list, accessToken, fetchFn)).json()).files || [];
  return found.length ? read(found[0].id) : null;
}

// → { fileId, jobs } ({} and null when there is no file yet). Never creates anything.
async function readStatus(accessToken, fileId, fetchFn = fetch) {
  const f = await findStatus(accessToken, fileId, fetchFn);
  return { fileId: f ? f.id : null, jobs: f ? f.jobs : {} };
}

// Read, merge, write: the file's other jobs are never dropped, and a job keeps
// the entry with the latest `at` (an older tap arriving late loses). The first
// write creates the file in the Job Hunt folder; after that it is a PATCH by
// id. → { fileId, jobs } as written.
async function writeStatus(accessToken, fileId, updates, fetchFn = fetch, now = () => new Date()) {
  const fresh = Object.entries(cleanJobs(updates));
  if (!fresh.length) throw Object.assign(new Error("no valid updates"), { bad: true });
  const found = await findStatus(accessToken, fileId, fetchFn);
  const jobs = { ...(found?.jobs || {}) };
  for (const [id, e] of fresh) {
    if (!jobs[id] || time(e.at) >= time(jobs[id].at)) jobs[id] = e;
  }
  const json = JSON.stringify({ updated: now().toISOString(), jobs });
  const send = (url, init) => driveGet(url, accessToken, fetchFn, init).then((r) => r.json());

  if (found) {
    const url = new URL(`https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(found.id)}`);
    url.searchParams.set("uploadType", "media");
    url.searchParams.set("fields", "id");
    try {
      await send(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: json });
      return { fileId: found.id, jobs };
    } catch (e) { if (!e.notFound) throw e; } // gone since we read it: make it again
  }
  const url = new URL("https://www.googleapis.com/upload/drive/v3/files");
  url.searchParams.set("uploadType", "multipart");
  url.searchParams.set("fields", "id");
  const B = "daisey" + Math.random().toString(36).slice(2);
  const meta = JSON.stringify({ name: STATUS_NAME, parents: [FOLDER_ID], mimeType: "application/json" });
  const body = `--${B}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${B}\r\nContent-Type: application/json\r\n\r\n${json}\r\n--${B}--`;
  const made = await send(url, { method: "POST", headers: { "Content-Type": `multipart/related; boundary=${B}` }, body });
  if (!made.id) throw new Error("drive: no file id");
  return { fileId: made.id, jobs };
}

module.exports = { readJobs, readCv, readStatus, writeStatus, FOLDER_ID, FILE_NAME, STATUS_NAME };
