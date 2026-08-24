// Trello redirects here with the token in the URL FRAGMENT (#token=...),
// which never reaches this function server-side — fragments are
// browser-only. This returns a small HTML page whose JS reads
// location.hash and POSTs the token to daisey-auth-trello-save.js.
exports.handler = async () => {
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
      setTimeout(()=>{ location.href = "/"; }, 800);
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
