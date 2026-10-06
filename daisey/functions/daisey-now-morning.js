// The morning brief's clock (2026-10-06): every 15 minutes (netlify.toml),
// for each user signed up in daisey-now-push, sends today's brief once, in
// the first 90 minutes after their day hours start, in their own time zone.
// The 90 minutes let a missed or late run still catch the morning; sentOn
// keeps it to one a day.
const { store, update, deliver } = require("./_daisey-lib/morning");
const { localParts } = require("./_daisey-lib/brief");
const { configured } = require("./_daisey-lib/webpush");

const WINDOW_MINUTES = 90;

exports.handler = async () => {
  if (!configured()) return { statusCode: 200, body: "not configured" };
  const now = Date.now();
  const { blobs = [] } = await store().list({ prefix: "u:" });
  let sent = 0;
  for (const { key } of blobs) {
    try {
      const rec = await store().get(key, { type: "json" });
      if (!rec?.subs?.length) continue;
      const { date, minutes } = localParts(now, rec.tz || "Asia/Jerusalem");
      const start = rec.dayStart ?? 480;
      if (rec.sentOn === date || minutes < start || minutes >= start + WINDOW_MINUTES) continue;
      const r = await deliver(rec, now);
      sent += r.sent;
      await update(key.slice(2), () => ({ sentOn: date, subs: r.subs }));
    } catch (e) {
      console.error("daisey-now-morning", key, e.message);
    }
  }
  return { statusCode: 200, body: `sent ${sent}` };
};
