// Audio project -> PROJECTS session/work-day card sync.
//
// Scheduled (see netlify.toml). Finds every Trello board named "<Project> - Audio",
// reads its Waiting/In Progress tracker cards, groups them by the subject before the
// colon in each card's name (e.g. "Boss: Green Fire" -> subject "Boss"), sizes each
// group by a point system, and creates/updates batch cards on PROJECTS -> <Project> so
// Daisey schedules them as Sessions (yellow, 3h) or Work days (orange, 8h) — sizing
// is Daisey's own sizeFromLabels() rule, nothing more is needed for these cards to
// enter the normal schedule.
//
// Design decisions (2026-08-18, from a conversation with the user, not inferred):
// - No Trello field carries complexity. Points come from keyword matching on the
//   item's own text (after the subject prefix): Simple=1, Standard=2 (default),
//   Complex=4. A run of items sharing a "<Name> - <part>" prefix (e.g. the real
//   4-part "Mine Shot" chain: "Fire (launch)"/"Loop (travel)"/"Ground Contact"/
//   "Explosion") collapses into ONE Complex(4) item — it's designed as one unit,
//   not four separate sounds.
// - New items pack into a bin up to WORKDAY_CAP points. A bin totalling <=
//   SESSION_CAP is a Session card, otherwise a Work day card. A subject with an
//   existing open (non-legacy, non-archived, not done) auto-batch tops that card up
//   before opening a new one; multiple bins get a "(batch N)" suffix.
// - Music tracker items are NOT point-packed — one PROJECTS card per track, because
//   a track doesn't parallelize with other tracks the way small SFX cues do. Size
//   comes from the track's own description: a parseable "<n> min" means Production
//   stage (>=1min = Work day, <1min = Session, per the user's own rule); no
//   parseable length means Demo stage (always Session — "send for first approval").
// - Idempotency: every card this function writes carries a hidden HTML-comment
//   marker naming the tracker item IDs it covers, so a later run never re-batches a
//   covered item. Hand-written cards have no marker and are invisible to this system
//   — never read for coverage, never edited.
// - The 8 real hand-made batch cards that already existed on PROJECTS -> MonsterPunk
//   before this function existed were backfilled with `legacy="true"` markers
//   (2026-08-18, done once via direct Trello calls, not by this function) so this
//   function's first live run doesn't recreate the 18 tracker items they already
//   cover. `legacy="true"` cards count toward coverage but are never a target for
//   "top up the open batch" — this function only ever edits cards it created itself.

const KEY = process.env.TRELLO_API_KEY;
const TOKEN = process.env.TRELLO_API_TOKEN;
const BASE = "https://api.trello.com/1";

const PROJECTS_BOARD_ID = "692abd49a69c853bb71cb728"; // fixed anchor board, same as daisey.html's BOARDS
const AUDIO_SUFFIX_RE = /[-–—]\s*Audio\s*$/i; // hyphen/en-dash/em-dash tolerant
const STAGE_LIST_RE = /^(waiting|in progress)$/i;
const SESSION_CAP = 6, WORKDAY_CAP = 16;

const MARKER_RE = /<!--\s*daisey-audio-sync v1 subject="([^"]*)" board="([^"]*)" items="([^"]*)"(?:\s+(legacy="true"))?\s*-->/;
const marker = (subject, boardId, pairs, legacy) =>
  `<!-- daisey-audio-sync v1 subject="${subject}" board="${boardId}" items="${pairs.join(",")}"${legacy ? ' legacy="true"' : ""} -->`;

async function trelloGet(path, params = {}) {
  const url = new URL(BASE + path);
  url.searchParams.set("key", KEY);
  url.searchParams.set("token", TOKEN);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}: ${await res.text()}`);
  return res.json();
}
async function trelloWrite(method, path, body = {}) {
  const url = new URL(BASE + path);
  url.searchParams.set("key", KEY);
  url.searchParams.set("token", TOKEN);
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${await res.text()}`);
  return res.json();
}

function classify(text) {
  const t = text.toLowerCase();
  if (/\b(chain|shockwave|multi|sequence|cutscene)\b/.test(t)) return 4;
  if (/\b(ui|menu|blip|beep|click|tick|ambient|footstep)\b/.test(t)) return 1;
  return 2;
}
const normName = s => s.toLowerCase().replace(/[^a-z0-9֐-׿]/g, "");

function splitSubject(name) {
  const i = name.indexOf(":");
  if (i < 0) return null;
  return { subject: name.slice(0, i).trim(), detail: name.slice(i + 1).trim() };
}

/* Chain-merge: items sharing a "<Name> - <part>" prefix (2+ of them) collapse into
   one Complex(4) item. Everything else is scored individually via classify(). */
function scoreSfxItems(items) {
  const chainKey = it => { const m = /^(.*?)\s-\s/.exec(it.detail); return m ? m[1].trim() : null; };
  const groups = new Map();
  for (const it of items) {
    const k = chainKey(it);
    if (!k) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(it);
  }
  const used = new Set();
  const scored = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    group.forEach(it => used.add(it.id));
    scored.push({ ids: group.map(it => it.id), names: group.map(it => it.name), points: 4 });
  }
  for (const it of items) {
    if (used.has(it.id)) continue;
    scored.push({ ids: [it.id], names: [it.name], points: classify(it.detail) });
  }
  return scored;
}

