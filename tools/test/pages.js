/* The one-page shell and its Day/Week/Month switcher — none of this existed
   before the redesign that dropped the separate Tasks/Schedule swipe split,
   so nothing else in the suite exercises it. */
const fs=require("fs"),vm=require("vm");const {chromium}=require("playwright");
const H=fs.readFileSync(__dirname+"/harness.js","utf8");
const page_html=fs.readFileSync(__dirname+"/dayflow.html","utf8");
const sb={require,__dirname,module:{exports:{}},exports:{},console,process};
vm.runInNewContext(H.split("(async () => {")[0]+"\nmodule.exports={stub};",sb);
const BASE=sb.module.exports.stub;
const stub=BASE.replace(/const DAY = [^;]+;/,'const DAY = "2026-08-17";');
const clock=t=>`const R=Date;const O=new R("${t}").getTime()-R.now();
window.Date=class extends R{constructor(...a){if(a.length===0)super(R.now()+O);else super(...a);}static now(){return R.now()+O;}};`;

(async()=>{
  const b=await chromium.launch({});
  const ctx=await b.newContext({viewport:{width:400,height:850},timezoneId:"Asia/Jerusalem",colorScheme:"dark"});
  const p=await ctx.newPage();
  const errs=[];
  p.on("pageerror",e=>errs.push(e.message));
  p.on("console",m=>{if(m.type()==="error")errs.push(m.text());});
  await p.setContent(`<!doctype html><html><head><meta charset="utf-8"><script>${clock("2026-08-17T09:00:00+03:00")}${stub}<\/script></head><body>${page_html}</body></html>`,{waitUntil:"load"});
  await p.waitForTimeout(2800);

  const bad=[];
  const check=(cond,msg)=>{ if(!cond) bad.push(msg); };

  // 1. starts on Day view, on the one page, switcher visible from the start
  let state=await p.evaluate(()=>({view:S.view,hub:!!document.querySelector("#pageMain .now"),
    viewSwitchHidden:document.querySelector("#viewSwitch").hidden}));
  check(state.view==="day","should start on Day view");
  check(state.hub,"Day view should show the hub card");
  check(!state.viewSwitchHidden,"the Day/Week/Month switch should always be visible now");
  await p.screenshot({path:"pages-day.png"});

  // 2. the day's activities include real meetings, not just tasks — the
  //    merge that replaced the separate Schedule page
  state=await p.evaluate(()=>({meetingRows:document.querySelectorAll("#pageMain .item.meeting").length}));
  check(state.meetingRows>0,"Day view's activity list should include meetings, not tasks only");

  // 2b. drag-to-reorder in the Day-view list: drag the hub card onto the
  //     first list row below it — with nothing between them in the run,
  //     pushing degenerates to trading their two start times (two
  //     update_event calls), with an undo that puts both back. Dragging a
  //     task onto a meeting must be a no-op — meetings aren't a drop target.
  {
    const hubBox=await p.locator("#pageMain .now").boundingBox();
    const rowBox=await p.locator("#pageMain .rows.stack .item.stack:not(.meeting)").first().boundingBox();
    if(hubBox && rowBox){
      const before=await p.evaluate(()=>window.__calls.filter(c=>c.tool==="update_event").length);
      await p.mouse.move(hubBox.x+hubBox.width/2, hubBox.y+20);
      await p.mouse.down();
      await p.mouse.move(hubBox.x+hubBox.width/2, rowBox.y+rowBox.height/2, {steps:8});
      await p.mouse.move(hubBox.x+hubBox.width/2, rowBox.y+rowBox.height/2, {steps:2});
      await p.mouse.up();
      await p.waitForTimeout(700);
      const after=await p.evaluate(()=>window.__calls.filter(c=>c.tool==="update_event").length);
      check(after-before===2,`dragging the hub onto the adjacent list row should push both slots (2 update_event calls), got ${after-before}`);
      const pushToast=await p.evaluate(()=>document.querySelector(".toast.undo .undo-msg")?.textContent||null);
      check(!!pushToast,"a completed push should show the undo popup");

      const beforeUndo=await p.evaluate(()=>window.__calls.filter(c=>c.tool==="update_event").length);
      await p.keyboard.press("Control+z");
      await p.waitForTimeout(700);
      const afterUndo=await p.evaluate(()=>window.__calls.filter(c=>c.tool==="update_event").length);
      check(afterUndo-beforeUndo===2,`Ctrl+Z on a push should undo both sides (2 more update_event calls), got ${afterUndo-beforeUndo}`);
    }else{
      check(false,"drag-to-reorder test setup: hub card or a list row wasn't found");
    }

    // dropping a task onto a meeting: no push should occur
    const meetingBox=await p.locator("#pageMain .rows.stack .item.stack.meeting").first().boundingBox();
    const rowBox2=await p.locator("#pageMain .rows.stack .item.stack:not(.meeting)").first().boundingBox();
    if(meetingBox && rowBox2){
      const before2=await p.evaluate(()=>window.__calls.filter(c=>c.tool==="update_event").length);
      await p.mouse.move(rowBox2.x+rowBox2.width/2, rowBox2.y+rowBox2.height/2);
      await p.mouse.down();
      await p.mouse.move(rowBox2.x+rowBox2.width/2, meetingBox.y+meetingBox.height/2, {steps:8});
      await p.mouse.up();
      await p.waitForTimeout(500);
      const after2=await p.evaluate(()=>window.__calls.filter(c=>c.tool==="update_event").length);
      check(after2===before2,"dropping a task onto a meeting should not push anything");
    }
  }

  // 3. switch to Week — should render 7 day columns and the same day's items
  await p.click('#viewSwitch button[data-view="week"]');
  await p.waitForTimeout(400);
  state=await p.evaluate(()=>({view:S.view,cols:document.querySelectorAll(".week-col").length,
    label:document.querySelector("#dateLabel").textContent}));
  check(state.view==="week","clicking Week should set S.view");
  check(state.cols===7,`week view should render 7 columns, got ${state.cols}`);
  await p.screenshot({path:"pages-week.png"});

  // 4. drag a compact week item down by ~2h (a same-column time change) and
  //    confirm it actually issues an update_event. The fixture's first
  //    three quick tasks sit back-to-back 09:00-10:00, so a short drop would
  //    now correctly collide with a sibling task (rescheduleTo rejects
  //    landing on top of another block) — drop it well clear of that
  //    cluster and the fixture's other meetings instead.
  const before=await p.evaluate(()=>window.__calls.filter(c=>c.tool==="update_event").length);
  const chip=p.locator(".week-col .item.compact:not(.meeting)").first();
  if(await chip.count()){
    const box=await chip.boundingBox();
    if(box){
      await p.mouse.move(box.x+box.width/2, box.y+5);
      await p.mouse.down();
      await p.mouse.move(box.x+box.width/2, box.y+125, {steps:6});
      await p.mouse.up();
      await p.waitForTimeout(700);
    }
  }
  const after=await p.evaluate(()=>window.__calls.filter(c=>c.tool==="update_event").length);
  check(after>before,"dragging a week-view item should call update_event");

  // 5. that drag should also offer an undo — Ctrl+Z puts it back
  const undoShown=await p.evaluate(()=>!!document.querySelector(".toast.undo"));
  check(undoShown,"a completed drag should show the undo popup");
  const beforeUndo=await p.evaluate(()=>window.__calls.filter(c=>c.tool==="update_event").length);
  await p.keyboard.press("Control+z");
  await p.waitForTimeout(700);
  const afterUndo=await p.evaluate(()=>window.__calls.filter(c=>c.tool==="update_event").length);
  check(afterUndo>beforeUndo,"Ctrl+Z should undo the last move with another update_event call");
  const undoGone=await p.evaluate(()=>!document.querySelector(".toast.undo"));
  check(undoGone,"the undo popup should dismiss itself once used");

  // 5b. dragging a task on top of another block (task or meeting) must be
  //     rejected rather than silently committed — rescheduleTo() checks this
  //     now, closing a gap where drag had no collision check at all.
  const beforeCollide=await p.evaluate(()=>window.__calls.filter(c=>c.tool==="update_event").length);
  const chip2=p.locator(".week-col .item.compact:not(.meeting)").nth(1);
  if(await chip2.count()){
    const box2=await chip2.boundingBox();
    if(box2){
      await p.mouse.move(box2.x+box2.width/2, box2.y+5);
      await p.mouse.down();
      await p.mouse.move(box2.x+box2.width/2, box2.y+25, {steps:6});
      await p.mouse.up();
      await p.waitForTimeout(500);
    }
  }
  const afterCollide=await p.evaluate(()=>window.__calls.filter(c=>c.tool==="update_event").length);
  check(afterCollide===beforeCollide,"dragging onto another block should not call update_event");
  const collideToast=await p.evaluate(()=>{
    const all=[...document.querySelectorAll(".toast:not(.undo)")];
    return all.length ? all[all.length-1].textContent : "";
  });
  check(/already taken|meeting/i.test(collideToast),`should toast that the slot is taken, got "${collideToast}"`);

  // 6. switch to Month — should render a 42-cell grid, tapping a cell jumps
  //    into Day view for that date
  await p.click('#viewSwitch button[data-view="month"]');
  await p.waitForTimeout(400);
  state=await p.evaluate(()=>({view:S.view,cells:document.querySelectorAll(".month-cell").length,
    label:document.querySelector("#dateLabel").textContent}));
  check(state.view==="month","clicking Month should set S.view");
  check(state.cells===42,`month view should render 42 cells, got ${state.cells}`);
  await p.screenshot({path:"pages-month.png"});

  const targetDay=await p.evaluate(()=>{
    const cells=[...document.querySelectorAll(".month-cell:not(.dim)")];
    const target=cells[10];
    target.click();
    return target.querySelector(".mc-num").textContent;
  });
  await p.waitForTimeout(300);
  state=await p.evaluate(()=>({view:S.view,anchorDate:S.anchor.getDate()}));
  check(state.view==="day","tapping a month cell should switch to Day view");
  check(String(state.anchorDate)===targetDay,`tapping day ${targetDay} should set S.anchor to that date, got ${state.anchorDate}`);

  // 7. date picker: open it, pick a date, confirm S.anchor updates and the
  //    dialog closes
  await p.click("#dateWrap");
  await p.waitForTimeout(300);
  const pickerOpen=await p.evaluate(()=>!!document.querySelector(".dialog .month-cell"));
  check(pickerOpen,"tapping the date should open the date picker dialog");
  await p.evaluate(()=>{
    const cells=[...document.querySelectorAll(".dialog .month-cell")];
    cells[15].click();
  });
  await p.waitForTimeout(300);
  const pickerClosed=await p.evaluate(()=>!document.querySelector(".scrim"));
  check(pickerClosed,"picking a date should close the picker dialog");

  // 8. settings Cancel discards an in-progress color change
  await p.click("#setBtn");
  await p.waitForTimeout(300);
  const before2=await p.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue("--b-projects").trim());
  await p.evaluate(()=>{ document.querySelector(".col-in").value="#ff00ff";
    document.querySelector(".col-in").dispatchEvent(new Event("input")); });
  await p.waitForTimeout(150);
  const previewed=await p.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue("--b-projects").trim());
  check(previewed.toLowerCase()==="#ff00ff","color input should preview live");
  await p.click(".dialog .btn.quiet"); // Cancel is the first quiet button
  await p.waitForTimeout(200);
  const afterCancel=await p.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue("--b-projects").trim());
  check(afterCancel===before2,"Cancel should revert the previewed color");
  const persisted=await p.evaluate(()=>(S.stats.settings||{}).colors||{});
  check(!persisted.projects,"Cancel should not persist the color change");

  console.log("errors:", errs.length?errs:"none");
  console.log(bad.length ? "FAIL:\n  ✗ "+bad.join("\n  ✗ ") : "✓ all page/view/undo/picker/settings behaviours hold");
  await b.close();
  process.exit(bad.length+errs.length?1:0);
})();
