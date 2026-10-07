// Saved places, in Settings → Personal: a list to remove from, nothing else
// (Mor, 2026-10-07). Places are learned on the Now screen, by asking (now.js
// placeAskView, where.js placeAsk); a wrong guess is fixed there too
// (placeFix, rideAsk). Before that this was a picker plus a save field
// nobody would open Settings to use.
import { savedPlaces, removeSpot, restoreSpot } from "./where.js";
import { h, bdi, flash } from "./ui.js";

// host: the box inside Settings.
export function mountPlaces(host){
  function render(){
    const names = savedPlaces();
    const del = (n) => h("button", { type: "button", className: "chip pl-del", ariaLabel: `Remove ${n}`, onclick: () => {
      const gone = removeSpot(n);
      flash("Removed ", n, { undo: () => { restoreSpot(gone); render(); } });
      render();
    } }, bdi(n), h("span", { ariaHidden: "true", textContent: " ✕" }));
    host.replaceChildren(
      h("div", { className: "menu-row" }, h("span", { className: "menu-label", textContent: "Places" })),
      names.length ? h("div", { className: "pl-opts" }, ...names.map(del)) : null,
      h("p", { className: "menu-note", textContent: names.length
        ? "Daisey asks when you're somewhere new. Tap one to forget it."
        : "None yet. Daisey will ask when you're somewhere it doesn't know." }));
  }
  return { show: render };
}
