/* Inline editing: card description and checklist item text, written straight
   through to Trello (trelloWriteCard update / trelloWriteChecklist update_item). */
const fs=require("fs"),vm=require("vm");const {chromium}=require("playwright");
const H=fs.readFileSync("harness.js","utf8");const page_html=fs.readFileSync("daisey.html","utf8");
const sb={require,__dirname,module:{exports:{}},exports:{},console,process};
vm.runInNewContext(H.split("(async () => {")[0]+"\nmodule.exports={stub};",sb);
// give the hub card (checklist cl1 already attached) a description too,
// so both edit paths are exercised on the one guaranteed-visible panel
const withDesc = sb.module.exports.stub.replace(
  'name":"ארנונה","desc":""',
  'name":"ארנונה","desc":"Original description text"');
const stub=withDesc.replace(/const DAY = [^;]+;/,'const DAY = "2026-08-17";');
const clock=t=>`const R=Date;const O=new R("${t}").getTime()-R.now();
window.Date=class extends R{constructor(...a){if(a.length===0)super(R.now()+O);else super(...a);}static now(){return R.now()+O;}};`;
(async()=>{const b=await chromium.launch({});
const ctx=await b.newContext({viewport:{width:760,height:1200},timezoneId:"Asia/Jerusalem",colorScheme:"dark"});
const p=await ctx.newPage();const errs=[];
p.on("pageerror",e=>errs.push(e.message));p.on("console",m=>{if(m.type()==="error")errs.push(m.text());});
await p.setContent(`<!doctype html><html><head><meta charset="utf-8"><script>${clock("2026-08-17T09:00:00+03:00")}${stub}<\/script></head><body>${page_html}<script>try{checkChoresTrigger=function(){};}catch(_){}<\/script></body></html>`,{waitUntil:"load"});
await p.waitForTimeout(2800);
let fails=0;

/* The auto-plan merges every quick task that day into one brick (see
   CLAUDE.md), which has no expand/edit toggle of its own. This test needs
   the hub to genuinely be "ארנונה" (the card just given a description
   above), so it force-seeds a day with just that one quick task — a lone
   quick task still collapses to a plain single-card row with the normal
   .mini.info toggle, same as before bricks existed.
   Both the mock's backing EVENTS array AND the page's S.events cache have
   to be overwritten (same pattern fast.js's seed() uses) — the connector
   stub's watcher re-fires from EVENTS on its own timer, so touching only
   S.events gets silently reverted back to whatever the boot-time auto-plan
   already wrote into EVENTS the moment that watcher next fires. */
await p.evaluate(()=>{
  const ev = { id:"solo-edittest", colorId:"9", summary:"• ארנונה",
    description:"[daisey] ארנונה\n\nOriginal: https://trello.com/c/TXxCAu3T",
    start:{dateTime:"2026-08-17T09:00:00+03:00",timeZone:"Asia/Jerusalem"},
    end:{dateTime:"2026-08-17T09:15:00+03:00",timeZone:"Asia/Jerusalem"}, status:"confirmed" };
  EVENTS.length=0; EVENTS.push(ev);
  S.events={ payload:{ events:[ev] }, storedAt:Date.now() };
  render();
});
await p.waitForTimeout(400);

/* #pageMain, #heroSlot (2026-08-26 hero redesign): this fixture force-seeds
   a single quick task, which becomes `current` — and current no longer
   renders inside #pageMain at all, it lives in #heroSlot, a flex sibling
   above the scroller (see daisey.html's paintHero/heroCard). Every selector
   below that used to assume "the hub's card, inside #pageMain" now covers
   both without caring which one actually holds it. */
// details are closed by default now — open the hub's own toggle first
await p.locator("#pageMain .mini.info, #heroSlot .mini.info").first().click();
await p.waitForTimeout(300);

// --- description: edit, save ---
await p.locator("#pageMain .details .desc-row .edit-pencil, #heroSlot .details .desc-row .edit-pencil").first().click();
await p.waitForTimeout(150);
const ta = p.locator("#pageMain .details .edit-row textarea, #heroSlot .details .edit-row textarea").first();
await ta.fill("Edited description text");
await p.locator("#pageMain .details .edit-acts .btn.primary, #heroSlot .details .edit-acts .btn.primary").first().click();
await p.waitForTimeout(400);
const afterDesc = await p.evaluate(()=>({
  text:(document.querySelector("#pageMain .details .desc, #heroSlot .details .desc")||{}).textContent||null,
  editorGone: !document.querySelector("#pageMain .details textarea, #heroSlot .details textarea"),
  write:(window.__calls.find(c=>c.tool==="trelloWriteCard"&&c.input.action==="update"&&c.input.desc==="Edited description text")||{}).input||null
}));
console.log("[desc-save]", JSON.stringify(afterDesc));
if(afterDesc.text!=="Edited description text") { console.log("  ✗ desc text not updated in DOM"); fails++; }
if(!afterDesc.editorGone) { console.log("  ✗ editor still open after save"); fails++; }
if(!afterDesc.write || afterDesc.write.desc!=="Edited description text") { console.log("  ✗ no matching trelloWriteCard write"); fails++; }

// --- checklist item: edit, cancel (Escape) leaves it untouched ---
const firstItem = p.locator("#pageMain .details li, #heroSlot .details li").first();
const beforeText = (await firstItem.locator(".it").textContent()).trim();
const beforeChecked = await firstItem.locator(".box").getAttribute("aria-pressed");
await firstItem.locator(".edit-pencil").click();
await p.waitForTimeout(150);
const inp = p.locator("#pageMain .details li.editing .edit-item, #heroSlot .details li.editing .edit-item").first();
await inp.fill("should not stick");
await inp.press("Escape");
await p.waitForTimeout(300);
const afterCancel = await p.evaluate(()=>({
  editorGone: !document.querySelector("#pageMain .details .edit-item, #heroSlot .details .edit-item"),
  writes: window.__calls.filter(c=>c.tool==="trelloWriteChecklist"&&c.input.action==="update_item"&&c.input.text!==undefined).length
}));
console.log("[item-cancel]", JSON.stringify(afterCancel));
if(!afterCancel.editorGone) { console.log("  ✗ editor still open after Escape"); fails++; }
if(afterCancel.writes) { console.log("  ✗ Escape should not write"); fails++; }
const afterCancelText = (await firstItem.locator(".it").textContent()).trim();
if(afterCancelText !== beforeText) { console.log("  ✗ text changed despite cancel"); fails++; }

// --- checklist item: edit, save (Enter) ---
await firstItem.locator(".edit-pencil").click();
await p.waitForTimeout(150);
const inp2 = p.locator("#pageMain .details li.editing .edit-item, #heroSlot .details li.editing .edit-item").first();
await inp2.fill("Renamed item text");
await inp2.press("Enter");
await p.waitForTimeout(400);
const afterSave = await p.evaluate(()=>({
  text:(document.querySelector("#pageMain .details li .it, #heroSlot .details li .it")||{}).textContent||null,
  editorGone: !document.querySelector("#pageMain .details .edit-item, #heroSlot .details .edit-item"),
  write:(window.__calls.find(c=>c.tool==="trelloWriteChecklist"&&c.input.action==="update_item"&&c.input.text)||{}).input||null,
  boxIntact:(document.querySelector("#pageMain .details li .box, #heroSlot .details li .box")||{}).getAttribute&&document.querySelector("#pageMain .details li .box, #heroSlot .details li .box").getAttribute("aria-pressed")
}));
console.log("[item-save]", JSON.stringify(afterSave));
if(afterSave.text!=="Renamed item text") { console.log("  ✗ item text not updated in DOM"); fails++; }
if(!afterSave.editorGone) { console.log("  ✗ editor still open after save"); fails++; }
if(!afterSave.write || afterSave.write.text!=="Renamed item text") { console.log("  ✗ no matching trelloWriteChecklist write"); fails++; }
if(afterSave.boxIntact!==beforeChecked) { console.log(`  ✗ rename flipped checked state (${beforeChecked} -> ${afterSave.boxIntact})`); fails++; }

fails += errs.length;
console.log(errs.length ? "page errors: "+errs.join("|") : "page errors: none");
console.log(fails ? `✗ ${fails} problem(s)` : "✓ description and checklist-item edits write through cleanly");
await p.screenshot({path:"edit.png",fullPage:true});
await b.close(); process.exit(fails?1:0);})();
