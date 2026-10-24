// The Job Hunt file in Google Drive. jobs.json is Claude's: Claude writes the
// cards' content; Daisey reads them and writes back ONLY a job's stage and
// stage_at (and moves its folder, drive-move.js). Every write re-reads the file
// first and merges by job id, so an edit Claude made a moment ago is never
// overwritten. Found by name in the Job Hunt folder on every read, never by a
// stored id: Claude's rewrite makes a new file with a new id (Mor, 2026-10-24).
// Shared shape of the failures:
//   { reauth: true }    Google says the token is no good (401)
//   { scope: true }     the grant predates the scope the call needs (403 insufficient scope)
//   { notFound: true }  Drive says 404
//   { bad: true }       nothing valid to write
//   other Errors        Drive itself failed
const { moveJobFolder, stageOf, nextStage } = require("./drive-move");

const FOLDER_ID = "1_sAGh_9VYSD2YEDxzQqnLzvII3Q4JgiE";
const FILE_NAME = "jobs.json";
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

// → { id, modified } of the newest jobs.json in the folder, or null when there is none.
async function findJobs(accessToken, fetchFn) {
  const list = new URL("https://www.googleapis.com/drive/v3/files");
  list.searchParams.set("q", `name='${FILE_NAME}' and '${FOLDER_ID}' in parents and trashed=false`);
  list.searchParams.set("fields", "files(id,modifiedTime)");
  list.searchParams.set("orderBy", "modifiedTime desc");
  list.searchParams.set("pageSize", "1");
  const found = (await (await driveGet(list, accessToken, fetchFn)).json()).files || [];
  return found.length ? { id: found[0].id, modified: found[0].modifiedTime || null } : null;
}

// The file's parsed list, untouched (every entry, every field), and its text.
async function readRaw(accessToken, id, fetchFn) {
  const media = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}`);
  media.searchParams.set("alt", "media");
  const text = await (await driveGet(media, accessToken, fetchFn)).text();
  if (text.length > MAX_BYTES) throw new Error("jobs.json too large");
  let list;
  try { list = JSON.parse(text); } catch { throw new Error("jobs.json is not JSON"); }
  if (!Array.isArray(list)) throw new Error("jobs.json is not a list");
  return { list, text };
}

const cardsOf = (list) => list.filter((c) => c && typeof c === "object" && c.id).slice(0, MAX_CARDS);

// → { cards: [...], modified: ISO | null, fileId }. No jobs.json → no cards.
async function readJobs(accessToken, fetchFn = fetch) {
  const f = await findJobs(accessToken, fetchFn);
  if (!f) return { cards: [], modified: null, fileId: null };
  const { list } = await readRaw(accessToken, f.id, fetchFn);
  return { cards: cardsOf(list), modified: f.modified, fileId: f.id };
}

// A CV file's HTML text. Drive also says 404 for a file it won't show this account.
async function readCv(accessToken, fileId, fetchFn = fetch) {
  const media = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`);
  media.searchParams.set("alt", "media");
  const text = await (await driveGet(media, accessToken, fetchFn)).text();
  if (text.length > MAX_BYTES) throw new Error("cv too large");
  return text;
}

// ---------- stage write-back ----------
const time = (v) => (typeof v === "string" ? Date.parse(v) : NaN);
const idOk = (v) => typeof v === "string" && /^[\w-]{10,}$/.test(v);
// The job's own Drive folder: folder_id, else a folder URL in kit_folder (old cards).
const folderOf = (c) => (idOk(c.folder_id) ? c.folder_id : /\/folders\/([\w-]{10,})/.exec(String(c.kit_folder || ""))?.[1] || "");

// updates: { <job id>: { event: "done" | "deleted", from: <stage>, at: ISO } }
// Each one: the job's folder moves to the stage the event leads to, then the
// file is re-read and that job's stage / stage_at set, nothing else. Per job:
//   ok        moved (or nothing to move) and saved
//   failed    the move failed; nothing saved for it, send it again
//   conflict  the job isn't in `from` any more (Claude moved it): left
//             alone, don't send it again
//   gone      no such job in the file
//   bad       not a valid update
// → { results, cards, modified, fileId }. A failed SAVE throws (every job
// still pending is sent again); a token problem throws as usual.
async function writeStages(accessToken, updates, fetchFn = fetch) {
  const asks = Object.entries(updates && typeof updates === "object" ? updates : {}).slice(0, MAX_CARDS);
  if (!asks.length) throw Object.assign(new Error("no updates"), { bad: true });
  const f = await findJobs(accessToken, fetchFn);
  if (!f) throw Object.assign(new Error("no jobs.json"), { notFound: true });
  const before = cardsOf((await readRaw(accessToken, f.id, fetchFn)).list);

  const results = {}, save = {};
  for (const [id, u] of asks) {
    const to = nextStage(u?.from, u?.event);
    if (!to || !(time(u.at) > 0)) { results[id] = "bad"; continue; }
    const card = before.find((c) => String(c.id) === id);
    if (!card) { results[id] = "gone"; continue; }
    const now = stageOf(card);
    if (now !== u.from && now !== to) { results[id] = "conflict"; continue; }
    const folderId = folderOf(card);
    if (folderId) {
      try { await moveJobFolder(accessToken, { folderId, from: u.from, to }, fetchFn); } catch (e) {
        if (e.reauth || e.scope) throw e;
        // In neither stage folder (moved by hand) or not a job folder: not
        // moved, never guessed at; the stage is still saved.
        if (!e.conflict && !e.bad) { console.error("jobs move", id, e.message); results[id] = "failed"; continue; }
      }
    }
    save[id] = { from: u.from, to, at: new Date(time(u.at)).toISOString() };
  }

  let cards = before, modified = f.modified, fileId = f.id;
  if (Object.keys(save).length) {
    // Found and read again right before writing: whatever Claude saved
    // meanwhile stays, even as a new file.
    const g = await findJobs(accessToken, fetchFn);
    if (!g) throw Object.assign(new Error("jobs.json gone"), { notFound: true });
    const { list, text } = await readRaw(accessToken, g.id, fetchFn);
    let changed = false;
    for (const [id, s] of Object.entries(save)) {
      const card = list.find((c) => c && typeof c === "object" && String(c.id) === id);
      const now = card ? stageOf(card) : "";
      if (!card) { results[id] = "gone"; continue; }
      if (now !== s.from && now !== s.to) { results[id] = "conflict"; continue; }
      results[id] = "ok";
      if (card.stage === s.to) continue;
      card.stage = s.to;
      card.stage_at = s.at;
      changed = true;
    }
    if (changed) {
      const indent = /^\[\s*\n([ \t]+)/.exec(text)?.[1] || "  ";
      const url = new URL(`https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(g.id)}`);
      url.searchParams.set("uploadType", "media");
      url.searchParams.set("fields", "id,modifiedTime");
      const body = JSON.stringify(list, null, indent) + (text.endsWith("\n") ? "\n" : "");
      const out = await (await driveGet(url, accessToken, fetchFn, { method: "PATCH", headers: { "Content-Type": "application/json; charset=UTF-8" }, body })).json();
      modified = out.modifiedTime || modified;
    }
    cards = cardsOf(list); modified = modified === f.modified ? g.modified : modified; fileId = g.id;
  }
  return { results, cards, modified, fileId };
}

module.exports = { readJobs, readCv, writeStages, FOLDER_ID, FILE_NAME };
