const fs=require("fs");const {chromium}=require("playwright");
const page_html=fs.readFileSync("dayflow.html","utf8");
const mk = code => `
window.__calls=[];
window.claude={ use: async n => n==="mcp" ? {
  watchTool(server,tool,input,handler){ setTimeout(()=>handler({type:"error",error:{code:"${code}",server,message:"x"}}),20); return ()=>{}; },
  async callTool(){ throw {code:"${code}",message:"x"}; },
  async invalidate(){}, async listTools(){return {servers:[]};}
} : null };`;
const noMcp = `window.claude={ use: async () => null };`;
(async()=>{const b=await chromium.launch({executablePath:"/opt/pw-browsers/chromium-1194/chrome-linux/chrome"});
for(const [label,stub] of [["needs_reauth",mk("needs_reauth")],["server_unavailable",mk("server_unavailable")],["no-mcp",noMcp]]){
  const ctx=await b.newContext({viewport:{width:760,height:600},timezoneId:"Asia/Jerusalem",colorScheme:"dark"});
  const p=await ctx.newPage();const errs=[];
  p.on("pageerror",e=>errs.push(e.message));p.on("console",m=>{if(m.type()==="error")errs.push(m.text());});
  await p.setContent(`<!doctype html><html><head><meta charset="utf-8"><script>${stub}<\/script></head><body>${page_html}</body></html>`,{waitUntil:"load"});
  await p.waitForTimeout(label==="server_unavailable"?21000:2500);
  const r=await p.evaluate(()=>({state:(document.querySelector(".state h2")||{}).textContent||null,
    body:(document.querySelector(".state p")||{}).textContent||null,
    banner:(document.querySelector(".banner")||{}).textContent||null,
    skel:!!document.querySelector(".skel")}));
  console.log(`[${label}]`,errs.length?("ERR "+errs.join("|")):"ok",JSON.stringify(r));
  await p.screenshot({path:`dead-${label}.png`});await ctx.close();
}
await b.close();})();
