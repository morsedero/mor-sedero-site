// The Places sheet (account menu → Places…), ported from the old Daisey's
// placeSheet (2026-10-05), laid out in two labelled sections (2026-10-07):
//  - NOW: what Daisey thinks, and where that came from. Pick by hand when the
//    location reads it wrong; holds 45 min (where.js MANUAL_MS). The sheet
//    stays open so the line above the chips visibly changes.
//  - MY PLACES: spots saved under a name (Home, Studio, Gym…). Home tells Home
//    from Out; any other name makes tasks that mention it (project or title)
//    rank higher while you're there.
import { whereNow, savedPlaces, pickedByHand, setManual, saveSpot, removeSpot, restoreSpot, spotStatus, watchWhere } from "./where.js";
import { h, bdi, flash } from "./ui.js";

const away = (m) => (m == null ? "" : m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);
const MODES = [["out", "Out"], ["walk", "Walking"], ["train", "Train"], ["bus", "Bus"], ["car", "Driving"]];
const LABELS = { home: "Home", out: "Out", walk: "Walking", ride: "Travelling", train: "Train", bus: "Bus", car: "Driving" };
const isHome = (n) => n.trim().toLowerCase() === "home";
const nowText = (v) => (v == null ? "Not sure" : v.startsWith("spot:") ? v.slice(5) : LABELS[v] || v);

export function mountPlaces(dialog){
  let draft = "";

  function render(){
    const now = whereNow(), names = savedPlaces(), hand = pickedByHand(), spots = spotStatus();
    const opts = [...names.map((n) => [isHome(n) ? "home" : `spot:${n}`, n]), ...MODES];
    const pick = ([v, text]) => h("button", { type: "button", className: "chip", role: "radio", ariaChecked: String(now === v),
      onclick: () => { setManual(v); render(); } }, bdi(text));
    const saveIt = async (n) => {
      flash(await saveSpot(n) ? `Saved this spot as ${n}` : "Couldn't get your location. Allow it for this site and try again.");
      draft = "";
      render();
    };
    const name = h("input", { id: "placeName", dir: "auto", autocomplete: "off", enterkeyhint: "done", value: draft,
      ariaLabel: "Name this spot", placeholder: names.some(isHome) ? "Save this spot as…" : "Save this spot as Home…",
      oninput: (e) => { draft = e.target.value; } });

    dialog.replaceChildren(...[
      h("div", { className: "now-head" }, h("h2", { id: "plTitle", textContent: "Where are you?" }),
        h("button", { className: "now-x", type: "button", ariaLabel: "Close", textContent: "✕", onclick: () => dialog.close() })),
      h("p", { className: "pl-now" }, bdi(nowText(now)), h("span", { className: "pl-sub", textContent: hand ? " · set by you" : " · auto" }),
        hand ? h("button", { className: "linkish pl-reset", type: "button", textContent: "Reset", onclick: () => { setManual(null); render(); } }) : null),
      h("div", { className: "pl-opts", role: "radiogroup", ariaLabel: "Where are you?" }, ...opts.map(pick)),
      h("h3", { className: "pl-h", textContent: "Places" }),
      spots.length ? h("ul", { className: "pl-list" }, ...spots.map((sp) => h("li", {},
        bdi(sp.name),
        h("span", { className: "pl-sub", textContent: sp.here ? "Here" : away(sp.m) }),
        h("button", { className: "pl-x", type: "button", textContent: "✕", ariaLabel: `Remove ${sp.name}`,
          onclick: () => {
            const gone = removeSpot(sp.name);
            flash("Removed ", sp.name, { undo: () => { restoreSpot(gone); render(); } });
            render();
          } })))) : null,
      h("form", { className: "pl-save", onsubmit: (e) => { e.preventDefault(); if (draft.trim()) saveIt(draft.trim()); } },
        name, h("button", { className: "btn small", type: "submit", textContent: "Save" })),
    ].filter(Boolean));
  }

  return { open(){
    draft = "";
    render();
    // The location can answer while the sheet is open; don't wipe a name being typed.
    const stop = watchWhere(() => { if (dialog.open && !draft) render(); });
    dialog.addEventListener("close", stop, { once: true });
    dialog.showModal();
  } };
}
