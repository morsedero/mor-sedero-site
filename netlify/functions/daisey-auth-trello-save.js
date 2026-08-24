// Receives the Trello token relayed by daisey-auth-trello-callback.js's
// client-side JS (the token itself never reaches a server via URL/redirect
// — Trello only ever puts it in a fragment). Real session-linking (storing
// this against the visitor's actual userId) comes once the session layer
// exists. For now, same as the Google callback: prove the write really
// happens, using the same openStore() manual-token pattern the blobs
// smoketest confirmed works on this project.
const { getStore } = require("@netlify/blobs");

const SITE_ID = process.env.SITE_ID || process.env.NETLIFY_SITE_ID;
const TOKEN = process.env.NETLIFY_BLOBS_TOKEN;

function openStore(name) {
  if (process.env.NETLIFY_BLOBS_CONTEXT) return getStore(name);
  return getStore(name, { siteID: SITE_ID, token: TOKEN });
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "POST only" };
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch (e) {
    return { statusCode: 400, body: "Bad JSON" };
  }

  if (!body.token) {
    return { statusCode: 400, body: "Missing token" };
  }

  // Smoke test only — verifies the token actually reached the server and
  // is a real, usable Trello token, by calling Trello with it right away.
  const KEY = process.env.TRELLO_STANDALONE_API_KEY;
  const check = await fetch(`https://api.trello.com/1/members/me?key=${KEY}&token=${body.token}&fields=username`);
  if (!check.ok) {
    return { statusCode: 400, body: `Trello rejected the token: ${await check.text()}` };
  }
  const member = await check.json();

  const store = openStore("smoketest");
  await store.setJSON("trello-token-test", { savedAt: new Date().toISOString(), trelloUsername: member.username });

  return { statusCode: 200, body: `saved, trello user: ${member.username}` };
};
