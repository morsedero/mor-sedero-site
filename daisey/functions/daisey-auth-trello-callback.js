// Trello redirects here with the token in the URL FRAGMENT (#token=...),
// which never reaches this function server-side — fragments are
// browser-only. This returns a small HTML page whose JS reads
// location.hash and POSTs the token to daisey-auth-trello-save.js.
exports.handler = async (event = {}) => {
  const raw = (event.headers && (event.headers.cookie || event.headers.Cookie)) || "";
  if (/(^|;\s*)daisey_t_return=now(;|$)/.test(raw)) {
    // From Daisey v1: hand the fragment to the app, which saves it with the
    // user's own sign-in. The page only forwards it; nothing is stored here.
    return {
      statusCode: 200,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
      multiValueHeaders: { "Set-Cookie": ["daisey_t_return=; Path=/; Max-Age=0"] },
      body: `<!doctype html><meta charset="utf-8"><title>Connecting Trello…</title><p style="font-family:sans-serif;padding:40px;text-align:center">Connecting Trello…</p><script>location.replace("/daisey/now/?trello=1"+location.hash)</script>`,
    };
  }
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Connecting Trello…</title></head>
<body style="font-family:sans-serif;padding:40px;text-align:center;">
<p id="msg">Connecting Trello…</p>
<script>
(async function(){
  const params = new URLSearchParams(location.hash.slice(1));
  const token = params.get("token");
  const msg = document.getElementById("msg");
  if(!token){
    msg.textContent = "No token received. Close this and try again.";
    return;
  }
  try{
    const res = await fetch("/.netlify/functions/daisey-auth-trello-save", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token })
    });
    if(res.ok){
      msg.textContent = "Connected. You can close this tab.";
      setTimeout(()=>{ location.href = "/daisey/"; }, 800);
    }else{
      msg.textContent = "Couldn't save the connection. " + (await res.text());
    }
  }catch(e){
    msg.textContent = "Error: " + e.message;
  }
})();
</script>
</body></html>`;

  return {
    statusCode: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
    body: html,
  };
};
