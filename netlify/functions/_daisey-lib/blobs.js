// Shared Blobs access, using the manual siteID+token pattern —
// NETLIFY_BLOBS_CONTEXT auto-detection is confirmed broken on this
// project (see tools/CLAUDE.md, "Daisey standalone" section). Every
// function that touches Blobs should go through this, not call
// getStore() directly, or it will hit MissingBlobsEnvironmentError again.
const { getStore } = require("@netlify/blobs");

const SITE_ID = process.env.SITE_ID || process.env.NETLIFY_SITE_ID;
const TOKEN = process.env.NETLIFY_BLOBS_TOKEN;

function openStore(name) {
  if (process.env.NETLIFY_BLOBS_CONTEXT) return getStore(name);
  return getStore(name, { siteID: SITE_ID, token: TOKEN });
}

module.exports = { openStore };
