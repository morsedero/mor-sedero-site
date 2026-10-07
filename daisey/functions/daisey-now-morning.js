// Daisey's notification clock (2026-10-06): every 5 minutes (netlify.toml),
// for each user signed up in daisey-now-push, inside their day hours and in
// their own time zone, sends whatever _daisey-lib/notify.js decides is due —
// the morning brief, the evening wrap, a free gap after an event, a booked
// slot starting. What was sent is remembered on the record so nothing goes
// twice. (Named for the morning brief, its first job.)
const { store, update, readEvents, sendAll, logged } = require("./_daisey-lib/morning");
const { decide } = require("./_daisey-lib/notify");
const { localParts } = require("../app/js/brief.js");
const { configured } = require("./_daisey-lib/webpush");

exports.handler = async () => {
  if (!configured()) return { statusCode: 200, body: "not configured" };
  const now = Date.now();
  const { blobs = [] } = await store().list({ prefix: "u:" });
  let sent = 0;
  for (const { key } of blobs) {
    try {
      const rec = await store().get(key, { type: "json" });
      if (!rec?.subs?.length) continue;
      const tz = rec.tz || "Asia/Jerusalem";
      const { minutes } = localParts(now, tz);
      if (minutes < (rec.dayStart ?? 480) || minutes >= (rec.dayEnd ?? 1320)) continue; // night: no calendar read either
      process.env.TZ = tz; // the app's engine reads local time
      const { events, cal } = await readEvents(rec, now);
      const { out, patch } = decide(rec, events, now);
      let subs = rec.subs;
      for (const m of out) {
        const r = await sendAll({ ...rec, subs }, { title: m.title, body: m.body, tag: m.tag, url: m.url, ...(m.taskId ? { taskId: m.taskId } : {}) }, { ttl: m.ttl });
        sent += r.sent; subs = r.subs;
      }
      // subs only when a device dropped out: a sign-up that landed mid-run stays.
      await update(key.slice(2), (cur) => ({ ...patch, cal, ...(subs.length !== rec.subs.length ? { subs } : {}),
        ...(out.length ? { log: logged(cur, out, now) } : {}) }));
    } catch (e) {
      console.error("daisey-now-morning", key, e.message);
    }
  }
  return { statusCode: 200, body: `sent ${sent}` };
};
