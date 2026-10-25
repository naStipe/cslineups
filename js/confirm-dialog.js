// Styled replacement for window.confirm(): a small focus-trapped modal that
// reuses the .modal look, returning a Promise<boolean>.
//
//   if (!(await confirmDialog({ title, body, confirmLabel, danger: true }))) return;
//
// Esc / Cancel / backdrop click resolve false, Enter (anywhere but on the
// Cancel button) resolves true. `danger` paints the confirm button red
// (--fire) for destructive actions. `requireText` adds an input the user must
// type that exact word into before confirming (account deletion).
// `body` may be a string (blank lines split paragraphs) or a DOM node.
//
// Only one dialog is ever open; a second call while one is showing resolves
// the first as cancelled. Esc is handled in the capture phase and stopped
// there, so the app's global Escape handling (which closes every open modal)
// never sees it and the dialog underneath stays open.
//
// Standalone on purpose (no app imports besides modal-utils) so admin.html
// can use it too.
import { watchDialog } from "./modal-utils.js";

let backdrop = null, modal = null, titleEl = null, bodyEl = null, inputWrap = null, inputEl = null, inputLabel = null;
let cancelBtn = null, okBtn = null;
let resolver = null;

function build() {
  backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop confirm-backdrop";
  backdrop.innerHTML = `
    <div class="modal confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="confirmDialogTitle" aria-describedby="confirmDialogBody" tabindex="-1">
      <h3 id="confirmDialogTitle"></h3>
      <div class="confirm-body" id="confirmDialogBody"></div>
      <div class="confirm-input" hidden>
        <label class="field-label" for="confirmDialogInput"></label>
        <input type="text" id="confirmDialogInput" autocomplete="off" spellcheck="false">
      </div>
      <div class="modal-actions">
        <button type="button" class="ghost-btn confirm-cancel">Cancel</button>
        <button type="button" class="primary-btn confirm-ok">Confirm</button>
      </div>
    </div>`;
  document.body.appendChild(backdrop);
  modal = backdrop.querySelector(".confirm-modal");
  titleEl = backdrop.querySelector("#confirmDialogTitle");
  bodyEl = backdrop.querySelector("#confirmDialogBody");
  inputWrap = backdrop.querySelector(".confirm-input");
  inputEl = backdrop.querySelector("#confirmDialogInput");
  inputLabel = inputWrap.querySelector("label");
  cancelBtn = backdrop.querySelector(".confirm-cancel");
  okBtn = backdrop.querySelector(".confirm-ok");

  cancelBtn.onclick = () => finish(false);
  okBtn.onclick = () => { if (!okBtn.disabled) finish(true); };
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) finish(false); });
  inputEl.addEventListener("input", syncRequired);

  // Focus goes to the text field when one is required, otherwise to the
  // dialog itself, so Enter confirms and Tab reaches the buttons. (Focusing
  // Cancel would make Enter cancel, contradicting the Enter-confirms rule.)
  watchDialog(backdrop, "show", () => (inputWrap.hidden ? modal : inputEl));
}

let requiredText = "";
function syncRequired() {
  okBtn.disabled = !!requiredText && inputEl.value.trim() !== requiredText;
}

function onKeydown(e) {
  if (!resolver) return;
  if (e.key === "Escape") {
    e.preventDefault();
    e.stopImmediatePropagation();
    finish(false);
  } else if (e.key === "Enter") {
    // Let a focused Cancel button do its native click instead.
    if (document.activeElement === cancelBtn) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (!okBtn.disabled) finish(true);
  }
}

function finish(result) {
  if (!resolver) return;
  const r = resolver;
  resolver = null;
  document.removeEventListener("keydown", onKeydown, true);
  backdrop.classList.remove("show");
  r(result);
}

export function confirmDialog({ title = "Are you sure?", body = "", confirmLabel = "Confirm", cancelLabel = "Cancel", danger = false, requireText = "" } = {}) {
  if (!backdrop) build();
  if (resolver) finish(false);

  titleEl.textContent = title;
  bodyEl.innerHTML = "";
  if (body instanceof Node) bodyEl.appendChild(body);
  else String(body).split(/\n{2,}/).filter(Boolean).forEach(par => {
    const p = document.createElement("p");
    p.textContent = par.trim();
    bodyEl.appendChild(p);
  });
  bodyEl.hidden = !bodyEl.childNodes.length;

  requiredText = requireText;
  inputWrap.hidden = !requireText;
  inputEl.value = "";
  if (requireText) inputLabel.textContent = `Type ${requireText} to confirm`;
  syncRequired();

  okBtn.textContent = confirmLabel;
  okBtn.classList.toggle("danger", !!danger);
  cancelBtn.textContent = cancelLabel;

  return new Promise(resolve => {
    resolver = resolve;
    document.addEventListener("keydown", onKeydown, true);
    backdrop.classList.add("show");
  });
}

export function isConfirmOpen() {
  return !!resolver;
}
