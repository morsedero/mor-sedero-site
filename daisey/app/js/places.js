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

const away = (m) => (m == null ? "" : m < 1000 ? `${Math.round(m / 10) * 10} m away` : `${(m / 1000).toFixed(1)} km away`);
const MODES = [["out", "Out"], ["walk", "Walking"], ["train", "Train"], ["bus", "Bus"], ["car", "Driving"]];
const LABELS = { home: "Home", out: "Out", walk: "Walking", ride: "Travelling", train: "On a train", bus: "On a bus", car: "Driving" };
const SUGGEST = ["Home", "Studio", "Gym"];
const isHome = (n) => n.trim().toLowerCase() === "home";

const nowText = (v) => (v == null ? "Not sure yet" : v.startsWith("spot:") ? `At ${v.slice(5)}` : v === "home" ? "At Home" : LABELS[v] || v);

export function mountPlaces(dialog){
  let adding = false, draft = "";

  function render(){
    const now = whereNow(), names = savedPlaces(), hand = pickedByHand(), spots = spotStatus();
    const hasHome = names.some(isHome);
    const opts = [...names.map((n) => [isHome(n) ? "home" : `spot:${n}`, n]), ...MODES];
    const pick = ([v, text]) => h("button", { type: "button", className: "chip", role: "radio", ariaChecked: String(now === v),
      onclick: () => { setManual(v); render(); } }, bdi(text));

    const saveIt = async (n) => {
      flash(await saveSpot(n) ? `Saved this spot as ${n}` : "Couldn't get your location. Allow it for this site and try again.");
      adding = false; draft = "";
      render();
    };
    const name = h("input", { id: "placeName", dir: "auto", autocomplete: "off", enterkeyhint: "done", value: draft,
      oninput: (e) => { draft = e.target.value; } });
    const suggest = SUGGEST.filter((s) => !names.some((n) => n.toLowerCase() === s.toLowerCase()));

    dialog.replaceChildren(...[
      h("div", { className: "now-head" }, h("h2", { id: "plTitle", textContent: "Where are you?" }),
        h("button", { className: "now-x", type: "button", ariaLabel: "Close", textContent: "✕", onclick: () => dialog.close() })),
      h("p", { className: "pl-intro", textContent: "Daisey reads your location. Tap a place to correct it; that holds for 45 minutes." }),

      h("h3", { className: "pl-h", textContent: "Now" }),
      h("p", { className: "pl-now" }, h("strong", {}, bdi(nowText(now))),
        h("small", { className: "pl-sub", textContent: hand ? " · set by you" : " · from your location" })),
      h("div", { className: "pl-opts", role: "radiogroup", ariaLabel: "Where are you?" }, ...opts.map(pick)),
      hand ? h("button", { className: "linkish", type: "button", textContent: "Use my location again",
        onclick: () => { setManual(null); render(); } }) : null,

      h("h3", { className: "pl-h", textContent: "My places" }),
      h("p", { className: "pl-sub", textContent: "Daisey uses these to tell home from out, and to rank tasks that mention them. Saved on this device only." }),
      spots.length
        ? h("ul", { className: "pl-list" }, ...spots.map((sp) => h("li", {},
          h("span", { className: "pl-name" }, bdi(sp.name),
            h("small", { className: "pl-sub", textContent: sp.here ? "You're here" : away(sp.m) })),
          h("button", { className: "linkish", type: "button", textContent: "Remove", ariaLabel: `Remove ${sp.name}`,
            onclick: () => {
              const gone = removeSpot(sp.name);
              flash("Removed ", sp.name, { undo: () => { restoreSpot(gone); render(); } });
              render();
            } }))))
        : h("p", { className: "pl-empty", textContent: "No places yet. Save Home first so Daisey can tell home from out." }),

      adding
        ? h("form", { className: "pl-save", onsubmit: (e) => { e.preventDefault(); if (draft.trim()) saveIt(draft.trim()); } },
          h("div", { className: "field" }, h("label", { htmlFor: "placeName", textContent: "Name this spot" }), name),
          h("button", { className: "btn small", type: "submit", textContent: "Save" }),
          suggest.length ? h("div", { className: "pl-suggest" }, ...suggest.map((s) => h("button", { type: "button", className: "chip",
            onclick: () => { draft = s; render(); } }, s))) : null)
        : h("button", { className: "btn small", type: "button", textContent: hasHome ? "+ Save where I am now" : "+ Save where I am now (Home?)",
          onclick: () => { adding = true; render(); document.getElementById("placeName")?.focus(); } }),
    ].filter(Boolean));
  }

  return { open(){
    adding = false; draft = "";
    render();
    // The location can answer while the sheet is open; don't wipe a name being typed.
    const stop = watchWhere(() => { if (dialog.open && !draft) render(); });
    dialog.addEventListener("close", stop, { once: true });
    dialog.showModal();
  } };
}
