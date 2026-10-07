// Google account id (`sub`) → the stored-token user id, creating the link on
// first use. The same mapping daisey-auth-google-callback makes when someone
// connects their calendar; Trello can arrive first (Daisey v1, 2026-10-07), so
// whichever connects first creates it and the other finds it.
const crypto = require("crypto");
const { openStore } = require("./blobs");

async function userIdForGoogleSub(sub) {
  const store = openStore("daisey-users");
  const key = `google-sub:${sub}`;
  const existing = await store.get(key, { type: "text" });
  if (existing) return existing;
  const userId = crypto.randomBytes(16).toString("hex");
  await store.set(key, userId);
  return userId;
}

module.exports = { userIdForGoogleSub };
