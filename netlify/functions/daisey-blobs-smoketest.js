// One-time smoke test: write then read a key with Netlify Blobs, across
// what may be two different invocations. Confirms the store actually works
// on this project before daisey-proxy.js depends on it for real tokens.
// Safe to delete once confirmed — writes only to a "smoketest" store.
const { getStore } = require("@netlify/blobs");

// Auto-detection (NETLIFY_BLOBS_CONTEXT) is not being injected on this
// project — confirmed via ?env=1 below, and a known open issue on Netlify's
// side, not something wrong with this code. Manual siteID+token is the
// documented fallback for exactly this case.
const SITE_ID = process.env.SITE_ID || process.env.NETLIFY_SITE_ID;
const TOKEN = process.env.NETLIFY_BLOBS_TOKEN;

function openStore(name) {
  if (process.env.NETLIFY_BLOBS_CONTEXT) return getStore(name);
  return getStore(name, { siteID: SITE_ID, token: TOKEN });
}

exports.handler = async (event) => {
  if (event.queryStringParameters && event.queryStringParameters.env) {
    return {
      statusCode: 200,
      body: JSON.stringify({
        NETLIFY_SITE_ID: process.env.NETLIFY_SITE_ID || null,
        SITE_ID: process.env.SITE_ID || null,
        NETLIFY_BLOBS_CONTEXT: process.env.NETLIFY_BLOBS_CONTEXT ? "present (not shown)" : null,
        has_manual_token: !!TOKEN,
      }),
    };
  }

  const key = "ping";
  const store = openStore("smoketest");

  if (event.queryStringParameters && event.queryStringParameters.write) {
    const value = { at: new Date().toISOString(), rand: Math.random().toString(36).slice(2) };
    await store.setJSON(key, value);
    return { statusCode: 200, body: `wrote: ${JSON.stringify(value)}` };
  }

  const got = await store.get(key, { type: "json" });
  return { statusCode: 200, body: got ? `read: ${JSON.stringify(got)}` : "nothing stored yet — call with ?write=1 first" };
};