/* Packs new scored items into bins up to WORKDAY_CAP. If `seed` is given (an open
   batch's current contents) the first bin continues it instead of starting empty. */
function packSfx(scoredItems, seed) {
  const bins = [];
  let cur = seed
    ? { ids: [...seed.ids], names: [...seed.names], points: seed.points, continuesCardId: seed.cardId }
    : { ids: [], names: [], points: 0, continuesCardId: null };
  for (const it of scoredItems) {
    if (cur.points > 0 && cur.points + it.points > WORKDAY_CAP) {
      bins.push(cur);
      cur = { ids: [], names: [], points: 0, continuesCardId: null };
    }
    cur.ids.push(...it.ids);
    cur.names.push(...it.names);
    cur.points += it.points;
  }
  if (cur.points > 0) bins.push(cur);
  return bins.map(b => ({ ...b, size: b.points <= SESSION_CAP ? "session" : "workday" }));
}

function parseMarkers(cards, boardId) {
  const covered = new Set();
  const openBySubject = new Map();
  const countBySubject = new Map();
  for (const c of cards) {
    const m = MARKER_RE.exec(c.desc || "");
    if (!m) continue;
    const [, subject, mBoard, itemsStr, legacyFlag] = m;
    if (mBoard !== boardId) continue;
    const pairs = itemsStr.split(",").filter(Boolean).map(p => p.split(":"));
    let total = 0;
    for (const [id, pts] of pairs) { covered.add(id); total += Number(pts) || 0; }
    countBySubject.set(subject, (countBySubject.get(subject) || 0) + 1);
    const open = !legacyFlag && !c.closed && !c.dueComplete;
    if (open && !openBySubject.has(subject)) {
      openBySubject.set(subject, { cardId: c.id, ids: pairs.map(p => p[0]), points: total });
    }
  }
  return { covered, openBySubject, countBySubject };
}

async function findOrCreateProjectList(projectName) {
  const lists = await trelloGet(`/boards/${PROJECTS_BOARD_ID}/lists`, { fields: "id,name" });
  const target = normName(projectName);
  const found = lists.find(l => normName(l.name) === target);
  if (found) return found.id;
  const created = await trelloWrite("POST", "/lists", { name: projectName, idBoard: PROJECTS_BOARD_ID });
  return created.id;
}

// Work-day size removed from Daisey (2026-08-24, user request) — a card
// shouldn't re-claim the user's whole configured day. Every batch/track
// card gets yellow now; orange is no longer written by this function.
let labelIdsCache = null;
async function projectLabelIds() {
  if (labelIdsCache) return labelIdsCache;
  const labels = await trelloGet(`/boards/${PROJECTS_BOARD_ID}/labels`, { fields: "id,color", limit: 100 });
  labelIdsCache = {
    yellow: (labels.find(l => l.color === "yellow") || {}).id,
  };
  return labelIdsCache;
}

function sfxDesc(boardName, boardUrl, subject, names, ids, boardId, legacy) {
  const body = `One SFX sitting. Covers ${names.length} asset${names.length === 1 ? "" : "s"} on the ${boardName} tracker: ${names.join(", ")}.\n\n` +
    `Done = first pass rendered for all and moved to In Review on the tracker board.\n${boardUrl}`;
  const pairs = ids; // already "id:pts" strings by the time this is called
  return `${body}\n\n${marker(subject, boardId, pairs, legacy)}`;
}

function musicDesc(boardName, boardUrl, trackName, boardId, cardId, pts, stage, lengthMin) {
  const lengthNote = lengthMin != null ? `${lengthMin} min, ` : "";
  const doneCriteria = stage === "demo"
    ? "demo sent for approval"
    : "final mix rendered and delivered";
  const body = `${stage === "demo" ? "Demo pass" : "Production pass"} for "${trackName}" (${lengthNote}${stage} stage) on the ${boardName} tracker.\n\n` +
    `Done = ${doneCriteria}.\n${boardUrl}`;
  return `${body}\n\n${marker("Music", boardId, [`${cardId}:${pts}`], false)}`;
}

