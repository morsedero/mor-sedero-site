// :has() by hand. Mor's phone browser has no :has() (nor color-mix()), and a
// rule with one in its selector is thrown out whole there: Today sat half
// open on the home, project flowers stacked over the name (2026-10-19). So
// app.css never uses :has(): each rule that wanted it reads a class this adds
// to the host, "h-<name>", while the host holds a match for the argument.
// To add one: a row here, `.h-<name>` in the CSS. Rows are [name, host, arg];
// an arg starting with ">" looks at the host's children only.
const ROWS = [
  ["won", "#nowcard", ".now-card.main.won"],
  ["evname", ".now-head", ".ev-name"],
  ["hold", ".later-ask", ".hold-opt"],
  ["menuico", ".menu-row", ".menu-ico"],
  ["settingsbtn", ".acct-menu", "#settingsBtn"],
  ["ichip", ".settings .menu-label", ".ichip"],
  ["ichipkid", ".settings .menu-check", "> .ichip"],
  ["minialt", ".switch-ask", ".alt-card.mini"],
  ["drag", ".pp-zone", "> .pp-drag"],
  ["screen", "body", ".screen:not([hidden])"],
  ["dialog", "html", "dialog[open]"],
  ["focuschip", ".hdr-end", "#focusChip:not([hidden])"],
  ["focuskid", ".hero-top", "> #focusChip"],
  ["ask", ".nowrow", ".now-card.main :is(.later-ask, .pend-ask)"],
  ["pgopen", "html", "#planPage:not([hidden]), #projPage:not([hidden]), #projectview:not([hidden])"],
  ["loose", ".night-today", "> .night-loose:only-child"],
  ["gogo", ".glance-row", ".gl-go:not(:empty)"],
  ["four", ".pp-actions", "> .btn:nth-child(4)"],
  ["plan", "#panel", "> #planPage:not([hidden]):not(.pg-ghost)"],
  ["quiet", "#nowcard", ".now-card.main.qh"],
  ["taskbar", ".done-col.solo", ".task-bar"],
  ["drop", "#nowcard", ".later-drop"],
  ["routine", "#nowcard", ".routine-ask"],
  ["stackempty", "#dock", "> .dock-stack:empty"],
  ["dayopen", "html", "body.day-open"],
  ["glanceopen", "body", "#glance:not([hidden])"],
  ...["pc-admin", "pc-work", "pc-home", "pc-social", "pc-job", "pc-personal", "pc-teal", "pc-orange", "pc-slate", "pc-brick", "pc-lime",
    "area-admin", "area-work", "area-home", "area-social", "area-job", "area-personal"]
    .map((c) => ["tone-" + c, "html", "#nowcard .now-card.main." + c]),
];

const sweep = () => {
  for (const [name, host, arg] of ROWS) {
    const cls = "h-" + name, on = new Set();
    for (const el of document.querySelectorAll(host)) {
      let hit = false;
      try { hit = !!el.querySelector(arg.startsWith(">") ? ":scope " + arg : arg); } catch {}
      if (hit) on.add(el);
      if (hit !== el.classList.contains(cls)) el.classList.toggle(cls, hit);
    }
    for (const el of Array.from(document.getElementsByClassName(cls))) if (!on.has(el)) el.classList.remove(cls);
  }
};

export function hasShim(){
  // The callback runs before the next paint, so a class lands with the change that wants it.
  let busy = false;
  new MutationObserver(() => { if (busy) return; busy = true; try { sweep(); } finally { busy = false; } })
    .observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "hidden", "open"] });
  sweep();
}
