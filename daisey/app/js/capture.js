// The capture bar: one field at the bottom of the screen, always there.
// Type a sentence, press Enter, and Daisey shows what it understood as a
// small confirm card — ✓ adds it, ✕ throws it away, and any field can be
// fixed first. Nothing is written before the ✓ (spec: propose, never act).
//
// The parsing is local for now (parse.js); Gemini replaces it later behind
// the same confirm card. The mic is here but inactive until voice lands.
import { watchTasks, addTask } from "./store.js";
import { parseTask } from "./parse.js";
import { h, icon, bdi, dur } from "./ui.js";

const SIZES = [5, 15, 30, 60, 90, 120];

export function mountCapture(root, uid){
  let tasks = [];
  let projects = [];
  let draft = null; // what the confirm card is showing

  const field = h("input", {
    type: "text", className: "cap-input", dir: "auto", autocomplete: "off",
    placeholder: "Tell Daisey…", ariaLabel: "Tell Daisey about a task",
  });
  const mic = h("button", {
    className: "cap-mic", type: "button", disabled: true,
    title: "Voice is not wired up yet", ariaLabel: "Dictate (not available yet)",
  }, icon("mic"));
  const msg = h("p", { className: "cap-msg muted", role: "status" });
  const confirm = h("div", { className: "cap-confirm", hidden: true });
  const list = h("datalist", { id: "cap-projects" });
  field.setAttribute("list", "cap-projects");

  const bar = h("form", { className: "cap-bar" }, field, mic);
  bar.onsubmit = (e) => { e.preventDefault(); propose(field.value); };

  function propose(text){
    const parsed = parseTask(text, { projects });
    if (!parsed.title) return;
    draft = parsed;
    field.value = "";
    render();
  }

  // Every guess is visible and fixable before anything is saved.
  function render(){
    msg.textContent = "";
    confirm.hidden = !draft;
    document.body.classList.toggle("capturing", !!draft); // the + would sit on top of the card
    if (!draft) { confirm.replaceChildren(); return; }

    const title = h("input", { type: "text", dir: "auto", className: "cap-title", value: draft.title, ariaLabel: "Task" });
    const project = h("input", { type: "text", dir: "auto", className: "cap-field", value: draft.project || "",
      placeholder: "Inbox", ariaLabel: "Project (optional)", autocomplete: "off" });
    project.setAttribute("list", "cap-projects");
    const sizes = draft.size && !SIZES.includes(draft.size) ? [...SIZES, draft.size].sort((a, b) => a - b) : SIZES;
    const size = h("select", { className: "cap-field", ariaLabel: "How long" },
      ...[["", "size?"], ...sizes.map((v) => [v, dur(v)])]
        .map(([v, t]) => h("option", { value: v, textContent: t, selected: String(v) === String(draft.size ?? "") })));
    const due = h("input", { type: "date", className: "cap-field", value: draft.due || "", ariaLabel: "Due (optional)" });

    const save = () => {
      const input = { title: title.value, project: project.value, due: due.value };
      if (size.value) input.size = Number(size.value);
      if (!input.title.trim()) { title.focus(); return; }
      // Resolves on server ack, which never comes offline; the board shows it
      // locally either way, so don't wait.
      addTask(uid, input, tasks).catch((e) => { console.error("[daisey] capture", e); msg.textContent = "Not saved: " + (e.code || e.message); });
      msg.replaceChildren("Added ", bdi(input.title.trim()), ".");
      draft = null;
      render();
      field.focus();
    };

    confirm.replaceChildren(
      h("div", { className: "cap-row" }, title,
        h("button", { className: "cap-ok", type: "button", textContent: "✓", ariaLabel: "Add this task", onclick: save }),
        h("button", { className: "cap-no", type: "button", textContent: "✕", ariaLabel: "Throw this away",
          onclick: () => { draft = null; render(); field.focus(); } })),
      h("div", { className: "cap-row cap-guesses" }, project, size, due));
    title.onkeydown = project.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); save(); } };
    confirm.onkeydown = (e) => { if (e.key === "Escape") { draft = null; render(); field.focus(); } };
    title.focus();
    title.setSelectionRange(title.value.length, title.value.length);
  }

  root.replaceChildren(confirm, msg, bar, list);
  root.hidden = false;

  const unsub = watchTasks(uid, (ts) => {
    tasks = ts;
    projects = [...new Set(ts.map((t) => t.project))].sort();
    list.replaceChildren(...projects.map((p) => h("option", { value: p })));
  }, (e) => console.error("[daisey] capture", e));

  return {
    // project: prefill from a column's "+ Add a task"; omitted = just focus.
    open(project){
      if (project) { draft = { title: "", project, size: null, due: null, found: [] }; render(); }
      else field.focus();
    },
    unmount(){ unsub(); document.body.classList.remove("capturing"); root.replaceChildren(); root.hidden = true; },
  };
}