async function processBoard(board, results) {
  const boardId = board.id;
  const boardUrl = `https://trello.com/b/${board.shortLink}`;
  const projectName = board.name.replace(AUDIO_SUFFIX_RE, "").trim();

  const [lists, allCards] = await Promise.all([
    trelloGet(`/boards/${boardId}/lists`, { fields: "id,name" }),
    trelloGet(`/boards/${boardId}/cards`, { fields: "id,name,desc,idList,due,dueComplete,closed", filter: "all" }),
  ]);
  const listName = new Map(lists.map(l => [l.id, l.name]));
  const nameById = new Map(allCards.map(c => [c.id, c.name]));

  const todo = allCards.filter(c =>
    !c.closed && !c.dueComplete &&
    STAGE_LIST_RE.test(listName.get(c.idList) || "") &&
    c.name.includes(":")
  );

  const listId = await findOrCreateProjectList(projectName);
  // filter:"all" — an archived batch card must still count as coverage (its tracker
  // items shouldn't come back into the pool just because the card was archived), the
  // default list-cards fetch returns open cards only and would silently forget it.
  const projectCards = await trelloGet(`/lists/${listId}/cards`, { fields: "id,name,desc,closed,dueComplete", filter: "all" });
  const { covered, openBySubject, countBySubject } = parseMarkers(projectCards, boardId);

  const bySubject = new Map();
  for (const c of todo) {
    if (covered.has(c.id)) continue;
    const split = splitSubject(c.name);
    if (!split) continue;
    if (split.subject.toLowerCase() === "music") continue;
    if (!bySubject.has(split.subject)) bySubject.set(split.subject, []);
    bySubject.get(split.subject).push({ id: c.id, name: split.detail, detail: split.detail });
  }

  const { yellow } = await projectLabelIds();

  for (const [subject, items] of bySubject) {
    const scored = scoreSfxItems(items);
    if (!scored.length) continue;
    const seed = openBySubject.get(subject);
    const seedNames = seed ? seed.ids.map(id => nameById.get(id) || id) : null;
    const bins = packSfx(scored, seed ? { cardId: seed.cardId, ids: seed.ids, names: seedNames, points: seed.points } : null);

    const priorBatches = countBySubject.get(subject) || 0;
    const totalBatchesAfter = priorBatches + bins.filter(b => !b.continuesCardId).length;
    let newBatchIndex = priorBatches - (seed ? 1 : 0) + 1;

    for (const bin of bins) {
      const label = yellow;
      // id:points pairs for the marker — new items carry their own score from `scored`;
      // a continued bin's carried-over ids re-derive their score from their live card
      // text (the original per-id split wasn't kept, only the bin's total).
      const idPoints = new Map();
      for (const s of scored) for (const id of s.ids) idPoints.set(id, s.points);
      if (bin.continuesCardId && seed) {
        for (const id of seed.ids) {
          if (!idPoints.has(id)) {
            const nm = nameById.get(id) || "";
            const split2 = splitSubject(nm);
            idPoints.set(id, split2 ? classify(split2.detail) : 2);
          }
        }
      }
      const pairs = bin.ids.map(id => `${id}:${idPoints.get(id)}`);

      if (bin.continuesCardId) {
        const desc = sfxDesc(board.name, boardUrl, subject, bin.names, pairs, boardId, false);
        await trelloWrite("PUT", `/cards/${bin.continuesCardId}`, { desc, idLabels: [label] });
        results.push({ action: "updated", board: board.name, card: bin.continuesCardId, subject, size: bin.size, count: bin.ids.length });
      } else {
        const name = totalBatchesAfter > 1 ? `SFX batch: ${subject} (batch ${newBatchIndex})` : `SFX batch: ${subject}`;
        newBatchIndex++;
        const desc = sfxDesc(board.name, boardUrl, subject, bin.names, pairs, boardId, false);
        const created = await trelloWrite("POST", "/cards", { name, desc, idList: listId, idLabels: [label] });
        results.push({ action: "created", board: board.name, card: created.id, name, subject, size: bin.size, count: bin.ids.length });
      }
    }
  }

  // Music: one card per track, never batched, never re-touched once covered.
  const musicItems = todo.filter(c => {
    const split = splitSubject(c.name);
    return split && split.subject.toLowerCase() === "music" && !covered.has(c.id);
  });
  for (const c of musicItems) {
    const split = splitSubject(c.name);
    const lenMatch = /(\d+(?:\.\d+)?)\s*min/i.exec(c.desc || "");
    const stage = lenMatch ? "production" : "demo";
    const lengthMin = lenMatch ? Number(lenMatch[1]) : null;
    const size = stage === "demo" ? "session" : (lengthMin < 1 ? "session" : "workday");
    const pts = size === "session" ? 3 : 8; // record-keeping only; label is what schedules it
    const label = yellow;
    const desc = musicDesc(board.name, boardUrl, split.detail, boardId, c.id, pts, stage, lengthMin);
    const created = await trelloWrite("POST", "/cards", { name: c.name, desc, idList: listId, idLabels: [label] });
    results.push({ action: "created", board: board.name, card: created.id, name: c.name, subject: "Music", size, count: 1 });
  }
}

exports.handler = async () => {
  if (!KEY || !TOKEN) {
    return { statusCode: 500, body: "missing TRELLO_API_KEY/TRELLO_API_TOKEN" };
  }
  const results = [];
  const errors = [];
  try {
    const boards = await trelloGet("/members/me/boards", { fields: "id,name,shortLink" });
    const audioBoards = boards.filter(b => AUDIO_SUFFIX_RE.test(b.name));
    for (const board of audioBoards) {
      try { await processBoard(board, results); }
      catch (e) { errors.push({ board: board.name, error: e.message }); }
    }
  } catch (e) {
    return { statusCode: 500, body: "listing boards failed: " + e.message };
  }
  return { statusCode: 200, body: JSON.stringify({ results, errors }, null, 2) };
};
