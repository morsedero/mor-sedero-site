// Files attached to a task (Mor, 2026-10-11: "+ Link or file" took a typed
// file name as a web address, so the chip opened nothing). A picked file is
// kept in this device's IndexedDB, and the task's link holds only
// { file: id, label: name }: Daisey has no file storage in the cloud, so a
// file opens on the phone it was added from. Anywhere else the chip says so.
const DB = "daisey-files", STORE = "files";
export const FILE_MAX = 25 * 1024 * 1024;

function db(){
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function run(mode, fn){
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(STORE, mode), req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => { d.close(); resolve(req.result); };
    tx.onerror = () => { d.close(); reject(tx.error); };
  });
}

// The file → its id, or throws (too big, no storage).
export async function keepFile(file){
  if (file.size > FILE_MAX) throw new Error("big");
  const id = `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  await run("readwrite", (s) => s.put({ blob: file, name: file.name, type: file.type }, id));
  return id;
}
export const dropFile = (id) => run("readwrite", (s) => s.delete(id)).catch(() => {});

// A URL for the file, for the chip's own href (a tap then opens it natively,
// no pop-up blocker in the way): { url, name, view } or null when it isn't on
// this device. view: the browser can show it itself, so it opens in a tab;
// anything else downloads under its name, and the phone opens it from there.
const VIEW = /^(image|audio|video|text)\/|^application\/pdf$/;
export async function fileUrl(id){
  const rec = await run("readonly", (s) => s.get(id)).catch(() => null);
  if (!rec) return null;
  return { url: URL.createObjectURL(rec.blob), name: rec.name, view: VIEW.test(rec.type || "") };
}
