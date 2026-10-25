// Keyboard shortcut registry: the app's single global keydown listener.
// Modules register what they handle instead of each adding its own listener,
// so precedence lives in one place and the "?" help popup can list
// everything that's currently wired up.
//
//   registerShortcut({ keys: ["/"], label: "/", description: "Search lineups",
//                      group: "Map", handler: (e) => {...}, when: () => bool });
//
// Rules applied before any handler runs:
//  - Ignored while typing in an input / textarea / select / contenteditable.
//  - Ignored while a modal (.modal-backdrop.show) owns the screen, unless the
//    shortcut opts in with `allowInModal` (the lightbox's arrow keys do).
//  - Ignored with Ctrl / Meta / Alt held, so browser shortcuts keep working.
//  - The first matching shortcut whose `when()` passes wins (registration
//    order, so register more specific ones first, or pass `priority`).
//
// Escape is special: it always works (even while typing or in a modal) and
// closes the topmost open "layer". Layers are registered with
// registerLayer({ isOpen, close, priority }) and checked highest priority
// first, so Esc peels the UI back one level at a time.
import { watchDialog } from "./modal-utils.js";

const shortcuts = [];
const layers = [];

let order = 0;
export function registerShortcut(def) {
  shortcuts.push({ priority: 0, allowInModal: false, order: order++, ...def });
  shortcuts.sort((a, b) => b.priority - a.priority);
}

export function registerLayer(def) {
  layers.push({ priority: 0, ...def });
  layers.sort((a, b) => b.priority - a.priority);
}

// Blocks every shortcut (Escape included) while it returns true — e.g. the
// drag-to-reposition overlay, which handles its own keys.
let suspended = () => false;
export function setShortcutSuspender(fn) { suspended = fn; }

function isTyping(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

export function modalOpen() {
  return !!document.querySelector(".modal-backdrop.show");
}

document.addEventListener("keydown", (e) => {
  if (e.defaultPrevented || suspended()) return;

  if (e.key === "Escape") {
    for (const layer of layers) {
      if (layer.isOpen()) { e.preventDefault(); layer.close(); return; }
    }
    return;
  }

  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (isTyping(e.target)) return;
  const inModal = modalOpen();
  for (const s of shortcuts) {
    if (!s.keys.includes(e.key)) continue;
    if (inModal && !s.allowInModal) continue;
    if (s.when && !s.when()) continue;
    e.preventDefault();
    s.handler(e);
    return;
  }
});

// ── "?" help popup ────────────────────────────────────────────────────────
let helpBackdrop = null;

function buildHelp() {
  helpBackdrop = document.createElement("div");
  helpBackdrop.className = "modal-backdrop";
  helpBackdrop.id = "shortcutHelpModal";
  helpBackdrop.innerHTML = `
    <div class="modal shortcut-help" role="dialog" aria-modal="true" aria-labelledby="shortcutHelpTitle">
      <div class="shortcut-help-head">
        <h3 id="shortcutHelpTitle">Keyboard shortcuts</h3>
        <button type="button" class="icon-btn" aria-label="Close">✕</button>
      </div>
      <div class="shortcut-help-body"></div>
    </div>`;
  document.body.appendChild(helpBackdrop);
  helpBackdrop.querySelector(".icon-btn").onclick = closeHelp;
  helpBackdrop.addEventListener("click", (e) => { if (e.target === helpBackdrop) closeHelp(); });
  watchDialog(helpBackdrop, "show");
}

function renderHelp() {
  const body = helpBackdrop.querySelector(".shortcut-help-body");
  body.innerHTML = "";
  const groups = new Map();
  // Same label listed once (e.g. ← registered for both the lightbox and the dossier).
  const seen = new Set();
  shortcuts.filter(s => s.description && !s.hidden).sort((a, b) => a.order - b.order).forEach(s => {
    const id = `${s.group}|${s.label}`;
    if (seen.has(id)) return;
    seen.add(id);
    if (!groups.has(s.group || "General")) groups.set(s.group || "General", []);
    groups.get(s.group || "General").push(s);
  });
  groups.set("General", [...(groups.get("General") || []), { label: "Esc", description: "Close the topmost panel or dialog" }, { label: "?", description: "Show this help" }]);
  for (const [name, list] of groups) {
    const sec = document.createElement("section");
    const h = document.createElement("p");
    h.className = "rail-label";
    h.textContent = name;
    sec.appendChild(h);
    const dl = document.createElement("dl");
    list.forEach(s => {
      const dt = document.createElement("dt");
      String(s.label).split(" ").forEach(k => {
        const kbd = document.createElement("kbd");
        kbd.textContent = k;
        dt.appendChild(kbd);
      });
      const dd = document.createElement("dd");
      dd.textContent = s.description;
      dl.append(dt, dd);
    });
    sec.appendChild(dl);
    body.appendChild(sec);
  }
}

export function openHelp() {
  if (!helpBackdrop) buildHelp();
  renderHelp();
  helpBackdrop.classList.add("show");
}

function closeHelp() {
  if (helpBackdrop) helpBackdrop.classList.remove("show");
}

registerShortcut({ keys: ["?"], label: "?", group: "General", handler: openHelp, hidden: true });
registerLayer({ priority: 100, isOpen: () => !!helpBackdrop && helpBackdrop.classList.contains("show"), close: closeHelp });
