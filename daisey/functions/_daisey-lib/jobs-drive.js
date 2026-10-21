// Reads the Job Hunt cards from Google Drive: the newest jobs.json in the
// Job Hunt folder. Read only. The file's id changes every week, so it is
// looked up by name each time. Shared shape of the failures:
//   { reauth: true }    Google says the token is no good (401)
//   { scope: true }     the grant predates drive.readonly (403 insufficient scope)
//   other Errors        Drive itself failed
const FOLDER_ID = "1_sAGh_9VYSD2YEDxzQqnLzvII3Q4JgiE";
const FILE_NAME = "jobs.json";
const MAX_CARDS = 500;
const MAX_BYTES = 2 * 1024 * 1024;

async function driveGet(url, accessToken, fetchFn) {
  const res = await fetchFn(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (res.ok) return res;
  if (res.status === 401) throw Object.assign(new Error("drive 401"), { reauth: true });
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

module.exports = { readJobs, FOLDER_ID, FILE_NAME };
