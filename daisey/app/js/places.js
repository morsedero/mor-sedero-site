// Where you are, inline in Settings → Personal (2026-10-07; was its own sheet,
// ported from the old Daisey's placeSheet 2026-10-05). One row says what
// Daisey thinks (auto, or set by you → Reset). Chips pick by hand; that holds
// 45 min (where.js MANUAL_MS). Saved places (Home, Studio…) are chips too:
// Home tells Home from Out, any other name makes tasks that mention it rank
// higher while you're there. Edit puts a ✕ on them to remove one.
import { whereNow, savedPlaces, pickedByHand, setManual, saveSpot, removeSpot, restoreSpot, watchWhere } from "./where.js";
import { h, bdi, flash } from "./ui.js";

const MODES = [["out", "Out"], ["walk", "Walking"], ["train", "Train"], ["bus", "Bus"], ["car", "Driving"]];
const LABELS = { home: "Home", out: "Out", walk: "Walking", ride: "Travelling", train: "Train", bus: "Bus", car: "Driving" };
const isHome = (n) => n.trim().toLowerCase() === "home";
const nowText = (v) => (v == null ? "Not sure" : v.startsWith("spot:") ? v.slice(5) : LABELS[v] || v);

// host: the box inside Settings; dialog: Settings itself (watch only while it's open).
export function mountPlaces(host, dialog){
  let draft = "", editing = false;

  function render(){
    const now = whereNow(), names = savedPlaces(), hand = pickedByHand();
    if (!names.length) editing = false;
    const pick = ([v, text]) => h("button", { type: "button", className: "chip", role: "radio", ariaChecked: String(now === v),
      onclick: () => { setManual(v); render(); } }, bdi(text));
    const spot = (n) => (editing
      ? h("button", { type: "button", className: "chip pl-del", ariaLabel: `Remove ${n}`, onclick: () => {
        const gone = removeSpot(n);
        flash("Removed ", n, { undo: () => { restoreSpot(gone); render(); } });
        render();
      } }, bdi(n), h("span", { ariaHidden: "true", textContent: " ✕" }))
      : pick([isHome(n) ? "home" : `spot:${n}`, n]));
    const name = h("input", { id: "placeName", dir: "auto", autocomplete: "off", enterkeyhint: "done", value: draft,
      ariaLabel: "Name this spot", placeholder: names.some(isHome) ? "Save this spot as…" : "Save this spot as Home…",
      oninput: (e) => { draft = e.target.value; } });

    host.replaceChildren(
      h("div", { className: "menu-row" }, h("span", { className: "menu-label", textContent: "Where you are" }),
        h("span", { className: "pl-now" }, bdi(nowText(now)), h("span", { className: "pl-sub", textContent: hand ? " · by you" : " · auto" }),
          hand ? h("button", { className: "linkish pl-reset", type: "button", textContent: "Reset", onclick: () => { setManual(null); render(); } }) : null)),
      h("div", { className: "pl-opts", ariaLabel: "Where are you?", ...(editing ? {} : { role: "radiogroup" }) },
        ...names.map(spot), ...(editing ? [] : MODES.map(pick))),
      h("form", { className: "pl-save", onsubmit: async (e) => {
        e.preventDefault();
        const n = draft.trim();
        if (!n) return;
        flash(await saveSpot(n) ? `Saved this spot as ${n}` : "Couldn't get your location. Allow it for this site and try again.");
        draft = "";
        render();
      } }, name, h("button", { className: "btn small", type: "submit", textContent: "Save" }),
        names.length ? h("button", { className: "linkish pl-edit", type: "button", textContent: editing ? "Done" : "Edit",
          onclick: () => { editing = !editing; render(); } }) : null));
  }

  let stop = null;
  dialog.addEventListener("close", () => { stop?.(); stop = null; editing = false; });
  return { show(){
    draft = "";
    render();
    // The location can answer while Settings is open; don't wipe a name being typed.
    stop ||= watchWhere(() => { if (!draft) render(); });
  } };
}
