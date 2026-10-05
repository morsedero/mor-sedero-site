// The Places sheet (account menu → Places…), ported from the old Daisey's
// placeSheet (2026-10-05). Two jobs:
//  - Where are you? Pick by hand when the location reads it wrong; holds
//    45 min (where.js MANUAL_MS). "Use my location" goes back to it.
//  - Saved places: save where you are now under a name (Home, Studio, Gym…),
//    or remove one. Home tells Home from Out; any other name makes tasks
//    that mention it (project or title) rank higher while you're there.
import { whereNow, savedPlaces, pickedByHand, setManual, saveSpot, removeSpot } from "./where.js";
import { h, bdi, flash } from "./ui.js";

const MODES = [["out", "Out"], ["walk", "Walking"], ["train", "Train"], ["bus", "Bus"], ["car", "Driving"]];

export function mountPlaces(dialog){
  function render(){
    const now = whereNow(), names = savedPlaces(), hand = pickedByHand();
    const opts = [...names.map((n) => [n.trim().toLowerCase() === "home" ? "home" : `spot:${n}`, n]), ...MODES];
    const pick = ([v, text]) => h("button", { type: "button", className: "chip", role: "radio", ariaChecked: String(now === v),
      onclick: () => { setManual(v); dialog.close(); } }, bdi(text));
    const name = h("input", { id: "placeName", dir: "auto", autocomplete: "off", enterkeyhint: "done" });
    const saveIt = async (n) => {
      flash(await saveSpot(n) ? `Saved this spot as ${n}` : "Couldn't get your location. Allow it for this site and try again.");
      render();
    };
    dialog.replaceChildren(...[
      h("div", { className: "now-head" }, h("h2", { id: "plTitle", textContent: "Where are you?" }),
        h("button", { className: "now-x", type: "button", ariaLabel: "Close", textContent: "✕", onclick: () => dialog.close() })),
      h("div", { className: "pl-opts", role: "radiogroup", ariaLabel: "Where are you?" }, ...opts.map(pick)),
      hand ? h("button", { className: "linkish", type: "button", textContent: "Use my location again",
        onclick: () => { setManual(null); dialog.close(); } }) : null,
      h("h3", { className: "pl-h", textContent: "Save this spot" }),
      names.some((n) => n.trim().toLowerCase() === "home") ? null : h("button", { className: "btn small", type: "button", textContent: "I'm home: save it as Home",
        onclick: () => saveIt("Home") }),
      h("form", { className: "pl-save", onsubmit: (e) => { e.preventDefault(); if (name.value.trim()) saveIt(name.value.trim()); } },
        h("div", { className: "field" }, h("label", { htmlFor: "placeName", textContent: "Name it (Studio, Gym…)" }), name),
        h("button", { className: "btn small", type: "submit", textContent: "Save" })),
      !names.length ? null : h("ul", { className: "pl-list" }, ...names.map((n) => h("li", {},
        bdi(n), h("button", { className: "linkish", type: "button", textContent: "Remove", ariaLabel: `Remove ${n}`,
          onclick: () => { removeSpot(n); render(); } }))))].filter(Boolean));
  }
  return { open(){ render(); dialog.showModal(); } };
}
